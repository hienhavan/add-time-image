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

// Enable CORS for all routes
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true
}));

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Configure multer for file uploads
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
        fileSize: 50 * 1024 * 1024, // 50MB max file size
        files: 100 // Max 100 files
    }
});

// SIMPLE CLEAN - just delete everything
function simpleCleanOutputDirectory() {
    console.log('🧹 SIMPLE CLEAN: Deleting all files in output directory...');
    
    try {
        if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir);
            console.log(`Found ${files.length} files to delete`);
            
            files.forEach(file => {
                const filePath = path.join(outputDir, file);
                try {
                    fs.unlinkSync(filePath);
                    console.log(`✅ Deleted: ${file}`);
                } catch (err) {
                    console.error(`❌ Failed to delete ${file}:`, err.message);
                }
            });
            
            console.log('🧹 Clean completed');
        }
    } catch (error) {
        console.error('Error in simple clean:', error);
    }
}

class ImageProcessor {
    constructor(config = {}) {
        this.config = {
            fallback_gps: {
                latitude: 21.0285,
                longitude: 105.8542
            },
            text_position: 'top-right', // GPS text is in top-right corner
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
            console.error(`Error reading EXIF: ${error.message}`);
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
            console.error(`Error parsing GPS data: ${error.message}`);
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
            console.error(`Error getting datetime: ${error.message}`);
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
            
            let rectX, rectY, rectWidth, rectHeight;
            
            switch (this.config.text_position) {
                case 'top-right':
                    rectX = width - (width * this.config.rectangle_width_percent);
                    rectY = 0;
                    rectWidth = width * this.config.rectangle_width_percent;
                    rectHeight = height * this.config.rectangle_height_percent;
                    break;
                default:
                    rectX = width - (width * this.config.rectangle_width_percent);
                    rectY = 0;
                    rectWidth = width * this.config.rectangle_width_percent;
                    rectHeight = height * this.config.rectangle_height_percent;
                    break;
            }

            const textLines = action === 'add' ? [
                `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`,
                `Time: ${timeStr}`
            ] : [];

            let svgText = '';
            const fontSize = this.config.font_size;
            const padding = this.config.padding;
            let textY = rectY + padding + fontSize;

            textLines.forEach((line, index) => {
                const textX = rectX + padding;
                svgText += `<text x="${textX}" y="${textY}" fill="${this.config.text_color}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${line}</text>`;
                textY += fontSize + padding / 2;
            });

            const svg = `
                <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    <rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" fill="black" />
                    ${svgText}
                </svg>
            `;

            const overlayBuffer = Buffer.from(svg);
            
            return await image
                .composite([{ input: overlayBuffer, top: 0, left: 0 }])
                .jpeg({ quality: 95 })
                .toBuffer();

        } catch (error) {
            console.error(`Error adding text overlay: ${error.message}`);
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
                imageBuffer, 
                finalLat, 
                finalLon, 
                timeStr, 
                action
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
                outputPath,
                thumbnail: thumbnailBase64,
                status: action === 'add' ? 'Đã thêm GPS' : 'Đã xóa GPS cũ',
                gps: action === 'add' ? { lat: finalLat, lon: finalLon } : null,
                time: timeStr
            };

        } catch (error) {
            console.error(`Error processing ${filename}: ${error.message}`);
            return {
                success: false,
                filename,
                error: error.message,
                status: 'Lỗi xử lý'
            };
        }
    }
}

// Process images endpoint
app.post('/process', upload.array('images'), async (req, res) => {
    try {
        console.log('=== NEW PROCESSING REQUEST ===');
        
        const { action, position, latitude, longitude, fontSize } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Không có file nào được tải lên' 
            });
        }

        // CLEAN FIRST - before anything else
        console.log('🧹 Cleaning output directory BEFORE processing...');
        simpleCleanOutputDirectory();

        console.log(`📁 Processing ${files.length} new images with action: ${action}`);

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
                file.buffer, 
                file.originalname, 
                action,
                action === 'add' ? config.fallback_gps : null
            );
            results.push(result);
            console.log(`✅ Processed: ${file.originalname} - ${result.status}`);
        }

        // Check final state
        const finalFiles = fs.readdirSync(outputDir);
        console.log(`📊 FINAL FILES IN OUTPUT: ${finalFiles.length}`);
        finalFiles.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file}`);
        });

        res.json({
            success: true,
            results: results,
            processed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        });

    } catch (error) {
        console.error('Processing error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Export processed images as ZIP
app.get('/export', async (req, res) => {
    try {
        console.log('=== ZIP EXPORT REQUEST ===');
        
        if (!fs.existsSync(outputDir)) {
            console.log('ERROR: Output directory does not exist');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const allFiles = fs.readdirSync(outputDir);
        console.log(`📁 All files in output directory: ${allFiles.length}`);
        allFiles.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file}`);
        });
        
        const files = allFiles.filter(file => 
            file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
        );

        console.log(`🖼️ Image files to zip: ${files.length}`);

        if (files.length === 0) {
            console.log('ERROR: No image files found');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const archive = archiver('zip', { zlib: { level: 9 } });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `processed_images_${timestamp}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        console.log(`📦 Creating ZIP: ${filename}`);
        
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            throw err;
        });

        archive.on('end', () => {
            console.log(`✅ ZIP created, size: ${archive.pointer()} bytes`);
        });

        archive.pipe(res);

        files.forEach(file => {
            const filePath = path.join(outputDir, file);
            console.log(`📎 Adding to ZIP: ${file}`);
            archive.file(filePath, { name: file });
        });

        archive.finalize();

    } catch (error) {
        console.error('Export error:', error);
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
        simpleCleanOutputDirectory();
        res.json({ success: true, message: 'Output directory cleaned' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SIMPLE CLEAN SERVER running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('🔗 ZIP export: http://localhost:' + PORT + '/export');
    console.log('🧹 SIMPLE CLEANING: Delete all files before each batch');
    console.log('📦 ZIP: Images only, no JSON');
});

module.exports = app;
