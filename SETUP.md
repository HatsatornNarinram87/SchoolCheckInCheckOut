# คู่มือ Setup ระบบเช็คชื่อครู

## ขั้นตอนทั้งหมด

### 1. ดาวน์โหลด face-api.js Models

ต้องโหลดโมเดล AI มาไว้ในโฟลเดอร์ `models/`:

```
models/
  tiny_face_detector_model-weights_manifest.json
  tiny_face_detector_model-shard1
  face_landmark_68_tiny_model-weights_manifest.json
  face_landmark_68_tiny_model-shard1
  face_recognition_model-weights_manifest.json
  face_recognition_model-shard1
  face_recognition_model-shard2
```

โหลดจาก: https://github.com/justadudewhohacks/face-api.js/tree/master/weights

หรือรัน script นี้:
```bash
mkdir models
cd models
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-shard1
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_tiny_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_tiny_model-shard1
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-shard1
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-shard2
```

---

### 2. ตั้งค่า Google Cloud Console

1. ไปที่ https://console.cloud.google.com
2. สร้าง Project ใหม่
3. เปิด **APIs & Services > OAuth consent screen**
   - User type: External
   - กรอกชื่อ App, email
4. เปิด **APIs & Services > Credentials**
   - Create Credentials > OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized JavaScript origins: ใส่ URL ที่จะ host เว็บ (เช่น `https://yourschool.github.io`)
5. Copy **Client ID** → วางใน `js/config.js` ที่ `GOOGLE_CLIENT_ID`

---

### 3. ตั้งค่า Google Apps Script

1. ไปที่ https://sheets.google.com → สร้าง Spreadsheet ใหม่
2. ตั้งชื่อ tab sheet เป็น `Teachers` และ `Attendance`
3. เปิด **Extensions > Apps Script**
4. Copy code จาก `google-apps-script/Code.gs` วางทั้งหมด
5. แก้ไข `_requireAdmin()` ใส่ email admin ของคุณ
6. **Deploy > New deployment**
   - Type: Web app
   - Execute as: Me
   - Who has access: Anyone
7. Copy **Web app URL** → วางใน `js/config.js` ที่ `SCRIPT_URL`

---

### 4. ตั้งค่าพิกัดโรงเรียน

ใน `js/config.js` แก้ค่า:
```js
SCHOOL_LAT: 13.7563,   // latitude โรงเรียน
SCHOOL_LNG: 100.5018,  // longitude โรงเรียน
GPS_RADIUS_METERS: 100, // รัศมี (เมตร)
```

หาพิกัดได้จาก Google Maps → คลิกขวาที่โรงเรียน → Copy พิกัด

---

### 5. Deploy เว็บ

**Option A: GitHub Pages (ฟรี)**
```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/yourname/teacher-checkin.git
git push -u origin main
# Settings > Pages > Branch: main
```

**Option B: Netlify Drop**
- ไปที่ https://app.netlify.com/drop
- ลากโฟลเดอร์ทั้งหมดวาง

---

### 6. ลงทะเบียนครู (Admin)

1. Login ด้วยอีเมล admin
2. ไปแท็บ "ลงทะเบียนครู"
3. กรอกชื่อ, อีเมล, วิชา
4. กด "ถ่ายรูปใบหน้า" → ถ่ายรูป
5. กด "บันทึก"

---

## โครงสร้างไฟล์

```
RecordDaily/
├── index.html          ← หน้าเว็บหลัก
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker (offline)
├── css/
│   └── style.css       ← สไตล์ทั้งหมด
├── js/
│   ├── config.js       ← ค่าตั้งค่า ← แก้ตรงนี้
│   ├── auth.js         ← Google Login
│   ├── gps.js          ← GPS Geofencing
│   ├── face.js         ← Face Recognition
│   ├── api.js          ← API client
│   └── app.js          ← Main controller
├── models/             ← face-api.js models (ต้องโหลดเอง)
├── icons/              ← PWA icons (ต้องสร้างเอง)
└── google-apps-script/
    └── Code.gs         ← Backend (copy ไป Apps Script)
```
