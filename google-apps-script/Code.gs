// ── Google Apps Script Backend ──
// Deploy เป็น Web App: Execute as "Me", Who has access "Anyone"

// ── Sheet Names ──
const SHEET_TEACHERS = 'Teachers';
const SHEET_ATTENDANCE = 'Attendance';
const SS_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// ── Entry Point ──
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    switch (action) {
      case 'getTeachers':       result = getTeachers(data); break;
      case 'checkIn':           result = checkIn(data); break;
      case 'getTodayAttendance': result = getTodayAttendance(data); break;
      case 'registerTeacher':   result = registerTeacher(data); break;
      case 'getMonthlyReport':  result = getMonthlyReport(data); break;
      default: result = { ok: false, error: 'Unknown action' };
    }

    return _jsonResponse(result);
  } catch (err) {
    return _jsonResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return _jsonResponse({ ok: true, message: 'Teacher Attendance API' });
}

// ── Action: getTeachers ──
function getTeachers(data) {
  const sheet = _getSheet(SHEET_TEACHERS);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, teachers: [] };

  const headers = rows[0];
  const teachers = rows.slice(1).map(row => {
    const t = {};
    headers.forEach((h, i) => { t[h] = row[i]; });
    // parse faceDescriptor จาก JSON string
    if (t.faceDescriptor && typeof t.faceDescriptor === 'string') {
      try { t.faceDescriptor = JSON.parse(t.faceDescriptor); } catch (e) { t.faceDescriptor = null; }
    }
    delete t.snapshot; // ไม่ส่ง snapshot กลับ (ลดขนาด)
    return t;
  }).filter(t => t.email && t.active !== false);

  return { ok: true, teachers };
}

// ── Action: checkIn ──
function checkIn(data) {
  const { email, method, timestamp, lat, lng } = data;
  if (!email) return { ok: false, error: 'Missing email' };

  const teacher = _findTeacher(email);
  if (!teacher) return { ok: false, error: 'ไม่พบข้อมูลครู' };

  const now = new Date(timestamp || new Date());
  const dateStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const timeStr = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm:ss');
  const displayTime = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');

  // ตรวจว่าเช็คชื่อแล้วหรือยัง
  const sheet = _getSheet(SHEET_ATTENDANCE);
  const existing = _findTodayRecord(sheet, email, dateStr);
  if (existing) return { ok: true, name: teacher.name, timestamp: now.toISOString(), isLate: existing.isLate, alreadyChecked: true };

  // ตรวจสาย
  const workStart = new Date(now);
  workStart.setHours(8, 0, 0, 0);
  const isLate = now > workStart;
  const status = isLate ? 'late' : 'present';

  // บันทึก
  sheet.appendRow([dateStr, timeStr, email, teacher.name, teacher.subject || '', status, method, lat || '', lng || '']);

  return { ok: true, name: teacher.name, timestamp: now.toISOString(), isLate, checkInTime: displayTime };
}

// ── Action: getTodayAttendance ──
function getTodayAttendance(data) {
  _requireAdmin(data.callerEmail);

  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const attSheet = _getSheet(SHEET_ATTENDANCE);
  const teacherSheet = _getSheet(SHEET_TEACHERS);

  // ดึงข้อมูลการเข้างานวันนี้
  const attRows = attSheet.getDataRange().getValues();
  const attHeaders = attRows[0];
  const todayRecords = {};
  attRows.slice(1).forEach(row => {
    if (row[0] === today) {
      const email = row[2];
      const isLate = row[5] === 'late';
      todayRecords[email] = {
        checkInTime: row[1].toString().substring(0, 5),
        status: row[5],
        method: row[6],
      };
    }
  });

  // ดึงครูทั้งหมดเพื่อหาคนที่ยังไม่ได้เช็คชื่อ
  const teachRows = teacherSheet.getDataRange().getValues();
  const teachHeaders = teachRows[0];
  const records = teachRows.slice(1).map(row => {
    const t = {};
    teachHeaders.forEach((h, i) => { t[h] = row[i]; });
    const att = todayRecords[t.email];
    return {
      name: t.name,
      email: t.email,
      subject: t.subject || '',
      checkInTime: att?.checkInTime || null,
      status: att?.status || 'absent',
    };
  }).filter(t => t.email);

  return { ok: true, records };
}

// ── Action: registerTeacher ──
function registerTeacher(data) {
  _requireAdmin(data.callerEmail);
  const { name, email, subject, faceDescriptor, snapshot } = data;
  if (!name || !email) return { ok: false, error: 'ข้อมูลไม่ครบ' };

  const sheet = _getSheet(SHEET_TEACHERS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // ตรวจซ้ำ
  const existing = _findTeacher(email);
  if (existing) return { ok: false, error: 'อีเมลนี้มีในระบบแล้ว' };

  // สร้าง row ใหม่
  const newRow = [
    email,
    name,
    subject || '',
    JSON.stringify(faceDescriptor || []),
    snapshot || '',
    true,                // active
    new Date().toISOString(),
  ];

  // ถ้า sheet ว่าง ให้สร้าง header ก่อน
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['email', 'name', 'subject', 'faceDescriptor', 'snapshot', 'active', 'createdAt']);
  }
  sheet.appendRow(newRow);

  return { ok: true };
}

// ── Action: getMonthlyReport ──
function getMonthlyReport(data) {
  _requireAdmin(data.callerEmail);
  const { yearMonth } = data; // format: 'yyyy-MM'

  const attSheet = _getSheet(SHEET_ATTENDANCE);
  const teacherSheet = _getSheet(SHEET_TEACHERS);
  const attRows = attSheet.getDataRange().getValues();

  // กรองเฉพาะเดือนที่ต้องการ
  const monthRecords = {};
  attRows.slice(1).forEach(row => {
    const date = row[0].toString();
    if (!date.startsWith(yearMonth)) return;
    const email = row[2];
    if (!monthRecords[email]) monthRecords[email] = {};
    monthRecords[email][date] = { status: row[5], time: row[1] };
  });

  // สร้าง report
  const teachRows = teacherSheet.getDataRange().getValues();
  const teachHeaders = teachRows[0];
  const report = teachRows.slice(1).map(row => {
    const t = {};
    teachHeaders.forEach((h, i) => { t[h] = row[i]; });
    const records = monthRecords[t.email] || {};
    const present = Object.values(records).filter(r => r.status === 'present').length;
    const late = Object.values(records).filter(r => r.status === 'late').length;
    const days = present + late;
    return {
      ชื่อ: t.name,
      อีเมล: t.email,
      วิชา: t.subject || '',
      มาตรงเวลา: present,
      มาสาย: late,
      วันทำงาน: days,
    };
  }).filter(r => r.อีเมล);

  return { ok: true, report };
}

// ── Helpers ──
function _getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function _findTeacher(email) {
  const sheet = _getSheet(SHEET_TEACHERS);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return null;
  const headers = rows[0];
  const emailIdx = headers.indexOf('email');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][emailIdx] === email) {
      const t = {};
      headers.forEach((h, j) => { t[h] = rows[i][j]; });
      return t;
    }
  }
  return null;
}

function _findTodayRecord(sheet, email, dateStr) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === dateStr && rows[i][2] === email) {
      return { status: rows[i][5], isLate: rows[i][5] === 'late' };
    }
  }
  return null;
}

function _requireAdmin(email) {
  const admins = ['admin@school.ac.th', 'principal@school.ac.th']; // ← เพิ่ม email admin
  if (!admins.includes(email)) throw new Error('ไม่มีสิทธิ์ admin');
}

function _jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
