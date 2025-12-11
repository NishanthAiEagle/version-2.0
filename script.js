/* script.js — Full file (camera-init + earring placement + robust gallery close)
   Includes robust loader + IceDrive base mappings + manifest fallback.
*/

/* ---------- Configuration: cloud bases & image file format ---------- */
/* Replace or update these bases if you move to another host.
   For best results use either:
   1) Direct raw image URLs (base ending with / and files like 1.png), OR
   2) A manifest.json placed at the base URL listing filenames (["fsn1.png","fsn2.png"])
*/
const IMAGE_SUFFIX = '.png'; // change to .jpg if needed

const IMAGE_BASES = {
  diamond_earrings: 'https://icedrive.net/s/k9gY4yjFg7fAubvg52yS4X9jvTuR/',    // user-provided
  diamond_necklaces: 'https://icedrive.net/s/X5GT7xSX8BwzFvR8Qa3g3PZNG79u/',
  gold_earrings: 'https://icedrive.net/s/BPwy7WN9RSPbYTPDP3avGbQyyWPi/',
  gold_necklaces: 'https://icedrive.net/s/RRwGfwg5TD75fYXgG628tF85x3Qx/'
};

/* If you know how many numbered files to expect in each folder (used for numbered probe),
   set IMAGE_COUNTS accordingly, otherwise keep 0 and rely on manifest.json approach.
*/
const IMAGE_COUNTS = {
  diamond_earrings: 5,
  diamond_necklaces: 5,
  gold_earrings: 6,
  gold_necklaces: 5
};

/* ---------- DOM refs ---------- */
const videoElement   = document.getElementById('webcam');
const canvasElement  = document.getElementById('overlay');
const canvasCtx      = canvasElement.getContext('2d');

const tryAllBtn      = document.getElementById('tryall-btn');
const flashOverlay   = document.getElementById('flash-overlay');
const galleryModal   = document.getElementById('gallery-modal');
const galleryMain    = document.getElementById('gallery-main');
const galleryThumbs  = document.getElementById('gallery-thumbs');
const galleryClose   = document.getElementById('gallery-close');

/* UI tuning fallbacks (if absent in DOM) */
let earSizeRange   = document.getElementById('earSizeRange');
let earSizeVal     = document.getElementById('earSizeVal');
let neckYRange     = document.getElementById('neckYRange');
let neckYVal       = document.getElementById('neckYVal');
let neckScaleRange = document.getElementById('neckScaleRange');
let neckScaleVal   = document.getElementById('neckScaleVal');
let posSmoothRange = document.getElementById('posSmoothRange');
let posSmoothVal   = document.getElementById('posSmoothVal');
let earSmoothRange = document.getElementById('earSmoothRange');
let earSmoothVal   = document.getElementById('earSmoothVal');
let debugToggle    = document.getElementById('debugToggle');

if (!earSizeRange) {
  earSizeRange = document.createElement('input'); earSizeRange.value = '0.24';
  earSizeVal = { textContent: '0.24' };
  neckYRange = document.createElement('input'); neckYRange.value = '0.95';
  neckYVal = { textContent: '0.95' };
  neckScaleRange = document.createElement('input'); neckScaleRange.value = '0.98';
  neckScaleVal = { textContent: '0.98' };
  posSmoothRange = document.createElement('input'); posSmoothRange.value = '0.88';
  posSmoothVal = { textContent: '0.88' };
  earSmoothRange = document.createElement('input'); earSmoothRange.value = '0.90';
  earSmoothVal = { textContent: '0.90' };
  debugToggle = document.createElement('div');
}

/* ---------- State ---------- */
let earringImg = null, necklaceImg = null;
let currentType = '';
let smoothedLandmarks = null;
let lastPersonSegmentation = null;
let bodyPixNet = null;
let lastBodyPixRun = 0;
let lastSnapshotDataURL = '';

/* Tunables */
let EAR_SIZE_FACTOR = parseFloat(earSizeRange.value || 0.24);
let NECK_Y_OFFSET_FACTOR = parseFloat(neckYRange.value || 0.95);
let NECK_SCALE_MULTIPLIER = parseFloat(neckScaleRange.value || 1.15);
let POS_SMOOTH = parseFloat(posSmoothRange.value || 0.88);
let EAR_DIST_SMOOTH = parseFloat(earSmoothRange.value || 0.90);

/* smoothing state */
const smoothedState = { leftEar: null, rightEar: null, neckPoint: null, angle: 0, earDist: null, faceShape: 'unknown' };
const angleBuffer = [];
const ANGLE_BUFFER_LEN = 5;

/* BodyPix load flag */
let bodyPixNetLoaded = false;

/* watermark */
const watermarkImg = new Image();
watermarkImg.src = "logo_watermark.png";
watermarkImg.crossOrigin = "anonymous";

/* ---------- Robust image loading + manifest fallback ---------- */

/* loadImage: returns Image object or null on error (preserves crossOrigin) */
function loadImage(src) {
  return new Promise(res => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.src = src;
    i.onload = () => res(i);
    i.onerror = () => {
      res(null);
    };
  });
}

/* Ensure base URL ends with slash */
function getBaseForType(type){
  let base = IMAGE_BASES[type] || "";
  if (!base) return "";
  if (!base.endsWith("/")) base = base + "/";
  return base;
}

/* selectJewelryType: attempts to populate thumbnails by:
     1) probing numbered files (1.png..N.png)
     2) if probe fails, fetch manifest.json (an array of filenames)
     3) if both fail, render placeholders + visible error note
*/
async function selectJewelryType(type){
  currentType = type;
  const container = document.getElementById('jewelry-options');
  if (!container) return;
  container.innerHTML = '';
  container.style.display = 'flex';
  earringImg = null; necklaceImg = null;
  stopAutoTry();

  const base = getBaseForType(type);
  const count = IMAGE_COUNTS[type] || 0;

  if (!base) {
    const warn = document.createElement('div');
    warn.style.padding = '12px'; warn.style.color = '#ffd';
    warn.textContent = 'No base URL configured for ' + type;
    container.appendChild(warn);
    return;
  }

  // Try probe numbered images first (1..count). We'll probe the first image:
  let probeSuccess = false;
  if (count > 0) {
    const probeUrl = base + '1' + IMAGE_SUFFIX;
    const probeImg = await loadImage(probeUrl);
    if (probeImg) probeSuccess = true;
    else console.warn('Probe failed for numbered pattern at', probeUrl);
  }

  // If numbered pattern works: build thumbnails using numbered names
  if (probeSuccess) {
    for (let i = 1; i <= count; i++){
      const src = base + i + IMAGE_SUFFIX;
      const btn = document.createElement('button');
      const img = document.createElement('img');
      img.src = src;
      img.onerror = () => { img.style.opacity = 0.45; img.title = "Failed to load"; };
      btn.appendChild(img);
      btn.onclick = () => {
        if (type.includes('earrings')) changeEarring(src);
        else changeNecklace(src);
      };
      container.appendChild(btn);
    }
    return;
  }

  // numbered pattern failed — try manifest.json at base
  try {
    const manifestUrl = base + 'manifest.json';
    const r = await fetch(manifestUrl);
    if (r.ok) {
      const list = await r.json();
      if (Array.isArray(list) && list.length) {
        for (const fname of list) {
          const src = (fname.startsWith('http') ? fname : (base + fname));
          const btn = document.createElement('button');
          const img = document.createElement('img');
          img.src = src;
          img.onerror = () => { img.style.opacity = 0.45; img.title = "Failed to load"; };
          btn.appendChild(img);
          btn.onclick = () => {
            if (type.includes('earrings')) changeEarring(src);
            else changeNecklace(src);
          };
          container.appendChild(btn);
        }
        return;
      } else {
        console.warn('manifest.json found but empty or not an array at', manifestUrl);
      }
    } else {
      console.warn('manifest fetch failed:', manifestUrl, r.status);
    }
  } catch (err) {
    console.warn('manifest fetch error', err);
  }

  // fallback: show note + placeholders
  const note = document.createElement('div');
  note.style.padding = '8px 12px';
  note.style.color = '#ffd';
  note.style.background = 'linear-gradient(90deg, rgba(255,200,0,0.06), rgba(255,120,0,0.03))';
  note.style.borderRadius = '10px';
  note.style.margin = '6px';
  note.innerHTML = `
    <strong>Unable to load items for "${type}".</strong><br>
    Ensure your base URL (${base}) serves direct image files (raw .png/.jpg) or upload a <code>manifest.json</code> listing filenames.<br>
    Example manifest.json:
    <pre style="white-space:pre-wrap;color:#ffd">["fsn123.png","fsn124.png","fsn125.png"]</pre>
  `;
  container.appendChild(note);

  for (let i = 1; i <= Math.max(3, count); i++){
    const btn = document.createElement('button');
    btn.style.width = '72px';
    btn.style.height = '72px';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.background = 'rgba(255,255,255,0.03)';
    btn.style.border = '1px dashed rgba(255,255,255,0.04)';
    btn.style.borderRadius = '8px';
    btn.style.margin = '6px';
    btn.title = 'Failed to load';
    btn.textContent = '—';
    container.appendChild(btn);
  }
}

/* buildImageList: returns list either from numbered pattern (if probe) or from manifest.json (if present) */
async function buildImageList(type){
  const base = getBaseForType(type);
  const count = IMAGE_COUNTS[type] || 0;
  const list = [];
  if (!base) return list;

  // try numbered probe
  if (count > 0) {
    const probe = await loadImage(base + '1' + IMAGE_SUFFIX);
    if (probe) {
      for (let i = 1; i <= count; i++) list.push(base + i + IMAGE_SUFFIX);
      return list;
    }
  }

  // try manifest
  try {
    const r = await fetch(base + 'manifest.json');
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) {
        for (const f of arr) {
          const src = (f.startsWith('http') ? f : (base + f));
          list.push(src);
        }
        return list;
      }
    }
  } catch(e){ /* ignore */ }

  // fallback: empty
  return list;
}

/* ---------- Other helper functions (unchanged) ---------- */
function toPxX(normX) { return normX * canvasElement.width; }
function toPxY(normY) { return normY * canvasElement.height; }
function lerp(a,b,t) { return a*t + b*(1-t); }
function lerpPt(a,b,t) { return { x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t) }; }

/* Load BodyPix (non-blocking) */
async function ensureBodyPixLoaded() {
  if (bodyPixNetLoaded) return;
  try {
    bodyPixNet = await bodyPix.load({ architecture:'MobileNetV1', outputStride:16, multiplier:0.5, quantBytes:2 });
    bodyPixNetLoaded = true;
  } catch(e) {
    console.warn('BodyPix load failed', e);
    bodyPixNetLoaded = false;
  }
}
async function runBodyPixIfNeeded(){
  const throttle = 300; // ms
  const now = performance.now();
  if (!bodyPixNetLoaded) return;
  if (now - lastBodyPixRun < throttle) return;
  lastBodyPixRun = now;
  try {
    const seg = await bodyPixNet.segmentPerson(videoElement, { internalResolution:'low', segmentationThreshold:0.7 });
    lastPersonSegmentation = { data: seg.data, width: seg.width, height: seg.height };
  } catch(e) {
    console.warn('BodyPix segmentation error', e);
  }
}

/* ---------- FACE MESH SETUP ---------- */
const faceMesh = new FaceMesh({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
faceMesh.setOptions({ maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:0.6, minTrackingConfidence:0.6 });
faceMesh.onResults(onFaceMeshResults);

/* Start camera and models */
async function initCameraAndModels() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 }, audio: false });
    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.playsInline = true;

    // play then start Mediapipe camera helper
    await videoElement.play();

    const cameraHelper = new Camera(videoElement, {
      onFrame: async () => { await faceMesh.send({ image: videoElement }); },
      width: 1280,
      height: 720
    });
    cameraHelper.start();

    // load BodyPix lazily
    ensureBodyPixLoaded();
    console.log('Camera & FaceMesh started');
  } catch (err) {
    console.error('Camera init error:', err);
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      alert('Please allow camera access for this site (click the camera icon in your browser URL bar).');
    } else if (err.name === 'NotFoundError') {
      alert('No camera found. Please connect a camera and try again.');
    } else {
      alert('Camera initialization failed: ' + (err && err.message ? err.message : err));
    }
  }
}
initCameraAndModels();

/* ---------- Face mesh pipeline ---------- */
async function onFaceMeshResults(results) {
  if (videoElement.videoWidth && videoElement.videoHeight) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
  }
  canvasCtx.clearRect(0,0,canvasElement.width,canvasElement.height);
  try { canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height); } catch(e) {}

  if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) {
    smoothedLandmarks = null;
    drawWatermark(canvasCtx);
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];

  // smoothing
  if (!smoothedLandmarks) smoothedLandmarks = landmarks;
  else {
    smoothedLandmarks = smoothedLandmarks.map((prev,i) => ({
      x: prev.x * 0.72 + landmarks[i].x * 0.28,
      y: prev.y * 0.72 + landmarks[i].y * 0.28,
      z: prev.z * 0.72 + landmarks[i].z * 0.28
    }));
  }

  // compute key pixel points
  const leftEar  = { x: toPxX(smoothedLandmarks[132].x), y: toPxY(smoothedLandmarks[132].y) };
  const rightEar = { x: toPxX(smoothedLandmarks[361].x), y: toPxY(smoothedLandmarks[361].y) };
  const neckP    = { x: toPxX(smoothedLandmarks[152].x), y: toPxY(smoothedLandmarks[152].y) };

  // face bbox
  let minX=1,minY=1,maxX=0,maxY=0;
  for (let i=0;i<smoothedLandmarks.length;i++){
    const lm = smoothedLandmarks[i];
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }
  const faceWidth = (maxX - minX) * canvasElement.width;
  const faceHeight = (maxY - minY) * canvasElement.height;
  const aspect = faceHeight / (faceWidth || 1);

  let faceShape = 'oval';
  if (aspect < 1.05) faceShape = 'round';
  else if (aspect > 1.25) faceShape = 'long';
  smoothedState.faceShape = faceShape;

  // earDist smoothing
  const rawEarDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
  if (smoothedState.earDist == null) smoothedState.earDist = rawEarDist;
  else smoothedState.earDist = smoothedState.earDist * EAR_DIST_SMOOTH + rawEarDist * (1 - EAR_DIST_SMOOTH);

  // position smoothing
  if (!smoothedState.leftEar) {
    smoothedState.leftEar = leftEar; smoothedState.rightEar = rightEar; smoothedState.neckPoint = neckP;
    smoothedState.angle = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
  } else {
    smoothedState.leftEar = lerpPt(smoothedState.leftEar, leftEar, POS_SMOOTH);
    smoothedState.rightEar = lerpPt(smoothedState.rightEar, rightEar, POS_SMOOTH);
    smoothedState.neckPoint = lerpPt(smoothedState.neckPoint, neckP, POS_SMOOTH);

    const rawAngle = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
    let prev = smoothedState.angle;
    let diff = rawAngle - prev;
    if (diff > Math.PI) diff -= 2*Math.PI;
    if (diff < -Math.PI) diff += 2*Math.PI;
    smoothedState.angle = prev + diff * (1 - 0.82);
  }

  angleBuffer.push(smoothedState.angle);
  if (angleBuffer.length > ANGLE_BUFFER_LEN) angleBuffer.shift();
  if (angleBuffer.length > 2) {
    const s = angleBuffer.slice().sort((a,b)=>a-b);
    smoothedState.angle = s[Math.floor(s.length/2)];
  }

  // draw jewelry
  drawJewelrySmart(smoothedState, canvasCtx, smoothedLandmarks, { faceWidth, faceHeight, faceShape });

  // segmentation & occlusion
  await ensureBodyPixLoaded();
  runBodyPixIfNeeded();
  if (lastPersonSegmentation && lastPersonSegmentation.data) {
    compositeHeadOcclusion(canvasCtx, smoothedLandmarks, lastPersonSegmentation);
  } else {
    drawWatermark(canvasCtx);
  }

  // debug markers
  if (debugToggle.classList && debugToggle.classList.contains('on')) drawDebugMarkers();
}

/* Core drawing logic */
function drawJewelrySmart(state, ctx, landmarks, meta) {
  const leftEar = state.leftEar, rightEar = state.rightEar, neckPoint = state.neckPoint;
  const earDist = state.earDist || Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
  const angle = state.angle || 0;
  const faceShape = meta.faceShape;
  const faceW = meta.faceWidth, faceH = meta.faceHeight;

  let xAdjPx = 0, yAdjPx = 0, sizeMult = 1.0;
  if (faceShape === 'round') {
    xAdjPx = Math.round(faceW * 0.06); yAdjPx = Math.round(faceH * 0.02); sizeMult = 1.10;
  } else if (faceShape === 'oval') {
    xAdjPx = Math.round(faceW * 0.045); yAdjPx = Math.round(faceH * 0.015); sizeMult = 1.00;
  } else {
    xAdjPx = Math.round(faceW * 0.04); yAdjPx = Math.round(faceH * 0.005); sizeMult = 0.95;
  }

  const finalEarringFactor = EAR_SIZE_FACTOR * sizeMult;

  // Earrings
  if (earringImg && landmarks) {
    const eWidth = earDist * finalEarringFactor;
    const eHeight = (earringImg.height / earringImg.width) * eWidth;

    const leftCenterX = leftEar.x - xAdjPx;
    const rightCenterX = rightEar.x + xAdjPx;
    const leftCenterY = leftEar.y + (eHeight * 0.18) + yAdjPx;
    const rightCenterY = rightEar.y + (eHeight * 0.18) + yAdjPx;

    const tiltCorrection = - (angle * 0.08);

    ctx.save();
    ctx.translate(leftCenterX, leftCenterY);
    ctx.rotate(tiltCorrection);
    ctx.drawImage(earringImg, -eWidth/2, -eHeight/2, eWidth, eHeight);
    ctx.restore();

    ctx.save();
    ctx.translate(rightCenterX, rightCenterY);
    ctx.rotate(-tiltCorrection);
    ctx.drawImage(earringImg, -eWidth/2, -eHeight/2, eWidth, eHeight);
    ctx.restore();
  }

  // Necklace
  if (necklaceImg && landmarks) {
    const nw = earDist * NECK_SCALE_MULTIPLIER;
    const nh = (necklaceImg.height / necklaceImg.width) * nw;
    const yOffset = earDist * NECK_Y_OFFSET_FACTOR;
    ctx.save();
    ctx.translate(neckPoint.x, neckPoint.y + yOffset);
    ctx.rotate(angle);
    ctx.drawImage(necklaceImg, -nw/2, -nh/2, nw, nh);
    ctx.restore();
  }

  drawWatermark(ctx);
}

/* watermark drawing */
function drawWatermark(ctx) {
  try {
    if (watermarkImg && watermarkImg.naturalWidth) {
      const cw = ctx.canvas.width, ch = ctx.canvas.height;
      const w = Math.round(cw * 0.22);
      const h = Math.round((watermarkImg.height / watermarkImg.width) * w);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(watermarkImg, cw - w - 14, ch - h - 14, w, h);
      ctx.globalAlpha = 1;
    }
  } catch(e) {}
}

/* Composite occlusion using BodyPix segmentation */
function compositeHeadOcclusion(mainCtx, landmarks, seg) {
  try {
    const segData = seg.data, segW = seg.width, segH = seg.height;
    const indices = [10,151,9,197,195,4];
    let minX=1,minY=1,maxX=0,maxY=0;
    indices.forEach(i => { const x=landmarks[i].x, y=landmarks[i].y; if (x<minX) minX=x; if(y<minY) minY=y; if(x>maxX) maxX=x; if(y>maxY) maxY=y; });
    const padX = 0.18*(maxX-minX), padY = 0.40*(maxY-minY);
    const L = Math.max(0, (minX - padX) * canvasElement.width);
    const T = Math.max(0, (minY - padY) * canvasElement.height);
    const R = Math.min(canvasElement.width, (maxX + padX) * canvasElement.width);
    const B = Math.min(canvasElement.height, (maxY + padY) * canvasElement.height);
    const W = Math.max(0, R-L), H = Math.max(0, B-T);
    if (W <= 0 || H <= 0) { drawWatermark(mainCtx); return; }

    const off = document.createElement('canvas'); off.width = canvasElement.width; off.height = canvasElement.height;
    const offCtx = off.getContext('2d'); offCtx.drawImage(videoElement, 0, 0, off.width, off.height);
    const imgData = offCtx.getImageData(L, T, W, H);
    const dst = mainCtx.getImageData(L, T, W, H);

    const sx = segW / canvasElement.width, sy = segH / canvasElement.height;
    for (let y=0;y<H;y++){
      const sy2 = Math.floor((T+y) * sy);
      if (sy2 < 0 || sy2 >= segH) continue;
      for (let x=0;x<W;x++){
        const sx2 = Math.floor((L+x) * sx);
        if (sx2 < 0 || sx2 >= segW) continue;
        const id = sy2 * segW + sx2;
        if (segData[id] === 1) {
          const i = (y*W + x)*4;
          dst.data[i] = imgData.data[i];
          dst.data[i+1] = imgData.data[i+1];
          dst.data[i+2] = imgData.data[i+2];
          dst.data[i+3] = imgData.data[i+3];
        }
      }
    }
    mainCtx.putImageData(dst, L, T);
    drawWatermark(mainCtx);
  } catch(e) {
    drawWatermark(mainCtx);
  }
}

/* Snapshot helpers */
function triggerFlash() { if (flashOverlay) { flashOverlay.classList.add('active'); setTimeout(()=>flashOverlay.classList.remove('active'), 180); } }

async function takeSnapshot() {
  if (!smoothedLandmarks) { alert('Face not detected'); return; }
  await ensureWatermarkLoaded();
  triggerFlash();

  const snap = document.createElement('canvas'); snap.width = canvasElement.width; snap.height = canvasElement.height;
  const ctx = snap.getContext('2d'); ctx.drawImage(videoElement, 0, 0, snap.width, snap.height);
  drawJewelrySmart(smoothedState, ctx, smoothedLandmarks, { faceWidth: (0.5*canvasElement.width), faceHeight:(0.7*canvasElement.height), faceShape: smoothedState.faceShape });
  if (lastPersonSegmentation && lastPersonSegmentation.data) compositeHeadOcclusion(ctx, smoothedLandmarks, lastPersonSegmentation);
  else drawWatermark(ctx);

  lastSnapshotDataURL = snap.toDataURL('image/png');
  const preview = document.getElementById('snapshot-preview');
  if (preview) { preview.src = lastSnapshotDataURL; const m = document.getElementById('snapshot-modal'); if (m) m.style.display = 'block'; }
}
function saveSnapshot() { if (!lastSnapshotDataURL) return; const a = document.createElement('a'); a.href = lastSnapshotDataURL; a.download = `jewelry-${Date.now()}.png`; a.click(); }
async function shareSnapshot() {
  if (!navigator.share) { alert('Sharing not supported'); return; }
  const blob = await (await fetch(lastSnapshotDataURL)).blob();
  const file = new File([blob], 'look.png', { type: 'image/png' }); await navigator.share({ files: [file] });
}
function closeSnapshotModal() { const m = document.getElementById('snapshot-modal'); if (m) m.style.display = 'none'; }

/* Try-all & gallery */
let autoTryRunning = false, autoTryTimeout = null, autoTryIndex = 0, autoSnapshots = [];
function stopAutoTry(){
  autoTryRunning = false;
  if (autoTryTimeout) clearTimeout(autoTryTimeout);
  autoTryTimeout = null;
  try { tryAllBtn.classList.remove('active'); tryAllBtn.textContent = 'Try All'; } catch(e){}
  if (autoSnapshots && autoSnapshots.length) openGallery();
}
function toggleTryAll(){ if (autoTryRunning) stopAutoTry(); else startAutoTry(); }

async function startAutoTry(){
  if (!currentType) { alert('Choose a category first'); return; }
  const list = await buildImageList(currentType);
  if (!list.length) { alert('No items (check manifest or direct image URLs)'); return; }
  autoSnapshots = []; autoTryIndex = 0; autoTryRunning = true;
  try { tryAllBtn.classList.add('active'); tryAllBtn.textContent = 'Stop'; } catch(e){}
  const step = async () => {
    if (!autoTryRunning) return;
    const src = list[autoTryIndex];
    if (currentType.includes('earrings')) await changeEarring(src); else await changeNecklace(src);
    await new Promise(r => setTimeout(r, 800));
    triggerFlash();
    if (smoothedLandmarks) {
      const snap = document.createElement('canvas'); snap.width = canvasElement.width; snap.height = canvasElement.height;
      const ctx = snap.getContext('2d'); try { ctx.drawImage(videoElement, 0, 0, snap.width, snap.height); } catch(e) {}
      drawJewelrySmart(smoothedState, ctx, smoothedLandmarks, { faceWidth: (0.5*canvasElement.width), faceHeight:(0.7*canvasElement.height), faceShape: smoothedState.faceShape });
      if (lastPersonSegmentation && lastPersonSegmentation.data) compositeHeadOcclusion(ctx, smoothedLandmarks, lastPersonSegmentation);
      else drawWatermark(ctx);
      autoSnapshots.push(snap.toDataURL('image/png'));
    }
    autoTryIndex++;
    if (autoTryIndex >= list.length) {
      autoTryRunning = false;
      try { tryAllBtn.classList.remove('active'); tryAllBtn.textContent = 'Try All'; } catch(e){}
      if (autoSnapshots.length) openGallery();
      return;
    }
    autoTryTimeout = setTimeout(step, 2000);
  };
  step();
}

/* openGallery */
function openGallery(){
  if (!autoSnapshots || !autoSnapshots.length) return;
  if (!galleryThumbs) return;
  galleryThumbs.innerHTML = '';
  autoSnapshots.forEach((src,i) => {
    const img = document.createElement('img'); img.src = src;
    img.onclick = () => setGalleryMain(i);
    galleryThumbs.appendChild(img);
  });
  setGalleryMain(0);
  const gm = document.getElementById('gallery-modal');
  if (gm) gm.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function setGalleryMain(i){
  if (!galleryMain) return;
  galleryMain.src = autoSnapshots[i];
  const thumbs = galleryThumbs.querySelectorAll('img');
  thumbs.forEach((t,idx) => t.classList.toggle('active', idx === i));
}

/* gallery close + cleanup */
function closeGalleryClean() {
  try { if (typeof stopAutoTry === 'function') stopAutoTry(); } catch(e){}
  autoSnapshots = [];
  const gm = document.getElementById('gallery-modal');
  if (gm) { gm.style.display = 'none'; gm.style.pointerEvents = 'auto'; }
  document.body.style.overflow = '';
  try { window.focus(); } catch(e){}
}
const galleryCloseBtn = document.getElementById('gallery-close');
if (galleryCloseBtn) {
  try { galleryCloseBtn.removeEventListener && galleryCloseBtn.removeEventListener('click', closeGalleryClean); } catch(e){}
  galleryCloseBtn.addEventListener('click', closeGalleryClean);
}

/* download / share helpers */
async function downloadAllImages(){
  if (!autoSnapshots.length) return;
  const zip = new JSZip(), f = zip.folder('Looks');
  for (let i=0;i<autoSnapshots.length;i++){
    const b = autoSnapshots[i].split(',')[1];
    f.file(`look_${i+1}.png`, b, { base64: true });
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'Looks.zip');
}
async function shareCurrentFromGallery(){
  if (!navigator.share) { alert('Share not supported'); return; }
  const blob = await (await fetch(galleryMain.src)).blob();
  const file = new File([blob], 'look.png', { type:'image/png' });
  await navigator.share({ files: [file] });
}

/* Asset UI: categories & thumbnails (toggleCategory kept simple) */
function toggleCategory(category){
  const subPanel = document.getElementById('subcategory-buttons');
  if (subPanel) subPanel.style.display = 'flex';
  const subs = document.querySelectorAll('#subcategory-buttons button');
  subs.forEach(b => b.style.display = b.innerText.toLowerCase().includes(category) ? 'inline-block' : 'none');
  const jopt = document.getElementById('jewelry-options'); if (jopt) jopt.style.display = 'none';
  stopAutoTry();
}

/* insertJewelryOptions is intentionally replaced by selectJewelryType which populates based on host */
async function insertJewelryOptions() { /* no-op (kept for compatibility) */ }

/* load earring / necklace images */
async function changeEarring(src){ earringImg = await loadImage(src); }
async function changeNecklace(src){ necklaceImg = await loadImage(src); }

/* watermark ensure */
function ensureWatermarkLoaded(){ return new Promise(res => { if (watermarkImg.complete && watermarkImg.naturalWidth) res(); else { watermarkImg.onload = () => res(); watermarkImg.onerror = () => res(); } }); }

/* info modal toggle */
function toggleInfoModal(){ const m = document.getElementById('info-modal'); if (m) m.style.display = (m.style.display === 'block') ? 'none' : 'block'; }

/* debug draw */
function drawDebugMarkers(){
  if (!smoothedState.leftEar) return;
  const ctx = canvasCtx;
  ctx.save();
  ctx.fillStyle = 'cyan'; ctx.beginPath(); ctx.arc(smoothedState.leftEar.x, smoothedState.leftEar.y, 6, 0, Math.PI*2); ctx.fill(); ctx.fillText('L', smoothedState.leftEar.x + 8, smoothedState.leftEar.y);
  ctx.fillStyle = 'magenta'; ctx.beginPath(); ctx.arc(smoothedState.rightEar.x, smoothedState.rightEar.y, 6, 0, Math.PI*2); ctx.fill(); ctx.fillText('R', smoothedState.rightEar.x + 8, smoothedState.rightEar.y);
  ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(smoothedState.neckPoint.x, smoothedState.neckPoint.y, 6, 0, Math.PI*2); ctx.fill(); ctx.fillText('N', smoothedState.neckPoint.x + 8, smoothedState.neckPoint.y);
  ctx.restore();
}

/* slider bindings (if present) */
if (earSizeRange.addEventListener) earSizeRange.addEventListener('input', () => { EAR_SIZE_FACTOR = parseFloat(earSizeRange.value); if (earSizeVal) earSizeVal.textContent = EAR_SIZE_FACTOR.toFixed(2); });
if (neckYRange.addEventListener) neckYRange.addEventListener('input', () => { NECK_Y_OFFSET_FACTOR = parseFloat(neckYRange.value); if (neckYVal) neckYVal.textContent = NECK_Y_OFFSET_FACTOR.toFixed(2); });
if (neckScaleRange.addEventListener) neckScaleRange.addEventListener('input', () => { NECK_SCALE_MULTIPLIER = parseFloat(neckScaleRange.value); if (neckScaleVal) neckScaleVal.textContent = NECK_SCALE_MULTIPLIER.toFixed(2); });
if (posSmoothRange.addEventListener) posSmoothRange.addEventListener('input', () => { POS_SMOOTH = parseFloat(posSmoothRange.value); if (posSmoothVal) posSmoothVal.textContent = POS_SMOOTH.toFixed(2); });
if (earSmoothRange.addEventListener) earSmoothRange.addEventListener('input', () => { EAR_DIST_SMOOTH = parseFloat(earSmoothRange.value); if (earSmoothVal) earSmoothVal.textContent = EAR_DIST_SMOOTH.toFixed(2); });

if (debugToggle.addEventListener) debugToggle.addEventListener('click', () => debugToggle.classList.toggle('on') );

/* start BodyPix load early */
ensureBodyPixLoaded();

/* open location (you can change the target URL) */
function openLocation() {
  // replace with your store location or dynamic link
  window.open('https://www.google.com/maps', '_blank');
}

/* Expose functions for HTML onclicks */
window.toggleCategory = toggleCategory;
window.selectJewelryType = selectJewelryType;
window.takeSnapshot = takeSnapshot;
window.saveSnapshot = saveSnapshot;
window.shareSnapshot = shareSnapshot;
window.closeSnapshotModal = closeSnapshotModal;
window.toggleTryAll = toggleTryAll;
window.downloadAllImages = downloadAllImages;
window.shareCurrentFromGallery = shareCurrentFromGallery;
window.toggleInfoModal = toggleInfoModal;

/* Disable right click (optional) */
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.onkeydown = function(e) {
  if (e.keyCode === 123) return false;
  if (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67 || e.keyCode === 75)) return false;
  if (e.ctrlKey && e.keyCode === 85) return false;
};
