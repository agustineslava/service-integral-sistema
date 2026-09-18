/* ==========================================================================
   1. VARIABLES DE ENTORNO, DEPENDENCIAS Y LIBRERÍAS
   ========================================================================== */
require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

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
// Nota: la Content-Security-Policy de Helmet viene desactivada porque el
// frontend usa atributos onclick="..." inline en varios lugares (pedidos.js,
// auth-check.js, etc.) y una CSP estricta los bloquearía. El resto de los
// headers de seguridad de Helmet (X-Frame-Options, X-Content-Type-Options,
// ocultar "X-Powered-By: Express", etc.) sí quedan activos.
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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máximo por imagen
    fileFilter: (req, file, cb) => {
        const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (tiposPermitidos.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, WEBP, GIF).'));
        }
    }
});

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ==========================================================================
   4. CONEXIÓN A LA BASE DE DATOS (MYSQL CONNECTION POOL)
   ========================================================================== */
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Función para asegurar que exista un usuario Administrador inicial (solo la primera vez)
const ADMIN_EMAIL_INICIAL = process.env.ADMIN_EMAIL_INICIAL;
const ADMIN_PASSWORD_INICIAL = process.env.ADMIN_PASSWORD_INICIAL;

function crearUsuarioAdminInicial() {
    if (!ADMIN_EMAIL_INICIAL || !ADMIN_PASSWORD_INICIAL) {
        console.log('ℹ️  ADMIN_EMAIL_INICIAL / ADMIN_PASSWORD_INICIAL no están definidos en .env — se omite la creación automática de administrador.');
        return;
    }

    // Solo consultamos si ya existe: si existe, NO tocamos su contraseña actual
    // (evita pisar una contraseña que el cliente ya cambió desde la app).
    db.query('SELECT id FROM usuarios WHERE email = ?', [ADMIN_EMAIL_INICIAL], (err, rows) => {
        if (err) {
            console.error('❌ Error al verificar usuario Admin inicial:', err.message);
            return;
        }
        if (rows.length > 0) return; // ya existe, no hacemos nada

        const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD_INICIAL, 10);
        db.query(
            'INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, "ADMIN")',
            ['Administrador', ADMIN_EMAIL_INICIAL, passwordHash],
            (errInsert) => {
                if (errInsert) {
                    console.error('❌ Error al crear usuario Admin inicial:', errInsert.message);
                } else {
                    console.log(`✅ Usuario Administrador inicial creado: ${ADMIN_EMAIL_INICIAL}`);
                }
            }
        );
    });
}

// Comprobación de estado inicial de conexión con MySQL
db.query('SELECT 1', (err) => {
    if (err) {
        console.error('❌ Error al conectar al Pool de MySQL:', err.message);
        return;
    }
    console.log('✅ Pool de conexiones de MySQL established con éxito de forma segura.');
    
    // Generar/Sincronizar el usuario admin apenas confirma la base de datos
    crearUsuarioAdminInicial();
});

/* ==========================================================================
   5.0 MIDDLEWARES DE AUTENTICACIÓN Y AUTORIZACIÓN
   ========================================================================== */

/**
 * Exige un JWT válido en el header "Authorization: Bearer <token>".
 * Si es válido, adjunta los datos del usuario en req.usuario.
 */
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
        return res.status(401).json({ error: 'No autorizado. Iniciá sesión nuevamente.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Sesión inválida o expirada. Iniciá sesión nuevamente.' });
        }
        req.usuario = decoded;
        next();
    });
}

/**
 * Debe usarse DESPUÉS de verificarToken. Exige que el usuario tenga rol ADMIN.
 */
function requiereAdmin(req, res, next) {
    if (!req.usuario || req.usuario.rol !== 'ADMIN') {
        return res.status(403).json({ error: 'No tenés permisos para realizar esta acción.' });
    }
    next();
}

/* ==========================================================================
   5.1 VALIDACIÓN DE DATOS DE ENTRADA
   ========================================================================== */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida los datos de un producto (para crear o actualizar).
 * Devuelve { valido: true, datos: {...} } con los valores ya normalizados/parseados,
 * o { valido: false, error: '...' } con el primer problema encontrado.
 */
function validarProducto(body, { esCreacion }) {
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    if (!nombre) {
        return { valido: false, error: 'El nombre del producto es obligatorio.' };
    }
    if (nombre.length > 150) {
        return { valido: false, error: 'El nombre del producto no puede superar los 150 caracteres.' };
    }

    // precio: opcional, pero si viene tiene que ser un número válido y no negativo
    let precio = 0;
    if (body.precio !== undefined && body.precio !== null && body.precio !== '') {
        precio = Number(body.precio);
        if (!Number.isFinite(precio) || precio < 0) {
            return { valido: false, error: 'El precio tiene que ser un número mayor o igual a 0.' };
        }
    }

    // stock: opcional, entero >= 0
    let stock = 0;
    if (body.stock !== undefined && body.stock !== null && body.stock !== '') {
        stock = Number(body.stock);
        if (!Number.isInteger(stock) || stock < 0) {
            return { valido: false, error: 'El stock tiene que ser un número entero mayor o igual a 0.' };
        }
    }

    // stockMinimo: solo se exige en creación (en el PUT de edición no se toca desde ese formulario)
    let stockMinimo = 0;
    if (body.stockMinimo !== undefined && body.stockMinimo !== null && body.stockMinimo !== '') {
        stockMinimo = Number(body.stockMinimo);
        if (!Number.isInteger(stockMinimo) || stockMinimo < 0) {
            return { valido: false, error: 'El stock mínimo tiene que ser un número entero mayor o igual a 0.' };
        }
    }

    const distribuidor = body.distribuidor ? String(body.distribuidor).trim().slice(0, 100) : null;
    const codigoDistribuidor = body.codigoDistribuidor ? String(body.codigoDistribuidor).trim().slice(0, 100) : null;
    const categoria = body.categoria ? String(body.categoria).trim().slice(0, 50) : 'Otros';
    const descripcion = body.descripcion ? String(body.descripcion).trim() : null;

    // Las URLs de imagen, si vienen, tienen que ser realmente URLs (evita basura o intentos de injection en el campo)
    const imagenes = {};
    for (const campo of ['imagen_1', 'imagen_2', 'imagen_3']) {
        const valor = body[campo];
        if (!valor) {
            imagenes[campo] = null;
            continue;
        }
        if (typeof valor !== 'string' || !/^https?:\/\//i.test(valor)) {
            return { valido: false, error: `${campo} tiene que ser una URL válida (http/https).` };
        }
        imagenes[campo] = valor;
    }

    return {
        valido: true,
        datos: { nombre, precio, stock, stockMinimo, categoria, distribuidor, codigoDistribuidor, descripcion, ...imagenes }
    };
}

/**
 * Valida los datos de un usuario nuevo.
 */
function validarUsuario(body) {
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rol = body.rol === 'ADMIN' ? 'ADMIN' : 'TECNICO'; // cualquier otro valor cae a TECNICO por seguridad

    if (!nombre) return { valido: false, error: 'El nombre es obligatorio.' };
    if (!EMAIL_REGEX.test(email)) return { valido: false, error: 'El correo electrónico no es válido.' };
    if (password.length < 6) return { valido: false, error: 'La contraseña tiene que tener al menos 6 caracteres.' };

    return { valido: true, datos: { nombre, email, password, rol } };
}

/**
 * Valida el body de "actualizar stock mínimo".
 */
function validarStockMinimo(body) {
    const stockMinimo = Number(body.stockMinimo);
    if (!Number.isInteger(stockMinimo) || stockMinimo < 0) {
        return { valido: false, error: 'El stock mínimo tiene que ser un número entero mayor o igual a 0.' };
    }
    return { valido: true, datos: { stockMinimo } };
}

/* ==========================================================================
   5. ENDPOINTS DE AUTENTICACIÓN Y GESTIÓN DE USUARIOS
   ========================================================================== */

// Máximo 8 intentos de login cada 10 minutos por IP (protege contra fuerza bruta)
const limitadorLogin = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Probá de nuevo en unos minutos.' }
});

/**
 * POST /api/login
 * Autentica usuario y devuelve Token JWT + información del perfil
 */
app.post('/api/login', limitadorLogin, (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Por favor ingrese email y contraseña' });
    }

    const sql = 'SELECT * FROM usuarios WHERE email = ?';
    db.query(sql, [email], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (results.length === 0) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        const usuario = results[0];

        // Comparar contraseña ingresada con la encriptada
        const passwordValida = bcrypt.compareSync(password, usuario.password);
        if (!passwordValida) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        // Generar Token JWT con sus datos de perfil/rol
        const token = jwt.sign(
            { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            mensaje: 'Autenticación exitosa',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol
            }
        });
    });
});

/**
 * POST /api/usuarios
 * Registra un nuevo usuario en MySQL con contraseña encriptada (ADMIN / TECNICO)
 */
app.post('/api/usuarios', verificarToken, requiereAdmin, (req, res) => {
    const validacion = validarUsuario(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { nombre, email, password, rol } = validacion.datos;

    // Encriptar la contraseña elegida
    const passwordHash = bcrypt.hashSync(password, 10);

    const sql = 'INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)';
    db.query(sql, [nombre, email, passwordHash, rol], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'El correo electrónico ya está registrado' });
            }
            console.error('Error al registrar usuario:', err);
            return res.status(500).json({ error: 'Error interno al crear usuario' });
        }
        res.status(201).json({ mensaje: 'Usuario creado con éxito', id: result.insertId });
    });
});

/**
 * Extrae el public_id de Cloudinary a partir de una URL de imagen subida por este sistema.
 * Devuelve null si la URL no tiene el formato esperado.
 */
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

/**
 * Borra una imagen de Cloudinary a partir de su URL. No lanza si falla:
 * se usa en limpiezas donde un fallo de Cloudinary no debe bloquear el resto
 * de la operación (por ejemplo, borrar un producto igual aunque una foto vieja
 * ya no exista en la nube).
 */
async function borrarImagenDeCloudinary(imageUrl) {
    const publicId = extraerPublicId(imageUrl);
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId);
    } catch (err) {
        console.error(`⚠️ No se pudo borrar de Cloudinary la imagen (${imageUrl}):`, err.message);
    }
}

/* ==========================================================================
   6. ENDPOINTS DE PRODUCTOS / STOCK (C.R.U.D.)
   ========================================================================== */

app.get('/api/productos', verificarToken, (req, res) => {
    const sql = 'SELECT * FROM productos ORDER BY id DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error al traer productos:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(results);
    });
});

app.post('/api/productos', verificarToken, requiereAdmin, (req, res) => {
    const validacion = validarProducto(req.body, { esCreacion: true });
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

app.delete('/api/productos/:id', verificarToken, requiereAdmin, (req, res) => {
    const { id } = req.params;

    // 1. Buscamos las imágenes del producto ANTES de borrar la fila.
    //    Esto lo hace el backend (no el frontend) para que no queden fotos
    //    huérfanas en Cloudinary sin importar desde dónde se llame al borrado.
    db.query('SELECT imagen_1, imagen_2, imagen_3 FROM productos WHERE id = ?', [id], async (errSelect, rows) => {
        if (errSelect) {
            console.error('Error al buscar imágenes del producto a eliminar:', errSelect);
            return res.status(500).json({ error: 'Error al eliminar el producto' });
        }

        const producto = rows[0];
        if (producto) {
            const imagenes = [producto.imagen_1, producto.imagen_2, producto.imagen_3].filter(Boolean);
            // Se borran en paralelo; si alguna falla no bloqueamos el borrado del producto
            // (ya se loguea el error adentro de borrarImagenDeCloudinary).
            await Promise.all(imagenes.map(url => borrarImagenDeCloudinary(url)));
        }

        // 2. Recién ahora borramos la fila de MySQL
        db.query('DELETE FROM productos WHERE id = ?', [id], (errDelete) => {
            if (errDelete) {
                console.error('Error al eliminar de MySQL:', errDelete);
                return res.status(500).json({ error: 'Error al eliminar el producto' });
            }
            res.json({ mensaje: 'Producto y sus imágenes eliminados correctamente' });
        });
    });
});

app.put('/api/productos/:id', verificarToken, requiereAdmin, (req, res) => {
    const { id } = req.params;

    const validacion = validarProducto(req.body, { esCreacion: false });
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { nombre, precio, stock, distribuidor, codigoDistribuidor, descripcion, imagen_1, imagen_2, imagen_3 } = validacion.datos;

    const sql = `UPDATE productos 
                 SET nombre = ?, precio = ?, stock = ?, distribuidor = ?, codigoDistribuidor = ?, descripcion = ?, 
                     imagen_1 = ?, imagen_2 = ?, imagen_3 = ? 
                 WHERE id = ?`;
    
    db.query(sql, [nombre, precio, stock, distribuidor, codigoDistribuidor, descripcion, imagen_1, imagen_2, imagen_3, id], (err, result) => {
        if (err) {
            console.error('❌ Error al actualizar en MySQL:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.status(200).json({ mensaje: 'Producto actualizado con éxito' });
    });
});

app.post('/api/productos/:id/stock-minimo', verificarToken, requiereAdmin, (req, res) => {
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

app.post('/api/pedidos', verificarToken, requiereAdmin, (req, res) => {
    const { notas, items } = req.body;

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
                                console.log(`🧹 Limpieza: Se eliminaron ${resultLimpieza.affectedRows} pedidos viejos de más de 2 meses.`);
                            }
                        });

                        res.status(201).json({ mensaje: 'Pedido guardado y base de datos optimizada', pedidoId });
                    });
                });
            });
        });
    });
});

app.get('/api/pedidos', verificarToken, (req, res) => {
    const sql = 'SELECT * FROM pedidos ORDER BY fecha DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error al traer historial de pedidos:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(results);
    });
});

app.get('/api/pedidos/:id/items', verificarToken, (req, res) => {
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
   9. SISTEMA DE RESPALDOS AUTOMÁTICOS (MYSQLDUMP BACKUPS)
   ========================================================================== */

function realizarBackup() {
    const dbName = process.env.DB_NAME;
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbHost = process.env.DB_HOST || 'localhost';

    const fechaActual = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    const nombreArchivo = `backup_${dbName}_${fechaActual}.sql`;
    const rutaCarpeta = path.join(__dirname, 'backups');
    const rutaDestino = path.join(rutaCarpeta, nombreArchivo);

    if (!fs.existsSync(rutaCarpeta)) {
        fs.mkdirSync(rutaCarpeta, { recursive: true });
    }

    const mysqldumpPath = process.env.MYSQLDUMP_PATH || 'mysqldump';
    const comando = `"${mysqldumpPath}" -h ${dbHost} -u ${dbUser} -p"${dbPassword}" ${dbName} > "${rutaDestino}"`;

    console.log(`💾 Iniciando backup automático de la base de datos...`);

    exec(comando, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Error al ejecutar el backup: ${error.message}`);
            return;
        }
        console.log(`✅ ¡Backup creado con éxito! Guardado en: ${rutaDestino}`);
        limpiarBackupsViejos(rutaCarpeta, 7);
    });
}

function limpiarBackupsViejos(rutaCarpeta, diasRetencion) {
    fs.readdir(rutaCarpeta, (err, archivos) => {
        if (err) return;
        const limiteTiempo = Date.now() - (diasRetencion * 24 * 60 * 60 * 1000);

        archivos.forEach(archivo => {
            const rutaArchivo = path.join(rutaCarpeta, archivo);
            fs.stat(rutaArchivo, (errStat, stats) => {
                if (errStat) return;
                if (stats.mtimeMs < limiteTiempo && archivo.endsWith('.sql')) {
                    fs.unlink(rutaArchivo, () => {});
                }
            });
        });
    });
}

cron.schedule('0 20 * * *', () => {
    realizarBackup();
}, {
    scheduled: true,
    timezone: "America/Argentina/Buenos_Aires" 
});

/* ==========================================================================
   9.5 MANEJADOR DE ERRORES GLOBAL
   ========================================================================== */
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'La imagen supera el tamaño máximo permitido (5 MB).' });
        }
        return res.status(400).json({ error: `Error al subir el archivo: ${err.message}` });
    }
    if (err && err.message && err.message.includes('Tipo de archivo no permitido')) {
        return res.status(400).json({ error: err.message });
    }
    console.error('❌ Error no controlado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

/* ==========================================================================
   10. INICIALIZACIÓN Y PUESTA EN MARCHA DEL SERVIDOR
   ========================================================================== */
app.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor de Service Integral activo.`);
    console.log(`🔒 Cerrado localmente en: http://192.168.0.99:${PORT}`);
});