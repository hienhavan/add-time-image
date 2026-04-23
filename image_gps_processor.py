#!/usr/bin/env python3
"""
Batch Image GPS and Time Text Processor
Processes images in a folder to:
1. Read EXIF metadata (GPS and DateTime)
2. Cover existing text with black rectangle
3. Overlay new GPS and time information
"""

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Tuple, Optional
import json

from PIL import Image, ImageDraw, ImageFont
from PIL.ExifTags import TAGS, GPSTAGS


class ImageGPSProcessor:
    def __init__(self, config_path: str = "config.json"):
        """Initialize processor with configuration"""
        self.config = self.load_config(config_path)
        
    def load_config(self, config_path: str) -> dict:
        """Load configuration from file or create default"""
        default_config = {
            "fallback_gps": {
                "latitude": 21.0285,
                "longitude": 105.8542
            },
            "fallback_time_format": "%Y-%m-%d %H:%M:%S",
            "text_position": "bottom-left",
            "rectangle_color": "black",
            "text_color": "white",
            "font_size": 24,
            "padding": 10,
            "rectangle_height_percent": 0.15
        }
        
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    user_config = json.load(f)
                default_config.update(user_config)
            except Exception as e:
                print(f"Warning: Could not load config file {config_path}: {e}")
                print("Using default configuration")
        
        return default_config
    
    def get_exif_data(self, image_path: str) -> dict:
        """Extract EXIF data from image"""
        try:
            image = Image.open(image_path)
            exif_data = image._getexif()
            
            if not exif_data:
                return {}
            
            decoded_exif = {}
            for tag_id, value in exif_data.items():
                tag = TAGS.get(tag_id, tag_id)
                
                if tag == "GPSInfo":
                    gps_data = {}
                    for gps_tag_id, gps_value in value.items():
                        gps_tag = GPSTAGS.get(gps_tag_id, gps_tag_id)
                        gps_data[gps_tag] = gps_value
                    decoded_exif["GPSInfo"] = gps_data
                else:
                    decoded_exif[tag] = value
                    
            return decoded_exif
            
        except Exception as e:
            print(f"Error reading EXIF from {image_path}: {e}")
            return {}
    
    def convert_to_degrees(self, gps_value) -> float:
        """Convert GPS coordinates to decimal degrees"""
        degrees = float(gps_value[0])
        minutes = float(gps_value[1])
        seconds = float(gps_value[2])
        return degrees + (minutes / 60.0) + (seconds / 3600.0)
    
    def get_gps_coordinates(self, exif_data: dict) -> Tuple[float, float]:
        """Extract GPS coordinates from EXIF data"""
        if "GPSInfo" not in exif_data:
            return None, None
        
        gps_info = exif_data["GPSInfo"]
        
        try:
            # Get latitude
            if "GPSLatitude" in gps_info and "GPSLatitudeRef" in gps_info:
                lat = self.convert_to_degrees(gps_info["GPSLatitude"])
                if gps_info["GPSLatitudeRef"] == "S":
                    lat = -lat
            else:
                return None, None
            
            # Get longitude
            if "GPSLongitude" in gps_info and "GPSLongitudeRef" in gps_info:
                lon = self.convert_to_degrees(gps_info["GPSLongitude"])
                if gps_info["GPSLongitudeRef"] == "W":
                    lon = -lon
            else:
                return None, None
                
            return lat, lon
            
        except Exception as e:
            print(f"Error parsing GPS data: {e}")
            return None, None
    
    def get_datetime(self, exif_data: dict, image_path: str) -> str:
        """Get datetime from EXIF or file creation time"""
        # Try to get DateTimeOriginal from EXIF
        if "DateTimeOriginal" in exif_data:
            try:
                datetime_str = exif_data["DateTimeOriginal"]
                # Parse EXIF datetime format (YYYY:MM:DD HH:MM:SS)
                dt = datetime.strptime(datetime_str, "%Y:%m:%d %H:%M:%S")
                return dt.strftime(self.config["fallback_time_format"])
            except Exception as e:
                print(f"Error parsing DateTimeOriginal: {e}")
        
        # Fallback to file creation time
        try:
            file_time = os.path.getctime(image_path)
            dt = datetime.fromtimestamp(file_time)
            return dt.strftime(self.config["fallback_time_format"])
        except Exception as e:
            print(f"Error getting file time: {e}")
            return datetime.now().strftime(self.config["fallback_time_format"])
    
    def add_text_overlay(self, image: Image.Image, lat: float, lon: float, time_str: str) -> Image.Image:
        """Add black rectangle and text overlay to image"""
        draw = ImageDraw.Draw(image)
        width, height = image.size
        
        # Calculate rectangle dimensions
        rect_height = int(height * self.config["rectangle_height_percent"])
        rect_y = height - rect_height
        
        # Draw black rectangle to cover existing text
        draw.rectangle(
            [(0, rect_y), (width, height)],
            fill=self.config["rectangle_color"]
        )
        
        # Prepare text
        text_lines = [
            f"Lat: {lat:.6f}, Lon: {lon:.6f}",
            f"Time: {time_str}"
        ]
        
        # Try to load font, fallback to default
        try:
            font = ImageFont.truetype("arial.ttf", self.config["font_size"])
        except:
            try:
                font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", self.config["font_size"])
            except:
                font = ImageFont.load_default()
        
        # Calculate text position with padding
        padding = self.config["padding"]
        text_y = rect_y + padding
        
        for line in text_lines:
            # Get text dimensions
            bbox = draw.textbbox((0, 0), line, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            
            # Position text based on configuration
            if self.config["text_position"] == "bottom-left":
                text_x = padding
            elif self.config["text_position"] == "bottom-right":
                text_x = width - text_width - padding
            else:  # center
                text_x = (width - text_width) // 2
            
            # Draw text
            draw.text(
                (text_x, text_y),
                line,
                fill=self.config["text_color"],
                font=font
            )
            
            text_y += text_height + padding // 2
        
        return image
    
    def process_image(self, input_path: str, output_path: str) -> bool:
        """Process a single image"""
        try:
            print(f"Processing: {input_path}")
            
            # Read EXIF data
            exif_data = self.get_exif_data(input_path)
            
            # Get GPS coordinates
            lat, lon = self.get_gps_coordinates(exif_data)
            
            # Use fallback GPS if not found
            if lat is None or lon is None:
                lat = self.config["fallback_gps"]["latitude"]
                lon = self.config["fallback_gps"]["longitude"]
                print(f"  Using fallback GPS: {lat}, {lon}")
            else:
                print(f"  Found GPS: {lat:.6f}, {lon:.6f}")
            
            # Get datetime
            time_str = self.get_datetime(exif_data, input_path)
            print(f"  Time: {time_str}")
            
            # Open image and add overlay
            image = Image.open(input_path)
            
            # Convert to RGB if necessary (for PNG with transparency)
            if image.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', image.size, (0, 0, 0))
                if image.mode == 'P':
                    image = image.convert('RGBA')
                background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                image = background
            
            processed_image = self.add_text_overlay(image, lat, lon, time_str)
            
            # Save processed image
            processed_image.save(output_path, quality=95)
            print(f"  Saved: {output_path}")
            return True
            
        except Exception as e:
            print(f"Error processing {input_path}: {e}")
            return False
    
    def process_folder(self, input_folder: str, output_folder: str) -> None:
        """Process all images in a folder"""
        input_path = Path(input_folder)
        output_path = Path(output_folder)
        
        if not input_path.exists():
            print(f"Error: Input folder {input_folder} does not exist")
            return
        
        # Create output folder if it doesn't exist
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Supported image extensions
        extensions = {'.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'}
        
        # Process all images
        image_files = []
        for ext in extensions:
            image_files.extend(input_path.glob(f"*{ext}"))
        
        if not image_files:
            print(f"No images found in {input_folder}")
            return
        
        print(f"Found {len(image_files)} images to process")
        print("=" * 50)
        
        success_count = 0
        for image_file in image_files:
            output_file = output_path / image_file.name
            if self.process_image(str(image_file), str(output_file)):
                success_count += 1
        
        print("=" * 50)
        print(f"Processing complete: {success_count}/{len(image_files)} images processed successfully")


def main():
    """Main function"""
    if len(sys.argv) < 3:
        print("Usage: python image_gps_processor.py <input_folder> <output_folder> [config_file]")
        print("\nExample:")
        print("  python image_gps_processor.py ./input ./output")
        print("  python image_gps_processor.py ./input ./output my_config.json")
        return
    
    input_folder = sys.argv[1]
    output_folder = sys.argv[2]
    config_file = sys.argv[3] if len(sys.argv) > 3 else "config.json"
    
    processor = ImageGPSProcessor(config_file)
    processor.process_folder(input_folder, output_folder)


if __name__ == "__main__":
    main()
