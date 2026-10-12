#!/usr/bin/env node
/* ==========================================================================
   src/config/entorno.js — Cargador unico de entorno (plan R-1, fase 2).
   --------------------------------------------------------------------------
   Reemplaza los `require('dotenv').config({ path: …'/.env' })` dispersos:
   server.js y cada herramienta cargan SOLO este modulo.

   Comportamiento:
     - Lee el archivo que diga AEXIA_ENV_FILE (por defecto backend/.env,
       para no cambiar el comportamiento actual).
     - Carga solo ese archivo: sin fallback a prod. Si se entro en modo dev
       por `--env-file` de Node sin AEXIA_ENV_FILE, aborta (los huecos que
       faltaran caerian en backend/.env = fuga a prod).
     - Si el entorno resultante es de desarrollo (AEXIA_ENTORNO=dev), valida
       y ABORTA ante senales de produccion:
         * MySQL de clientes (DB_PORT 3306 o sin definir) u host no local.
         * App de clientes (PORT 3000 o sin definir, target fijo del tunel).
         * NODE_ENV=production.
         * Central de clientes (si_central / aexia_central) o sin definir.
         * Credenciales que no sean de dev (DB_USER / DB_ADMIN_USER sin 'dev').
         * Cuentas de Cloudinary definidas con MEDIA_MODO=deshabilitado.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DIR_BACKEND = path.join(__dirname, '..', '..');

/** Ruta del archivo de entorno: AEXIA_ENV_FILE o backend/.env por defecto. */
function rutaArchivo() {
  const elegida = process.env.AEXIA_ENV_FILE;
  if (!elegida) return path.join(DIR_BACKEND, '.env');
  return path.isAbsolute(elegida) ? elegida : path.join(DIR_BACKEND, elegida);
}

const archivoExplicito = Boolean(process.env.AEXIA_ENV_FILE);
const yaEraDevPorEnvFile = String(process.env.AEXIA_ENTORNO || '').trim().toLowerCase() === 'dev';
const ARCHIVO = rutaArchivo();

if (!fs.existsSync(ARCHIVO)) {
  if (archivoExplicito) {
    console.error(`[entorno] ERROR: AEXIA_ENV_FILE apunta a "${ARCHIVO}" y ese archivo no existe.`);
    process.exit(1);
  }
  // Sin backend/.env: mismo silencio que el dotenv actual.
} else {
  dotenv.config({ path: ARCHIVO, quiet: true });
}

const enModoDev = String(process.env.AEXIA_ENTORNO || '').trim().toLowerCase() === 'dev';

// Red de seguridad: modo dev entrado por --env-file de Node pero sin
// AEXIA_ENV_FILE. El cargador no eligio el archivo dev, asi que lo que
// falte en .env.dev caeria en backend/.env (fuga de credenciales reales).
if (enModoDev && yaEraDevPorEnvFile && !archivoExplicito) {
  console.error(
    '[entorno] ERROR: AEXIA_ENTORNO=dev pero no se definio AEXIA_ENV_FILE.\n' +
    '  Usa un script dev:* (p. ej. npm run dev:server) para que el cargador elija .env.dev.'
  );
  process.exit(1);
}

if (enModoDev) {
  const fallas = [];

  // MySQL de clientes en 3306 (o sin definir: mysql2 usa 3306 por defecto).
  const dbPort = String(process.env.DB_PORT || '').trim();
  if (!dbPort || dbPort === '3306') {
    fallas.push(`DB_PORT=${dbPort || '(sin definir)'} -> apunta al MySQL de clientes (3306); en dev usa 3307.`);
  }

  // App de clientes en :3000 (target fijo del tunel de Cloudflare).
  const puertoApp = String(process.env.PORT || '').trim();
  if (!puertoApp || puertoApp === '3000') {
    fallas.push(`PORT=${puertoApp || '(sin definir)'} -> es la app de clientes (:3000, target del tunel); en dev usa 3100.`);
  }

  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    fallas.push('NODE_ENV=production -> en dev debe ser development.');
  }

  // Central de clientes (o sin definir: el default es si_central).
  const central = String(process.env.DB_CENTRAL_NAME || '').trim().toLowerCase();
  if (!central || central === 'si_central' || central === 'aexia_central') {
    fallas.push(`DB_CENTRAL_NAME=${process.env.DB_CENTRAL_NAME || '(sin definir)'} -> es la central de clientes (si_central/aexia_central); en dev usa aexia_dev_central.`);
  }

  // Host remoto: la instancia dev enlaza solo a loopback.
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  if (host && host !== '127.0.0.1' && host !== 'localhost') {
    fallas.push(`DB_HOST=${process.env.DB_HOST} -> debe ser 127.0.0.1 o localhost (la instancia dev enlaza solo a loopback).`);
  }

  // Credenciales que no sean de dev.
  for (const clave of ['DB_USER', 'DB_ADMIN_USER']) {
    const usuario = String(process.env[clave] || '').trim();
    if (!usuario) {
      fallas.push(`${clave} sin definir -> caeria en el usuario por defecto; en dev usa aexia_dev_app / aexia_dev_admin.`);
    } else if (!/dev/i.test(usuario)) {
      fallas.push(`${clave}=${usuario} -> no parece usuario de dev (debe contener 'dev', p. ej. aexia_dev_app).`);
    }
  }

  // Cuenta de Cloudinary real con la multimedia apagada.
  if (String(process.env.MEDIA_MODO || '').trim().toLowerCase() === 'deshabilitado') {
    for (const clave of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      if (String(process.env[clave] || '').trim()) {
        fallas.push(`${clave} definida con MEDIA_MODO=deshabilitado -> en dev no debe haber credenciales de Cloudinary.`);
      }
    }
  }

  if (fallas.length > 0) {
    console.error(`[entorno] ERROR: entorno de desarrollo (AEXIA_ENTORNO=dev) detecto senales de produccion (archivo: ${ARCHIVO}):`);
    for (const f of fallas) console.error(`  - ${f}`);
    console.error('  Revisa .env.dev / la plantilla .env.dev.example. Nada se conecto.');
    process.exit(1);
  }

  console.log(
    `[entorno] ENTORNO=dev · MySQL ${host || '127.0.0.1'}:${dbPort || '3307'} · app :${puertoApp || '3100'} · central ${process.env.DB_CENTRAL_NAME || 'aexia_dev_central'}`
  );
} else {
  console.log(`[entorno] ENTORNO=prod · ${ARCHIVO}`);
}

module.exports = { enModoDev, archivo: ARCHIVO };