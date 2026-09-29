# F1 · Reporte · Base central

**Fecha:** 29/09/2026
**Estado:** código completo y probado. Falta un paso interactivo (`npm run f1:setup`), que necesita la contraseña de root de MySQL.

---

## 1. Qué se construyó

La **base central** (`si_central`): el registro de todas las empresas. Es la que hace
posible pasar de "un sistema por cliente" a "un sistema con muchos clientes".

Contiene ocho tablas:

| Tabla | Para qué |
|---|---|
| `empresas` | Una fila por cliente |
| `usuarios_globales` | **Todos** los logins del sistema, en un solo lugar |
| `modulos` | Catálogo de todo lo que se puede contratar |
| `planes` | Qué incluye cada nivel de suscripción |
| `empresa_modulos` | Qué contrató cada empresa, con sus límites |
| `empresa_metricas` | Foto periódica de cada empresa (para no estar ciego) |
| `auditoria` | Quién hizo qué, desde dónde |
| `_schema_migrations` | Registro de migraciones aplicadas |

Y dos migraciones versionadas en `backend/migrations/central/`:

- `001_esquema_central.sql` — la estructura
- `002_catalogos.sql` — 8 módulos y 3 planes (`Básico` = **3 usuarios**, que es la
  regla de negocio definida)

### Por qué cada decisión

**La marca (logo, colores, subtítulo) va en la central y no en la base de la empresa.**
El usuario tiene que ver el logo de *su* empresa **antes** de escribir su email. Sin eso,
la pantalla de login sería genérica y no se sabría a qué sistema está entrando. El costo
es que esa consulta es pública y hay que protegerla con rate limiting (F5).

**Los datos operativos (reparaciones, productos, clientes) NO están acá.** Viven en la
base de cada empresa. Esa separación física es lo que da la garantía de "cero cruce de
datos": no es una regla que alguien tenga que recordar escribir en cada consulta, es que
la conexión apunta a otra base y punto.

**`usuarios_globales.email` es único a nivel global.** Consecuencia: una misma persona no
puede tener cuenta en dos empresas distintas. Se eligió así para que el login pueda
deducir la empresa **con solo el email**, sin pedirle nada más al usuario. Es una
decisión de diseño, no un descuido.

**`nombre_db` nunca lo escribe una persona.** Lo genera el servidor a partir del slug.
Es la columna que decide a qué base se conecta cada empresa: si un atacante la
controlara, elegiría a qué datos accede. Tres capas lo protegen:

1. Se genera en el servidor, no llega del cliente.
2. `CHECK` con expresión regular: sin backticks, sin punto y coma, sin mayúsculas.
3. El usuario de la app **no puede** crear ni borrar bases.

---

## 2. El motor de migraciones

`backend/src/db/migrations.js` + `backend/tools/migrate.js`.

Cada cambio de esquema es un archivo `.sql` numerado que se aplica **una sola vez** por
base y queda registrado. Tres garantías:

1. **No se reaplica trabajo ya hecho** — lo garantiza la tabla `_schema_migrations`.
2. **Si el archivo de una migración ya aplicada cambia, aborta.** Sin esto, dos empresas
   terminarían con esquemas distintos y nadie se enteraría.
3. **`--dry-run`** muestra qué haría, sin tocar nada.

### Expand-contract

Una migración **nunca** debe romper la versión anterior del código, porque mientras se
despliega, el código viejo y el nuevo conviven unos minutos.

```
BIEN:  agregar columna NULL o con DEFAULT
BIEN:  crear tabla nueva
BIEN:  agregar un índice
MAL:   renombrar una columna en un solo paso
MAL:   borrar una columna que el código todavía usa
```

Para renombrar o borrar: se agrega lo nuevo, se despliega, se deja de usar lo viejo, y
**recién después** una migración posterior lo elimina.

### Comandos

```bash
# Estado del esquema central
npm run migrate:estado

# Ver qué se aplicaría, sin tocar nada
npm run migrate:simular

# Aplicar
npm run migrate:central

# Toda la flota de empresas
npm run migrate:flota:simular
npm run migrate:flota
```

> **Nota sobre Windows:** `npm run migrate -- --central` **no funciona** en PowerShell:
> npm se come los argumentos que empiezan con `--`, y el script corre sin banderas —
> silenciosamente con el modo por defecto. Por eso existen los scripts de arriba, que
> llevan las banderas dentro del `package.json`. Para uso directo:
> `node tools/migrate.js --central --status`.

---

## 3. Cómo se validó sin root

`si_tenant_admin` ya tenía permiso para crear y borrar bases que empiecen con
`si_tenant_`. Eso permitió crear una base descartable (`si_tenant_test_esquema`), aplicarle
las migraciones centrales, comprobarlas y borrarla — **sin tocar `si_central` ni la base
del taller, y sin pedir root**.

```bash
npm run esquema:test
```

**47 comprobaciones, todas en verde.** Cubren: las 8 tablas, motores InnoDB, charsets
utf8mb4, los catálogos cargados, las reglas de integridad (nombres de base inválidos,
colores mal formados, slugs inválidos, unicidad de email, claves foráneas, límites JSON),
las cascadas al borrar una empresa, la idempotencia del motor y la detección de deriva.

### El bug que encontró la prueba

`nombre_db` **aceptaba `BaseMala`**.

La columna es `utf8mb4_0900_ai_ci` (insensible a mayúsculas), así que `REGEXP '[a-z]'`
también matchea `A-Z`. En Windows, MySQL tampoco distingue mayúsculas en los nombres de
base: `Si_Tenant_X` y `si_tenant_x` serían **la misma base**. Exactamente el tipo de
detalle que produce cruce de datos.

Arreglado con `REGEXP_LIKE(..., 'c')` (el modificador `c` fuerza comparación sensible a
mayúsculas). Un primer intento con `BINARY` falló:
`Character set 'binary' cannot be used in conjunction with 'utf8mb4_0900_ai_ci'`.

También se agregó un `CHECK` para el slug (será el subdominio): minúsculas, sin guion al
principio ni al final, sin espacios, sin acentos.

**Esto se corrigió sin costo porque la migración `001` todavía no se había aplicado a
ninguna base real.** Una vez aplicada, es inmutable: los cambios van en una migración
nueva.

---

## 4. Un bug latente de F0 que se corrigió

`setup-f0-db.js` usaba:

```sql
CREATE USER IF NOT EXISTS 'si_tenant_admin'@'localhost' IDENTIFIED BY '<nueva>'
```

Si el usuario **ya existe**, MySQL **no cambia la contraseña** — pero el script igual
escribía `<nueva>` en el `.env`. Al re-ejecutarlo, `DB_ADMIN_PASSWORD` habría quedado
apuntando a una contraseña que no es la real, y el taller se quedaba sin poder crear
bases. Ahora se separa en dos sentencias: `CREATE USER IF NOT EXISTS` (crear si falta) y
`ALTER USER ... IDENTIFIED BY` (fijar la contraseña de verdad).

También se corrigió una etiqueta que decía "Base central" apuntando a la base del taller.

---

## 5. Modelo de seguridad: dos identidades

| | `service_integral_app` | `si_tenant_admin` |
|---|---|---|
| Para qué | El servidor en runtime | Instaladores y migraciones |
| Lee/escribe datos | Sí | Sí |
| `CREATE` / `DROP` / `ALTER` | **No** | Sí |
| Dónde se usa | Cada request | `f1:setup`, `migrate` |

La app en runtime **no tiene permisos de DDL**. Si algún día una inyección SQL llegara a
la aplicación, no podría destruir nada. En la central, `service_integral_app` tiene solo
`SELECT, INSERT, UPDATE, DELETE` — y `f1:setup` lo **verifica**: intenta crear una tabla
con las credenciales de la app y confirma que MySQL la rechaza.

---

## 6. Qué falta para cerrar F1

Un solo paso, interactivo, que pide la contraseña de root de MySQL:

```bash
npm run f1:setup
```

Hace, en orden:

1. Asegura `si_tenant_admin` — si ya existe, **conserva** su contraseña.
2. Le da permisos sobre `si_central` y las bases de empresas.
3. Le da a la app permisos de lectura/escritura (sin DDL) sobre `si_central`.
4. Crea `si_central`.
5. Aplica las migraciones del esquema central.
6. Crea el primer **SUPERADMIN** (pide email y contraseña).
7. Verifica que la app, con **sus** credenciales, puede leer la central y **no** puede
   alterar su estructura.

Si la contraseña de root es incorrecta, no toca nada.

### Después

```bash
npm run migrate:estado     # debería mostrar 2/2 migraciones aplicadas
npm run esquema:test       # 47/47
```

---

## 7. Pendientes y decisiones para más adelante

- **Precios de los planes:** `planes.precio_mensual` quedó en `NULL` a propósito.
  `Básico` = 3 usuarios, `Profesional` = 10, `Ilimitado` = sin tope. Los importes los
  define el dueño del negocio, no el sistema.
- **`empresas.rubro`** está como texto libre con default `taller`. Cuando haya clientes de
  otros rubros conviene moverlo a una tabla catálogo con las categorías de cada uno.
- **Los 8 módulos del catálogo** son una propuesta. `stock`, `reparaciones`, `clientes` y
  `pedidos` son base (lo que ya existe hoy). `etiquetas_qr`, `presupuestos`, `reportes` y
  `facturacion` son módulos a desarrollar y vender aparte.
- **Ley 25.326 de Protección de Datos Personales:** conviene consultar a un abogado antes
  de onboardear clientes con datos sensibles (salud, financieros).

---

## 8. Archivos

**Nuevos**

```
backend/migrations/central/001_esquema_central.sql
backend/migrations/central/002_catalogos.sql
backend/migrations/tenant/LEEME.txt
backend/src/db/conexiones.js
backend/src/db/central.js
backend/src/db/migrations.js
backend/tools/migrate.js
backend/tools/f1-setup.js
backend/tools/probar-esquema-central.js
```

**Modificados**

```
backend/package.json          scripts f1:setup, migrate:*, esquema:test
backend/.env.example          agrega DB_CENTRAL_NAME
backend/.env                  agrega DB_CENTRAL_NAME=si_central
backend/tools/setup-f0-db.js  arregla el bug de CREATE USER IF NOT EXISTS
```

Sin dependencias nuevas: **no hace falta `npm install`**.

---

## 9. Próximo: F2

F2 conecta la central con la empresa real, **sin tocarla**:

1. Insertar una fila en `empresas` apuntando a la base `ServiceIntegralsistema` (que ya
   existe) — sin renombrarla, sin migrarla.
2. Mover los usuarios de la base del taller a `usuarios_globales`.
3. Pool de conexiones por empresa, con desalojo de las inactivas (si no, 50 empresas × 10
   conexiones superan el `max_connections` de MySQL, que por defecto es 151).
4. Verificar que un usuario del taller entra con su misma contraseña de siempre.
