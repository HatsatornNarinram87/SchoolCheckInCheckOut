// ── Google Apps Script Backend ──
// Deploy เป็น Web App: Execute as "Me", Who has access "Anyone"

const SHEET_TEACHERS  = 'Teachers';
const SHEET_ATTENDANCE = 'Attendance';
const SHEET_LEAVE      = 'LeaveRequests';

const TEACHER_HEADERS    = ['email','name','subject','faceDescriptor','snapshot','active','createdAt','boundFingerprint','lastSeenAt'];
const ATTENDANCE_HEADERS = ['date','checkInTime','checkOutTime','email','name','subject','status','checkInMethod','checkOutMethod','workHours','lat','lng','checkOutLat','checkOutLng','deviceFingerprint','earlyCheckoutDetail'];
const LEAVE_HEADERS      = ['date','email','name','leaveType','startDate','endDate','detail','submittedAt','deviceFingerprint','lat','lng'];

const SHEET_MONTHLY_REPORT    = 'MonthlyReports';
const MONTHLY_REPORT_HEADERS  = ['yearMonth','generatedAt','workingDays','totalTeachers','totalCheckIns','totalPresent','totalLate','totalAbsent','onTimeRate'];
const MONTHLY_TRIGGER_FN_NAME = '_autoGenerateLastMonthReport';
const MONTHLY_TRIGGER_HOUR    = 2;

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
      case 'submitLeave':        return _jsonResponse(submitLeave(data));
      case 'getMonthlyReportLog':   return _jsonResponse(getMonthlyReportLog(data));
      case 'generateMonthlyReport':  return _jsonResponse(generateMonthlyReport(data));
      case 'verifyAndBindDevice':    return _jsonResponse(verifyAndBindDevice(data));
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
    delete t.boundfingerprint;
    delete t.lastseenat;
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

  // ถ้าแถวเป็น leave record (checkInTime ว่าง แต่มี status เป็น leaveType)
  const leaveStatuses = ['sick', 'absence', 'government'];
  if (leaveStatuses.includes(String(rec.status).toLowerCase())) {
    return { ok: true, status: 'leave', leaveType: rec.status, name };
  }

  if (rec.checkOutTime) {
    return { ok: true, status: 'completed', name, checkInTime: rec.checkInTime, checkOutTime: rec.checkOutTime, workHours: rec.workHours };
  }
  return { ok: true, status: 'checkedIn', name, checkInTime: rec.checkInTime };
}

// ── Action: checkIn ──
function checkIn(data) {
  const { email, method, timestamp, lat, lng, displayName, deviceFingerprint } = data;
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
      boundFingerprint: deviceFingerprint || '',
      lastSeenAt: deviceFingerprint ? new Date().toISOString() : '',
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
    lat: lat || '', lng: lng || '', checkOutLat: '', checkOutLng: '',
    deviceFingerprint: deviceFingerprint || '',
  });

  return { ok: true, name: teacher.name, timestamp: now.toISOString(), isLate, checkInTime: displayTime };
}

// ── Action: checkOut ──
function checkOut(data) {
  const { email, method, timestamp, lat, lng, deviceFingerprint, earlyCheckoutDetail } = data;
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
  const dfIdx   = hdrs.indexOf('devicefingerprint');

  if (coIdx === -1) {
    return { ok: false, error: 'Schema ของ Attendance sheet ไม่ถูกต้อง — รัน resetAttendance() ใน Apps Script' };
  }

  const ecdIdx = hdrs.indexOf('earlycheckoutdetail');

  if (coIdx   !== -1) sheet.getRange(rec.rowIndex, coIdx   + 1).setValue(displayTime);
  if (cmIdx   !== -1) sheet.getRange(rec.rowIndex, cmIdx   + 1).setValue(method || 'manual');
  if (whIdx   !== -1) sheet.getRange(rec.rowIndex, whIdx   + 1).setValue(workHours);
  if (coLatIdx !== -1 && lat) sheet.getRange(rec.rowIndex, coLatIdx + 1).setValue(lat);
  if (coLngIdx !== -1 && lng) sheet.getRange(rec.rowIndex, coLngIdx + 1).setValue(lng);
  if (dfIdx   !== -1 && deviceFingerprint) sheet.getRange(rec.rowIndex, dfIdx  + 1).setValue(deviceFingerprint);
  if (ecdIdx  !== -1 && earlyCheckoutDetail) sheet.getRange(rec.rowIndex, ecdIdx + 1).setValue(earlyCheckoutDetail);

  const teacher = _findTeacher(email);
  return { ok: true, name: teacher?.name || email.split('@')[0], checkOutTime: displayTime, workHours };
}

// ── Action: submitLeave ──
function submitLeave(data) {
  const { email, displayName, leaveType, startDate, endDate, detail, submittedAt, deviceFingerprint, lat, lng } = data;
  if (!email)     return { ok: false, error: 'Missing email' };
  if (!leaveType) return { ok: false, error: 'Missing leaveType' };
  if (!startDate) return { ok: false, error: 'Missing startDate' };

  _ensureHeaders(SHEET_TEACHERS, TEACHER_HEADERS);
  _ensureHeaders(SHEET_LEAVE, LEAVE_HEADERS);

  let teacher = _findTeacher(email);
  if (!teacher) {
    const name = displayName || email.split('@')[0];
    _appendRow(SHEET_TEACHERS, TEACHER_HEADERS, {
      email, name, subject: '', faceDescriptor: '[]',
      snapshot: '', active: true, createdAt: new Date().toISOString(),
    });
    teacher = { email, name };
  }

  const now     = new Date(submittedAt || new Date());
  const dateStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');

  _appendRow(SHEET_LEAVE, LEAVE_HEADERS, {
    date: dateStr,
    email,
    name: teacher.name,
    leaveType,
    startDate: startDate || '',
    endDate: endDate || '',
    detail: detail || '',
    submittedAt: submittedAt || now.toISOString(),
    deviceFingerprint: deviceFingerprint || '',
    lat: lat || '',
    lng: lng || '',
  });

  // บันทึกลง Attendance ด้วย เพื่อให้ getMyStatus เห็นสถานะลา
  _ensureHeaders(SHEET_ATTENDANCE, ATTENDANCE_HEADERS);
  const attSheet   = _getSheet(SHEET_ATTENDANCE);
  const todayStr   = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const existingAtt = _findTodayRecord(attSheet, email, todayStr);
  if (!existingAtt) {
    _appendRow(SHEET_ATTENDANCE, ATTENDANCE_HEADERS, {
      date: todayStr, checkInTime: '', checkOutTime: '',
      email, name: teacher.name, subject: teacher.subject || '',
      status: leaveType, checkInMethod: 'leave', checkOutMethod: '', workHours: '',
      lat: '', lng: '', checkOutLat: '', checkOutLng: '',
      deviceFingerprint: deviceFingerprint || '',
    });
  }

  return { ok: true, name: teacher.name };
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

// ── Action: verifyAndBindDevice ──
function verifyAndBindDevice(data) {
  const { email, deviceFingerprint } = data;
  if (!email || !deviceFingerprint) return { ok: false, error: 'ข้อมูลไม่ครบ' };

  _ensureHeaders(SHEET_TEACHERS, TEACHER_HEADERS);
  const sheet = _getSheet(SHEET_TEACHERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true }; // ยังไม่มีครูในระบบ

  const hdrs        = rows[0].map(h => String(h).trim().toLowerCase());
  const eIdx        = hdrs.indexOf('email');
  const bfIdx       = hdrs.indexOf('boundfingerprint');
  const lsIdx       = hdrs.indexOf('lastseenat');
  const now         = new Date().toISOString();
  const callerEmail = email.trim().toLowerCase();
  let   callerRow   = -1;

  // Pass 1: if this fingerprint already belongs to a different teacher → block
  for (let i = 1; i < rows.length; i++) {
    const rowEmail = String(rows[i][eIdx] || '').trim().toLowerCase();
    const rowFp    = String(rows[i][bfIdx] || '').trim();
    if (rowFp === deviceFingerprint && rowEmail !== callerEmail) {
      return { ok: false, error: 'อุปกรณ์นี้ถูกผูกกับบัญชีครูอื่นแล้ว\nกรุณาใช้อุปกรณ์ที่เป็นของท่านเอง' };
    }
    if (rowEmail === callerEmail) callerRow = i;
  }

  // Pass 2: bind (or rebind) fingerprint + update lastSeenAt for caller
  if (callerRow !== -1) {
    if (bfIdx !== -1) sheet.getRange(callerRow + 1, bfIdx + 1).setValue(deviceFingerprint);
    if (lsIdx !== -1) sheet.getRange(callerRow + 1, lsIdx + 1).setValue(now);
  }
  // callerRow === -1: teacher auto-registers on first checkIn, skip write for now

  return { ok: true };
}

// ── Action: getMonthlyReport ──
function getMonthlyReport(data) {
  _requireAdmin(data.callerEmail);
  const { yearMonth } = data;
  const [yy, mm] = yearMonth.split('-').map(Number);

  // 1) Attendance → attMap[email][date]
  const attRows  = _getSheet(SHEET_ATTENDANCE).getDataRange().getValues();
  const aHdrs    = attRows[0].map(h => String(h).trim().toLowerCase());
  const aDIdx    = aHdrs.indexOf('date');
  const aEIdx    = aHdrs.indexOf('email');
  const aStIdx   = aHdrs.indexOf('status');
  const aCiIdx   = aHdrs.indexOf('checkintime');
  const aCoIdx   = aHdrs.indexOf('checkouttime');
  const aEcdIdx  = aHdrs.indexOf('earlycheckoutdetail');

  const attMap = {};
  attRows.slice(1).forEach(row => {
    const dateStr = _normalizeDateCell(row[aDIdx]);
    if (!dateStr.startsWith(yearMonth)) return;
    const em = String(row[aEIdx]).trim().toLowerCase();
    if (!attMap[em]) attMap[em] = {};
    attMap[em][dateStr] = {
      checkIn:      aCiIdx  !== -1 ? _normalizeTimeCell(row[aCiIdx])  : '',
      checkOut:     aCoIdx  !== -1 ? _normalizeTimeCell(row[aCoIdx])  : '',
      status:       aStIdx  !== -1 ? String(row[aStIdx]).trim()       : '',
      earlyCheckout: aEcdIdx !== -1 ? String(row[aEcdIdx]).trim()     : '',
    };
  });

  // 2) Leave → leaveMap[email] = [{ leaveType, startDate, endDate }]
  const leaveSheet = _getSheet(SHEET_LEAVE);
  const leaveRows  = leaveSheet.getLastRow() > 1 ? leaveSheet.getDataRange().getValues() : [LEAVE_HEADERS];
  const lHdrs      = leaveRows[0].map(h => String(h).trim().toLowerCase());
  const lEIdx      = lHdrs.indexOf('email');
  const lTIdx      = lHdrs.indexOf('leavetype');
  const lSIdx      = lHdrs.indexOf('startdate');
  const lNIdx      = lHdrs.indexOf('enddate');

  const monthStart = yearMonth + '-01';
  const monthEnd   = yearMonth + '-31';
  const leaveMap = {};
  leaveRows.slice(1).forEach(row => {
    const em    = String(row[lEIdx]).trim().toLowerCase();
    const start = _normalizeDateCell(row[lSIdx]);
    const end   = _normalizeDateCell(row[lNIdx]) || start;
    if (end < monthStart || start > monthEnd) return;
    if (!leaveMap[em]) leaveMap[em] = [];
    leaveMap[em].push({ leaveType: lTIdx !== -1 ? String(row[lTIdx]).trim() : '', startDate: start, endDate: end });
  });

  // 3) Workdays in the month (Mon–Fri)
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const workdays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = new Date(yy, mm - 1, d).getDay();
    if (wd >= 1 && wd <= 5) {
      workdays.push(yy + '-' + String(mm).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
    }
  }

  // 4) Build per-teacher report
  const teachRows = _getSheet(SHEET_TEACHERS).getDataRange().getValues();
  const tHdrs     = teachRows[0].map(h => String(h).trim().toLowerCase());

  const report = teachRows.slice(1).map(row => {
    const t = {};
    tHdrs.forEach((h, i) => { t[h] = row[i]; });
    if (!t.email) return null;

    const em       = String(t.email).trim().toLowerCase();
    const attByDay = attMap[em]   || {};
    const leaves   = leaveMap[em] || [];

    let cntPresent = 0, cntLate = 0, cntLeave = 0, cntAbsent = 0;
    const days = [];

    workdays.forEach(dateStr => {
      const rec = attByDay[dateStr];
      if (rec) {
        const st = rec.status.toLowerCase();
        if (st === 'present' || st === 'late') {
          if (st === 'present') cntPresent++; else cntLate++;
          days.push({
            date: dateStr, checkIn: rec.checkIn || null, checkOut: rec.checkOut || null,
            status: st, leaveType: null,
            earlyCheckout: rec.earlyCheckout || null,
          });
        } else {
          // status is a leave type recorded by submitLeave
          cntLeave++;
          const lv = leaves.find(l => l.startDate <= dateStr && dateStr <= l.endDate);
          days.push({
            date: dateStr, checkIn: null, checkOut: null, status: 'leave',
            leaveType: rec.status,
            leaveRange: lv ? lv.startDate + '|' + lv.endDate : dateStr + '|' + dateStr,
            earlyCheckout: null,
          });
        }
        return;
      }
      // No attendance record — check leave requests
      const lv = leaves.find(l => l.startDate <= dateStr && dateStr <= l.endDate);
      if (lv) {
        cntLeave++;
        days.push({
          date: dateStr, checkIn: null, checkOut: null, status: 'leave',
          leaveType: lv.leaveType, leaveRange: lv.startDate + '|' + lv.endDate,
          earlyCheckout: null,
        });
        return;
      }
      cntAbsent++;
      days.push({ date: dateStr, checkIn: null, checkOut: null, status: 'absent', leaveType: null, earlyCheckout: null });
    });

    return {
      ชื่อ: t.name, อีเมล: t.email, วิชา: t.subject || '',
      มาตรงเวลา: cntPresent, มาสาย: cntLate, วันลา: cntLeave, ขาด: cntAbsent,
      days,
    };
  }).filter(Boolean);

  return { ok: true, report };
}

// ── Action: getMonthlyReportLog (admin) ──
function getMonthlyReportLog(data) {
  _requireAdmin(data.callerEmail);
  _ensureHeaders(SHEET_MONTHLY_REPORT, MONTHLY_REPORT_HEADERS);

  const sheet = _getSheet(SHEET_MONTHLY_REPORT);
  if (sheet.getLastRow() <= 1) return { ok: true, rows: [] };

  const rows = sheet.getDataRange().getValues();
  const hdrs = rows[0].map(h => String(h).trim());
  const out  = rows.slice(1).map(row => {
    const o = {};
    hdrs.forEach((h, i) => { o[h] = row[i]; });
    return o;
  }).filter(r => r.yearMonth);

  out.sort((a, b) => String(b.yearMonth).localeCompare(String(a.yearMonth)));
  return { ok: true, rows: out };
}

// ── Action: generateMonthlyReport (admin, manual upsert) ──
function generateMonthlyReport(data) {
  _requireAdmin(data.callerEmail);
  const { yearMonth } = data;
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return { ok: false, error: 'yearMonth must be YYYY-MM' };
  }
  const summary = generateMonthlyReportLog(yearMonth);
  return { ok: true, summary };
}

// ── Core: aggregate attendance + upsert into MonthlyReports ──
function generateMonthlyReportLog(yearMonth) {
  _ensureHeaders(SHEET_ATTENDANCE,     ATTENDANCE_HEADERS);
  _ensureHeaders(SHEET_TEACHERS,       TEACHER_HEADERS);
  _ensureHeaders(SHEET_MONTHLY_REPORT, MONTHLY_REPORT_HEADERS);

  // 1) count attendance rows for the month
  const attSheet = _getSheet(SHEET_ATTENDANCE);
  const attRows  = attSheet.getDataRange().getValues();
  const aHdrs    = attRows[0].map(h => String(h).trim().toLowerCase());
  const dIdx     = aHdrs.indexOf('date');
  const stIdx    = aHdrs.indexOf('status');

  let totalPresent = 0, totalLate = 0;
  attRows.slice(1).forEach(row => {
    const ds = _normalizeDateCell(row[dIdx]);
    if (!ds.startsWith(yearMonth)) return;
    const s = String(row[stIdx] || '').toLowerCase();
    if (s === 'present')   totalPresent++;
    else if (s === 'late') totalLate++;
  });
  const totalCheckIns = totalPresent + totalLate;

  // 2) count active teachers
  const teachSheet = _getSheet(SHEET_TEACHERS);
  const tRows      = teachSheet.getDataRange().getValues();
  const tHdrs      = tRows[0].map(h => String(h).trim().toLowerCase());
  const tEIdx      = tHdrs.indexOf('email');
  const tAIdx      = tHdrs.indexOf('active');
  const totalTeachers = tRows.slice(1).filter(
    r => r[tEIdx] && String(r[tAIdx]).toLowerCase() !== 'false'
  ).length;

  // 3) working days (Mon-Fri) in the month
  const [yy, mm]     = yearMonth.split('-').map(Number);
  const daysInMonth  = new Date(yy, mm, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = new Date(yy, mm - 1, d).getDay();
    if (wd >= 1 && wd <= 5) workingDays++;
  }

  // 4) absences + on-time rate
  const expected    = totalTeachers * workingDays;
  const totalAbsent = Math.max(0, expected - totalCheckIns);
  const onTimeRate  = totalCheckIns > 0
    ? (totalPresent / totalCheckIns * 100).toFixed(1) + '%'
    : '0.0%';

  const summary = {
    yearMonth,
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
    workingDays, totalTeachers, totalCheckIns,
    totalPresent, totalLate, totalAbsent, onTimeRate,
  };

  _upsertMonthlyReportRow(summary);
  return summary;
}

function _upsertMonthlyReportRow(summary) {
  const sheet = _getSheet(SHEET_MONTHLY_REPORT);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0].map(h => String(h).trim());
  const ymIdx = hdrs.indexOf('yearMonth');

  let foundRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][ymIdx]).trim() === summary.yearMonth) { foundRow = i + 1; break; }
  }

  const rowData = MONTHLY_REPORT_HEADERS.map(h => summary[h] !== undefined ? summary[h] : '');
  if (foundRow === -1) {
    sheet.appendRow(rowData);
  } else {
    sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
  }
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

  const currentCols = sheet.getLastColumn();
  const firstRow    = sheet.getRange(1, 1, 1, currentCols).getValues()[0];
  const existing    = firstRow.map(h => String(h).trim().toLowerCase());
  const expected    = headers.map(h => h.toLowerCase());

  // Find which headers are missing
  const missing = expected.filter(h => !existing.includes(h));
  if (missing.length === 0) return; // all present, nothing to do

  // Append only the missing column headers — preserves all existing data rows
  missing.forEach((h, i) => {
    const originalName = headers[expected.indexOf(h)];
    sheet.getRange(1, currentCols + 1 + i).setValue(originalName);
  });
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

// ── Monthly Report Trigger (run installMonthlyReportTrigger() once from editor) ──
function installMonthlyReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === MONTHLY_TRIGGER_FN_NAME) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger(MONTHLY_TRIGGER_FN_NAME)
    .timeBased()
    .onMonthDay(1)
    .atHour(MONTHLY_TRIGGER_HOUR)
    .inTimezone('Asia/Bangkok')
    .create();
  Logger.log('Monthly trigger installed: ' + MONTHLY_TRIGGER_FN_NAME);
}

function _autoGenerateLastMonthReport() {
  const now  = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth(), 0);
  const yearMonth = Utilities.formatDate(prev, 'Asia/Bangkok', 'yyyy-MM');
  Logger.log('Auto-generating monthly report for ' + yearMonth);
  generateMonthlyReportLog(yearMonth);
}
