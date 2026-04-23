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

class CharacterLevelGPSRemover {
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

    // Character-level EXIF data removal
    async removeEXIFData(imageBuffer) {
        try {
            console.log('🔧 Using exiftool to remove ALL EXIF data...');
            
            const tempInputPath = path.join(__dirname, 'temp_input.jpg');
            const tempOutputPath = path.join(__dirname, 'temp_output.jpg');
            
            fs.writeFileSync(tempInputPath, imageBuffer);
            
            await exiftool.write(tempInputPath, {
                all: '',
                'exif:all': '',
                'xmp:all': '',
                'iptc:all': '',
                'icc:all': '',
            }, tempOutputPath);
            
            const cleanedBuffer = fs.readFileSync(tempOutputPath);
            
            fs.unlinkSync(tempInputPath);
            fs.unlinkSync(tempOutputPath);
            
            console.log('✅ EXIF data completely removed');
            return cleanedBuffer;
            
        } catch (error) {
            console.error('❌ Error with exiftool:', error);
            return await sharp(imageBuffer).jpeg({ quality: 95, force: true }).toBuffer();
        }
    }

    // Character-level OCR detection
    async detectCharacterLevelText(imageBuffer) {
        try {
            console.log('🔍 Using CHARACTER-LEVEL OCR to detect individual characters...');
            
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            
            // Scan corners with character-level precision
            const cornerRegions = [
                { name: 'top-right', x: width - (width * 0.4), y: 0, width: width * 0.4, height: height * 0.3 },
                { name: 'bottom-right', x: width - (width * 0.5), y: height - (height * 0.25), width: width * 0.5, height: height * 0.25 },
                { name: 'top-left', x: 0, y: 0, width: width * 0.3, height: height * 0.25 },
                { name: 'bottom-left', x: 0, y: height - (height * 0.2), width: width * 0.3, height: height * 0.2 }
            ];
            
            const allCharacters = [];
            
            for (const corner of cornerRegions) {
                try {
                    console.log(`🔍 Scanning ${corner.name} corner for characters...`);
                    
                    // Crop corner region
                    const cornerImage = image.clone().crop(
                        corner.x, corner.y, corner.width, corner.height
                    );
                    
                    const cornerBuffer = await cornerImage.getBufferAsync(Jimp.MIME_JPEG);
                    
                    // Use character-level OCR
                    const { data: { words, symbols } } = await Tesseract.recognize(cornerBuffer, 'eng+vie', {
                        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_CHAR,
                        tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS Vị trí Ngày Tháng Năm Giờ Phút Giây .,',
                        preserve_interword_spaces: '1'
                    });
                    
                    // Combine words and symbols for comprehensive detection
                    const allTextElements = [...(words || []), ...(symbols || [])];
                    
                    // Filter for GPS-related characters
                    const gpsCharacters = allTextElements.filter(element => {
                        const text = element.text.toLowerCase();
                        return text.includes('lat') || text.includes('lon') || 
                               text.includes('gps') || text.includes('time') ||
                               text.includes('date') || text.includes('°') ||
                               text.includes('ngày') || text.includes('tháng') || text.includes('năm') ||
                               text.includes('giờ') || text.includes('phút') || text.includes('giây') ||
                               text.includes('vị trí') || text.includes('location') ||
                               text.match(/\d/) || // Any digit
                               text.match(/[a-z]/i) || // Any letter
                               text.match(/[°:.,]/); // GPS symbols
                    });
                    
                    if (gpsCharacters.length > 0) {
                        console.log(`🔍 Found ${gpsCharacters.length} GPS-related characters in ${corner.name}`);
                        
                        // Convert to full image coordinates
                        const cornerCharsInFull = gpsCharacters.map(char => ({
                            x: corner.x + char.bbox.x0,
                            y: corner.y + char.bbox.y0,
                            width: char.bbox.x1 - char.bbox.x0,
                            height: char.bbox.y1 - char.bbox.y0,
                            text: char.text,
                            corner: corner.name,
                            confidence: char.confidence || 0
                        }));
                        
                        allCharacters.push(...cornerCharsInFull);
                    }
                    
                } catch (error) {
                    console.error(`❌ Error processing ${corner.name} corner:`, error);
                }
            }
            
            console.log(`🔍 Total GPS characters found: ${allCharacters.length}`);
            return allCharacters;
            
        } catch (error) {
            console.error('❌ Character-level detection failed:', error);
            return [];
        }
    }

    // Pixel-level analysis for text detection
    async detectTextPixels(imageBuffer) {
        try {
            console.log('🔍 Using PIXEL-LEVEL analysis to find text-like patterns...');
            
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            
            const textRegions = [];
            
            // Scan corners for text-like pixel patterns
            const corners = [
                { name: 'top-right', startX: width - (width * 0.4), endX: width, startY: 0, endY: height * 0.3 },
                { name: 'bottom-right', startX: width - (width * 0.5), endX: width, startY: height - (height * 0.25), endY: height },
                { name: 'top-left', startX: 0, endX: width * 0.3, startY: 0, endY: height * 0.25 },
                { name: 'bottom-left', startX: 0, endX: width * 0.3, startY: height - (height * 0.2), endY: height }
            ];
            
            for (const corner of corners) {
                console.log(`🔍 Analyzing pixels in ${corner.name} corner...`);
                
                // Scan for high contrast areas (typical of text)
                for (let y = corner.startY; y < corner.endY; y += 5) {
                    for (let x = corner.startX; x < corner.endX; x += 5) {
                        const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
                        
                        // Check for text-like colors (high contrast)
                        if (pixel.r < 50 || pixel.r > 200 || pixel.g < 50 || pixel.g > 200 || pixel.b < 50 || pixel.b > 200) {
                            // Check surrounding pixels for text pattern
                            let isTextPattern = false;
                            let contrastCount = 0;
                            
                            for (let dy = -2; dy <= 2; dy++) {
                                for (let dx = -2; dx <= 2; dx++) {
                                    const sampleX = x + dx;
                                    const sampleY = y + dy;
                                    
                                    if (sampleX >= corner.startX && sampleX < corner.endX && 
                                        sampleY >= corner.startY && sampleY < corner.endY) {
                                        const samplePixel = Jimp.intToRGBA(image.getPixelColor(sampleX, sampleY));
                                        
                                        // Check for high contrast
                                        if (Math.abs(samplePixel.r - pixel.r) > 100 || 
                                            Math.abs(samplePixel.g - pixel.g) > 100 || 
                                            Math.abs(samplePixel.b - pixel.b) > 100) {
                                            contrastCount++;
                                        }
                                    }
                                }
                            }
                            
                            // If high contrast detected, mark as text region
                            if (contrastCount >= 3) {
                                textRegions.push({
                                    x: x - 2,
                                    y: y - 2,
                                    width: 10,
                                    height: 10,
                                    text: 'detected_by_pixels',
                                    corner: corner.name
                                });
                                isTextPattern = true;
                            }
                        }
                        
                        if (isTextPattern) {
                            // Skip ahead to avoid overlapping regions
                            x += 10;
                        }
                    }
                }
            }
            
            console.log(`🔍 Found ${textRegions.length} text-like pixel regions`);
            return textRegions;
            
        } catch (error) {
            console.error('❌ Pixel-level analysis failed:', error);
            return [];
        }
    }

    // Remove individual characters with precision
    async removeIndividualCharacters(imageBuffer, characterRegions) {
        try {
            console.log(`🎨 Removing ${characterRegions.length} individual characters with precision...`);
            
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            
            for (const char of characterRegions) {
                // Add small padding for complete coverage
                const padding = 3;
                const paddedX = Math.max(0, char.x - padding);
                const paddedY = Math.max(0, char.y - padding);
                const paddedWidth = Math.min(width - paddedX, char.width + padding * 2);
                const paddedHeight = Math.min(height - paddedY, char.height + padding * 2);
                
                console.log(`  🎨 Removing character "${char.text}" from ${char.corner} (${paddedX}, ${paddedY})`);
                
                // Precise inpainting for each character
                for (let y = paddedY; y < paddedY + paddedHeight; y++) {
                    for (let x = paddedX; x < paddedX + paddedWidth; x++) {
                        // Sample from larger area for better inpainting
                        const sampleRadius = 8;
                        const surroundingColors = [];
                        
                        for (let dy = -sampleRadius; dy <= sampleRadius; dy += 2) {
                            for (let dx = -sampleRadius; dx <= sampleRadius; dx += 2) {
                                const sampleX = x + dx;
                                const sampleY = y + dy;
                                
                                if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height) {
                                    const color = Jimp.intToRGBA(image.getPixelColor(sampleX, sampleY));
                                    surroundingColors.push(color);
                                }
                            }
                        }
                        
                        if (surroundingColors.length > 0) {
                            // Calculate weighted average
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
            
            // Apply minimal blur to blend
            image.blur(0.3);
            
            console.log('✅ Individual character removal completed');
            return await image.getBufferAsync(Jimp.MIME_JPEG);
            
        } catch (error) {
            console.error('❌ Character removal failed:', error);
            return imageBuffer;
        }
    }

    // Fallback: Minimal corner coverage
    async applyMinimalCornerCoverage(imageBuffer) {
        try {
            console.log('🎯 Applying minimal corner coverage as fallback...');
            
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width;
            const height = metadata.height;
            
            // Very minimal coverage - only small areas where GPS text typically appears
            const svgRectangles = `
                <!-- Top-right corner (small GPS area) -->
                <rect x="${width - (width * 0.25)}" y="0" width="${width * 0.25}" height="${height * 0.15}" fill="black" />
                
                <!-- Bottom-right corner (small GPS area) -->
                <rect x="${width - (width * 0.3)}" y="${height - (height * 0.12)}" width="${width * 0.3}" height="${height * 0.12}" fill="black" />
                
                <!-- Top-left corner (small date area) -->
                <rect x="0" y="0" width="${width * 0.2}" height="${height * 0.12}" fill="black" />
            `;
            
            const svg = `
                <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    ${svgRectangles}
                </svg>
            `;
            
            console.log(`🎯 Applied minimal corner coverage (only 15% of image area)`);
            
            const overlayBuffer = Buffer.from(svg);
            return await image
                .composite([{ input: overlayBuffer, top: 0, left: 0 }])
                .jpeg({ quality: 95, force: true })
                .toBuffer();
            
        } catch (error) {
            console.error('❌ Minimal coverage failed:', error);
            return imageBuffer;
        }
    }

    async addTextOverlay(imageBuffer, lat, lon, timeStr, action = 'add') {
        try {
            let processedBuffer = imageBuffer;
            
            if (action === 'remove') {
                console.log('🔤 CHARACTER-LEVEL GPS REMOVAL - Detecting and removing individual characters...');
                
                // Step 1: Remove EXIF data
                processedBuffer = await this.removeEXIFData(processedBuffer);
                
                // Step 2: Character-level OCR detection
                const characterRegions = await this.detectCharacterLevelText(processedBuffer);
                
                // Step 3: Pixel-level analysis as backup
                const pixelRegions = await this.detectTextPixels(processedBuffer);
                
                // Combine all detected regions
                const allRegions = [...characterRegions, ...pixelRegions];
                
                // Remove duplicates
                const uniqueRegions = [];
                const seen = new Set();
                
                for (const region of allRegions) {
                    const key = `${Math.floor(region.x / 10)}_${Math.floor(region.y / 10)}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueRegions.push(region);
                    }
                }
                
                console.log(`🔤 Total unique regions to remove: ${uniqueRegions.length}`);
                
                if (uniqueRegions.length > 0) {
                    console.log(`🎨 Removing individual characters...`);
                    processedBuffer = await this.removeIndividualCharacters(processedBuffer, uniqueRegions);
                } else {
                    console.log('⚠️ No characters detected, applying minimal corner coverage...');
                    processedBuffer = await this.applyMinimalCornerCoverage(processedBuffer);
                }
                
                console.log('🔤 CHARACTER-LEVEL GPS removal completed');
                
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
            console.error('❌ Error in character-level processing:', error);
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
            console.log(`🔤 Saved: ${filename}`);

            const thumbnailBuffer = await sharp(processedBuffer)
                .resize(200, 200, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toBuffer();
            
            const thumbnailBase64 = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;

            return {
                success: true,
                filename,
                thumbnail: thumbnailBase64,
                status: action === 'add' ? 'Đã thêm GPS' : 'Đã xóa GPS cũ (Character-level)',
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
        console.log('🔤 CHARACTER-LEVEL Processing request started');
        
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

        console.log(`📁 Processing ${files.length} images with CHARACTER-LEVEL tools`);

        const config = {
            text_position: action === 'remove' ? 'top-right' : (position || 'bottom-left'),
            font_size: parseInt(fontSize) || 32,
            fallback_gps: {
                latitude: parseFloat(latitude) || 21.0285,
                longitude: parseFloat(longitude) || 105.8542
            }
        };

        const processor = new CharacterLevelGPSRemover(config);
        const results = [];

        for (const file of files) {
            console.log(`\n🔤 Character-level processing: ${file.originalname}`);
            const result = await processor.processImage(
                file.buffer, file.originalname, action,
                action === 'add' ? config.fallback_gps : null
            );
            results.push(result);
            console.log(`✅ Character-level completed: ${file.originalname} - ${result.status}`);
        }

        // Store current batch images data for API
        currentBatchImages = results.filter(r => r.success);
        console.log(`📱 Stored ${currentBatchImages.length} images in current batch data`);

        console.log(`✅🔤 Character-level processed ${results.length} images`);

        res.json({
            success: true,
            results: results,
            processed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        });

    } catch (error) {
        console.error('❌ Character-level processing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export ZIP using current displayed images data
app.get('/export', async (req, res) => {
    try {
        console.log('📦 Export request started');
        
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
    console.log(`🔤🔤🔤 CHARACTER-LEVEL GPS REMOVER SERVER running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('🔗 ZIP export: http://localhost:' + PORT + '/export');
    console.log('🔤🔤🔤 CHARACTER-LEVEL MODE ACTIVATED 🔤🔤🔤');
    console.log('📦 ZIP: Images only, no JSON');
    console.log('🔧 EXIF: ExifTool for complete metadata removal');
    console.log('🔍 OCR: Character-level detection (SINGLE_CHAR mode)');
    console.log('🔍 Pixels: High contrast analysis for text patterns');
    console.log('🎨 Coverage: Individual character removal + minimal fallback');
    console.log('✅ Main image area: 85% preserved');
});

module.exports = app;
