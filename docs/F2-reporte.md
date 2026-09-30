# F2 · El taller pasa a ser la Empresa #1

**Fecha:** 29/09/2026
**Estado:** implementado y verificado (20/20), incluida la prueba de aislamiento
entre dos empresas reales.

---

## 1. Qué se hizo

El taller dejó de ser "el sistema" y pasó a ser **una empresa más** dentro de un
sistema que puede tener muchas. Lo importante: **nadie tiene que cambiar su
contraseña ni su forma de trabajar.**

| Paso | Resultado |
|---|---|
| Empresa en la base central | `#1 Service Integral`, slug `service-integral`, plan `basico`, estado `ACTIVO` |
| Usuarios migrados a `usuarios_globales` | 3 de 4 (ver punto 4.4) |
| Módulos base contratados | `stock`, `reparaciones`, `clientes`, `pedidos` |
| Tabla `usuarios` del taller | **intacta**, como respaldo (se limpia en F4) |
| Filas de negocio tocadas | **ninguna** |

---

## 2. Cómo funciona ahora (y por qué así)

### El problema
El servidor tenía **un** pool de conexiones apuntando a la base del taller. Con
varias empresas hay que elegir la base en cada request. La forma obvia era
cambiar `db.query(...)` por `req.db.query(...)` en **28 rutas** que hoy
funcionan.

### La solución: `AsyncLocalStorage`
Cuando un request ya sabe de qué empresa es, guarda su pool en un "contexto" y
todo lo que corra a partir de ahí lo ve. Entonces:

- **Las 28 rutas no se tocaron.** Siguen escribiendo `db.query(...)` igual.
- Solo se tocaron 3 lugares: `verificarToken`, `/api/login` y el bloque del pool.

Y lo más importante para el aislamiento: **no existe empresa "por defecto".** Si
algo intenta consultar sin contexto, `src/db/tenant.js` **tira un error** en vez
de adivinar y pegarle a la base equivocada.

### Quién resuelve la empresa
`verificarToken` es ahora `async`: verifica el token, busca la empresa en la
central y recién ahí abre el contexto.

```
token → empresa_id → registro.empresaPorId() → si no está activa: 403
                                     ↓
                        tenant.conContexto({ pool }) → next()
                                     ↓
                        las 28 rutas, sin cambios
```

### Suspender una empresa ahora sirve
La empresa se consulta en **cada request**, con caché de ~30 s. Sin esto, un
token de 8 horas seguiría entrando aunque la empresa ya no pague. La contra
asumida: suspender tarda hasta 30 s en notarse.

### Límite de conexiones
Con 50 empresas, 10 conexiones cada una serían 500 contra un MySQL que por
defecto acepta 151. Ahora: **5 conexiones por empresa**, `maxIdle: 2`,
desalojo automático de los pools inactivos cada 5 minutos, y **cierre
ordenado** al apagar (antes cada reinicio dejaba conexiones colgadas hasta el
timeout de MySQL).

---

## 3. Archivos

**Nuevos**

| Archivo | Qué es |
|---|---|
| `src/db/tenant.js` | Pool por empresa + contexto del request |
| `src/servicios/registro.js` | Empresas, usuarios y módulos (con caché de 30 s) |
| `migrations/central/003_limite_usuarios.sql` | Excepción por empresa (`empresas.max_usuarios`) |
| `tools/f2-migrar-taller.js` | Alta de la empresa + copia de usuarios (idempotente, `--dry-run`) |
| `tools/f2-verificar.js` | 12 comprobaciones, incluida la de aislamiento |

**Modificados**

| Archivo | Cambio |
|---|---|
| `server.js` | `verificarToken` async, `/api/login` contra la central, 5 rutas de usuarios contra la central, pool global reemplazado, `crearUsuarioAdminInicial()` **eliminado**, cron de desalojo, cierre ordenado |
| `src/db/central.js` | Bug latente corregido (punto 4.1) + `verificar()` con resumen |
| `src/db/conexiones.js` | Normaliza el nombre de base a minúscula (punto 4.2) |
| `tools/f1-setup.js` | Permiso comodín de la app sobre `si_tenant_%` (punto 4.3) |
| `tools/generate-token.js` | Lee el usuario **real** de la central en vez de inventar un `id: 0`; sirve como camino de emergencia (punto 4.4) |
| `.env.example` | Se quitó la sección del admin inicial (ya no se usa) |
| `package.json` | `f2:migrar`, `f2:migrar:simular`, `f2:verificar` |

---

## 4. Hallazgos (esto es lo que importa)

### 4.1 Un bug latente que habría roto todo
`src/db/central.js` tenía:

```js
pool.on('connection', (c) => {
    c.query("SET time_zone = '-03:00'").catch(() => {});   // ← explota
});
```

El evento `connection` entrega la conexión **cruda**, no la de promesas. Su
`query()` devuelve un objeto al que se le puede *leer* `.catch`, pero
**llamarlo tira una excepción** ("You have tried to call .then()...").

Estaba ahí desde F1 y **nunca se había ejecutado**: F1 verificó la central con
su propia conexión, no con este pool. Habría explotado en la primera consulta
real del servidor. Corregido con callback.

### 4.2 El `CHECK` de `nombre_db` atrapó un error real
Al dar de alta la empresa, MySQL rechazó el nombre:

```
Check constraint 'chk_empresas_nombre_db' is violated.
```

El taller se llama `ServiceIntegralsistema` (con mayúsculas). Pero MySQL en
Windows tiene `lower_case_table_names = 1`: **la base real se llama
`serviceintegralsistema`**, y su nombre lógico con mayúsculas no existe como tal.

En Linux (DigitalOcean, F7) `lower_case_table_names = 0` y **sí** distingue
mayúsculas: guardar `ServiceIntegralsistema` habría dejado a la empresa #1
apuntando a una base inexistente **justo después de migrar a la nube**.

Corregido: `nombre_db` se guarda en minúscula y `conexiones.js` normaliza.

### 4.3 La app no podía entrar a las bases de las empresas
Los permisos de `service_integral_app` eran solo `serviceintegralsistema.*` y
`si_central.*`. **Ninguna empresa nueva habría funcionado** ("Access denied").

Se agregó el comodín `si_tenant_%` a `f1-setup.js`. Se da **una sola vez** y
cubre a todas las empresas, presentes y futuras: dar de alta un cliente ya no
toca privilegios de MySQL.

### 4.4 `aguseslava11@gmail.com` es dos cosas a la vez — **resuelto**
Ese email quedó como **SuperAdmin** en F1 **y** era uno de los admins del
taller. Como el email es único en toda la central (a propósito: es lo que
permite deducir la empresa al entrar), **no puede ser las dos cosas**.

La migración lo detectó, lo reportó y **no lo tocó**.

**Decisión tomada:** `aguseslava11@gmail.com` **queda como SuperAdmin**.

| Para qué | Con qué cuenta |
|---|---|
| Panel de administración | `aguseslava11@gmail.com` |
| El taller | `admin@serviceintegral.com` |

Consecuencias:

- El taller quedó con **3 usuarios**, que es exactamente el límite del plan
  Básico. No hace falta ninguna excepción (ver 4.5).
- El **`id` de los usuarios no se conservó**: en la central son `#2`, `#3` y
  `#4` (el `#1` es el SuperAdmin). No rompe nada: `movimientos_stock` guarda el
  nombre del usuario como texto, no como clave foránea, y el token se vuelve a
  emitir en el próximo login, así que no quedan sesiones viejas dando vueltas.
- **No te quedás afuera si olvidás las contraseñas:**

  ```
  npm run token admin@serviceintegral.com
  ```

  Lee el usuario real de la base central y emite un token idéntico al que emite
  el login (mismo id, mismo rol, misma empresa). Ese es el camino de
  emergencia, y está probado.

  Ojo: firma con el `JWT_SECRET` del `.env`, así que **quien tenga acceso al
  `.env` puede entrar como quien quiera**. En el taller el `.env` está en la
  carpeta del sistema, así que alcanza con que esa carpeta no la pueda abrir
  cualquiera. Cuando haya clientes de verdad se revisa en F6.

### 4.5 El problema del plan se resolvió con la decisión de 4.4
El taller tenía 4 usuarios y el plan Básico permite 3. Al quedar
`aguseslava11` como SuperAdmin, al taller le quedan **3 usuarios = justo el
límite del plan Básico**. No hizo falta ninguna excepción.

La columna `empresas.max_usuarios` (migración 003) queda disponible por si algún
cliente necesita más, y su getter ya está resuelto en
`src/servicios/registro.js` (`COALESCE(empresas.max_usuarios, planes.max_usuarios)`).
Lo que falta es **aplicarlo**: hoy crear un usuario no mira el límite. Eso es F3,
junto con los feature flags por módulo.

### 4.6 Un agujero de cruce entre empresas, cerrado
`DELETE /api/usuarios/:id` hacía `DELETE FROM usuarios WHERE id = ?` **sin
filtrar la empresa**: un admin podía borrar el usuario de otra empresa pasando
otro id. Ahora todas las operaciones sobre usuarios llevan `AND empresa_id = ?`,
y si el recurso es de otra empresa se responde **404** (no 403: un 403
confirmaría que ese id existe).

### 4.7 Sobre el aislamiento: conviene ser claro
El usuario de MySQL de la app necesita llegar a **todas** las bases que atiende.
Por lo tanto, un comodín o un permiso por base dan exactamente la misma
separación entre empresas: **ninguna**. El aislamiento no lo da MySQL, lo da el
código (la empresa se resuelve por request y no hay empresa por defecto).

Lo que respalda esa afirmación no es la teoría, es una prueba: `npm run
f2:verificar` levanta **una segunda empresa de verdad**, con su propia base y un
producto bien distinto, y desde afuera intenta leer y borrar datos del taller.

---

## 5. Verificación

```
npm run f2:verificar      → 20 comprobaciones OK
```

| Qué | Resultado |
|---|---|
| La empresa existe, ACTIVA, slug correcto | OK |
| Los hashes de contraseña son **idénticos byte a byte** | OK (3/3 migrados) |
| `GET /api/productos` con token del taller | 200 |
| `GET /api/usuarios` sale de la central | 200, 3 usuarios |
| Sin token | 401 |
| Token sin `empresa_id` | 403 |
| Token de una empresa inexistente | 403 |
| La app tiene permiso sobre las bases `si_tenant_*` | OK |

### La parte que importa: aislamiento entre dos empresas reales

La prueba levanta una **segunda empresa de verdad** — con su propia base, su
propio esquema y un producto con un nombre imposible de confundir — y desde
afuera intenta cruzarse:

| Intento | Resultado |
|---|---|
| La empresa de prueba lee sus productos | 200, ve el suyo |
| El taller ve el producto de la empresa de prueba | **NO** |
| La empresa de prueba ve productos del taller | **NINGUNO** |
| La empresa de prueba lista usuarios | 0, no los del taller |
| Borrar un usuario del taller desde la otra empresa | **404** |
| Ese usuario del taller después del intento | **sigue existiendo** |

Al terminar borra la base y la empresa de prueba. Verificado: no queda
`si_tenant_*` ninguna ni empresas de más.

Esto es lo que respalda la afirmación del punto 4.7, y no es una opinión: la
ruta de un request resuelve la empresa, y probarlo desde HTTP es la única forma
de saber que el aislamiento aguanta.

### Cómo reproducirlo

```
npm run f1:setup          # solo la primera vez: agrega el permiso comodín
npm run f2:verificar
```

---

## 6. Qué NO se hizo (a propósito)

- **No se borró la tabla `usuarios` del taller.** Convive con la central hasta
  F4. Si algo sale mal, el original está intacto.
- **No se tocó ni una fila de negocio.**
- **No se renombró la base del taller** (cero downtime).
- **No se aplicaron límites de plan** al crear usuarios: eso es F3, junto con
  los feature flags por módulo.
