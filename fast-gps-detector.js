const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');

class FastGPSDetector {
    constructor(config = {}) {
        this.config = {
            confidence: config.confidence || 0.6,
            borderPercent: config.borderPercent || 0.25,
            enableSafety: config.enableSafety !== false,
            debug: config.debug || false,
            mode: config.mode || 'fast' // 'fast' or 'ai'
        };
        
        // Simplified GPS patterns for fast detection
        this.gpsPatterns = {
            coordinates: [
                /\d+\.\d+,\s*\d+\.\d+/g,      // 21.0285, 105.8542
                /\d+\.\d+\s*[,;]\s*\d+\.\d+/g, // 21.0285;105.8542
                /Lat:\s*\d+\.\d+/gi,           // Lat: 21.0285
                /Lon:\s*\d+\.\d+/gi,            // Lon: 105.8542
                /Latitude:\s*\d+\.\d+/gi,        // Latitude: 21.0285
                /Longitude:\s*\d+\.\d+/gi           // Longitude: 105.8542
            ],
            timestamps: [
                /\d{1,2}:\d{2}(:\d{2})?/g,     // 16:30 or 16:30:45
                /\d{1,2}h\d{2}/g,               // 16h30
                /\d{1,2}:\d{2}\s*(AM|PM)/gi    // 4:30 PM
            ],
            dates: [
                /\d{4}[-\/]\d{2}[-\/]\d{2}/g,   // 2026-04-23
                /\d{2}[-\/]\d{2}[-\/]\d{4}/g,   // 23-04-2026
                /\d{2}\/\d{2}\/\d{4}/g,         // 23/04/2026
                /\d{2}-\d{2}-\d{4}/g             // 23-04-2026
            ],
            keywords: [
                /(GPS|Lat|Lon|Latitude|Longitude)/gi,
                /(Vị trí|Tọa độ|Kinh độ|Vĩ độ)/gi,
                /(Ngày|Tháng|Năm|Date|Time)/gi,
                /(Camera|iPhone|Samsung|Xiaomi|OPPO)/gi
            ]
        };
        
        // Essential safe patterns (minimal set)
        this.safePatterns = {
            documents: [
                /(Hợp đồng|Contract|Agreement)/gi,
                /(Báo cáo|Report|Summary)/gi
            ],
            signs: [
                /(Cấm|Stop|Warning|Danger)/gi
            ],
            personal: [
                /(Tên|Name|Address|Phone)/gi
            ]
        };
    }
    
    // Fast detection method
    async detectGPSText(imageBuffer) {
        try {
            console.log('⚡ FAST GPS Detection - Quick analysis...');
            
            // Step 1: Get image dimensions
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width;
            const height = metadata.height;
            
            // Step 2: Fast border scanning only
            const regions = this.getBorderRegions(width, height);
            const allDetections = [];
            
            for (const region of regions) {
                const detections = await this.fastScanRegion(imageBuffer, region);
                allDetections.push(...detections);
            }
            
            // Step 3: Quick classification
            const gpsDetections = this.fastFilterGPSText(allDetections);
            
            console.log(`⚡ Fast Detection Results: ${allDetections.length} total, ${gpsDetections.length} GPS text`);
            
            return gpsDetections;
            
        } catch (error) {
            console.error('❌ Fast Detection Error:', error);
            return [];
        }
    }
    
    // Get only border regions (no full image scan)
    getBorderRegions(width, height) {
        const borderPercent = this.config.borderPercent;
        
        return [
            // Only scan borders where GPS text usually appears
            {
                name: 'top-border',
                x: 0,
                y: 0,
                width: width,
                height: height * borderPercent,
                priority: 1
            },
            {
                name: 'bottom-border',
                x: 0,
                y: height - (height * borderPercent),
                width: width,
                height: height * borderPercent,
                priority: 1
            },
            {
                name: 'left-border',
                x: 0,
                y: 0,
                width: width * borderPercent,
                height: height,
                priority: 1
            },
            {
                name: 'right-border',
                x: width - (width * borderPercent),
                y: 0,
                width: width * borderPercent,
                height: height,
                priority: 1
            }
        ];
    }
    
    // Fast OCR with minimal configuration
    async fastScanRegion(imageBuffer, region) {
        try {
            // Crop region
            const regionBuffer = await sharp(imageBuffer)
                .extract({
                    left: Math.round(region.x),
                    top: Math.round(region.y),
                    width: Math.round(region.width),
                    height: Math.round(region.height)
                })
                .jpeg({ quality: 90 }) // Lower quality for speed
                .toBuffer();
            
            // Fast OCR with minimal settings - try English first, then Vietnamese
            let data;
            try {
                data = await Tesseract.recognize(regionBuffer, 'eng', {
                    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                    tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS',
                    preserve_interword_spaces: '0',
                    tessedit_ocr_engine_mode: '1',
                    tessedit_create_hocr: '0',
                    tessedit_create_tsv: '0'
                });
            } catch (engError) {
                // Fallback to Vietnamese
                data = await Tesseract.recognize(regionBuffer, 'vie', {
                    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                    tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS Vị trí Ngày Tháng Năm Giờ Phút Giây',
                    preserve_interword_spaces: '0',
                    tessedit_ocr_engine_mode: '1',
                    tessedit_create_hocr: '0',
                    tessedit_create_tsv: '0'
                });
            }
            
            // Quick processing
            const words = [];
            if (data.words && Array.isArray(data.words)) {
                for (const word of data.words) {
                    if (word.text.trim().length > 1 && word.confidence > 20) { // Lower threshold for better detection
                        words.push({
                            x: region.x + word.bbox.x0,
                            y: region.y + word.bbox.y0,
                            width: word.bbox.x1 - word.bbox.x0,
                            height: word.bbox.y1 - word.bbox.y0,
                            text: word.text.trim(),
                            confidence: word.confidence || 0,
                            region: region.name
                        });
                    }
                }
            }
            
            // Also check the full text for patterns
            if (data.text && data.text.trim()) {
                const fullText = data.text.trim();
                const lines = fullText.split('\n');
                for (const line of lines) {
                    if (line.trim().length > 1) {
                        words.push({
                            x: region.x,
                            y: region.y,
                            width: region.width,
                            height: 20, // Approximate line height
                            text: line.trim(),
                            confidence: 50,
                            region: region.name
                        });
                    }
                }
            }
            
            if (this.config.debug) {
                console.log(`⚡ Region ${region.name}: Found ${words.length} text elements`);
                words.forEach((word, index) => {
                    console.log(`  📍 Text ${index + 1}: "${word.text}" (confidence: ${word.confidence})`);
                });
            }
            
            return words;
            
        } catch (error) {
            console.error(`❌ Error scanning region ${region.name}:`, error);
            return [];
        }
    }
    
    // Fast filtering with simple rules
    fastFilterGPSText(detections) {
        return detections.filter(detection => {
            const text = detection.text;
            
            // Quick safety check
            if (this.config.enableSafety) {
                for (const [category, patterns] of Object.entries(this.safePatterns)) {
                    if (patterns.some(pattern => pattern.test(text))) {
                        console.log(`🛡️ Protected text: "${text}" (${category})`);
                        return false;
                    }
                }
            }
            
            // Quick GPS pattern matching
            let gpsScore = 0;
            
            // Check coordinates (highest weight)
            if (this.gpsPatterns.coordinates.some(pattern => pattern.test(text))) {
                gpsScore += 0.5;
            }
            
            // Check timestamps
            if (this.gpsPatterns.timestamps.some(pattern => pattern.test(text))) {
                gpsScore += 0.3;
            }
            
            // Check dates
            if (this.gpsPatterns.dates.some(pattern => pattern.test(text))) {
                gpsScore += 0.2;
            }
            
            // Check keywords
            if (this.gpsPatterns.keywords.some(pattern => pattern.test(text))) {
                gpsScore += 0.4;
            }
            
            // Position bonus (GPS usually in borders)
            if (detection.region.includes('border')) {
                gpsScore += 0.2;
            }
            
            // Confidence bonus
            if (detection.confidence > 60) {
                gpsScore += 0.1;
            }
            
            const isLikelyGPS = gpsScore >= this.config.confidence;
            
            if (this.config.debug && isLikelyGPS) {
                console.log(`🎯 GPS Text: "${text}" (Score: ${gpsScore.toFixed(2)})`);
            }
            
            return isLikelyGPS;
        });
    }
    
    // Create mask from GPS text regions
    createMaskFromRegions(imageBuffer, gpsRegions) {
        return gpsRegions.map(region => ({
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            text: region.text,
            confidence: region.confidence
        }));
    }
}

module.exports = FastGPSDetector;
