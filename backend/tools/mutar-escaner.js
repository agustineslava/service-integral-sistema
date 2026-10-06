/* mutar-escaner.js */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
function run(args){ const r=spawnSync('node', args, { cwd: __dirname, encoding: 'utf8' }); return r; }
const ver = path.join(__dirname,'ver-escaner.js');
const escHtml = path.join(__dirname,'..','..','frontend','escaner.html');
const escJs = path.join(__dirname,'..','..','frontend','escaner.js');
let fallos=0, oks=0;
const bh=fs.readFileSync(escHtml); const bj=fs.readFileSync(escJs);
function test(name, mut, rest){
  try{ mut(); }catch(e){}
  const r=run([ver]);
  if(r.status!==0){ oks++; console.log('OK '+name); }
  else { fallos++; console.log('FALLO '+name+' (no detecto)'); }
  try{ rest(); }catch(e){}
}
test('sin getUserMedia', ()=>{ fs.writeFileSync(escJs, bj.toString().replace('getUserMedia','GM_X')); }, ()=>{ fs.writeFileSync(escJs,bj); });
test('sin jsQR', ()=>{ fs.writeFileSync(escHtml, bh.toString().replace('jsqr.min.js','xx')); }, ()=>{ fs.writeFileSync(escHtml,bh); });
if(fallos>0) process.exit(1); else { console.log(oks+' OK'); process.exit(0); }