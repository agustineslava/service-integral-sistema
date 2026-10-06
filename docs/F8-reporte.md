# F8 - Escáner QR

## Objetivo
Implementar escáner QR solo para personal (login requerido). Soportar escaneo en vivo con cámara, subida de foto como fallback y entrada manual.

## Estado
- ✅ Escáner QR funcional (rontend/escaner.html, rontend/escaner.css, rontend/escaner.js)
- ✅ jsQR 1.4.0 vendorizado (rontend/vendor/jsqr.min.js)
- ✅ Navegación actualizada con data-modulo="escaner"
- ✅ Verificador y mutador creados (ackend/tools/ver-escaner.js, ackend/tools/mutar-escaner.js)
- ✅ Verificadores estáticos verdes

## Verificaciones
- er-reportes.js: 156 OK / 0 FALLO
- er-facturacion.js: 182 OK / 0 FALLO
- er-etiquetas-qr.js: 67 OK / 0 FALLO
- er-escaner.js: 12 OK / 0 FALLO
- er-estilo-y-tema.js: OK

## Notas
- Solo accesible a usuarios logueados (usa uth-check.js)
- Navegación inteligente según tipo de código (R-/P-/PR/F-/numéricos)
- Throttling para evitar redirecciones múltiples