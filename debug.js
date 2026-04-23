// Debug script to test ZIP creation
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

async function testZip() {
    try {
        console.log('Starting ZIP test...');
        
        const outputDir = path.join(__dirname, 'output');
        console.log('Output dir:', outputDir);
        console.log('Exists:', fs.existsSync(outputDir));
        
        if (!fs.existsSync(outputDir)) {
            console.log('Creating output directory...');
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const files = fs.readdirSync(outputDir);
        console.log('Files found:', files);
        
        const imageFiles = files.filter(file => 
            file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
        );
        
        console.log('Image files:', imageFiles);
        
        if (imageFiles.length === 0) {
            console.log('No image files to test with');
            return;
        }
        
        // Create test ZIP
        const outputPath = path.join(__dirname, 'test.zip');
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.on('error', (err) => {
            console.error('Archive error:', err);
        });
        
        archive.on('end', () => {
            console.log('Archive created, size:', archive.pointer());
        });
        
        output.on('close', () => {
            console.log('ZIP file created successfully!');
            console.log('File size:', fs.statSync(outputPath).size, 'bytes');
        });
        
        archive.pipe(output);
        
        // Add files
        imageFiles.forEach(file => {
            const filePath = path.join(outputDir, file);
            console.log('Adding:', file);
            archive.file(filePath, { name: file });
        });
        
        archive.finalize();
        
    } catch (error) {
        console.error('Test error:', error);
    }
}

testZip();
