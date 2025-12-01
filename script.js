// =============== BASIC SETUP ===============
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');

const subcategoryButtons = document.getElementById('subcategory-buttons');
const jewelryOptions = document.getElementById('jewelry-options');

let earringImg = null;
let necklaceImg = null;

let currentCategory = '';   // "earrings" | "necklaces"
let currentTypeKey = '';    // "gold_earrings", "diamond_necklaces"

let smoothedFaceLandmarks = null;
let smoothedFacePoints = {};
let camera = null;

// Snapshot (single) elements
const captureBtn = document.getElementById('capture-btn');
const snapshotModal = document.getElementById('snapshot-modal');
const snapshotPreview = document.getElementById('snapshot-preview');
const closeSnapshotBtn = document.getElementById('close-snapshot');
const downloadBtn = document.getElementById('download-btn');
const shareBtn = document.getElementById('share-btn');
let lastSnapshotDataURL = '';

// TRY ALL + gallery elements
const autoTryBtn = document.getElementById('auto-try-btn');
let autoTryRunning = false;
let autoTryTimeout = null;
let autoTryIndex = 0;
let autoSnapshots = [];      // all screenshots from Try All

const galleryModal = document.getElementById('gallery-modal');
const galleryMain = document.getElementById('gallery-main');
const galleryThumbs = document.getElementById('gallery-thumbs');
const galleryClose = document.getElementById('gallery-close');
const whatsappShareBtn = document.getElementById('whatsapp-share-btn');

// Resolution box
const resolutionBox = document.getElementById('resolution-box');

/* ===========================================
   1. LOCAL FILES CONFIG – matches your folders
=========================================== */

const LOCAL_IMAGES = {
  // diamond_earrings/diamond_earrings1.png ... 9
  diamond_earrings: [
    'diamond_earrings1.png',
    'diamond_earrings2.png',
    'diamond_earrings3.png',
    'diamond_earrings4.png',
    'diamond_earrings5.png',
    'diamond_earrings6.png',
    'diamond_earrings7.png',
    'diamond_earrings8.png',
    'diamond_earrings9.png'
  ],

  // diamond_necklaces/diamond_necklaces1.png ... 6
  diamond_necklaces: [
    'diamond_necklaces1.png',
    'diamond_necklaces2.png',
    'diamond_necklaces3.png',
    'diamond_necklaces4.png',
    'diamond_necklaces5.png',
    'diamond_necklaces6.png'
  ],

  // gold_earrings/earring16.png + gold_earrings1.png ... 7
  gold_earrings: [
    'earring16.png',
    'gold_earrings1.png',
    'gold_earrings2.png',
    'gold_earrings3.png',
    'gold_earrings4.png',
    'gold_earrings5.png',
    'gold_earrings6.png',
    'gold_earrings7.png'
  ],

  // gold_necklaces folder – fill later once you add files
  gold_necklaces: [
    // 'gold_necklaces1.png',
    // 'gold_necklaces2.png'
  ]
};

function buildSrc(typeKey, filename) {
  return `${typeKey}/${filename}`;
}

/* ===========================================
   2. LOAD JEWELRY FROM LOCAL FOLDERS
=========================================== */

function showResolutionInfo(img, path) {
  if (!resolutionBox) return;

  const w = img.width;
  const h = img.height;
  const maxSide = Math.max(w, h);

  let label, bg, border;

  if (maxSide >= 900) {
    label = 'HQ';
    bg = 'rgba(46, 204, 113, 0.9)';   // green
    border = '#2ecc71';
  } else if (maxSide >= 500) {
    label = 'OK';
    bg = 'rgba(241, 196, 15, 0.9)';   // yellow
    border = '#f1c40f';
  } else {
    label = 'LOW';
    bg = 'rgba(231, 76, 60, 0.9)';    // red
    border = '#e74c3c';
  }

  resolutionBox.style.display = 'block';
  resolutionBox.style.background = bg;
  resolutionBox.style.borderColor = border;
  resolutionBox.textContent = `📐 ${w} × ${h}px · ${label}`;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      showResolutionInfo(img, src);
      resolve(img);
    };
    img.onerror = () => {
      console.warn('Image failed:', src);
      resolve(null);
    };
    img.src = src;
  });
}

async function changeJewelry(typeKey, src) {
  const img = await loadImage(src);
  if (!img) return;
  earringImg = necklaceImg = null;
  if (typeKey.includes('earrings')) earringImg = img;
  else necklaceImg = img;
}

/* ===========================================
   3. CATEGORY + SUBCATEGORY HANDLING
=========================================== */

function toggleCategory(category) {
  stopAutoTry();
  currentCategory = category;

  jewelryOptions.style.display = 'none';

  const allSubButtons = document.querySelectorAll('#subcategory-buttons button');
  allSubButtons.forEach(btn => {
    const btnCat = btn.dataset.category;
    btn.style.display = (btnCat === category) ? 'inline-block' : 'none';
  });

  subcategoryButtons.style.display = 'flex';
}

function selectJewelryType(category, metal) {
  stopAutoTry();

  const typeKey = `${metal}_${category}`;  // eg: gold_earrings
  currentTypeKey = typeKey;

  subcategoryButtons.style.display = 'none';
  jewelryOptions.style.display = 'flex';

  insertJewelryOptions(typeKey);
}

window.toggleCategory = toggleCategory;
window.selectJewelryType = selectJewelryType;

// Build thumbnail list for selected type
function insertJewelryOptions(typeKey) {
  jewelryOptions.innerHTML = '';
  const files = LOCAL_IMAGES[typeKey] || [];

  files.forEach((filename) => {
    const src = buildSrc(typeKey, filename);
    const btn = document.createElement('button');
    const img = document.createElement('img');
    img.src = src;

    img.onload = () => {
      btn.onclick = () => changeJewelry(typeKey, src);
      btn.appendChild(img);
      jewelryOptions.appendChild(btn);
    };
  });
}

/* ===========================================
   4. MEDIAPIPE FACE MESH
=========================================== */

const faceMesh = new FaceMesh({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

faceMesh.onResults(results => {
  canvasCtx.clearRect(0,0,canvasElement.width,canvasElement.height);

  if (results.multiFaceLandmarks?.length) {
    const newLandmarks = results.multiFaceLandmarks[0];

    if (!smoothedFaceLandmarks) {
      smoothedFaceLandmarks = newLandmarks;
    } else {
      smoothedFaceLandmarks = smoothedFaceLandmarks.map((p, i) => ({
        x: p.x * 0.8 + newLandmarks[i].x * 0.2,
        y: p.y * 0.8 + newLandmarks[i].y * 0.2,
        z: p.z * 0.8 + newLandmarks[i].z * 0.2
      }));
    }
    drawJewelry(smoothedFaceLandmarks, canvasCtx);
  }
});

// Start camera
document.addEventListener('DOMContentLoaded', () => startCamera());

function startCamera(facingMode = 'user') {
  if (camera) camera.stop();
  camera = new Camera(videoElement, {
    onFrame: async () => await faceMesh.send({ image: videoElement }),
    width: 1280,
    height: 720,
    facingMode
  });
  camera.start();
}

videoElement.onloadedmetadata = () => {
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
};

/* ===========================================
   5. DRAW JEWELRY
=========================================== */

function drawJewelry(face, ctx) {
  if (!face) return;
  const context = ctx || canvasCtx;

  const vw = canvasElement.width;
  const vh = canvasElement.height;

  const L = face[33];
  const R = face[263];
  const eyeDist = Math.hypot((R.x - L.x) * vw, (R.y - L.y) * vh);

  // Earrings
  const le = face[132];
  const re = face[361];

  const leftPos = { x: le.x * vw, y: le.y * vh };
  const rightPos = { x: re.x * vw, y: re.y * vh };

  smoothedFacePoints.left = smoothPoint(smoothedFacePoints.left, leftPos);
  smoothedFacePoints.right = smoothPoint(smoothedFacePoints.right, rightPos);

  if (earringImg) {
    const w = eyeDist * 0.32;   // slightly smaller to reduce blur
    const h = w * (earringImg.height / earringImg.width);

    context.drawImage(
      earringImg,
      smoothedFacePoints.left.x - w / 2,
      smoothedFacePoints.left.y,
      w,
      h
    );
    context.drawImage(
      earringImg,
      smoothedFacePoints.right.x - w / 2,
      smoothedFacePoints.right.y,
      w,
      h
    );
  }

  // Necklace
  const neck = face[152];
  const neckPos = { x: neck.x * vw, y: neck.y * vh };
  smoothedFacePoints.neck = smoothPoint(smoothedFacePoints.neck, neckPos);

  if (necklaceImg) {
    const w = eyeDist * 1.6;
    const h = w * (necklaceImg.height / necklaceImg.width);
    const offset = eyeDist * 1.0;

    context.drawImage(
      necklaceImg,
      smoothedFacePoints.neck.x - w / 2,
      smoothedFacePoints.neck.y + offset,
      w,
      h
    );
  }
}

function smoothPoint(prev, curr, factor = 0.4) {
  if (!prev) return curr;
  return {
    x: prev.x * (1 - factor) + curr.x * factor,
    y: prev.y * (1 - factor) + curr.y * factor
  };
}

/* ===========================================
   6. CAPTURE CURRENT FRAME (FOR SNAPSHOT / GALLERY)
=========================================== */

function captureCurrentFrameDataURL() {
  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = canvasElement.width;
  snapCanvas.height = canvasElement.height;
  const ctx = snapCanvas.getContext('2d');

  ctx.drawImage(videoElement, 0, 0, snapCanvas.width, snapCanvas.height);
  if (smoothedFaceLandmarks) {
    drawJewelry(smoothedFaceLandmarks, ctx);
  }

  return snapCanvas.toDataURL('image/png');
}

/* ===========================================
   7. MANUAL SNAPSHOT (TOP CAMERA BUTTON)
=========================================== */

function takeSnapshot() {
  lastSnapshotDataURL = captureCurrentFrameDataURL();
  snapshotPreview.src = lastSnapshotDataURL;
  snapshotModal.style.display = 'flex';
}

function closeSnapshot() {
  snapshotModal.style.display = 'none';
}

function downloadSnapshot() {
  const a = document.createElement('a');
  a.href = lastSnapshotDataURL;
  a.download = 'tryon.png';
  a.click();
}

async function shareSnapshot() {
  if (!navigator.share || !navigator.canShare) {
    alert('Sharing not supported on this device.');
    return;
  }
  const blob = await (await fetch(lastSnapshotDataURL)).blob();
  const file = new File([blob], 'tryon.png', { type: 'image/png' });

  await navigator.share({ files: [file], title: 'Jewels Try-On' });
}

captureBtn.addEventListener('click', takeSnapshot);
closeSnapshotBtn.addEventListener('click', closeSnapshot);
downloadBtn.addEventListener('click', downloadSnapshot);
shareBtn.addEventListener('click', shareSnapshot);

/* ===========================================
   8. TRY ALL + AUTO SCREENSHOT + GALLERY
=========================================== */

function stopAutoTry() {
  autoTryRunning = false;
  if (autoTryTimeout) clearTimeout(autoTryTimeout);
  autoTryTimeout = null;
  autoTryBtn.classList.remove('active');
  autoTryBtn.textContent = 'TRY ALL';
}

async function runAutoTryAll() {
  if (!currentTypeKey) {
    alert('Please choose Earrings/Chains and then Gold/Diamond first.');
    stopAutoTry();
    return;
  }

  const files = LOCAL_IMAGES[currentTypeKey] || [];
  if (!files.length) {
    alert('No jewelry images found for this type.');
    stopAutoTry();
    return;
  }

  autoSnapshots = [];
  autoTryIndex = 0;
  autoTryRunning = true;
  autoTryBtn.classList.add('active');
  autoTryBtn.textContent = 'STOP';

  const loopStep = async () => {
    if (!autoTryRunning) return;

    const filename = files[autoTryIndex];
    const src = buildSrc(currentTypeKey, filename);

    await changeJewelry(currentTypeKey, src);
    await new Promise(res => setTimeout(res, 1200));

    const dataURL = captureCurrentFrameDataURL();
    autoSnapshots.push(dataURL);

    autoTryIndex++;
    if (autoTryIndex >= files.length) {
      stopAutoTry();
      openGallery();
      return;
    }

    autoTryTimeout = setTimeout(loopStep, 200);
  };

  loopStep();
}

function toggleAutoTry() {
  if (autoTryRunning) stopAutoTry();
  else runAutoTryAll();
}

autoTryBtn.addEventListener('click', toggleAutoTry);

/* GALLERY */

function openGallery() {
  if (!autoSnapshots.length) {
    alert('No snapshots captured.');
    return;
  }

  galleryThumbs.innerHTML = '';

  autoSnapshots.forEach((src, idx) => {
    const img = document.createElement('img');
    img.src = src;
    img.addEventListener('click', () => setGalleryMain(idx));
    galleryThumbs.appendChild(img);
  });

  setGalleryMain(0);
  galleryModal.style.display = 'flex';
}

function setGalleryMain(index) {
  const src = autoSnapshots[index];
  galleryMain.src = src;

  const thumbs = galleryThumbs.querySelectorAll('img');
  thumbs.forEach((t, i) => {
    t.classList.toggle('active', i === index);
  });
}

function closeGallery() {
  galleryModal.style.display = 'none';
}

galleryClose.addEventListener('click', closeGallery);

/* ===========================================
   9. WHATSAPP SHARE FROM GALLERY
=========================================== */

function shareGalleryViaWhatsApp() {
  if (!autoSnapshots || autoSnapshots.length === 0) {
    alert('No snapshots to share.');
    return;
  }

  const input = prompt(
    'Enter customer WhatsApp number with country code (example: 91XXXXXXXXXX):'
  );
  if (!input) return;

  const phone = input.replace(/\D/g, '');
  if (!phone) {
    alert('Invalid number. Please try again.');
    return;
  }

  const message = encodeURIComponent(
    'Hi! These are your jewelry try-on looks from Jewels-Ai.\n\n' +
    'We will now share the photos from our WhatsApp number: +917019743880.\n\n' +
    '— Overlay Jewels'
  );

  const waUrl = `https://wa.me/${phone}?text=${message}`;
  window.open(waUrl, '_blank');
}

whatsappShareBtn.addEventListener('click', shareGalleryViaWhatsApp);
