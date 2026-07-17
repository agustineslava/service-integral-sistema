// 🌟 1. Cargar las variables de entorno desde el archivo .env (Debe ser la primera línea)
require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();
// 🌟 2. Usar las variables de entorno para el Servidor (con valores por defecto por si falla algo)
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
app.use(cors());
app.use(express.json());

// Conexión a tu Base de Datos MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,       // Cantidad máxima de conexiones simultáneas que puede abrir en paralelo
    queueLimit: 0
});

db.query('SELECT 1', (err) => {
    if (err) {
        console.error('❌ Error al conectar al Pool de MySQL:', err.message);
        return;
    }
    console.log('✅ Pool de conexiones de MySQL establecido con éxito de forma segura.');
});

// 1. RUTA: TRAER TODOS LOS PRODUCTOS
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

// 3. RUTA: ELIMINAR UN PRODUCTO POR ID
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

// 4. RUTA: ACTUALIZAR DATOS GENERALES (Nombre, Precio, Stock) POR ID
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
        
        // 🌟 CLAVE: Responder con estado de éxito rotundo y JSON limpio
        res.status(200).json({ mensaje: 'Producto actualizado con éxito' });
    });
});

// 5. RUTA: MODIFICAR ÚNICAMENTE EL STOCK MÍNIMO POR ID
app.post('/api/productos/:id/stock-minimo', (req, res) => {
    // Nota: Como algunos entornos locales viejos bloquean PATCH, usamos POST con ruta extendida para asegurar compatibilidad
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

// 6. RUTA: GUARDAR UN PEDIDO NUEVO (Y limpiar pedidos de más de 2 meses)
app.post('/api/pedidos', (req, res) => {
    const { notas, items } = req.body;

    // Iniciamos una transacción para asegurarnos de que se guarde el pedido y sus artículos, o nada
    db.beginTransaction((err) => {
        if (err) {
            console.error('❌ Error al iniciar transacción:', err);
            return res.status(500).json({ error: 'Error al procesar el pedido' });
        }

        // Paso A: Insertar la cabecera del pedido
        const sqlPedido = 'INSERT INTO pedidos (notas) VALUES (?)';
        db.query(sqlPedido, [notas], (err, result) => {
            if (err) {
                return db.rollback(() => {
                    console.error('❌ Error al insertar pedido:', err);
                    res.status(500).json({ error: 'Error al registrar el pedido' });
                });
            }

            const pedidoId = result.insertId;

            // Paso B: Preparar los artículos del pedido
            // Estructuramos una consulta múltiple para insertar todos los repuestos juntos
         const sqlItems = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad) VALUES ?';
            const valoresItems = items.map(item => [pedidoId, item.id, item.cantidad]);

            // Ejecutamos pasando el array bidimensional envuelto en otro array [valoresItems]
            db.query(sqlItems, [valoresItems], (err) => {
                if (err) {
                    return db.rollback(() => {
                        console.error('❌ Error al insertar artículos del pedido:', err);
                        res.status(500).json({ error: 'Error al registrar los repuestos' });
                    });
                }

                // Paso C: Confirmar los cambios de este pedido
                db.commit((err) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('❌ Error en commit:', err);
                            res.status(500).json({ error: 'Error al finalizar el pedido' });
                        });
                    }

                    console.log(`✅ Pedido #${pedidoId} guardado con éxito.`);

                    // 🌟 PASO D: LIMPIEZA AUTOMÁTICA (Borrar pedidos de hace más de 2 meses / 60 días)
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

// 7. RUTA: TRAER EL HISTORIAL GENERAL DE PEDIDOS (Ordenados por fecha reciente)
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

// 8. RUTA: TRAER LOS ARTÍCULOS DE UN PEDIDO ESPECÍFICO POR ID
app.get('/api/pedidos/:id/items', (req, res) => {
    const { id } = req.params;
    
    // Hacemos un JOIN para traer el nombre del producto y el código distribuidor real de la tabla productos
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

// 🌟 NUEVA RUTA: SUBIR IMAGEN A CLOUDINARY
app.post('/api/upload', upload.single('imagen'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Convertimos el archivo en memoria a formato base64 para enviarlo a Cloudinary
    const fileBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    cloudinary.uploader.upload(fileBase64, {
        folder: 'service_integral', // Carpeta organizada en tu cuenta de Cloudinary
        transformation: [
            { width: 800, height: 800, crop: "limit" }, // Redimensiona si excede 800px
            { quality: "auto" },                       // Optimiza el peso automáticamente
            { fetch_format: "auto" }                    // Convierte a WebP si el navegador lo soporta
        ]
    }, (err, result) => {
        if (err) {
            console.error('❌ Error al subir a Cloudinary:', err);
            return res.status(500).json({ error: 'Error al subir la imagen' });
        }
        
        // Devolvemos la URL segura optimizada por Cloudinary
        res.json({ url: result.secure_url });
    });
});

// 🌟 FUNCIÓN QUE REALIZA EL BACKUP DE MYSQL
function realizarBackup() {
    const dbName = process.env.DB_NAME;
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbHost = process.env.DB_HOST || 'localhost';

    // Generamos un nombre de archivo único con la fecha y hora de Chacabuco
    const fechaActual = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    const nombreArchivo = `backup_${dbName}_${fechaActual}.sql`;
    const rutaCarpeta = path.join(__dirname, 'backups');
    const rutaDestino = path.join(rutaCarpeta, nombreArchivo);

    // Nos aseguramos de que la carpeta 'backups' realmente exista, si no, la crea
    if (!fs.existsSync(rutaCarpeta)) {
        fs.mkdirSync(rutaCarpeta, { recursive: true });
    }

    // Comando de consola para exportar la base de datos (mysqldump)
    // Nota: Si usas una contraseña con caracteres especiales, la envolvemos en comillas dobles
    // Buscar esta línea dentro de realizarBackup() y reemplazarla:
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
        
        // OPCIONAL: Limpieza automática de backups viejos (mantiene solo los últimos 7 días)
        limpiarBackupsViejos(rutaCarpeta, 7);
    });
}

// Función auxiliar para borrar backups que tengan más de 'diasRetencion' días
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

// 🌟 CONFIGURACIÓN DE LA TAREA AUTOMÁTICA (node-cron)
// Se ejecuta TODOS los días a las 20:00 hs (Formato Cron: minuto hora día-mes mes día-semana)
cron.schedule('0 20 * * *', () => {
    realizarBackup();
}, {
    scheduled: true,
    timezone: "America/Argentina/Buenos_Aires" 
});

// 💡 DEPRUACIÓN: Si querés probar que ande apenas encendés el servidor sin esperar a las 20:00 hs,
// desmarcala de abajo para que corra una vez al arrancar:
// realizarBackup();

// 🌟 NUEVA RUTA: BORRAR IMAGEN DIRECTAMENTE DE CLOUDINARY
app.post('/api/delete-image', (req, res) => {
    const { imageUrl } = req.body;

    if (!imageUrl) {
        return res.status(400).json({ error: 'Falta la URL de la imagen' });
    }

    try {
        // Extraemos el "Public ID" de la URL de Cloudinary
        // Ejemplo de URL: https://res.cloudinary.com/tu_cloud/image/upload/v12345/service_integral/foto.jpg
        // Queremos obtener: "service_integral/foto" (sin la extensión .jpg)
        const partesUrl = imageUrl.split('/');
        const indiceUpload = partesUrl.indexOf('upload');
        
        if (indiceUpload === -1) {
            return res.status(400).json({ error: 'La URL no pertenece a Cloudinary' });
        }

        // Tomamos todo lo que está después de la versión (ej: "v12345/service_integral/foto.jpg")
        const rutaConExtension = partesUrl.slice(indiceUpload + 2).join('/'); // "service_integral/foto.jpg"
        const publicId = rutaConExtension.substring(0, rutaConExtension.lastIndexOf('.')); // "service_integral/foto"

        console.log(`🧹 Intentando borrar de Cloudinary el Public ID: ${publicId}`);

        // Le pedimos a Cloudinary que destruya el archivo
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

// Levantar el servidor bloqueado por IP local
app.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor de Service Integral activo.`);
    console.log(`🔒 Cerrado localmente en: http://${HOST}:${PORT}`);
});