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
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

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
    limits: { fileSize: 5 * 1024 * 1024 }, // máximo 5MB por imagen
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

const ADMIN_EMAIL_INICIAL = process.env.ADMIN_EMAIL_INICIAL;
const ADMIN_PASSWORD_INICIAL = process.env.ADMIN_PASSWORD_INICIAL;

function crearUsuarioAdminInicial() {
    if (!ADMIN_EMAIL_INICIAL || !ADMIN_PASSWORD_INICIAL) {
        console.log('ℹ️  ADMIN_EMAIL_INICIAL / ADMIN_PASSWORD_INICIAL no están definidos en .env.');
        return;
    }

    db.query('SELECT id FROM usuarios WHERE email = ?', [ADMIN_EMAIL_INICIAL], (err, rows) => {
        if (err) {
            console.error('❌ Error al verificar usuario Admin inicial:', err.message);
            return;
        }
        if (rows.length > 0) return;

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

db.query('SELECT 1', (err) => {
    if (err) {
        console.error('❌ Error al conectar al Pool de MySQL:', err.message);
        return;
    }
    console.log('✅ Pool de conexiones de MySQL establecido con éxito de forma segura.');
    crearUsuarioAdminInicial();
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
        const passwordValida = bcrypt.compareSync(password, usuario.password);
        if (!passwordValida) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

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

app.post('/api/usuarios', verificarToken, requiereAdmin, (req, res) => {
    const validacion = validarUsuario(req.body);
    if (!validacion.valido) {
        return res.status(400).json({ error: validacion.error });
    }
    const { nombre, email, password, rol } = validacion.datos;
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

app.get('/api/usuarios', verificarToken, requiereAdmin, (req, res) => {
    db.query('SELECT id, nombre, email, rol, creado_en FROM usuarios ORDER BY nombre ASC', (err, rows) => {
        if (err) {
            console.error('Error al listar usuarios:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(rows);
    });
});

app.delete('/api/usuarios/:id', verificarToken, requiereAdmin, (req, res) => {
    const idABorrar = parseInt(req.params.id, 10);

    if (idABorrar === req.usuario.id) {
        return res.status(400).json({ error: 'No podés eliminar tu propio usuario mientras estás logueado con él.' });
    }

    db.query('SELECT id, rol FROM usuarios WHERE id = ?', [idABorrar], (err, rows) => {
        if (err) {
            console.error('Error al buscar usuario a eliminar:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const usuarioABorrar = rows[0];

        const continuarBorrado = () => {
            db.query('DELETE FROM usuarios WHERE id = ?', [idABorrar], (errDelete) => {
                if (errDelete) {
                    console.error('Error al eliminar usuario:', errDelete);
                    return res.status(500).json({ error: 'Error al eliminar el usuario' });
                }
                res.json({ mensaje: 'Usuario eliminado con éxito' });
            });
        };

        if (usuarioABorrar.rol === 'ADMIN') {
            db.query("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'ADMIN'", (errCount, resultCount) => {
                if (errCount) {
                    console.error('Error al contar administradores:', errCount);
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }
                if (resultCount[0].total <= 1) {
                    return res.status(400).json({ error: 'No podés eliminar el único administrador del sistema.' });
                }
                continuarBorrado();
            });
        } else {
            continuarBorrado();
        }
    });
});

const limitadorCambioPassword = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' }
});

app.post('/api/usuarios/cambiar-password', verificarToken, limitadorCambioPassword, (req, res) => {
    const { passwordActual, passwordNueva } = req.body;

    if (!passwordActual || !passwordNueva) {
        return res.status(400).json({ error: 'Faltan datos.' });
    }
    if (typeof passwordNueva !== 'string' || passwordNueva.length < 6) {
        return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 6 caracteres.' });
    }

    db.query('SELECT * FROM usuarios WHERE id = ?', [req.usuario.id], (err, rows) => {
        if (err) {
            console.error('Error al buscar usuario para cambio de password:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const usuario = rows[0];
        const coincide = bcrypt.compareSync(passwordActual, usuario.password);
        if (!coincide) {
            return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
        }

        const nuevoHash = bcrypt.hashSync(passwordNueva, 10);
        db.query('UPDATE usuarios SET password = ? WHERE id = ?', [nuevoHash, req.usuario.id], (errUpdate) => {
            if (errUpdate) {
                console.error('Error al actualizar password:', errUpdate);
                return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
            }
            res.json({ mensaje: 'Contraseña actualizada con éxito' });
        });
    });
});

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

app.delete('/api/productos/:id', verificarToken, requiereAdmin, (req, res) => {
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

app.put('/api/productos/:id', verificarToken, requiereAdmin, (req, res) => {
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
app.get('/api/movimientos-stock', verificarToken, requiereAdmin, (req, res) => {
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

// 1. Listar clientes (con búsqueda por nombre, teléfono o dirección)
app.get('/api/clientes', verificarToken, (req, res) => {
    const { buscar } = req.query;

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

    sql += ' GROUP BY c.id ORDER BY c.nombre ASC';

    db.query(sql, params, (err, rows) => {
        if (err) {
            console.error('Error al listar clientes:', err);
            return res.status(500).json({ error: 'Error al consultar clientes' });
        }
        res.json(rows);
    });
});

// 2. Detalle de un cliente puntual
app.get('/api/clientes/:id', verificarToken, (req, res) => {
    db.query('SELECT * FROM clientes WHERE id = ?', [req.params.id], (err, rows) => {
        if (err) {
            console.error('Error al obtener cliente:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        if (rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json(rows[0]);
    });
});

// 3. Historial completo de reparaciones de un cliente
app.get('/api/clientes/:id/reparaciones', verificarToken, (req, res) => {
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

// 4. Editar los datos de un cliente
app.put('/api/clientes/:id', verificarToken, requiereAdmin, (req, res) => {
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

// 1. Obtener todas las órdenes de servicio
app.get('/api/reparaciones', verificarToken, (req, res) => {
    const sql = 'SELECT * FROM reparaciones ORDER BY id DESC';
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('Error al obtener reparaciones:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(rows);
    });
});

// 2. Registrar nueva orden de servicio
app.post('/api/reparaciones', verificarToken, requiereAdmin, async (req, res) => {
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

// 3. Editar orden de servicio existente
app.put('/api/reparaciones/:id', verificarToken, requiereAdmin, async (req, res) => {
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

// 4. Cambiar estado con descuento automático de stock al marcar 'Entregado'
app.put('/api/reparaciones/:id/estado', verificarToken, requiereAdmin, async (req, res) => {
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

// 5. Eliminar orden de trabajo (Solo ADMIN)
app.delete('/api/reparaciones/:id', verificarToken, requiereAdmin, (req, res) => {
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
   12. SISTEMA DE RESPALDOS AUTOMÁTICOS (MYSQLDUMP BACKUPS)
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

    exec(comando, (error) => {
        if (error) {
            console.error(`❌ Error al ejecutar el backup: ${error.message}`);
            return;
        }
        console.log(`✅ ¡Backup creado con éxito! Guardado en: ${rutaDestino}`);
        limpiarBackupsViejos(rutaCarpeta, 7);
        copiarBackupAUbicacionExterna(rutaDestino, nombreArchivo);
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

let avisoOffsiteMostrado = false;

function copiarBackupAUbicacionExterna(rutaArchivoOrigen, nombreArchivo) {
    const carpetaExterna = process.env.BACKUP_OFFSITE_DIR;

    if (!carpetaExterna) {
        if (!avisoOffsiteMostrado) {
            console.log('ℹ️  BACKUP_OFFSITE_DIR no está configurado en .env.');
            avisoOffsiteMostrado = true;
        }
        return;
    }

    if (!fs.existsSync(carpetaExterna)) {
        console.error(`❌ BACKUP_OFFSITE_DIR apunta a una carpeta que no existe: ${carpetaExterna}`);
        return;
    }

    const rutaDestinoExterno = path.join(carpetaExterna, nombreArchivo);

    fs.copyFile(rutaArchivoOrigen, rutaDestinoExterno, (err) => {
        if (err) {
            console.error(`❌ No se pudo copiar el backup a la carpeta externa: ${err.message}`);
            return;
        }
        console.log(`☁️  Backup copiado también a la carpeta externa: ${rutaDestinoExterno}`);
        limpiarBackupsViejos(carpetaExterna, 7);
    });
}

cron.schedule('0 20 * * *', () => {
    realizarBackup();
}, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
});

/* ==========================================================================
   13. INICIALIZACIÓN Y PUESTA EN MARCHA DEL SERVIDOR
   ========================================================================== */
app.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor de Service Integral activo.`);
    console.log(`🔒 Escuchando en el puerto ${PORT}.`);
});