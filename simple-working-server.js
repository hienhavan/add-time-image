const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const archiver = require('archiver');
const cors = require('cors');

const app = express();
const PORT = 3002;

// Enable CORS
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true
}));

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Create output directory
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Configure multer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file ảnh!'), false);
        }
    },
    limits: {
        fileSize: 50 * 1024 * 1024,
        files: 100
    }
});

// Clean output directory
function cleanOutputDirectory() {
    console.log('🧹 Cleaning output directory...');
    try {
        if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir);
            files.forEach(file => {
                const filePath = path.join(outputDir, file);
                fs.unlinkSync(filePath);
                console.log(`✅ Deleted: ${file}`);
            });
        }
        console.log('🧹 Cleaning completed');
    } catch (error) {
        console.error('❌ Error cleaning:', error);
    }
}

class ImageProcessor {
    constructor(config = {}) {
        this.config = {
            fallback_gps: { latitude: 21.0285, longitude: 105.8542 },
            text_position: 'top-right',
            rectangle_color: 'black',
            text_color: 'white',
            font_size: 32,
            padding: 20,
            rectangle_height_percent: 0.3,
            rectangle_width_percent: 0.4,
            ...config
        };
    }

    getExifData(buffer) {
        try {
            const parser = exifParser.create(buffer);
            const result = parser.parse();
            return result;
        } catch (error) {
            return {};
        }
    }

    convertToDegrees(gpsValue) {
        if (!gpsValue || !Array.isArray(gpsValue) || gpsValue.length < 3) {
            return 0;
        }
        const degrees = parseFloat(gpsValue[0]);
        const minutes = parseFloat(gpsValue[1]);
        const seconds = parseFloat(gpsValue[2]);
        return degrees + (minutes / 60.0) + (seconds / 3600.0);
    }

    getGpsCoordinates(exifData) {
        try {
            if (!exifData || !exifData.tags || !exifData.tags.GPSLatitude || !exifData.tags.GPSLongitude) {
                return [null, null];
            }
            const lat = this.convertToDegrees(exifData.tags.GPSLatitude);
            const lon = this.convertToDegrees(exifData.tags.GPSLongitude);
            const latRef = exifData.tags.GPSLatitudeRef;
            const lonRef = exifData.tags.GPSLongitudeRef;
            const finalLat = latRef === 'S' ? -lat : lat;
            const finalLon = lonRef === 'W' ? -lon : lon;
            return [finalLat, finalLon];
        } catch (error) {
            return [null, null];
        }
    }

    getDateTime(exifData) {
        try {
            if (exifData && exifData.tags && exifData.tags.DateTimeOriginal) {
                const exifDate = new Date(exifData.tags.DateTimeOriginal);
                if (!isNaN(exifDate.getTime())) {
                    return this.formatDate(exifDate);
                }
            }
            return this.formatDate(new Date());
        } catch (error) {
            return this.formatDate(new Date());
        }
    }

    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    async addTextOverlay(imageBuffer, lat, lon, timeStr, action = 'add') {
        try {
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width;
            const height = metadata.height;
            
            let svgRectangles = '';
            let svgText = '';
            
            if (action === 'remove') {
                // DEEP GPS REMOVAL - Multiple rectangles to cover all possible GPS text locations
                const fontSize = this.config.font_size;
                const padding = this.config.padding;
                
                // Rectangle 1: Top-right corner (main GPS location)
                const rect1X = width - (width * 0.5); // 50% from right
                const rect1Y = 0;
                const rect1Width = width * 0.5; // 50% width
                const rect1Height = height * 0.4; // 40% height
                
                // Rectangle 2: Bottom-right corner (some phones put GPS here)
                const rect2X = width - (width * 0.6); // 60% from right
                const rect2Y = height - (height * 0.3); // 30% from bottom
                const rect2Width = width * 0.6; // 60% width
                const rect2Height = height * 0.3; // 30% height
                
                // Rectangle 3: Top-left corner (some phones put date/time here)
                const rect3X = 0;
                const rect3Y = 0;
                const rect3Width = width * 0.4; // 40% width
                const rect3Height = height * 0.3; // 30% height
                
                // Rectangle 4: Bottom-left corner (alternative location)
                const rect4X = 0;
                const rect4Y = height - (height * 0.2); // 20% from bottom
                const rect4Width = width * 0.4; // 40% width
                const rect4Height = height * 0.2; // 20% height
                
                svgRectangles = `
                    <rect x="${rect1X}" y="${rect1Y}" width="${rect1Width}" height="${rect1Height}" fill="black" />
                    <rect x="${rect2X}" y="${rect2Y}" width="${rect2Width}" height="${rect2Height}" fill="black" />
                    <rect x="${rect3X}" y="${rect3Y}" width="${rect3Width}" height="${rect3Height}" fill="black" />
                    <rect x="${rect4X}" y="${rect4Y}" width="${rect4Width}" height="${rect4Height}" fill="black" />
                `;
                
                console.log(`🔥 DEEP GPS REMOVAL - Applied 4 rectangles to cover all possible GPS locations`);
                console.log(`  Rect1: Top-right (${rect1X}, ${rect1Y}, ${rect1Width}x${rect1Height})`);
                console.log(`  Rect2: Bottom-right (${rect2X}, ${rect2Y}, ${rect2Width}x${rect2Height})`);
                console.log(`  Rect3: Top-left (${rect3X}, ${rect3Y}, ${rect3Width}x${rect3Height})`);
                console.log(`  Rect4: Bottom-left (${rect4X}, ${rect4Y}, ${rect4Width}x${rect4Height})`);
                
            } else {
                // Add new GPS text (normal flow)
                let rectX, rectY, rectWidth, rectHeight;
                
                switch (this.config.text_position) {
                    case 'top-right':
                        rectX = width - (width * this.config.rectangle_width_percent);
                        rectY = 0;
                        rectWidth = width * this.config.rectangle_width_percent;
                        rectHeight = height * this.config.rectangle_height_percent;
                        break;
                    case 'bottom-left':
                        rectX = 0;
                        rectY = height - (height * 0.15);
                        rectWidth = width * 0.6;
                        rectHeight = height * 0.15;
                        break;
                    case 'bottom-right':
                        rectX = width - (width * 0.6);
                        rectY = height - (height * 0.15);
                        rectWidth = width * 0.6;
                        rectHeight = height * 0.15;
                        break;
                    case 'top-left':
                        rectX = 0;
                        rectY = 0;
                        rectWidth = width * 0.4;
                        rectHeight = height * 0.15;
                        break;
                    default:
                        rectX = width - (width * this.config.rectangle_width_percent);
                        rectY = 0;
                        rectWidth = width * this.config.rectangle_width_percent;
                        rectHeight = height * this.config.rectangle_height_percent;
                        break;
                }
                
                const textLines = [
                    `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`,
                    `Time: ${timeStr}`
                ];

                const fontSize = this.config.font_size;
                const padding = this.config.padding;
                let textY = rectY + padding + fontSize;

                textLines.forEach((line, index) => {
                    const textX = rectX + padding;
                    svgText += `<text x="${textX}" y="${textY}" fill="${this.config.text_color}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${line}</text>`;
                    textY += fontSize + padding / 2;
                });
                
                svgRectangles = `<rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" fill="black" />`;
            }

            const svg = `
                <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    ${svgRectangles}
                    ${svgText}
                </svg>
            `;

            const overlayBuffer = Buffer.from(svg);
            
            // Also strip EXIF data to remove embedded GPS information
            const processedImage = await image
                .composite([{ input: overlayBuffer, top: 0, left: 0 }])
                .jpeg({ quality: 95, force: true }); // force: true removes EXIF

            return await processedImage.toBuffer();

        } catch (error) {
            throw error;
        }
    }

    async processImage(imageBuffer, filename, action, customGps = null) {
        try {
            const exifData = this.getExifData(imageBuffer);
            const [lat, lon] = this.getGpsCoordinates(exifData);
            const timeStr = this.getDateTime(exifData);

            let finalLat, finalLon;

            if (action === 'add') {
                if (customGps) {
                    finalLat = customGps.latitude;
                    finalLon = customGps.longitude;
                } else if (lat !== null && lon !== null) {
                    finalLat = lat;
                    finalLon = lon;
                } else {
                    finalLat = this.config.fallback_gps.latitude;
                    finalLon = this.config.fallback_gps.longitude;
                }
            } else {
                finalLat = 0;
                finalLon = 0;
            }

            const processedBuffer = await this.addTextOverlay(
                imageBuffer, finalLat, finalLon, timeStr, action
            );

            const outputPath = path.join(outputDir, filename);
            fs.writeFileSync(outputPath, processedBuffer);
            console.log(`💾 Saved: ${filename}`);

            const thumbnailBuffer = await sharp(processedBuffer)
                .resize(200, 200, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toBuffer();
            
            const thumbnailBase64 = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;

            return {
                success: true,
                filename,
                thumbnail: thumbnailBase64,
                status: action === 'add' ? 'Đã thêm GPS' : 'Đã xóa GPS cũ',
                gps: action === 'add' ? { lat: finalLat, lon: finalLon } : null,
                time: timeStr
            };

        } catch (error) {
            return {
                success: false,
                filename,
                error: error.message,
                status: 'Lỗi xử lý'
            };
        }
    }
}

// Store current batch images data
let currentBatchImages = [];

// API endpoint to get current displayed images data
app.get('/api/current-images', (req, res) => {
    try {
        console.log('📱 API: Getting current displayed images data...');
        console.log(`📱 API: Returning ${currentBatchImages.length} images from current batch`);
        
        res.json({
            success: true,
            images: currentBatchImages,
            count: currentBatchImages.length
        });
    } catch (error) {
        console.error('❌ API error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Process images
app.post('/process', upload.array('images'), async (req, res) => {
    try {
        console.log('🚀 Processing request started');
        
        const { action, position, latitude, longitude, fontSize } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Không có file nào được tải lên' 
            });
        }

        // Clean before processing
        cleanOutputDirectory();

        console.log(`📁 Processing ${files.length} images`);

        const config = {
            text_position: action === 'remove' ? 'top-right' : (position || 'bottom-left'),
            font_size: parseInt(fontSize) || 32,
            fallback_gps: {
                latitude: parseFloat(latitude) || 21.0285,
                longitude: parseFloat(longitude) || 105.8542
            }
        };

        const processor = new ImageProcessor(config);
        const results = [];

        for (const file of files) {
            const result = await processor.processImage(
                file.buffer, file.originalname, action,
                action === 'add' ? config.fallback_gps : null
            );
            results.push(result);
        }

        // Store current batch images data for API
        currentBatchImages = results.filter(r => r.success);
        console.log(`📱 Stored ${currentBatchImages.length} images in current batch data`);

        console.log(`✅ Processed ${results.length} images`);

        res.json({
            success: true,
            results: results,
            processed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        });

    } catch (error) {
        console.error('❌ Processing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cell command to collect current displayed images
app.post('/collect-images', async (req, res) => {
    try {
        console.log('📱 CELL COMMAND: Collecting current displayed images...');
        
        if (!fs.existsSync(outputDir)) {
            console.log('❌ Output directory not found');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const files = fs.readdirSync(outputDir).filter(file => 
            file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
        );

        console.log(`📱 CELL: Found ${files.length} current images to collect`);
        files.forEach((file, index) => {
            const filePath = path.join(outputDir, file);
            const stats = fs.statSync(filePath);
            console.log(`  ${index + 1}. ${file} (${stats.size} bytes)`);
        });

        res.json({
            success: true,
            message: `Collected ${files.length} images`,
            images: files,
            count: files.length
        });

    } catch (error) {
        console.error('❌ Cell command error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export ZIP using current displayed images data
app.get('/export', async (req, res) => {
    try {
        console.log('📦 Export request started');
        
        // Use current displayed images data instead of file system
        console.log('📱 Using current displayed images data for ZIP creation...');
        console.log(`📱 Current batch has ${currentBatchImages.length} images`);

        if (currentBatchImages.length === 0) {
            console.log('❌ No current displayed images found');
            return res.status(404).json({ error: 'No processed images found' });
        }

        // Create ZIP from current displayed images data
        const archive = archiver('zip', { zlib: { level: 9 } });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `processed_images_${timestamp}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        console.log(`📦 Creating ZIP from ${currentBatchImages.length} displayed images: ${filename}`);
        
        archive.on('error', (err) => {
            console.error('❌ Archive error:', err);
            throw err;
        });

        archive.on('end', () => {
            console.log(`✅ ZIP created from ${currentBatchImages.length} displayed images, size: ${archive.pointer()} bytes`);
        });

        archive.pipe(res);

        // Add images from current displayed data
        currentBatchImages.forEach((image, index) => {
            const filePath = path.join(outputDir, image.filename);
            console.log(`📎 Adding displayed image to ZIP: ${image.filename}`);
            
            // Check if file exists in output directory
            if (fs.existsSync(filePath)) {
                archive.file(filePath, { name: image.filename });
            } else {
                console.log(`⚠️ File not found in output directory: ${image.filename}`);
            }
        });

        archive.finalize();

    } catch (error) {
        console.error('❌ Export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get processed image
app.get('/output/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(outputDir, filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Clean endpoint
app.post('/clean', (req, res) => {
    try {
        cleanOutputDirectory();
        res.json({ success: true, message: 'Output directory cleaned' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SIMPLE WORKING SERVER running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('🔗 ZIP export: http://localhost:' + PORT + '/export');
});

module.exports = app;
