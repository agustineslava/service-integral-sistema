# F8 · Escáner QR

**Estado:** cerrado y verificado (25 OK / 0 FALLO estático, 8/8 mutaciones detectadas).
**Fecha:** 5 de octubre de 2026.
**Rama:** `multitenant`

---

## 1. Qué es esta fase

F8 añade la lectura de códigos QR desde el navegador, **solo para el personal con login**. Sin ruta pública.

---

## 2. Decisiones

- Solo personal, con login. No se crean endpoints públicos.
- jsQR 1.4.0 vendorizado (`frontend/vendor/jsqr.min.js`), sin CDN.
- Tres modos: cámara (prioriza trasera), subir foto y entrada manual.
- Al procesar un código se detiene la cámara.
- Coherente con estilo/temas del sistema.

---

## 3. Archivos

- `frontend/escaner.html`, `.css`, `.js`
- `frontend/vendor/jsqr.min.js`
- `backend/tools/ver-escaner.js`, `backend/tools/mutar-escaner.js`
- `docs/F8-reporte.md`

---

## 4. Verificación

| Comprobación | Resultado |
|---|---|
| `node tools/ver-escaner.js` | 25 OK / 0 FALLO |
| `node tools/mutar-escaner.js` | 8/8 mutaciones detectadas |
| `node --check frontend/escaner.js` | 0 |
| Barrido `reparar-texto.js` | sin cambios |

---