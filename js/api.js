// ── Google Apps Script API Client ──

const API = (() => {
  const BASE = CONFIG.SCRIPT_URL;

  async function _request(action, payload = {}) {
    const user = Auth.getUser();
    const body = { action, ...payload, callerEmail: user?.email };

    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'API error');
    return data;
  }

  // ดึงรายชื่อครูทั้งหมด (พร้อม faceDescriptor)
  async function getTeachers() {
    const data = await _request('getTeachers');
    return data.teachers;
  }

  // เช็คชื่อเข้างาน
  async function checkIn({ email, method, lat, lng }) {
    const now = new Date();
    return _request('checkIn', {
      email,
      method,          // 'face' | 'manual'
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

  return { getTeachers, checkIn, getTodayAttendance, registerTeacher, getMonthlyReport };
})();
