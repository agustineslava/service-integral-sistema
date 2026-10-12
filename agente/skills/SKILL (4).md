---
name: aexia-security
description: Úsala siempre que escribas o revises código de Aexia que toque autenticación, roles, entrada de usuarios, SQL, archivos subidos, secretos, plantillas de mensajes, el panel de superadmin o configuración de seguridad del servidor, y cuando se pida una auditoría de seguridad.
---

# Seguridad en Aexia (multi-empresa)

Complementa a `tenant-isolation`. Aquí van los controles generales; la separación entre empresas está en esa skill.

## Controles que se revisan siempre
- Secretos: nada de claves, tokens ni contraseñas en el repositorio. Todo en `.env`, que no se versiona. Nunca imprimas secretos en logs.
- Autenticación: el secreto del token viene del entorno y tiene vencimiento. Contraseñas con hash adecuado. Límite de intentos en el login.
- Roles: comprueba el rol en el servidor (`requiereAdmin`, rutas de superadmin separadas). Nunca confíes en datos de rol que envía el cliente.
- Entrada: valida y normaliza en el servidor (como hace `validarReparacion`). Largos máximos, tipos y valores permitidos.
- SQL: siempre parametrizado.
- XSS: no insertes texto de usuarios con `innerHTML`; usa `textContent` o escapa. Las plantillas de WhatsApp y de comprobantes cuentan.
- Archivos subidos (logos): tipo, tamaño máximo y nombre controlados.
- HTTP: CORS limitado a los dominios de Aexia, cabeceras de seguridad, HTTPS.
- Errores: al cliente, mensajes genéricos; el detalle va al log del servidor, sin datos personales.
- Dependencias: `npm audit` y revisar paquetes nuevos antes de agregarlos (AGENTS.md exige preguntar).
- Datos personales: clientes, teléfonos y direcciones no se registran en logs ni en `MEMORY.md`.

Verifica en el código real cada punto; no asumas que ya está hecho.

## Auditorías con skills de terceros
- Auditoría de todo el repositorio: skill `security-audit` de Cloudflare. Corre varias veces (cada pasada cubre rutas distintas) y trata cada hallazgo como hipótesis hasta reproducirlo.
- Pruebas dinámicas (por ejemplo Strix): solo contra una copia local o de staging con datos falsos. Nunca contra producción ni contra datos reales de empresas.
- Biblioteca de ciberseguridad de la comunidad: instala solo skills sueltas de seguridad web, API o identidades, después de leerlas. Incluye contenido ofensivo.

## Cómo reportar un hallazgo
1. Severidad y archivo:línea.
2. Escenario de ataque concreto (quién, qué hace, qué obtiene).
3. Arreglo propuesto y qué prueba lo confirma.
4. Si lo arregla el agente: un hallazgo por vez, en modo Plan primero.

## Al terminar
Indica qué controles de la lista comprobaste y cuáles quedan pendientes.
