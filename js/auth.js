// ── Google OAuth Authentication ──

const Auth = (() => {
  let _user = null;
  let _tokenClient = null;
  let _accessToken = null;

  function init() {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        _tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          scope: 'email profile',
          callback: (resp) => {
            if (resp.error) return;
            _accessToken = resp.access_token;
          },
        });
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  function signIn() {
    return new Promise((resolve, reject) => {
      // Use Google Identity Services (One Tap or popup)
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: (response) => {
          const payload = _parseJwt(response.credential);
          if (!payload) { reject(new Error('Invalid token')); return; }

          // ตรวจ domain อีเมล
          if (CONFIG.SCHOOL_EMAIL_DOMAIN) {
            const domain = payload.email.split('@')[1];
            if (domain !== CONFIG.SCHOOL_EMAIL_DOMAIN) {
              reject(new Error(`กรุณาใช้อีเมล @${CONFIG.SCHOOL_EMAIL_DOMAIN} เท่านั้น`));
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
          _saveSession(_user);
          resolve(_user);
        },
      });
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // fallback: show button manually
          const parent = document.getElementById('btn-google-login').parentElement;
          google.accounts.id.renderButton(
            document.getElementById('btn-google-login'),
            { theme: 'outline', size: 'large', width: 300 }
          );
        }
      });
    });
  }

  function signOut() {
    _user = null;
    _accessToken = null;
    sessionStorage.removeItem('teacher_session');
    if (window.google?.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }
  }

  function getUser() {
    if (_user) return _user;
    const saved = sessionStorage.getItem('teacher_session');
    if (saved) {
      try { _user = JSON.parse(saved); } catch (e) {}
    }
    return _user;
  }

  function isLoggedIn() { return !!getUser(); }

  function _parseJwt(token) {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch (e) { return null; }
  }

  function _checkAdmin(email) {
    // Admin emails list — เพิ่ม email admin ที่นี่
    const admins = ['admin@school.ac.th', 'principal@school.ac.th'];
    return admins.includes(email);
  }

  function _saveSession(user) {
    sessionStorage.setItem('teacher_session', JSON.stringify(user));
  }

  return { init, signIn, signOut, getUser, isLoggedIn };
})();
