---
name: deploy-aexia
description: Úsala siempre que se hable de desplegar, instalar o restaurar Aexia en un servidor (Vultr u otro), crear usuarios de MySQL, configurar pm2, el proxy, el firewall, backups, restauraciones o variables de entorno.
---

# Despliegue de Aexia en Vultr

Estado: el instalador actual nació para un solo negocio (ver `MEMORY.md`). Hasta que exista `install:plataforma` e `importar-empresa`, no inventes comandos: lee los scripts reales de `backend/tools/` y `backend/package.json`.

## Reglas
- El agente prepara scripts y checklists; una persona los ejecuta en el servidor. Nunca operes contra producción sin mi aprobación.
- Nada de secretos en el repositorio ni en estos archivos. El `.env` se crea a mano en el servidor.
- Los `.bat` del repositorio son de Windows. En Vultr hacen falta equivalentes `.sh`, y revisar `MYSQLDUMP_PATH` en `.env`.

## Orden de una instalación
1. Servidor: usuario sin privilegios, actualizaciones, firewall (abrir solo 22, 80 y 443; MySQL no expuesto a internet).
2. Node.js y MySQL. Crear usuarios de MySQL con permisos mínimos: uno para la central y uno para las bases de empresa (patrón `si_tenant_%`, a renombrar a `aexia_*` cuando se migre).
3. Código desde Git y `npm install` en `backend/`.
4. `.env` con las variables que pide `.env.example` (revísalo; no copies valores de ejemplo).
5. Plataforma: central + superadmin, sin datos de negocio.
6. Empresas: alta desde el panel o importación de una existente (por ejemplo Service Integral) como empresa, no como plataforma.
7. Proceso con pm2 (`ecosystem.config.js`) y arranque al reiniciar el servidor.
8. Proxy inverso con HTTPS (dominio de Aexia) y redirección de HTTP.

## Backups y restauración
- Debe cubrir la central y TODAS las bases de empresa (hoy el job parece respaldar solo `DB_NAME`; verifícalo).
- Copia fuera del servidor y con retención definida.
- Una restauración de prueba mensual en una base aparte. Un backup que nunca se restauró no cuenta.

## Verificación posterior
- [ ] Login de superadmin y de dos empresas distintas.
- [ ] Una empresa no ve datos de otra.
- [ ] Backup y restauración probados.
- [ ] Puertos de MySQL cerrados desde afuera.
- [ ] Logs sin secretos.

## Al terminar
Resume qué quedó preparado, qué ejecutó una persona y qué falta confirmar en el servidor.
