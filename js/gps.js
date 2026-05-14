// ── GPS Geofencing ──

const GPS = (() => {

  // คำนวณระยะทางระหว่างสองจุด (Haversine formula) — คืนค่าเป็นเมตร
  function _distance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ดึงตำแหน่งปัจจุบัน
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('เบราว์เซอร์ไม่รองรับ GPS'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => {
          const messages = {
            1: 'ไม่ได้รับอนุญาตให้เข้าถึง GPS กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์',
            2: 'ไม่สามารถตรวจสอบตำแหน่งได้',
            3: 'หมดเวลาตรวจสอบตำแหน่ง',
          };
          reject(new Error(messages[err.code] || 'GPS error'));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  // ตรวจสอบว่าอยู่ในรัศมีโรงเรียนหรือไม่
  async function checkInSchool(onProgress) {
    if (!CONFIG.ENABLE_GPS_CHECK) return { ok: true, distance: 0, mock: true };

    onProgress?.('กำลังตรวจสอบตำแหน่ง GPS...', 30);
    const pos = await getCurrentPosition();

    onProgress?.('คำนวณระยะทาง...', 70);
    const dist = Math.round(_distance(pos.lat, pos.lng, CONFIG.SCHOOL_LAT, CONFIG.SCHOOL_LNG));

    onProgress?.('', 100);
    return {
      ok: dist <= CONFIG.GPS_RADIUS_METERS,
      distance: dist,
      position: pos,
    };
  }

  return { checkInSchool, getCurrentPosition };
})();
