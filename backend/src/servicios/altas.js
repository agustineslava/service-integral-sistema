/**
 * ALTA DE EMPRESAS
 * ---------------------------------------------------------------------------
 * Dar de alta una empresa no es meter una fila en `empresas`. Son cinco cosas
 * en un orden que importa, y si una falla en el medio hay que deshacer las
 * otras: una empresa a medio hacer es peor que una empresa que no existe,
 * porque existe en el registro, alguien puede entrar, y en la primera
 * pantalla falla con "access denied".
 *
 * Que hace, en este orden:
 *
 *   1. Calcular el `slug` (identificador corto) y el `nombre_db` (base MySQL).
 *   2. `CREATE DATABASE` de la base del cliente.
 *   3. Aplicarle el esquema base y las migraciones.
 *   4. Darle permisos a `service_integral_app` para poder usarla.
 *   5. Recien ahi, insertar la fila en `empresas` y sus modulos base.
 *   6. Crear el primer usuario ADMIN.
 *
 * La fila en `empresas` va DESPUES de crear la base a proposito. Si la fila
 * fuera primero, un fallo al crear la base dejaria una empresa en el panel que
 * no tiene base: el SuperAdmin la veria, no podria borrarla desde el panel, y
 * no sabria por que no anda. Al reves, hasta el ultimo momento no hay ninguna
 * empresa visible, y el error dice exactamente que fallo.
 *
 * Si algo falla, `deshacer()` deja la base como estaba: borra la base y la
 * fila. Se ejecuta en el `catch`, no con `finally`, porque en el camino bueno
 * no hay que borrar nada.
 *
 * DONDE ESTA EL PERMISO DEL PASO 4
 * Dar permisos sobre una base a `service_integral_app` lo puede hacer
 * `si_tenant_admin` solo si tiene `GRANT OPTION` sobre `si_tenant_%`. Eso se
 * concede una vez, a mano, con root:  `npm run permisos-alta`.
 *
 * Si no esta concedido, este servicio NO crea la empresa a medias: avisa que
 * falta correr eso y no deja nada. Es preferible un "no se pudo crear" con un
 * motivo claro que una empresa que existe y no anda.
 *
 * QUIEN LO USA
 * El panel del SuperAdmin (F5b) y las verificaciones (`f4-verificar`,
 * `f5b-verificar`). Compartir el mismo codigo a proposito: si el panel tuviera
 * su propia copia, ninguna prueba estaria probando el alta de verdad, que es
 * justo lo que paso con el proxy de base de datos en F2.
 */
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const central = require('../db/central');
const migraciones = require('../db/migrations');
const { configAdmin, nombreCentral } = require('../db/conexiones');

/** Prefijo de las bases de los clientes. `si_tenant_admin` solo tiene permisos aca. */
const PREFIJO_DB = 'si_tenant_';


/**
 * Un error que le pasa al servidor el codigo HTTP que le corresponde.
 *
 * Sin esto, `throw new Error(...)` en un servicio se traduce a 500 siempre.
 * Entonces el panel muestra "Error interno del servidor" y el SuperAdmin cree
 * que se rompio algo, cuando lo unico que hizo fue escribir mal un email. Un
 * 500 tambien manda a la cola de logs a buscar una causa que no existe.
 *
 * La diferencia importa: 400 es "cambia el dato y mandalo otra vez", 500 es
 * "no lo toques, hay un problema". El alta que falla por el permiso que
 * falta es 500 a proposito: no es un error de quien esta escribiendo.
 */
function conEstado(mensaje, estadoHttp) {
    const e = new Error(mensaje);
    e.estadoHttp = estadoHttp;
    return e;
}

/** El dato que mando el cliente esta mal. 400. */
const validacion = (mensaje) => conEstado(mensaje, 400);

/** No existe lo que pidio. 404. */
const noEncontrado = (mensaje) => conEstado(mensaje, 404);
const RUTA_ESQUEMA = path.join(__dirname, '..', '..', 'schema', 'schema-actual.sql');

/**
 * Un nombre de base solo puede llevar letras, numeros y guion bajo.
 *
 * No es paranoia: el nombre va metido en un `CREATE DATABASE \`...\`` que no
 * se puede preparar como un `?`. El nombre lo genera este archivo, pero si
 * someday se acepta de afuera, un nombre con un acento grave seria inyeccion
 * de SQL. Se valida igual.
 */
function nombreDeBaseValido(nombre) {
    return typeof nombre === 'string' && /^[A-Za-z0-9_]+$/.test(nombre) && nombre.length <= 64;
}

/**
 * "Taller Don Carlos" -> "taller-don-carlos"
 *
 * Se sacan los acentos, porque un `á` en el nombre de la base es una
 * molestia en el shell, en los backups y en los scripts. Y el guion bajo
 * dentro del nombre de la base se cambia por guion, para que el nombre sea
 * siempre `si_tenant-<palabras>` y quede claro de un vistazo que base es.
 */
function slugPara(nombre) {
    return String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // acentos (U+0300-U+036F, de NFD)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '');
}

/**
 * El nombre de la base MySQL de una empresa. Nunca lo elige el usuario.
 *
 * Devuelve `null` si el slug no deja nada usable. Sin esto, un nombre todo de
 * espacios llevaba a `si_tenant_`, que es un nombre de base valido a los ojos
 * de `nombreDeBaseValido` y por lo tanto creable: una base vacia con el
 * nombre de otra. Que se llame solo el prefijo es un error de la base, no una
 * empresa sin nombre.
 */
function nombreDbPara(slug) {
    const limpio = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!limpio.replace(/-/g, '')) return null;
    const nombre = `${PREFIJO_DB}${limpio}`.replace(/-/g, '_');
    return nombre.slice(0, 64);
}

/**
 * Un slug libre. Si "taller-carlos" ya existe, prueba "taller-carlos-2", y
 * asi. Devuelve el slug y el nombre de base YA con la unicidad resuelta.
 */
async function slugLibre(slugBase) {
    let candidato = slugBase;
    let sufijo = 2;
    // 20 intentos es de sobra: si estan todos ocupados hay otra cosa mal.
    while (sufijo <= 21) {
        const existe = await central.uno('SELECT id FROM empresas WHERE slug = ?', [candidato]);
        if (!existe) break;
        candidato = `${slugBase}-${sufijo}`;
        sufijo++;
    }
    if (sufijo > 21) {
        throw validacion(`No se encontro un nombre libre para "${slugBase}" despues de 20 intentos.`);
    }
    const nombre_db = nombreDbPara(candidato);
    if (!nombre_db) {
        throw validacion(`No se pudo armar un nombre de base a partir de "${candidato}".`);
    }
    return { slug: candidato, nombre_db };
}

/**
 * Crea la base del cliente, le aplica el esquema y le da permisos a la app.
 *
 * Va en su propia conexion porque el paso 4 necesita hablar como
 * `si_tenant_admin` y no como la app.
 */
async function crearBaseConEsquema(nombreDb, opciones = {}) {
    if (!nombreDeBaseValido(nombreDb)) {
        throw new Error(`"${nombreDb}" no es un nombre de base valido.`);
    }

    // --- crear la base ---
    // El `finally` cierra SIEMPRE. Con un `end()` solo en el `catch`, la
    // conexion del camino bueno queda abierta: el proceso de Node no termina
    // nunca y `npm run` se queda colgado sin decir por que.
    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    try {
        await admin.query(
            `CREATE DATABASE \`${nombreDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
    } catch (err) {
        throw new Error(`No se pudo crear la base ${nombreDb}: ${err.message}`);
    } finally {
        await admin.end();
    }

    // --- esquema base y migraciones ---
    const con = await mysql.createConnection({ ...configAdmin(nombreDb), multipleStatements: true });
    try {
        const esquema = fs.readFileSync(RUTA_ESQUEMA, 'utf8');
        await con.query(esquema);
        // OJO: `log` se pasa como FUNCION, nunca como `null`. El default de
        // `aplicar` es `log = () => {}`, y un default en JS solo se usa cuando
        // la propiedad viene `undefined`: pasar `null` pisa el default y
        // adentro revienta con "log is not a function".
        const r = await migraciones.aplicar(con, 'tenant', {
            log: opciones.logEsquema || (() => {})
        });
        return r.aplicadas;
    } catch (err) {
        throw new Error(`No se pudo preparar la base ${nombreDb}: ${err.message}`);
    } finally {
        await con.end();
    }
}

/**
 * Le da a la app permiso de lectura y escritura sobre una base recien creada.
 *
 * Va aparte de `crearBaseConEsquema` y no se puede fusionar con ella a
 * proposito: son dos conexiones distintas y, mas importante, este es el paso
 * que puede fallar por una razon que el SuperAdmin no va a poder arreglar
 * desde el panel. Si se mezcla con el esquema, un `GRANT` denegado se
 * confunde con "no se pudo crear la base".
 */
async function darPermisos(nombreDb) {
    if (!nombreDeBaseValido(nombreDb)) {
        throw new Error(`"${nombreDb}" no es un nombre de base valido.`);
    }
    const usuarioApp = process.env.DB_USER || 'service_integral_app';
    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    try {
        await admin.query(
            `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${nombreDb}\`.* TO '${usuarioApp}'@'localhost'`
        );
    } catch (err) {
        // Este es EL error que aparece mientras falte correr `permisos-alta`,
        // asi que dice que hacer. "Access denied" a secas, sin mas, deja al
        // SuperAdmin pensando que fallo el sistema.
        if (/Access denied/i.test(err.message)) {
            throw new Error(
                `No se le pudieron dar permisos de uso a ${usuarioApp} sobre ${nombreDb}.\n` +
                `Falta el permiso que se concede UNA vez, a mano:\n\n` +
                `     npm run permisos-alta\n\n` +
                `(pide la clave de root de MySQL y no la guarda). La empresa NO se\n` +
                `creo a medias: no quedo ni la base ni el registro.`
            );
        }
        throw err;
    } finally {
        await admin.end();
    }
}

/**
 * Crea la base con esquema y permisos. O queda entera, o no queda ninguna.
 *
 * La limpieza es SIEMPRE `DROP IF EXISTS`, sin preguntar si llego a crearse.
 * Un `DROP` de una base que nunca existio no falla, y en cambio preguntar
 * "ya se habia creado?" tiene un caso en el que la respuesta es si y la
 * pregunta no se hace: si falla el ESQUEMA, la base ya existe pero todavia
 * no se llego a la linea que pondria el flag. Con ese error, la base queda
 * viva, sin fila en `empresas`, sin permiso para la app y sin forma de
 * borrarla desde el panel: invisible e imposible de limpiar desde el panel.
 */
async function crearBaseCompleta(nombreDb, opciones = {}) {
    try {
        const aplicadas = await crearBaseConEsquema(nombreDb, opciones);
        await darPermisos(nombreDb);
        return aplicadas;
    } catch (err) {
        await borrarBase(nombreDb);
        throw err;
    }
}

async function borrarBase(nombreDb) {
    if (!nombreDeBaseValido(nombreDb)) return;
    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    try {
        await admin.query(`DROP DATABASE IF EXISTS \`${nombreDb}\``);
    } catch (err) {
        // Que no se pueda borrar es grave, pero no se tira encima el error
        // original, que es el que dice que paso.
        console.error(`  AVISO: no se pudo borrar la base ${nombreDb}: ${err.message}`);
    } finally {
        await admin.end();
    }
}

/** Anota en `auditoria` que hizo quien. */
async function auditar({ usuario, accion, empresaId, detalle, ip }) {
    try {
        await central.query(
            `INSERT INTO auditoria (usuario_id, email, empresa_id, accion, detalle, ip)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                usuario?.id ?? null,
                usuario?.email ?? null,
                empresaId ?? null,
                accion,
                detalle ? JSON.stringify(detalle) : null,
                ip || null
            ]
        );
    } catch (err) {
        // La auditoria no puede hacer fallar la operacion que se quiere
        // registrar. Perder una anotacion es malo; perder un alta de cliente
        // es peor.
        console.error('  AVISO: no se pudo anotar en auditoria:', err.message);
    }
}

/** Los modulos base, que toda empresa arranca con si o si. */
async function sembrarModulosBase(empresaId) {
    const base = await central.query('SELECT codigo FROM modulos WHERE es_base = 1 ORDER BY orden');
    for (const m of base) {
        await central.query(
            `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde) VALUES (?, ?, 1, CURDATE())`,
            [empresaId, m.codigo]
        );
    }
    return base.length;
}

// ---------------------------------------------------------------------------

/**
 * Da de alta una empresa completa.
 *
 * @param {object} datos
 *   nombre       obligatorio. Lo que ve el cliente.
 *   rubro         que adapta categorias y textos. Por defecto 'taller'.
 *   plan          codigo de `planes`. Por defecto 'basico'.
 *   estado        'DEMO' | 'ACTIVO' | 'SUSPENDIDO' | 'BAJA'. Por defecto 'DEMO'.
 *   slug          opcional. Si no, sale del nombre.
 *   marca         { subtitulo, logo_url, color_primario, color_secundario }
 *   admin         { email, nombre, password } primer usuario. Obligatorio.
 * @param {object} opciones
 *   log           fn para ver el avance (el panel lo usa para la barra)
 *   autor         { id, email } quien lo pidio, para la auditoria.
 *   ip            string
 *
 * @returns {object} la fila de `empresas` ya creada, con el id.
 */
async function crearEmpresa(datos, opciones = {}) {
    const log = opciones.log || (() => {});

    // --- validar antes de tocar nada ---
    if (!datos.nombre || !String(datos.nombre).trim()) {
        throw validacion('Falta el nombre de la empresa.');
    }
    if (!datos.admin?.email || !datos.admin?.password) {
        throw validacion('Falta el email o la contraseña del primer usuario ADMIN.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.admin.email)) {
        throw validacion(`"${datos.admin.email}" no parece un email valido.`);
    }
    if (String(datos.admin.password).length < 8) {
        throw validacion('La contraseña del primer usuario tiene que tener al menos 8 caracteres.');
    }

    // Los colores se validan acá y no solo al pintar. `marca.js` ya ignora un
    // color inválido (un valor roto en la base no vuelve invisible la
    // pantalla), pero desde un formulario el usuario puede corregirlo en el
    // momento, así que se le avisa en vez de guardarlo en silencio.
    const marca = datos.marca || {};
    for (const campo of ['color_primario', 'color_secundario']) {
        const v = marca[campo];
        if (v !== undefined && v !== null && v !== '' && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v).trim())) {
            throw validacion(
                `${campo.replace('_', ' ')}: "${v}" no es un color válido. ` +
                `Tiene que ser #RGB o #RRGGBB, como #009fe3.`
            );
        }
    }
    if (marca.logo_url && String(marca.logo_url).length > 500) {
        throw validacion('La dirección del logo es demasiado larga (máximo 500 caracteres).');
    }
    if (marca.subtitulo && String(marca.subtitulo).length > 120) {
        throw validacion('El subtítulo es demasiado largo (máximo 120 caracteres).');
    }

    const plan = datos.plan || 'basico';
    const existePlan = await central.uno('SELECT codigo FROM planes WHERE codigo = ?', [plan]);
    if (!existePlan) {
        throw validacion(`No existe el plan "${plan}". Planes validos: ${(await listarPlanes()).map((p) => p.codigo).join(', ')}`);
    }

    const estados = ['DEMO', 'ACTIVO', 'SUSPENDIDO', 'BAJA'];
    const estado = estados.includes(datos.estado) ? datos.estado : 'DEMO';

    // El email es UNICO en toda la central, no por empresa. Es lo que permite
    // resolver a que empresa pertenece alguien con solo el email.
    const emailYaUsado = await central.uno('SELECT empresa_id FROM usuarios_globales WHERE email = ?', [datos.admin.email]);
    if (emailYaUsado) {
        throw validacion(`El email ${datos.admin.email} ya esta usado por otro usuario. Cada email es una sola persona en todo el sistema.`);
    }

    // --- 1. nombres ---
    const slugBase = slugPara(datos.slug || datos.nombre);
    if (!slugBase) {
        throw validacion(`No se pudo sacar un identificador del nombre "${datos.nombre}". Poner un slug a mano.`);
    }
    const { slug, nombre_db: nombreDb } = await slugLibre(slugBase);
    log(`nombre de la base: ${nombreDb}`);

    // --- de 2 a 6, todo adentro del mismo try ---
    //
    // Antes el `try` empezaba en el paso 5, asi que una falla en el paso 2 (crear
    // la base) o en el 4 (dar permisos) no dejaba rastro de nada: no habia ni
    // anotacion ni mensaje con contexto. Con el boton "crear empresa" del panel
    // apretado veinte veces y sin `permisos-alta`, la auditoria no mostraba ni
    // un intento. Ahora los seis pasos estan cubiertos y TODA falla queda
    // anotada con su motivo.
    let empresaId = null;
    try {
        // --- 2 a 4. base, esquema y permisos ---
        log('creando la base y aplicando el esquema...');
        const aplicadas = await crearBaseCompleta(nombreDb, { log: opciones.logEsquema });
        log(`base lista (${aplicadas} migracion/es)`);

        // --- 5. la fila ---
        const m = (datos.marca) || {};
        const c = (datos.contacto) || {};

        // Los datos de contacto van en el alta y no en un segundo paso para que
        // una empresa recien creada ya pueda imprimir un presupuesto con
        // telefono, direccion y CUIT. Si quedaran vacios, el comprobante
        // sale a medias y hay que acordarse de volver a cargarlos.
        const r = await central.query(
            `INSERT INTO empresas (nombre, slug, nombre_db, rubro, plan, estado,
                                   subtitulo, logo_url, color_primario, color_secundario,
                                   telefono, email_contacto, direccion, cuit)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(datos.nombre).trim(),
                slug,
                nombreDb,
                datos.rubro || 'taller',
                plan,
                estado,
                m.subtitulo ?? null,
                m.logo_url ?? null,
                m.color_primario ?? null,
                m.color_secundario ?? null,
                c.telefono ?? null,
                c.email_contacto ?? null,
                c.direccion ?? null,
                c.cuit ?? null
            ]
        );
        empresaId = r.insertId;
        log(`empresa #${empresaId} dada de alta`);

        await sembrarModulosBase(empresaId);

        // --- 6. el primer ADMIN ---
        const hash = await bcrypt.hash(String(datos.admin.password), 10);
        await central.query(
            `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
             VALUES (?, ?, ?, ?, 'ADMIN')`,
            [empresaId, String(datos.admin.email).trim().toLowerCase(), hash, datos.admin.nombre || 'Administrador']
        );
        log('primer usuario ADMIN creado');

    } catch (err) {
        // Deshacer. Primero la fila (si llego a existir), despues la base: al
        // reves, la FK podria dejar cosas colgando.
        //
        // `borrarBase` va SIEMPRE, sin preguntar si la base llego a crearse:
        // un `DROP ... IF EXISTS` de una base que nunca existio no falla, y en
        // cambio omitirlo por error deja una base a medias invisible (esta en
        // el disco pero no en `empresas`, y el panel no la puede borrar).
        if (empresaId) {
            try { await central.query('DELETE FROM empresas WHERE id = ?', [empresaId]); } catch { /* ya no esta */ }
        }
        await borrarBase(nombreDb);
        await auditar({
            usuario: opciones.autor,
            accion: 'empresa.crear',
            empresaId: null,
            detalle: { nombre: datos.nombre, slug, error: err.message, revertido: true },
            ip: opciones.ip
        });
        // El error original ya trae el mensaje accionable (por ejemplo, el del
        // permiso que falta con el comando adentro). Envolverlo en "se creo a
        // medias" lo taparia: la empresa NO se creo a medias, se deshizo
        // entera. Ademas se pierde `estadoHttp`, y un error de validacion
        // pasaria a ser 500.
        throw err;
    }

    await auditar({
        usuario: opciones.autor,
        accion: 'empresa.crear',
        empresaId,
        detalle: { nombre: datos.nombre, slug, plan, estado, nombre_db: nombreDb },
        ip: opciones.ip
    });

    return central.uno('SELECT * FROM empresas WHERE id = ?', [empresaId]);
}

/**
 * Da de baja una empresa. Para "borrar de verdad" hay que pasar `borrarBase`.
 *
 * La baja suave es la que se usa desde el panel: se pone el estado en BAJA y
 * la empresa deja de poder entrar, pero los datos quedan, que es lo que hace
 * falta si el cliente se va y hay que devolverle todo.
 */
async function darDeBaja(empresaId, { borrarBase: borrar = false, autor, ip, motivo } = {}) {
    const empresa = await central.uno('SELECT * FROM empresas WHERE id = ?', [empresaId]);
    if (!empresa) throw noEncontrado(`No existe la empresa #${empresaId}.`);

    if (borrar) {
        // El orden es al reves del alta: primero se saca la fila, despues la
        // base. Al reves, la fila se va con la base todavia viva y queda una
        // empresa en el panel que no tiene nada.
        await central.query('DELETE FROM empresas WHERE id = ?', [empresaId]);
        await borrarBase(empresa.nombre_db);
        await auditar({
            usuario: autor, accion: 'empresa.borrar', empresaId,
            detalle: { nombre: empresa.nombre, slug: empresa.slug, base_borrada: empresa.nombre_db, motivo },
            ip
        });
        return { borrada: true };
    }

    await central.query(`UPDATE empresas SET estado = 'BAJA' WHERE id = ?`, [empresaId]);
    await auditar({
        usuario: autor, accion: 'empresa.baja', empresaId,
        detalle: { nombre: empresa.nombre, motivo }, ip
    });
    return { borrada: false };
}

/** Los planes, para el formulario del panel. */
async function listarPlanes() {
    return central.query('SELECT codigo, nombre, max_usuarios, precio_mensual FROM planes ORDER BY codigo');
}

/** Los modulos del catalogo, con la marca de cuales son base. */
async function listarModulos() {
    return central.query('SELECT codigo, nombre, descripcion, es_base, orden FROM modulos ORDER BY orden');
}

module.exports = {
    PREFIJO_DB,
    slugPara,
    nombreDbPara,
    nombreDeBaseValido,
    slugLibre,
    crearBaseCompleta,
    crearBaseConEsquema,
    darPermisos,
    borrarBase,
    auditar,
    crearEmpresa,
    darDeBaja,
    listarPlanes,
    listarModulos
};
