/* Escáner QR - solo personal, requiere login */
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const estadoEl = document.getElementById('estado');
const resultadoEl = document.getElementById('resultado');
const btnManual = document.getElementById('btn-manual');
const inputManual = document.getElementById('manual');
const inputImagen = document.getElementById('input-imagen');
const btnDetener = document.getElementById('btn-detener');
const btnIniciar = document.getElementById('btn-iniciar');
let stream = null;
let escaneando = false;
let ultimoCodigo = '';
let ultimoTiempo = 0;
const THROTTLE_MS = 800;
function setEstado(txt){if(estadoEl)estadoEl.textContent=txt;}
function detenerCamara(){escaneando=false;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}if(video)video.srcObject=null;if(canvas)canvas.hidden=true;setEstado('Cámara detenida');}
async function iniciarCamara(){
  try{
    if(stream)detenerCamara();
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    video.srcObject=stream;await video.play();canvas.hidden=true;escaneando=true;setEstado('Escaneando...');solicitarFrame();
  }catch(e){console.error(e);setEstado('No se pudo acceder a la cámara.');escaneando=false;}
}
function decodificarCanvas(){
  if(!canvas||canvas.width===0)return null;
  const img=ctx.getImageData(0,0,canvas.width,canvas.height);
  try{return window.jsQR(img.data,img.width,img.height);}catch(err){console.error(err);return null;}
}
function procesarCodigo(codigo){
  if(!codigo)return;
  const t=String(codigo).trim();if(!t)return;
  const ahora=Date.now();
  if(t===ultimoCodigo&&(ahora-ultimoTiempo)<THROTTLE_MS)return;
  ultimoCodigo=t;ultimoTiempo=ahora;
  resultadoEl.hidden=false;resultadoEl.textContent=t;
  try{
    if(/^R-\d+$/i.test(t)){window.location.href='reparaciones.html?busqueda='+encodeURIComponent(t);return;}
    if(/^P-\d+$/i.test(t)){window.location.href='pedidos.html?busqueda='+encodeURIComponent(t);return;}
    if(/^(PR|PRE)-\d+$/i.test(t)){window.location.href='presupuestos.html?busqueda='+encodeURIComponent(t);return;}
    if(/^F-\d+$/i.test(t)){window.location.href='facturacion.html?busqueda='+encodeURIComponent(t);return;}
    if(/^\d+$/.test(t)){window.location.href='index.html?busqueda='+encodeURIComponent(t);return;}
    window.location.href='index.html?busqueda='+encodeURIComponent(t);
  }catch(err){console.error(err);}
}
function solicitarFrame(){
  if(!escaneando)return;
  if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0){
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const qr=decodificarCanvas();
    if(qr&&qr.data)procesarCodigo(qr.data);
  }
  requestAnimationFrame(solicitarFrame);
}
function decodificarDesdeImagen(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=function(){
      canvas.width=img.width;canvas.height=img.height;
      ctx.drawImage(img,0,0,canvas.width,img.height);
      const qr=decodificarCanvas();
      if(qr&&qr.data){procesarCodigo(qr.data);setEstado('Código encontrado');}
      else{setEstado('No se detectó QR');resultadoEl.hidden=false;resultadoEl.textContent='No se detectó QR en la imagen';}
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
document.addEventListener('DOMContentLoaded',()=>{
  btnManual?.addEventListener('click',()=>{if(inputManual&&inputManual.value)procesarCodigo(inputManual.value);});
  inputManual?.addEventListener('keypress',(ev)=>{if(ev.key==='Enter'&&inputManual.value)procesarCodigo(inputManual.value);});
  inputImagen?.addEventListener('change',(ev)=>{const f=ev.target.files&&ev.target.files[0];if(f){decodificarDesdeImagen(f);ev.target.value='';}});
  btnDetener?.addEventListener('click',detenerCamara);
  btnIniciar?.addEventListener('click',iniciarCamara);
  iniciarCamara();
});