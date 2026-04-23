const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const archiver = require('archiver');
const cors = require('cors');
const exiftool = require('exiftool-vendored').exiftool;
const Jimp = require('jimp');
const Tesseract = require('tesseract.js');

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

// Store current batch images data
let currentBatchImages = [];

class AdvancedGPSRemover {
    constructor(config = {}) {
        this.config = {
            fallback_gps: { latitude: 21.0285, longitude: 105.8542 },
            text_position: 'bottom-left',
            rectangle_color: 'black',
            text_color: 'white',
            font_size: 32,
            padding: 20,
            rectangle_height_percent: 0.3,
            rectangle_width_percent: 0.4,
            ...config
        };
    }

    // Advanced EXIF data removal using exiftool
    async removeEXIFData(imageBuffer) {
        try {
            console.log('🔧 Using exiftool to remove ALL EXIF data...');
            
            // Write buffer to temp file
            const tempInputPath = path.join(__dirname, 'temp_input.jpg');
            const tempOutputPath = path.join(__dirname, 'temp_output.jpg');
            
            fs.writeFileSync(tempInputPath, imageBuffer);
            
            // Use exiftool to strip ALL metadata
            await exiftool.write(tempInputPath, {
                all: '', // Remove all tags
                'exif:all': '', // Remove EXIF
                'xmp:all': '', // Remove XMP
                'iptc:all': '', // Remove IPTC
                'icc:all': '', // Remove ICC profile
            }, tempOutputPath);
            
            // Read the cleaned image
            const cleanedBuffer = fs.readFileSync(tempOutputPath);
            
            // Clean up temp files
            fs.unlinkSync(tempInputPath);
            fs.unlinkSync(tempOutputPath);
            
            console.log('✅ EXIF data completely removed with exiftool');
            return cleanedBuffer;
            
        } catch (error) {
            console.error('❌ Error with exiftool:', error);
            // Fallback to Sharp
            return await sharp(imageBuffer).jpeg({ quality: 95, force: true }).toBuffer();
        }
    }

    // OCR-based text detection to find GPS text
    async detectTextRegions(imageBuffer) {
        try {
            console.log('🔍 Using OCR to detect GPS text regions...');
            
            // Convert image to format suitable for OCR
            const image = await Jimp.read(imageBuffer);
            
            // Use Tesseract to detect text
            const { data: { words } } = await Tesseract.recognize(imageBuffer, 'eng', {
                tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
                tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS'
            });
            
            console.log(`🔍 OCR detected ${words.length} text regions`);
            
            // Filter for GPS-related text
            const gpsTextRegions = words.filter(word => {
                const text = word.text.toLowerCase();
                return text.includes('lat') || text.includes('lon') || 
                       text.includes('gps') || text.includes('time') ||
                       text.includes('date') || text.includes('°') ||
                       text.match(/\d+\.\d+,\s*\d+\.\d+/) || // GPS coordinates
                       text.match(/\d{4}-\d{2}-\d{2}/) || // Date format
                       text.match(/\d{2}:\d{2}:\d{2}/); // Time format
            });
            
            console.log(`🔍 Found ${gpsTextRegions.length} GPS-related text regions`);
            
            return gpsTextRegions.map(region => ({
                x: region.bbox.x0,
                y: region.bbox.y0,
                width: region.bbox.x1 - region.bbox.x0,
                height: region.bbox.y1 - region.bbox.y0,
                text: region.text
            }));
            
        } catch (error) {
            console.error('❌ OCR detection failed:', error);
            return [];
        }
    }

    // Advanced inpainting to remove detected text regions
    async removeTextRegions(imageBuffer, textRegions) {
        try {
            console.log('🎨 Using advanced inpainting to remove text regions...');
            
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            
            // Create mask for text regions
            const mask = new Jimp(width, height, 0x00000000); // Transparent mask
            
            // Add padding to text regions for better coverage
            const padding = 10;
            textRegions.forEach(region => {
                const paddedX = Math.max(0, region.x - padding);
                const paddedY = Math.max(0, region.y - padding);
                const paddedWidth = Math.min(width - paddedX, region.width + padding * 2);
                const paddedHeight = Math.min(height - paddedY, region.height + padding * 2);
                
                // Draw white rectangle on mask for text region
                for (let y = paddedY; y < paddedY + paddedHeight; y++) {
                    for (let x = paddedX; x < paddedX + paddedWidth; x++) {
                        mask.setPixelColor(0xFFFFFFFF, x, y);
                    }
                }
            });
            
            // Apply inpainting (simplified version - in production you'd use OpenCV)
            // For now, we'll use content-aware fill approximation
            for (const region of textRegions) {
                const paddedX = Math.max(0, region.x - padding);
                const paddedY = Math.max(0, region.y - padding);
                const paddedWidth = Math.min(width - paddedX, region.width + padding * 2);
                const paddedHeight = Math.min(height - paddedY, region.height + padding * 2);
                
                // Sample surrounding pixels and fill the region
                for (let y = paddedY; y < paddedY + paddedHeight; y++) {
                    for (let x = paddedX; x < paddedX + paddedWidth; x++) {
                        // Simple inpainting: use average of surrounding pixels
                        const surroundingColors = [];
                        
                        // Sample from 8 directions
                        const directions = [
                            [-1, -1], [0, -1], [1, -1],
                            [-1, 0],           [1, 0],
                            [-1, 1],  [0, 1],  [1, 1]
                        ];
                        
                        for (const [dx, dy] of directions) {
                            const sampleX = x + dx * 5;
                            const sampleY = y + dy * 5;
                            
                            if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height) {
                                const color = Jimp.intToRGBA(image.getPixelColor(sampleX, sampleY));
                                surroundingColors.push(color);
                            }
                        }
                        
                        if (surroundingColors.length > 0) {
                            // Average the colors
                            const avgColor = surroundingColors.reduce((acc, color) => ({
                                r: acc.r + color.r / surroundingColors.length,
                                g: acc.g + color.g / surroundingColors.length,
                                b: acc.b + color.b / surroundingColors.length,
                                a: 255
                            }), { r: 0, g: 0, b: 0, a: 255 });
                            
                            const avgInt = Jimp.rgbaToInt(avgColor.r, avgColor.g, avgColor.b, avgColor.a);
                            image.setPixelColor(avgInt, x, y);
                        }
                    }
                }
            }
            
            console.log('✅ Advanced inpainting completed');
            return await image.getBufferAsync(Jimp.MIME_JPEG);
            
        } catch (error) {
            console.error('❌ Advanced inpainting failed:', error);
            return imageBuffer;
        }
    }

    async addTextOverlay(imageBuffer, lat, lon, timeStr, action = 'add') {
        try {
            let processedBuffer = imageBuffer;
            
            if (action === 'remove') {
                console.log('🔥 ADVANCED GPS REMOVAL - Using professional tools...');
                
                // Step 1: Remove EXIF data with exiftool
                processedBuffer = await this.removeEXIFData(processedBuffer);
                
                // Step 2: Detect text regions with OCR
                const textRegions = await this.detectTextRegions(processedBuffer);
                
                if (textRegions.length > 0) {
                    console.log(`🎨 Found ${textRegions.length} text regions to remove`);
                    textRegions.forEach((region, index) => {
                        console.log(`  ${index + 1}. "${region.text}" at (${region.x}, ${region.y})`);
                    });
                    
                    // Step 3: Remove text with advanced inpainting
                    processedBuffer = await this.removeTextRegions(processedBuffer, textRegions);
                } else {
                    console.log('⚠️ No GPS text detected with OCR, using fallback coverage');
                    
                    // Fallback: Use multiple rectangles as backup
                    const image = sharp(processedBuffer);
                    const metadata = await image.metadata();
                    const width = metadata.width;
                    const height = metadata.height;
                    
                    // Create comprehensive coverage
                    const svgRectangles = `
                        <rect x="${width - (width * 0.6)}" y="0" width="${width * 0.6}" height="${height * 0.4}" fill="black" />
                        <rect x="${width - (width * 0.7)}" y="${height - (height * 0.3)}" width="${width * 0.7}" height="${height * 0.3}" fill="black" />
                        <rect x="0" y="0" width="${width * 0.4}" height="${height * 0.3}" fill="black" />
                        <rect x="0" y="${height - (height * 0.2)}" width="${width * 0.4}" height="${height * 0.2}" fill="black" />
                    `;
                    
                    const svg = `
                        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                            ${svgRectangles}
                        </svg>
                    `;
                    
                    const overlayBuffer = Buffer.from(svg);
                    processedBuffer = await image
                        .composite([{ input: overlayBuffer, top: 0, left: 0 }])
                        .jpeg({ quality: 95, force: true })
                        .toBuffer();
                }
                
                console.log('✅ Advanced GPS removal completed');
                
            } else {
                // Add new GPS text (normal flow)
                const image = sharp(processedBuffer);
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

                let svgText = '';
                const fontSize = this.config.font_size;
                const padding = this.config.padding;
                let textY = rectY + padding + fontSize;

                textLines.forEach((line, index) => {
                    const textX = rectX + padding;
                    svgText += `<text x="${textX}" y="${textY}" fill="${this.config.text_color}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${line}</text>`;
                    textY += fontSize + padding / 2;
                });
                
                const svgRectangles = `<rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" fill="black" />`;
                
                const svg = `
                    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                        ${svgRectangles}
                        ${svgText}
                    </svg>
                `;

                const overlayBuffer = Buffer.from(svg);
                processedBuffer = await image
                    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
                    .jpeg({ quality: 95 })
                    .toBuffer();
            }

            return processedBuffer;

        } catch (error) {
            console.error('❌ Error in advanced processing:', error);
            throw error;
        }
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
                status: action === 'add' ? 'Đã thêm GPS' : 'Đã xóa GPS cũ (Advanced)',
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
        console.log('🚀 ADVANCED Processing request started');
        
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

        console.log(`📁 Processing ${files.length} images with ADVANCED tools`);

        const config = {
            text_position: action === 'remove' ? 'top-right' : (position || 'bottom-left'),
            font_size: parseInt(fontSize) || 32,
            fallback_gps: {
                latitude: parseFloat(latitude) || 21.0285,
                longitude: parseFloat(longitude) || 105.8542
            }
        };

        const processor = new AdvancedGPSRemover(config);
        const results = [];

        for (const file of files) {
            console.log(`\n🔄 Advanced processing: ${file.originalname}`);
            const result = await processor.processImage(
                file.buffer, file.originalname, action,
                action === 'add' ? config.fallback_gps : null
            );
            results.push(result);
            console.log(`✅ Advanced completed: ${file.originalname} - ${result.status}`);
        }

        // Store current batch images data for API
        currentBatchImages = results.filter(r => r.success);
        console.log(`📱 Stored ${currentBatchImages.length} images in current batch data`);

        console.log(`✅ Advanced processed ${results.length} images`);

        res.json({
            success: true,
            results: results,
            processed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        });

    } catch (error) {
        console.error('❌ Advanced processing error:', error);
        res.status(500).json({ success: false, error: error.message });
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
        currentBatchImages = [];
        res.json({ success: true, message: 'Output directory cleaned' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀🚀🚀 ADVANCED GPS REMOVER SERVER running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('🔗 ZIP export: http://localhost:' + PORT + '/export');
    console.log('🔧🔧🔧 PROFESSIONAL TOOLS ENABLED 🔧🔧🔧');
    console.log('📦 ZIP: Images only, no JSON');
    console.log('🎨 OCR: Tesseract.js for text detection');
    console.log('🔧 EXIF: ExifTool for complete metadata removal');
    console.log('🖼️ Image: Jimp for advanced processing');
});

module.exports = app;
