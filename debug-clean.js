const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'output');

console.log('🔍 DEBUGGING CLEANING ISSUE...');
console.log('Output directory:', outputDir);

// Check current state
if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir);
    console.log('📁 Current files in output directory:', files.length);
    console.log('📋 File list:', files);
    
    // Try to delete each file
    console.log('🗑️ Attempting to delete files...');
    files.forEach((file, index) => {
        const filePath = path.join(outputDir, file);
        try {
            fs.unlinkSync(filePath);
            console.log(`✅ ${index + 1}. Deleted: ${file}`);
        } catch (err) {
            console.error(`❌ ${index + 1}. Error deleting ${file}:`, err.message);
        }
    });
    
    // Check remaining files
    const remainingFiles = fs.readdirSync(outputDir);
    console.log('📊 Remaining files after deletion:', remainingFiles.length);
    console.log('📋 Remaining file list:', remainingFiles);
    
} else {
    console.log('📁 Output directory does not exist');
}

console.log('✅ Debug complete');
