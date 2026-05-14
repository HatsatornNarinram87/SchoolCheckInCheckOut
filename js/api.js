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
  async function checkOut({ email, method, lat, lng }) {
    const now = new Date();
    return _request('checkOut', {
      email, method,
      timestamp: now.toISOString(),
      lat: lat ?? null,
      lng: lng ?? null,
    });
  }

  // ดึงรายชื่อครูทั้งหมด (พร้อม faceDescriptor)
  async function getTeachers() {
    const data = await _request('getTeachers');
    return data.teachers;
  }

  // เช็คชื่อเข้างาน
  async function checkIn({ email, method, lat, lng }) {
    const now = new Date();
    const user = Auth.getUser();
    return _request('checkIn', {
      email,
      method,          // 'face' | 'manual'
      displayName: user?.name || null,
      timestamp: now.toISOString(),
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

  // ดึงรายงานรายเดือน (admin)
  async function getMonthlyReport(yearMonth) {
    const data = await _request('getMonthlyReport', { yearMonth });
    return data.report;
  }

  return { getMyStatus, getTeachers, checkIn, checkOut, getTodayAttendance, registerTeacher, getMonthlyReport };
})();
