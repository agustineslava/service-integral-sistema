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

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_service_integral_2026';

/* ==========================================================================
   2. MIDDLEWARES DE LA APLICACIÓN
   ========================================================================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

/* ==========================================================================
   3. CONFIGURACIÓN DE MULTIMEDIA (CLOUDINARY & MULTER)
   ========================================================================== */
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

// Función para asegurar que el usuario Administrador existe con el hash correcto
function crearUsuarioAdminInicial() {
    const emailAdmin = 'aguseslava11@gmail.com';
    const passwordPlana = 'Agus1tin';
    
    // Generar hash válido con bcryptjs directamente en Node.js
    const passwordHash = bcrypt.hashSync(passwordPlana, 10);

    const query = `
        INSERT INTO usuarios (nombre, email, password, rol) 
        VALUES (?, ?, ?, 'ADMIN')
        ON DUPLICATE KEY UPDATE password = ?;
    `;

    db.query(query, ['Agustín Eslava', emailAdmin, passwordHash, passwordHash], (err) => {
        if (err) {
            console.error('❌ Error al verificar/crear usuario Admin:', err);
        } else {
            console.log('✅ Usuario Administrador listo: aguseslava11@gmail.com / Agus1tin');
        }
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
   5. ENDPOINTS DE AUTENTICACIÓN Y GESTIÓN DE USUARIOS
   ========================================================================== */

/**
 * POST /api/login
 * Autentica usuario y devuelve Token JWT + información del perfil
 */
app.post('/api/login', (req, res) => {
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
app.post('/api/usuarios', (req, res) => {
    const { nombre, email, password, rol } = req.body;

    if (!nombre || !email || !password) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    // Encriptar la contraseña elegida
    const passwordHash = bcrypt.hashSync(password, 10);
    const rolUsuario = rol || 'TECNICO';

    const sql = 'INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)';
    db.query(sql, [nombre, email, passwordHash, rolUsuario], (err, result) => {
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

/* ==========================================================================
   6. ENDPOINTS DE PRODUCTOS / STOCK (C.R.U.D.)
   ========================================================================== */

app.get('/api/productos', (req, res) => {
    const sql = 'SELECT * FROM productos ORDER BY id DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error al traer productos:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(results);
    });
});

app.post('/api/productos', (req, res) => {
    const { 
        nombre, precio, stock, stockMinimo, categoria, 
        distribuidor, codigoDistribuidor, descripcion, 
        imagen_1, imagen_2, imagen_3 
    } = req.body;

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

app.delete('/api/productos/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM productos WHERE id = ?';

    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error('Error al eliminar de MySQL:', err);
            return res.status(500).json({ error: 'Error al eliminar el producto' });
        }
        res.json({ mensaje: 'Producto eliminado correctamente' });
    });
});

app.put('/api/productos/:id', (req, res) => {
    const { id } = req.params;
    const { 
        nombre, precio, stock, stockMinimo, categoria, 
        distribuidor, codigoDistribuidor, descripcion, 
        imagen_1, imagen_2, imagen_3 
    } = req.body;

    const sql = `UPDATE productos 
                 SET nombre = ?, precio = ?, stock = ?, stockMinimo = ?, categoria = ?, 
                     distribuidor = ?, codigoDistribuidor = ?, descripcion = ?, 
                     imagen_1 = ?, imagen_2 = ?, imagen_3 = ? 
                 WHERE id = ?`;
    
    db.query(sql, [
        nombre, precio, stock, stockMinimo || 0, categoria || 'Otros',
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

app.post('/api/productos/:id/stock-minimo', (req, res) => {
    const { id } = req.params;
    const { stockMinimo } = req.body;

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

app.post('/api/pedidos', (req, res) => {
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

app.get('/api/pedidos', (req, res) => {
    const sql = 'SELECT * FROM pedidos ORDER BY fecha DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error al traer historial de pedidos:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(results);
    });
});

app.get('/api/pedidos/:id/items', (req, res) => {
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

app.post('/api/upload', upload.single('imagen'), (req, res) => {
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

app.post('/api/delete-image', (req, res) => {
    const { imageUrl } = req.body;

    if (!imageUrl) {
        return res.status(400).json({ error: 'Falta la URL de la imagen' });
    }

    try {
        const partesUrl = imageUrl.split('/');
        const indiceUpload = partesUrl.indexOf('upload');
        
        if (indiceUpload === -1) {
            return res.status(400).json({ error: 'La URL no pertenece a Cloudinary' });
        }

        const rutaConExtension = partesUrl.slice(indiceUpload + 2).join('/');
        const publicId = rutaConExtension.substring(0, rutaConExtension.lastIndexOf('.'));

        cloudinary.uploader.destroy(publicId, (err, result) => {
            if (err) {
                console.error('❌ Error al borrar en Cloudinary:', err);
                return res.status(500).json({ error: 'No se pudo eliminar de la nube' });
            }
            res.json({ mensaje: 'Imagen eliminada de la nube con éxito', resultado: result });
        });

    } catch (error) {
        console.error('Error en el proceso de borrado:', error);
        res.status(500).json({ error: 'Error interno al procesar el borrado' });
    }
});

/* ==========================================================================
    9. MÓDULO: HISTORIAL DE MOVIMIENTOS Y AUDITORÍA DE STOCK
   ========================================================================== */
app.get('/api/movimientos-stock', (req, res) => {
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
   10. MÓDULO: ÓRDENES DE REPARACIÓN Y CLIENTES DE TALLER
   ========================================================================== */
app.get('/api/reparaciones', (req, res) => {
    const sql = 'SELECT * FROM reparaciones ORDER BY id DESC';
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('Error al obtener reparaciones:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(rows);
    });
});

app.post('/api/reparaciones', (req, res) => {
    const { 
        cliente_nombre, cliente_telefono, equipo, falla_declarada, 
        diagnostico_tecnico, repuestos_usados, costo_mano_obra, 
        costo_repuestos, estado, tecnico_asignado 
    } = req.body;

    if (!cliente_nombre || !equipo || !falla_declarada) {
        return res.status(400).json({ error: 'Cliente, equipo y falla declarada son obligatorios' });
    }

    const manoObra = parseFloat(costo_mano_obra) || 0.00;
    const repuestos = parseFloat(costo_repuestos) || 0.00;
    const total = manoObra + repuestos;

    const sql = `
        INSERT INTO reparaciones 
        (cliente_nombre, cliente_telefono, equipo, falla_declarada, diagnostico_tecnico, repuestos_usados, costo_mano_obra, costo_repuestos, total, estado, tecnico_asignado) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        cliente_nombre, cliente_telefono || null, equipo, falla_declarada,
        diagnostico_tecnico || null, repuestos_usados || null, manoObra, 
        repuestos, total, estado || 'Pendiente', tecnico_asignado || null
    ], (err, result) => {
        if (err) {
            console.error('Error al registrar reparación:', err);
            return res.status(500).json({ error: 'Error al registrar orden de trabajo' });
        }
        res.status(201).json({ mensaje: 'Orden de trabajo registrada', id: result.insertId });
    });
});

app.put('/api/reparaciones/:id/estado', (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    
    let sql = 'UPDATE reparaciones SET estado = ?';
    const params = [estado];

    if (estado === 'Entregado') {
        sql += ', fecha_entrega = NOW()';
    }
    sql += ' WHERE id = ?';
    params.push(id);

    db.query(sql, params, (err) => {
        if (err) {
            console.error('Error al actualizar estado:', err);
            return res.status(500).json({ error: 'Error al actualizar el estado' });
        }
        res.json({ mensaje: 'Estado actualizado con éxito' });
    });
});

/* ==========================================================================
   11. SISTEMA DE RESPALDOS AUTOMÁTICOS (MYSQLDUMP BACKUPS)
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

    const mysqldumpPath = 'D:\\Program Files\\MySQL\\MySQL Workbench 8.0 CE\\mysqldump.exe';
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
   12. INICIALIZACIÓN Y PUESTA EN MARCHA DEL SERVIDOR
   ========================================================================== */
app.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor de Service Integral activo.`);
    console.log(`🔒 Cerrado localmente en: http://192.168.0.99:${PORT}`);
});