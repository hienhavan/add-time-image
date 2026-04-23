# Image GPS Processor - Web UI Version

Giao diện web đầy đủ để xử lý hàng loạt ảnh với GPS và thời gian.

## 🚀 Khởi động

### Cách 1: Dùng script (Khuyên dùng)
```bash
# Windows
start.bat

# Hoặc thủ công
npm start
```

### Cách 2: Dùng CLI (phiên bản cũ)
```bash
npm run cli ./input ./output
```

## 🌐 Giao diện Web

Mở trình duyệt và truy cập: **http://localhost:3000**

### 🎯 Tính năng chính

1. **📁 Kéo thả folder ảnh**
   - Hỗ trợ .jpg, .jpeg, .png
   - Tự động nhận diện ảnh

2. **🔧 2 nút chức năng chính**
   - **Xóa GPS cũ**: Chỉ đè rectangle đen, không thêm text
   - **Thêm GPS mới**: Đè rectangle + thêm text GPS/time

3. **📍 Lựa chọn vị trí text**
   - ↙️ Góc dưới trái
   - ↘️ Góc dưới phải  
   - ↖️ Góc trên trái
   - ↗️ Góc trên phải

4. **⚙️ Cấu hình GPS**
   - Nhập tọa độ Latitude/Longitude
   - Tùy chỉnh font size
   - Dùng fallback GPS khi ảnh không có metadata

5. **📊 Progress & Results**
   - Progress bar hiển thị % xử lý
   - Thumbnail preview sau xử lý
   - Status cho từng ảnh

6. **📥 Export Log**
   - Tải file JSON với thông tin chi tiết
   - Ghi lại settings và kết quả

## 📁 Cấu trúc file

```
├── server.js              # Express server chính
├── public/
│   └── index.html         # Giao diện web
├── image_gps_processor.js # CLI version (vẫn dùng được)
├── config.json            # Cấu hình mặc định
├── package.json           # Dependencies
├── start.bat              # Script khởi động Windows
├── output/               # Folder kết quả (tự tạo)
└── README_UI.md          # File này
```

## 🛠️ Công nghệ sử dụng

- **Frontend**: HTML5, CSS3, JavaScript (vanilla)
- **Backend**: Node.js + Express
- **Image Processing**: Sharp (hiệu suất cao)
- **EXIF Reading**: exif-parser
- **File Upload**: Multer

## 📋 Luồng xử lý

1. **User kéo thả ảnh** → Frontend nhận files
2. **Click button** → Gửi request POST /process
3. **Server xử lý**:
   - Đọc EXIF metadata
   - Áp dụng config (position, GPS, font)
   - Xử lý ảnh với Sharp
   - Lưu vào folder /output
4. **Trả kết quả** → Hiển thị thumbnails + status
5. **Export log** → Tải JSON file

## 🎨 UI Features

- **Responsive design**: Tương thích mobile/desktop
- **Drag & drop**: Kéo thả trực tiếp
- **Real-time progress**: Hiển thị % xử lý
- **Visual feedback**: Hover effects, animations
- **Modern UI**: Gradient backgrounds, shadows
- **Vietnamese interface**: Tiếng Việt đầy đủ

## ⚡ Performance

- **Sharp**: Nhanh hơn Pillow (Python) 3-5x
- **Memory processing**: Xử lý trong RAM, không ghi disk tạm
- **Batch upload**: Hỗ trợ lên đến 100 ảnh cùng lúc
- **Thumbnail generation**: Tạo preview nhanh

## 🔧 Tùy chỉnh nâng cao

Edit `config.json` để thay đổi:
```json
{
  "fallback_gps": {
    "latitude": 21.0285,
    "longitude": 105.8542
  },
  "text_position": "bottom-left",
  "rectangle_color": "black",
  "text_color": "white",
  "font_size": 24,
  "padding": 10,
  "rectangle_height_percent": 0.15
}
```

## 🚨 Lưu ý

- Server chạy mặc định port 3000
- Output folder tự động tạo
- File size limit: 50MB per image
- Max 100 files per batch
- Auto clean output folder khi cần

## 📞 Troubleshooting

**Lỗi "Port 3000 đang dùng"?**
```bash
# Dùng port khác
PORT=8080 npm start
```

**Lỗi "Không đọc được EXIF"?**
- Ảnh có thể không chứa metadata
- Sẽ tự động dùng fallback GPS

**Lỗi "File quá lớn"?**
- Giảm kích thước ảnh < 50MB
- Hoặc chỉnh limit trong `server.js`

---
✅ **Đã hoàn thiện đầy đủ UI theo yêu cầu!**
