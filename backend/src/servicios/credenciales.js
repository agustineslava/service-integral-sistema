/* ==========================================================================
   CREDENCIALES POR EMPRESA
   --------------------------------------------------------------------------
   Cada empresa puede tener su propia cuenta de Cloudinary. El api_secret se
   guarda CIFRADO (AES-256-GCM) en la base central y NUNCA se devuelve al
   frontend, ni se escribe en logs, ni en MEMORY.md.

   La clave de cifrado vive en el entorno (`CREDENCIALES_KEY`, 32 bytes en
   base64). Si se pierde, los secretos guardados quedan ilegibles y hay que
   volver a cargarlos; por eso conviene verificarla al arrancar.

   La empresa SIN cuenta propia cae en la de plataforma (`CLOUDINARY_*`), que
   es como funciona hoy. `cuentaDeEmpresa()` devuelve null solo si tampoco hay
   plataforma configurada.
   ========================================================================== */
const crypto = require('crypto');
const central = require('../db/central');

const ALGORITMO = 'aes-256-gcm';
const LARGO_IV = 12;
const LARGO_TAG = 16;

/** Lee y valida la clave de cifrado del entorno. */
function clave() {
    const crudo = process.env.CREDENCIALES_KEY;
    if (!crudo) {
        throw new Error(
            'Falta CREDENCIALES_KEY en el entorno. Generala con:\n' +
            '  openssl rand -base64 32\n' +
            'y agregala a backend/.env (el .env no se versiona).'
        );
    }
    const buf = Buffer.from(crudo, 'base64');
    if (buf.length !== 32) {
        throw new Error(
            'CREDENCIALES_KEY debe ser de 32 bytes en base64 ' +
            '(openssl rand -base64 32).'
        );
    }
    return buf;
}

/** Verifica que la clave exista y tenga el largo correcto. Tira si no. */
function verificarClave() {
    clave();
    return true;
}

/** Cifra un texto. Devuelve base64(iv | auth_tag | ciphertext). */
function cifrar(texto) {
    const iv = crypto.randomBytes(LARGO_IV);
    const cipher = crypto.createCipheriv(ALGORITMO, clave(), iv);
    const cifrado = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64');
}

/** Descifra lo que devolvio `cifrar`. Tira si la clave no es la misma. */
function descifrar(blob) {
    const datos = Buffer.from(String(blob), 'base64');
    if (datos.length < LARGO_IV + LARGO_TAG) {
        throw new Error('El secreto cifrado esta incompleto.');
    }
    const iv = datos.subarray(0, LARGO_IV);
    const tag = datos.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
    const cifrado = datos.subarray(LARGO_IV + LARGO_TAG);
    const decipher = crypto.createDecipheriv(ALGORITMO, clave(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
}

/** Cuenta de la plataforma: la de siempre, para empresas sin cuenta propia. */
function cuentaDePlataforma() {
    const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
    const api_key = process.env.CLOUDINARY_API_KEY;
    const api_secret = process.env.CLOUDINARY_API_SECRET;
    if (!cloud_name || !api_key || !api_secret) return null;
    return { origen: 'plataforma', cloud_name, api_key, api_secret };
}

/**
 * Cuenta con la que sube/borra esta empresa: la propia si esta activa, si no la
 * de plataforma. Devuelve null si no hay ninguna configurada.
 */
async function cuentaDeEmpresa(empresaId) {
    const fila = await central.uno(
        `SELECT cloud_name, api_key, api_secret_cifrado, activo
           FROM empresa_cloudinary WHERE empresa_id = ?`,
        [empresaId]
    );

    if (!fila || !fila.activo) return cuentaDePlataforma();

    if (!fila.cloud_name || !fila.api_key || !fila.api_secret_cifrado) {
        throw new Error('La cuenta de Cloudinary de esta empresa esta incompleta.');
    }

    let api_secret;
    try {
        api_secret = descifrar(fila.api_secret_cifrado);
    } catch {
        throw new Error(
            'No se pudo descifrar el api_secret de Cloudinary de esta empresa. ' +
            '¿Cambió CREDENCIALES_KEY? Hay que volver a cargar la cuenta.'
        );
    }

    return { origen: 'empresa', cloud_name: fila.cloud_name, api_key: fila.api_key, api_secret };
}

module.exports = { verificarClave, cifrar, descifrar, cuentaDePlataforma, cuentaDeEmpresa };
