const sharp = require('sharp');
const Jimp = require('jimp');
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');

class SimpleTextRemover {
    constructor(config = {}) {
        this.config = {
            borderPercent: config.borderPercent || 0.3,
            confidence: config.confidence || 30,
            debug: config.debug || false
        };
    }
    
    // Simple but effective text removal
    async removeAllTextFromBorders(imageBuffer) {
        try {
            console.log('🔥 SIMPLE TEXT REMOVER - Removing ALL text from borders...');
            
            // Step 1: Get image dimensions
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width;
            const height = metadata.height;
            
            // Step 2: Define border regions
            const borderRegions = this.getBorderRegions(width, height);
            
            // Step 3: Scan each border for text
            let allTextRegions = [];
            
            for (const region of borderRegions) {
                console.log(`🔍 Scanning ${region.name}...`);
                const textRegions = await this.scanRegionForText(imageBuffer, region);
                allTextRegions.push(...textRegions);
            }
            
            // Step 4: Remove all detected text
            if (allTextRegions.length > 0) {
                console.log(`🎯 Found ${allTextRegions.length} text regions to remove`);
                
                // Log detected text
                allTextRegions.forEach((region, index) => {
                    console.log(`  📍 Text ${index + 1}: "${region.text}" at (${region.x}, ${region.y})`);
                });
                
                const processedBuffer = await this.removeTextRegions(imageBuffer, allTextRegions);
                console.log('✅ Simple text removal completed');
                return processedBuffer;
            } else {
                console.log('⚠️ No text found in borders');
                return imageBuffer;
            }
            
        } catch (error) {
            console.error('❌ Simple text removal error:', error);
            return imageBuffer;
        }
    }
    
    // Get border regions
    getBorderRegions(width, height) {
        const borderPercent = this.config.borderPercent;
        
        return [
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
    }
    
    // Scan region for any text
    async scanRegionForText(imageBuffer, region) {
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
            
            // OCR with very permissive settings
            const { data } = await Tesseract.recognize(regionBuffer, 'eng+vie', {
                tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                tessedit_char_whitelist: '0123456789.-:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz°N S E W Lat Lon Time Date GPS Vị trí Ngày Tháng Năm Giờ Phút Giây .,!?@#$%^&*()_+-=[]{}|;:"\'<>',
                preserve_interword_spaces: '1',
                tessedit_ocr_engine_mode: '1',
                tessedit_create_hocr: '0',
                tessedit_create_tsv: '0'
            });
            
            // Process all detected text
            const textRegions = [];
            
            // Process words
            if (data.words && Array.isArray(data.words)) {
                for (const word of data.words) {
                    if (word.text.trim().length > 0 && word.confidence > this.config.confidence) {
                        textRegions.push({
                            x: region.x + word.bbox.x0,
                            y: region.y + word.bbox.y0,
                            width: word.bbox.x1 - word.bbox.x0,
                            height: word.bbox.y1 - word.bbox.y0,
                            text: word.text.trim(),
                            confidence: word.confidence || 0,
                            border: region.name
                        });
                    }
                }
            }
            
            // Also process full text lines
            if (data.text && data.text.trim()) {
                const lines = data.text.trim().split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.length > 0) {
                        textRegions.push({
                            x: region.x,
                            y: region.y + (i * 25), // Approximate line spacing
                            width: region.width,
                            height: 20,
                            text: line,
                            confidence: 50,
                            border: region.name
                        });
                    }
                }
            }
            
            if (this.config.debug) {
                console.log(`  📝 ${region.name}: Found ${textRegions.length} text elements`);
            }
            
            return textRegions;
            
        } catch (error) {
            console.error(`❌ Error scanning ${region.name}:`, error);
            return [];
        }
    }
    
    // Remove text regions with aggressive inpainting
    async removeTextRegions(imageBuffer, textRegions) {
        try {
            // Convert to Jimp for processing
            const image = await Jimp.read(imageBuffer);
            const width = image.getWidth();
            const height = image.getHeight();
            
            for (const region of textRegions) {
                console.log(`  🎨 Removing: "${region.text}" from ${region.border}`);
                
                // Add padding for complete coverage
                const padding = 5;
                const x = Math.max(0, region.x - padding);
                const y = Math.max(0, region.y - padding);
                const w = Math.min(width - x, region.width + padding * 2);
                const h = Math.min(height - y, region.height + padding * 2);
                
                // Aggressive inpainting - blur and blend
                for (let py = y; py < y + h; py++) {
                    for (let px = x; px < x + w; px++) {
                        // Sample from larger area for better blending
                        const sampleSize = 15;
                        let r = 0, g = 0, b = 0, count = 0;
                        
                        for (let dy = -sampleSize; dy <= sampleSize; dy += 3) {
                            for (let dx = -sampleSize; dx <= sampleSize; dx += 3) {
                                const sx = px + dx;
                                const sy = py + dy;
                                
                                if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                                    const color = Jimp.intToRGBA(image.getPixelColor(sx, sy));
                                    r += color.r;
                                    g += color.g;
                                    b += color.b;
                                    count++;
                                }
                            }
                        }
                        
                        if (count > 0) {
                            // Apply averaged color with some blur
                            const avgR = Math.round(r / count);
                            const avgG = Math.round(g / count);
                            const avgB = Math.round(b / count);
                            
                            // Add some noise for natural look
                            const noise = 10;
                            const finalR = Math.max(0, Math.min(255, avgR + (Math.random() - 0.5) * noise));
                            const finalG = Math.max(0, Math.min(255, avgG + (Math.random() - 0.5) * noise));
                            const finalB = Math.max(0, Math.min(255, avgB + (Math.random() - 0.5) * noise));
                            
                            const finalColor = Jimp.rgbaToInt(finalR, finalG, finalB, 255);
                            image.setPixelColor(finalColor, px, py);
                        }
                    }
                }
            }
            
            // Convert back to buffer
            const processedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
            return processedBuffer;
            
        } catch (error) {
            console.error('❌ Error removing text regions:', error);
            return imageBuffer;
        }
    }
}

module.exports = SimpleTextRemover;
