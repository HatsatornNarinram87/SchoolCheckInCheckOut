// ── Google Apps Script Backend ──
// Deploy เป็น Web App: Execute as "Me", Who has access "Anyone"

const SHEET_TEACHERS  = 'Teachers';
const SHEET_ATTENDANCE = 'Attendance';

const TEACHER_HEADERS   = ['email','name','subject','faceDescriptor','snapshot','active','createdAt'];
const ATTENDANCE_HEADERS = ['date','checkInTime','checkOutTime','email','name','subject','status','checkInMethod','checkOutMethod','workHours','lat','lng','checkOutLat','checkOutLng'];

const ADMIN_EMAILS = [
  'hatsatorn.narinram87@gmail.com',
  'admin@school.ac.th',
  'principal@school.ac.th',
];

// ── Entry Point ──
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'getTeachers':        return _jsonResponse(getTeachers(data));
      case 'getMyStatus':        return _jsonResponse(getMyStatus(data));
      case 'checkIn':            return _jsonResponse(checkIn(data));
      case 'checkOut':           return _jsonResponse(checkOut(data));
      case 'getTodayAttendance': return _jsonResponse(getTodayAttendance(data));
      case 'registerTeacher':    return _jsonResponse(registerTeacher(data));
      case 'getMonthlyReport':   return _jsonResponse(getMonthlyReport(data));
      default: return _jsonResponse({ ok: false, error: 'Unknown action: ' + data.action });
    }
  } catch (err) {
    return _jsonResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return _jsonResponse({ ok: true, message: 'Teacher Attendance API is running' });
}

// ── Action: getTeachers ──
function getTeachers(data) {
  _ensureHeaders(SHEET_TEACHERS, TEACHER_HEADERS);
  const sheet = _getSheet(SHEET_TEACHERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, teachers: [] };

  const hdrs = rows[0].map(h => String(h).trim().toLowerCase());
  const teachers = rows.slice(1).map(row => {
    const t = {};
    hdrs.forEach((h, i) => { t[h] = row[i]; });
    if (t.facedescriptor && typeof t.facedescriptor === 'string') {
      try { t.faceDescriptor = JSON.parse(t.facedescriptor); } catch (e) { t.faceDescriptor = null; }
    }
    delete t.snapshot;
    return t;
  }).filter(t => t.email && String(t.active).toLowerCase() !== 'false');

  return { ok: true, teachers };
}

// ── Action: getMyStatus ──
function getMyStatus(data) {
  const email = data.email || data.callerEmail;
  if (!email) return { ok: false, error: 'Missing email' };

  _ensureHeaders(SHEET_ATTENDANCE, ATTENDANCE_HEADERS);
  const today   = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const rec     = _findTodayRecord(_getSheet(SHEET_ATTENDANCE), email, today);
  const teacher = _findTeacher(email);
  const name    = teacher?.name || null;

  if (!rec) return { ok: true, status: 'none', name };
  if (rec.checkOutTime) {
    return { ok: true, status: 'completed', name, checkInTime: rec.checkInTime, checkOutTime: rec.checkOutTime, workHours: rec.workHours };
  }
  return { ok: true, status: 'checkedIn', name, checkInTime: rec.checkInTime };
}

// ── Action: checkIn ──
function checkIn(data) {
  const { email, method, timestamp, lat, lng, displayName } = data;
  if (!email) return { ok: false, error: 'Missing email' };

  _ensureHeaders(SHEET_TEACHERS, TEACHER_HEADERS);
  _ensureHeaders(SHEET_ATTENDANCE, ATTENDANCE_HEADERS);

  // หาหรือสร้างครูอัตโนมัติ
  let teacher = _findTeacher(email);
  if (!teacher) {
    // auto-register ด้วย email (ครูสามารถแก้ชื่อเองภายหลังผ่าน admin)
    const name = displayName || email.split('@')[0];
    _appendRow(SHEET_TEACHERS, TEACHER_HEADERS, {
      email, name, subject: '', faceDescriptor: '[]',
      snapshot: '', active: true, createdAt: new Date().toISOString(),
    });
    teacher = { email, name, subject: '' };
  }

  const now       = new Date(timestamp || new Date());
  const dateStr   = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const timeStr   = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm:ss');
  const displayTime = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');

  // เช็คว่าเช็คชื่อแล้วหรือยัง
  const attSheet = _getSheet(SHEET_ATTENDANCE);
  const existing = _findTodayRecord(attSheet, email, dateStr);
  if (existing) {
    return { ok: true, name: teacher.name, timestamp: now.toISOString(), isLate: existing.isLate, alreadyChecked: true };
  }

  // ตรวจสาย — เปรียบเทียบใน timezone Asia/Bangkok เพื่อหลีกเลี่ยง UTC offset
  const bkkTime = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');
  const [bkkH, bkkM] = bkkTime.split(':').map(Number);
  const isLate = (bkkH * 60 + bkkM) > (8 * 60 + 0);
  const status = isLate ? 'late' : 'present';

  _appendRow(SHEET_ATTENDANCE, ATTENDANCE_HEADERS, {
    date: dateStr, checkInTime: displayTime, checkOutTime: '',
    email, name: teacher.name, subject: teacher.subject || '',
    status, checkInMethod: method, checkOutMethod: '', workHours: '',
    lat: lat || '', lng: lng || '',
  });

  return { ok: true, name: teacher.name, timestamp: now.toISOString(), isLate, checkInTime: displayTime };
}

// ── Action: checkOut ──
function checkOut(data) {
  const { email, method, timestamp, lat, lng } = data;
  if (!email) return { ok: false, error: 'Missing email' };

  _ensureHeaders(SHEET_ATTENDANCE, ATTENDANCE_HEADERS);
  const now         = new Date(timestamp || new Date());
  const dateStr     = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const displayTime = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');

  const sheet = _getSheet(SHEET_ATTENDANCE);
  const rec   = _findTodayRecord(sheet, email, dateStr);
  if (!rec)             return { ok: false, error: 'ยังไม่ได้เช็คชื่อเข้างาน' };
  if (rec.checkOutTime && rec.checkOutTime.trim() !== '') {
    return { ok: false, error: 'เช็คออกแล้ววันนี้ (' + rec.checkOutTime + ')' };
  }

  // คำนวณชั่วโมงงาน
  let workHours = '';
  try {
    const ci = String(rec.checkInTime).substring(0, 5);
    if (ci.indexOf(':') !== -1) {
      const [inH, inM] = ci.split(':').map(Number);
      const [outH, outM] = displayTime.split(':').map(Number);
      let totalMin = (outH * 60 + outM) - (inH * 60 + inM);
      if (totalMin < 0) totalMin = 0;
      workHours = Math.floor(totalMin / 60) + 'h ' + (totalMin % 60) + 'm';
    }
  } catch (e) {}

  // อัปเดตแถวใน sheet ด้วย rowIndex จาก _findTodayRecord
  const hdrs    = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                       .map(h => String(h).trim().toLowerCase());
  const coIdx   = hdrs.indexOf('checkouttime');
  const cmIdx   = hdrs.indexOf('checkoutmethod');
  const whIdx   = hdrs.indexOf('workhours');
  const coLatIdx = hdrs.indexOf('checkoutlat');
  const coLngIdx = hdrs.indexOf('checkoutlng');

  if (coIdx === -1) {
    return { ok: false, error: 'Schema ของ Attendance sheet ไม่ถูกต้อง — รัน resetAttendance() ใน Apps Script' };
  }

  if (coIdx   !== -1) sheet.getRange(rec.rowIndex, coIdx   + 1).setValue(displayTime);
  if (cmIdx   !== -1) sheet.getRange(rec.rowIndex, cmIdx   + 1).setValue(method || 'manual');
  if (whIdx   !== -1) sheet.getRange(rec.rowIndex, whIdx   + 1).setValue(workHours);
  if (coLatIdx !== -1 && lat) sheet.getRange(rec.rowIndex, coLatIdx + 1).setValue(lat);
  if (coLngIdx !== -1 && lng) sheet.getRange(rec.rowIndex, coLngIdx + 1).setValue(lng);

  const teacher = _findTeacher(email);
  return { ok: true, name: teacher?.name || email.split('@')[0], checkOutTime: displayTime, workHours };
}

// ── Action: getTodayAttendance ──
function getTodayAttendance(data) {
  _requireAdmin(data.callerEmail);
  _ensureHeaders(SHEET_TEACHERS, TEACHER_HEADERS);
  _ensureHeaders(SHEET_ATTENDANCE, ATTENDANCE_HEADERS);

  const today      = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const attRows    = _getSheet(SHEET_ATTENDANCE).getDataRange().getValues();
  const teachRows  = _getSheet(SHEET_TEACHERS).getDataRange().getValues();

  const aHdrs = attRows[0].map(h => String(h).trim().toLowerCase());
  const aDIdx  = aHdrs.indexOf('date');
  const aEIdx  = aHdrs.indexOf('email');
  const aCiIdx = aHdrs.indexOf('checkintime');
  const aCoIdx = aHdrs.indexOf('checkouttime');
  const aStIdx = aHdrs.indexOf('status');

  const todayMap = {};
  attRows.slice(1).forEach(row => {
    if (_normalizeDateCell(row[aDIdx]) === today) {
      todayMap[String(row[aEIdx]).trim().toLowerCase()] = {
        checkInTime:  aCiIdx !== -1 ? _normalizeTimeCell(row[aCiIdx]) : null,
        checkOutTime: aCoIdx !== -1 ? _normalizeTimeCell(row[aCoIdx]) : null,
        status:       aStIdx !== -1 ? row[aStIdx] : 'present',
      };
    }
  });

  const hdrs = teachRows[0].map(h => String(h).trim().toLowerCase());
  const records = teachRows.slice(1).map(row => {
    const t = {};
    hdrs.forEach((h, i) => { t[h] = row[i]; });
    const att = todayMap[String(t.email).trim().toLowerCase()];
    return {
      name: t.name, email: t.email, subject: t.subject || '',
      checkInTime: att?.checkInTime || null,
      checkOutTime: att?.checkOutTime || null,
      status: att?.status || 'absent',
    };
  }).filter(t => t.email);

  return { ok: true, records };
}

// ── Action: registerTeacher ──
function registerTeacher(data) {
  _requireAdmin(data.callerEmail);
  _ensureHeaders(SHEET_TEACHERS, TEACHER_HEADERS);
  const { name, email, subject, faceDescriptor, snapshot } = data;
  if (!name || !email) return { ok: false, error: 'ข้อมูลไม่ครบ' };
  if (_findTeacher(email)) return { ok: false, error: 'อีเมลนี้มีในระบบแล้ว' };

  _appendRow(SHEET_TEACHERS, TEACHER_HEADERS, {
    email, name, subject: subject || '',
    faceDescriptor: JSON.stringify(faceDescriptor || []),
    snapshot: snapshot || '', active: true, createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

// ── Action: getMonthlyReport ──
function getMonthlyReport(data) {
  _requireAdmin(data.callerEmail);
  const { yearMonth } = data;

  const attRows   = _getSheet(SHEET_ATTENDANCE).getDataRange().getValues();
  const teachRows = _getSheet(SHEET_TEACHERS).getDataRange().getValues();

  const aHdrs = attRows[0].map(h => String(h).trim().toLowerCase());
  const aDIdx = aHdrs.indexOf('date');
  const aEIdx = aHdrs.indexOf('email');
  const aStIdx = aHdrs.indexOf('status');

  const monthMap = {};
  attRows.slice(1).forEach(row => {
    const dateStr = _normalizeDateCell(row[aDIdx]);
    if (!dateStr.startsWith(yearMonth)) return;
    const em = String(row[aEIdx]).trim().toLowerCase();
    if (!monthMap[em]) monthMap[em] = [];
    monthMap[em].push(row[aStIdx]);
  });

  const hdrs   = teachRows[0].map(h => String(h).trim().toLowerCase());
  const report = teachRows.slice(1).map(row => {
    const t = {};
    hdrs.forEach((h, i) => { t[h] = row[i]; });
    const statuses = monthMap[String(t.email).trim().toLowerCase()] || [];
    return {
      ชื่อ: t.name, อีเมล: t.email, วิชา: t.subject || '',
      มาตรงเวลา: statuses.filter(s => s === 'present').length,
      มาสาย:     statuses.filter(s => s === 'late').length,
      วันทำงาน:  statuses.filter(s => s === 'present' || s === 'late').length,
    };
  }).filter(r => r.อีเมล);

  return { ok: true, report };
}

// ── Helpers ──
function _getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function _ensureHeaders(sheetName, headers) {
  const sheet = _getSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    _setDateColumnAsText(sheet);
    return;
  }
  // อ่าน header ปัจจุบันแบบ case-insensitive
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const existing = firstRow.map(h => String(h).trim().toLowerCase());
  const expected = headers.map(h => h.toLowerCase());

  // ตรวจว่า header ที่ expected มีครบในแถวแรกไหม
  const allPresent = expected.every(h => existing.indexOf(h) !== -1);
  if (allPresent) return;

  // ── Schema mismatch: backup ข้อมูลเก่า + เขียน header ใหม่ ──
  Logger.log('Schema mismatch in ' + sheetName + '. Backing up and rebuilding...');
  if (sheet.getLastRow() > 1) {
    const backupName = sheetName + '_backup_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
    sheet.copyTo(SpreadsheetApp.getActiveSpreadsheet()).setName(backupName);
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  _setDateColumnAsText(sheet);
}

// ตั้งคอลัมน์ date เป็น text เพื่อไม่ให้ Sheets แปลงเป็น Date object
function _setDateColumnAsText(sheet) {
  try {
    sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  } catch (e) {}
}

// ── Manual reset (admin run จาก editor ของ Apps Script) ──
function resetAttendance() {
  const sheet = _getSheet(SHEET_ATTENDANCE);
  sheet.clear();
  sheet.appendRow(ATTENDANCE_HEADERS);
  _setDateColumnAsText(sheet);
  Logger.log('Attendance sheet reset');
}

function resetAll() {
  resetAttendance();
  const t = _getSheet(SHEET_TEACHERS);
  t.clear();
  t.appendRow(TEACHER_HEADERS);
  Logger.log('All sheets reset');
}

function _appendRow(sheetName, headers, obj) {
  const sheet = _getSheet(sheetName);
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  sheet.appendRow(row);
  // ตั้ง format คอลัมน์ที่เป็น time/date ให้เป็น plain text ป้องกัน auto-convert
  const lastRow = sheet.getLastRow();
  const timeColNames = ['checkintime','checkouttime','date'];
  headers.forEach((h, i) => {
    if (timeColNames.indexOf(h.toLowerCase()) !== -1) {
      sheet.getRange(lastRow, i + 1).setNumberFormat('@');
    }
  });
}

function _findTeacher(email) {
  const sheet = _getSheet(SHEET_TEACHERS);
  if (sheet.getLastRow() <= 1) return null;
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0].map(h => String(h).trim().toLowerCase());
  const eIdx  = hdrs.indexOf('email');
  if (eIdx === -1) return null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][eIdx]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
      const t = {};
      hdrs.forEach((h, j) => { t[h] = rows[i][j]; });
      return t;
    }
  }
  return null;
}

function _normalizeDateCell(val) {
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Bangkok', 'yyyy-MM-dd');
  return String(val).trim();
}

function _normalizeTimeCell(val) {
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Bangkok', 'HH:mm');
  const s = String(val).trim();
  return s.length >= 5 ? s.substring(0, 5) : s;
}

function _findTodayRecord(sheet, email, dateStr) {
  if (sheet.getLastRow() <= 1) return null;
  const rows = sheet.getDataRange().getValues();
  const hdrs = rows[0].map(h => String(h).trim().toLowerCase());
  const dIdx  = hdrs.indexOf('date');
  const eIdx  = hdrs.indexOf('email');
  const ciIdx = hdrs.indexOf('checkintime');
  const coIdx = hdrs.indexOf('checkouttime');
  const stIdx = hdrs.indexOf('status');
  const whIdx = hdrs.indexOf('workhours');
  if (eIdx === -1 || dIdx === -1) return null;

  const targetEmail = String(email).trim().toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    const rowDate  = _normalizeDateCell(rows[i][dIdx]);
    const rowEmail = String(rows[i][eIdx]).trim().toLowerCase();
    if (rowDate === dateStr && rowEmail === targetEmail) {
      return {
        rowIndex:     i + 1,
        checkInTime:  ciIdx !== -1 ? _normalizeTimeCell(rows[i][ciIdx]) : '',
        checkOutTime: coIdx !== -1 ? _normalizeTimeCell(rows[i][coIdx]) : '',
        status:       stIdx !== -1 ? rows[i][stIdx] : '',
        workHours:    whIdx !== -1 ? String(rows[i][whIdx]) : '',
        isLate:       stIdx !== -1 && rows[i][stIdx] === 'late',
      };
    }
  }
  return null;
}

function _requireAdmin(email) {
  if (!ADMIN_EMAILS.includes(String(email).trim().toLowerCase())) {
    throw new Error('ไม่มีสิทธิ์ admin');
  }
}

function _jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
