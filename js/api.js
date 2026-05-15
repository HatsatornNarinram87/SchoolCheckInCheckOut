// ── Google Apps Script API Client ──

const API = (() => {
  const BASE = CONFIG.SCRIPT_URL;

  async function _request(action, payload = {}) {
    const user = Auth.getUser();
    const body = { action, ...payload, callerEmail: user?.email };

    // ไม่ใส่ Content-Type เพื่อหลีกเลี่ยง CORS preflight กับ Google Apps Script
    const res = await fetch(BASE, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Response ไม่ใช่ JSON: ' + text.slice(0, 100)); }
    if (!data.ok) throw new Error(data.error || 'API error');
    return data;
  }

  // ดึงสถานะวันนี้ของครู (checked-in / checked-out / none)
  async function getMyStatus() {
    const user = Auth.getUser();
    return _request('getMyStatus', { email: user?.email });
  }

  // เช็คออก
  async function checkOut({ email, method, lat, lng, deviceFingerprint, earlyCheckoutDetail }) {
    const now = new Date();
    return _request('checkOut', {
      email, method,
      timestamp: now.toISOString(),
      lat: lat ?? null,
      lng: lng ?? null,
      deviceFingerprint: deviceFingerprint ?? null,
      earlyCheckoutDetail: earlyCheckoutDetail ?? null,
    });
  }

  // ดึงรายชื่อครูทั้งหมด (พร้อม faceDescriptor)
  async function getTeachers() {
    const data = await _request('getTeachers');
    return data.teachers;
  }

  // เช็คชื่อเข้างาน
  async function checkIn({ email, method, lat, lng, deviceFingerprint }) {
    const now = new Date();
    const user = Auth.getUser();
    return _request('checkIn', {
      email,
      method,          // 'face' | 'manual'
      displayName: user?.name || null,
      timestamp: now.toISOString(),
      lat: lat ?? null,
      lng: lng ?? null,
      deviceFingerprint: deviceFingerprint ?? null,
    });
  }

  // ส่งคำขอลา (ลาป่วย / ลากิจ / ไปราชการ)
  async function submitLeave({ leaveType, startDate, endDate, detail, deviceFingerprint, lat, lng }) {
    const user = Auth.getUser();
    return _request('submitLeave', {
      email: user?.email,
      displayName: user?.name || null,
      leaveType,
      startDate,
      endDate: endDate ?? null,
      detail: detail ?? '',
      submittedAt: new Date().toISOString(),
      deviceFingerprint: deviceFingerprint ?? null,
      lat: lat ?? null,
      lng: lng ?? null,
    });
  }

  // ดึงข้อมูลการเข้างานวันนี้ (admin)
  async function getTodayAttendance() {
    const data = await _request('getTodayAttendance');
    return data.records;
  }

  // ลงทะเบียนครูใหม่ (admin)
  async function registerTeacher({ name, email, subject, faceDescriptor, snapshot }) {
    return _request('registerTeacher', { name, email, subject, faceDescriptor, snapshot });
  }

  // ตรวจสอบและผูก device fingerprint กับบัญชีครู
  // ใช้ fetch โดยตรง (ไม่ผ่าน _request) เพราะต้องการให้ ok:false return แทน throw
  async function verifyAndBindDevice(deviceFingerprint) {
    const user = Auth.getUser();
    const body = { action: 'verifyAndBindDevice', email: user?.email, deviceFingerprint, callerEmail: user?.email };
    const res  = await fetch(BASE, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('Response ไม่ใช่ JSON'); }
    // คืน { ok, error } โดยตรง ไม่ throw เมื่อ ok:false เพื่อให้ _postLogin จัดการ block เอง
  }

  // ดึงรายงานรายเดือน (admin)
  async function getMonthlyReport(yearMonth) {
    const data = await _request('getMonthlyReport', { yearMonth });
    return data.report;
  }

  // ดึงประวัติรายงานรายเดือน (admin)
  async function getMonthlyReportLog() {
    const data = await _request('getMonthlyReportLog');
    return data.rows;
  }

  // สร้าง/อัปเดต MonthlyReports สำหรับเดือนที่เลือก (admin)
  async function generateMonthlyReport(yearMonth) {
    const data = await _request('generateMonthlyReport', { yearMonth });
    return data.summary;
  }

  return { getMyStatus, getTeachers, checkIn, checkOut, submitLeave, getTodayAttendance, registerTeacher, getMonthlyReport, getMonthlyReportLog, generateMonthlyReport, verifyAndBindDevice };
})();
