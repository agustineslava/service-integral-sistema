---
name: nuevo-modulo
description: Úsala siempre que haya que agregar, cambiar o quitar una función (módulo) contratable de Aexia, por ejemplo stock, reparaciones, facturación o una nueva, o cuando se hable de qué plan incluye qué.
---

# Agregar un módulo a Aexia

Un módulo es una función que se asigna a cada empresa desde el panel de superadmin. El código es uno solo para todas; lo que cambia por empresa es qué módulos tiene activos.

## Piezas (de referencia: `migrations/central/002_catalogos.sql`)
- Central: fila en `modulos` (código, nombre, si es base) y, por empresa, fila en `empresa_modulos` (fechas y `limites`).
- Empresa: tablas del módulo, creadas por una migración de empresa.
- Servidor: rutas con `requiereModulo('<codigo>')`.
- Frontend: página propia y entrada de menú que solo aparece si el módulo está contratado.

## Pasos (en modo Plan primero)
1. Define el código del módulo (minúsculas, sin espacios) y si es base u opcional.
2. Migración central que lo inserta en `modulos`. Decide qué planes lo incluyen.
3. Migración de empresa con sus tablas (ver skill `db-migrations`). Las tablas llevan un prefijo claro del módulo.
4. Rutas del módulo con el orden `verificarToken` → `requiereModulo` → `requiereAdmin` si escribe (ver skill `tenant-isolation`).
5. Página del frontend y menú condicionado. Ocultar el menú no es seguridad: el servidor ya valida.
6. Comprobar que el panel de superadmin lo lista y permite activarlo.
7. Pruebas: empresa sin el módulo → rechazo; con el módulo → funciona; la empresa B no ve datos de A.
8. Actualiza `MEMORY.md` (y `AGENTS.md` si cambia una regla).

## Reglas
- Hoy las migraciones de empresa corren en todas las empresas, hayan contratado el módulo o no. Es aceptable, pero déjalo anotado en `MEMORY.md`.
- Si el módulo necesita personalización por empresa, usa la skill `empresa-config`; no crees código distinto por empresa.
- Para quitar un módulo: primero desactivarlo. Nunca borrar tablas con datos sin mi aprobación.
