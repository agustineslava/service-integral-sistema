---
name: db-migrations
description: Úsala siempre que crees, modifiques o revises una migración SQL, el esquema (`schema/base.sql`), el alta de empresas o los scripts de migración de Aexia, tanto para la base central como para las bases de empresa.
---

# Migraciones en Aexia

## Dos cadenas
- Central: `backend/migrations/central/NNN_*.sql`.
- Empresa: `backend/migrations/tenant/NNN_*.sql` (lee el `LEEME.txt` de esa carpeta). Se aplican a TODAS las bases de empresa.
- `backend/schema/base.sql` es el esquema inicial congelado. No lo edites para cambios nuevos: crea una migración.

## Reglas
- Usa el siguiente número libre y un nombre descriptivo. Nunca edites una migración ya aplicada: crea otra.
- Solo cambios aditivos: columna NULL o con DEFAULT, tabla nueva, índice. Nada de `DROP`, `TRUNCATE` ni renombrar en un solo paso.
- Para cambiar un tipo (por ejemplo un `enum` a `varchar`): agregar, copiar, cambiar el código y recién después retirar lo viejo, con mi aprobación.
- Una migración de empresa debe funcionar en una base nueva (alta de empresa) y en una existente (flota).
- Sin datos de negocio en migraciones. Los datos de catálogo (módulos, planes) van en la central.
- No dependas de nombres de base fijos dentro del SQL.

## Cómo probar
1. En desarrollo, con al menos dos bases de empresa, una de ellas la legacy (`ServiceIntegralsistema`).
2. Aplicar en flota (`--fleet`) y comprobar que el registro de migraciones queda igual en todas.
3. Dar de alta una empresa nueva y comprobar que llega al mismo esquema.
4. En producción: backup antes, y la ejecuta una persona, no el agente.

## Checklist
- [ ] ¿Es aditiva y tiene el número correcto?
- [ ] ¿Funciona en base nueva y en existente?
- [ ] ¿Toca `base.sql`? (no debería)
- [ ] ¿Pregunté antes de crearla? (AGENTS.md lo exige)

## Al terminar
Resume qué migración creaste, en qué cadena y cómo la probaste.
