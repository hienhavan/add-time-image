const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const archiver = require('archiver');
const cors = require('cors');
const crypto = require('crypto');

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

// Create unique folder for each batch
function createUniqueBatchFolder() {
    const batchId = crypto.randomBytes(8).toString('hex');
    const batchDir = path.join(__dirname, 'output', batchId);
    
    if (!fs.existsSync(path.join(__dirname, 'output'))) {
        fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
    }
    
    fs.mkdirSync(batchDir, { recursive: true });
    
    console.log(`🆔 Created unique batch folder: ${batchId}`);
    console.log(`📁 Batch directory: ${batchDir}`);
    
    return { batchId, batchDir };
}

class ImageProcessor {
    constructor(config = {}) {
        this.config = {
            fallback_gps: {
                latitude: 21.0285,
                longitude: 105.8542
            },
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

    async processImage(imageBuffer, filename, action, customGps = null, batchDir) {
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

            // Save to unique batch folder
            const outputPath = path.join(batchDir, filename);
            fs.writeFileSync(outputPath, processedBuffer);
            console.log(`💾 Saved to batch folder: ${filename}`);

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

// Store current batch info
let currentBatch = null;

// Process images endpoint
app.post('/process', upload.array('images'), async (req, res) => {
    try {
        console.log('\n🆕🆕🆕 NEW BATCH PROCESSING STARTED 🆕🆕🆕');
        console.log(`Request time: ${new Date().toISOString()}`);
        
        const { action, position, latitude, longitude, fontSize } = req.body;
        const files = req.files;

        console.log(`📋 Request details:`);
        console.log(`  Action: ${action}`);
        console.log(`  Files count: ${files ? files.length : 0}`);
        if (files) {
            files.forEach((file, index) => {
                console.log(`  ${index + 1}. ${file.originalname} (${file.size} bytes)`);
            });
        }

        if (!files || files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Không có file nào được tải lên' 
            });
        }

        // Create unique folder for this batch
        const { batchId, batchDir } = createUniqueBatchFolder();
        currentBatch = { batchId, batchDir };

        console.log(`\n📁📁📁 PROCESSING ${files.length} NEW IMAGES IN BATCH ${batchId} 📁📁📁`);

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
            console.log(`\n🔄 Processing: ${file.originalname}`);
            const result = await processor.processImage(
                file.buffer, 
                file.originalname, 
                action,
                action === 'add' ? config.fallback_gps : null,
                batchDir
            );
            results.push(result);
            console.log(`✅ Completed: ${file.originalname} - ${result.status}`);
        }

        // Verify batch contents
        console.log('\n📊📊📊 BATCH VERIFICATION 📊📊📊');
        const batchFiles = fs.readdirSync(batchDir);
        console.log(`📁 Files in batch ${batchId}: ${batchFiles.length}`);
        batchFiles.forEach((file, index) => {
            const filePath = path.join(batchDir, file);
            const stats = fs.statSync(filePath);
            console.log(`  ${index + 1}. ${file} (${stats.size} bytes)`);
        });

        const response = {
            success: true,
            results: results,
            processed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            batchId: batchId
        };

        console.log(`\n📤 Sending response for batch ${batchId}`);
        console.log('🆕🆕🆕 BATCH PROCESSING COMPLETED 🆕🆕🆕\n');

        res.json(response);

    } catch (error) {
        console.error('❌ Processing error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Export processed images as ZIP - from current batch only
app.get('/export', async (req, res) => {
    try {
        console.log('\n📦📦📦 ZIP EXPORT REQUEST 📦📦📦');
        console.log(`Export time: ${new Date().toISOString()}`);
        
        if (!currentBatch) {
            console.log('❌ ERROR: No current batch found');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const { batchId, batchDir } = currentBatch;
        console.log(`📁 Exporting from batch: ${batchId}`);
        console.log(`📂 Batch directory: ${batchDir}`);

        if (!fs.existsSync(batchDir)) {
            console.log('❌ ERROR: Batch directory does not exist');
            return res.status(404).json({ error: 'Batch directory not found' });
        }

        const allFiles = fs.readdirSync(batchDir);
        console.log(`📁 Files in batch directory: ${allFiles.length}`);
        allFiles.forEach((file, index) => {
            const filePath = path.join(batchDir, file);
            const stats = fs.statSync(filePath);
            console.log(`  ${index + 1}. ${file} (${stats.size} bytes)`);
        });
        
        const files = allFiles.filter(file => 
            file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
        );

        console.log(`🖼️ Image files to zip: ${files.length}`);
        files.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file}`);
        });

        if (files.length === 0) {
            console.log('❌ ERROR: No image files found');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const archive = archiver('zip', { zlib: { level: 9 } });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `batch_${batchId}_images.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        console.log(`📦 Creating ZIP: ${filename}`);
        
        archive.on('error', (err) => {
            console.error('❌ Archive error:', err);
            throw err;
        });

        archive.on('end', () => {
            console.log(`✅ ZIP created successfully, size: ${archive.pointer()} bytes`);
            console.log('📦📦📦 ZIP EXPORT COMPLETED 📦📦📦\n');
        });

        archive.pipe(res);

        files.forEach((file, index) => {
            const filePath = path.join(batchDir, file);
            console.log(`📎 ${index + 1}. Adding to ZIP: ${file}`);
            archive.file(filePath, { name: file });
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
    
    if (!currentBatch) {
        return res.status(404).json({ error: 'No current batch' });
    }
    
    const filePath = path.join(currentBatch.batchDir, filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Clean endpoint
app.post('/clean', (req, res) => {
    try {
        console.log('\n🧹 Manual clean requested');
        
        // Clean all batch folders
        const outputDir = path.join(__dirname, 'output');
        if (fs.existsSync(outputDir)) {
            const batches = fs.readdirSync(outputDir);
            batches.forEach(batch => {
                const batchPath = path.join(outputDir, batch);
                if (fs.statSync(batchPath).isDirectory()) {
                    const files = fs.readdirSync(batchPath);
                    files.forEach(file => {
                        fs.unlinkSync(path.join(batchPath, file));
                    });
                    fs.rmdirSync(batchPath);
                    console.log(`🗑️ Deleted batch folder: ${batch}`);
                }
            });
        }
        
        currentBatch = null;
        res.json({ success: true, message: 'All batches cleaned' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀🚀🚀 UNIQUE FOLDER SERVER running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${path.join(__dirname, 'output')}`);
    console.log('🔗 ZIP export: http://localhost:' + PORT + '/export');
    console.log('🆕🆕🆕 UNIQUE FOLDER PER BATCH - NO CACHING 🆕🆕🆕');
    console.log('📦 ZIP: Images only, no JSON');
});

module.exports = app;
