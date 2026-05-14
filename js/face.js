// ── Face Recognition (face-api.js) ──

const FaceRec = (() => {
  let _modelsLoaded = false;
  let _labeledDescriptors = [];
  let _stream = null;

  async function loadModels(onStatus) {
    if (_modelsLoaded) return;
    onStatus?.('โหลดโมเดล AI...');
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.MODELS_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(CONFIG.MODELS_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(CONFIG.MODELS_URL),
      ]);
      _modelsLoaded = true;
      onStatus?.('โมเดล AI พร้อมแล้ว');
    } catch (e) {
      throw new Error('โหลดโมเดลไม่สำเร็จ: ' + e.message);
    }
  }

  // โหลด face descriptors ของครูทุกคนจาก API
  async function loadTeacherDescriptors(teachers) {
    _labeledDescriptors = [];
    for (const t of teachers) {
      if (!t.faceDescriptor) continue;
      try {
        const descriptor = new Float32Array(Object.values(t.faceDescriptor));
        _labeledDescriptors.push(
          new faceapi.LabeledFaceDescriptors(t.email, [descriptor])
        );
      } catch (e) {
        console.warn('Skip teacher descriptor:', t.email, e);
      }
    }
  }

  // เปิดกล้อง
  async function startCamera(videoEl) {
    if (_stream) stopCamera();
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = _stream;
    return new Promise((res) => { videoEl.onloadedmetadata = () => res(); });
  }

  // ปิดกล้อง
  function stopCamera() {
    if (_stream) {
      _stream.getTracks().forEach((t) => t.stop());
      _stream = null;
    }
  }

  // สแกนหน้าครั้งเดียว — คืน { matched: bool, email, distance, detection }
  async function scanOnce(videoEl, canvasEl) {
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const result = await faceapi
      .detectSingleFace(videoEl, options)
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!result) return { matched: false, reason: 'no_face' };

    // วาด bounding box บน canvas
    _drawDetection(videoEl, canvasEl, result);

    if (_labeledDescriptors.length === 0) return { matched: false, reason: 'no_db' };

    const matcher = new faceapi.FaceMatcher(_labeledDescriptors, CONFIG.FACE_MATCH_THRESHOLD);
    const best = matcher.findBestMatch(result.descriptor);

    if (best.label === 'unknown') return { matched: false, reason: 'unknown', distance: best.distance };
    return { matched: true, email: best.label, distance: best.distance, detection: result };
  }

  // สแกนต่อเนื่อง — เรียก onResult ทุก frame จนกว่า match
  function startLiveScan(videoEl, canvasEl, onResult, onStatus) {
    let running = true;
    let consecutiveMatches = 0;
    const REQUIRED_MATCHES = 3; // ต้อง match ติดกัน 3 ครั้งถึงยืนยัน

    async function loop() {
      if (!running) return;
      try {
        const result = await scanOnce(videoEl, canvasEl);
        if (result.matched) {
          consecutiveMatches++;
          onStatus?.(`ตรวจพบใบหน้า... (${consecutiveMatches}/${REQUIRED_MATCHES})`);
          if (consecutiveMatches >= REQUIRED_MATCHES) {
            running = false;
            onResult({ success: true, ...result });
            return;
          }
        } else {
          consecutiveMatches = 0;
          const hints = {
            no_face: 'จัดใบหน้าให้อยู่ในกรอบ',
            no_db: 'ยังไม่มีข้อมูลใบหน้าในระบบ',
            unknown: 'ไม่พบข้อมูลใบหน้า — ลองใหม่',
          };
          onStatus?.(hints[result.reason] || 'ตรวจจับใบหน้า...');
        }
      } catch (e) {
        console.error('Face scan error:', e);
      }
      if (running) requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    return () => { running = false; };
  }

  // ถ่ายรูปใบหน้าและสร้าง descriptor สำหรับลงทะเบียน
  async function captureDescriptor(videoEl) {
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const result = await faceapi
      .detectSingleFace(videoEl, options)
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!result) throw new Error('ไม่พบใบหน้า กรุณาหันหน้าตรงเข้าหากล้อง');

    // สร้าง canvas snapshot
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    canvas.getContext('2d').drawImage(videoEl, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    return { descriptor: Array.from(result.descriptor), snapshot: dataUrl };
  }

  function _drawDetection(videoEl, canvasEl, result) {
    const dims = faceapi.matchDimensions(canvasEl, videoEl, true);
    const resized = faceapi.resizeResults(result, dims);
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    faceapi.draw.drawDetections(canvasEl, resized);
  }

  return { loadModels, loadTeacherDescriptors, startCamera, stopCamera, startLiveScan, captureDescriptor };
})();
