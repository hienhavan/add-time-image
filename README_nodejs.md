# Image GPS and Time Text Processor (Node.js Version)

Batch processing tool to add standardized GPS and time text overlays to images using Node.js.

## Features

- **Batch Processing**: Process entire folders of images at once
- **EXIF Metadata Reading**: Automatically extracts GPS coordinates and datetime from image EXIF data
- **Fallback Values**: Uses configurable fallback GPS/time when metadata is missing
- **Text Overlay**: Covers existing text with black rectangle and adds new standardized text
- **Multiple Formats**: Supports JPG, JPEG, PNG formats
- **High Performance**: Uses Sharp for fast image processing
- **Configurable**: Customizable text position, colors, font size, and more

## Installation

1. Install Node.js dependencies:
```bash
npm install
```

2. Configure settings (optional):
Edit `config.json` to customize fallback GPS, text position, colors, etc.

## Usage

### Basic Usage
```bash
node image_gps_processor.js <input_folder> <output_folder>
```

### With Custom Config
```bash
node image_gps_processor.js <input_folder> <output_folder> <config_file>
```

### Examples
```bash
# Process images in 'input' folder, save to 'output' folder
node image_gps_processor.js ./input ./output

# Use custom configuration
node image_gps_processor.js ./input ./output my_config.json
```

## Configuration

Edit `config.json` to customize:

- **fallback_gps**: Default GPS coordinates when image has no GPS data
- **text_position**: Where to place text (`bottom-left`, `bottom-right`, `bottom-center`)
- **rectangle_color**: Color of covering rectangle (default: black)
- **text_color**: Text color (default: white)
- **font_size**: Text size in pixels
- **padding**: Text padding from edges
- **rectangle_height_percent**: Height of covering rectangle as % of image height

## Processing Logic

1. **Read EXIF Data**: Extract GPS coordinates and DateTimeOriginal from image metadata
2. **Fallback Handling**: Use configured values when metadata is missing
3. **Cover Old Text**: Draw black rectangle at bottom to cover existing text
4. **Add New Text**: Overlay standardized GPS and time information using SVG
5. **Save Output**: Preserve original filename in output folder

## Text Format

The overlay adds two lines of text:
```
Lat: {latitude}, Lon: {longitude}
Time: {YYYY-MM-DD HH:MM:SS}
```

## Dependencies

- **sharp**: High-performance image processing library
- **exif-parser**: Library for reading EXIF metadata from images

## File Structure

```
├── image_gps_processor.js  # Main processing script
├── package.json            # Node.js dependencies and scripts
├── config.json             # Configuration file
├── requirements.txt        # Python dependencies (from previous version)
├── image_gps_processor.py  # Python version (for reference)
└── README_nodejs.md        # This file
```

## Notes

- Processes images with or without existing GPS/time metadata
- Always covers the bottom portion of the image (configurable height)
- Maintains original image quality (95% JPEG quality)
- Handles PNG transparency automatically
- Creates output folder if it doesn't exist
- Uses SVG for text rendering to ensure crisp text at any resolution

## Performance

The Node.js version with Sharp is significantly faster than the Python version for batch processing, especially for large numbers of images.

## Error Handling

- Gracefully handles images without EXIF data
- Uses fallback values for missing GPS/time information
- Continues processing other images if one fails
- Provides detailed logging of processing status
