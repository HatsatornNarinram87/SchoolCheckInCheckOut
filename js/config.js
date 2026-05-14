// ── ตั้งค่าระบบ ── แก้ค่าตรงนี้ก่อน deploy

const CONFIG = {
  // Google Apps Script Web App URL (หลัง deploy แล้ว copy มาวางตรงนี้)
  SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',

  // Google OAuth Client ID (จาก Google Cloud Console)
  GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

  // Domain อีเมลโรงเรียน (ถ้าไม่จำกัด domain ให้ใส่ '')
  SCHOOL_EMAIL_DOMAIN: '',

  // ตำแหน่งโรงเรียน (latitude, longitude)
  SCHOOL_LAT: 13.7563,
  SCHOOL_LNG: 100.5018,

  // รัศมี GPS (เมตร) — 100 = ต้องอยู่ในรัศมี 100 เมตร
  GPS_RADIUS_METERS: 100,

  // เวลาเริ่มงาน (ชั่วโมง:นาที) — ถ้ามาหลังนี้ถือว่าสาย
  WORK_START_HOUR: 8,
  WORK_START_MIN: 0,

  // ใช้ GPS จริงไหม — false = ปิด GPS check (สำหรับ dev/test)
  ENABLE_GPS_CHECK: true,

  // ใช้ Face Recognition ไหม — false = ข้ามขั้นตอนนี้
  ENABLE_FACE_CHECK: true,

  // Face Recognition threshold (ยิ่งน้อยยิ่งเข้มงวด: 0.4–0.6)
  FACE_MATCH_THRESHOLD: 0.5,

  // Path ไปยัง face-api.js models
  MODELS_URL: 'models',
};
