# Image GPS and Time Text Processor

Batch processing tool to add standardized GPS and time text overlays to images.

## Features

- **Batch Processing**: Process entire folders of images at once
- **EXIF Metadata Reading**: Automatically extracts GPS coordinates and datetime from image EXIF data
- **Fallback Values**: Uses configurable fallback GPS/time when metadata is missing
- **Text Overlay**: Covers existing text with black rectangle and adds new standardized text
- **Multiple Formats**: Supports JPG, JPEG, PNG formats
- **Configurable**: Customizable text position, colors, font size, and more

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure settings (optional):
Edit `config.json` to customize fallback GPS, text position, colors, etc.

## Usage

### Basic Usage
```bash
python image_gps_processor.py <input_folder> <output_folder>
```

### With Custom Config
```bash
python image_gps_processor.py <input_folder> <output_folder> <config_file>
```

### Examples
```bash
# Process images in 'input' folder, save to 'output' folder
python image_gps_processor.py ./input ./output

# Use custom configuration
python image_gps_processor.py ./input ./output my_config.json
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
4. **Add New Text**: Overlay standardized GPS and time information
5. **Save Output**: Preserve original filename in output folder

## Text Format

The overlay adds two lines of text:
```
Lat: {latitude}, Lon: {longitude}
Time: {YYYY-MM-DD HH:MM:SS}
```

## File Structure

```
├── image_gps_processor.py  # Main processing script
├── config.json             # Configuration file
├── requirements.txt        # Python dependencies
└── README.md              # This file
```

## Notes

- Processes images with or without existing GPS/time metadata
- Always covers the bottom portion of the image (configurable height)
- Maintains original image quality (95% JPEG quality)
- Handles PNG transparency by converting to RGB
- Creates output folder if it doesn't exist
