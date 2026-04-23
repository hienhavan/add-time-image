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

// BRUTAL FORCE CLEAN - delete everything with retry
function brutalForceCleanOutputDirectory() {
    try {
        console.log('🔥🔥🔥 BRUTAL FORCE CLEANING OUTPUT DIRECTORY...');
        
        if (fs.existsSync(outputDir)) {
            // Read all files
            const files = fs.readdirSync(outputDir);
            console.log(`📁 Found ${files.length} files to delete:`, files);
            
            // Delete each file with retry
            files.forEach((file, index) => {
                const filePath = path.join(outputDir, file);
                let attempts = 0;
                const maxAttempts = 3;
                
                while (attempts < maxAttempts) {
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`✅ ${index + 1}. DELETED: ${file}`);
                        break; // Success, exit retry loop
                    } catch (err) {
                        attempts++;
                        console.error(`❌ Attempt ${attempts} deleting ${file}:`, err.message);
                        if (attempts >= maxAttempts) {
                            console.error(`💀 FAILED to delete ${file} after ${maxAttempts} attempts`);
                        } else {
                            // Wait a bit before retry
                            require('child_process').execSync('timeout /t 1 > nul');
                        }
                    }
                }
            });
            
            // Verify directory is empty
            let remainingFiles = [];
            attempts = 0;
            while (attempts < 5) {
                remainingFiles = fs.readdirSync(outputDir);
                if (remainingFiles.length === 0) break;
                attempts++;
                require('child_process').execSync('timeout /t 1 > nul');
            }
            
            console.log(`📊 Remaining files after cleaning: ${remainingFiles.length}`);
            console.log('📋 Remaining file list:', remainingFiles);
            
            if (remainingFiles.length === 0) {
                console.log('🧹🧹🧹 OUTPUT DIRECTORY COMPLETELY CLEANED! 🧹🧹🧹');
            } else {
                console.log('⚠️⚠️⚠️ Some files still remain:', remainingFiles);
                // Try one more time with different approach
                remainingFiles.forEach(file => {
                    try {
                        const filePath = path.join(outputDir, file);
                        fs.writeFileSync(filePath, ''); // Truncate file first
                        fs.unlinkSync(filePath); // Then delete
                        console.log(`🔥 FINAL DELETE: ${file}`);
                    } catch (err) {
                        console.error(`💀 FINAL FAILED: ${file}:`, err.message);
                    }
                });
            }
        } else {
            console.log('📁 Output directory does not exist, creating...');
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
    } catch (error) {
        console.error('❌ ERROR in brutal force cleaning:', error);
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
            font_size: 32, // Much larger font
            padding: 20,   // More padding
            rectangle_height_percent: 0.3, // 30% of image height
            rectangle_width_percent: 0.4,  // 40% of image width for top-right
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
            
            // Calculate rectangle dimensions based on position
            let rectX, rectY, rectWidth, rectHeight;
            
            switch (this.config.text_position) {
                case 'top-left':
                    rectX = 0;
                    rectY = 0;
                    rectWidth = width * this.config.rectangle_width_percent;
                    rectHeight = height * this.config.rectangle_height_percent;
                    break;
                case 'top-right':
                    rectX = width - (width * this.config.rectangle_width_percent);
                    rectY = 0;
                    rectWidth = width * this.config.rectangle_width_percent;
                    rectHeight = height * this.config.rectangle_height_percent;
                    break;
                case 'bottom-left':
                    rectX = 0;
                    rectY = height - (height * this.config.rectangle_height_percent);
                    rectWidth = width * this.config.rectangle_width_percent;
                    rectHeight = height * this.config.rectangle_height_percent;
                    break;
                case 'bottom-right':
                    rectX = width - (width * this.config.rectangle_width_percent);
                    rectY = height - (height * this.config.rectangle_height_percent);
                    rectWidth = width * this.config.rectangle_width_percent;
                    rectHeight = height * this.config.rectangle_height_percent;
                    break;
                default:
                    // Default to top-right for GPS text removal
                    rectX = width - (width * this.config.rectangle_width_percent);
                    rectY = 0;
                    rectWidth = width * this.config.rectangle_width_percent;
                    rectHeight = height * this.config.rectangle_height_percent;
                    break;
            }

            console.log(`📐 Rectangle: X=${rectX}, Y=${rectY}, W=${rectWidth}, H=${rectHeight}`);

            // Create text lines
            const textLines = action === 'add' ? [
                `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`,
                `Time: ${timeStr}`
            ] : [];

            let svgText = '';
            const fontSize = this.config.font_size;
            const padding = this.config.padding;
            let textY = rectY + padding + fontSize;

            // Calculate text position
            const getTextX = (textWidth) => {
                switch (this.config.text_position) {
                    case 'top-left':
                    case 'bottom-left':
                        return rectX + padding;
                    case 'top-right':
                    case 'bottom-right':
                        return rectX + padding;
                    default:
                        return rectX + padding;
                }
            };

            textLines.forEach((line, index) => {
                const textX = getTextX(line.length * fontSize * 0.6);
                svgText += `<text x="${textX}" y="${textY}" fill="${this.config.text_color}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${line}</text>`;
                textY += fontSize + padding / 2;
            });

            // Create SVG for overlay with large black rectangle
            const svg = `
                <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    <rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" fill="black" />
                    ${svgText}
                </svg>
            `;

            console.log(`🎨 Creating overlay with ${textLines.length} text lines`);

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
                // Use custom GPS if provided, otherwise use EXIF or fallback
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
                // Remove action - only cover with rectangle, no text
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

            // Save processed image
            const outputPath = path.join(outputDir, filename);
            fs.writeFileSync(outputPath, processedBuffer);
            console.log(`💾 Saved: ${filename}`);

            // Generate thumbnail for UI
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
        const { action, position, latitude, longitude, fontSize } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Không có file nào được tải lên' 
            });
        }

        // BRUTAL FORCE CLEAN output directory BEFORE processing
        brutalForceCleanOutputDirectory();

        console.log(`📁 Processing ${files.length} new images with action: ${action}`);

        // Configure processor - use top-right for GPS removal
        const config = {
            text_position: action === 'remove' ? 'top-right' : (position || 'bottom-left'),
            font_size: parseInt(fontSize) || 32,
            fallback_gps: {
                latitude: parseFloat(latitude) || 21.0285,
                longitude: parseFloat(longitude) || 105.8542
            }
        };

        console.log(`⚙️ Config: position=${config.text_position}, font_size=${config.font_size}`);

        const processor = new ImageProcessor(config);
        const results = [];

        // Process each image
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

        // Final verification
        const finalFiles = fs.readdirSync(outputDir);
        console.log(`📊 FINAL OUTPUT: ${finalFiles.length} files:`, finalFiles);

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
        console.log('=== 📦 ZIP EXPORT REQUEST ===');
        
        if (!fs.existsSync(outputDir)) {
            console.log('ERROR: Output directory does not exist');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const allFiles = fs.readdirSync(outputDir);
        console.log('📁 Files in output directory:', allFiles.length);
        console.log('📋 File list:', allFiles);
        
        const files = allFiles.filter(file => 
            file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
        );

        console.log('🖼️ Image files to zip:', files.length);

        if (files.length === 0) {
            console.log('ERROR: No image files found');
            return res.status(404).json({ error: 'No processed images found' });
        }

        // Create ZIP archive
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        // Set response headers
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `processed_images_${timestamp}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        console.log('📦 Creating ZIP archive:', filename);
        
        // Handle archive errors
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            throw err;
        });

        archive.on('end', () => {
            console.log('✅ Archive created successfully, size:', archive.pointer());
        });

        // Pipe archive to response
        archive.pipe(res);

        // Add files to archive
        files.forEach(file => {
            const filePath = path.join(outputDir, file);
            console.log('📎 Adding file to archive:', file);
            archive.file(filePath, { name: file });
        });

        // Add processing log
        const logData = {
            exportTime: new Date().toISOString(),
            totalImages: files.length,
            imageList: files,
            processingSettings: {
                rectangle_height_percent: 0.3,
                rectangle_width_percent: 0.4,
                font_size: 32,
                position: 'top-right for GPS removal',
                coverage: 'Enhanced to completely hide old GPS text',
                cleaning: 'Brutal force cleaning enabled'
            }
        };
        
        archive.append(JSON.stringify(logData, null, 2), { name: 'processing_log.json' });

        // Finalize archive
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

// Clean output directory
app.post('/clean', (req, res) => {
    try {
        brutalForceCleanOutputDirectory();
        res.json({ success: true, message: 'Output directory brutally cleaned' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀🚀🚀 FINAL FIXED SERVER running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('🔗 Test ZIP export: http://localhost:' + PORT + '/export');
    console.log('🔥🔥🔥 BRUTAL FORCE CLEANING ENABLED - All old files deleted with retry');
    console.log('📐 GPS TEXT REMOVAL: Top-right corner, 30% height, 40% width');
});

module.exports = app;
