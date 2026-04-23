#!/usr/bin/env node

/**
 * Batch Image GPS and Time Text Processor (Node.js Version)
 * Processes images in a folder to:
 * 1. Read EXIF metadata (GPS and DateTime)
 * 2. Cover existing text with black rectangle
 * 3. Overlay new GPS and time information
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const exifParser = require('exif-parser');

class ImageGPSProcessor {
    constructor(configPath = 'config.json') {
        this.config = this.loadConfig(configPath);
    }

    loadConfig(configPath) {
        const defaultConfig = {
            fallback_gps: {
                latitude: 21.0285,
                longitude: 105.8542
            },
            fallback_time_format: '%Y-%m-%d %H:%M:%S',
            text_position: 'bottom-left',
            rectangle_color: 'black',
            text_color: 'white',
            font_size: 24,
            padding: 10,
            rectangle_height_percent: 0.15,
            font_path: null // Will try to find system fonts
        };

        try {
            if (fs.existsSync(configPath)) {
                const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                return { ...defaultConfig, ...userConfig };
            }
        } catch (error) {
            console.warn(`Warning: Could not load config file ${configPath}: ${error.message}`);
            console.log('Using default configuration');
        }

        return defaultConfig;
    }

    getExifData(imagePath) {
        try {
            const buffer = fs.readFileSync(imagePath);
            const parser = exifParser.create(buffer);
            const result = parser.parse();
            return result;
        } catch (error) {
            console.error(`Error reading EXIF from ${imagePath}: ${error.message}`);
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

            // Apply direction if available
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

    getDateTime(exifData, imagePath) {
        try {
            // Try to get DateTimeOriginal from EXIF
            if (exifData && exifData.tags && exifData.tags.DateTimeOriginal) {
                const exifDate = new Date(exifData.tags.DateTimeOriginal);
                if (!isNaN(exifDate.getTime())) {
                    return this.formatDate(exifDate);
                }
            }

            // Fallback to file creation time
            const stats = fs.statSync(imagePath);
            const fileDate = new Date(stats.birthtime || stats.ctime);
            return this.formatDate(fileDate);
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

    async addTextOverlay(imageBuffer, lat, lon, timeStr) {
        try {
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            
            const width = metadata.width;
            const height = metadata.height;
            const rectHeight = Math.floor(height * this.config.rectangle_height_percent);
            const rectY = height - rectHeight;

            // Create SVG for text overlay
            const textLines = [
                `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`,
                `Time: ${timeStr}`
            ];

            let svgText = '';
            const fontSize = this.config.font_size;
            const padding = this.config.padding;
            let textY = rectY + padding + fontSize;

            // Calculate text position based on configuration
            const getTextX = (textWidth) => {
                if (this.config.text_position === 'bottom-left') {
                    return padding;
                } else if (this.config.text_position === 'bottom-right') {
                    return width - textWidth - padding;
                } else { // center
                    return (width - textWidth) / 2;
                }
            };

            textLines.forEach((line, index) => {
                const textX = getTextX(line.length * fontSize * 0.6); // Approximate text width
                svgText += `<text x="${textX}" y="${textY}" fill="${this.config.text_color}" font-size="${fontSize}" font-family="Arial, sans-serif">${line}</text>`;
                textY += fontSize + padding / 2;
            });

            // Create SVG for overlay
            const svg = `
                <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0" y="${rectY}" width="${width}" height="${rectHeight}" fill="${this.config.rectangle_color}" />
                    ${svgText}
                </svg>
            `;

            // Composite the overlay onto the image
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

    async processImage(inputPath, outputPath) {
        try {
            console.log(`Processing: ${inputPath}`);

            // Read EXIF data
            const exifData = this.getExifData(inputPath);

            // Get GPS coordinates
            const [lat, lon] = this.getGpsCoordinates(exifData);

            // Use fallback GPS if not found
            const finalLat = lat !== null ? lat : this.config.fallback_gps.latitude;
            const finalLon = lon !== null ? lon : this.config.fallback_gps.longitude;

            if (lat === null || lon === null) {
                console.log(`  Using fallback GPS: ${finalLat}, ${finalLon}`);
            } else {
                console.log(`  Found GPS: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
            }

            // Get datetime
            const timeStr = this.getDateTime(exifData, inputPath);
            console.log(`  Time: ${timeStr}`);

            // Read image
            const imageBuffer = fs.readFileSync(inputPath);

            // Add text overlay
            const processedBuffer = await this.addTextOverlay(imageBuffer, finalLat, finalLon, timeStr);

            // Save processed image
            fs.writeFileSync(outputPath, processedBuffer);
            console.log(`  Saved: ${outputPath}`);
            return true;

        } catch (error) {
            console.error(`Error processing ${inputPath}: ${error.message}`);
            return false;
        }
    }

    async processFolder(inputFolder, outputFolder) {
        try {
            if (!fs.existsSync(inputFolder)) {
                console.error(`Error: Input folder ${inputFolder} does not exist`);
                return;
            }

            // Create output folder if it doesn't exist
            if (!fs.existsSync(outputFolder)) {
                fs.mkdirSync(outputFolder, { recursive: true });
            }

            // Supported image extensions
            const extensions = ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'];
            
            // Get all image files
            const files = fs.readdirSync(inputFolder);
            const imageFiles = files.filter(file => 
                extensions.some(ext => file.endsWith(ext))
            );

            if (imageFiles.length === 0) {
                console.log(`No images found in ${inputFolder}`);
                return;
            }

            console.log(`Found ${imageFiles.length} images to process`);
            console.log('='.repeat(50));

            let successCount = 0;
            
            for (const file of imageFiles) {
                const inputPath = path.join(inputFolder, file);
                const outputPath = path.join(outputFolder, file);
                
                const success = await this.processImage(inputPath, outputPath);
                if (success) {
                    successCount++;
                }
            }

            console.log('='.repeat(50));
            console.log(`Processing complete: ${successCount}/${imageFiles.length} images processed successfully`);

        } catch (error) {
            console.error(`Error processing folder: ${error.message}`);
        }
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log('Usage: node image_gps_processor.js <input_folder> <output_folder> [config_file]');
        console.log('\nExample:');
        console.log('  node image_gps_processor.js ./input ./output');
        console.log('  node image_gps_processor.js ./input ./output my_config.json');
        return;
    }

    const [inputFolder, outputFolder, configFile] = args;
    const configPath = configFile || 'config.json';
    
    const processor = new ImageGPSProcessor(configPath);
    await processor.processFolder(inputFolder, outputFolder);
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = ImageGPSProcessor;
