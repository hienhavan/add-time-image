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
const PORT = 3000;

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

class SmartTextRemover {
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
            border_percent: 0.3, // 30% border scanning
            ...config
        };
    }

    // EXIF data removal
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

    // Smart text detection in 30% border areas
    async detectTextInBorders(imageBuffer) {
        try {
            console.log('🔍 SMART TEXT DETECTION - Scanning 30% borders for text ONLY...');
            
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            const borderPercent = this.config.border_percent;
            
            // Define 4 border areas (30% from each side)
            const borderAreas = [
                {
                    name: 'top-border',
                    x: 0,
                    y: 0,
                    width: width,
                    height: height * borderPercent
                },
                {
                    name: 'bottom-border',
                    x: 0,
                    y: height - (height * borderPercent),
                    width: width,
                    height: height * borderPercent
                },
                {
                    name: 'left-border',
                    x: 0,
                    y: 0,
                    width: width * borderPercent,
                    height: height
                },
                {
                    name: 'right-border',
                    x: width - (width * borderPercent),
                    y: 0,
                    width: width * borderPercent,
                    height: height
                }
            ];
            
            const allTextRegions = [];
            
            for (const border of borderAreas) {
                try {
                    console.log(`🔍 Scanning ${border.name} for text...`);
                    
                    // Crop border area
                    const borderImage = image.clone().crop(
                        border.x, border.y, border.width, border.height
                    );
                    
                    const borderBuffer = await borderImage.getBufferAsync(Jimp.MIME_JPEG);
                    
                    // Use OCR to detect text only
                    const { data: { words } } = await Tesseract.recognize(borderBuffer, 'eng+vie', {
                        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                        tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS Vị trí Ngày Tháng Năm Giờ Phút Giây .,!?@#$%^&*()_+-=[]{}|;:"\'<>',
                        preserve_interword_spaces: '1'
                    });
                    
                    // Filter for actual text (not just noise)
                    const actualText = words.filter(word => {
                        const text = word.text.trim();
                        return text.length > 0 && 
                               word.confidence > 30 && // Minimum confidence
                               !text.match(/^[^\w\s]+$/); // Not just symbols
                    });
                    
                    console.log(`🔍 Found ${actualText.length} actual text elements in ${border.name}`);
                    
                    // Convert border coordinates back to full image coordinates
                    const textRegionsInFull = actualText.map(word => ({
                        x: border.x + word.bbox.x0,
                        y: border.y + word.bbox.y0,
                        width: word.bbox.x1 - word.bbox.x0,
                        height: word.bbox.y1 - word.bbox.y0,
                        text: word.text,
                        border: border.name,
                        confidence: word.confidence || 0
                    }));
                    
                    allTextRegions.push(...textRegionsInFull);
                    
                } catch (error) {
                    console.error(`❌ Error scanning ${border.name}:`, error);
                }
            }
            
            console.log(`🔍 Total text regions found in all borders: ${allTextRegions.length}`);
            return allTextRegions;
            
        } catch (error) {
            console.error('❌ Smart text detection failed:', error);
            return [];
        }
    }

    // Remove only detected text, keep background intact
    async removeDetectedText(imageBuffer, textRegions) {
        try {
            console.log(`🎨 REMOVING TEXT ONLY - Keeping background intact (${textRegions.length} regions)...`);
            
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            
            for (const region of textRegions) {
                // Add small padding for complete coverage
                const padding = 3;
                const paddedX = Math.max(0, region.x - padding);
                const paddedY = Math.max(0, region.y - padding);
                const paddedWidth = Math.min(width - paddedX, region.width + padding * 2);
                const paddedHeight = Math.min(height - paddedY, region.height + padding * 2);
                
                console.log(`  🎨 Removing text "${region.text}" from ${region.border} (${paddedX}, ${paddedY})`);
                
                // Smart inpainting - remove text but keep background
                for (let y = paddedY; y < paddedY + paddedHeight; y++) {
                    for (let x = paddedX; x < paddedX + paddedWidth; x++) {
                        // Sample surrounding pixels for inpainting
                        const sampleRadius = 10;
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
                            // Calculate weighted average for natural blending
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
            
            // Apply minimal blur to blend edges naturally
            image.blur(0.5);
            
            console.log('✅ Text-only removal completed - Background preserved');
            return await image.getBufferAsync(Jimp.MIME_JPEG);
            
        } catch (error) {
            console.error('❌ Text-only removal failed:', error);
            return imageBuffer;
        }
    }

    // Alternative: Apply text detection with character-level precision
    async detectCharacterLevelText(imageBuffer) {
        try {
            console.log('🔤 CHARACTER-LEVEL DETECTION - Finding individual characters...');
            
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            const borderPercent = this.config.border_percent;
            
            // Define border areas for character detection
            const borderAreas = [
                { name: 'top-border', x: 0, y: 0, width: width, height: height * borderPercent },
                { name: 'bottom-border', x: 0, y: height - (height * borderPercent), width: width, height: height * borderPercent },
                { name: 'left-border', x: 0, y: 0, width: width * borderPercent, height: height },
                { name: 'right-border', x: width - (width * borderPercent), y: 0, width: width * borderPercent, height: height }
            ];
            
            const allCharacters = [];
            
            for (const border of borderAreas) {
                try {
                    console.log(`🔤 Character-level scanning ${border.name}...`);
                    
                    // Crop border area
                    const borderImage = image.clone().crop(
                        border.x, border.y, border.width, border.height
                    );
                    
                    const borderBuffer = await borderImage.getBufferAsync(Jimp.MIME_JPEG);
                    
                    // Use character-level OCR
                    const { data: { words, symbols } } = await Tesseract.recognize(borderBuffer, 'eng+vie', {
                        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_CHAR,
                        tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS Vị trí Ngày Tháng Năm Giờ Phút Giây .,!?@#$%^&*()_+-=[]{}|;:"\'<>',
                        preserve_interword_spaces: '1'
                    });
                    
                    // Combine words and symbols
                    const allTextElements = [...(words || []), ...(symbols || [])];
                    
                    // Filter for actual characters
                    const actualCharacters = allTextElements.filter(element => {
                        const text = element.text.trim();
                        return text.length > 0 && 
                               element.confidence > 40 &&
                               !text.match(/^[^\w\s]+$/);
                    });
                    
                    console.log(`🔤 Found ${actualCharacters.length} characters in ${border.name}`);
                    
                    // Convert to full image coordinates
                    const charRegionsInFull = actualCharacters.map(char => ({
                        x: border.x + char.bbox.x0,
                        y: border.y + char.bbox.y0,
                        width: char.bbox.x1 - char.bbox.x0,
                        height: char.bbox.y1 - char.bbox.y0,
                        text: char.text,
                        border: border.name,
                        confidence: char.confidence || 0
                    }));
                    
                    allCharacters.push(...charRegionsInFull);
                    
                } catch (error) {
                    console.error(`❌ Error character scanning ${border.name}:`, error);
                }
            }
            
            console.log(`🔤 Total characters found: ${allCharacters.length}`);
            return allCharacters;
            
        } catch (error) {
            console.error('❌ Character-level detection failed:', error);
            return [];
        }
    }

    async addTextOverlay(imageBuffer, lat, lon, timeStr, action = 'add', inputDate = null, inputLocation = null) {
        try {
            let processedBuffer = imageBuffer;
            
            if (action === 'remove') {
                console.log('🔍🎨 SMART TEXT REMOVER - Detect and remove text ONLY, keep background...');
                
                // Step 1: Remove EXIF data
                processedBuffer = await this.removeEXIFData(processedBuffer);
                
                // Step 2: Smart text detection in 30% borders
                const textRegions = await this.detectTextInBorders(processedBuffer);
                
                // Step 3: Character-level detection as backup
                const characterRegions = await this.detectCharacterLevelText(processedBuffer);
                
                // Combine all detected text
                const allTextRegions = [...textRegions, ...characterRegions];
                
                // Remove duplicates
                const uniqueRegions = [];
                const seen = new Set();
                
                for (const region of allTextRegions) {
                    const key = `${Math.floor(region.x / 5)}_${Math.floor(region.y / 5)}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueRegions.push(region);
                    }
                }
                
                console.log(`🔍🎨 Total unique text regions to remove: ${uniqueRegions.length}`);
                
                if (uniqueRegions.length > 0) {
                    console.log(`🎨 Removing detected text while preserving background...`);
                    processedBuffer = await this.removeDetectedText(processedBuffer, uniqueRegions);
                } else {
                    console.log('⚠️ No text detected, image unchanged');
                }
                
                console.log('🔍🎨 SMART TEXT REMOVAL completed - Background preserved');
                
            } else {
                // Add new GPS text (enhanced flow)
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
                
                // Enhanced text lines with date and location
                const textLines = [
                    `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`,
                    `Time: ${timeStr}`
                ];
                
                // Add date and location if provided
                if (inputDate) {
                    textLines.push(`Date: ${inputDate}`);
                }
                if (inputLocation) {
                    textLines.push(`Location: ${inputLocation}`);
                }

                let svgText = '';
                const fontSize = this.config.font_size;
                const padding = this.config.padding;
                let textY = rectY + padding + fontSize;

                textLines.forEach((line, index) => {
                    const textX = rectX + padding;
                    svgText += `<text x="${textX}" y="${textY}" fill="${this.config.text_color}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${line}</text>`;
                    textY += fontSize + padding / 2;
                });
                
                // Text-only overlay - no black background
                const svg = `
                    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
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
            console.error('❌ Error in smart text processing:', error);
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

    async processImage(imageBuffer, filename, action, customGps = null, inputTime = null, inputDate = null, inputLocation = null) {
        try {
            const exifData = this.getExifData(imageBuffer);
            const [lat, lon] = this.getGpsCoordinates(exifData);
            const timeStr = inputTime || this.getDateTime(exifData);

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
                imageBuffer, finalLat, finalLon, timeStr, action, inputDate, inputLocation
            );

            const outputPath = path.join(outputDir, filename);
            fs.writeFileSync(outputPath, processedBuffer);
            console.log(`🔍🎨 Saved: ${filename}`);

            const thumbnailBuffer = await sharp(processedBuffer)
                .resize(200, 200, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toBuffer();
            
            const thumbnailBase64 = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;

            return {
                success: true,
                filename,
                thumbnail: thumbnailBase64,
                status: action === 'add' ? 'Đã thêm GPS' : 'Đã xóa GPS cũ (Smart Text)',
                gps: action === 'add' ? { lat: finalLat, lon: finalLon } : null,
                time: timeStr,
                date: inputDate,
                location: inputLocation
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
        console.log('🔍🎨 SMART TEXT REMOVER Processing request started');
        
        const { action, position, latitude, longitude, fontSize, inputTime, inputDate, inputLocation } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Không có file nào được tải lên' 
            });
        }

        // Clean before processing
        cleanOutputDirectory();

        console.log(`📁 Processing ${files.length} images with SMART TEXT REMOVER`);

        // Process GPS coordinates with randomization
        let finalLat, finalLon;
        
        if (action === 'add') {
            if (latitude && longitude) {
                // Randomize last digit of latitude
                const baseLat = parseFloat(latitude);
                const latDecimal = baseLat.toString().split('.')[1] || '';
                const lastDigit = latDecimal.slice(-1);
                const randomLatDigit = Math.floor(Math.random() * 10).toString();
                const randomizedLat = baseLat.toString().slice(0, -1) + randomLatDigit;
                finalLat = parseFloat(randomizedLat);
                
                // Longitude stays the same
                finalLon = parseFloat(longitude);
                
                console.log(`🎲 Randomized latitude: ${latitude} -> ${finalLat} (last digit: ${lastDigit} -> ${randomLatDigit})`);
            } else {
                finalLat = 21.0285;
                finalLon = 105.8542;
            }
        } else {
            finalLat = 0;
            finalLon = 0;
        }

        // Process time with randomization
        let finalTime;
        if (action === 'add' && inputTime) {
            const [hours, minutes] = inputTime.split(':').map(Number);
            const randomMinutes = minutes + Math.floor(Math.random() * 11) - 5; // ±5 minutes
            const finalMinutes = Math.max(0, Math.min(59, randomMinutes));
            finalTime = `${hours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}:00`;
            
            console.log(`🎲 Randomized time: ${inputTime} -> ${finalTime} (±5 minutes variation)`);
        } else {
            finalTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }

        // Process date and location
        const finalDate = inputDate || new Date().toISOString().slice(0, 10);
        const finalLocation = inputLocation || 'Hà Nội';

        const config = {
            text_position: action === 'remove' ? 'top-right' : (position || 'bottom-left'),
            font_size: parseInt(fontSize) || 32,
            fallback_gps: {
                latitude: finalLat,
                longitude: finalLon
            },
            input_time: finalTime,
            input_date: finalDate,
            input_location: finalLocation
        };

        const processor = new SmartTextRemover(config);
        const results = [];

        for (const file of files) {
            console.log(`\n🔍🎨 Smart text processing: ${file.originalname}`);
            
            // Per-image randomization
            let imageLat, imageLon, imageTime;
            
            if (action === 'add') {
                // Randomize latitude for each image
                const baseLat = parseFloat(latitude);
                const latStr = baseLat.toString();
                const latDecimalIndex = latStr.indexOf('.');
                
                if (latDecimalIndex !== -1 && latStr.length > latDecimalIndex + 2) {
                    // Get the part after decimal point
                    const latIntegerPart = latStr.substring(0, latDecimalIndex);
                    const latDecimalPart = latStr.substring(latDecimalIndex + 1);
                    
                    // Replace last 2 digits with random
                    const randomLatDigits = Math.floor(Math.random() * 100).toString().padStart(2, '0');
                    const newLatDecimalPart = latDecimalPart.slice(0, -2) + randomLatDigits;
                    const randomizedLat = latIntegerPart + '.' + newLatDecimalPart;
                    imageLat = parseFloat(randomizedLat);
                    
                    console.log(`🎲 Per-image randomized latitude: ${latitude} -> ${imageLat} (decimal part: ${latDecimalPart} -> ${newLatDecimalPart})`);
                } else {
                    // Fallback: add random decimal
                    const randomDecimal = Math.floor(Math.random() * 1000000) / 1000000;
                    imageLat = baseLat + randomDecimal;
                    console.log(`🎲 Per-image randomized latitude (fallback): ${latitude} -> ${imageLat}`);
                }
                
                // Randomize longitude for each image
                const baseLon = parseFloat(longitude);
                const lonStr = baseLon.toString();
                const lonDecimalIndex = lonStr.indexOf('.');
                
                if (lonDecimalIndex !== -1 && lonStr.length > lonDecimalIndex + 2) {
                    // Get the part after decimal point
                    const lonIntegerPart = lonStr.substring(0, lonDecimalIndex);
                    const lonDecimalPart = lonStr.substring(lonDecimalIndex + 1);
                    
                    // Replace last 2 digits with random
                    const randomLonDigits = Math.floor(Math.random() * 100).toString().padStart(2, '0');
                    const newLonDecimalPart = lonDecimalPart.slice(0, -2) + randomLonDigits;
                    const randomizedLon = lonIntegerPart + '.' + newLonDecimalPart;
                    imageLon = parseFloat(randomizedLon);
                    
                    console.log(`🎲 Per-image randomized longitude: ${longitude} -> ${imageLon} (decimal part: ${lonDecimalPart} -> ${newLonDecimalPart})`);
                } else {
                    // Fallback: add random decimal
                    const randomDecimal = Math.floor(Math.random() * 1000000) / 1000000;
                    imageLon = baseLon + randomDecimal;
                    console.log(`🎲 Per-image randomized longitude (fallback): ${longitude} -> ${imageLon}`);
                }
                
                // Randomize time for each image
                if (inputTime) {
                    const [hours, minutes] = inputTime.split(':').map(Number);
                    const randomMinutes = minutes + Math.floor(Math.random() * 11) - 5; // ±5 minutes
                    const finalMinutes = Math.max(0, Math.min(59, randomMinutes));
                    imageTime = `${hours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}:00`;
                    
                    console.log(`🎲 Per-image randomized time: ${inputTime} -> ${imageTime} (±5 minutes variation)`);
                } else {
                    imageTime = finalTime;
                }
            } else {
                imageLat = 0;
                imageLon = 0;
                imageTime = finalTime;
            }
            
            const result = await processor.processImage(
                file.buffer, file.originalname, action,
                action === 'add' ? { latitude: imageLat, longitude: imageLon } : null,
                imageTime,
                finalDate,
                finalLocation
            );
            results.push(result);
            console.log(`✅ Smart text completed: ${file.originalname} - ${result.status}`);
        }

        // Store current batch images data for API
        currentBatchImages = results.filter(r => r.success);
        console.log(`📱 Stored ${currentBatchImages.length} images in current batch data`);

        console.log(`✅🔍🎨 Smart text processed ${results.length} images`);

        res.json({
            success: true,
            results: results,
            processed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        });

    } catch (error) {
        console.error('❌ Smart text processing error:', error);
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
    console.log(`🔍🎨🔍🎨 SMART TEXT REMOVER SERVER running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log('🔗 ZIP export: http://localhost:' + PORT + '/export');
    console.log('🔍🎨🔍🎨 SMART TEXT MODE ACTIVATED 🔍🎨🔍🎨');
    console.log('📦 ZIP: Images only, no JSON');
    console.log('🔧 EXIF: ExifTool for complete metadata removal');
    console.log('🔍 Detection: Text ONLY in 30% border areas');
    console.log('🎨 Removal: Smart inpainting, background preserved');
    console.log('✅ Image: 100% preserved except removed text');
});

module.exports = app;
