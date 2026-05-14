// ── Main Application Controller ──

const App = (() => {
  // ── State ──
  let _currentUser = null;
  let _teachers = [];
  let _stopFaceScan = null;
  let _gpsResult = null;
  let _adminCameraActive = false;

  // ── Screen management ──
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
  }

  function toast(msg, type = '', duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── Init ──
  async function init() {
    showScreen('loading');
    try {
      Auth.init(_onSignIn);
      _currentUser = Auth.getUser();
      if (_currentUser) {
        await _postLogin();
        return;
      }
      await _loadGSI();
      showScreen('login');
    } catch (e) {
      console.error('Init error:', e);
      showScreen('login');
    }
  }

  function _loadGSI() {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = () => {
        google.accounts.id.initialize({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          callback: window.handleGoogleSignIn,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', shape: 'pill', locale: 'th', width: 280 }
        );
        resolve();
      };
      document.head.appendChild(s);
    });
  }

  async function _onSignIn(user) {
    _currentUser = user;
    await _postLogin();
  }

  async function _postLogin() {
    showScreen('loading');
    try {
      // โหลดรายชื่อครู (ถ้า API ยังไม่ตั้งค่า ให้ใช้ array ว่าง)
      try {
        _teachers = await API.getTeachers();
      } catch (e) {
        console.warn('getTeachers failed (API not configured?):', e.message);
        _teachers = [];
      }

      // โหลด Face Recognition models เฉพาะเมื่อเปิดใช้งาน
      if (CONFIG.ENABLE_FACE_CHECK) {
        try {
          await FaceRec.loadModels((status) => {
            document.querySelector('#screen-loading p').textContent = status;
          });
          await FaceRec.loadTeacherDescriptors(_teachers);
        } catch (e) {
          console.warn('Face models not available:', e.message);
          CONFIG.ENABLE_FACE_CHECK = false;
        }
      }

      if (_currentUser.isAdmin) {
        await _showAdmin();
      } else {
        await _startGpsCheck();
      }
    } catch (e) {
      toast('เกิดข้อผิดพลาด: ' + e.message, 'error', 5000);
      showScreen('login');
    }
  }

  // ── GPS Check ──
  async function _startGpsCheck() {
    showScreen('gps');
    const statusEl = document.getElementById('gps-status');
    const progressEl = document.getElementById('gps-progress');
    const retryBtn = document.getElementById('btn-retry-gps');
    const iconEl = document.getElementById('gps-icon');

    try {
      _gpsResult = await GPS.checkInSchool((msg, pct) => {
        statusEl.textContent = msg;
        progressEl.style.width = pct + '%';
      });

      if (_gpsResult.ok) {
        iconEl.textContent = '✅';
        statusEl.textContent = `ยืนยันตำแหน่ง (${_gpsResult.distance} เมตร)`;
        progressEl.style.width = '100%';
        setTimeout(_startFaceScan, 800);
      } else {
        iconEl.textContent = '❌';
        statusEl.textContent = `อยู่นอกรัศมีโรงเรียน (${_gpsResult.distance} เมตร จากโรงเรียน ${CONFIG.GPS_RADIUS_METERS} เมตร)`;
        retryBtn.classList.remove('hidden');
      }
    } catch (e) {
      iconEl.textContent = '⚠️';
      statusEl.textContent = e.message;
      retryBtn.classList.remove('hidden');
    }

    retryBtn.onclick = () => {
      retryBtn.classList.add('hidden');
      iconEl.textContent = '📍';
      progressEl.style.width = '0%';
      _startGpsCheck();
    };
  }

  // ── Action Screen (เช็คชื่อ / เช็คออก) ──
  async function _showActionScreen() {
    showScreen('loading');
    document.querySelector('#screen-loading p').textContent = 'ตรวจสอบสถานะ...';

    let status = { status: 'none' };
    try { status = await API.getMyStatus(); } catch (e) {
      toast('ไม่สามารถตรวจสอบสถานะได้ — แสดงข้อมูลชั่วคราว', 'warning', 4000);
    }

    showScreen('action');
    document.getElementById('action-name').textContent = status.name || _currentUser.name || _currentUser.email.split('@')[0];
    document.getElementById('action-email').textContent = _currentUser.email;

    const checkinBtn  = document.getElementById('btn-checkin-action');
    const checkoutBtn = document.getElementById('btn-checkout-action');
    const statusBox   = document.getElementById('action-status-box');

    // reset ทุกครั้งก่อน set ใหม่
    checkinBtn.disabled  = false;
    checkoutBtn.disabled = false;

    if (status.status === 'none') {
      statusBox.innerHTML = '<div class="status-row"><span class="status-label">สถานะวันนี้</span><span class="status-val" style="color:var(--text-secondary)">ยังไม่ได้เช็คชื่อ</span></div>';
      checkoutBtn.disabled = true;
    } else if (status.status === 'checkedIn') {
      statusBox.innerHTML = `
        <div class="status-row"><span class="status-label">เข้างาน</span><span class="status-val" style="color:var(--success)">${status.checkInTime}</span></div>
        <div class="status-row"><span class="status-label">ออกงาน</span><span class="status-val" style="color:var(--text-secondary)">ยังไม่ได้เช็คออก</span></div>`;
      checkinBtn.disabled = true;
    } else if (status.status === 'completed') {
      statusBox.innerHTML = `
        <div class="status-row"><span class="status-label">เข้างาน</span><span class="status-val" style="color:var(--success)">${status.checkInTime}</span></div>
        <div class="status-row"><span class="status-label">ออกงาน</span><span class="status-val" style="color:var(--error)">${status.checkOutTime}</span></div>
        <div class="status-row"><span class="status-label">ชั่วโมงงาน</span><span class="status-val">${status.workHours || '-'}</span></div>`;
      checkinBtn.disabled = true;
      checkoutBtn.disabled = true;
    }

    checkinBtn.onclick = async () => {
      showScreen('loading');
      document.querySelector('#screen-loading p').textContent = 'กำลังบันทึกการเข้างาน...';
      await _doCheckin(_currentUser.email, 'manual');
    };
    checkoutBtn.onclick = async () => {
      showScreen('loading');
      document.querySelector('#screen-loading p').textContent = 'กำลังบันทึกการออกงาน...';
      await _doCheckout(_currentUser.email, 'manual');
    };
    document.getElementById('btn-action-logout').onclick = () => {
      Auth.signOut();
      showScreen('login');
      try {
        google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', shape: 'pill', locale: 'th', width: 280 }
        );
      } catch (e) {}
    };
  }

  // ── Face Scan ──
  async function _startFaceScan() {
    if (!CONFIG.ENABLE_FACE_CHECK) {
      await _showActionScreen();
      return;
    }
    showScreen('face');
    const videoEl = document.getElementById('video');
    const canvasEl = document.getElementById('canvas-overlay');
    const statusEl = document.getElementById('face-status');
    const manualBtn = document.getElementById('btn-manual-checkin');

    // แสดงปุ่ม manual หลัง 30 วินาที
    const manualTimer = setTimeout(() => manualBtn.classList.remove('hidden'), 30000);
    manualBtn.onclick = () => _doManualCheckin(manualTimer);

    try {
      await FaceRec.startCamera(videoEl);
      statusEl.textContent = 'กำลังสแกนใบหน้า...';

      _stopFaceScan = FaceRec.startLiveScan(videoEl, canvasEl,
        async (result) => {
          clearTimeout(manualTimer);
          FaceRec.stopCamera();
          if (result.success) {
            await _doCheckin(result.email, 'face');
          }
        },
        (hint) => { statusEl.textContent = hint; }
      );
    } catch (e) {
      statusEl.textContent = 'กล้องไม่พร้อม: ' + e.message;
      manualBtn.classList.remove('hidden');
    }
  }

  async function _doCheckin(email, method) {
    try {
      const payload = {
        email,
        method,
        lat: _gpsResult?.position?.lat,
        lng: _gpsResult?.position?.lng,
      };
      const res = await API.checkIn(payload);
      if (res.alreadyChecked) {
        toast('เช็คชื่อแล้ววันนี้', 'warning', 3000);
        await _showActionScreen();
        return;
      }
      _showSuccess(res);
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
      setTimeout(() => showScreen('login'), 2000);
    }
  }

  async function _doCheckout(email, method) {
    try {
      const res = await API.checkOut({
        email, method,
        lat: _gpsResult?.position?.lat,
        lng: _gpsResult?.position?.lng,
      });
      _showSuccess(res, 'checkout');
    } catch (e) {
      toast('เช็คออกไม่สำเร็จ: ' + e.message, 'error');
      setTimeout(() => showScreen('action'), 2000);
    }
  }

  async function _doManualCheckin(timer) {
    clearTimeout(timer);
    if (_stopFaceScan) _stopFaceScan();
    FaceRec.stopCamera();
    const email = _currentUser.email;
    await _doCheckin(email, 'manual');
  }

  // ── Success Screen ──
  function _showSuccess(data, type = 'checkin') {
    showScreen('success');
    const isCheckout = type === 'checkout';

    document.getElementById('success-icon').textContent = isCheckout ? '👋' : '✅';
    document.getElementById('success-title').textContent = isCheckout ? 'เช็คออกสำเร็จ!' : 'เช็คชื่อสำเร็จ!';
    document.getElementById('success-name').textContent = data.name || _currentUser?.name || _currentUser?.email?.split('@')[0];

    const timeVal = isCheckout ? data.checkOutTime : data.checkInTime;
    const time = timeVal || new Date(data.timestamp || Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('success-time').textContent = time;

    const badge = document.getElementById('success-type');
    badge.removeAttribute('style');
    if (isCheckout) {
      badge.textContent = 'ออกงาน';
      badge.className = 'success-badge';
      badge.style.background = '#FFEBEE';
      badge.style.color = 'var(--error)';
    } else if (data.isLate) {
      badge.textContent = 'มาสาย';
      badge.className = 'success-badge late';
    } else {
      badge.textContent = 'มาตรงเวลา';
      badge.className = 'success-badge';
    }

    const workhours = document.getElementById('success-workhours');
    if (isCheckout && data.workHours) {
      workhours.textContent = 'ชั่วโมงงาน: ' + data.workHours;
      workhours.classList.remove('hidden');
    } else {
      workhours.classList.add('hidden');
    }

    document.getElementById('btn-done').onclick = () => {
      Auth.signOut();
      showScreen('login');
      // Re-render Google Sign-In button หลัง signout
      try {
        google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', shape: 'pill', locale: 'th', width: 280 }
        );
      } catch (e) {}
    };
  }

  // ── Admin Dashboard ──
  async function _showAdmin() {
    showScreen('admin');
    document.getElementById('btn-logout').onclick = () => { Auth.signOut(); showScreen('login'); };
    _setupAdminTabs();
    await _loadTodayAttendance();
    document.getElementById('report-month').value = new Date().toISOString().slice(0, 7);
    document.getElementById('btn-export').onclick = _exportReport;
    document.getElementById('btn-capture-face').onclick = _adminCaptureFace;
    document.getElementById('btn-save-teacher').onclick = _adminSaveTeacher;
  }

  function _setupAdminTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
        document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
        if (btn.dataset.tab !== 'register' && _adminCameraActive) {
          FaceRec.stopCamera();
          _adminCameraActive = false;
        }
      };
    });
  }

  async function _loadTodayAttendance() {
    try {
      const records = await API.getTodayAttendance();
      const present = records.filter((r) => r.status === 'present').length;
      const late = records.filter((r) => r.status === 'late').length;
      const absent = records.filter((r) => r.status === 'absent').length;

      document.getElementById('today-summary').innerHTML = `
        <div class="summary-card present"><div class="count">${present}</div><div class="label">มาตรงเวลา</div></div>
        <div class="summary-card late"><div class="count">${late}</div><div class="label">มาสาย</div></div>
        <div class="summary-card absent"><div class="count">${absent}</div><div class="label">ขาด</div></div>
      `;

      document.getElementById('today-list').innerHTML = records.map((r) => `
        <div class="attendance-item">
          <div class="attendance-avatar">👤</div>
          <div class="attendance-info">
            <div class="attendance-name">${r.name}</div>
            <div class="attendance-subject">${r.subject || ''}</div>
          </div>
          <div>
            <div class="attendance-time">${r.checkInTime || '—'}</div>
            <span class="attendance-badge badge-${r.status}">${_statusLabel(r.status)}</span>
          </div>
        </div>
      `).join('') || '<p style="color:#999;text-align:center;padding:24px;">ยังไม่มีข้อมูลวันนี้</p>';
    } catch (e) {
      toast('โหลดข้อมูลล้มเหลว', 'error');
    }
  }

  function _statusLabel(s) {
    return { present: 'ตรงเวลา', late: 'สาย', absent: 'ขาด' }[s] || s;
  }

  async function _exportReport() {
    const month = document.getElementById('report-month').value;
    if (!month) { toast('กรุณาเลือกเดือน', 'warning'); return; }
    try {
      const report = await API.getMonthlyReport(month);
      _renderReportTable(report);
      toast('โหลดรายงานสำเร็จ', 'success');
    } catch (e) {
      toast('โหลดรายงานล้มเหลว: ' + e.message, 'error');
    }
  }

  function _renderReportTable(report) {
    if (!report?.length) { document.getElementById('report-table').innerHTML = '<p>ไม่มีข้อมูล</p>'; return; }
    const headers = Object.keys(report[0]);
    document.getElementById('report-table').innerHTML = `
      <table>
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${report.map((row) =>
          `<tr>${headers.map((h) => `<td>${row[h] ?? '—'}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    `;
  }

  // ── Admin: ลงทะเบียนครู ──
  let _adminFaceData = null;

  async function _adminCaptureFace() {
    const btn = document.getElementById('btn-capture-face');
    if (_adminCameraActive) {
      // ถ่ายรูป
      try {
        const video = document.getElementById('reg-video');
        _adminFaceData = await FaceRec.captureDescriptor(video);
        FaceRec.stopCamera();
        _adminCameraActive = false;

        // แสดงรูปตัวอย่าง
        const preview = document.getElementById('face-preview');
        preview.innerHTML = `<img src="${_adminFaceData.snapshot}" />`;
        preview.classList.remove('hidden');
        btn.textContent = '📷 ถ่ายรูปใหม่';
        toast('ถ่ายรูปสำเร็จ', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      return;
    }

    // เปิดกล้อง
    const registerForm = document.getElementById('tab-register');
    if (!document.getElementById('reg-video')) {
      const vid = document.createElement('video');
      vid.id = 'reg-video';
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.style.cssText = 'width:100%;border-radius:12px;margin-bottom:12px;';
      btn.parentElement.insertBefore(vid, btn);
    }
    const video = document.getElementById('reg-video');
    try {
      await FaceRec.startCamera(video);
      _adminCameraActive = true;
      btn.textContent = '📸 ถ่ายรูป';
    } catch (e) {
      toast('เปิดกล้องไม่ได้: ' + e.message, 'error');
    }
  }

  async function _adminSaveTeacher() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const subject = document.getElementById('reg-subject').value.trim();

    if (!name || !email) { toast('กรุณากรอกชื่อและอีเมล', 'warning'); return; }
    if (!_adminFaceData) { toast('กรุณาถ่ายรูปใบหน้าก่อน', 'warning'); return; }

    try {
      await API.registerTeacher({
        name, email, subject,
        faceDescriptor: _adminFaceData.descriptor,
        snapshot: _adminFaceData.snapshot,
      });
      toast('บันทึกสำเร็จ', 'success');
      // reset form
      ['reg-name', 'reg-email', 'reg-subject'].forEach((id) => { document.getElementById(id).value = ''; });
      document.getElementById('face-preview').classList.add('hidden');
      document.getElementById('btn-capture-face').textContent = '📷 ถ่ายรูปใบหน้า';
      _adminFaceData = null;
      // reload teachers
      _teachers = await API.getTeachers();
      await FaceRec.loadTeacherDescriptors(_teachers);
    } catch (e) {
      toast('บันทึกล้มเหลว: ' + e.message, 'error');
    }
  }

  return { init };
})();

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', App.init);
