const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');

class AIGPSDetector {
    constructor(config = {}) {
        this.config = {
            confidence: config.confidence || 0.7,
            borderPercent: config.borderPercent || 0.3,
            enableSafety: config.enableSafety !== false,
            debug: config.debug || false
        };
        
        // GPS text patterns for classification
        this.gpsPatterns = {
            coordinates: [
                /\d+\.\d+,\s*\d+\.\d+/,      // 21.0285, 105.8542
                /\d+\.\d+\s*[,;]\s*\d+\.\d+/, // 21.0285;105.8542
                /Lat:\s*\d+\.\d+/,            // Lat: 21.0285
                /Lon:\s*\d+\.\d+/,            // Lon: 105.8542
                /Latitude:\s*\d+\.\d+/,        // Latitude: 21.0285
                /Longitude:\s*\d+\.\d+/           // Longitude: 105.8542
            ],
            timestamps: [
                /\d{1,2}:\d{2}(:\d{2})?/,     // 16:30 or 16:30:45
                /\d{1,2}h\d{2}/,               // 16h30
                /\d{1,2}:\d{2}\s*(AM|PM)/i    // 4:30 PM
            ],
            dates: [
                /\d{4}[-\/]\d{2}[-\/]\d{2}/,   // 2026-04-23
                /\d{2}[-\/]\d{2}[-\/]\d{4}/,   // 23-04-2026
                /\d{2}\/\d{2}\/\d{4}/,         // 23/04/2026
                /\d{2}-\d{2}-\d{4}/             // 23-04-2026
            ],
            keywords: [
                /(GPS|Lat|Lon|Latitude|Longitude)/i,
                /(Vị trí|Tọa độ|Kinh độ|Vĩ độ)/i,
                /(Ngày|Tháng|Năm|Date|Time)/i,
                /(Camera|iPhone|Samsung|Xiaomi|OPPO)/i
            ]
        };
        
        // Safe text patterns to protect
        this.safePatterns = {
            documents: [
                /(Hợp đồng|Contract|Agreement)/i,
                /(Báo cáo|Report|Summary)/i,
                /(Hóa đơn|Invoice|Bill)/i
            ],
            signs: [
                /(Cấm|Stop|Warning|Danger)/i,
                /(Lối đi|Exit|Entrance)/i
            ],
            personal: [
                /(Tên|Name|Address|Phone)/i,
                /(Email|Contact)/i
            ],
            artistic: [
                /(Copyright|©|®|™)/i,
                /(Watermark|Logo)/i
            ]
        };
    }
    
    // Main detection method
    async detectGPSText(imageBuffer) {
        try {
            console.log('🤖 AI GPS Detection - Starting analysis...');
            
            // Step 1: Get image dimensions
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width;
            const height = metadata.height;
            
            // Step 2: Multi-region scanning
            const regions = this.getScanRegions(width, height);
            const allDetections = [];
            
            for (const region of regions) {
                const detections = await this.scanRegion(imageBuffer, region);
                allDetections.push(...detections);
            }
            
            // Step 3: Classify and filter detections
            const classifiedDetections = await this.classifyDetections(allDetections, width, height);
            const gpsDetections = this.filterGPSText(classifiedDetections);
            
            console.log(`🤖 AI Detection Results: ${allDetections.length} total, ${gpsDetections.length} GPS text`);
            
            return gpsDetections;
            
        } catch (error) {
            console.error('❌ AI Detection Error:', error);
            return [];
        }
    }
    
    // Optimized scanning regions (borders only for speed)
    getScanRegions(width, height) {
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
    
    // Scan individual region with enhanced OCR
    async scanRegion(imageBuffer, region) {
        try {
            // Crop region
            const regionBuffer = await sharp(imageBuffer)
                .extract({
                    left: Math.round(region.x),
                    top: Math.round(region.y),
                    width: Math.round(region.width),
                    height: Math.round(region.height)
                })
                .jpeg({ quality: 95 })
                .toBuffer();
            
            // Optimized OCR - single call for speed
            const ocrResult = await this.performOCR(regionBuffer, 'eng+vie', 'AUTO');
            
            // Process single result
            const mergedResults = this.processOCRResult(ocrResult, region);
            
            if (this.config.debug) {
                console.log(`🔍 Region ${region.name}: Found ${mergedResults.length} text elements`);
            }
            
            return mergedResults;
            
        } catch (error) {
            console.error(`❌ Error scanning region ${region.name}:`, error);
            return [];
        }
    }
    
    // Optimized OCR with single configuration for speed
    async performOCR(imageBuffer, languages, pageMode) {
        try {
            const { data } = await Tesseract.recognize(imageBuffer, languages, {
                tessedit_pageseg_mode: Tesseract.PSM.AUTO, // Only AUTO for speed
                tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS Vị trí Ngày Tháng Năm Giờ Phút Giây .,!?@#$%^&*()_+-=[]{}|;:"\'<>',
                preserve_interword_spaces: '1',
                tessedit_ocr_engine_mode: '1',
                tessedit_create_hocr: '0',
                tessedit_create_tsv: '1'
            });
            
            return data;
        } catch (error) {
            console.error('❌ OCR Error:', error);
            return { words: [], text: '' };
        }
    }
    
    // Process single OCR result for speed
    processOCRResult(ocrResult, region) {
        const allWords = [];
        
        if (ocrResult.words && Array.isArray(ocrResult.words)) {
            for (const word of ocrResult.words) {
                if (word.text.trim().length > 0) {
                    allWords.push({
                        x: region.x + word.bbox.x0,
                        y: region.y + word.bbox.y0,
                        width: word.bbox.x1 - word.bbox.x0,
                        height: word.bbox.y1 - word.bbox.y0,
                        text: word.text.trim(),
                        confidence: word.confidence || 0,
                        region: region.name,
                        priority: region.priority
                    });
                }
            }
        }
        
        return allWords;
    }
    
    // Classify detections with AI-like analysis
    async classifyDetections(detections, imageWidth, imageHeight) {
        return detections.map(detection => {
            const classification = this.analyzeText(detection.text);
            const context = this.analyzeContext(detection, imageWidth, imageHeight);
            const gpsProbability = this.calculateGPSProbability(classification, context);
            
            return {
                ...detection,
                classification,
                context,
                gpsProbability,
                isLikelyGPS: gpsProbability > this.config.confidence
            };
        });
    }
    
    // Analyze text content
    analyzeText(text) {
        const classification = {
            isCoordinate: false,
            isTimestamp: false,
            isDate: false,
            hasGPSKeywords: false,
            hasSafePatterns: false
        };
        
        // Check GPS patterns
        classification.isCoordinate = this.gpsPatterns.coordinates.some(pattern => pattern.test(text));
        classification.isTimestamp = this.gpsPatterns.timestamps.some(pattern => pattern.test(text));
        classification.isDate = this.gpsPatterns.dates.some(pattern => pattern.test(text));
        classification.hasGPSKeywords = this.gpsPatterns.keywords.some(pattern => pattern.test(text));
        
        // Check safe patterns
        for (const [category, patterns] of Object.entries(this.safePatterns)) {
            if (patterns.some(pattern => pattern.test(text))) {
                classification.hasSafePatterns = true;
                classification.safeCategory = category;
                break;
            }
        }
        
        return classification;
    }
    
    // Analyze context (position, size, etc.)
    analyzeContext(detection, imageWidth, imageHeight) {
        const borderPercent = this.config.borderPercent;
        
        return {
            isNearBorder: detection.y < imageHeight * borderPercent || 
                          detection.y > imageHeight * (1 - borderPercent) ||
                          detection.x < imageWidth * borderPercent || 
                          detection.x > imageWidth * (1 - borderPercent),
            isSmallText: detection.width < 200 && detection.height < 30,
            isHighContrast: detection.confidence > 60,
            regionPriority: detection.priority
        };
    }
    
    // Calculate GPS probability with weighted scoring
    calculateGPSProbability(classification, context) {
        let score = 0;
        
        // Text content scoring (40% weight)
        if (classification.isCoordinate) score += 0.4;
        if (classification.isTimestamp) score += 0.3;
        if (classification.isDate) score += 0.2;
        if (classification.hasGPSKeywords) score += 0.3;
        
        // Context scoring (35% weight)
        if (context.isNearBorder) score += 0.35;
        if (context.isSmallText) score += 0.15;
        if (context.isHighContrast) score += 0.2;
        
        // Safety scoring (25% weight - negative)
        if (classification.hasSafePatterns) {
            score -= 0.5; // Heavy penalty for safe text
        }
        
        return Math.max(0, Math.min(1, score));
    }
    
    // Filter GPS text with safety checks
    filterGPSText(detections) {
        if (!this.config.enableSafety) {
            return detections.filter(d => d.isLikelyGPS);
        }
        
        return detections.filter(detection => {
            // Must be likely GPS
            if (!detection.isLikelyGPS) return false;
            
            // Must not be safe text
            if (detection.classification.hasSafePatterns) {
                console.log(`🛡️ Protected text: "${detection.text}" (${detection.classification.safeCategory})`);
                return false;
            }
            
            // Must meet minimum confidence
            if (detection.gpsProbability < this.config.confidence) return false;
            
            return true;
        });
    }
    
    // Create mask from GPS text regions
    createMaskFromRegions(imageBuffer, gpsRegions) {
        // This would be implemented with advanced inpainting
        // For now, return region coordinates for processing
        return gpsRegions.map(region => ({
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            text: region.text,
            confidence: region.gpsProbability
        }));
    }
}

module.exports = AIGPSDetector;
