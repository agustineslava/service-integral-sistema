# F8 - Escáner QR

## Estado
- Implementado: sí
- Verificador: backend/tools/ver-escaner.js (12 OK / 0 FALLO)
- Mutador: backend/tools/mutar-escaner.js

## Funcionalidad
- Escaneo en vivo con cámara (getUserMedia, facingMode environment)
- Fallback por subida de imagen (FileReader + canvas)
- Entrada manual de código
- Navegación automática según tipo:
  - R-### → reparaciones.html?busqueda=
  - P-### → pedidos.html?busqueda=
  - PR-### / PRE-### → presupuestos.html?busqueda=
  - F-### → facturacion.html?busqueda=
  - numéricos → index.html?busqueda=
  - otros → index.html?busqueda=
- Solo para personal (requiere login via auth-check.js)
- jsQR 1.4.0 vendorizado (frontend/vendor/jsqr.min.js)
- Throttling para evitar múltiples redirecciones
- UI con estado, overlay, botones iniciar/detener

## Archivos
- frontend/escaner.html
- frontend/escaner.css
- frontend/escaner.js
- frontend/vendor/jsqr.min.js
- Actualizado: menú en páginas principales

## Verificación
node backend/tools/ver-escaner.js