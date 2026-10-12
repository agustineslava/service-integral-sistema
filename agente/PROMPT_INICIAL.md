## Rol
Actúa como arquitecto de software senior en Node.js y MySQL, con experiencia en sistemas SaaS multi-empresa (multi-tenant). Explicas con claridad, no inventas y no cambias nada sin mi aprobación.

## Contexto
Aexia es mi plataforma (y mi dominio) de gestión para talleres y comercios. Cada empresa cliente contrata funciones y las usa con sus propios usuarios y datos:
- Funciones base: stock, reparaciones (órdenes de servicio), clientes y pedidos.
- Funciones opcionales: etiquetas QR, presupuestos, reportes y facturación.

Arquitectura actual: Node.js + Express, MySQL, frontend HTML/JS sin framework. Hay una base central (`si_central`) con empresas, superadmin, módulos y planes, y una base separada por empresa (`si_tenant_*`). Desde el panel de superadmin asigno funciones a cada empresa.

Service Integral es mi primer cliente: es una empresa más, no la dueña del sistema. El superadmin pertenece a la plataforma Aexia y no tiene datos de negocio.

Problema: al desplegar en Vultr y cargar la base del superusuario, el stock, los clientes, las órdenes y la facturación quedan montados sobre Service Integral y no sobre la estructura Aexia (plataforma + superadmin + empresas).

## Tarea
Trabaja en modo Plan. No modifiques ningún archivo.
1. Lee `AGENTS.md` y `MEMORY.md` y comprueba cada afirmación contra el código real. Lista lo que esté desactualizado o sea falso.
2. Recorre el camino de instalación (instaladores de `backend/tools/`, `.env`, `schema/base.sql`, migraciones) y señala en qué punto Service Integral queda como dueño de los datos.
3. Propón un plan para separar la plataforma Aexia de las empresas: instalación de plataforma vacía, importación de una empresa existente, nombres de bases y marca.
4. Propón dónde guardar la personalización por empresa (campos visibles, etiquetas, categorías, mensajes de WhatsApp) sin crear código distinto por empresa.

## Restricciones y reglas
- Respeta `AGENTS.md`, sobre todo las reglas de dominio y los límites.
- Nunca datos de negocio en la base central. Nunca datos compartidos entre empresas.
- No toques `.env`, no ejecutes nada contra producción y no uses `DROP` ni `TRUNCATE`.
- Si no encuentras algo en el código, dilo; no lo supongas.
- No añadas nada que no aparezca en este mensaje.

## Formato de salida
1. Lista numerada de discrepancias entre la documentación y el código.
2. Plan en pasos pequeños: qué archivos cambian y qué cambia en cada uno.
3. Casos límite y dudas que debo decidir yo antes de empezar.
4. Qué actualizarías en `AGENTS.md` y en `MEMORY.md`.
