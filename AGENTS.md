# AGENTS.md — Aexia

Plataforma multi-empresa (multi-tenant) de gestión para talleres y comercios: stock, clientes, órdenes de servicio, pedidos, presupuestos y facturación. Aexia es la plataforma; Service Integral es una empresa cliente más, no la dueña del sistema.

## Stack y estructura
- Node.js + Express (`backend/server.js`), MySQL, frontend HTML/JS sin framework (`frontend/`).
- Base central `si_central` (empresas, superadmin, módulos, planes) + una base por empresa `si_tenant_*`.
- `backend/migrations/central|tenant/`: SQL numerado. `backend/schema/base.sql`: esquema inicial de empresa (congelado).
- `backend/src/db/` conexiones, `src/servicios/altas.js` alta de empresa, `backend/tools/` instaladores y verificadores.

## Comandos
- Instalar: `cd backend && npm install`. Arrancar: `node server.js` (producción: pm2, `ecosystem.config.js`).
- Migraciones y verificadores: scripts de `backend/package.json`. Para todas las empresas, usar `--fleet`.

## Convenciones
- Interfaz en español; nombres de dominio en español, como el resto del código. Imita el archivo que toques.
- Toda ruta de una función lleva `verificarToken` + `requiereModulo('<codigo>')` (+ `requiereAdmin` si escribe). Excepciones conocidas: `config-comercio` y `central/empresa-por-email` son públicas (solo limitador de rate: el login y la marca no pueden pedir token); `/api/usuarios` lleva `requiereAdmin` sin módulo (los usuarios no son un módulo vendible); `cambiar-password` y `/api/admin/yo/clave` llevan solo `verificarToken` (cada uno cambia su propia clave).

## Reglas de dominio / trampas conocidas
- El superadmin tiene `empresa_id NULL`. Nunca hay datos de negocio en `si_central`.
- Prohibido hardcodear "Service Integral", `serviceintegralsistema`, `empresa_id = 1` o el slug `service-integral` (salvo herramientas de migración puntuales).
- La empresa sale siempre del token, nunca de un parámetro del cliente.
- Ocultar algo en pantalla no es seguridad: el servidor valida. `equipo` y `falla_declarada` son NOT NULL.
- Migraciones solo aditivas (columna NULL, tabla nueva) y aplicables a todas las empresas.
- Personalizar por empresa = configuración (JSON en la central), nunca código distinto por empresa.

## Forma de trabajar
- Cambios grandes o que toquen la central, migraciones, instalador o aislamiento entre empresas: modo Plan primero (`Shift+Tab` o `/feature`). No modifiques archivos hasta que apruebe el plan.
- Tareas chicas y obvias: Build directo, con cambios pequeños y enfocados.
- Al terminar: resume qué cambiaste y las decisiones que debo revisar.

## Límites
- ✅ Siempre: actualizar `MEMORY.md` al terminar cada tarea; filtrar por la empresa del token.
- ⚠️ Pregunta antes: dependencias nuevas, migraciones, cambios en la central, renombrar bases o usuarios MySQL (`si_*` → `aexia_*`), archivos nuevos.
- 🚫 Nunca: tocar `.env` o claves, `DROP`/`TRUNCATE`, operar sobre la base de producción, hardcodear una empresa.

## Verificación
- Probar en una base de desarrollo con al menos dos empresas: ninguna debe ver datos de la otra. Usa los verificadores de `backend/tools/`.

## Memoria
- Al empezar, lee `MEMORY.md`. Al terminar una tarea, actualízalo (estado, decisiones con su porqué, errores a evitar). Máx. ~50 líneas. Nunca guardes claves ni datos de clientes.
- Si algo se vuelve regla permanente, propón moverlo a este archivo.
