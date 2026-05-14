// ── Google Sign-In (simplified) ──

const Auth = (() => {
  let _user = null;
  let _onSignIn = null;

  // เรียกใน app.js ก่อนแสดงหน้า login
  function init(onSignIn) {
    _onSignIn = onSignIn;

    // โหลด session เดิม
    const saved = sessionStorage.getItem('teacher_session');
    if (saved) {
      try { _user = JSON.parse(saved); } catch (e) {}
    }

    // รอ GSI library โหลดเสร็จ
    window.handleGoogleSignIn = _handleCredential;
  }

  function _handleCredential(response) {
    const payload = _parseJwt(response.credential);
    if (!payload) { _showError('Token ไม่ถูกต้อง'); return; }

    if (CONFIG.SCHOOL_EMAIL_DOMAIN) {
      const domain = payload.email.split('@')[1];
      if (domain !== CONFIG.SCHOOL_EMAIL_DOMAIN) {
        _showError(`กรุณาใช้อีเมล @${CONFIG.SCHOOL_EMAIL_DOMAIN} เท่านั้น`);
        return;
      }
    }

    _user = {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      isAdmin: _checkAdmin(payload.email),
    };
    sessionStorage.setItem('teacher_session', JSON.stringify(_user));
    _onSignIn?.(_user);
  }

  function _showError(msg) {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function signOut() {
    _user = null;
    sessionStorage.removeItem('teacher_session');
    try {
      google.accounts.id.disableAutoSelect();
      google.accounts.id.cancel();
    } catch (e) {}
  }

  function getUser() { return _user; }
  function isLoggedIn() { return !!_user; }

  function _parseJwt(token) {
    try {
      let base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      // atob คืน binary string — ต้องแปลง UTF-8 bytes ให้ถูกต้องก่อน JSON.parse
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }

  function _checkAdmin(email) {
    const admins = [
      'admin@school.ac.th',
      'principal@school.ac.th',
      'hatsatorn.narinram87@gmail.com',
    ];
    return admins.includes(email);
  }

  return { init, signOut, getUser, isLoggedIn };
})();
