const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const cors = require('cors');

const app = express();
const PORT = process.argv.includes('--port') ? parseInt(process.argv[process.argv.indexOf('--port') + 1]) : 3002;

// Enable CORS for all routes
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true
}));

// Serve static files
app.use(express.static('public'));

// Test endpoint
app.get('/', (req, res) => {
    res.send('Server is running! <a href="/export">Test ZIP export</a>');
});

// Simple ZIP export
app.get('/export', async (req, res) => {
    try {
        console.log('=== ZIP Export Request ===');
        
        const outputDir = path.join(__dirname, 'output');
        console.log('Output directory:', outputDir);
        console.log('Directory exists:', fs.existsSync(outputDir));
        
        if (!fs.existsSync(outputDir)) {
            console.log('ERROR: Output directory does not exist');
            return res.status(404).json({ error: 'Output directory not found' });
        }

        const allFiles = fs.readdirSync(outputDir);
        console.log('All files in directory:', allFiles.length);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        console.log('ZIP filename:', filename);
        
        // Event handlers
        archive.on('error', (err) => {
            console.error('ARCHIVE ERROR:', err);
            throw err;
        });

        archive.on('end', () => {
            console.log('✅ ZIP completed, size:', archive.pointer(), 'bytes');
        });

        // Pipe to response
        archive.pipe(res);

        // Add files one by one
        console.log('Adding files to ZIP...');
        imageFiles.forEach((file, index) => {
            const filePath = path.join(outputDir, file);
            console.log(`  ${index + 1}. Adding: ${file}`);
            archive.file(filePath, { name: file });
        });

        // Add log file
        const logData = {
            exportTime: new Date().toISOString(),
            totalImages: imageFiles.length,
            imageList: imageFiles
        };
        
        console.log('Adding processing log...');
        archive.append(JSON.stringify(logData, null, 2), { name: 'processing_log.json' });

        console.log('Finalizing ZIP...');
        archive.finalize();

    } catch (error) {
        console.error('=== EXPORT ERROR ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Minimal server running at http://localhost:${PORT}`);
    console.log('📁 Output directory:', path.join(__dirname, 'output'));
    console.log('🔗 Test ZIP export: http://localhost:' + PORT + '/export');
});
