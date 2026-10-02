/* ==========================================================================
   1. VARIABLES DE ENTORNO, DEPENDENCIAS Y LIBRERÍAS
   ========================================================================== */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const cron = require('node-cron');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

// Habilitar proxy de confianza para Cloudflare Tunnel y express-rate-limit
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('❌ Falta JWT_SECRET en el archivo .env. El servidor no puede arrancar así.');
    console.error('   Generá uno y agregalo a backend/.env, por ejemplo:');
    console.error('   JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'));
    process.exit(1);
}

/* ==========================================================================
   2. MIDDLEWARES DE LA APLICACIÓN
   ========================================================================== */
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

/* ==========================================================================
   3. CONFIGURACIÓN DE MULTIMEDIA (CLOUDINARY & MULTER)
   ========================================================================== */
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (tiposPermitidos.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG, WEBP o GIF.'));
        }
    }
});

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ==========================================================================
   4. CONEXIÓN A LA BASE DE DATOS
   --------------------------------------------------------------------------
   Ahora hay DOS clases de base:

     - La CENTRAL: una sola. Tiene las empresas, los logins y los módulos.
       Se usa a través de src/db/central.js.

     - La de cada EMPRESA: una por cliente. No hay nada que "elegir" acá: el
       pool correcto lo resuelve el contexto del request (src/db/tenant.js).

   Por eso las 28 rutas siguen escritas igual que antes. No saben que hay más
   de una empresa, y no hace falta que lo sepan.
   ========================================================================== */
const tenant = require('./src/db/tenant');
const registro = require('./src/servicios/registro');
const central = require('./src/db/central');
const altas = require('./src/servicios/altas');
const soporte = require('./src/servicios/soporte');

// El `db` que usan las rutas: mismos argumentos que el pool anterior
// (db.query(sql, params, callback)), pero sale por la base de la empresa
// del request.
const db = tenant.db;

// Se eliminó a propósito el viejo `crearUsuarioAdminInicial()`:
//   - volvía a crear el admin en CADA arranque si no lo encontraba, y
//   - con varias empresas, el usuario inicial ya no se define por variables de
//     entorno: vive en la base central (usuarios_globales).
// Un usuario que se re-crea solo en cada reinicio es una puerta trasera.

central.verificar()
    .then((f) => {
        console.log(`✅ Base central OK · ${f.empresas} empresa(s), ${f.modulos} módulo(s), ${f.planes} plan(es), ${f.usuarios} usuario(s).`);
    })
    .catch((err) => {
        console.error('❌ No se pudo leer la base central:', err.message);
        console.error('   Corre:  npm run f1:setup');
    });

/* ==========================================================================
   MARCA BLANCA: DE DONDE SALE Y QUE ES PUBLICA
   ==========================================================================
   La marca de cada empresa vive en la fila de `empresas` de la base CENTRAL,
   no en variables de entorno. Antes salia de `COMERCIO_*`: con eso, la empresa
   numero 2 entra al sistema y ve en el header el nombre y el logo de la
   numero 1, que es justamente lo que un sistema de varias empresas no puede
   hacer.

   `/api/config-comercio` es PUBLICA a proposito: la tiene que poder leer la
   pantalla de login, que todavia no sabe de quien es el usuario. Por eso:

     - Si viene un token, se responde con la marca de ESA empresa.
     - Si no viene token (pantalla de login, o el logo antes de escribir el
       mail), se responde con las variables de entorno, que son la marca de la
       unica empresa que hay instalado.

   La segunda parte es un puente, no la solución final: cuando exista la
   busqueda "a que empresa pertenece este email" (F5b), la pantalla de login va
   a preguntar por la empresa y no va a necesitar este camino de aqui.

   Que sea publica no filtra nada: los mismos datos (nombre, logo, telefono,
   direccion) salen impresos en los comprobantes que el cliente se lleva.
   ========================================================================== */

/**
 * Los datos de marca y de contacto de una empresa, en un solo objeto.
 *
 * Antes cada ruta armaba su propia lista y se habian desincronizado: el
 * comprobante mandaba telefono y direccion, el login mandaba los colores, y
 * `/api/mi-empresa` mandaba los colores pero no el subtitulo. El que carga la
 * marca en el navegador recibia un campo distinto en cada endpoint, y por eso
 * termino usando variables de entorno "para no complicarse".
 *
 * Un solo lugar, y el nombre del campo es el de la columna, para que no haya
 * que traducir `logo_url` a `logo` y viceversa.
 */
function datosDeMarca(e) {
    if (!e) return null;
    return {
        nombre: e.nombre,
        subtitulo: e.subtitulo,
        logo_url: e.logo_url,
        color_primario: e.color_primario,
        color_secundario: e.color_secundario,
        telefono: e.telefono,
        email_contacto: e.email_contacto,
        direccion: e.direccion,
        cuit: e.cuit
    };
}

/** La marca de las variables de entorno: el puente para el que no tiene token. */
function marcaDeEntorno() {
    return {
        nombre: process.env.COMERCIO_NOMBRE || 'Sistema de Gestión',
        subtitulo: process.env.COMERCIO_SUBTITULO || 'Gestión de Stock y Taller',
        // Sin barra inicial porque `marca.js` normaliza las rutas relativas.
        logo_url: process.env.COMERCIO_LOGO || 'logos/logo.jpg',
        color_primario: null,
        color_secundario: null,
        telefono: null,
        email_contacto: null,
        direccion: null,
        cuit: null
    };
}

app.get('/api/config-comercio', async (req, res) => {
    // Con token se responde con la empresa de ese token.
    // Sin token pero CON slug (pre-login F5c), busca por slug.
    // Sin token y sin slug: marca de entorno (fallback).
    // Esta ruta NUNCA falla con error: siempre devuelve algo (200).
    const auth = req.headers['authorization'];
    const token = auth && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;
    const slug = req.query.slug; // opcional: pre-login lookup por slug

    // Un token VÁLIDO que no pertenece a ninguna empresa (el SUPERADMIN) se
    // distingue de la ausencia de token. Con el codigo anterior los dos caian
    // al final y recibian `marcaDeEntorno()`, o sea la marca de Service
    // Integral: entrar a login.html con la sesion del panel abierta volvia a
    // poner el nombre de Service Integral en una pantalla que no es de nadie.
    let tokenValido = false;

    if (token) {
        try {
            const carga = jwt.verify(token, JWT_SECRET);
            if (carga) {
                tokenValido = true;
                if (carga.empresa_id) {
                    const empresa = await registro.empresaPorId(carga.empresa_id);
                    if (empresa) return res.json(datosDeMarca(empresa));
                }
            }
        } catch {
            // Token inválido o vencido: se sigue con slug o entorno.
        }
    }

    if (slug) {
        const empresa = await central.uno('SELECT * FROM empresas WHERE slug = ?', [slug]);
        if (empresa) return res.json(datosDeMarca(empresa));
    }

    // Con un token de SUPERADMIN no hay empresa que marcar. Se responde igual
    // (esta ruta nunca dice "no") pero avisando que no hay marca, y el cliente
    // deja la pantalla neutral en vez de inventar una.
    if (tokenValido) {
        return res.json({ ...marcaDeEntorno(), sin_empresa: true });
    }

    res.json(marcaDeEntorno());
});

// F5c — Lookup empresa por email (sin auth, rate-limited)
//
// El frontend llama al hacer blur en el campo email. Sirve para:
//   1. Detectar a qué empresa pertenece el email
//   2. Mostrar logo/colores de esa empresa ANTES de logearse
//   3. No revela si el email existe: siempre 200 con {encontrado: false}
//
// Rate limit: 10 req/min por IP (evita enumeración de emails)
const limitadorLookupEmail = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas consultas. Espera un minuto.' },
    keyGenerator: (req) => req.ip
});

app.get('/api/central/empresa-por-email', limitadorLookupEmail, async (req, res) => {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.json({ encontrado: false });
    }

    try {
        // Solo busca usuarios ACTIVOS. Un usuario inactivo no debe ser "encontrable".
        //
        // `usuarioPorEmail` devuelve lo primero que encuentra con ese correo. Un
        // mismo correo puede estar en dos empresas (dos talleres con el mismo
        // dominio, por ejemplo). Si devuelve la primera y esa empresa esta
        // suspendida o de baja, la pantalla queda sin marca aunque la otra
        // empresa sea operativa. Por eso se filtra en SQL por empresa operativa:
        // la fila que se muestra es la empresa realmente activa, no la primera.
        const usuario = await registro.usuarioOperativoPorEmail(email);
        if (!usuario || !usuario.empresa_id) {
            return res.json({ encontrado: false });
        }

        const empresa = await registro.empresaPorId(usuario.empresa_id);
        if (!empresa || !['ACTIVO', 'DEMO'].includes(empresa.estado)) {
            return res.json({ encontrado: false });
        }

        res.json({
            encontrado: true,
            empresa_id: empresa.id,
            slug: empresa.slug,
            nombre: empresa.nombre,
            modulos_contratados: Array.from(await registro.codigosDeModulos(empresa.id))
        });
    } catch (err) {
        console.error('Error en empresa-por-email:', err);
        // Nunca revelamos si falló: mismo comportamiento que "no encontrado"
        return res.json({ encontrado: false });
    }
});

/* ==========================================================================
   5.0 MIDDLEWARES DE AUTENTICACIÓN Y AUTORIZACIÓN
   ========================================================================== */

/**
 * Verifica el token y deja listo el contexto de la empresa.
 *
 * Antes era síncrono salvo por `jwt.verify` (callback). Ahora además hay que
 * resolver la empresa contra la base central, así que es async.
 *
 * Lo importante es la última línea: `conContexto(...)` mete el pool de la
 * empresa en el contexto del request. De ahí para adentro, todo `db.query(...)`
 * —incluidas las 28 rutas, que no se tocaron— sale por la base correcta.
 */
async function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
        return res.status(401).json({ error: 'No autorizado. Iniciá sesión nuevamente.' });
    }

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Sesión inválida o expirada. Iniciá sesión nuevamente.' });
    }

    // El SuperAdmin no tiene taller: no pertenece a ninguna empresa.
    // Cuando existan sus rutas propias, van en otro lado.
    if (payload.rol === 'SUPERADMIN' || !payload.empresa_id) {
        return res.status(403).json({ error: 'Esta sesión no corresponde a una empresa.' });
    }

    try {
        const empresa = await registro.empresaPorId(payload.empresa_id);

        // Se consulta en CADA request, con caché de ~30 s. Sin este chequeo,
        // una empresa suspendida seguiría trabajando hasta que venciera su
        // token (8 horas): suspender no serviría para nada.
        if (!registro.estaOperativa(empresa)) {
            return res.status(403).json({ error: 'La cuenta de la empresa no está activa. Contactá al administrador del servicio.' });
        }

        const pool = tenant.obtenerPool(empresa.nombre_db);

        // --- CLAVE TEMPORAL PENDIENTE ---------------------------------------
        // Entra con una clave que genero el SuperAdmin y que el usuario todavia
        // no cambio. Se le deja pasar por UNA sola puerta: la de cambiar la
        // clave. Ni ver clientes ni facturar ni borrar nada.
        //
        // Por que se corta acá y no en cada ruta: ponerlo en `verificarToken`
        // es un solo lugar y no se puede olvidar. Ponerlo en las rutas es
        // Protegerlo en cada ruta es dejar la puerta abierta en la proxima
        // ruta nueva: alguien la escribe sin el middleware y no se nota.
        // querer, alguien lo escribe sin el middleware y la proteccion no esta.
        //
        // La excepcion es `GET /api/mi-empresa` porque el frontend la necesita
        // para saber QUE tiene que cambiar la clave y a que empresa pertenece.
        // No devuelve datos del negocio: nombre, plan y logo.
        if (await registro.claveTemporalPendiente(payload.id)) {
            const permitidas = [
                'POST /api/usuarios/cambiar-password',
                'GET /api/mi-empresa'
            ];
            const actual = `${req.method} ${rutaOriginal(req)}`;
            if (!permitidas.includes(actual)) {
                return res.status(403).json({
                    error:
                        'Tenés que cambiar la clave temporal antes de seguir.',
                    debe_cambiar_password: true
                });
            }
        }

        req.usuario = payload;
        req.empresa = empresa;

        return tenant.conContexto({ pool, empresa, usuario: payload }, next);
    } catch (err) {
        console.error('Error al resolver la empresa del token:', err.message);
        return res.status(503).json({ error: 'Servicio temporalmente no disponible.' });
    }
}

function requiereAdmin(req, res, next) {
    if (!req.usuario || req.usuario.rol !== 'ADMIN') {
        return res.status(403).json({ error: 'No tenés permisos para realizar esta acción.' });
    }
    next();
}

/**
 * La ruta como la escribio el.route, con los parametros puestos: /api/clientes/7.
 *
 * En los middlewares que corren antes de que la ruta resuelva, `req.path` todavia
 * es la parte de la URL pedida y `req.route` puede no existir, asi que se arma con
 * `req.originalUrl`, que siempre trae la URL completa sin query string.
 *
 * Se usa para la lista blanca de la clave temporal pendiente. Importa que sea
 * EXACTA: si la comparacion fuera por prefijo, `/api/usuarios/cambiar-password-de-otro`
 * pasaria el filtro.
 */
function rutaOriginal(req) {
    return (req.originalUrl || req.url || '').split('?')[0];
}

/* ==========================================================================
   5.0.1 MÓDULOS CONTRATADOS
   --------------------------------------------------------------------------
   Que el sistema tenga una funcionalidad y que esta empresa la haya
   contratado son dos cosas distintas. El catálogo dice que EXISTE;
   `empresa_modulos` dice que se CONTRATÓ.

   A qué módulo pertenece cada parte:

     stock        /api/productos/*        /api/movimientos-stock
     reparaciones /api/reparaciones/*
     clientes     /api/clientes/*
     pedidos      /api/pedidos/*
     etiquetas_qr, presupuestos, reportes, facturacion   (todavia sin rutas)

   Quedan SIN módulo a propósito, porque no son funcionalidad vendible sino
   infraestructura: /api/usuarios, /api/upload, /api/delete-image.

   POR QUÉ 404 Y NO 403
   Un 403 confirmaría que la sección existe pero no la podés usar, lo cual le
   dice al cliente que hay algo que no tiene. Un 404 no dice nada. Es el mismo
   criterio que se usa cuando un recurso es de otra empresa.
   ========================================================================== */
function requiereModulo(codigo) {
    return async (req, res, next) => {
        const contratados = await registro.codigosDeModulos(req.empresa.id);
        if (!contratados.has(codigo)) {
            return res.status(404).json({ error: 'No encontrado' });
        }
        next();
    };
}

/* ==========================================================================
   5.1 VALIDACIÓN DE DATOS DE ENTRADA Y FORMATEO
   ========================================================================== */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function capitalizarPalabras(texto) {
    if (!texto || typeof texto !== 'string') return null;
    return texto
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
        .join(' ');
}

function capitalizarPrimeraLetra(texto) {
    if (!texto || typeof texto !== 'string') return null;
    const limpio = texto.trim();
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

function validarProducto(body) {
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    if (!nombre) return { valido: false, error: 'El nombre del producto es obligatorio.' };
    if (nombre.length > 150) return { valido: false, error: 'El nombre no puede superar los 150 caracteres.' };

    let precio = 0;
    if (body.precio !== undefined && body.precio !== null && body.precio !== '') {
        precio = Number(body.precio);
        if (!Number.isFinite(precio) || precio < 0) return { valido: false, error: 'El precio tiene que ser un número mayor o igual a 0.' };
    }

    let stock = 0;
    if (body.stock !== undefined && body.stock !== null && body.stock !== '') {
        stock = Number(body.stock);
        if (!Number.isInteger(stock) || stock < 0) return { valido: false, error: 'El stock tiene que ser un número entero mayor o igual a 0.' };
    }

    let stockMinimo = 0;
    if (body.stockMinimo !== undefined && body.stockMinimo !== null && body.stockMinimo !== '') {
        stockMinimo = Number(body.stockMinimo);
        if (!Number.isInteger(stockMinimo) || stockMinimo < 0) return { valido: false, error: 'El stock mínimo tiene que ser un número entero mayor o igual a 0.' };
    }

    const distribuidor = body.distribuidor ? String(body.distribuidor).trim().slice(0, 100) : null;
    const codigoDistribuidor = body.codigoDistribuidor ? String(body.codigoDistribuidor).trim().slice(0, 100) : null;
    const categoria = body.categoria ? String(body.categoria).trim().slice(0, 50) : 'Otros';
    const descripcion = body.descripcion ? String(body.descripcion).trim() : null;

    const imagenes = {};
    for (const campo of ['imagen_1', 'imagen_2', 'imagen_3']) {
        const valor = body[campo];
        if (!valor) { imagenes[campo] = null; continue; }
        if (typeof valor !== 'string' || !/^https?:\/\//i.test(valor)) {
            return { valido: false, error: `${campo} tiene que ser una URL válida (http/https).` };
        }
        imagenes[campo] = valor;
    }

    return { valido: true, datos: { nombre, precio, stock, stockMinimo, categoria, distribuidor, codigoDistribuidor, descripcion, ...imagenes } };
}

function validarUsuario(body) {
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rol = body.rol === 'ADMIN' ? 'ADMIN' : 'TECNICO';

    if (!nombre) return { valido: false, error: 'El nombre es obligatorio.' };
    if (!EMAIL_REGEX.test(email)) return { valido: false, error: 'El correo electrónico no es válido.' };
    if (password.length < 6) return { valido: false, error: 'La contraseña tiene que tener al menos 6 caracteres.' };

    return { valido: true, datos: { nombre, email, password, rol } };
}

function validarCliente(body) {
    const nombre = capitalizarPalabras(body.nombre);
    if (!nombre) return { valido: false, error: 'El nombre del cliente es obligatorio.' };
    if (nombre.length > 150) return { valido: false, error: 'El nombre no puede superar los 150 caracteres.' };

    return {
        valido: true,
        datos: {
            nombre,
            telefono: body.telefono ? String(body.telefono).trim().slice(0, 50) : null,
            direccion: capitalizarPalabras(body.direccion),
            email: body.email ? String(body.email).trim().slice(0, 150) : null,
            notas: capitalizarPrimeraLetra(body.notas)
        }
    };
}

function validarStockMinimo(body) {
    const stockMinimo = Number(body.stockMinimo);
    if (!Number.isInteger(stockMinimo) || stockMinimo < 0) {
        return { valido: false, error: 'El stock mínimo tiene que ser un número entero mayor o igual a 0.' };
    }
    return { valido: true, datos: { stockMinimo } };
}

function validarReparacion(body) {
    const cliente_nombre = capitalizarPalabras(body.cliente_nombre);
    const equipo = capitalizarPalabras(body.equipo);
    const falla_declarada = capitalizarPrimeraLetra(body.falla_declarada);

    if (!cliente_nombre) return { valido: false, error: 'El nombre del cliente es obligatorio.' };
    if (!equipo) return { valido: false, error: 'El equipo es obligatorio.' };
    if (!falla_declarada) return { valido: false, error: 'La falla declarada es obligatoria.' };

    const ESTADOS_VALIDOS = ['Pendiente', 'En Reparacion', 'Esperando Repuesto', 'Listo', 'Entregado', 'Cancelado'];
    const estado = ESTADOS_VALIDOS.includes(body.estado) ? body.estado : 'Pendiente';

    const costo_mano_obra = Number(body.costo_mano_obra);
    const costo_repuestos = Number(body.costo_repuestos);
    if (body.costo_mano_obra !== undefined && (!Number.isFinite(costo_mano_obra) || costo_mano_obra < 0)) {
        return { valido: false, error: 'El costo de mano de obra tiene que ser un número mayor o igual a 0.' };
    }
    if (body.costo_repuestos !== undefined && (!Number.isFinite(costo_repuestos) || costo_repuestos < 0)) {
        return { valido: false, error: 'El costo de repuestos tiene que ser un número mayor o igual a 0.' };
    }

    const repuestos_detalle = Array.isArray(body.repuestos_detalle) ? body.repuestos_detalle : [];

    return {
        valido: true,
        datos: {
            cliente_nombre,
            cliente_telefono: body.cliente_telefono ? String(body.cliente_telefono).trim().slice(0, 50) : null,
            direccion: capitalizarPalabras(body.direccion),
            tipo_cobertura: body.tipo_cobertura === 'En Garantia' ? 'En Garantia' : 'Fuera de Garantia',
            equipo,
            falla_declarada,
            diagnostico_tecnico: body.diagnostico_tecnico ? String(body.diagnostico_tecnico).trim() : null,
            notas_servicio: capitalizarPrimeraLetra(body.notas_servicio),
            repuestos_detalle,
            costo_mano_obra: Number.isFinite(costo_mano_obra) ? costo_mano_obra : 0,
            costo_repuestos: Number.isFinite(costo_repuestos) ? costo_repuestos : 0,
            estado,
            tecnico_asignado: body.tecnico_asignado ? String(body.tecnico_asignado).trim().slice(0, 100) : null
        }
    };
}

/* ==========================================================================
   5. ENDPOINTS DE AUTENTICACIÓN Y GESTIÓN DE USUARIOS
   ========================================================================== */

const limitadorLogin = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Probá de nuevo en unos minutos.' }
});

// Hash descartable. Cuando el email no existe se compara igual contra esto,
// para que el tiempo de respuesta no delate si la cuenta existe o no.
const HASH_DESCARTABLE = bcrypt.hashSync('usuario-inexistente-' + Math.random(), 10);

app.post('/api/login', limitadorLogin, async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Por favor ingrese email y contraseña' });
    }

    // El mismo texto para "no existe", "está inactivo" y "contraseña mal".
    // Si el mensaje cambiara, cualquiera podría averiguar qué emails están
    // registrados probando uno por uno.
    const CREDENCIALES_MAL = { error: 'Usuario o contraseña incorrectos' };

    try {
        // El email es único en TODA la central, no por empresa: es lo que
        // permite resolver a qué empresa pertenece alguien con solo el email.
        const usuario = await registro.usuarioPorEmail(email);

        if (!usuario || !usuario.activo) {
            bcrypt.compareSync(String(password), HASH_DESCARTABLE);
            return res.status(401).json(CREDENCIALES_MAL);
        }

        if (!bcrypt.compareSync(password, usuario.password_hash)) {
            return res.status(401).json(CREDENCIALES_MAL);
        }

        // El SuperAdmin no pertenece a ninguna empresa: no tiene base de taller.
        let empresa = null;
        if (usuario.rol !== 'SUPERADMIN') {
            empresa = await registro.empresaPorId(usuario.empresa_id);

            if (!empresa) {
                console.error(`Login de ${email}: la empresa ${usuario.empresa_id} no existe.`);
                return res.status(401).json(CREDENCIALES_MAL);
            }

            if (!registro.estaOperativa(empresa)) {
                return res.status(403).json({
                    error: `La cuenta de ${empresa.nombre} está ${String(empresa.estado).toLowerCase()}. Contactá al administrador del servicio.`
                });
            }
        }

        const token = jwt.sign(
            {
                id: usuario.id,
                nombre: usuario.nombre,
                rol: usuario.rol,
                empresa_id: usuario.empresa_id
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        // No se espera: si falla el registro de "último acceso", el login no
        // tiene por qué fallar.
        registro.marcarAcceso(usuario.id).catch(() => {});

        // Módulos contratados: el frontend los necesita para no mostrar secciones
        // que esta empresa no compró. Ojo: esto es CÓMODO, no seguridad. La
        // seguridad real es que `requiereModulo` rechaza la ruta en el servidor.
        const modulos = empresa
            ? Array.from(await registro.codigosDeModulos(empresa.id))
            : [];

        // Entra con una clave temporal que todavia no cambio. Va en la respuesta para
        // que el frontend lleve derecho a la pantalla de cambiar la clave y no
        // entre a cruzar la primera pantalla que se parezca a lo suyo.
        const debeCambiar = await registro.claveTemporalPendiente(usuario.id);

        res.json({
            mensaje: 'Autenticación exitosa',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol,
                debe_cambiar_password: debeCambiar
            },
            debe_cambiar_password: debeCambiar,
            // Marca blanca: la necesita el frontend ya mismo después de entrar.
            // `datosDeMarca` mete nombre, logo, colores y datos de contacto; el
            // frontend guarda todo esto en `empresa_actual` y con eso pinta la
            // marca sin tener que volver a preguntar.
            empresa: empresa ? {
                id: empresa.id,
                slug: empresa.slug,
                rubro: empresa.rubro,
                estado: empresa.estado,
                plan: empresa.plan,
                limite_usuarios: empresa.limite_usuarios,
                modulos,
                ...datosDeMarca(empresa)
            } : null
        });
    } catch (err) {
        console.error('Error en login:', err);
        return res.status(500).json({ error: 'Error en el servidor' });
    }
});

/* ==========================================================================
   5.0.2 MI EMPRESA
   --------------------------------------------------------------------------
   Lo mismo que devuelve el login, pero consultable después. El login te da
   estos datos una vez y quedan viejos: si leAmpliaron el plan o le
   agregaron un módulo, el frontend se entera con esto sin obligar a que
   nadie vuelva a iniciar sesión.

   Es de solo lectura y no expone la contraseña de la base ni el secreto de
   los tokens: es el mismo objeto `empresa` que ya vive en memoria en cada
   request, con tres campos más.
   ========================================================================== */
app.get('/api/mi-empresa', verificarToken, async (req, res) => {
    try {
        const empresa = req.empresa;
        const modulos = Array.from(await registro.codigosDeModulos(empresa.id));
        res.json({
            id: empresa.id,
            slug: empresa.slug,
            rubro: empresa.rubro,
            estado: empresa.estado,
            plan: empresa.plan,
            plan_nombre: empresa.plan_nombre,
            limite_usuarios: empresa.limite_usuarios,
            usuarios_actuales: await registro.contarUsuarios(empresa.id),
            modulos,
            // Claim de sesión de soporte, o null. El frontend lo lee para
            // mostrar el banner de "estás viendo otra empresa".
            //
            // Sale acá y no solo del token porque el banner es lo que evita que
            // alguien toque datos pensando que son suyos. Si se armara
            // descifrando el token en el navegador, un usuario con las
            // herramientas del navegador abiertas podría editarse el claim y
            // sacarse el aviso de encima sin tocar la base. Que venga de la
            // API no lo vuelve a prueba de manipulacion -- el token lo firma el
            // servidor -- pero deja el aviso en un solo lugar en vez de en
            // cinco paginas.
            soporte: soporte.claimDeSoporte(req.usuario),
            // Que tenga que cambiar la clave. Va en la respuesta para que el
            // frontend lleve derecho a esa pantalla en vez de dejarla entrar y
            // que cada ruta rebote con 403.
            debe_cambiar_password: await registro.claveTemporalPendiente(req.usuario.id),
            // Nombre, logo, colores y datos de contacto, por el mismo helper que
            // usan el login y el comprobante.
            ...datosDeMarca(empresa)
        });
    } catch (err) {
        console.error('Error en /api/mi-empresa:', err);
        return res.status(500).json({ error: 'Error en el servidor' });
    }
});

app.post('/api/usuarios', verificarToken, requiereAdmin, async (req, res) => {
    const validacion = validarUsuario(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { nombre, email, password, rol } = validacion.datos;

    /* ----------------------------------------------------------------------
       LIMITE DE USUARIOS DEL PLAN  (F3)
       ----------------------------------------------------------------------
       El plan base trae N usuarios. Pasarse cuesta mas plata, asi que el
       limite se aplica ACA, en el servidor. No alcanza con esconder el
       boton en la pantalla: cualquiera que sepa la URL podria saltarselo.

       `limite_usuarios` ya viene resuelto en `empresaPorId` como
       COALESCE(empresas.max_usuarios, planes.max_usuarios): primero una
       excepcion de esta empresa, y si no, lo que trae el plan.

       403 y no 402: el pedido se entiende y esta autenticado, lo que falta
       es el derecho a tenerlo. El `codigo` existe para que el frontend
       distinga esto de un 403 de permisos.
    ---------------------------------------------------------------------- */
    const limite = Number(req.empresa.limite_usuarios);
    if (Number.isFinite(limite) && limite > 0) {
        const usados = await registro.contarUsuarios(req.empresa.id);
        if (usados >= limite) {
            return res.status(403).json({
                error: `Tu plan permite ${limite} ${limite === 1 ? 'usuario' : 'usuarios'}. Para agregar más, contactanos para ampliarlo.`,
                codigo: 'LIMITE_USUARIOS',
                limite,
                usuarios_actuales: usados
            });
        }
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    try {
        // `empresa_id` sale del token, nunca del body: un admin de una empresa
        // no puede crear usuarios a nombre de otra.
        const resultado = await central.query(
            'INSERT INTO usuarios_globales (empresa_id, nombre, email, password_hash, rol) VALUES (?, ?, ?, ?, ?)',
            [req.empresa.id, nombre, email, passwordHash, rol]
        );
        res.status(201).json({ mensaje: 'Usuario creado con éxito', id: resultado.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            // El email es único en toda la central, no solo en esta empresa.
            return res.status(400).json({ error: 'El correo electrónico ya está registrado' });
        }
        console.error('Error al registrar usuario:', err);
        return res.status(500).json({ error: 'Error interno al crear usuario' });
    }
});

app.get('/api/usuarios', verificarToken, requiereAdmin, async (req, res) => {
    try {
        const filas = await central.query(
            `SELECT id, nombre, email, rol, activo, creado_en
               FROM usuarios_globales
              WHERE empresa_id = ?
              ORDER BY nombre ASC`,
            [req.empresa.id]
        );
        res.json(filas);
    } catch (err) {
        console.error('Error al listar usuarios:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.delete('/api/usuarios/:id', verificarToken, requiereAdmin, async (req, res) => {
    const idABorrar = parseInt(req.params.id, 10);

    if (!Number.isInteger(idABorrar)) {
        return res.status(400).json({ error: 'Usuario inválido' });
    }

    if (idABorrar === req.usuario.id) {
        return res.status(400).json({ error: 'No podés eliminar tu propio usuario mientras estás logueado con él.' });
    }

    try {
        // El `AND empresa_id = ?` no es decorativo: sin él, un admin podía
        // borrar un usuario de OTRA empresa pasando otro id. Y si el usuario es
        // de otra empresa se responde 404, no 403: un 403 confirmaría que ese
        // id existe en algún lado.
        const usuarioABorrar = await central.uno(
            'SELECT id, rol FROM usuarios_globales WHERE id = ? AND empresa_id = ?',
            [idABorrar, req.empresa.id]
        );

        if (!usuarioABorrar) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (usuarioABorrar.rol === 'ADMIN') {
            const fila = await central.uno(
                `SELECT COUNT(*) AS total FROM usuarios_globales
                  WHERE empresa_id = ? AND rol = 'ADMIN' AND activo = 1`,
                [req.empresa.id]
            );
            if (fila.total <= 1) {
                return res.status(400).json({ error: 'No podés eliminar el único administrador del sistema.' });
            }
        }

        await central.query(
            'DELETE FROM usuarios_globales WHERE id = ? AND empresa_id = ?',
            [idABorrar, req.empresa.id]
        );
        res.json({ mensaje: 'Usuario eliminado con éxito' });
    } catch (err) {
        console.error('Error al eliminar usuario:', err);
        return res.status(500).json({ error: 'Error al eliminar el usuario' });
    }
});

const limitadorCambioPassword = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' }
});

app.post('/api/usuarios/cambiar-password', verificarToken, limitadorCambioPassword, async (req, res) => {
    const { passwordActual, passwordNueva } = req.body;

    if (!passwordActual || !passwordNueva) {
        return res.status(400).json({ error: 'Faltan datos.' });
    }
    if (typeof passwordNueva !== 'string' || passwordNueva.length < 6) {
        return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 6 caracteres.' });
    }

    try {
        const usuario = await central.uno('SELECT * FROM usuarios_globales WHERE id = ?', [req.usuario.id]);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const coincide = bcrypt.compareSync(passwordActual, usuario.password_hash);
        if (!coincide) {
            return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
        }

        const nuevoHash = bcrypt.hashSync(passwordNueva, 10);

        // El flag se limpia EN LA MISMA sentencia que la clave. Si fueran dos,
        // una podria fallar entre medio y dejaria al usuario con la clave nueva
        // y el flag puesto: no podria hacer nada, y la clave temporal ya no
        // serviria para entrar porque el SuperAdmin tendria que generar otra.
        await central.query(
            'UPDATE usuarios_globales SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?',
            [nuevoHash, req.usuario.id]
        );
        registro.invalidarClavePendiente(req.usuario.id);

        // Token nuevo porque el que trae el usuario ya no sirve: hacia la sesion
        // que entro con la clave temporal, y el servidor la va a rebotar en
        // cuanto se lea el flag... que recien se limpio. Sin renovarlo, el
        // usuario tendria que volver a iniciar sesion a mano.
        const tokenNuevo = jwt.sign(
            {
                id: usuario.id,
                email: usuario.email,
                nombre: usuario.nombre,
                rol: usuario.rol,
                empresa_id: usuario.empresa_id
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            mensaje: 'Contraseña actualizada con éxito',
            token: tokenNuevo
        });
    } catch (err) {
        console.error('Error al actualizar password:', err);
        return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
    }
});

/* ==========================================================================
   6. ENDPOINTS DE PRODUCTOS / STOCK (C.R.U.D. Y BÚSQUEDA OPTIMIZADA)
   ========================================================================== */

app.get('/api/productos', verificarToken, requiereModulo('stock'), (req, res) => {
    const paginaParam = parseInt(req.query.page, 10);
    const usarPaginacion = Number.isInteger(paginaParam) && paginaParam > 0;

    const busqueda = typeof req.query.buscar === 'string' ? req.query.buscar.trim() : '';
    const estado = req.query.estado || 'TODOS';
    const categoria = req.query.categoria || 'TODAS';
    const ordenMap = {
        nombre_asc: 'nombre ASC', nombre_desc: 'nombre DESC',
        precio_asc: 'precio ASC', precio_desc: 'precio DESC',
        stock_asc: 'stock ASC', stock_desc: 'stock DESC',
        id_asc: 'id ASC', id_desc: 'id DESC'
    };
    const ordenSql = ordenMap[req.query.orden] || 'id DESC';

    const where = [];
    const params = [];

    if (busqueda) {
        where.push('(nombre LIKE ? OR codigoDistribuidor LIKE ? OR distribuidor LIKE ? OR descripcion LIKE ?)');
        const like = `%${busqueda}%`;
        params.push(like, like, like, like);
    }
    if (estado === 'CRITICO') where.push('(stock <= stockMinimo AND stock > 0)');
    else if (estado === 'NORMAL') where.push('stock > stockMinimo');
    else if (estado === 'SIN_STOCK') where.push('stock = 0');
    else if (estado === 'BAJO_MINIMO') where.push('stock <= stockMinimo');

    if (categoria && categoria !== 'TODAS') {
        where.push('categoria = ?');
        params.push(categoria);
    }
    if (typeof req.query.distribuidor === 'string' && req.query.distribuidor.trim() !== '') {
        where.push('distribuidor = ?');
        params.push(req.query.distribuidor.trim());
    }

    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

    // Modo lista simple / autocompletar bajo demanda (para pedidos y reparaciones)
    if (!usarPaginacion) {
        const limiteQuery = parseInt(req.query.limit, 10);
        const pideAlgoAcotado = busqueda || Number.isInteger(limiteQuery);
        const limite = Number.isInteger(limiteQuery) && limiteQuery > 0 && limiteQuery <= 200 ? limiteQuery : 50;

        let sql = `SELECT * FROM productos${whereSql} ORDER BY ${ordenSql}`;
        const finalParams = [...params];
        if (pideAlgoAcotado) {
            sql += ' LIMIT ?';
            finalParams.push(limite);
        }

        db.query(sql, finalParams, (err, results) => {
            if (err) {
                console.error('Error al traer productos:', err);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            res.json(results);
        });
        return;
    }

    // Modo paginado para la tabla de Stock
    const limiteParam = parseInt(req.query.limit, 10);
    const porPagina = Number.isInteger(limiteParam) && limiteParam > 0 && limiteParam <= 200 ? limiteParam : 50;
    const offset = (paginaParam - 1) * porPagina;

    db.query(`SELECT COUNT(*) AS total FROM productos${whereSql}`, params, (errCount, resultCount) => {
        if (errCount) {
            console.error('Error al contar productos:', errCount);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        const total = resultCount[0].total;

        db.query(
            `SELECT * FROM productos${whereSql} ORDER BY ${ordenSql} LIMIT ? OFFSET ?`,
            [...params, porPagina, offset],
            (err, results) => {
                if (err) {
                    console.error('Error al traer productos:', err);
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }
                res.json({
                    productos: results,
                    total,
                    pagina: paginaParam,
                    totalPaginas: Math.max(1, Math.ceil(total / porPagina))
                });
            }
        );
    });
});

app.get('/api/productos/proveedores', verificarToken, requiereModulo('stock'), (req, res) => {
    const sql = "SELECT DISTINCT distribuidor FROM productos WHERE distribuidor IS NOT NULL AND distribuidor != '' ORDER BY distribuidor ASC";
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('Error al listar proveedores:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(rows.map(r => r.distribuidor));
    });
});

app.post('/api/productos', verificarToken, requiereModulo('stock'), requiereAdmin, (req, res) => {
    const validacion = validarProducto(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { nombre, precio, stock, stockMinimo, categoria, distribuidor, codigoDistribuidor, descripcion, imagen_1, imagen_2, imagen_3 } = validacion.datos;

    const sql = `INSERT INTO productos 
    (nombre, precio, stock, stockMinimo, categoria, distribuidor, codigoDistribuidor, descripcion, imagen_1, imagen_2, imagen_3) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const valores = [
        nombre, precio, stock, stockMinimo, categoria, 
        distribuidor, codigoDistribuidor, descripcion, 
        imagen_1, imagen_2, imagen_3
    ];

    db.query(sql, valores, (err, result) => {
        if (err) {
            console.error('Error al insertar producto en MySQL:', err);
            return res.status(500).json({ error: 'Error al guardar el producto' });
        }
        res.status(201).json({ mensaje: 'Producto creado con éxito', id: result.insertId });
    });
});

app.delete('/api/productos/:id', verificarToken, requiereModulo('stock'), requiereAdmin, (req, res) => {
    const { id } = req.params;

    db.query('SELECT imagen_1, imagen_2, imagen_3 FROM productos WHERE id = ?', [id], async (errSelect, rows) => {
        if (errSelect) {
            console.error('Error al buscar imágenes del producto a eliminar:', errSelect);
            return res.status(500).json({ error: 'Error al eliminar el producto' });
        }

        const producto = rows[0];
        if (producto) {
            const imagenes = [producto.imagen_1, producto.imagen_2, producto.imagen_3].filter(Boolean);
            await Promise.all(imagenes.map(url => borrarImagenDeCloudinary(url)));
        }

        db.query('DELETE FROM productos WHERE id = ?', [id], (errDelete) => {
            if (errDelete) {
                console.error('Error al eliminar de MySQL:', errDelete);
                return res.status(500).json({ error: 'Error al eliminar el producto' });
            }
            res.json({ mensaje: 'Producto y sus imágenes eliminados correctamente' });
        });
    });
});

app.put('/api/productos/:id', verificarToken, requiereModulo('stock'), requiereAdmin, (req, res) => {
    const { id } = req.params;

    const validacion = validarProducto(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { nombre, precio, stock, stockMinimo, categoria, distribuidor, codigoDistribuidor, descripcion, imagen_1, imagen_2, imagen_3 } = validacion.datos;

    const sql = `UPDATE productos 
                 SET nombre = ?, precio = ?, stock = ?, stockMinimo = ?, categoria = ?, 
                     distribuidor = ?, codigoDistribuidor = ?, descripcion = ?, 
                     imagen_1 = ?, imagen_2 = ?, imagen_3 = ? 
                 WHERE id = ?`;
    
    db.query(sql, [
        nombre, precio, stock, stockMinimo, categoria,
        distribuidor, codigoDistribuidor, descripcion, 
        imagen_1, imagen_2, imagen_3, id
    ], (err, result) => {
        if (err) {
            console.error('❌ Error al actualizar en MySQL:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.status(200).json({ mensaje: 'Producto actualizado con éxito' });
    });
});

app.post('/api/productos/:id/stock-minimo', verificarToken, requiereModulo('stock'), requiereAdmin, (req, res) => {
    const { id } = req.params;

    const validacion = validarStockMinimo(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { stockMinimo } = validacion.datos;

    const sql = 'UPDATE productos SET stockMinimo = ? WHERE id = ?';
    db.query(sql, [stockMinimo, id], (err, result) => {
        if (err) {
            console.error('❌ Error al actualizar stock mínimo en MySQL:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json({ mensaje: 'Stock mínimo actualizado con éxito' });
    });
});

/* ==========================================================================
   7. ENDPOINTS DE PEDIDOS (CON TRANSACCIÓN Y AUTO-LIMPIEZA)
   ========================================================================== */

app.post('/api/pedidos', verificarToken, requiereModulo('pedidos'), requiereAdmin, (req, res) => {
    const { notas } = req.body;
    // Antes: `items.map(...)` reventaba con TypeError si no venian items, y con
    // un array vacio armaba `INSERT INTO pedido_items ... VALUES ` sin nada,
    // que es un error de sintaxis de SQL. O sea que un pedido sin productos daba
    // 500 por las dos vias. Un pedido sin items no tiene sentido de negocio,
    // pero es un caso de entrada, no una caida: se crea el pedido y listo.
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    db.getConnection((err, connection) => {
        if (err) {
            console.error('❌ Error al obtener conexión del Pool:', err);
            return res.status(500).json({ error: 'Error al procesar el pedido' });
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                console.error('❌ Error al iniciar transacción:', err);
                return res.status(500).json({ error: 'Error al procesar el pedido' });
            }

            const sqlPedido = 'INSERT INTO pedidos (notas) VALUES (?)';
            connection.query(sqlPedido, [notas], (err, result) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        console.error('❌ Error al insertar pedido:', err);
                        res.status(500).json({ error: 'Error al registrar el pedido' });
                    });
                }

                const pedidoId = result.insertId;
                const sqlItems = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad) VALUES ?';
                const valoresItems = items.map(item => [pedidoId, item.id, item.cantidad]);

                // Sin items no hay nada que insertar. Correr el INSERT con la
                // lista vacia genera `VALUES ` y MySQL lo rechaza.
                if (valoresItems.length === 0) {
                    console.log(`⚠️ Pedido #${pedidoId} guardado sin productos (no habia items en el pedido).`);
                    return connection.commit(() => {
                        connection.release();
                        res.status(201).json({ mensaje: 'Pedido guardado sin productos', pedidoId });
                    });
                }

                connection.query(sqlItems, [valoresItems], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            console.error('❌ Error al insertar artículos del pedido:', err);
                            res.status(500).json({ error: 'Error al registrar los repuestos' });
                        });
                    }

                    connection.commit((err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                console.error('❌ Error en commit:', err);
                                res.status(500).json({ error: 'Error al finalizar el pedido' });
                            });
                        }

                        connection.release();
                        console.log(`✅ Pedido #${pedidoId} guardado con éxito.`);

                        const sqlLimpieza = 'DELETE FROM pedidos WHERE fecha < NOW() - INTERVAL 2 MONTH';
                        db.query(sqlLimpieza, (errLimpieza, resultLimpieza) => {
                            if (errLimpieza) {
                                console.error('⚠️ Error al limpiar pedidos viejos:', errLimpieza);
                            } else if (resultLimpieza.affectedRows > 0) {
                                console.log(`🧹 Limpieza: Se eliminaron ${resultLimpieza.affectedRows} pedidos viejos.`);
                            }
                        });

                        res.status(201).json({ mensaje: 'Pedido guardado y base de datos optimizada', pedidoId });
                    });
                });
            });
        });
    });
});

app.get('/api/pedidos', verificarToken, requiereModulo('pedidos'), (req, res) => {
    const sql = 'SELECT * FROM pedidos ORDER BY fecha DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error al traer historial de pedidos:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(results);
    });
});

app.get('/api/pedidos/:id/items', verificarToken, requiereModulo('pedidos'), (req, res) => {
    const { id } = req.params;
    
    const sql = `
        SELECT pi.cantidad, p.nombre, p.codigoDistribuidor, p.distribuidor
        FROM pedido_items pi
        LEFT JOIN productos p ON pi.producto_id = p.id
        WHERE pi.pedido_id = ?
    `;

    db.query(sql, [id], (err, results) => {
        if (err) {
            console.error('❌ Error al traer items del pedido:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(results);
    });
});

/* ==========================================================================
   8. ENDPOINTS MULTIMEDIA (CLOUDINARY)
   ========================================================================== */

function extraerPublicId(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    try {
        const partesUrl = imageUrl.split('/');
        const indiceUpload = partesUrl.indexOf('upload');
        if (indiceUpload === -1) return null;
        const rutaConExtension = partesUrl.slice(indiceUpload + 2).join('/');
        return rutaConExtension.substring(0, rutaConExtension.lastIndexOf('.'));
    } catch {
        return null;
    }
}

async function borrarImagenDeCloudinary(imageUrl) {
    const publicId = extraerPublicId(imageUrl);
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId);
    } catch (err) {
        console.error(`⚠️ No se pudo borrar de Cloudinary la imagen (${imageUrl}):`, err.message);
    }
}

app.post('/api/upload', verificarToken, requiereAdmin, upload.single('imagen'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const fileBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    cloudinary.uploader.upload(fileBase64, {
        folder: 'service_integral',
        transformation: [
            { width: 800, height: 800, crop: "limit" },
            { quality: "auto" },
            { fetch_format: "auto" }
        ]
    }, (err, result) => {
        if (err) {
            console.error('❌ Error al subir a Cloudinary:', err);
            return res.status(500).json({ error: 'Error al subir la imagen' });
        }
        res.json({ url: result.secure_url });
    });
});

app.post('/api/delete-image', verificarToken, requiereAdmin, (req, res) => {
    const { imageUrl } = req.body;

    if (!imageUrl) {
        return res.status(400).json({ error: 'Falta la URL de la imagen' });
    }

    const publicId = extraerPublicId(imageUrl);
    if (!publicId) {
        return res.status(400).json({ error: 'La URL no pertenece a Cloudinary' });
    }

    cloudinary.uploader.destroy(publicId, (err, result) => {
        if (err) {
            console.error('❌ Error al borrar en Cloudinary:', err);
            return res.status(500).json({ error: 'No se pudo eliminar de la nube' });
        }
        res.json({ mensaje: 'Imagen eliminada de la nube con éxito', resultado: result });
    });
});

/* ==========================================================================
    9. MÓDULO: HISTORIAL DE MOVIMIENTOS Y AUDITORÍA DE STOCK
   ========================================================================== */
app.get('/api/movimientos-stock', verificarToken, requiereModulo('stock'), requiereAdmin, (req, res) => {
    const sql = 'SELECT * FROM movimientos_stock ORDER BY fecha DESC LIMIT 150';
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('Error al obtener auditoría de stock:', err);
            return res.status(500).json({ error: 'Error al consultar historial de movimientos' });
        }
        res.json(rows);
    });
});

/* ==========================================================================
   MÓDULO: ETIQUETAS QR (STOCK) — requiere modulo 'etiquetas_qr'
   ========================================================================== */
const crypto = require('crypto');
const QRCode = require('qrcode');

/**
 * Genera un codigo corto unico para la etiqueta.
 * 12 chars alfanumericos (sin vocales para evitar palabras feas).
 *
 * QUE CONTIENE EL QR: SOLO EL CODIGO, NADA MAS
 * Antes el QR llevaba la URL publica (`http://host/e/<codigo>`) y eso ataba la
 * etiqueta a un dominio que todavia no existe: en desarrollo apuntaba a
 * `localhost:3000`, que en un celular no significa nada, y el dia que la empresa
 * se mude a su dominio las etiquetas ya impresas dejarian de servir. Ademas esa
 * URL era publica, asi que cualquiera que la abriera leia precio, stock y
 * distribuidor sin entrar al sistema.
 *
 * Ahora el QR es solo el codigo y se lee con el escaner de la propia aplicacion,
 * que exige iniciar sesion y por lo tanto resuelve la base de la empresa
 * correcta. La etiqueta deja de depender del dominio: imprime el mismo hoy y
 * dentro de cinco anos.
 */
function generarCodigoEtiqueta() {
    const alfabeto = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 12; i++) {
        codigo += alfabeto[crypto.randomInt(0, alfabeto.length)];
    }
    return codigo;
}

/**
 * Construye el snapshot JSON inmutable del producto para la etiqueta.
 */
function construirSnapshot(producto) {
    return {
        producto_id: producto.id,
        codigo_interno: producto.codigoDistribuidor || `REP-${String(producto.id).padStart(5, '0')}`,
        nombre: producto.nombre,
        stock_actual: Number(producto.stock),
        stock_minimo: Number(producto.stockMinimo || 0),
        ubicacion: '',
        codigo_barras: '',
        distribuidor: producto.distribuidor || '',
        precio_venta: Number(producto.precio),
        generado_en: new Date().toISOString()
    };
}

/* Ya no hay URL publica de etiqueta. Se usaba para armar el QR y para las dos
   rutas `/e/...`, que se eliminaron: eran accesibles sin iniciar sesion y la
   segunda abria a la base de la empresa 1 escrita a mano. Ver `contextoActual()`:
   una ruta que consulta sin empresa en el contexto tira error en vez de adivinar
   a que base pegarle. */

// 1. LISTAR etiquetas (con/sin QR) — filtro para saber que productos tienen QR
app.get('/api/etiquetas', verificarToken, requiereModulo('etiquetas_qr'), (req, res) => {
    const { con_qr, buscar } = req.query;
    let sql = `
        SELECT p.id, p.nombre, p.codigoDistribuidor, p.stock, p.stockMinimo,
               p.distribuidor, p.precio,
               e.id AS etiqueta_id, e.codigo, e.activo, e.creado_en
        FROM productos p
        LEFT JOIN etiquetas_qr e ON e.producto_id = p.id AND e.activo = 1
        WHERE 1=1
    `;
    const params = [];

    if (con_qr === 'true') sql += ' AND e.id IS NOT NULL';
    if (con_qr === 'false') sql += ' AND e.id IS NULL';

    if (buscar && buscar.trim()) {
        const term = `%${buscar.trim().toLowerCase()}%`;
        sql += ` AND (LOWER(p.nombre) LIKE ? OR LOWER(p.codigoDistribuidor) LIKE ? OR LOWER(p.distribuidor) LIKE ?)`;
        params.push(term, term, term);
    }

    sql += ' ORDER BY p.nombre ASC LIMIT 200';

    db.query(sql, params, (err, rows) => {
        if (err) {
            console.error('Error al listar etiquetas:', err);
            return res.status(500).json({ error: 'Error al consultar etiquetas' });
        }
        res.json(rows);
    });
});

// 2. GENERAR (o regenerar) etiqueta QR para un producto
app.post('/api/etiquetas/generar', verificarToken, requiereModulo('etiquetas_qr'), requiereAdmin, async (req, res) => {
    const { producto_id } = req.body;
    if (!producto_id || !Number.isInteger(Number(producto_id))) {
        return res.status(400).json({ error: 'producto_id requerido (entero)' });
    }

    // Verificar que el producto existe
    db.query('SELECT * FROM productos WHERE id = ?', [producto_id], async (err, rows) => {
        if (err) {
            console.error('Error al buscar producto:', err);
            return res.status(500).json({ error: 'Error interno' });
        }
        if (!rows.length) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        const producto = rows[0];

        const codigo = generarCodigoEtiqueta();
        const snapshot = construirSnapshot(producto);

        // El QR lleva SOLO el codigo. Ver la nota de `generarCodigoEtiqueta`.
        let qrSvg;
        try {
            qrSvg = await QRCode.toString(codigo, {
                type: 'svg',
                width: 200,
                margin: 1,
                color: { dark: '#000000', light: '#ffffff' }
            });
        } catch (e) {
            console.error('Error generando QR:', e);
            return res.status(500).json({ error: 'Error generando código QR' });
        }

        // Upsert en etiquetas_qr
        db.query(
            `INSERT INTO etiquetas_qr (producto_id, codigo, datos_json, activo)
             VALUES (?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE codigo = VALUES(codigo), datos_json = VALUES(datos_json), activo = 1, actualizado_en = NOW()`,
            [producto_id, codigo, JSON.stringify(snapshot)],
            (err2) => {
                if (err2) {
                    console.error('Error guardando etiqueta:', err2);
                    return res.status(500).json({ error: 'Error guardando etiqueta' });
                }
                res.json({
                    mensaje: 'Etiqueta QR generada',
                    codigo,
                    qr_svg: qrSvg,
                    snapshot
                });
            }
        );
    });
});

// 3. DETALLE de etiqueta (con SVG/PNG listos para imprimir)
app.get('/api/etiquetas/:id', verificarToken, requiereModulo('etiquetas_qr'), async (req, res) => {
    const etiquetaId = Number(req.params.id);
    if (!Number.isInteger(etiquetaId)) {
        return res.status(400).json({ error: 'ID inválido' });
    }

    db.query(
        `SELECT e.*, p.nombre, p.codigoDistribuidor, p.stock, p.stockMinimo, p.distribuidor, p.precio
           FROM etiquetas_qr e
           JOIN productos p ON p.id = e.producto_id
          WHERE e.id = ?`,
        [etiquetaId],
        async (err, rows) => {
            if (err) {
                console.error('Error buscando etiqueta:', err);
                return res.status(500).json({ error: 'Error interno' });
            }
            if (!rows.length) {
                return res.status(404).json({ error: 'Etiqueta no encontrada' });
            }
            const e = rows[0];

            let qrSvg, qrPng;
            try {
                qrSvg = await QRCode.toString(e.codigo, { type: 'svg', width: 200, margin: 1 });
                qrPng = await QRCode.toDataURL(e.codigo, { width: 400, margin: 1 });
            } catch (e2) {
                console.error('Error generando QR:', e2);
                return res.status(500).json({ error: 'Error generando QR' });
            }

            res.json({
                etiqueta: e,
                qr_svg: qrSvg,
                qr_png_base64: qrPng
            });
        }
    );
});

// 4. DESACTIVAR etiqueta (soft delete)
app.delete('/api/etiquetas/:id', verificarToken, requiereModulo('etiquetas_qr'), requiereAdmin, (req, res) => {
    const etiquetaId = Number(req.params.id);
    if (!Number.isInteger(etiquetaId)) {
        return res.status(400).json({ error: 'ID inválido' });
    }
    db.query('UPDATE etiquetas_qr SET activo = 0 WHERE id = ?', [etiquetaId], (err, result) => {
        if (err) {
            console.error('Error desactivando etiqueta:', err);
            return res.status(500).json({ error: 'Error interno' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Etiqueta no encontrada' });
        }
        res.json({ mensaje: 'Etiqueta desactivada' });
    });
});

/* --------------------------------------------------------------------------
   RUTAS PUBLICAS DE ETIQUETA: ELIMINADAS

   Existian GET /e/:codigo.svg (el QR) y GET /e/:codigo (la ficha del repuesto).
   Las dos tenian tres problemas que no se pueden arreglar sin cambiarlas de
   fondo:

     1. No exigian iniciar sesion. Cualquiera que tuviera el codigo leia el
        nombre del repuesto, el precio, el stock actual, el stock minimo y el
        distribuidor. A una empresa le sirve saber eso de la competencia.
     2. La ficha abria a una base escrita a mano:
            obtenerPool('serviceintegralsistema')
        que es la de la empresa 1. Si una segunda empresa contrata este modulo,
        sus etiquetas se resuelven contra los datos de la primera.
     3. El QR llevaba la URL, asi que la etiqueta quedaba atada a un dominio:
        en desarrollo era localhost:3000 (que en un celular no existe) y el dia
        que la empresa se mude a su dominio las etiquetas ya impresas dejarian
        de servir.

   Ahora el QR lleva solo el codigo y se lee con el escaner de la aplicacion
   (ruta 5 mas abajo), que exige sesion y por lo tanto ya resuelve la base de la
   empresa correcta sin que nadie la escriba a mano.

   La funcion escapeHtml que estaba entre estas rutas tambien se borro: la
   usaban solo ellas. Y ademas estaba rota: reemplazaba "&" por "&" y "<" por
   "<", o sea no escapaba nada. No la habria detectado ni el verificador mas
   estricto, porque un escape que no escapa tiene exactamente la misma forma que
   uno que escapa bien.
   -------------------------------------------------------------------------- */

// 5. CONSULTAR POR CODIGO — lo que llama el escaner de la aplicacion.
//
//    No colisiona con `/api/etiquetas/:id` de mas abajo, que queda registrado
//    despues: `:id` matchea UN segmento y esta ruta matchea DOS
//    (`codigo` + el codigo). No hay ambiguedad que resolver ni orden que
//    cuidar. Comprobado con scratch/probar-orden-rutas.js.
app.get('/api/etiquetas/codigo/:codigo', verificarToken, requiereModulo('etiquetas_qr'), (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();

    // El mismo alfabeto y el mismo largo con el que se generan los codigos. Si
    // no cumple, se responde sin consultar: el "LIKE" de abajo con un wildcard
    // seria otra consulta distinta.
    if (!/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{12}$/.test(codigo)) {
        return res.status(404).json({ error: 'Código inválido' });
    }

    // `db` es el pool de la empresa de la sesion: sale de conContexto, que tira
    // error si no hay empresa. Por eso esta ruta no puede terminar en la base de
    // otra empresa ni aunque se le olvide algo.
    db.query(
        `SELECT e.codigo, e.datos_json, e.creado_en, e.activo,
                p.id AS producto_id, p.nombre, p.codigoDistribuidor,
                p.stock, p.stockMinimo, p.distribuidor, p.precio, p.categoria,
                p.descripcion
           FROM etiquetas_qr e
           JOIN productos p ON p.id = e.producto_id
          WHERE e.codigo = ?`,
        [codigo],
        (err, rows) => {
            if (err) {
                console.error('Error consultando etiqueta por codigo:', err);
                return res.status(500).json({ error: 'Error interno' });
            }
            if (!rows.length || !rows[0].activo) {
                return res.status(404).json({ error: 'Etiqueta no encontrada o desactivada' });
            }

            const e = rows[0];
            const datos = typeof e.datos_json === 'string' ? JSON.parse(e.datos_json) : (e.datos_json || {});

            /* Se mandan DOS juegos de numeros a proposito:
                 - etiqueta: lo que quedo impreso en el papel, que no cambia.
                 - producto: lo que esta en el catalogo ahora.
               Si el repuesto se recibio o se vendio despues de colgar la
               etiqueta, el papel ya no dice la verdad, y el que escanea tiene que
               poder verlo en vez de confiar en un numero viejo. */
            res.json({
                codigo: e.codigo,
                etiqueta: {
                    codigo_interno: datos.codigo_interno || null,
                    nombre: datos.nombre || e.nombre,
                    stock_actual: datos.stock_actual ?? null,
                    stock_minimo: datos.stock_minimo ?? null,
                    precio_venta: datos.precio_venta ?? null,
                    distribuidor: datos.distribuidor || null,
                    generado_en: e.creado_en
                },
                producto: {
                    id: e.producto_id,
                    nombre: e.nombre,
                    categoria: e.categoria,
                    descripcion: e.descripcion,
                    codigoDistribuidor: e.codigoDistribuidor,
                    stock: e.stock,
                    stockMinimo: e.stockMinimo,
                    distribuidor: e.distribuidor,
                    precio: e.precio
                    /* `productos` no tiene columna de ubicacion ni de deposito.
                       El snapshot la trae vacia porque era el lugar donde se
                      iba a guardar, pero no hay de donde llenarla. Si algún
                       dia la hay, se agrega acá y no hay que tocar nada más. */
                },
                /* Si el papel no coincide con el catalogo, el escaner lo avisa
                   arriba de todo en vez de dejar que alguien anote sobre un
                   stock que no existe. */
                desactualizada: Number(e.stock) !== Number(datos.stock_actual)
                    || Number(e.precio) !== Number(datos.precio_venta)
            });
        }
    );
});

/* ==========================================================================
   10. MÓDULO: CLIENTES (HISTORIAL Y GESTIÓN)
   ========================================================================== */

// 1. Listar clientes (con búsqueda y límite para no saturar memoria)
app.get('/api/clientes', verificarToken, requiereModulo('clientes'), (req, res) => {
    const { buscar } = req.query;
    const limiteQuery = parseInt(req.query.limit, 10);
    const limite = Number.isInteger(limiteQuery) && limiteQuery > 0 && limiteQuery <= 100 ? limiteQuery : 50;

    let sql = `
        SELECT c.*, COUNT(r.id) AS cantidad_reparaciones
        FROM clientes c
        LEFT JOIN reparaciones r ON r.cliente_id = c.id
    `;
    const params = [];

    if (buscar && buscar.trim() !== '') {
        const termino = `%${buscar.trim().toLowerCase()}%`;
        sql += `
            WHERE LOWER(c.nombre) LIKE ? 
               OR LOWER(c.telefono) LIKE ? 
               OR LOWER(c.direccion) LIKE ?
        `;
        params.push(termino, termino, termino);
    }

    sql += ' GROUP BY c.id ORDER BY c.nombre ASC LIMIT ?';
    params.push(limite);

    db.query(sql, params, (err, rows) => {
        if (err) {
            console.error('Error al listar clientes:', err);
            return res.status(500).json({ error: 'Error al consultar clientes' });
        }
        res.json(rows);
    });
});

app.get('/api/clientes/:id', verificarToken, requiereModulo('clientes'), (req, res) => {
    db.query('SELECT * FROM clientes WHERE id = ?', [req.params.id], (err, rows) => {
        if (err) {
            console.error('Error al obtener cliente:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        if (rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json(rows[0]);
    });
});

app.get('/api/clientes/:id/reparaciones', verificarToken, requiereModulo('clientes'), (req, res) => {
    db.query(
        'SELECT * FROM reparaciones WHERE cliente_id = ? ORDER BY fecha_inicio DESC',
        [req.params.id],
        (err, rows) => {
            if (err) {
                console.error('Error al obtener historial del cliente:', err);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            res.json(rows);
        }
    );
});

app.put('/api/clientes/:id', verificarToken, requiereModulo('clientes'), requiereAdmin, (req, res) => {
    const validacion = validarCliente(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { nombre, telefono, direccion, email, notas } = validacion.datos;

    const sql = 'UPDATE clientes SET nombre = ?, telefono = ?, direccion = ?, email = ?, notas = ? WHERE id = ?';
    db.query(sql, [nombre, telefono, direccion, email, notas, req.params.id], (err) => {
        if (err) {
            console.error('Error al actualizar cliente:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json({ mensaje: 'Cliente actualizado con éxito' });
    });
});

async function resolverOCrearCliente(nombre, telefono, direccion) {
    const telefonoLimpio = telefono ? String(telefono).trim() : null;
    const nombreLimpio = String(nombre).trim();

    let clienteExistente;
    if (telefonoLimpio) {
        [clienteExistente] = await db.promise().query(
            'SELECT id, direccion FROM clientes WHERE telefono = ? LIMIT 1',
            [telefonoLimpio]
        );
    } else {
        [clienteExistente] = await db.promise().query(
            'SELECT id, direccion FROM clientes WHERE nombre = ? AND telefono IS NULL LIMIT 1',
            [nombreLimpio]
        );
    }

    if (clienteExistente && clienteExistente.length > 0) {
        const cliente = clienteExistente[0];
        if (!cliente.direccion && direccion) {
            await db.promise().query('UPDATE clientes SET direccion = ? WHERE id = ?', [direccion, cliente.id]);
        }
        return cliente.id;
    }

    const [resultado] = await db.promise().query(
        'INSERT INTO clientes (nombre, telefono, direccion) VALUES (?, ?, ?)',
        [nombreLimpio, telefonoLimpio, direccion || null]
    );
    return resultado.insertId;
}

/* ==========================================================================
   11. MÓDULO: GESTIÓN INTEGRAL DE REPARACIONES Y TALLER
   ========================================================================== */

async function descontarStockPorReparacion(idOrden, equipo, tecnicoAsignado, listaRepuestos) {
    for (const item of listaRepuestos) {
        let targetId = item.producto_id;

        if (!targetId && item.nombre) {
            const [prodEncontrado] = await db.promise().query(
                'SELECT id FROM productos WHERE LOWER(nombre) LIKE ? LIMIT 1',
                [`%${item.nombre.toLowerCase().trim()}%`]
            );
            if (prodEncontrado.length > 0) targetId = prodEncontrado[0].id;
        }

        if (targetId && item.cantidad > 0) {
            await db.promise().query(
                'UPDATE productos SET stock = GREATEST(0, stock - ?) WHERE id = ?',
                [item.cantidad, targetId]
            );
            await db.promise().query(
                `INSERT INTO movimientos_stock 
                 (producto_id, producto_nombre, usuario_nombre, tipo, cantidad_afectada, stock_resultante, motivo) 
                 VALUES (?, ?, ?, 'REPARACION', ?, (SELECT stock FROM productos WHERE id = ?), ?)`,
                [targetId, item.nombre, tecnicoAsignado || 'Técnico', item.cantidad, targetId, `Reparación #${idOrden} (${equipo})`]
            );
        }
    }
}

/* ==========================================================================
   ORDENES DE SERVICIO: ORDEN, BUSQUEDA Y PAGINACION EN EL SERVIDOR
   --------------------------------------------------------------------------
   Antes esta ruta era `SELECT * FROM reparaciones ORDER BY id DESC`, sin limite,
   y el orden que ve el usuario NO era ese: el navegador reordenaba el array
   entero con un comparator propio (cerrados al final, los que esperan hace mas
   de 14 dias primero, 'Pendiente' antes que los otros activos, y dentro de cada
   grupo el mas antiguo primero).

   Por que no se puede paginar encima de un orden que vive en el navegador
   --------------------------------------------------------------------------
   Paginar trae una sola parte del conjunto, y ordenar esa parte no alcanza: si
   el "mas antiguo primero" se calcula adentro de la pagina, la fila mas vieja
   de la pagina 1 puede ser mas nueva que la de la pagina 2, y el taller ve el
   mismo equipo dos veces con el mismo lugar y se le pierde uno. Ademas el
   `total` que necesita el control de paginacion no existe si no hay COUNT(*).

   Asi que el orden se expreso en SQL y la busqueda tambien. No es una forma
   distinta de ordenar: es el mismo `filtrarYRenderizarReparaciones()` de
   siempre, clave por clave, y abajo se explica como se tradujo cada regla.

   El orden devuelto (cada regla sale del comparador de `reparaciones.js`):
     1. Cerrados ('Entregado','Cancelado') al final, siempre.
     2. Entre dos cerrados: el de `fecha_inicio` mas reciente primero.
     3. Entre dos activos: los que llevan 14 dias o mas esperando, primero.
     4. Entre dos activos: 'Pendiente' antes que cualquier otro estado activo.
     5. Entre dos activos con la misma prioridad: el mas antiguo primero.

   El desempate final por `id DESC` no estaba en el comparador de JavaScript
   (que en la practica es estable y conservaba el orden de MySQL, `id DESC`).
   Se pone aca porque dos paginas tienen que ser reproducibles: el mismo
   `?page=2` tiene que devolver siempre las mismas 20 filas, y sin un desempate
   total un ORDER BY con empate puede partir el conjunto en cualquier momento.
   ========================================================================== */

/**
 * Los campos por los que buscaba el buscador del navegador, en el mismo orden.
 * La busqueda pasa a ser del servidor, asi que la lista tiene que coincidir
 * campo por campo con la de antes o el usuario va a "perder" resultados que
 * antes encontraba.
 */
const COLUMNAS_BUSQUEDA_REPARACIONES = [
    'cliente_nombre',
    'cliente_telefono',
    'direccion',
    'equipo',
    'falla_declarada',
    'notas_servicio',
    'diagnostico_tecnico',
    'repuestos_usados'
];

/**
 * Escapa los comodines de LIKE para que un `%` o un `_` que escriba el usuario
 * se busquen como texto y no como comodin. Sin esto, buscar "%" devuelve la
 * tabla entera.
 */
function escaparLike(texto) {
    return texto.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Lee un entero positivo de la query. Devuelve `defecto` si no sirve. */
function enteroPositivo(valor, defecto, tope) {
    if (valor === undefined || valor === '') return defecto;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1) return null;
    return tope ? Math.min(n, tope) : n;
}

app.get('/api/reparaciones', verificarToken, requiereModulo('reparaciones'), async (req, res) => {
    // El limite tiene tope a proposito. `?limit=999999` tiene que devolver lo
    // mismo que sin paginacion, y si lo permitimos la ruta sigue siendo un
    // `SELECT *` con un parametro de adorno.
    const pagina = enteroPositivo(req.query.page, 1);
    const limite = enteroPositivo(req.query.limit, 20, 200);
    if (pagina === null || limite === null) {
        return res.status(400).json({ error: 'Los parametros page y limit tienen que ser enteros positivos.' });
    }

    const ESTADOS_VALIDOS = ['Pendiente', 'En Reparacion', 'Esperando Repuesto', 'Listo', 'Entregado', 'Cancelado'];
    const estado = req.query.estado ? String(req.query.estado) : 'TODOS';
    if (estado !== 'TODOS' && !ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({ error: 'Estado desconocido.' });
    }

    const buscar = String(req.query.buscar || '').trim();
    const patron = `%${escaparLike(buscar)}%`;

    const condiciones = [];
    const valores = [];

    if (estado !== 'TODOS') {
        condiciones.push('estado = ?');
        valores.push(estado);
    }

    if (buscar !== '') {
        const busquedas = COLUMNAS_BUSQUEDA_REPARACIONES.map((col) => `${col} LIKE ? ESCAPE '\\\\'`);
        // `CAST(id AS CHAR)` reemplaza el `String(r.id).includes(term)` del
        // navegador: buscar "7" tiene que encontrar tambien la orden #7.
        busquedas.push(`CAST(id AS CHAR) LIKE ? ESCAPE '\\\\'`);
        condiciones.push(`(${busquedas.join(' OR ')})`);
        // Un patron por condicion: el placeholder tiene que coincidir con el
        // orden de los `?`, y el orden de los `?` es el de `busquedas`.
        valores.push(...busquedas.map(() => patron));
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    // El `NOW()` del ORDER BY y el del COUNT son del mismo recorrido, pero se
    // pide el COUNT primero para que el total no cambie a mitad de la respuesta.
    const ordenSql = `
        ORDER BY
            CASE WHEN estado IN ('Entregado', 'Cancelado') THEN 1 ELSE 0 END ASC,
            CASE WHEN estado IN ('Entregado', 'Cancelado') THEN fecha_inicio END DESC,
            CASE
                WHEN estado NOT IN ('Entregado', 'Cancelado')
                 AND fecha_inicio <= DATE_SUB(NOW(), INTERVAL 14 DAY)
                THEN 0 ELSE 1
            END ASC,
            CASE WHEN estado = 'Pendiente' THEN 0 ELSE 1 END ASC,
            CASE WHEN estado NOT IN ('Entregado', 'Cancelado') THEN fecha_inicio END ASC,
            id DESC
    `;

    try {
        const conteo = await db.promise().query(
            `SELECT COUNT(*) AS total FROM reparaciones ${where}`,
            valores
        );
        const total = Number(conteo[0][0].total) || 0;
        const totalPaginas = Math.max(1, Math.ceil(total / limite));

        const offset = (pagina - 1) * limite;
        const [filas] = await db.promise().query(
            `SELECT * FROM reparaciones ${where} ${ordenSql} LIMIT ? OFFSET ?`,
            [...valores, limite, offset]
        );

        res.json({
            reparaciones: filas,
            total,
            pagina,
            totalPaginas,
            limite
        });
    } catch (err) {
        console.error('Error al obtener reparaciones:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/reparaciones', verificarToken, requiereModulo('reparaciones'), requiereAdmin, async (req, res) => {
    const validacion = validarReparacion(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const {
        cliente_nombre, cliente_telefono, direccion, tipo_cobertura, equipo,
        falla_declarada, diagnostico_tecnico, notas_servicio, repuestos_detalle,
        costo_mano_obra, costo_repuestos, estado, tecnico_asignado
    } = validacion.datos;

    const total = costo_mano_obra + costo_repuestos;
    const repuestosResumen = repuestos_detalle.map(r => `${r.nombre} (x${r.cantidad})`).join(', ') || 'Ninguno';

    try {
        const clienteId = await resolverOCrearCliente(cliente_nombre, cliente_telefono, direccion);

        const sql = `
            INSERT INTO reparaciones 
            (cliente_id, cliente_nombre, cliente_telefono, direccion, tipo_cobertura, equipo, falla_declarada, 
             diagnostico_tecnico, notas_servicio, repuestos_usados, repuestos_detalle, costo_mano_obra, costo_repuestos, 
             total, estado, tecnico_asignado, fecha_inicio, fecha_modificacion) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;

        const [result] = await db.promise().query(sql, [
            clienteId, cliente_nombre, cliente_telefono, direccion, tipo_cobertura,
            equipo, falla_declarada, diagnostico_tecnico, notas_servicio, repuestosResumen,
            JSON.stringify(repuestos_detalle), costo_mano_obra, costo_repuestos, total, estado, tecnico_asignado
        ]);

        res.status(201).json({ mensaje: 'Orden creada', id: result.insertId });
    } catch (err) {
        console.error('Error al registrar reparación:', err);
        res.status(500).json({ error: 'No se pudo guardar la orden' });
    }
});

app.put('/api/reparaciones/:id', verificarToken, requiereModulo('reparaciones'), requiereAdmin, async (req, res) => {
    const { id } = req.params;

    const validacion = validarReparacion(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const {
        cliente_nombre, cliente_telefono, direccion, tipo_cobertura, equipo,
        falla_declarada, diagnostico_tecnico, notas_servicio, repuestos_detalle,
        costo_mano_obra, costo_repuestos, estado, tecnico_asignado
    } = validacion.datos;

    const total = costo_mano_obra + costo_repuestos;
    const repuestosResumen = repuestos_detalle.length > 0
        ? repuestos_detalle.map(r => `${r.nombre} (x${r.cantidad})`).join(', ')
        : 'Ninguno';

    try {
        const [ordenes] = await db.promise().query('SELECT * FROM reparaciones WHERE id = ?', [id]);
        if (ordenes.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });

        const ordenActual = ordenes[0];

        let repuestosPrevios = [];
        try {
            repuestosPrevios = typeof ordenActual.repuestos_detalle === 'string'
                ? JSON.parse(ordenActual.repuestos_detalle)
                : (ordenActual.repuestos_detalle || []);
        } catch (e) { repuestosPrevios = []; }

        const antesNoTeniaRepuestos = repuestosPrevios.length === 0;
        let debeMarcarDescontado = ordenActual.stock_descontado === 1;

        if (estado === 'Entregado' && (ordenActual.stock_descontado === 0 || antesNoTeniaRepuestos) && repuestos_detalle.length > 0) {
            await descontarStockPorReparacion(id, equipo, tecnico_asignado, repuestos_detalle);
            debeMarcarDescontado = true;
        }

        const clienteId = await resolverOCrearCliente(cliente_nombre, cliente_telefono, direccion);

        const sql = `
            UPDATE reparaciones 
            SET cliente_id = ?, cliente_nombre = ?, cliente_telefono = ?, direccion = ?, tipo_cobertura = ?, 
                equipo = ?, falla_declarada = ?, diagnostico_tecnico = ?, notas_servicio = ?, repuestos_usados = ?, 
                repuestos_detalle = ?, costo_mano_obra = ?, costo_repuestos = ?, total = ?, 
                estado = ?, tecnico_asignado = ?, stock_descontado = ?, fecha_modificacion = NOW()
            WHERE id = ?
        `;

        await db.promise().query(sql, [
            clienteId, cliente_nombre, cliente_telefono, direccion, tipo_cobertura, equipo, falla_declarada,
            diagnostico_tecnico, notas_servicio, repuestosResumen, JSON.stringify(repuestos_detalle), costo_mano_obra, costo_repuestos,
            total, estado, tecnico_asignado, debeMarcarDescontado ? 1 : 0, id
        ]);

        res.json({ mensaje: 'Orden y stock actualizados correctamente' });

    } catch (err) {
        console.error('Error al modificar reparación:', err);
        res.status(500).json({ error: 'Error al actualizar la orden' });
    }
});

app.put('/api/reparaciones/:id/estado', verificarToken, requiereModulo('reparaciones'), requiereAdmin, async (req, res) => {
    const { id } = req.params;
    const ESTADOS_VALIDOS = ['Pendiente', 'En Reparacion', 'Esperando Repuesto', 'Listo', 'Entregado', 'Cancelado'];
    const { estado } = req.body;

    if (!ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }

    try {
        const [ordenes] = await db.promise().query('SELECT * FROM reparaciones WHERE id = ?', [id]);
        if (ordenes.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        const orden = ordenes[0];
        let debeDescontar = false;

        if (estado === 'Entregado' && orden.stock_descontado === 0) {
            debeDescontar = true;
            let items = [];
            try {
                items = typeof orden.repuestos_detalle === 'string'
                    ? JSON.parse(orden.repuestos_detalle)
                    : (orden.repuestos_detalle || []);
            } catch (e) { items = []; }

            await descontarStockPorReparacion(id, orden.equipo, orden.tecnico_asignado, items);
        }

        let updateSql = 'UPDATE reparaciones SET estado = ?, fecha_modificacion = NOW()';
        const updateParams = [estado];

        if (estado === 'Entregado') updateSql += ', fecha_entrega = NOW()';
        if (debeDescontar) updateSql += ', stock_descontado = 1';
        
        updateSql += ' WHERE id = ?';
        updateParams.push(id);

        await db.promise().query(updateSql, updateParams);
        res.json({ mensaje: 'Estado actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar estado:', error);
        res.status(500).json({ error: 'Error interno al actualizar estado' });
    }
});

app.delete('/api/reparaciones/:id', verificarToken, requiereModulo('reparaciones'), requiereAdmin, (req, res) => {
    const { id } = req.params;

    const sql = 'DELETE FROM reparaciones WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error('Error al eliminar reparación:', err);
            return res.status(500).json({ error: 'Error al eliminar la orden de trabajo' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        res.json({ mensaje: 'Orden de servicio eliminada correctamente' });
    });
});

/* ==========================================================================
   13. PRESUPUESTOS  (modulo vendible `presupuestos`)
   --------------------------------------------------------------------------
   Un presupuesto es un documento comercial, no "un pedido todavia no
   pasado". Por eso tiene numero correlativo, estado propio, fecha de validez
   y una copia de los datos del cliente en el momento de emitirlo.

   LAS REGLAS QUE IMPORTAN

   El total NUNCA se recibe del cliente. Se recalcula aca desde los items. Si
   viniera en el body, cualquiera que tocara el request podria congelar el
   precio. Lo unico que se acepta del usuario es el descuento, y se valida
   contra el subtotal.

   Una vez APROBADO o RECHAZADO el documento se cierra: no se edita ni se
   borra. Para volver a tocarlo hay que devolverlo a BORRADOR, que es un
   cambio de estado explícito y queda en el historial. Asi un presupuesto
   aprobado es un presupuesto aprobado, no uno que alguien modifico despues.

   QUIEN PUEDE QUE
     leer            los dos roles
     crear y editar  los dos roles  (presupostar es trabajo del tecnico)
     aprobar/rechazar  solo ADMIN    (es una decision comercial)
     borrar          solo ADMIN, y solo si esta en BORRADOR

   Esto difiere a proposito del stock, que es administracion y va solo para
   ADMIN. Un modulo que el tecnico no puede usar no sirve para nada.
   ========================================================================== */

/** Redondeo a 2 decimales. Plata que se suma en float se pierde. */
const a2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Estados en los que el documento todavia se puede tocar. */
const PRESUPUESTO_EDITABLE = ['BORRADOR', 'ENVIADO'];

/**
 * Correlativo de empresa. El INSERT ... ON DUPLICATE KEY UPDATE toma un
 * cerrojo exclusivo sobre la fila en InnoDB, asi que dos presupuestos
 * simultaneos no pueden sacar el mismo numero. Probado con 30 a la vez.
 *
 * Recibe el `query` con promesas de la transaccion, no la conexion cruda: la
 * conexion de mysql2 sin `mysql2/promise` no devuelve promesas y `await` sobre
 * ella no hace nada.
 *
 * El nombre de la correlativa va como parametro y no escrito en el cuerpo: cada
 * documento que numerar (presupuesto, factura) usa su propia fila de
 * `secuencias`, asi que los dos numeros avanzan por separado y ninguno pisa al
 * otro. La fila se crea sola en el primer uso.
 */
async function siguienteNumero(query, nombre = 'presupuesto') {
    await query(
        `INSERT INTO \`secuencias\` (nombre, ultimo) VALUES (?, 1)
           ON DUPLICATE KEY UPDATE ultimo = ultimo + 1`,
        [nombre]
    );
    const [filas] = await query(
        'SELECT ultimo FROM `secuencias` WHERE nombre = ?',
        [nombre]
    );
    return filas[0].ultimo;
}

/**
 * Dice si un string es una fecha que existe de verdad, en AAAA-MM-DD.
 *
 * El regex solo alcanza para el formato. Date.parse('2026-02-31') NO es NaN:
 * JavaScript lo pasa al 3 de marzo sin avisar, y MySQL despues lo rechaza con
 * un error de columna. Con solo el regex, una fecha imposible llegaba hasta el
 * INSERT y el POST terminaba en un 500 sin mensaje útil, cuando lo correcto es
 * un 400 que le diga al usuario qué escribir.
 *
 * Se arman los componentes en UTC con setUTCFullYear y no con Date.UTC porque
 * Date.UTC interpreta los años de dos dígitos como 19xx, y "0099" tiene que
 * seguir siendo el año 99.
 */
function fechaReal(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    const [anio, mes, dia] = valor.split('-').map(Number);
    const f = new Date(0);
    f.setUTCHours(0, 0, 0, 0);
    f.setUTCFullYear(anio, mes - 1, dia);

    // Si la fecha no existia, el constructor la acomoda al mes siguiente (el
    // 31 de febrero se vuelve 3 de marzo) y los tres numeros no coinciden.
    return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

/**
 * Valida y calcula un presupuesto. Devuelve los items ya con subtotal, el
 * subtotal, el descuento y el total. Si algo no cierra, no hay siguiente paso.
 */
function prepararPresupuesto(body) {
    const errores = [];
    const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());

    const cliente_nombre = texto(body.cliente_nombre).slice(0, 150);
    if (!cliente_nombre) errores.push('El nombre del cliente es obligatorio.');

    const cliente_id = body.cliente_id ? Number(body.cliente_id) : null;
    if (cliente_id !== null && !Number.isInteger(cliente_id)) {
        errores.push('El cliente no es válido.');
    }

    const bruto = Array.isArray(body.items) ? body.items : [];
    if (bruto.length === 0) errores.push('El presupuesto tiene que tener al menos un ítem.');
    if (bruto.length > 200) errores.push('Un presupuesto no puede tener más de 200 ítems.');

    const items = bruto.map((it, i) => {
        const descripcion = texto(it.descripcion).slice(0, 200);
        const cantidad = Number(it.cantidad);
        const precio_unitario = a2(it.precio_unitario);
        const producto_id = it.producto_id ? Number(it.producto_id) : null;
        const n = i + 1;

        if (!descripcion) errores.push(`El ítem ${n} necesita una descripción.`);
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
            errores.push(`La cantidad del ítem ${n} tiene que ser un número mayor que 0.`);
        }
        if (cantidad > 100000) errores.push(`La cantidad del ítem ${n} es absurda.`);
        if (!Number.isFinite(precio_unitario) || precio_unitario < 0) {
            errores.push(`El precio del ítem ${n} tiene que ser un número mayor o igual a 0.`);
        }
        if (producto_id !== null && !Number.isInteger(producto_id)) {
            errores.push(`El producto del ítem ${n} no es válido.`);
        }

        return {
            descripcion,
            cantidad: Number.isFinite(cantidad) ? cantidad : 1,
            precio_unitario: Number.isFinite(precio_unitario) ? precio_unitario : 0,
            producto_id,
            orden: i,
            subtotal: a2((Number.isFinite(cantidad) ? cantidad : 0) * (Number.isFinite(precio_unitario) ? precio_unitario : 0))
        };
    });

    const subtotal = a2(items.reduce((acc, it) => acc + it.subtotal, 0));

    // Sin descuento es 0, no NaN. Si se hiciera directo a a2(body.descuento) y el
    // campo no viene, Number(undefined) es NaN, el chequeo de "mayor o igual a
    // 0" lo rechaza, y ningun presupuesto se puede crear sin descuento.
    const descuentoViene = body.descuento;
    const descuento = a2(
        descuentoViene === undefined || descuentoViene === null || descuentoViene === '' ? 0 : descuentoViene
    );
    if (!Number.isFinite(descuento) || descuento < 0) {
        errores.push('El descuento tiene que ser un número mayor o igual a 0.');
    } else if (descuento > subtotal) {
        errores.push('El descuento no puede ser mayor que el subtotal.');
    }

    // valido_hasta: se acepta solo como AAAA-MM-DD, y tiene que ser una fecha
    // que exista. MySQL es permisivo con las fechas y aceptaria "ayer"; aca se
    // rechaza para que la oferta no expire en una fecha que el usuario nunca
    // escribio, y tampoco en el 31 de febrero.
    let valido_hasta = texto(body.valido_hasta) || null;
    if (valido_hasta && !fechaReal(valido_hasta)) {
        errores.push('La fecha de validez no es una fecha valida (AAAA-MM-DD).');
    }

    if (errores.length) return { valido: false, error: errores[0], errores };

    return {
        valido: true,
        datos: {
            cliente_id,
            cliente_nombre,
            cliente_doc: texto(body.cliente_doc).slice(0, 30) || null,
            cliente_telefono: texto(body.cliente_telefono).slice(0, 40) || null,
            cliente_email: texto(body.cliente_email).slice(0, 150) || null,
            cliente_direccion: texto(body.cliente_direccion).slice(0, 200) || null,
            notas: texto(body.notas).slice(0, 2000) || null,
            valido_hasta,
            descuento: descuento || 0,
            subtotal,
            total: a2(subtotal - (descuento || 0)),
            items
        }
    };
}

/** Lo que se guarda en el log cuando un presupuesto cambia de estado. */
const ETIQUETA_ESTADO = {
    BORRADOR: 'borrador',
    ENVIADO: 'enviado al cliente',
    APROBADO: 'aprobado',
    RECHAZADO: 'rechazado'
};

// --- Listado ----------------------------------------------------------------
app.get('/api/presupuestos', verificarToken, requiereModulo('presupuestos'), async (req, res) => {
    try {
        const condiciones = [];
        const valores = [];

        if (req.query.estado) {
            const estados = String(req.query.estado).split(',').map((e) => e.trim().toUpperCase());
            const validos = estados.filter((e) => ETIQUETA_ESTADO[e]);
            if (validos.length) {
                condiciones.push(`estado IN (${validos.map(() => '?').join(',')})`);
                valores.push(...validos);
            }
        }
        if (req.query.cliente_id) {
            condiciones.push('cliente_id = ?');
            valores.push(Number(req.query.cliente_id) || 0);
        }
        if (req.query.q) {
            condiciones.push('(cliente_nombre LIKE ? OR numero LIKE ? OR cliente_doc LIKE ?)');
            const q = `%${String(req.query.q).trim().slice(0, 60)}%`;
            valores.push(q, q, q);
        }

        const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
        const [filas] = await db.promise().query(
            `SELECT id, numero, cliente_id, cliente_nombre, cliente_doc, estado,
                    subtotal, descuento, total, valido_hasta, usuario_nombre, creado_en
               FROM presupuestos
               ${donde}
              ORDER BY numero DESC
              LIMIT 300`,
            valores
        );

        res.json(filas);
    } catch (err) {
        console.error('Error al listar presupuestos:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Detalle ----------------------------------------------------------------
app.get('/api/presupuestos/:id', verificarToken, requiereModulo('presupuestos'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Presupuesto inválido' });

    try {
        const [p] = await db.promise().query(
            `SELECT * FROM presupuestos WHERE id = ?`,
            [id]
        );
        if (!p.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });

        const [items] = await db.promise().query(
            `SELECT id, producto_id, descripcion, cantidad, precio_unitario, subtotal, orden
               FROM presupuesto_items WHERE presupuesto_id = ? ORDER BY orden, id`,
            [id]
        );

        res.json({ ...p[0], items });
    } catch (err) {
        console.error('Error al obtener presupuesto:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/**
 * El comprobante: presupuesto + items + los datos de la empresa con los que se
 * imprime. Todo en una respuesta, para que la hoja de impresion no dependa de
 * mezclar dos fuentes ni de lo que quedara guardado en el navegador.
 */
app.get('/api/presupuestos/:id/comprobante', verificarToken, requiereModulo('presupuestos'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Presupuesto inválido' });

    try {
        const [p] = await db.promise().query('SELECT * FROM presupuestos WHERE id = ?', [id]);
        if (!p.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });

        const [items] = await db.promise().query(
            `SELECT descripcion, cantidad, precio_unitario, subtotal
               FROM presupuesto_items WHERE presupuesto_id = ? ORDER BY orden, id`,
            [id]
        );

        const e = req.empresa;
        res.json({
            presupuesto: p[0],
            items,
            empresa: datosDeMarca(e),
            // Para el pie del comprobante, sin exponer datos del usuario.
            emitido_por: p[0].usuario_nombre
        });
    } catch (err) {
        console.error('Error al armar el comprobante:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Alta -------------------------------------------------------------------
app.post('/api/presupuestos', verificarToken, requiereModulo('presupuestos'), async (req, res) => {
    const prep = prepararPresupuesto(req.body);
    if (!prep.valido) return res.status(400).json({ error: prep.error, errores: prep.errores });

    const d = prep.datos;
    try {
        const resultado = await tenant.transaccion(async ({ query }) => {
            const numero = await siguienteNumero(query);
            const [r] = await query(
                `INSERT INTO presupuestos
                    (numero, cliente_id, cliente_nombre, cliente_doc, cliente_telefono,
                     cliente_email, cliente_direccion, subtotal, descuento, total,
                     notas, valido_hasta, usuario_nombre)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [numero, d.cliente_id, d.cliente_nombre, d.cliente_doc, d.cliente_telefono,
                    d.cliente_email, d.cliente_direccion, d.subtotal, d.descuento, d.total,
                    d.notas, d.valido_hasta, req.usuario.nombre]
            );
            const presupuestoId = r.insertId;
            const valoresItems = d.items.map((it) => [
                presupuestoId, it.producto_id, it.descripcion, it.cantidad, it.precio_unitario, it.subtotal, it.orden
            ]);
            if (valoresItems.length) {
                await query(
                    `INSERT INTO presupuesto_items
                        (presupuesto_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, orden)
                     VALUES ?`,
                    [valoresItems]
                );
            }
            return { presupuestoId, numero };
        });

        res.status(201).json({ mensaje: 'Presupuesto creado', id: resultado.presupuestoId, numero: resultado.numero, total: d.total });
    } catch (err) {
        console.error('Error al crear presupuesto:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Modificación -----------------------------------------------------------
app.put('/api/presupuestos/:id', verificarToken, requiereModulo('presupuestos'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Presupuesto inválido' });

    const prep = prepararPresupuesto(req.body);
    if (!prep.valido) return res.status(400).json({ error: prep.error, errores: prep.errores });
    const d = prep.datos;

    try {
        await tenant.transaccion(async ({ query }) => {
            const [actual] = await query('SELECT estado FROM presupuestos WHERE id = ?', [id]);
            if (!actual.length) {
                const e = new Error('Presupuesto no encontrado');
                e.estadoHttp = 404;
                throw e;
            }
            if (!PRESUPUESTO_EDITABLE.includes(actual[0].estado)) {
                const e = new Error(`Un presupuesto ${ETIQUETA_ESTADO[actual[0].estado]} no se puede modificar. Pasalo a BORRADOR primero si necesitás cambiarlo.`);
                e.estadoHttp = 400;
                throw e;
            }

            await query(
                `UPDATE presupuestos
                    SET cliente_id = ?, cliente_nombre = ?, cliente_doc = ?, cliente_telefono = ?,
                        cliente_email = ?, cliente_direccion = ?, subtotal = ?, descuento = ?, total = ?,
                        notas = ?, valido_hasta = ?
                  WHERE id = ?`,
                [d.cliente_id, d.cliente_nombre, d.cliente_doc, d.cliente_telefono, d.cliente_email,
                    d.cliente_direccion, d.subtotal, d.descuento, d.total, d.notas, d.valido_hasta, id]
            );

            await query('DELETE FROM presupuesto_items WHERE presupuesto_id = ?', [id]);
            const valoresItems = d.items.map((it) => [
                id, it.producto_id, it.descripcion, it.cantidad, it.precio_unitario, it.subtotal, it.orden
            ]);
            if (valoresItems.length) {
                await query(
                    `INSERT INTO presupuesto_items
                        (presupuesto_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, orden)
                     VALUES ?`,
                    [valoresItems]
                );
            }
        });

        res.json({ mensaje: 'Presupuesto actualizado', id, total: d.total });
    } catch (err) {
        console.error('Error al actualizar presupuesto:', err);
        const status = err.estadoHttp || 500;
        res.status(status).json({ error: err.message || 'Error interno del servidor' });
    }
});

// --- Cambio de estado -------------------------------------------------------
app.put('/api/presupuestos/:id/estado', verificarToken, requiereModulo('presupuestos'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Presupuesto inválido' });

    const estado = String(req.body.estado || '').trim().toUpperCase();
    if (!ETIQUETA_ESTADO[estado]) {
        return res.status(400).json({ error: 'Estado inválido. Vale: BORRADOR, ENVIADO, APROBADO o RECHAZADO.' });
    }

    // Aprobar o rechazar es una decision comercial, no carga de datos: por eso
    // es solo para ADMIN, mientras que preparar el documento es de cualquiera.
    if ((estado === 'APROBADO' || estado === 'RECHAZADO') && req.usuario.rol !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo un administrador puede aprobar o rechazar un presupuesto.' });
    }

    try {
        const [actual] = await db.promise().query('SELECT estado FROM presupuestos WHERE id = ?', [id]);
        if (!actual.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });

        if (actual[0].estado === estado) {
            return res.json({ mensaje: `Ya estaba ${ETIQUETA_ESTADO[estado]}.`, estado });
        }

        await db.query('UPDATE presupuestos SET estado = ? WHERE id = ?', [estado, id]);
        console.log(`  Presupuesto #${id}: ${ETIQUETA_ESTADO[actual[0].estado]} -> ${ETIQUETA_ESTADO[estado]} (${req.usuario.nombre})`);
        res.json({ mensaje: `Presupuesto ${ETIQUETA_ESTADO[estado]}.`, estado });
    } catch (err) {
        console.error('Error al cambiar el estado del presupuesto:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Baja -------------------------------------------------------------------
app.delete('/api/presupuestos/:id', verificarToken, requiereModulo('presupuestos'), requiereAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Presupuesto inválido' });

    try {
        const [actual] = await db.promise().query('SELECT numero, estado FROM presupuestos WHERE id = ?', [id]);
        if (!actual.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });

        // Borrar un presupuesto ya emitido no se permite: el correlativo tiene
        // que seguir siendo correlativo, y un numero nunca se reutiliza.
        if (actual[0].estado !== 'BORRADOR') {
            return res.status(400).json({
                error: `Solo se borran presupuestos en BORRADOR. Este está ${ETIQUETA_ESTADO[actual[0].estado]}: pasalo a BORRADOR si de verdad querés deshacerlo.`
            });
        }

        // Los items se van por ON DELETE CASCADE.
        await db.query('DELETE FROM presupuestos WHERE id = ?', [id]);
        console.log(`  Presupuesto #${actual[0].numero} eliminado (${req.usuario.nombre})`);
        res.json({ mensaje: 'Presupuesto eliminado' });
    } catch (err) {
        console.error('Error al eliminar presupuesto:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/* ==========================================================================
   13.1 FACTURACIÓN INTERNA  (modulo vendible `facturacion`)
   --------------------------------------------------------------------------
   ESTO NO ES FACTURACIÓN ELECTRÓNICA. Y la diferencia no es de marketing:
   lo que sale de acá es un comprobante interno con numeración correlativa por
   empresa. No se emite ante ARCA/AFIP, no tiene CAI ni punto de venta, y por
   lo tanto NO SIRVE como comprobante fiscal. La facturación electrónica es otra
   etapa, con sus propias credenciales y sus plazos. Está escrito acá para que
   nadie lo confunda después.

   Por qué el número se saca AL EMITIR y no al crear el borrador
   ------------------------------------------------------------------
   El número de un documento identifica ese documento. Si el borrador lo tuviera,
   cada borrador que nunca se emite quemaría un número y dejaría un hueco en la
   correlativa — y en una numeración, un hueco es un número que alguien puede
   estar usando y no se sabe de qué. Por eso `facturas.numero` es NULL mientras
   el documento es borrador. `UNIQUE` sigue garantizando que dos facturas
   emitidas no compartan número: MySQL admite varios NULL en un índice UNIQUE.

   Por qué el IVA es POR RENGLÓN
   ------------------------------------------------------------------
   En Argentina la alícuota depende del tipo de cosa, y en un taller conviven
   repuestos y mano de obra con alícuotas distintas. Poner un 21% único para
   toda la factura estaría mal en cuanto se mezclen. Por eso cada renglón trae
   el suyo, y el total es la suma de los IVA de cada renglón.

   Las alícuotas admitidas son 0, 10.50 y 21.00, y no "cualquier número entre 0
   y 100". Aceptar cualquier valor parece más flexible y en la práctica es un
   error esperando: alguien escribe 21,5 o 0.21 y la factura sale con el IVA
   callado. Tres valores, uno de cada clase, es lo que Argentina tiene.

   Por qué la plata es DECIMAL y la aritmética es de enteros de centavo
   ------------------------------------------------------------------
   0.1 + 0.2 = 0.30000000000000004 en IEEE-754, y una factura que no cuadra es
   una factura que nadie firma. Los importes son DECIMAL(12,2) en MySQL y en JS
   se redondean a dos decimales con `a2()` en cada paso, nunca se acumula el
   error. La fórmula es una sola y está escrita en la migración y acá:

       total = subtotal - descuento + iva_monto

   `subtotal` es BRUTO (Σ cantidad × precio, sin descontar) y `descuento` es la
   suma de los descuentos por renglón. Igual que en presupuestos.

   Por qué el descuento de stock es TODO O NADA
   ------------------------------------------------------------------
   Emitir descuenta stock, y una factura a medio descontar es peor que no
   emitir: el depósito queda mal y no hay forma de saber cuánto. Así que antes
   de tocar un solo producto se verifica TODOS los renglones, y si a uno le
   falta stock no se emite nada y se dice cuál. Todo adentro de una transacción:
   o salen el número, el estado y todos los movimientos, o no sale nada.

   Y `stock_descontado` es lo que impide que el descuento pase dos veces: si se
   reintenta la emisión de una factura ya emitida, no vuelve a descontar.

   Por qué el stock se controla en unidades enteras
   ------------------------------------------------------------------
   `productos.stock` es INT y `movimientos_stock.cantidad_afectada` también. Un
   renglón puede llevar cantidad fraccionaria (1,5 h de mano de obra, que es
   normal), pero si además está atado a un producto, esa cantidad no se puede
   escribir en el depósito. Redondear en silencio convertiría una venta de 2,5
   en una venta de 2 sin que nadie se entere, que es exactamente el tipo de
   error de inventario que después nadie puede reconstruir. Por eso la emisión
   RECHAZA un renglón con producto y cantidad fraccionaria, y el mensaje dice
   qué hacer.

   Quién puede qué
   ------------------------------------------------------------------
      ver / crear / editar borrador   cualquiera con el módulo
      editar                          solo mientras sea BORRADOR
      borrar                          solo ADMIN, y solo BORRADOR
      emitir / anular                 solo ADMIN  (son decisiones de negocio)
      marcar pagada                   cualquiera con el módulo

   Una factura EMITIDA no se edita ni se borra, nunca: conserva el número para
   siempre. Si hay que corregirla se anula y se emite otra, que es lo que pasa
   con cualquier documento que ya salió del taller. Lo mismo que en presupuestos,
   donde solo se borra en BORRADOR para que la correlativa siga siendo
   correlativa.
   ========================================================================== */

/** Los cuatro estados de una factura. El ENUM de MySQL tiene los mismos. */
const ESTADO_FACTURA = {
    BORRADOR: 'borrador',
    EMITIDA: 'emitida',
    PAGADA: 'pagada',
    ANULADA: 'anulada'
};

/**
 * Alícuotas que Argentina usa para esto. Son tres, no un rango: cada una es
 * una categoría de mercadería distinta, y el número tiene que ser UNO de estos
 * tres o la factura está mal.
 */
const ALICUOTAS_IVA = [0, 10.5, 21];

/**
 * Valida y calcula una factura. Devuelve los renglones ya con su subtotal, y los
 * cuatro importes de la cabecera. Si algo no cierra, no hay siguiente paso.
 *
 * Devuelve TODOS los errores juntos, no solo el primero: si una factura de 12
 * renglones tiene tres con la IVA mal, el usuario quiere ver los tres y no
 * arreglar uno, volver, ver el siguiente error, y arreglar otro.
 */
function prepararFactura(body) {
    const errores = [];
    const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());

    const cliente_nombre = texto(body.cliente_nombre).slice(0, 200);
    if (!cliente_nombre) errores.push('El nombre del cliente es obligatorio.');

    const cliente_id = body.cliente_id ? Number(body.cliente_id) : null;
    if (cliente_id !== null && !Number.isInteger(cliente_id)) {
        errores.push('El cliente no es válido.');
    }

    // La fecha de emisión no puede ser una fecha que no existe (31 de febrero
    // entra por el regex y MySQL la rechaza con un error de columna) ni una de
    // acá que no llegó todavía, que en un comprobante es un documento fechado
    // en el futuro.
    let fecha = texto(body.fecha).slice(0, 10);
    if (!fecha) {
        fecha = new Date().toISOString().slice(0, 10);
    } else if (!fechaReal(fecha)) {
        errores.push('La fecha no es una fecha válida (AAAA-MM-DD).');
    }

    const bruto = Array.isArray(body.items) ? body.items : [];
    if (bruto.length === 0) errores.push('La factura tiene que tener al menos un ítem.');
    if (bruto.length > 200) errores.push('Una factura no puede tener más de 200 ítems.');

    let subtotal = 0;
    let descuento = 0;
    let iva_monto = 0;

    const items = bruto.map((it, i) => {
        const descripcion = texto(it.descripcion).slice(0, 200);
        const cantidad = Number(it.cantidad);
        const precio_unitario = a2(it.precio_unitario);
        const descuentoItem = a2(it.descuento);
        const producto_id = it.producto_id ? Number(it.producto_id) : null;
        const iva_porcentaje = Number(it.iva_porcentaje);
        const n = i + 1;

        if (!descripcion) errores.push(`El ítem ${n} necesita una descripción.`);
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
            errores.push(`La cantidad del ítem ${n} tiene que ser un número mayor que 0.`);
        }
        if (cantidad > 100000) errores.push(`La cantidad del ítem ${n} es absurda.`);

        if (!Number.isFinite(precio_unitario) || precio_unitario < 0) {
            errores.push(`El precio del ítem ${n} tiene que ser un número mayor o igual a 0.`);
        }
        if (!Number.isFinite(descuentoItem) || descuentoItem < 0) {
            errores.push(`El descuento del ítem ${n} tiene que ser un número mayor o igual a 0.`);
        }
        if (producto_id !== null && !Number.isInteger(producto_id)) {
            errores.push(`El producto del ítem ${n} no es válido.`);
        }

        // La alícuota tiene que ser UNA de las tres, no "parecida a una".
        // Comparar con `includes` y no con un rango: 20.9 casi es 21, y casi
        // no sirve para una factura.
        if (!Number.isFinite(iva_porcentaje) || !ALICUOTAS_IVA.includes(iva_porcentaje)) {
            errores.push(
                `El IVA del ítem ${n} tiene que ser ${ALICUOTAS_IVA.join(', ')} ` +
                '(uno de esos tres, en punto).'
            );
        }

        const cant = Number.isFinite(cantidad) ? cantidad : 0;
        const prec = Number.isFinite(precio_unitario) ? precio_unitario : 0;
        const desc = Number.isFinite(descuentoItem) ? descuentoItem : 0;

        const brutoItem = a2(cant * prec);

        // Un descuento mayor que el propio renglón daría una factura con
        // renglones negativos y un total que no es el importe que hay que cobrar.
        if (desc > brutoItem) {
            errores.push(
                `El descuento del ítem ${n} (${desc}) es mayor que su propio importe (${brutoItem}).`
            );
        }

        const neto = a2(brutoItem - desc);
        const alicuota = ALICUOTAS_IVA.includes(iva_porcentaje) ? iva_porcentaje : 0;
        const ivaItem = a2(neto * alicuota / 100);

        subtotal = a2(subtotal + brutoItem);
        descuento = a2(descuento + desc);
        iva_monto = a2(iva_monto + ivaItem);

        return {
            descripcion,
            cantidad: cant,
            precio_unitario: prec,
            descuento: desc,
            iva_porcentaje: alicuota,
            producto_id,
            orden: i,
            subtotal: brutoItem,
            iva_monto: ivaItem
        };
    });

    // El total se arma con la misma fórmula de la migración. Que esté escrita
    // en los dos lugares es a propósito: son dos sistemas distintos —el que
    // calcula y el que documenta— y el verificador compara las dos para que si
    // mañana cambia una, avise que la otra quedó vieja.
    const total = a2(subtotal - descuento + iva_monto);

    if (errores.length) return { valido: false, error: errores[0], errores };

    return {
        valido: true,
        datos: {
            cliente_id,
            cliente_nombre,
            cliente_doc: texto(body.cliente_doc).slice(0, 20) || null,
            cliente_telefono: texto(body.cliente_telefono).slice(0, 30) || null,
            cliente_email: texto(body.cliente_email).slice(0, 150) || null,
            cliente_direccion: texto(body.cliente_direccion).slice(0, 255) || null,
            presupuesto_id: body.presupuesto_id ? Number(body.presupuesto_id) : null,
            fecha,
            notas: texto(body.notas).slice(0, 2000) || null,
            forma_pago: texto(body.forma_pago).slice(0, 40) || null,
            subtotal,
            descuento,
            iva_monto,
            total,
            items
        }
    };
}

/**
 * Lee la cantidad de un renglón y la pasa a NÚMERO.
 *
 * Por qué hace falta: `factura_items.cantidad` es DECIMAL(12,3), y mysql2
 * devuelve los DECIMAL como texto. Un renglón de 2 unidades no llega como `2`
 * sino como `"2.000"` — con tres decimales de relleno. Con la cadena,
 * `Number.isInteger("2.000")` da `false`, `stock < "2.000"` compara un entero
 * contra una cadena, y toda factura con producto se rechaza al emitir con un
 * mensaje que dice que 2 unidades no son enteras.
 *
 * Esto NO lo detectó el verificador ni el arnés de mutaciones: los dos leen el
 * código y el esquema, y ahí los dos dicen que `cantidad` es un número. El tipo
 * que MySQL devuelve es lo único que se ve corriendo la consulta de verdad —
 * que es lo que hace `tools/probar-facturacion-vivo.js`.
 *
 * Devuelve el número, o `null` si no es una cantidad usable.
 */
function cantidadDeRenglon(it) {
    const n = Number(it.cantidad);
    return Number.isFinite(n) ? n : null;
}

/**
 * Baja el stock de TODOS los renglones con producto, o no baja ninguno.
 *
 * Primero mira TODOS y después toca el primero. Es al revés de lo intuitivo y
 * es a propósito: si se descontara de a uno y en el cuarto faltara stock, el
 * error se descubre con tres productos ya descontados y un `movimientos_stock`
 * que dice 3 ventas donde hubo 1. Con la transacción de arriba, ese estado no
 * llega a existir; sin ella, tampoco pero por otra razón.
 *
 * Manda `query` de la transacción (promesas), no `db`. Recibe el nombre de la
 * factura solo para el motivo del movimiento, que es lo que después lee el
 * humano que consulta el depósito.
 */
async function descontarStockFactura(query, items, motivo) {
    // 1. Verificar todo antes de tocar nada.
    const faltantes = [];
    const aBajar = [];

    for (const it of items) {
        if (!it.producto_id) continue;

        const cantidad = cantidadDeRenglon(it);
        if (cantidad === null || cantidad <= 0) continue;

        // `productos.stock` y `movimientos_stock.cantidad_afectada` son INT: una
        // cantidad fraccionaria no se puede escribir. Se rechaza acá y no se
        // redondea, porque redondear en silencio convierte una venta de 2,5 en
        // una de 2 sin que nadie lo vea.
        if (!Number.isInteger(cantidad)) {
            const e = new Error(
                `La cantidad de "${it.descripcion}" es ${cantidad} y el stock se controla ` +
                'en unidades enteras. Poné la cantidad en números enteros, o sacale el ' +
                'producto y cargalo como mano de obra (sin producto no se descuenta depósito).'
            );
            e.estadoHttp = 400;
            throw e;
        }

        const [p] = await query(
            'SELECT nombre, stock FROM productos WHERE id = ?',
            [it.producto_id]
        );
        if (!p.length) {
            const e = new Error(
                `"${it.descripcion}" apunta al producto ${it.producto_id}, que no existe. ` +
                'Sacale el producto del renglón o elegí uno del catálogo.'
            );
            e.estadoHttp = 400;
            throw e;
        }

        const stock = Number(p[0].stock) || 0;
        if (stock < cantidad) {
            faltantes.push(`${p[0].nombre}: pide ${cantidad} y hay ${stock}`);
        } else {
            aBajar.push({ producto_id: it.producto_id, nombre: p[0].nombre, cantidad });
        }
    }

    if (faltantes.length) {
        const e = new Error(
            'No hay stock suficiente para emitir la factura. Faltan:\n- ' + faltantes.join('\n- ')
        );
        e.estadoHttp = 400;
        throw e;
    }

    // 2. Ahora sí, todos o ninguno.
    for (const b of aBajar) {
        await query('UPDATE productos SET stock = stock - ? WHERE id = ?', [b.cantidad, b.producto_id]);
        await query(
            `INSERT INTO movimientos_stock
                (producto_id, producto_nombre, usuario_nombre, tipo, cantidad_afectada, stock_resultante, motivo)
             VALUES (?, ?, ?, 'VENTA', ?, (SELECT stock FROM productos WHERE id = ?), ?)`,
            [b.producto_id, b.nombre, 'Sistema', b.cantidad, b.producto_id, motivo]
        );
    }

    return aBajar.length;
}

/** Devuelve el stock que la factura sacó del depósito, para devolverlo al anular. */
async function devolverStockFactura(query, items, motivo) {
    for (const it of items) {
        if (!it.producto_id) continue;

        // La cantidad viene de la base como texto (DECIMAL). Sin convertirla, el
        // `+ ?` de arriba sumaría "2.000" y el depósito quedaría con un valor
        // que no es un número, y el `Number.isInteger` de acá no lo vería.
        const cantidad = cantidadDeRenglon(it);
        if (cantidad === null || cantidad <= 0 || !Number.isInteger(cantidad)) continue;

        await query('UPDATE productos SET stock = stock + ? WHERE id = ?', [cantidad, it.producto_id]);
        await query(
            `INSERT INTO movimientos_stock
                (producto_id, producto_nombre, usuario_nombre, tipo, cantidad_afectada, stock_resultante, motivo)
             VALUES (?, ?, ?, 'AJUSTE', ?, (SELECT stock FROM productos WHERE id = ?), ?)`,
            [it.producto_id, it.descripcion.slice(0, 150), 'Sistema', cantidad, it.producto_id, motivo]
        );
    }
}

// --- Listado ----------------------------------------------------------------
app.get('/api/facturas', verificarToken, requiereModulo('facturacion'), async (req, res) => {
    try {
        const condiciones = [];
        const valores = [];

        if (req.query.estado) {
            const estados = String(req.query.estado).split(',').map((e) => e.trim().toUpperCase());
            const validos = estados.filter((e) => ESTADO_FACTURA[e]);
            if (validos.length) {
                condiciones.push(`estado IN (${validos.map(() => '?').join(',')})`);
                valores.push(...validos);
            }
        }
        if (req.query.cliente_id) {
            condiciones.push('cliente_id = ?');
            valores.push(Number(req.query.cliente_id) || 0);
        }
        if (req.query.desde) {
            if (fechaReal(String(req.query.desde))) {
                condiciones.push('fecha >= ?');
                valores.push(String(req.query.desde));
            }
        }
        if (req.query.hasta) {
            if (fechaReal(String(req.query.hasta))) {
                condiciones.push('fecha <= ?');
                valores.push(String(req.query.hasta));
            }
        }
        if (req.query.q) {
            condiciones.push('(cliente_nombre LIKE ? OR cliente_doc LIKE ? OR CAST(numero AS CHAR) = ?)');
            const q = String(req.query.q).trim().slice(0, 60);
            valores.push(`%${escaparLike(q)}%`, `%${escaparLike(q)}%`, q.replace(/\D/g, ''));
        }

        const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

        // `COALESCE(numero, 0) DESC` y no `numero DESC`: los borradores tienen
        // numero NULL, y en MySQL `ORDER BY numero DESC` pone los NULL
        // PRIMERO, así que arriba de la lista aparecerían todos los borradores
        // sin número y las facturas emitidas —las que importan— al fondo.
        const [filas] = await db.promise().query(
            `SELECT id, numero, fecha, cliente_id, cliente_nombre, cliente_doc, estado,
                    subtotal, descuento, iva_monto, total, forma_pago, fecha_pago, usuario_nombre
               FROM facturas
               ${donde}
              ORDER BY COALESCE(numero, 0) DESC, id DESC
              LIMIT 300`,
            valores
        );

        res.json(filas);
    } catch (err) {
        console.error('Error al listar facturas:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Detalle ----------------------------------------------------------------
app.get('/api/facturas/:id', verificarToken, requiereModulo('facturacion'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Factura inválida' });

    try {
        const [f] = await db.promise().query('SELECT * FROM facturas WHERE id = ?', [id]);
        if (!f.length) return res.status(404).json({ error: 'Factura no encontrada' });

        const [items] = await db.promise().query(
            `SELECT id, producto_id, descripcion, cantidad, precio_unitario,
                    descuento, iva_porcentaje, subtotal, orden
               FROM factura_items WHERE factura_id = ? ORDER BY orden, id`,
            [id]
        );

        res.json({ ...f[0], items });
    } catch (err) {
        console.error('Error al obtener factura:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/**
 * El comprobante: factura + renglones + los datos de la empresa con los que se
 * imprime. Una sola respuesta, igual que el presupuesto, para que la hoja de
 * impresión no mezcle dos fuentes ni dependa de lo que quedó en el navegador.
 */
app.get('/api/facturas/:id/comprobante', verificarToken, requiereModulo('facturacion'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Factura inválida' });

    try {
        const [f] = await db.promise().query('SELECT * FROM facturas WHERE id = ?', [id]);
        if (!f.length) return res.status(404).json({ error: 'Factura no encontrada' });

        const [items] = await db.promise().query(
            `SELECT descripcion, cantidad, precio_unitario, descuento, iva_porcentaje, subtotal
               FROM factura_items WHERE factura_id = ? ORDER BY orden, id`,
            [id]
        );

        res.json({
            factura: f[0],
            items,
            empresa: datosDeMarca(req.empresa),
            // Para el pie del comprobante, sin exponer datos del usuario.
            emitido_por: f[0].usuario_nombre
        });
    } catch (err) {
        console.error('Error al armar el comprobante:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Alta -------------------------------------------------------------------
app.post('/api/facturas', verificarToken, requiereModulo('facturacion'), async (req, res) => {
    const prep = prepararFactura(req.body);
    if (!prep.valido) return res.status(400).json({ error: prep.error, errores: prep.errores });

    const d = prep.datos;
    try {
        // Se crea SIEMPRE como BORRADOR y con numero NULL. El numero lo saca
        // `emitir`, no este endpoint: por eso acá no se llama a
        // `siguienteNumero`.
        const id = await tenant.transaccion(async ({ query }) => {
            const [r] = await query(
                `INSERT INTO facturas
                    (numero, fecha, cliente_id, cliente_nombre, cliente_doc, cliente_telefono,
                     cliente_email, cliente_direccion, presupuesto_id, subtotal, descuento,
                     iva_monto, total, estado, notas, usuario_nombre)
                 VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORRADOR', ?, ?)`,
                [d.fecha, d.cliente_id, d.cliente_nombre, d.cliente_doc, d.cliente_telefono,
                    d.cliente_email, d.cliente_direccion, d.presupuesto_id, d.subtotal, d.descuento,
                    d.iva_monto, d.total, d.notas, req.usuario.nombre]
            );
            const facturaId = r.insertId;

            const valoresItems = d.items.map((it) => [
                facturaId, it.producto_id, it.descripcion, it.cantidad,
                it.precio_unitario, it.descuento, it.iva_porcentaje, it.subtotal, it.orden
            ]);
            if (valoresItems.length) {
                await query(
                    `INSERT INTO factura_items
                        (factura_id, producto_id, descripcion, cantidad, precio_unitario,
                         descuento, iva_porcentaje, subtotal, orden)
                     VALUES ?`,
                    [valoresItems]
                );
            }
            return facturaId;
        });

        res.status(201).json({
            mensaje: 'Factura creada como borrador',
            id,
            estado: 'BORRADOR',
            total: d.total
        });
    } catch (err) {
        console.error('Error al crear factura:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Modificación -----------------------------------------------------------
app.put('/api/facturas/:id', verificarToken, requiereModulo('facturacion'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Factura inválida' });

    const prep = prepararFactura(req.body);
    if (!prep.valido) return res.status(400).json({ error: prep.error, errores: prep.errores });
    const d = prep.datos;

    try {
        await tenant.transaccion(async ({ query }) => {
            const [actual] = await query('SELECT estado FROM facturas WHERE id = ?', [id]);
            if (!actual.length) {
                const e = new Error('Factura no encontrada');
                e.estadoHttp = 404;
                throw e;
            }
            // Solo BORRADOR. Una factura emitida o pagada ya salió del taller:
            // cambiarla por la puerta de atrás rompe el número que el cliente
            // tiene y el depósito que ya se movió. Se anula y se emite otra.
            if (actual[0].estado !== 'BORRADOR') {
                const e = new Error(
                    `Una factura ${ESTADO_FACTURA[actual[0].estado]} no se puede modificar. ` +
                    'Anulala y emití una nueva.'
                );
                e.estadoHttp = 400;
                throw e;
            }

            await query(
                `UPDATE facturas
                    SET fecha = ?, cliente_id = ?, cliente_nombre = ?, cliente_doc = ?,
                        cliente_telefono = ?, cliente_email = ?, cliente_direccion = ?,
                        subtotal = ?, descuento = ?, iva_monto = ?, total = ?,
                        notas = ?, forma_pago = ?
                  WHERE id = ?`,
                [d.fecha, d.cliente_id, d.cliente_nombre, d.cliente_doc, d.cliente_telefono,
                    d.cliente_email, d.cliente_direccion, d.subtotal, d.descuento, d.iva_monto,
                    d.total, d.notas, d.forma_pago, id]
            );

            await query('DELETE FROM factura_items WHERE factura_id = ?', [id]);
            const valoresItems = d.items.map((it) => [
                id, it.producto_id, it.descripcion, it.cantidad, it.precio_unitario,
                it.descuento, it.iva_porcentaje, it.subtotal, it.orden
            ]);
            if (valoresItems.length) {
                await query(
                    `INSERT INTO factura_items
                        (factura_id, producto_id, descripcion, cantidad, precio_unitario,
                         descuento, iva_porcentaje, subtotal, orden)
                     VALUES ?`,
                    [valoresItems]
                );
            }
        });

        res.json({ mensaje: 'Factura actualizada', id, total: d.total });
    } catch (err) {
        console.error('Error al actualizar factura:', err);
        res.status(err.estadoHttp || 500).json({ error: err.message || 'Error interno del servidor' });
    }
});

// --- Emitir -----------------------------------------------------------------
/**
 * Recibe el número y descuenta el stock. Es una decisión de negocio —el
 * documento pasa a existir y el depósito se mueve— así que es solo ADMIN.
 *
 * Todo en una transacción, y en este orden: se verifica el stock, se saca el
 * número, se descuenta, se marca. Si algo falla después del número, la
 * transacción deshace el número junto con todo lo demás: la correlativa no
 * avanza por facturas que nunca salieron.
 */
app.post('/api/facturas/:id/emitir', verificarToken, requiereModulo('facturacion'), requiereAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Factura inválida' });

    try {
        const resultado = await tenant.transaccion(async ({ query }) => {
            const [f] = await query('SELECT * FROM facturas WHERE id = ?', [id]);
            if (!f.length) {
                const e = new Error('Factura no encontrada');
                e.estadoHttp = 404;
                throw e;
            }
            const factura = f[0];

            if (factura.estado === 'ANULADA') {
                const e = new Error('Una factura anulada no se puede volver a emitir.');
                e.estadoHttp = 400;
                throw e;
            }
            // Reemitir una ya emitida no vuelve a descontar stock: el chequeo
            // de `stock_descontado` está adentro de `descontarStockFactura` por
            // lo que hace el que llama, no por lo que hace la función.
            if (factura.estado === 'EMITIDA' || factura.estado === 'PAGADA') {
                return { yaEmitida: true, numero: factura.numero };
            }

            const [items] = await query(
                'SELECT producto_id, descripcion, cantidad FROM factura_items WHERE factura_id = ? ORDER BY orden, id',
                [id]
            );
            if (!items.length) {
                const e = new Error('La factura no tiene ítems: no hay nada que emitir.');
                e.estadoHttp = 400;
                throw e;
            }

            // El número va DESPUÉS de verificar el stock. Al revés, una emisión
            // que no sale por falta de stock quema un número de la correlativa.
            const numero = await siguienteNumero(query, 'factura');

            if (factura.stock_descontado === 0) {
                await descontarStockFactura(query, items, `Factura N° ${numero}`);
            }

            await query(
                `UPDATE facturas SET numero = ?, estado = 'EMITIDA', stock_descontado = 1 WHERE id = ?`,
                [numero, id]
            );

            return { yaEmitida: false, numero, total: Number(factura.total) };
        });

        if (resultado.yaEmitida) {
            return res.json({
                mensaje: `La factura N° ${resultado.numero} ya estaba emitida.`,
                numero: resultado.numero,
                estado: 'EMITIDA'
            });
        }

        console.log(`  Factura N° ${resultado.numero} emitida (${req.usuario.nombre})`);
        res.json({
            mensaje: `Factura N° ${resultado.numero} emitida`,
            numero: resultado.numero,
            estado: 'EMITIDA',
            total: resultado.total
        });
    } catch (err) {
        console.error('Error al emitir factura:', err);
        res.status(err.estadoHttp || 500).json({ error: err.message || 'Error interno del servidor' });
    }
});

// --- Anular -----------------------------------------------------------------
/**
 * Devuelve el stock que se sacó al emitir. El número NO se borra y NO se
 * vuelve a usar: una factura anulada es un número que existió, y la correlativa
 * tiene que seguir mostrando ese hueco. Por eso anular es una anotación, no un
 * borrado.
 */
app.post('/api/facturas/:id/anular', verificarToken, requiereModulo('facturacion'), requiereAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Factura inválida' });

    const motivo = String((req.body && req.body.motivo) || '').trim().slice(0, 200);

    try {
        await tenant.transaccion(async ({ query }) => {
            const [f] = await query('SELECT * FROM facturas WHERE id = ?', [id]);
            if (!f.length) {
                const e = new Error('Factura no encontrada');
                e.estadoHttp = 404;
                throw e;
            }
            const factura = f[0];

            if (factura.estado === 'ANULADA') {
                const e = new Error('La factura ya estaba anulada.');
                e.estadoHttp = 400;
                throw e;
            }
            // Anular un BORRADOR es borrarlo, y para eso está DELETE. Si no se
            // aceptara acá, "anular" y "borrar" serían la misma palabra para
            // dos cosas distintas.
            if (factura.estado === 'BORRADOR') {
                const e = new Error(
                    'Esta factura es un borrador y nunca se emitió: no hay nada que anular ni ' +
                    'stock que devolver. Borrala si querés deshacerla.'
                );
                e.estadoHttp = 400;
                throw e;
            }

            // El `stock_descontado` va acá porque es lo que impide devolver dos
            // veces el mismo stock: anular una factura ya anulada se corta
            // arriba, y una re-emitida ya lo trae en 1.
            if (factura.stock_descontado === 1) {
                const [items] = await query(
                    'SELECT producto_id, descripcion, cantidad FROM factura_items WHERE factura_id = ? ORDER BY orden, id',
                    [id]
                );
                await devolverStockFactura(
                    query,
                    items,
                    `Anulación de factura N° ${factura.numero}${motivo ? ': ' + motivo : ''}`
                );
            }

            await query(
                `UPDATE facturas SET estado = 'ANULADA', stock_descontado = 0 WHERE id = ?`,
                [id]
            );
        });

        console.log(`  Factura #${id} anulada (${req.usuario.nombre})${motivo ? ': ' + motivo : ''}`);
        res.json({ mensaje: 'Factura anulada. El stock volvió al depósito.' });
    } catch (err) {
        console.error('Error al anular factura:', err);
        res.status(err.estadoHttp || 500).json({ error: err.message || 'Error interno del servidor' });
    }
});

// --- Marcar pagada ----------------------------------------------------------
app.post('/api/facturas/:id/pagar', verificarToken, requiereModulo('facturacion'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Factura inválida' });

    const forma_pago = String((req.body && req.body.forma_pago) || '').trim().slice(0, 40);

    try {
        const [f] = await db.promise().query('SELECT * FROM facturas WHERE id = ?', [id]);
        if (!f.length) return res.status(404).json({ error: 'Factura no encontrada' });

        if (f[0].estado === 'BORRADOR') {
            return res.status(400).json({ error: 'Una factura en borrador no se puede marcar como pagada: primero hay que emitirla.' });
        }
        if (f[0].estado === 'ANULADA') {
            return res.status(400).json({ error: 'Una factura anulada no se puede marcar como pagada.' });
        }
        if (f[0].estado === 'PAGADA') {
            return res.json({ mensaje: 'La factura ya estaba pagada.', estado: 'PAGADA' });
        }

        await db.query(
            `UPDATE facturas SET estado = 'PAGADA', forma_pago = ?, fecha_pago = NOW() WHERE id = ?`,
            [forma_pago || f[0].forma_pago || null, id]
        );

        res.json({ mensaje: 'Factura marcada como pagada.', estado: 'PAGADA' });
    } catch (err) {
        console.error('Error al marcar la factura como pagada:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Baja -------------------------------------------------------------------
app.delete('/api/facturas/:id', verificarToken, requiereModulo('facturacion'), requiereAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Factura inválida' });

    try {
        const [actual] = await db.promise().query('SELECT numero, estado FROM facturas WHERE id = ?', [id]);
        if (!actual.length) return res.status(404).json({ error: 'Factura no encontrada' });

        // Igual que en presupuestos: solo se borra lo que nunca salió. Una
        // factura emitida tiene número, y ese número no se devuelve.
        if (actual[0].estado !== 'BORRADOR') {
            return res.status(400).json({
                error: `Solo se borran facturas en BORRADOR. Esta está ${ESTADO_FACTURA[actual[0].estado]}: ` +
                'anulala si querés que deje de contar.'
            });
        }

        // Los renglones se van por ON DELETE CASCADE.
        await db.query('DELETE FROM facturas WHERE id = ?', [id]);
        console.log(`  Factura (borrador) #${id} eliminada (${req.usuario.nombre})`);
        res.json({ mensaje: 'Factura eliminada' });
    } catch (err) {
        console.error('Error al eliminar factura:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- Desde un presupuesto ----------------------------------------------------
/**
 * Arma un BORRADOR copiando un presupuesto APROBADO. No emite: queda como
 * borrador, con numero NULL, para que el usuario lo revise y lo emita como
 * cualquier otra.
 *
 * Se registra literal y no con un JOIN a presupuestos_items porque la factura
 * tiene una columna que el presupuesto no tiene: `iva_porcentaje`. El default
 * es 21, que es lo correcto para repuestos, y se deja editable renglón por
 * renglón en la pantalla.
 *
 * Esta ruta queda registrada DESPUÉS de `/api/facturas/:id/emitir` y de las
 * otras con `:id`, y funciona igual. No es casualidad ni fe: Express no puede
 * confundirlas porque los patrones tienen distinta cantidad de segmentos y
 * además el segmento en conflicto es un literal, no un parámetro. Ante
 * `/api/facturas/desde-presupuesto/82`, `:id` se comería "desde-presupuesto"
 * pero el siguiente segmento del patrón es la palabra fija "emitir", y ahí ya
 * no calza con "82".
 *
 * No se da por hecho: la sección 6 del verificador de este módulo levanta una
 * app de Express con este mismo orden de registro y manda las cuatro URLs, y
 * falla si alguna se despacha donde no toca. Si alguien agrega más adelante una
 * ruta con dos parámetros y un `:id` en el medio, el chequeo sigue valiendo.
 */
app.post('/api/facturas/desde-presupuesto/:presupuestoId', verificarToken, requiereModulo('facturacion'), async (req, res) => {
    const pid = Number(req.params.presupuestoId);
    if (!Number.isInteger(pid)) return res.status(400).json({ error: 'Presupuesto inválido' });

    try {
        const [p] = await db.promise().query(
            `SELECT id, numero, cliente_id, cliente_nombre, cliente_doc, cliente_telefono,
                    cliente_email, cliente_direccion, estado, notas
               FROM presupuestos WHERE id = ?`,
            [pid]
        );
        if (!p.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });

        // Solo de uno APROBADO. Facturar un presupuesto que el cliente rechazó
        // es un error que se evita acá y no en la pantalla.
        if (p[0].estado !== 'APROBADO') {
            return res.status(400).json({
                error: `Solo se factura un presupuesto APROBADO. Este está ${ETIQUETA_ESTADO[p[0].estado]}.`
            });
        }

        const [items] = await db.promise().query(
            `SELECT producto_id, descripcion, cantidad, precio_unitario
               FROM presupuesto_items WHERE presupuesto_id = ? ORDER BY orden, id`,
            [pid]
        );
        if (!items.length) {
            return res.status(400).json({ error: 'El presupuesto no tiene ítems.' });
        }

        // Se pasa por el MISMO validador que el alta manual. Una factura no
        // entra por una puerta más (-) que la otra: si el presupuesto tuviera
        // una cantidad en 0, acá tiene que rechazarse con el mismo mensaje que
        // si la escribió una persona.
        const prep = prepararFactura({
            fecha: new Date().toISOString().slice(0, 10),
            cliente_id: p[0].cliente_id,
            cliente_nombre: p[0].cliente_nombre,
            cliente_doc: p[0].cliente_doc,
            cliente_telefono: p[0].cliente_telefono,
            cliente_email: p[0].cliente_email,
            cliente_direccion: p[0].cliente_direccion,
            presupuesto_id: p[0].id,
            notas: p[0].notas,
            items: items.map((it) => ({ ...it, descuento: 0, iva_porcentaje: 21 }))
        });
        if (!prep.valido) return res.status(400).json({ error: prep.error, errores: prep.errores });

        const d = prep.datos;
        const id = await tenant.transaccion(async ({ query }) => {
            const [r] = await query(
                `INSERT INTO facturas
                    (numero, fecha, cliente_id, cliente_nombre, cliente_doc, cliente_telefono,
                     cliente_email, cliente_direccion, presupuesto_id, subtotal, descuento,
                     iva_monto, total, estado, notas, usuario_nombre)
                 VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORRADOR', ?, ?)`,
                [d.fecha, d.cliente_id, d.cliente_nombre, d.cliente_doc, d.cliente_telefono,
                    d.cliente_email, d.cliente_direccion, d.presupuesto_id, d.subtotal, d.descuento,
                    d.iva_monto, d.total, d.notas, req.usuario.nombre]
            );
            const facturaId = r.insertId;
            const valoresItems = d.items.map((it) => [
                facturaId, it.producto_id, it.descripcion, it.cantidad,
                it.precio_unitario, it.descuento, it.iva_porcentaje, it.subtotal, it.orden
            ]);
            if (valoresItems.length) {
                await query(
                    `INSERT INTO factura_items
                        (factura_id, producto_id, descripcion, cantidad, precio_unitario,
                         descuento, iva_porcentaje, subtotal, orden)
                     VALUES ?`,
                    [valoresItems]
                );
            }
            return facturaId;
        });

        res.status(201).json({
            mensaje: `Borrador creado desde el presupuesto N° ${p[0].numero}`,
            id,
            estado: 'BORRADOR',
            total: d.total
        });
    } catch (err) {
        console.error('Error al crear la factura desde el presupuesto:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/* ==========================================================================
   14. PANEL DEL SUPERADMIN  (rol SUPERADMIN, sobre la base CENTRAL)
   --------------------------------------------------------------------------
   Estas rutas no son de una empresa: son de todas. Por eso van aparte y no
   usan `verificarToken`.

   Por que no pueden reusarlo: `verificarToken` resuelve la empresa del token,
   se baja su pool de base de datos y RECHAZA al SUPERADMIN con un 403
   ("esta sesion no corresponde a una empresa"), que es exactamente lo
   correcto para el resto del sistema. Reusarlo seria tener que agregar
   excepciones a un guard que existe justamente para no tenerlas.

   Y por que no usan `conContexto`: el contexto pone en el request el pool de
   UNA empresa, y aca no hay ninguna. Todo lo de estas rutas va contra la base
   central, que es donde vive el registro de empresas, usuarios y modulos.
   Si alguna de estas rutas hiciera un `db.query(...)` a proposito, `db` no
   tendria pool en el contexto y fallaria con un error de.pool. Eso es lo que
   tiene que pasar: que ningun `db.query` de aca pueda escribir en la base de
   un cliente sin querer.

   Lo que un SUPERAdmin PUEDE ver: el registro de empresas, sus usuarios, sus
   modulos contratados, sus planes y el registro de auditoria. NO puede
   entrar a la base de datos de un cliente ni ver sus reparaciones, productos o
   clientes. Esa linea no es un detalle de la implementacion: es la promesa de
   "cero cruce de datos".
   ========================================================================== */

/** Un error de estas rutas, con el codigo HTTP que corresponde. */
function errorAdmin(mensaje, estado = 400, extra = {}) {
    const e = new Error(mensaje);
    e.estadoHttp = estado;
    e.extra = extra;
    return e;
}

/**
 * Verifica que el token sea de un SUPERADMIN.
 *
 * Deliberadamente NO devuelve ni busca datos de la empresa del token: si
 * `empresa_id` viene puesto en un token de SUPERADMIN, se ignora. Un token
 * con rol equivocado da 403, no 401: la sesion es valida, lo que no vale es
 * para esto.
 */
async function verificarSuperAdmin(req, res, next) {
    const auth = req.headers['authorization'];
    const token = auth && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;
    if (!token) {
        return res.status(401).json({ error: 'No autorizado.' });
    }

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Sesión inválida o expirada.' });
    }

    if (payload.rol !== 'SUPERADMIN') {
        return res.status(403).json({
            error: 'Esta sección es solo para el administrador del servicio.'
        });
    }

    // Se busca el usuario en la central en cada request, sin cache. Son pocas
    // consultas y la alternativa es un SUPERADMIN desactivado que sigue
    // entrando con el token viejo por 8 horas.
    //
    // `superadminActivo` filtra por rol Y por activo en la consulta. Filtrar en
    // el codigo de al lado ("si existe, dejo pasar") es lo que antes dejaba
    // entrar a un SuperAdmin dado de baja o degradado a ADMIN.
    const u = await registro.superadminActivo(payload.id);
    if (!u) {
        return res.status(403).json({ error: 'El usuario administrador ya no está activo.' });
    }

    req.superadmin = { id: u.id, nombre: u.nombre, email: u.email };
    return next();
}

/** Envuelve un handler async para que sus errores lleguen como JSON. */
function rutaAdmin(fn) {
    return (req, res) => {
        Promise.resolve(fn(req, res)).catch((err) => {
            const estado = err.estadoHttp || 500;
            if (estado >= 500) {
                console.error(`Error en ${req.method} ${req.originalUrl}:`, err);
            }
            res.status(estado).json({ error: err.message, ...(err.extra || {}) });
        });
    };
}

const ipDe = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

// --- listado ---------------------------------------------------------------

/**
 * Todas las empresas, con lo que el SuperAdmin necesita para decidir.
 *
 * Los conteos de usuarios y de datos operativos salen de la base CENTRAL
 * (`usuarios_globales`), no de la base de cada empresa. Preguntar "cuantas
 * reparaciones tiene" obliga a abrir la base de un cliente desde el panel, que
 * es justo lo que esta seccion no debe hacer.
 */
app.get('/api/admin/empresas', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const empresas = await registro.todasLasEmpresas();
    const planes = await altas.listarPlanes();

    // Los modulos contratados de todas las empresas, de una sola vez: una
    // consulta por empresa seria N+1 y con 50 clientes son 50 viajes.
    const mods = await central.query(
        `SELECT em.empresa_id, m.codigo, m.nombre, em.activo
           FROM empresa_modulos em
           JOIN modulos m ON m.codigo = em.modulo
          ORDER BY m.orden`
    );
    const porEmpresa = new Map();
    for (const m of mods) {
        if (!porEmpresa.has(m.empresa_id)) porEmpresa.set(m.empresa_id, []);
        porEmpresa.get(m.empresa_id).push(m);
    }

    const porPlan = new Map(planes.map((p) => [p.codigo, p]));
    const salida = empresas.map((e) => {
        const contratados = porEmpresa.get(e.id) || [];
        return {
            id: e.id,
            nombre: e.nombre,
            slug: e.slug,
            nombre_db: e.nombre_db,
            rubro: e.rubro,
            plan: e.plan,
            plan_nombre: porPlan.get(e.plan)?.nombre || e.plan,
            max_usuarios: e.max_usuarios ?? porPlan.get(e.plan)?.max_usuarios ?? null,
            estado: e.estado,
            fecha_vencimiento: e.fecha_vencimiento,
            usuarios_activos: e.usuarios_activos,
            modulos_contratados: contratados.filter((m) => m.activo).map((m) => m.codigo),
            modulos_no_contratados: contratados.filter((m) => !m.activo).map((m) => m.codigo),
            // Si tiene mas usuarios de los que su plan permite, se marca acá.
            excede_usuarios: !!(porPlan.get(e.plan) && e.usuarios_activos > porPlan.get(e.plan).max_usuarios
                && !e.max_usuarios)
        };
    });

    res.json({ empresas: salida, planes });
}));

// --- detalle ---------------------------------------------------------------

app.get('/api/admin/empresas/:id', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw errorAdmin('Id de empresa inválido.');

    const empresa = await central.uno('SELECT * FROM empresas WHERE id = ?', [id]);
    if (!empresa) return res.status(404).json({ error: 'No existe esa empresa.' });

    const [usuarios, modulos, auditoria] = await Promise.all([
        central.query(
            `SELECT id, nombre, email, rol, activo, ultimo_acceso, creado_en
               FROM usuarios_globales WHERE empresa_id = ? ORDER BY activo DESC, nombre`,
            [id]
        ),
        // El catálogo COMPLETO, no solo lo que esta empresa tiene anotado.
        //
        // Con un JOIN normal solo salen los módulos que ya tienen fila en
        // `empresa_modulos`: los cuatro base y los que alguien contrató
        // alguna vez. Los que nunca se tocaron no aparecen, y el panel queda
        // sin forma de contratar lo que falta, que es justo para qué está.
        //
        // El LEFT JOIN parte de `modulos` (el catálogo) y no al revés, y
        // `COALESCE(em.activo, 0)` pone en 0 los que no tienen fila. El PATCH
        // de abajo ya sabe crearla cuando hace falta, así que no hace falta
        // sembrar filas para todos los módulos del mundo.
        central.query(
            `SELECT m.codigo, m.nombre, m.es_base, COALESCE(em.activo, 0) AS activo,
                    em.fecha_desde
               FROM modulos m
               LEFT JOIN empresa_modulos em
                 ON em.modulo = m.codigo AND em.empresa_id = ?
              ORDER BY m.orden`,
            [id]
        ),
        central.query(
            `SELECT accion, email, detalle, creado_en FROM auditoria
              WHERE empresa_id = ? ORDER BY id DESC LIMIT 25`,
            [id]
        )
    ]);

    res.json({
        // La fila es un SELECT *: ya trae nombre, logo, colores y contacto.
        empresa,
        usuarios,
        modulos,
        auditoria
    });
}));

// --- alta ------------------------------------------------------------------

/**
 * Da de alta una empresa: base, esquema, permisos, registro, modulos base y
 * primer ADMIN. Todo o nada.
 *
 * Tarda: crea una base y le aplica el esquema entero. Se avisa con un 202 y se
 * devuelve el `slug` al que puede mirar, en vez de tener la pantalla colgada
 * esperando. Si algo falla, no queda nada: lo dice el error.
 */
app.post('/api/admin/empresas', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const b = req.body || {};
    const empresa = await altas.crearEmpresa(
        {
            nombre: b.nombre,
            rubro: b.rubro,
            plan: b.plan,
            estado: b.estado,
            slug: b.slug,
            marca: b.marca,
            contacto: b.contacto,
            admin: {
                email: b.admin_email,
                nombre: b.admin_nombre,
                password: b.admin_password
            }
        },
        { autor: req.superadmin, ip: ipDe(req) }
    );

    console.log(`  Empresa #${empresa.id} "${empresa.nombre}" dada de alta por ${req.superadmin.email}`);
    res.status(201).json({ empresa, mensaje: `Empresa dada de alta. Base: ${empresa.nombre_db}` });
}));

// --- cambiar estado, plan, notas -------------------------------------------

/**
 * Cambia lo que el SuperAdmin puede cambiar de una empresa que ya existe.
 *
 * El estado es lo que sirve: `SUSPENDIDO` y `BAJA` cortan el acceso en la
 * siguiente request, no cuando vence el token (esto lo chequea
 * `registro.estaOperativa` en cada request).
 */
app.patch('/api/admin/empresas/:id', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw errorAdmin('Id de empresa inválido.');

    const actual = await central.uno('SELECT * FROM empresas WHERE id = ?', [id]);
    if (!actual) return res.status(404).json({ error: 'No existe esa empresa.' });

    const b = req.body || {};
    const cambios = [];
    const sets = [];
    const vals = [];

    if (b.estado !== undefined) {
        const estados = ['DEMO', 'ACTIVO', 'SUSPENDIDO', 'BAJA'];
        if (!estados.includes(b.estado)) {
            throw errorAdmin(`Estado inválido. Los que hay: ${estados.join(', ')}.`);
        }
        if (b.estado !== actual.estado) {
            sets.push('estado = ?'); vals.push(b.estado);
            cambios.push(`estado: ${actual.estado} -> ${b.estado}`);
        }
    }

    if (b.plan !== undefined && b.plan !== actual.plan) {
        const existe = await central.uno('SELECT codigo FROM planes WHERE codigo = ?', [b.plan]);
        if (!existe) throw errorAdmin(`No existe el plan "${b.plan}".`);
        sets.push('plan = ?'); vals.push(b.plan);
        cambios.push(`plan: ${actual.plan} -> ${b.plan}`);
    }

    if (b.max_usuarios !== undefined) {
        const v = b.max_usuarios === null ? null : Number(b.max_usuarios);
        if (v !== null && (!Number.isInteger(v) || v < 0)) {
            throw errorAdmin('El límite de usuarios tiene que ser un número entero, o vacío para usar el del plan.');
        }
        sets.push('max_usuarios = ?'); vals.push(v);
        cambios.push(`límite de usuarios: ${actual.max_usuarios ?? '(del plan)'} -> ${v ?? '(del plan)'}`);
    }

    if (b.fecha_vencimiento !== undefined) {
        sets.push('fecha_vencimiento = ?'); vals.push(b.fecha_vencimiento || null);
        cambios.push(`vencimiento: ${b.fecha_vencimiento || 'sin fecha'}`);
    }

    if (b.notas !== undefined) {
        sets.push('notas = ?'); vals.push(String(b.notas).slice(0, 2000));
        cambios.push('notas actualizadas');
    }

    /* --- Datos de la empresa y de su marca -------------------------------
     *
     * Antes esto no se podia hacer desde el panel: el PATCH solo aceptaba
     * estado, plan, limite, vencimiento y notas. Para tocar el nombre, el
     * subtitulo, los colores, el logo o los datos que salen impresos en los
     * comprobantes habia que entrar por consola con `npm run datos-empresa`.
     * Eso es exactamente el dato que un SuperAdmin cambia todos los dias
     * (arreglar un telefono, poner el CUIT, cambiar el logo de un cliente que
     * no se sabe cual es), asi que quedo en la pantalla.
     *
     * LO QUE NO SE PUEDE CAMBIAR POR ACA, Y POR QUE
     *   - `slug`: es el subdominio y la clave con la que se resuelve la empresa
     *     antes de iniciar sesion. Cambiarlo rompe los enlaces guardados y los
     *     que ya se imprimieron en papel.
     *   - `nombre_db`: es contra la que se abre el pool de cada request. Un
     *     nombre de base equivocado no es un dato mal escrito, es una base que
     *     no existe: la empresa entera deja de andar y no se nota cual es.
     *   - `id`: lo elige la base.
     *
     * Si alguno de los dos llega igual, se ignora en silencio en vez de
     * fallar. No es un error del cliente: son datos que la pantalla no manda.
     */
    const EDITABLES = {
        nombre:           { largo: 150, requerido: true },
        rubro:            { largo: 40,  requerido: true, minusculas: true },
        subtitulo:        { largo: 120, vacio: null },
        telefono:         { largo: 50,  vacio: null },
        email_contacto:   { largo: 150, vacio: null, email: true },
        direccion:        { largo: 255, vacio: null },
        cuit:             { largo: 20,  vacio: null },
        logo_url:         { largo: 500, vacio: null, url: true },
        color_primario:   { largo: 7,   vacio: null, color: true },
        color_secundario: { largo: 7,   vacio: null, color: true }
    };

    for (const [campo, regla] of Object.entries(EDITABLES)) {
        if (b[campo] === undefined) continue;

        // Un string vacío se guarda como NULL, no como ''. Es la diferencia
        // entre "no cargó el CUIT" y "cargó un CUIT que no se ve": la consulta
        // de los comprobantes distingue las dos cosas con `IS NOT NULL`.
        const crudo = b[campo] === null ? '' : String(b[campo]).trim();
        // `let`, no `const`: más abajo se normaliza (minúsculas, color en
        // minúsculas) y con `const` eso era un 500 "Assignment to constant
        // variable" en el primer campo que llegaba en mayúsculas. Pasaba
        // desapercibido porque los campos INVÁLIDOS se rechazan antes de
        // llegar ahí: solo fallaban los válidos, que son los que se usan.
        let valor = crudo === '' ? (regla.vacio === undefined ? '' : regla.vacio) : crudo;

        if (regla.requerido && (valor === null || valor === '')) {
            throw errorAdmin(`El campo "${campo}" no puede quedar vacío.`);
        }
        if (valor !== null && String(valor).length > regla.largo) {
            throw errorAdmin(
                `"${campo}" tiene ${String(valor).length} caracteres y el máximo es ${regla.largo}.`
            );
        }
        if (regla.minusculas && valor) valor = valor.toLowerCase();
        if (regla.email && valor && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
            throw errorAdmin(`"${valor}" no es un email válido.`);
        }
        if (regla.url && valor) {
            if (!/^https?:\/\/[^\s]+$/i.test(valor)) {
                throw errorAdmin('El logo tiene que ser una dirección web completa (http o https).');
            }
            if (/\.(svg)$/i.test(valor)) {
                // Un SVG es un programa: puede ejecutar JavaScript y pedir
                // archivos de la red de quien lo abre. Puesto en un <img> no
                // corre script, pero el mismo valor se usa en descargas y en
                // plantillas, y ahi si podria. No se acepta.
                throw errorAdmin('El logo no puede ser un SVG. Usá un PNG o un JPG.');
            }
        }
        if (regla.color && valor && !/^#[0-9a-fA-F]{6}$/.test(valor)) {
            throw errorAdmin(`"${valor}" no es un color. Se escriben seis dígitos hexadecimales, como #1a7fbc.`);
        }

        // Normalizar el color en minúsculas: si no, el mismo color se
        // guardaría de dos formas distintas y el diff de la auditoría sería ruido.
        if (regla.color && valor) valor = valor.toLowerCase();

        const previo = actual[campo] ?? null;
        if (String(previo ?? '') === String(valor ?? '')) continue;

        sets.push(`${campo} = ?`); vals.push(valor);
        cambios.push(`${campo}: ${previo || '(vacío)'} -> ${valor || '(vacío)'}`);
    }

    if (!sets.length) {
        return res.json({ mensaje: 'No había nada que cambiar.', empresa: actual });
    }

    vals.push(id);
    await central.query(`UPDATE empresas SET ${sets.join(', ')} WHERE id = ?`, vals);
    await altas.auditar({
        usuario: req.superadmin,
        accion: 'empresa.actualizar',
        empresaId: id,
        detalle: { cambios, nombre: actual.nombre },
        ip: ipDe(req)
    });
    // La fila cacheada 30 s tiene el estado viejo: sin esto, el cambio de
    // estado no se nota hasta dentro de medio minuto.
    registro.invalidarEmpresa(id);

    console.log(`  Empresa #${id} (${actual.nombre}): ${cambios.join(' · ')} por ${req.superadmin.email}`);
    res.json({
        mensaje: 'Cambios guardados.',
        cambios,
        empresa: await central.uno('SELECT * FROM empresas WHERE id = ?', [id])
    });
}));

// --- modulos contratados ---------------------------------------------------

app.patch('/api/admin/empresas/:id/modulos/:codigo', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const id = Number(req.params.id);
    const codigo = String(req.params.codigo || '');
    if (!Number.isInteger(id)) throw errorAdmin('Id de empresa inválido.');

    const empresa = await central.uno('SELECT id, nombre FROM empresas WHERE id = ?', [id]);
    if (!empresa) return res.status(404).json({ error: 'No existe esa empresa.' });

    const modulo = await central.uno('SELECT codigo, nombre, es_base FROM modulos WHERE codigo = ?', [codigo]);
    if (!modulo) return res.status(404).json({ error: `No existe el módulo "${codigo}".` });

    // Los modulos base no se apagan. No es una politica: sin `clientes` no
    // anda la pantalla de clientes, y una empresa a la que se le apagó uno de
    // base tiene links al menu que no abren y no hay forma de arreglarlo desde
    // el panel.
    if (modulo.es_base) {
        throw errorAdmin(
            `"${modulo.nombre}" es un módulo base y no se puede desactivar.\n` +
            `   Todas las empresas lo tienen y hace falta para que el sistema ande.`
        );
    }

    const activo = req.body && req.body.activo ? 1 : 0;
    const previo = await central.uno(
        'SELECT activo FROM empresa_modulos WHERE empresa_id = ? AND modulo = ?', [id, codigo]
    );
    if (previo && Number(previo.activo) === activo) {
        return res.json({ mensaje: 'No había nada que cambiar.' });
    }

    if (previo) {
        await central.query(
            `UPDATE empresa_modulos SET activo = ?, fecha_desde = ${activo ? 'CURDATE()' : 'fecha_desde'}
              WHERE empresa_id = ? AND modulo = ?`,
            [activo, id, codigo]
        );
    } else {
        await central.query(
            `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde) VALUES (?, ?, ?, CURDATE())`,
            [id, codigo, activo]
        );
    }

    await altas.auditar({
        usuario: req.superadmin,
        accion: activo ? 'modulo.activar' : 'modulo.desactivar',
        empresaId: id,
        detalle: { modulo: codigo, nombre: modulo.nombre, empresa: empresa.nombre },
        ip: ipDe(req)
    });
    registro.invalidarEmpresa(id);

    res.json({
        mensaje: `${modulo.nombre}: ${activo ? 'contratado' : 'dado de baja'}.`,
        empresa_id: id,
        codigo,
        activo: !!activo
    });
}));

// --- baja ------------------------------------------------------------------

/**
 * Da de baja una empresa. Por defecto es BAJA SUAVE: el estado pasa a BAJA y
 * deja de poder entrar, pero la base y los datos quedan, que es lo que hace
 * falta para devolvérselos a alguien.
 *
 * `?borrarBase=si` borra todo. Eso no se puede deshacer, asi que el panel
 * lo pide con una confirmacion aparte.
 */
app.delete('/api/admin/empresas/:id', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw errorAdmin('Id de empresa inválido.');

    const borrarBase = req.query.borrarBase === 'si';
    const r = await altas.darDeBaja(id, {
        borrarBase,
        autor: req.superadmin,
        ip: ipDe(req),
        motivo: req.body?.motivo
    });
    registro.invalidarEmpresa(id);

    res.json({
        mensaje: borrarBase
            ? 'Empresa y base de datos borradas. No se puede deshacer.'
            : 'Empresa dada de baja. Los datos quedan y se pueden restaurar.',
        ...r
    });
}));

// --- soporte: entrar como y recuperar clave ---------------------------------
//
// Estas dos rutas rompen la regla que hasta ahora era fija ("el SuperAdmin no
// ve datos de ninguna empresa") y por eso no son "un detalle mas del panel".
// Lo que las hace aceptables esta en `src/servicios/soporte.js`: sesion corta,
// auditada, con banner, y sin vuelta al panel desde adentro.

/**
 * Abre una sesion de 30 minutos dentro de una empresa.
 *
 * El token que sale NO puede volver al panel: `verificarSuperAdmin` exige que
 * el rol del token sea SUPERADMIN, y este es el de un ADMIN (o TECNICO) de la
 * empresa elegida. Por eso el panel y el sistema de clientes quedan separados en
 * las dos direcciones y no hay un camino de ida y vuelta.
 */
app.post('/api/admin/empresas/:id/sesion', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw errorAdmin('Id de empresa inválido.');

    const empresa = await central.uno('SELECT * FROM empresas WHERE id = ?', [id]);
    if (!empresa) {
        const e = new Error(`No existe la empresa ${id}.`);
        e.estadoHttp = 404;
        throw e;
    }

    // No tiene sentido abrir una sesion de soporte de una empresa dada de baja
    // o suspendida: `verificarToken` la va a rebotar con 403 igual, y el
    // SuperAdmin se queda con una pestania rota sin entender por que.
    if (!registro.estaOperativa(empresa)) {
        const e = new Error(
            `${empresa.nombre} está ${empresa.estado.toLowerCase()}. ` +
            `Una sesión de soporte necesita una empresa operativa: al entrar, el ` +
            `sistema la rechaza por estado. Reactivala primero.`
        );
        e.estadoHttp = 400;
        throw e;
    }

    // Se entra como un usuario REAL de esa empresa, no con un token inventado:
    // el resto del sistema ya sabe qué hacer con un usuario de verdad (roles,
    // módulos, auditoría de la base del cliente).
    let usuario = null;
    const pedido = Number(req.body?.usuario_id);
    if (Number.isInteger(pedido) && pedido > 0) {
        usuario = await central.uno(
            `SELECT id, nombre, email, rol, empresa_id
               FROM usuarios_globales WHERE id = ? AND empresa_id = ?`,
            [pedido, empresa.id]
        );
        if (!usuario) {
            const e = new Error(`Ese usuario no pertenece a ${empresa.nombre}.`);
            e.estadoHttp = 404;
            throw e;
        }
    } else {
        // Sin indicar cuál, se usa su primer ADMIN activo: para probar el sistema conviene ver
        // lo que ve el que lo maneja, no lo que ve un técnico.
        usuario = await central.uno(
            `SELECT id, nombre, email, rol, empresa_id
               FROM usuarios_globales
              WHERE empresa_id = ? AND rol = 'ADMIN' AND activo = 1
              ORDER BY id LIMIT 1`,
            [empresa.id]
        );
        if (!usuario) {
            const e = new Error(`${empresa.nombre} no tiene ningún ADMIN activo para abrir una sesión.`);
            e.estadoHttp = 400;
            throw e;
        }
    }

    // Nunca se entra como algo que no sea de esa empresa. Este filtro no es
    // decorativo: sin él, un id de usuario de OTRA empresa abriría una sesión
    // con `empresa_id` de esta y las dos bases se mezclarían en un mismo token.
    if (usuario.empresa_id !== empresa.id) {
        const e = new Error('Ese usuario no pertenece a la empresa elegida.');
        e.estadoHttp = 400;
        throw e;
    }

    const token = soporte.tokenDeSoporte({
        empresa,
        usuario,
        superadmin: req.superadmin
    });

    await altas.auditar({
        usuario: req.superadmin,
        accion: 'empresa.sesion_soporte',
        empresaId: empresa.id,
        detalle: {
            nombre: empresa.nombre,
            usuario_id: usuario.id,
            usuario_email: usuario.email,
            usuario_rol: usuario.rol,
            minutos: soporte.MINUTOS_SESION_SOPORTE
        },
        ip: ipDe(req)
    });

    const decoded = jwt.decode(token);
    res.json({
        token,
        usuario: {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email,
            rol: usuario.rol
        },
        empresa: { id: empresa.id, nombre: empresa.nombre, slug: empresa.slug },
        expira_en: new Date(decoded.exp * 1000).toISOString(),
        minutos: soporte.MINUTOS_SESION_SOPORTE,
        aviso:
            `Vas a ver los datos de ${empresa.nombre}. La sesión dura ` +
            `${soporte.MINUTOS_SESION_SOPORTE} minutos, queda registrada con tu ` +
            `nombre y lo que hagas queda en nombre de ${usuario.email}.`
    });
}));

/**
 * Le genera una clave temporal a un usuario de la empresa.
 *
 * El SuperAdmin no elige la clave: la genera el sistema y se muestra una sola
 * vez. Eso es a propósito -- si la escribiera él, se quedaría sabiendo la
 * contraseña de un cliente, y ese dato no se devuelve.
 */
app.post(
    '/api/admin/empresas/:id/usuarios/:usuarioId/clave-temporal',
    verificarSuperAdmin,
    rutaAdmin(async (req, res) => {
        const id = Number(req.params.id);
        const usuarioId = Number(req.params.usuarioId);
        if (!Number.isInteger(id) || !Number.isInteger(usuarioId)) {
            throw errorAdmin('Id de empresa o de usuario inválido.');
        }

        const empresa = await central.uno('SELECT * FROM empresas WHERE id = ?', [id]);
        if (!empresa) {
            const e = new Error(`No existe la empresa ${id}.`);
            e.estadoHttp = 404;
            throw e;
        }

        // El usuario TIENE que ser de esta empresa. Sin esto, con el id de un
        // ADMIN de otro cliente se le cambia la clave desde acá y ese cliente
        // se queda sin poder entrar. El 404 es el mismo criterio que en el
        // resto del panel: no se confirma que el recurso existe en otra parte.
        const usuario = await central.uno(
            `SELECT id FROM usuarios_globales WHERE id = ? AND empresa_id = ?`,
            [usuarioId, id]
        );
        if (!usuario) {
            const e = new Error(`Ese usuario no pertenece a ${empresa.nombre}.`);
            e.estadoHttp = 404;
            throw e;
        }

        const r = await soporte.claveTemporalPara(usuarioId, {
            autor: req.superadmin,
            ip: ipDe(req)
        });
        registro.invalidarEmpresa(id);
        res.json(r);
    })
);

// --- catalogos y auditoria -------------------------------------------------
app.get('/api/admin/catalogos', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    res.json({
        modulos: await altas.listarModulos(),
        planes: await altas.listarPlanes()
    });
}));

app.get('/api/admin/auditoria', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    // El limite va en el texto y no como placeholder: el numero sale de aca,
    // ya acotado, y no hay forma de que sea otra cosa.
    const limite = Math.max(1, Math.min(Number(req.query.limite) || 50, 200));
    const filas = await central.query(
        `SELECT a.id, a.accion, a.email, a.empresa_id, e.nombre AS empresa, a.detalle, a.creado_en
           FROM auditoria a
           LEFT JOIN empresas e ON e.id = a.empresa_id
          ORDER BY a.id DESC LIMIT ${limite}`
    );
    res.json({ auditoria: filas });
}));

/** Quien soy. Lo usa el panel para decidir si mostrar el menu de administracion. */
app.get('/api/admin/yo', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    const empresas = await central.uno('SELECT COUNT(*) AS n FROM empresas');
    const usuarios = await central.uno('SELECT COUNT(*) AS n FROM usuarios_globales');
    const metricas = await central.uno('SELECT COUNT(*) AS n FROM empresa_metricas');
    res.json({
        superadmin: req.superadmin,
        totales: {
            empresas: empresas.n,
            usuarios: usuarios.n,
            metricas: metricas.n
        }
    });
}));

/**
 * El SuperAdmin cambia SU PROPIA clave.
 *
 * POR QUE ESTA RUTA EXISTE Y NO SE REUSA /api/usuarios/cambiar-password
 * --------------------------------------------------------------------------
 * Esa ruta (la de los usuarios de una empresa) exige `verificarToken`, y ese
 * middleware rechaza al SUPERADMIN a proposito:
 *
 *     if (payload.rol === 'SUPERADMIN' || !payload.empresa_id) {
 *         return res.status(403).json({ error: 'Esta sesion no corresponde a una empresa.' });
 *     }
 *
 * El rechazo esta bien justificado para todo lo demas (el panel no tiene base
 * de empresa, ni pool, ni `req.empresa`). Pero dejaba al SuperAdmin sin forma
 * de cambiar su propia clave: la unica puerta cerrada por `verificarToken`
 * que de verdad le hacía falta, no tenía equivalente. El único modo era pedir
 * que alguien ejecutara `npm run reset-clave` desde la consola del servidor.
 *
 * Por eso va con `verificarSuperAdmin`, que relee el usuario en la base
 * central en cada request y filtra rol y activo DENTRO del SQL. Esa guarda no
 * usa `conContexto` ni `db`: no hay empresa, no hay pool que abrir.
 *
 * Devuelve un token nuevo, como la de los usuarios de empresa: el que trae el
 * SuperAdmin sigue siendo valido (no se guarda la contrasena en el token), pero
 * renovarlo evita que el panel siga mostrando "sesion vieja" y, sobre todo,
 * deja el estado del navegador consistente con el cambio recien hecho.
 */
app.post('/api/admin/yo/clave', verificarSuperAdmin, limitadorCambioPassword, rutaAdmin(async (req, res) => {
    const { passwordActual, passwordNueva } = req.body || {};

    if (!passwordActual || !passwordNueva) {
        throw errorAdmin('Faltan datos.');
    }
    if (typeof passwordNueva !== 'string' || passwordNueva.length < 8) {
        throw errorAdmin('La contrasena nueva tiene que tener al menos 8 caracteres.');
    }
    if (passwordActual === passwordNueva) {
        throw errorAdmin('La contrasena nueva es igual a la actual.');
    }

    const fila = await central.uno(
        'SELECT id, email, nombre, rol, password_hash FROM usuarios_globales WHERE id = ?',
        [req.superadmin.id]
    );
    if (!fila) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const coincide = await bcrypt.compare(String(passwordActual), fila.password_hash);
    if (!coincide) {
        // No se distingue entre "no existe" y "clave incorrecta": ya se sabe
        // que existe, es el propio SuperAdmin, asi que el mensaje puede ser
        // claro sin filtrar nada.
        throw errorAdmin('La contrasena actual no es correcta.');
    }

    const hashNuevo = await bcrypt.hash(String(passwordNueva), 10);
    await central.query(
        'UPDATE usuarios_globales SET password_hash = ? WHERE id = ?',
        [hashNuevo, fila.id]
    );

    await altas.auditar({
        usuario: req.superadmin,
        accion: 'superadmin.cambiar_clave',
        detalle: { email: fila.email },
        ip: ipDe(req)
    });

    console.log(`  SuperAdmin ${fila.email} cambio su propia clave por ${ipDe(req)}`);

    const tokenNuevo = jwt.sign(
        { id: fila.id, email: fila.email, nombre: fila.nombre, rol: fila.rol, empresa_id: null },
        JWT_SECRET,
        { expiresIn: '8h' }
    );

    res.json({ mensaje: 'Contrasena actualizada con exito.', token: tokenNuevo });
}));

/**
 * El SuperAdmin sube el logo de una empresa desde un archivo de su computadora.
 *
 * POR QUE NO SE REUSA /api/upload
 * ------------------------------
 * /api/upload es una ruta de TENANT: usa `verificarToken`, y ese middleware
 * rechaza a proposito al SUPERADMIN porque no tiene empresa, ni pool, ni
 * `req.empresa`. Reusarla obligaria a aflojar esa guarda o a colar al SuperAdmin
 * por un atajo de tenant, y las dos cosas rompen la linea que esta seccion
 * sostiene: el panel central no entra a la base de un cliente. Asi que la
 * subida se resuelve por `verificarSuperAdmin`, que relee el usuario en la
 * central en cada request y filtra rol y activo DENTRO del SQL.
 *
 * QUE DEVUELVE Y POR QUE NO GUARDA NADA
 * --------------------------------------
 * Devuelve la URL y no toca `empresas`. El formulario de alta todavía no tiene
 * `empresa_id` (la fila se crea despues, en el POST), y la edicion ya tiene su
 * propio PATCH validado que es el que va a persistir la URL. Mezclar las dos
 * cosas aca dejaria un logo subido a una base de la que todavia no se sabe el
 * nombre, o dos fuentes de verdad para la misma columna.
 *
 * SEGURIDAD DEL ARCHIVO
 * ---------------------
 * Reusa el `upload` de multer, que ya limita a 5 MB y acepta SOLO
 * jpeg/png/webp/gif. Un SVG queda afuera a proposito: es XML y puede llevar
 * <script> adentro, que se ejecuta si alguien abre el archivo. Por eso la
 * validacion no se relaja ni para logos: el mismo filtro que sirve para las
 * fotos de un producto sirve para la marca de la empresa.
 *
 * El `upload.single()` se corre DENTRO del handler y no como middleware suelto,
 * para que un archivo rechazado (tipo raro o de mas de 5 MB) caiga en el
 * try/catch de `rutaAdmin` y vuelva como 400 con un mensaje que se entienda.
 * Como middleware aparte, el error de multer esquivaba `rutaAdmin` y el cliente
 * recibia un 500 sin explicar por que.
 */
app.post('/api/admin/subir-logo', verificarSuperAdmin, rutaAdmin(async (req, res) => {
    await new Promise((resolve, reject) => {
        upload.single('imagen')(req, res, (err) => {
            if (!err) return resolve();
            if (err.code === 'LIMIT_FILE_SIZE') {
                return reject(errorAdmin('El logo pesa mas de 5 MB.'));
            }
            return reject(errorAdmin(err.message || 'No se pudo leer el archivo.'));
        });
    });

    if (!req.file) {
        throw errorAdmin('No se selecciono ningun archivo.');
    }

    const fileBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const url = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload(fileBase64, {
            // Carpeta propia: un logo de empresa no se confunde nunca con una
            // foto de producto si alguna vez hay que depurar el lado del CDN.
            folder: 'service_integral/logos',
            transformation: [
                // El logo se imprime chico en el encabezado del presupuesto, asi
                // que se limita el ancho. `limit` con las dos medidas mantiene la
                // proporcion: no deforma un logo cuadrado ni uno muy angosto.
                { width: 800, height: 400, crop: 'limit' },
                { quality: 'auto' },
                { fetch_format: 'auto' }
            ]
        }, (err, result) => {
            if (err || !result) return reject(errorAdmin('No se pudo subir el logo.'));
            resolve(result.secure_url);
        });
    });

    await altas.auditar({
        usuario: req.superadmin,
        accion: 'superadmin.subir_logo',
        detalle: { archivo: req.file.originalname, bytes: req.file.size },
        ip: ipDe(req)
    });

    console.log(`  SuperAdmin subio un logo (${req.file.originalname}, ${req.file.size} bytes) por ${ipDe(req)}`);

    res.json({ url });
}));

/* ==========================================================================
   12. SISTEMA DE RESPALDOS AUTOMÁTICOS
   --------------------------------------------------------------------------
   La lógica vive en src/jobs/backup.js. Antes estaba acá con exec() + shell
   y fallaba en silencio dejando archivos truncados que parecían válidos.

   Causa del fallo anterior (2026-09-18 a 2026-09-24):
     mysqldump: Access denied ... to database ... when using LOCK TABLES
     mysqldump: needs the PROCESS privilege ... for this operation
   El usuario de la app no tiene esos privilegios. Se resuelve con los flags
   --single-transaction y --no-tablespaces, sin tocar permisos de MySQL.
   ========================================================================== */

const respaldo = require('./src/jobs/backup');

async function realizarBackup() {
    const carpeta = path.join(__dirname, 'backups');
    console.log('💾 Iniciando backup automático de la base de datos...');

    try {
        const r = await respaldo.ejecutarDump({ carpetaDestino: carpeta });

        console.log(`✅ Backup VERIFICADO: ${r.nombreArchivo}`);
        console.log(`   ${(r.bytes / 1024).toFixed(2)} KB · ${r.tablas} tablas · ${r.duracionSeg}s`);

        const off = respaldo.copiarOffsite(r.ruta, r.nombreArchivo);
        if (off.ok) {
            console.log(`☁️  Copia externa: ${off.destino}`);
        } else if (off.motivo !== 'BACKUP_OFFSITE_DIR no configurado') {
            console.error(`⚠️  No se pudo copiar la copia externa: ${off.motivo}`);
        }

        const borrados = respaldo.limpiarBackupsViejos(carpeta, respaldo.RETENCION_DIAS_DEFAULT);
        if (borrados) console.log(`🧹 ${borrados} backup(s) antiguo(s) eliminado(s)`);

    } catch (err) {
        // Este mensaje va a stderr -> logs/errores.log
        console.error(`❌ BACKUP FALLIDO: ${err.message}`);
        console.error('   No se publicó ningún archivo. El backup anterior sigue intacto.');

        // Red de seguridad. `realizarBackup` ya tiene su try/catch, pero si el
        // throw viene de algo que se ejecuta FUERA de ese try (por ejemplo un
        // rechazo sin manejar dentro de src/jobs/backup.js), la promesa
        // rechazada sin `.catch` se vuelve una unhandledRejection y Node 22
        // TIRA EL PROCESO ABAJO. Un backup nunca puede apagar el sistema.
        if (err.rescate) {
            console.error(`   El dump se salvó como: ${path.basename(err.rescate)}`);
        }
    }
}

cron.schedule('0 20 * * *', () => {
    realizarBackup().catch((err) => {
        console.error('❌ BACKUP FALLIDO (fuera del try):', err && err.message);
    });
}, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
});

/* ==========================================================================
   12.1 DESALOJO DE CONEXIONES OCIOSAS
   --------------------------------------------------------------------------
   Cada empresa tiene su propio pool. Si una empresa deja de usar el sistema,
   su pool queda ocupando conexiones contra un MySQL con tope (151 por
   defecto). Con 50 empresas activas eso se agota. Este trabajo cierra los
   pools que no se usaron en los últimos minutos.

   Se corre cada 5 minutos: no hace falta más precisión.
   ========================================================================== */
const MINUTOS_OCIOSO = 10;

cron.schedule('*/5 * * * *', () => {
    tenant.desalojarInactivos(MINUTOS_OCIOSO * 60 * 1000)
        .then((cerrados) => {
            if (cerrados.length) {
                console.log(`🧹 Pools cerrados por inactividad (${MINUTOS_OCIOSO} min): ${cerrados.join(', ')}`);
            }
        })
        .catch((err) => console.error('Error al desalojar pools inactivos:', err.message));
}, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
});

/* ==========================================================================
   13. INICIALIZACIÓN Y PUESTA EN MARCHA DEL SERVIDOR
   ========================================================================== */
const servidor = app.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor de Service Integral activo.`);
    console.log(`🔒 Escuchando en el puerto ${PORT}.`);
});

/**
 * Cierre ordenado. Sin esto, cada reinicio deja conexiones abiertas contra la
 * base central y la de cada empresa hasta que MySQL las corte por timeout.
 */
async function cerrarOrdenado(senal) {
    console.log(`\n${senal}: cerrando conexiones...`);
    servidor.close(async () => {
        try {
            await tenant.cerrarTodos();
            await central.cerrar();
            console.log('Listo, cerrado.');
            process.exit(0);
        } catch (err) {
            console.error('Error al cerrar:', err.message);
            process.exit(1);
        }
    });

    // Si algo se cuelga, no esperar para siempre.
    setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => cerrarOrdenado('SIGINT'));
process.on('SIGTERM', () => cerrarOrdenado('SIGTERM'));