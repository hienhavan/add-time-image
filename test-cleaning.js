const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'output');

console.log('=== TESTING CLEANING PROCESS ===');

// Step 1: Check current state
console.log('\n📁 STEP 1: Current output directory state:');
if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir);
    console.log(`Files found: ${files.length}`);
    files.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file}`);
    });
} else {
    console.log('Directory does not exist');
}

// Step 2: Clean directory
console.log('\n🔥 STEP 2: Cleaning directory...');
try {
    if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        console.log(`Attempting to delete ${files.length} files...`);
        
        files.forEach((file, index) => {
            const filePath = path.join(outputDir, file);
            try {
                fs.unlinkSync(filePath);
                console.log(`✅ ${index + 1}. Deleted: ${file}`);
            } catch (err) {
                console.error(`❌ ${index + 1}. Failed to delete ${file}:`, err.message);
            }
        });
    }
} catch (error) {
    console.error('Error during cleaning:', error);
}

// Step 3: Verify clean
console.log('\n📊 STEP 3: Verification - checking if directory is clean:');
if (fs.existsSync(outputDir)) {
    const remainingFiles = fs.readdirSync(outputDir);
    console.log(`Remaining files: ${remainingFiles.length}`);
    if (remainingFiles.length > 0) {
        remainingFiles.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file}`);
        });
    } else {
        console.log('✅ Directory is completely clean!');
    }
}

// Step 4: Simulate adding new files
console.log('\n📝 STEP 4: Simulating new batch processing...');
const testFiles = ['test1.jpg', 'test2.jpg', 'test3.jpg'];
testFiles.forEach(file => {
    const filePath = path.join(outputDir, file);
    try {
        fs.writeFileSync(filePath, 'test content');
        console.log(`✅ Created test file: ${file}`);
    } catch (err) {
        console.error(`❌ Failed to create ${file}:`, err.message);
    }
});

// Step 5: Final check
console.log('\n📋 STEP 5: Final directory state:');
const finalFiles = fs.readdirSync(outputDir);
console.log(`Final files: ${finalFiles.length}`);
finalFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file}`);
});

console.log('\n=== CLEANING TEST COMPLETE ===');
