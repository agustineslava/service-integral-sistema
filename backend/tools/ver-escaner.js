/* ver-escaner.js - escaner qr checks */
const fs = require('fs');
const path = require('path');
function leer(p){ return fs.readFileSync(p,'utf8'); }
function main(){
  const escHtml = path.join(__dirname,'..','..','frontend','escaner.html');
  const escJs = path.join(__dirname,'..','..','frontend','escaner.js');
  const escCss = path.join(__dirname,'..','..','frontend','escaner.css');
  const jsqr = path.join(__dirname,'..','..','frontend','vendor','jsqr.min.js');
  let ok=0,fall=0;
  function c(n,v){ if(v){ok++; console.log('  OK    '+n);} else {fall++; console.log('  FALLO '+n);} }
  try{
    c('existe escaner.html', fs.existsSync(escHtml));
    c('existe escaner.js', fs.existsSync(escJs));
    c('existe escaner.css', fs.existsSync(escCss));
    c('existe vendor/jsqr.min.js', fs.existsSync(jsqr));
    const html=leer(escHtml);
    c('auth-check.js incluido', html.includes('auth-check.js'));
    c('jsQR incluido', html.includes('jsqr.min.js'));
    c('video presente', html.includes('id="video"'));
    c('canvas presente', html.includes('id="canvas"'));
    const js=leer(escJs);
    c('usa getUserMedia', js.includes('getUserMedia'));
    c('usa jsQR', js.includes('jsQR'));
    c('subida de imagen', js.includes('FileReader')||js.includes('accept="image/*"'));
    c('entrada manual', js.includes('btn-manual')||js.includes('manual'));
  }catch(e){fall++; console.log('  FALLO excepcion', e.message);}
  console.log('='.repeat(30));
  console.log('  '+ok+' OK / '+fall+' FALLO');
  if(fall>0) process.exit(1); process.exit(0);
}
main();