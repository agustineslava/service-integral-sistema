---
name: tenant-isolation
description: Úsala siempre que escribas, modifiques o revises rutas, consultas SQL, middlewares, jobs o scripts de Aexia que lean o escriban datos de una empresa, o que toquen la base central.
---

# Aislamiento entre empresas en Aexia

Una fuga de datos entre empresas es el peor bug posible de este proyecto. Sigue esta guía siempre que toques datos.

## Modelo
- Base central (`si_central`): empresas, superadmin, módulos, planes y contratos. Nunca datos de negocio.
- Una base por empresa (`si_tenant_*`): stock, clientes, órdenes, pedidos, presupuestos, facturación.
- El superadmin pertenece a la plataforma: `empresa_id NULL`.

## Reglas
- La empresa sale siempre del token verificado. Nunca de `req.body`, `req.query` ni `req.params`.
- Usa el acceso a la base de la empresa que ya existe en `backend/src/db/`. No abras conexiones nuevas ni pools globales.
- Prohibido fijar una base o una empresa: nada de `obtenerPool('serviceintegralsistema')`, `empresa_id = 1` ni `DB_NAME` dentro de rutas. Este error ya existió en la ruta pública de etiquetas.
- Consultas siempre parametrizadas (`?`). Nunca concatenar texto del usuario en SQL.
- Orden de middlewares en las rutas de una función: `verificarToken` → `requiereModulo('<codigo>')` → `requiereAdmin` si escribe.
- Rutas públicas (por ejemplo etiquetas QR): resuelve la empresa por slug o token firmado, comprueba que exista y esté activa. Nunca por un id secuencial.
- Jobs y scripts (backup, migraciones, cron): recorren las empresas registradas en la central (`nombre_db`), no una base fija.
- El superadmin entra a datos de una empresa solo por rutas del panel, de forma explícita.

## Checklist de revisión
- [ ] ¿Hay alguna base, id de empresa o slug fijo en el código?
- [ ] ¿Alguna consulta concatena texto?
- [ ] ¿La ruta tiene los middlewares en orden?
- [ ] ¿Algún job o script usa solo `DB_NAME`?
- [ ] ¿Qué pasa si el token de la empresa A pide un id de la empresa B? (debe dar 404)
- [ ] ¿Se guardó algo de negocio en la central?

## Al terminar
Indica qué puntos del checklist comprobaste y cómo (idealmente con dos empresas de prueba que tengan el mismo id de registro).
