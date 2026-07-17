/* ==========================================================================
   1. VARIABLES DE ENTORNO, DEPENDENCIAS Y LIBRERÍAS
   ========================================================================== */
// Carga las variables de entorno desde el archivo .env (Debe ser lo primero)
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

const app = express();

// Configuración de puertos e IP para el servidor local
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

/* ==========================================================================
   2. MIDDLEWARES DE LA APLICACIÓN
   ========================================================================== */
// Habilita CORS para permitir peticiones desde el frontend local
app.use(cors());
// Habilita el parseo de cuerpos en formato JSON
app.use(express.json());

/* ==========================================================================
   3. CONFIGURACIÓN DE MULTIMEDIA (CLOUDINARY & MULTER)
   ========================================================================== */
// Configura multer para almacenar temporalmente los archivos en la memoria RAM
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Credenciales para la conexión con el panel de Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ==========================================================================
   4. CONEXIÓN A LA BASE DE DATOS (MYSQL CONNECTION POOL)
   ========================================================================== */
// Pool de conexiones para optimizar y reutilizar accesos concurrentes a la base de datos
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10, // Cantidad máxima de conexiones simultáneas en paralelo
    queueLimit: 0
});

// Comprobación de estado inicial de conexión con MySQL
db.query('SELECT 1', (err) => {
    if (err) {
        console.error('❌ Error al conectar al Pool de MySQL:', err.message);
        return;
    }
    console.log('✅ Pool de conexiones de MySQL establecido con éxito de forma segura.');
});

/* ==========================================================================
   5. ENDPOINTS DE PRODUCTOS / STOCK (C.R.U.D.)
   ========================================================================== */

/**
 * GET /api/productos
 * Trae todos los productos registrados ordenados desde el más reciente
 */
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

/**
 * POST /api/productos
 * Crea y registra un nuevo repuesto en la tabla
 */
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

/**
 * DELETE /api/productos/:id
 * Elimina físicamente un repuesto por ID de la base de datos
 */
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

/**
 * PUT /api/productos/:id
 * Actualiza los datos generales de un componente del stock
 */
app.put('/api/productos/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, precio, stock, distribuidor, codigoDistribuidor, descripcion, imagen_1, imagen_2, imagen_3 } = req.body;

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

/**
 * POST /api/productos/:id/stock-minimo
 * Actualiza exclusivamente la regla de límite de stock mínimo de una pieza
 */
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
   6. ENDPOINTS DE PEDIDOS (CON TRANSACCIÓN Y AUTO-LIMPIEZA)
   ========================================================================== */

/**
 * POST /api/pedidos
 * Registra una orden de pre-pedido y limpia automáticamente históricos antiguos
 */
app.post('/api/pedidos', (req, res) => {
    const { notas, items } = req.body;

    // Iniciamos transacción para evitar registros incoherentes si falla la inserción
    db.beginTransaction((err) => {
        if (err) {
            console.error('❌ Error al iniciar transacción:', err);
            return res.status(500).json({ error: 'Error al procesar el pedido' });
        }

        // Paso A: Guardar cabecera del pedido (Notas y fecha)
        const sqlPedido = 'INSERT INTO pedidos (notas) VALUES (?)';
        db.query(sqlPedido, [notes = notas], (err, result) => {
            if (err) {
                return db.rollback(() => {
                    console.error('❌ Error al insertar pedido:', err);
                    res.status(500).json({ error: 'Error al registrar el pedido' });
                });
            }

            const pedidoId = result.insertId;

            // Paso B: Mapear y guardar la relación de artículos del pre-pedido
            const sqlItems = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad) VALUES ?';
            const valoresItems = items.map(item => [pedidoId, item.id, item.cantidad]);

            db.query(sqlItems, [valoresItems], (err) => {
                if (err) {
                    return db.rollback(() => {
                        console.error('❌ Error al insertar artículos del pedido:', err);
                        res.status(500).json({ error: 'Error al registrar los repuestos' });
                    });
                }

                // Paso C: Confirmar la transacción completa
                db.commit((err) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('❌ Error en commit:', err);
                            res.status(500).json({ error: 'Error al finalizar el pedido' });
                        });
                    }

                    console.log(`✅ Pedido #${pedidoId} guardado con éxito.`);

                    // Paso D: Optimización de Base de Datos (Limpieza automática de pedidos de más de 2 meses)
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

/**
 * GET /api/pedidos
 * Obtiene el historial completo de los pedidos guardados
 */
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

/**
 * GET /api/pedidos/:id/items
 * Trae los artículos vinculados a un pedido, con join a la tabla de productos para obtener nombres
 */
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
   7. ENDPOINTS MULTIMEDIA (CARGA Y BORRADO DE ARCHIVOS EN CLOUDINARY)
   ========================================================================== */

/**
 * POST /api/upload
 * Sube una imagen en base64 de forma comprimida y segura a Cloudinary
 */
app.post('/api/upload', upload.single('imagen'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Convertimos la imagen en buffer de RAM a base64 string para su transporte
    const fileBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    cloudinary.uploader.upload(fileBase64, {
        folder: 'service_integral', // Carpeta en el panel de Cloudinary
        transformation: [
            { width: 800, height: 800, crop: "limit" }, // Redimensionamiento preventivo
            { quality: "auto" },                       // Compresión inteligente del peso de imagen
            { fetch_format: "auto" }                    // Conversión inteligente de formato (ej: a WebP)
        ]
    }, (err, result) => {
        if (err) {
            console.error('❌ Error al subir a Cloudinary:', err);
            return res.status(500).json({ error: 'Error al subir la imagen' });
        }
        res.json({ url: result.secure_url });
    });
});

/**
 * POST /api/delete-image
 * Desvincula y destruye un archivo multimedia directamente desde el storage de Cloudinary
 */
app.post('/api/delete-image', (req, res) => {
    const { imageUrl } = req.body;

    if (!imageUrl) {
        return res.status(400).json({ error: 'Falta la URL de la imagen' });
    }

    try {
        // Extraemos el identificador exclusivo (Public ID) de la URL pública
        const partesUrl = imageUrl.split('/');
        const indiceUpload = partesUrl.indexOf('upload');
        
        if (indiceUpload === -1) {
            return res.status(400).json({ error: 'La URL no pertenece a Cloudinary' });
        }

        const rutaConExtension = partesUrl.slice(indiceUpload + 2).join('/');
        const publicId = rutaConExtension.substring(0, rutaConExtension.lastIndexOf('.'));

        console.log(`🧹 Intentando borrar de Cloudinary el Public ID: ${publicId}`);

        cloudinary.uploader.destroy(publicId, (err, result) => {
            if (err) {
                console.error('❌ Error al borrar en Cloudinary:', err);
                return res.status(500).json({ error: 'No se pudo eliminar de la nube' });
            }
            console.log(`✅ Foto eliminada con éxito de Cloudinary. Resultado:`, result);
            res.json({ mensaje: 'Imagen eliminada de la nube con éxito', resultado: result });
        });

    } catch (error) {
        console.error('Error en el proceso de borrado:', error);
        res.status(500).json({ error: 'Error interno al procesar el borrado' });
    }
});

/* ==========================================================================
   8. SISTEMA DE RESPALDOS AUTOMÁTICOS (MYSQLDUMP BACKUPS)
   ========================================================================== */

/**
 * Genera una exportación estructurada .sql de la base de datos de MySQL
 */
function realizarBackup() {
    const dbName = process.env.DB_NAME;
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbHost = process.env.DB_HOST || 'localhost';

    // Capturamos la marca de tiempo exacta para nombrar el backup
    const fechaActual = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    const nombreArchivo = `backup_${dbName}_${fechaActual}.sql`;
    const rutaCarpeta = path.join(__dirname, 'backups');
    const rutaDestino = path.join(rutaCarpeta, nombreArchivo);

    // Asegurarse de la presencia de la carpeta de respaldos locales
    if (!fs.existsSync(rutaCarpeta)) {
        fs.mkdirSync(rutaCarpeta, { recursive: true });
    }

    // Ubicación predeterminada para mysqldump en tu sistema Windows
    const mysqldumpPath = 'D:\\Program Files\\MySQL\\MySQL Workbench 8.0 CE\\mysqldump.exe';
    const comando = `"${mysqldumpPath}" -h ${dbHost} -u ${dbUser} -p"${dbPassword}" ${dbName} > "${rutaDestino}"`;

    console.log(`💾 Iniciando backup automático de la base de datos...`);

    exec(comando, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Error al ejecutar el backup: ${error.message}`);
            return;
        }
        if (stderr && !stderr.includes('Using a password on the command line interface can be insecure')) {
            console.warn(`⚠️ Advertencia durante el backup: ${stderr}`);
            return;
        }
        console.log(`✅ ¡Backup creado con éxito! Guardado en: ${rutaDestino}`);
        
        // Ejecutar rutina de rotación para conservar solo respaldos de la última semana
        limpiarBackupsViejos(rutaCarpeta, 7);
    });
}

/**
 * Elimina los archivos .sql que superen el periodo de retención especificado
 * @param {string} rutaCarpeta - Ubicación física de los respaldos
 * @param {number} diasRetencion - Días de retención deseados
 */
function limpiarBackupsViejos(rutaCarpeta, diasRetencion) {
    fs.readdir(rutaCarpeta, (err, archivos) => {
        if (err) return console.error('Error al leer la carpeta de backups:', err);

        const limiteTiempo = Date.now() - (diasRetencion * 24 * 60 * 60 * 1000);

        archivos.forEach(archivo => {
            const rutaArchivo = path.join(rutaCarpeta, archivo);
            fs.stat(rutaArchivo, (errStat, stats) => {
                if (errStat) return;

                if (stats.mtimeMs < limiteTiempo && archivo.endsWith('.sql')) {
                    fs.unlink(rutaArchivo, (errUnlink) => {
                        if (errUnlink) console.error(`Error al borrar backup viejo ${archivo}:`, errUnlink);
                        else console.log(`🧹 Limpieza: Se eliminó el backup antiguo obsoleto: ${archivo}`);
                    });
                }
            });
        });
    });
}

/* ==========================================================================
   9. PROGRAMACIÓN DE TAREAS CRON (BACKUPS PROGRAMADOS)
   ========================================================================== */
// Ejecuta el backup diario automáticamente a las 20:00 hs (Hora del negocio en Chacabuco)
cron.schedule('0 20 * * *', () => {
    realizarBackup();
}, {
    scheduled: true,
    timezone: "America/Argentina/Buenos_Aires" 
});

// Nota: Si querés verificar el funcionamiento del backup apenas corre el servidor local,
// simplemente descomentá la siguiente línea:
// realizarBackup();

/* ==========================================================================
   10. INICIALIZACIÓN Y PUESTA EN MARCHA DEL SERVIDOR
   ========================================================================== */
app.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor de Service Integral activo.`);
    console.log(`🔒 Cerrado localmente en: http://${HOST}:${PORT}`);
});