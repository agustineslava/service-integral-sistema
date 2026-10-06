/* Escáner QR - solo personal, requiere login */
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let stream = null;
async function iniciarCamara() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    video.play();
    solicitarFrame();
  } catch (e) { console.error(e); }
}
function solicitarFrame() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.height = video.videoHeight; canvas.width = video.videoWidth;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0,0,canvas.width,canvas.height);
    const qr = window.jsQR(img.data, img.width, img.height);
    if (qr) { console.log(qr.data); document.getElementById('resultado').textContent = qr.data; }
  }
  requestAnimationFrame(solicitarFrame);
}
document.addEventListener('DOMContentLoaded', () => { iniciarCamara(); });