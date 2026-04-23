const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Test basic server
app.get('/', (req, res) => {
  res.send('Server is working!');
});

app.get('/test-zip', async (req, res) => {
  try {
    const archiver = require('archiver');
    const outputDir = path.join(__dirname, 'output');
    
    console.log('Output dir:', outputDir);
    console.log('Exists:', fs.existsSync(outputDir));
    
    if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ error: 'Output directory not found' });
    }
    
    const files = fs.readdirSync(outputDir);
    console.log('All files:', files);
    
    const imageFiles = files.filter(file => 
      file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
    );
    
    console.log('Image files:', imageFiles);
    
    if (imageFiles.length === 0) {
      return res.status(404).json({ error: 'No images found' });
    }
    
    // Create ZIP
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="test.zip"');
    
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      throw err;
    });
    
    archive.on('end', () => {
      console.log('Archive completed, size:', archive.pointer());
    });
    
    archive.pipe(res);
    
    // Add files
    imageFiles.forEach(file => {
      const filePath = path.join(outputDir, file);
      console.log('Adding:', file);
      archive.file(filePath, { name: file });
    });
    
    archive.finalize();
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
});
