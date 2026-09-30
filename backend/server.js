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
   CONFIGURACIÓN PÚBLICA DE MARCA BLANCA
   ========================================================================== */
app.get('/api/config-comercio', (req, res) => {
    res.json({
        nombre: process.env.COMERCIO_NOMBRE || 'Sistema de Gestión',
        subtitulo: process.env.COMERCIO_SUBTITULO || 'Gestión de Stock y Taller',
        logo: process.env.COMERCIO_LOGO || 'logos/logo.jpg'
    });
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

        res.json({
            mensaje: 'Autenticación exitosa',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol
            },
            // Marca blanca: la necesita el frontend ya mismo después de entrar.
            empresa: empresa ? {
                id: empresa.id,
                nombre: empresa.nombre,
                slug: empresa.slug,
                rubro: empresa.rubro,
                estado: empresa.estado,
                color_primario: empresa.color_primario,
                color_secundario: empresa.color_secundario,
                logo_url: empresa.logo_url,
                plan: empresa.plan,
                limite_usuarios: empresa.limite_usuarios,
                modulos
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
            nombre: empresa.nombre,
            slug: empresa.slug,
            rubro: empresa.rubro,
            estado: empresa.estado,
            color_primario: empresa.color_primario,
            color_secundario: empresa.color_secundario,
            logo_url: empresa.logo_url,
            plan: empresa.plan,
            plan_nombre: empresa.plan_nombre,
            limite_usuarios: empresa.limite_usuarios,
            usuarios_actuales: await registro.contarUsuarios(empresa.id),
            modulos
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
        await central.query('UPDATE usuarios_globales SET password_hash = ? WHERE id = ?', [nuevoHash, req.usuario.id]);
        res.json({ mensaje: 'Contraseña actualizada con éxito' });
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

app.get('/api/reparaciones', verificarToken, requiereModulo('reparaciones'), (req, res) => {
    const sql = 'SELECT * FROM reparaciones ORDER BY id DESC';
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('Error al obtener reparaciones:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(rows);
    });
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
 */
async function siguienteNumero(query) {
    await query(
        `INSERT INTO \`secuencias\` (nombre, ultimo) VALUES ('presupuesto', 1)
           ON DUPLICATE KEY UPDATE ultimo = ultimo + 1`
    );
    const [filas] = await query(
        `SELECT ultimo FROM \`secuencias\` WHERE nombre = 'presupuesto'`
    );
    return filas[0].ultimo;
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

    // Sin descuento es 0, no NaN. Si sepierte directo a a2(body.descuento) y el
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

    // valido_hasta: se acepta solo como AAAA-MM-DD. MySQL es permisivo con las
    // fechas y aceptaria "ayer"; aca se rechaza para que la oferta no expire
    // en una fecha que el usuario nunca escribio.
    let valido_hasta = texto(body.valido_hasta) || null;
    if (valido_hasta) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(valido_hasta) || Number.isNaN(Date.parse(valido_hasta))) {
            errores.push('La fecha de validez no tiene el formato correcto.');
        }
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
            empresa: {
                nombre: e.nombre,
                subtitulo: e.subtitulo,
                logo_url: e.logo_url,
                color_primario: e.color_primario,
                color_secundario: e.color_secundario,
                telefono: e.telefono,
                email_contacto: e.email_contacto,
                direccion: e.direccion,
                cuit: e.cuit
            },
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
    }
}

cron.schedule('0 20 * * *', () => {
    realizarBackup();
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