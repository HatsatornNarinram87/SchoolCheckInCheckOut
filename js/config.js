// ── ตั้งค่าระบบ ── แก้ค่าตรงนี้ก่อน deploy

const CONFIG = {
  // Google Apps Script Web App URL (หลัง deploy แล้ว copy มาวางตรงนี้)
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxSTTiqxOQMpE1QmEy75_x9SS_Bq7VE7TF35DKERh622zJdtILrcOob-sZgqd6lEkMI/exec',

  // Google OAuth Client ID (จาก Google Cloud Console)
  // GOOGLE_CLIENT_ID: '921804252606-5tepbu13r8q4e61d9ktcbs7tfmkpaebt.apps.googleusercontent.com',
  GOOGLE_CLIENT_ID: '921804252606-oebjar2gqt4b7kp8j99ur3nnm5h5sc8t.apps.googleusercontent.com', //prod

  // Domain อีเมลโรงเรียน (ถ้าไม่จำกัด domain ให้ใส่ '')
  SCHOOL_EMAIL_DOMAIN: '',

  // ตำแหน่งโรงเรียน (latitude, longitude)
  // SCHOOL_LAT: 16.3950333,
  // SCHOOL_LNG: 103.3685648,
  /// test16.4170402,103.3634167
  SCHOOL_LAT: 16.4170402,
  SCHOOL_LNG: 103.3634167,
  // รัศมี GPS (เมตร) — 100 = ต้องอยู่ในรัศมี 100 เมตร
  GPS_RADIUS_METERS: 400,

  // เวลาเริ่มงาน (ชั่วโมง:นาที) — ถ้ามาหลังนี้ถือว่าสาย
  WORK_START_HOUR: 8,
  WORK_START_MIN: 30,

  // ใช้ GPS จริงไหม — false = ปิด GPS check (สำหรับ dev/test)
  ENABLE_GPS_CHECK: true,

  // ใช้ Face Recognition ไหม — false = ข้ามขั้นตอนนี้
  ENABLE_FACE_CHECK: false,

  // Face Recognition threshold (ยิ่งน้อยยิ่งเข้มงวด: 0.4–0.6)
  FACE_MATCH_THRESHOLD: 0.5,

  // Path ไปยัง face-api.js models
  MODELS_URL: 'models',
};
