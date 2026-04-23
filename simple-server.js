const express = require('express');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files
app.use(express.static('public'));

app.get('/export', async (req, res) => {
    try {
        console.log('Export request received');
        
        const outputDir = path.join(__dirname, 'output');
        console.log('Output directory:', outputDir);
        
        if (!fs.existsSync(outputDir)) {
            console.log('Output directory does not exist');
            return res.status(404).json({ error: 'No processed images found' });
        }

        const allFiles = fs.readdirSync(outputDir);
        console.log('All files:', allFiles);
        
        const files = allFiles.filter(file => 
            file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
        );

        console.log('Image files:', files);

        if (files.length === 0) {
            return res.status(404).json({ error: 'No processed images found' });
        }

        // Create ZIP archive
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        // Set response headers
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `processed_images_${timestamp}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        console.log('Creating ZIP:', filename);
        
        // Handle archive events
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            throw err;
        });

        archive.on('end', () => {
            console.log('Archive completed, size:', archive.pointer());
        });

        // Pipe archive to response
        archive.pipe(res);

        // Add files
        files.forEach(file => {
            const filePath = path.join(outputDir, file);
            console.log('Adding file:', file);
            archive.file(filePath, { name: file });
        });

        // Add log file
        const logData = {
            exportTime: new Date().toISOString(),
            totalImages: files.length,
            imageList: files
        };
        
        archive.append(JSON.stringify(logData, null, 2), { name: 'processing_log.json' });

        // Finalize
        archive.finalize();

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Simple server running at http://localhost:${PORT}`);
});
