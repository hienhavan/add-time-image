const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const archiver = require('archiver');

const app = express();
const PORT = 3000;

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

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Store mapping between original filenames and processed filenames
let fileMapping = new Map();

class ImageProcessor {
    constructor(config = {}) {
        this.config = {
            fallback_gps: {
                latitude: 21.0285,
                longitude: 105.8542
            },
            text_position: 'bottom-left',
            rectangle_color: 'black',
            text_color: 'white',
            font_size: 24,
            padding: 10,
            rectangle_height_percent: 0.15,
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
                    return this.formatDate(exifDate, this.config.input_time, this.config.input_date);
                }
            }
            return this.formatDate(new Date(), this.config.input_time, this.config.input_date);
        } catch (error) {
            console.error(`Error getting datetime: ${error.message}`);
            return this.formatDate(new Date(), this.config.input_time, this.config.input_date);
        }
    }

    formatDate(date, customTime = null, customDate = null) {
        // Use custom time/date if provided
        let finalDate = date;

        if (customDate) {
            const [year, month, day] = customDate.split('-').map(Number);
            finalDate = new Date(year, month - 1, day);
        }

        if (customTime) {
            const [hours, minutes] = customTime.split(':').map(Number);
            // Random ±5 phút
            const randomMinutes = Math.floor(Math.random() * 11) - 5; // -5 đến +5
            finalDate.setHours(hours, minutes + randomMinutes);
        }
        
        const year = finalDate.getFullYear();
        const month = String(finalDate.getMonth() + 1).padStart(2, '0');
        const day = String(finalDate.getDate()).padStart(2, '0');
        const hours = String(finalDate.getHours()).padStart(2, '0');
        const minutes = String(finalDate.getMinutes()).padStart(2, '0');
        const seconds = String(finalDate.getSeconds()).padStart(2, '0');
        
        // Format like Timemark: YYYY-MM-DD HH:MM:SS
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    async addTextOverlay(imageBuffer, lat, lon, timeStr, action = 'add') {
        try {
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width;
            const height = metadata.height;
            
            // Calculate text position
            const padding = 15;

            // Parse time string for better formatting
            const dateObj = new Date(timeStr);
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const year = dateObj.getFullYear();
            const dateMonthStr = `${month}/${day}`;
            const yearStr = `${year}`;
            const timeStrFormatted = dateObj.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
            });

            let svgText = '';
            const fontSize = this.config.font_size;
            
            // Calculate scale factor based on image size
            const baseWidth = 960; // Reference width for scaling (even smaller for larger watermark)
            const baseHeight = 540; // Reference height for scaling
            const scaleFactor = Math.min(width / baseWidth, height / baseHeight);
            const clampedScale = Math.max(1.0, Math.min(scaleFactor, 4.0)); // Clamp between 1.0x and 4.0x
            
            // Base layout values (dựa trên fontSize từ config)
            const baseFontSize = this.config.font_size || 24; 
            const timeFontSize = Math.round(baseFontSize * 2.15 * clampedScale); 
            const dateFontSize = Math.round(baseFontSize * 1.25 * clampedScale);
            const yearFontSize = Math.round(baseFontSize * 1.25 * clampedScale);
            const locationFontSize = Math.round(baseFontSize * 1.15 * clampedScale);
            const gpsFontSize = Math.round(baseFontSize * 1.15 * clampedScale);
            const brandFontSize = Math.round(baseFontSize * 0.8 * clampedScale);
            const commitFontSize = Math.round(baseFontSize * 0.9 * clampedScale);
            const spacing1 = Math.round(baseFontSize * -0.5 * clampedScale);
            const spacing2 = Math.round(baseFontSize * 2 * clampedScale);
            const spacing3 = Math.round(baseFontSize * 0.6 * clampedScale);
            const spacing4 = Math.round(baseFontSize * 0.4 * clampedScale);
            const dateYearSpacing = Math.round(baseFontSize * 1.4 * clampedScale);
            
            const leftMargin = Math.round(20 * clampedScale); // Lề trái an toàn
            const bottomMargin = Math.round(2.5 * clampedScale); // Lề dưới an toàn (giảm 1 nửa nữa)
            const rightMargin = Math.round(20 * clampedScale); // Lề phải an toàn
            const topMargin = Math.round(20 * clampedScale); // Lề trên an toàn

            // Calculate text position based on text_position config
            let textX, textY;
            const position = this.config.text_position || 'bottom-left';
            const isRightPosition = position.includes('right');
            const isTopPosition = position.includes('top');
            const textAnchor = isRightPosition ? 'end' : 'start';

            // Tính toán vùng an toàn cho text
            const safeLeft = leftMargin;
            const safeRight = width - rightMargin;
            const safeTop = topMargin;
            const safeBottom = height - bottomMargin;

            // Tính tổng chiều cao của watermark (3 dòng + spacing) - không tính brand vì nó tách riêng
            const totalHeight = timeFontSize + dateFontSize + dateYearSpacing + yearFontSize + spacing1 + locationFontSize + spacing2 + gpsFontSize;

            switch (position) {
                case 'top-left':
                    textX = safeLeft;
                    textY = safeTop + timeFontSize;
                    break;
                case 'top-right':
                    textX = safeRight;
                    textY = safeTop + timeFontSize;
                    break;
                case 'bottom-left':
                    textX = safeLeft;
                    textY = safeBottom - totalHeight + timeFontSize; // Điều chỉnh để toàn bộ watermark nằm trong vùng an toàn
                    break;
                case 'bottom-right':
                    textX = safeRight;
                    textY = safeBottom - totalHeight + timeFontSize; // Điều chỉnh để toàn bộ watermark nằm trong vùng an toàn
                    break;
                default:
                    textX = safeLeft;
                    textY = safeBottom - totalHeight + timeFontSize;
            }

            let gpsTextY = 0; // Track GPS position for background

            // Hàng thứ nhất: Giờ và ngày (giờ to hơn và bold, phân cách bằng | màu vàng)
            if (action === 'add') {
                const separatorColor = '#FFD700'; // Màu vàng
                const separatorThickness = Math.round(4 * clampedScale); // Đậm hơn
                const gap = Math.round(20 * clampedScale); // Khoảng cách 10px
                
                // Tính toán vị trí
                const dateBaselineY = textY; // Baseline của ngày tháng
                const dateTopY = dateBaselineY - dateFontSize + Math.round(2 * clampedScale); // Đầu thực của ngày tháng (điều chỉnh nhỏ)
                const yearBaselineY = textY + dateYearSpacing; // Baseline của năm
                const yearBottomY = yearBaselineY; // Chân của năm (baseline)
                const separatorTopY = dateTopY; // Đầu của | = đầu thực của ngày tháng
                const separatorBottomY = yearBottomY; // Chân của | = chân của năm
                const separatorHeight = separatorBottomY - separatorTopY; // Chiều cao của |
                const separatorCenterY = separatorTopY + separatorHeight / 2; // Trung tâm của |
                
                // Vẽ đường dọc | với chiều cao chính xác
                const timeX = textX; // Giờ bắt đầu từ textX để thẳng hàng với GPS, vị trí
                const timeWidth = Math.round(130 * clampedScale); // Chiều rộng ước lượng của text giờ (tăng thêm)
                let separatorX, dateSectionX;

                if (isRightPosition) {
                    // Khi căn phải, separator nằm bên trái text
                    separatorX = timeX - timeWidth - gap;
                    dateSectionX = separatorX - gap;
                } else {
                    // Khi căn trái, separator nằm bên phải text
                    separatorX = timeX + timeWidth + gap;
                    dateSectionX = separatorX + gap;
                }

                svgText += `<line x1="${separatorX}" y1="${separatorTopY}" x2="${separatorX}" y2="${separatorBottomY}" stroke="${separatorColor}" stroke-width="${separatorThickness}" stroke-linecap="round" />`;

                const timeY = separatorCenterY + Math.round(timeFontSize * 0.35); // Điều chỉnh để text căn giữa
                svgText += `<text x="${timeX}" y="${timeY}" fill="#FFFFFF" font-size="${timeFontSize}" font-family="Arial, sans-serif" font-weight="bold" stroke="black" stroke-width="1" stroke-opacity="1" text-anchor="${textAnchor}">${timeStrFormatted}</text>`;

                // Date section: 2 lines (month/day on top, year below), cách | gap px
                svgText += `<text x="${dateSectionX}" y="${dateBaselineY}" fill="#ffffff" font-size="${dateFontSize}" font-family="Arial, sans-serif" font-weight="500" stroke="black" stroke-width="0.3" paint-order="stroke" stroke-opacity="1" text-anchor="${textAnchor}">${dateMonthStr}</text>`;
                svgText += `<text x="${dateSectionX}" y="${yearBaselineY}" fill="#ffffff" font-size="${yearFontSize}" font-family="Arial, sans-serif" font-weight="500" stroke="black" stroke-width="0.3" paint-order="stroke" stroke-opacity="1" text-anchor="${textAnchor}">${yearStr}</text>`;

                textY += Math.max(timeFontSize, dateFontSize + dateYearSpacing + yearFontSize) + spacing1; // Adjust for 2-line date section

                // Hàng thứ hai: Location (không bold)
                svgText += `<text x="${textX}" y="${textY}" fill="#FFFFFF" font-size="${locationFontSize}" font-family="Arial, sans-serif" font-weight="normal" stroke="black" stroke-width="0.3" stroke-opacity="1" text-anchor="${textAnchor}">${this.config.input_location || 'Location'}</text>`;
                textY += spacing2; // Scaled spacing

                // Hàng thứ ba: GPS coordinates (không bold)
                gpsTextY = textY; // GPS text Y position
                svgText += `<text x="${textX}" y="${textY}" fill="#FFFFFF" font-size="${gpsFontSize}" font-family="Arial, sans-serif" font-weight="normal" stroke="black" stroke-width="0.3" stroke-opacity="1" text-anchor="${textAnchor}">Lat: ${lat.toFixed(6)} Lon: ${lon.toFixed(6)}</text>`;
            }

            // Hàng thứ tư: Brand "Timemark 100% Chân thực" - luôn ở bottom-right
            const brandX = safeRight; // Luôn ở lề phải
            const brandY = safeBottom; // Luôn ở lề dưới
            svgText += `<text x="${brandX}" y="${brandY}" font-family="Arial, sans-serif" text-anchor="end">`;
            svgText += `<tspan fill="#FFD700" font-weight="bold" font-size="${brandFontSize}">Time</tspan>`;
            svgText += `<tspan fill="#FFFFFF" font-weight="bold" font-size="${brandFontSize}">mark</tspan>`;
            svgText += `<tspan fill="#CCCCCC" font-weight="normal" font-size="${Math.round(brandFontSize * 0.8)}"> 100% Chân thực</tspan>`;
            svgText += `</text>`;

            // Hàng thứ năm: " Cam kết ngày giờ chân thực bởi Timemark " với icon khiên
            const commitY = brandY; // Cùng dòng Y với brand
            const shieldIconSize = commitFontSize; // Chiều cao bằng với chữ
            const commitX = safeLeft + shieldIconSize + 5; // Dịch sang phải để tránh icon
            // Vẽ icon khiên có dấu tích trực tiếp vào SVG
            const shieldX = safeLeft;
            const shieldY = commitY - commitFontSize;
            svgText += `<path d="M${shieldX + shieldIconSize * 0.5} ${shieldY} L${shieldX} ${shieldY + shieldIconSize * 0.2} V${shieldY + shieldIconSize * 0.5} C${shieldX} ${shieldY + shieldIconSize * 0.8} ${shieldX + shieldIconSize * 0.4} ${shieldY + shieldIconSize} ${shieldX + shieldIconSize * 0.5} ${shieldY + shieldIconSize} C${shieldX + shieldIconSize * 0.6} ${shieldY + shieldIconSize} ${shieldX + shieldIconSize} ${shieldY + shieldIconSize * 0.8} ${shieldX + shieldIconSize} ${shieldY + shieldIconSize * 0.5} V${shieldY + shieldIconSize * 0.2} L${shieldX + shieldIconSize * 0.5} ${shieldY} Z" fill="#4CAF50" stroke="#4CAF50" stroke-width="1"/>`;
            svgText += `<path d="M${shieldX + shieldIconSize * 0.35} ${shieldY + shieldIconSize * 0.55} L${shieldX + shieldIconSize * 0.45} ${shieldY + shieldIconSize * 0.65} L${shieldX + shieldIconSize * 0.65} ${shieldY + shieldIconSize * 0.45}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
            svgText += `<text x="${commitX}" y="${commitY}" fill="#CCCCCC" font-family="Arial, sans-serif" font-weight="normal" font-size="${commitFontSize}" text-anchor="start"> Cam kết ngày giờ chân thực bởi Timemark</text>`;

            // Create SVG with gradient background only around GPS section
            const gpsRectHeight = gpsFontSize + Math.round(15 * clampedScale);
            const gpsRectWidth = Math.round(400 * clampedScale);
            const gpsRectX = leftMargin; // Margin from left edge
            const finalRectY = gpsTextY - gpsFontSize - Math.round(5 * clampedScale); // Position background to wrap GPS text
            
            const svg = `
                <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="gpsGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:rgba(180,180,180,1);stop-opacity:1" />
                            <stop offset="100%" style="stop-color:rgba(180,180,180,0);stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <rect x="${gpsRectX}" y="${finalRectY}" width="${gpsRectWidth}" height="${gpsRectHeight}" rx="${Math.round(8 * clampedScale)}" ry="${Math.round(8 * clampedScale)}" fill="url(#gpsGradient)" />
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

    async processImage(imageBuffer, originalFilename, action, customGps = null) {
        try {
            const exifData = this.getExifData(imageBuffer);
            const [lat, lon] = this.getGpsCoordinates(exifData);
            const timeStr = this.getDateTime(exifData);

            let finalLat, finalLon;

            if (action === 'add') {
                // Use custom GPS if provided, otherwise use EXIF or fallback
                if (customGps) {
                    // Random 2 số cuối của tọa độ
                    const latRandom = (Math.floor(Math.random() * 100) / 1000000); // Random 0-0.000099
                    const lonRandom = (Math.floor(Math.random() * 100) / 1000000); // Random 0-0.000099
                    finalLat = customGps.latitude + latRandom;
                    finalLon = customGps.longitude + lonRandom;
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

            // Use original filename for processed file (no suffix)
            const processedFilename = originalFilename;
            
            // Save processed image
            const outputPath = path.join(outputDir, processedFilename);
            fs.writeFileSync(outputPath, processedBuffer);

            // Store mapping: processed filename -> original filename (same in this case)
            fileMapping.set(processedFilename, originalFilename);

            // Generate thumbnail for UI
            const thumbnailBuffer = await sharp(processedBuffer)
                .resize(200, 200, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toBuffer();
            
            const thumbnailBase64 = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;

            return {
                success: true,
                originalFilename,
                processedFilename,
                outputPath,
                thumbnail: thumbnailBase64,
                status: action === 'add' ? 'Đã thêm GPS' : 'Đã xóa GPS cũ',
                gps: action === 'add' ? { lat: finalLat, lon: finalLon } : null,
                time: timeStr
            };

        } catch (error) {
            console.error(`Error processing ${originalFilename}: ${error.message}`);
            return {
                success: false,
                originalFilename,
                error: error.message,
                status: 'Lỗi xử lý'
            };
        }
    }
}

// Process images endpoint
app.post('/process', upload.array('images'), async (req, res) => {
    try {
        const { action, position, latitude, longitude, fontSize, inputTime, inputDate, inputLocation } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Không có file nào được tải lên' 
            });
        }

        // Clear previous mapping for new batch
        fileMapping.clear();

        // Configure processor
        const config = {
            text_position: position || 'bottom-left',
            font_size: parseInt(fontSize) || 24,
            fallback_gps: {
                latitude: parseFloat(latitude) || 21.0285,
                longitude: parseFloat(longitude) || 105.8542
            },
            input_time: inputTime || null,
            input_date: inputDate || null,
            input_location: inputLocation || null
        };

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
        }

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
app.post('/export', express.json(), async (req, res) => {
    try {
        const { newFilenames = {}, zipFilename } = req.body;
        console.log('Export request received with custom filenames');
        
        if (!fs.existsSync(outputDir)) {
            console.log('Output directory does not exist');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const allFiles = fs.readdirSync(outputDir);
        console.log('Files in output directory:', allFiles.length);
        
        // Only export files that are in the current mapping (current batch)
        const files = allFiles.filter(file => 
            (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) &&
            fileMapping.has(file)
        );

        console.log('Image files to zip (current batch):', files.length);

        if (files.length === 0) {
            console.log('No image files found in current batch');
            return res.status(404).json({ error: 'No processed images found' });
        }

        // Create ZIP archive
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        // Set response headers with custom ZIP filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = zipFilename ? `${zipFilename}.zip` : `processed_images_${timestamp}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        console.log('Creating ZIP archive:', filename);
        
        // Handle archive errors
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            throw err;
        });

        archive.on('end', () => {
            console.log('Archive created successfully, size:', archive.pointer());
        });

        // Pipe archive to response
        archive.pipe(res);

        // Add files to archive with new filenames if provided
        const imageList = [];
        console.log('Available newFilenames:', newFilenames);
        console.log('File mapping:', Array.from(fileMapping.entries()));
        
        files.forEach((file) => {
            const filePath = path.join(outputDir, file);
            const originalName = fileMapping.get(file) || file;
            let newName = newFilenames[originalName] || originalName;
            
            // Ensure the new filename has the correct extension
            const ext = path.extname(file);
            if (!newName.endsWith(ext)) {
                newName = newName + ext;
            }
            
            console.log(`Processing file: ${file}, originalName: ${originalName}, newName: ${newName}`);
            console.log(`File path exists: ${fs.existsSync(filePath)}`);
            
            if (!fs.existsSync(filePath)) {
                console.error(`File not found: ${filePath}`);
                return;
            }
            
            archive.file(filePath, { name: newName });
            
            imageList.push({
                processed: file,
                original: originalName,
                new: newName
            });
        });

        // Finalize archive (removed processing_log.json)
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

// Get current batch file mapping
app.get('/api/current-images', (req, res) => {
    try {
        const files = Array.from(fileMapping.entries()).map(([processed, original]) => ({
            processed,
            original
        }));
        
        res.json({
            success: true,
            count: files.length,
            files: files
        });
    } catch (error) {
        console.error('Error getting current images:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Clean output directory
app.post('/clean', (req, res) => {
    try {
        if (fs.existsSync(outputDir)) {
            fs.readdirSync(outputDir).forEach(file => {
                const filePath = path.join(outputDir, file);
                fs.unlinkSync(filePath);
            });
        }
        res.json({ success: true, message: 'Output directory cleaned' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📁 Output directory: ${outputDir}`);
});

module.exports = app;
