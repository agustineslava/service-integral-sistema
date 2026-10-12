# Skills y herramientas para Aexia

## Skills propias (carpeta `.agents/skills/`, copiar a la raíz del repo)
| Skill | Cuándo se usa |
|---|---|
| `tenant-isolation` | Cualquier cambio que toque datos de una empresa o la central |
| `db-migrations` | Migraciones, `base.sql`, alta de empresas |
| `nuevo-modulo` | Agregar o cambiar funciones contratables |
| `empresa-config` | Personalización por empresa (campos, mensajes, categorías) |
| `aexia-security` | Autenticación, entrada de datos, secretos, auditorías |
| `deploy-aexia` | Instalación, backups y restauración en Vultr |
| `aexia-ui` | Pantallas, marca por empresa, vista móvil |

Después de copiarlas, reinicia OpenCode y ejecuta `/skills` para comprobar que aparecen.

## Skills de terceros: qué conviene y qué no
Todas se instalan con `npx skills add ...` (paquete `skills`). Lee el `SKILL.md` antes de instalar: son instrucciones que el agente va a seguir con tus permisos.

| Herramienta | Veredicto | Notas |
|---|---|---|
| cloudflare/security-audit-skill | Sí | `npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit`. Necesita un agente que lance subagentes. Guarda el informe fuera del repo. |
| Impeccable (Paul Bakaus) | Sí, como skill de diseño principal | `npx skills add pbakaus/impeccable`. El comando de arranque cambió entre versiones (`init` o `teach`): sigue el inicio rápido de impeccable.style. |
| SkillUI | Sí, con `--dir` | `npm install -g skillui` y `skillui --dir ./frontend` genera un `DESIGN.md` desde tu propio código. Evita `--url` para copiar el estilo de otros sitios. |
| Skills de Emil Kowalski (`emilkowalski/skills`) | Opcional, más adelante | Enfocadas en animaciones y detalles de interacción (`review-animations`). Aexia necesita poco movimiento. |
| Taste Skill (Leonxlnx) | Con cuidado | Orientada a landings, portfolios y rediseños. No es para pantallas de trabajo. Si la usas, solo `redesign-skill` o para una página pública. |
| "Anthropic Cybersecurity Skills" | Solo skills sueltas | No es de Anthropic: es un proyecto de la comunidad con 817 skills, algunas ofensivas. No instales todo. |
| Strix | Más adelante, solo en copia local | Pentest dinámico: ejecuta tu app y la ataca. Requiere Docker y una clave de LLM. Nunca contra producción. Lee el script de instalación antes de ejecutarlo. |
| Supabase | No | Supabase es Postgres y Aexia usa MySQL. |
| Context7 (MCP) | Sí | Documentación actualizada de Express, mysql2, etc. Necesita API key. |
| Playwright (MCP) | Sí | Para probar con dos empresas y vista móvil. |
| Figma (MCP) | Solo si diseñas en Figma | Se conecta con la URL de la documentación oficial de Figma. |

## MCP
`opencode.json` (en la raíz del repo) trae Context7 y Playwright. Reemplaza la API key de Context7 y no subas ese archivo a Git con la clave puesta. Reinicia OpenCode y usa `/mcps` para ver y activar o desactivar.

## Orden recomendado
1. `AGENTS.md`, `MEMORY.md` y skills propias (ya).
2. `security-audit` de Cloudflare sobre el repo, en una copia de desarrollo.
3. Impeccable + SkillUI cuando toques el frontend.
4. Strix y el resto, cuando haya un entorno de staging.
