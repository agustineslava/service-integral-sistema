# F5b · Panel del SuperAdmin

**Estado:** cerrado y verificado (111/111).
**Fecha:** 30 de septiembre de 2026.
**Rama:** `multitenant`.

---

## 1. Qué es esta fase

Hasta F5a el sistema sabía dar de alta una empresa, pero no había **quien lo hiciera**.
La fila en `empresas` y la base MySQL se creaban a mano, con un `INSERT` y un
`CREATE DATABASE`. Con un solo cliente eso servía. Con varios, cada alta manual
era una fuente de errores: una base sin permisos, una empresa con el estado
equivocado, un módulo contratado que nunca se contrató.

F5b pone el alta, la baja y los cambios **detrás de una pantalla y de una API**,
con un guard propio y con auditoría de quién hizo qué.

---

## 2. La idea que gobierna todo: el SuperAdmin **no** es un admin con más permisos

Es lo más importante de la fase y conviene decirlo sin rodeos.

Un `SUPERADMIN` administra **el servicio**. No es el dueño de una empresa con
privilegios extras. La diferencia no es de alcance, es de naturaleza:

> **No puede ver los datos de ninguna empresa.** Ni sus reparaciones, ni sus
> productos, ni sus clientes, ni sus presupuestos.

Esto no es una decisión de diseño, es la **promesa de "cero cruce de datos"**.
Un admin de una empresa entra a su propia base. Un SuperAdmin entra a la base
central, donde solo hay el registro de qué empresas existen y quién las usa.

Si el SuperAdmin pudiera ver los datos de los clientes, la promesa sería
"casi cero cruce": bastaría un descuido, un token robado, un log mal puesto, y
la garantía se rompe. Con esta regla, el peor caso de una filtración es el
nombre de la empresa y la cantidad de usuarios: no hay datos de negocio
expuestos.

### Cómo se aplica en el código

Las rutas de administración están **completamente separadas** de las de empresa:

| | Rutas de empresa | Rutas del panel |
|---|---|---|
| Guard | `verificarToken` | `verificarSuperAdmin` |
| Base de datos | `db` (con contexto de empresa) | `central` (nunca `db`) |
| Rol | ADMIN / TECNICO | solo SUPERADMIN |

Dos detalles que parecen detalles y no lo son:

1. **El panel nunca usa `conContexto` ni `db`.** Si alguien escribiera un
   `db.query` por error en una ruta de administración, no tocaría los datos de
   un cliente: **reventaría con un error**, en vez de leerlos sin querer. El
   aislamiento no depende de que nadie tenga cuidado.

2. **Un `SUPERADMIN` no usa `verificarToken`**, que es lo correcto: ese guard
   exige una `empresa_id` y le daría 403 a alguien que no pertenece a ninguna
   empresa. El panel tiene su propio guard, que además vuelve a consultar la
   base central en cada pedido (sin caché) para que un SuperAdmin desactivado no
   siga entrando con un token viejo.

---

## 3. Rutas del panel

Nueve rutas, todas bajo `verificarSuperAdmin`:

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/admin/yo` | Quién soy y cuántos clientes hay |
| GET | `/api/admin/empresas` | Listado con plan, estado, usuarios y módulos |
| GET | `/api/admin/empresas/:id` | Detalle: datos, usuarios, catálogo, auditoría |
| POST | `/api/admin/empresas` | **Alta completa** |
| PATCH | `/api/admin/empresas/:id` | Estado, plan, límite, vencimiento, notas |
| PATCH | `/api/admin/empresas/:id/modulos/:codigo` | Contratar o dar de baja un módulo |
| DELETE | `/api/admin/empresas/:id` | Baja (`?borrarBase=si` borra de verdad) |
| GET | `/api/admin/catalogos` | Planes y catálogo de módulos |
| GET | `/api/admin/auditoria` | Movimientos del servicio |

Lo que el SuperAdmin **no** tiene: rutas para ver reparaciones, productos,
clientes o presupuestos de nadie. No es que estén ocultas: no existen.

---

## 4. El alta, y por qué nunca deja una empresa a medias

`POST /api/admin/empresas` crea una base MySQL entera, le aplica el esquema,
migra, siembra los módulos base, inserta la fila en `empresa` y crea el primer
usuario ADMIN. Son seis pasos y cualquiera puede fallar.

**La regla: o la empresa existe entera, o no existe.** Una empresa a medio crear
es peor que no crearla: aparece en el panel, alguien puede intentar entrar, y en
la primera pantalla falla con un error de permisos que no explica nada.

El orden importa. La fila de `empresas` se inserta **al final**, después de que la
base esté creada y con permisos. Y todo el bloque está en un `try` cuyo `catch`
hace, sin preguntar nada:

1. Borra la fila, si llegó a existir.
2. **Borra la base, siempre.** Un `DROP ... IF EXISTS` de una base que nunca se
   creó no falla; omitirlo por error deja una base invisible: está en el disco
   pero no en `empresas`, y el panel no la puede borrar nunca.

### El obstáculo del permiso (y por qué queda pendiente)

`si_tenant_admin` es el único usuario que puede hacer DDL sobre bases
`si_tenant_%`. Resulta que **`CREATE DATABASE` no alcanza**: además hay que
`GRANT` a `service_integral_app` sobre la base nueva, y ese `GRANT` requiere
`GRANT OPTION`, que solo tiene root.

Por eso existe `npm run permisos-alta`, que se corre **una vez, a mano, con la
clave de root**. Hasta que se corra, el alta falla en ese paso — y falla bien:

```
Access denied for user 'si_tenant_admin'@'localhost' to database 'si_tenant_x'

  MySQL deja crear la base pero no deja darle permisos a la app.
  Falta una concesión que se hace UNA VEZ, a mano, con la clave de root:

    $env:DB_ROOT_PASSWORD = "tu clave de root"
    npm run permisos-alta
    Remove-Item Env:DB_ROOT_PASSWORD

  Verificar que ya quedo:
    npm run check-grants
```

El mensaje dice qué hacer, no solo qué pasó. Y **el verificador pasa en los dos
casos**: si el permiso está, prueba el camino completo; si no está, prueba que
el fallo quede limpio. Verificar el comportamiento, no que el servidor esté
configurado de una forma.

---

## 5. La pantalla

`frontend/admin.html` + `admin.js` + `admin.css`.

Es deliberadamente distinta a las del sistema:

- **No carga `marca.js`.** La marca (logo, colores, nombre) es de cada cliente;
  el panel no es de ninguna. Si cargara la marca, en multi-cliente mostraría el
  logo del último que entró.
- **Carga `auth-check.js`** por `escapeHtml`, `apiFetch`, el menú de usuario y
  el botón de tema, que son iguales en todo el sistema. Como no hay
  `empresa_actual` guardada, no esconde ningún módulo: el servicio no contrata
  módulos a nadie.
- **Todo lo que viene de la base pasa por `escapeHtml`.** 33 usos, verificados.

### El login tiene que separar los dos mundos

`login.html` manda al `SUPERADMIN` a `admin.html`. Sin eso, caería en
`index.html`, que le pide `/api/mi-empresa`, que le contesta 403, y
`auth-check` lo devuelve al login: **un loop sin fin**. Un SuperAdmin que no
puede entrar al panel y un SuperAdmin que no puede usar el sistema se ven igual
desde adentro.

### Lo que hay

- Listado con búsqueda y filtro por estado; contador arriba (empresas, usuarios
  activos, cuántas en demo, cuántas suspendidas, cuántas sobre el límite).
- Alta con el progreso visible: tarda unos segundos porque crea una base
  entera. El botón se deshabilita y el modal no se cierra, porque un alta que
  sigue corriendo y una pantalla que dice que la canceló es una situación
  confusa.
- Detalle: datos, marca, contacto, plan y suscripción, catálogo completo de
  módulos, usuarios, notas y auditoría de esa empresa.
- Baja: la suave (conserva datos) pide un `confirm`; **la que borra la base pide
  escribir el identificador de la empresa**. Un "¿sí/no?" es demasiado fácil de
  apretar sin querer cuando lo que se borra no tiene vuelta atrás.

---

## 6. Reglas que se aplicaron

| Regla | Por qué |
|---|---|
| Los módulos **base** no se pueden desactivar | Sin `clientes` no anda la pantalla de clientes, y no hay forma de arreglarlo desde el panel |
| Un módulo inexistente da **404**, no 403 | Distingue "no existe" de "no lo podés tocar" |
| Un estado o plan inválido da **400**, no 500 | 500 manda a la cola de logs a buscar una causa que no existe |
| Un id de otra empresa da **404** | Un 403 confirmaría que el recurso existe |
| `nombre_db` se valida contra `/^[A-Za-z0-9_]+$/` antes de interpolarlo | `CREATE DATABASE` no se puede parametrizar |
| Slugs repetidos se auto-sueltan (`-2`, `-3`…) hasta 20 intentos | Dos empresas con el mismo nombre no son un error |
| El email es **único en todo el sistema** | Es lo que permite saber a qué empresa pertenece alguien al login |
| Contraseña mínima de 8 caracteres | Mismo piso que el resto del sistema |

---

## 7. Verificación

`npm run f5b:verificar` — **111 checks, 12 secciones.**

Las que importan:

1. **Guard.** 9 rutas × 3 identidades (sin token → 401, ADMIN de empresa → 403,
   SUPERADMIN real → 200). Un token de SuperAdmin **falso o desactivado también
   da 403**, porque el guard re-consulta la base en cada pedido.
2. **La promesa.** Un SuperAdmin contra `/api/productos`, `/api/clientes`,
   `/api/pedidos`, `/api/reparaciones`, `/api/presupuestos`, `/api/mi-empresa` y
   `/api/usuarios` → **403 en las siete**. Y no puede crear usuarios por la
   puerta de atrás.
3. **Alta.** Completa si el permiso está; si no, que falle con el comando
   adentro y **no deje fila, ni usuario, ni base huérfana**.
4. **Estado.** Suspender y reactivar, y comprobar que **toma efecto en el
   pedido siguiente, sin esperar los 30 segundos de caché**.
5. **Módulos.** El catálogo **completo** (los 8), no solo lo contratado: sin eso
   no hay forma de contratar lo que falta. Y el camino del `INSERT` para un
   módulo que nunca tuvo fila.
6. **Baja.** Suave conserva la fila; con `?borrarBase=si` se va la fila, los
   usuarios y la base.
7. **El taller no se tocó**, campo por campo.

### Prueba por mutación: 7/7 detectadas

Un verificador que nunca se rompió no está verificado. Se rompieron 7 cosas, una
por vez, y el verificador tiene que notar cada una:

| Se rompió | Lo detectó |
|---|---|
| El guard acepta cualquier token | 10 checks |
| El panel acepta SuperAdmin desactivado | el check de aislamiento |
| Se pueden apagar los módulos base | 2 checks |
| El listado no trae `max_usuarios` | 2 checks |
| No se invalida la caché de 30 s | el check de efecto inmediato |
| Un alta fallida deja la base | 3 checks |
| El alta acepta un color inválido | el de validación |

Ninguna mutación pasó desapercibida.

---

## 8. Dos errores que salieron de la propia verificación

### 8.1 Los tests bombed al taller

La primera corrida de la prueba por mutación **dejó el taller en BAJA**.

No fue un error del código del panel: fue un error **de los tests**. Los checks
de la sección 1 dicen "esto tiene que dar 403" y apuntaban a
`/api/admin/empresas/1` — la empresa real. Con el guard sano dan 403 y no tocan
nada. Pero con el guard roto... dan el borrado. Y los tests se usan
precisamente cuando el guard está roto.

> **Un test que solo es inocuo cuando el código está bien no es un test: es una
> bomba con la mecha corta.**

Dos arreglos:

1. **De fondo:** los checks del guard apuntan ahora a la empresa de prueba, que
   se crea antes y se limpia al final. Un guard roto rompe pruebas, no clientes.
2. **De red:** el arnés toma una foto del estado de todas las empresas y de todos
   los usuarios antes de mutar, y restaura lo que haya cambiado al terminar.

El taller quedó restaurado a `ACTIVO`, verificado (el login pasó de 403 a 401), y
la sección 12 del verificador es la que ahora avisa de este tipo de daño.

### 8.2 La red de seguridad estaba rota en el lugar exacto

Al arreglar el punto anterior, la segunda corrida del arnés volvió a dejar
mutaciones vivas. Y esta vez estaba claro por qué, porque la traza mostraba el
error en todas las líneas:

```
TypeError: Cannot read properties of undefined (reading 'replace')
    at ruta (mutar.js:17:43)
    at bak  (mutar.js:18:22)
```

**El arnés no guardó ni restauró ni una vez.** La causa era una sola
línea:

```js
const [, , accion, archivo, ...resto] = process.argv;

if (accion === 'guardar') {
    const rel = resto[0];      // <-- vacío: `guardar` recibe UN argumento
```

`guardar` y `restaurar` se invocan como `mutar.js guardar <archivo>`, así que el
archivo está en la cuarta posición — en `archivo`, no en `resto`. `resto` arranca
en la quinta y ahí va vacío. Como el respaldo no se escribía, `restaurar`
tampoco encontraba nada que deshacer, y **el arnés reportaba éxito igual**: el
error iba a la traza y el flujo seguía.

Vale la pena lo que esto dice sobre el método:

> **La red de seguridad tenía exactamente el defecto que la red de seguridad
> debía detectar.** Una prueba que verifica que las pruebas se limpian necesita,
> ella misma, una prueba que verifique que se limpian.

Tres arreglos:

1. `guardar` y `restaurar` leen `archivo`, que es lo que reciben.
2. `restaurar` **falla** cuando no hay copia. Antes decía "no había copia" y
   salía con 0, que es indistinguible de "ya estaba limpio".
3. El arnés mira el código de salida de `guardar` y **no muta si no copió**.

Y de paso, `aplicar` ahora exige que el texto viejo aparezca **una sola vez**.
Antes reemplazaba todas las ocurrencias y el control posterior no lo notaba: una
mutación que rompa dos cosas a la vez habría hecho imposible saber cuál
detectó el verificador.

---

## 9. Bugs reales que aparecieron al verificar

Ninguno de estos lo encontró leyendo el código; los encontró el verificador.

| Bug | Síntoma | Corrección |
|---|---|---|
| `todasLasEmpresas` no seleccionaba `max_usuarios` | El límite que ponías en el panel nunca se veía: volvía al del plan | Agregado a la consulta |
| El detalle listaba solo los módulos con fila | Los 3 no contratados **no aparecían**: no había forma de contratarlos | `LEFT JOIN` desde el catálogo |
| Las validaciones del alta devolvían 500 | Un email mal escrito se veía como "error interno del servidor" | `validacion()` marca los errores como 400 |
| Un alta fallida no dejaba rastro | 20 intentos fallidos y la auditoría vacía | Todo el alta quedó en el `try` |
| `DB_NAME` con mayúsculas | En Linux los nombres de base **sí** distinguen mayúsculas: la comparación en `permisos-alta` daría un falso alarma | `LOWER()` en las dos comparaciones |

---

## 10. Archivos

**Nuevos**
- `backend/src/servicios/altas.js` — el alta y la baja. **Un solo camino de
  creación**, usado por el panel y por las pruebas: si fueran dos, ninguna
  prueba estaría probando el alta de verdad (la lección de F2).
- `backend/tools/permisos-alta.js` — la concesión de una vez, con root. Pide la
  clave por `$env:DB_ROOT_PASSWORD` y **no la guarda en ningún lado**.
- `backend/tools/f5b-verificar.js` — 111 checks.
- `frontend/admin.html`, `admin.js`, `admin.css`.

**Modificados**
- `backend/server.js` — sección 14 (panel) y `require` de `altas`.
- `backend/src/servicios/altas.js` — contacto en el alta, validación de color,
  auditoría de los intentos fallidos.
- `backend/src/servicios/registro.js` — `max_usuarios` en el listado.
- `backend/src/jobs/backup.js` — mensaje accionable cuando falta `mysqldump`
  (encontrado en el taller: `spawn mysqldump ENOENT`).
- `frontend/login.html` — desvío del SUPERADMIN al panel.
- `backend/package.json` — `f5b:verificar`, `permisos-alta`.

---

## 11. Lo que falta

**Bloqueante para dar de alta el primer cliente:**

```powershell
$env:DB_ROOT_PASSWORD = "tu clave de root"
npm run permisos-alta
Remove-Item Env:DB_ROOT_PASSWORD
```

Sin esto, el panel funciona para todo menos para el alta, y avisa por qué.

**Pendiente para fases siguientes:**

- **F5c/F6** — login unificado: al escribir el email se consulta a qué empresa
  pertenece. Esa consulta es **pública**, así que necesita límite de intentos
  fuerte: sin eso, cualquiera puede scopear qué empresas tienen clientes.
- `npm run token` es una puerta trasera: firma un token con el `JWT_SECRET` del
  `.env` y entra como quien sea. Quien tenga el `.env` es el sistema. Se
  resuelve en F6.
- Dominio propio y SSL.
- `cors()` sin lista de orígenes, `verificarToken` no global, CSP de helmet
  desactivado: Son problemas anteriores a esta fase, y hay que resolverlos.

---

## 12. Una nota sobre lo que se{NO hizo

No se hizo que el SuperAdmin pueda "entrar a ver" los datos de un cliente para
diagnosticar algo.

Se puede, por supuesto: hay acceso al servidor, hay herramientas, y queda
registrado quién lo hizo. La diferencia es que **deja rastro**. Una pantalla de
"ver datos de cualquier cliente" dentro del panel sería lo contrario: acceso
silencioso, sin registro, y con la confianza del sistema puesta en que no se usa
para eso.

Si alguna vez hace falta, se hace por `npm run` con la base de datos, donde
queda en el log. La pantalla no.