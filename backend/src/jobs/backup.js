/* ==========================================================================
   BACKUP ROBUSTO DE LA BASE DE DATOS
   --------------------------------------------------------------------------
   Reemplaza la version anterior que:
     - usaba exec() con redireccion ">" de shell (fragil en Windows)
     - escrevia directo al archivo final (un fallo dejaba un .sql truncado
       con nombre de backup valido, indistinguible de uno bueno)
     - no verificaba integridad ni el exit code real de mysqldump
     - pasaba la contrasena en la linea de comandos (visible en wmic process)
     - no tenia timeout
     - etiquetaba los archivos 3 horas adelante (toISOString = UTC)

   Ahora: execFile sin shell, MYSQL_PWD, escritura atomica con .tmp,
   verificacion obligatoria de "Dump completed" antes de publicar.

   NO carga dotenv a proposito: lo hace quien lo usa (server.js o el CLI),
   asi no se ejecuta dos veces.
   ========================================================================== */
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const RETENCION_DIAS_DEFAULT = 30;
const TIMEOUT_MS_DEFAULT = 15 * 60 * 1000; // 15 min
const TAMANO_MINIMO_BYTES = 200;            // por debajo, es basura

/* NOTA_ROUTINES
   El dump excluye rutinas y eventos a proposito: el usuario de MySQL de la
   aplicacion no tiene los privilegios EVENT ni ROUTINE, y sin esos flags
   mysqldump aborta. Este sistema no los usa.
   Si alguna vez se agregan ROUTINAS o EVENTOS, hay dos caminos:
     a) el flag mas simple: dar el privilegio correspondente al usuario
     b) un usuario de MySQL dedicado solo para backup, con esos privilegios
   Al migrar a base-por-empresa, la opcion (b) es la correcta: el usuario
   de la app no deberia tener nunca permisos de backup.
*/

/**
 * Timestamp en hora LOCAL. El bug anterior usaba toISOString() (UTC),
 * etiquetando los backups 3 horas adelante en Argentina.
 */
function timestampLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
           `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * Ejecuta mysqldump y devuelve un dump verificado, o lanza error.
 * Nunca deja un archivo corrupto con nombre de backup.
 */
function ejecutarDump(opciones = {}) {
    const {
        dbName    = process.env.DB_NAME,
        dbUser    = process.env.DB_USER,
        dbPassword= process.env.DB_PASSWORD,
        dbHost    = process.env.DB_HOST || 'localhost',
        dbPort    = process.env.DB_PORT || '3306',
        mysqldumpPath = process.env.MYSQLDUMP_PATH || 'mysqldump',
        carpetaDestino = path.join(__dirname, '..', '..', 'backups'),
        timeoutMs = TIMEOUT_MS_DEFAULT
    } = opciones;

    if (!dbName || !dbUser) {
        return Promise.reject(new Error('Faltan DB_NAME o DB_USER en la configuracion.'));
    }

    fs.mkdirSync(carpetaDestino, { recursive: true });

    const nombreArchivo = `backup_${dbName}_${timestampLocal()}.sql`;
    const rutaFinal  = path.join(carpetaDestino, nombreArchivo);
    const rutaTmp    = rutaFinal + '.tmp';

    // --single-transaction : snapshot consistente, NO requiere LOCK TABLES
    // --no-tablespaces     : NO requiere el privilegio PROCESS
    // --set-gtid-purged=OFF: evita warnings y hace el dump portable
    // --triggers           : los triggers van incluidos (no exige privilegio extra)
    // NO se pasan --routines ni --events: el usuario de la app no tiene esos
    // privilegios y el dump aborta. Ver NOTA_ROUTINES mas abajo.
    const args = [
        `-h${dbHost}`, `-P${dbPort}`, `-u${dbUser}`,
        '--single-transaction',
        '--no-tablespaces',
        '--set-gtid-purged=OFF',
        '--triggers',
        '--default-character-set=utf8mb4',
        '--result-file=' + rutaTmp,   // mysqldump escribe el archivo el mismo
        dbName
    ];

    return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = execFile(mysqldumpPath, args, {
            // La contrasena viaja por entorno, NO aparece en la linea de comandos
            env: { ...process.env, MYSQL_PWD: dbPassword },
            timeout: timeoutMs,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true
        }, (error, stdout, stderr) => {
            const duracion = ((Date.now() - started) / 1000).toFixed(1);

            if (error) {
                if (fs.existsSync(rutaTmp)) { try { fs.unlinkSync(rutaTmp); } catch {} }
                return reject(Object.assign(
                    new Error(`mysqldump fallo (${duracion}s): ${error.message}` +
                              (stderr ? ` | ${stderr.trim().slice(0, 400)}` : '')),
                    { stderr, duracionSeg: Number(duracion) }
                ));
            }

            // ---- VERIFICACION DE INTEGRIDAD ----
            // Un exit code 0 NO garantiza un dump completo. Hay que abrirlo.
            if (!fs.existsSync(rutaTmp)) {
                return reject(new Error('mysqldump termino bien pero no genero archivo.'));
            }
            const tamano = fs.statSync(rutaTmp).size;
            if (tamano < TAMANO_MINIMO_BYTES) {
                try { fs.unlinkSync(rutaTmp); } catch {}
                return reject(new Error(`Dump sospechosamente pequeno (${tamano} bytes). Descartado.`));
            }
            const contenido = fs.readFileSync(rutaTmp, 'utf8');
            if (!contenido.includes('Dump completed')) {
                try { fs.unlinkSync(rutaTmp); } catch {}
                return reject(new Error('El dump no contiene "Dump completed". Archivo incompleto, descartado.'));
            }

            // Publicacion ATOMICA: rename en el mismo volumen, instantaneo y seguro
            fs.renameSync(rutaTmp, rutaFinal);

            resolve({
                ok: true,
                ruta: rutaFinal,
                nombreArchivo,
                bytes: tamano,
                duracionSeg: Number(duracion),
                tablas: (contenido.match(/^CREATE TABLE/gm) || []).length
            });
        });
    });
}

function limpiarBackupsViejos(carpetaDestino, dias = RETENCION_DIAS_DEFAULT) {
    if (!fs.existsSync(carpetaDestino)) return 0;
    const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
    let eliminados = 0;
    for (const f of fs.readdirSync(carpetaDestino)) {
        if (!f.endsWith('.sql')) continue;              // no tocar .tmp
        const ruta = path.join(carpetaDestino, f);
        try {
            if (fs.statSync(ruta).mtimeMs < limite) { fs.unlinkSync(ruta); eliminados++; }
        } catch {}
    }
    return eliminados;
}

/**
 * Copia el backup a una ubicacion externa. Devuelve info, no lanza:
 * un fallo de la copia offsite no debe invalidar un backup local correcto.
 */
function copiarOffsite(rutaOrigen, nombreArchivo) {
    const carpeta = process.env.BACKUP_OFFSITE_DIR;
    if (!carpeta) return { ok: false, motivo: 'BACKUP_OFFSITE_DIR no configurado' };
    if (!fs.existsSync(carpeta)) return { ok: false, motivo: `carpeta no existe: ${carpeta}` };
    try {
        const destino = path.join(carpeta, nombreArchivo);
        fs.copyFileSync(rutaOrigen, destino);
        limpiarBackupsViejos(carpeta, RETENCION_DIAS_DEFAULT);
        return { ok: true, destino };
    } catch (e) {
        return { ok: false, motivo: e.message };
    }
}

/**
 * Corrige el desfase de zona horaria: los nombres viejos dicen 23:00:00
 * pero el backup se genera a las 20:00 hora local.
 */
function renombrarBackupsConZonaIncorrecta(carpetaDestino) {
    if (!fs.existsSync(carpetaDestino)) return 0;
    let renombrados = 0;
    for (const f of fs.readdirSync(carpetaDestino)) {
        const m = f.match(/^(backup_.+)_(\d{4}-\d{2}-\d{2})_23-00-00\.sql$/);
        if (!m) continue;
        const nuevo = `${m[1]}_${m[2]}_${timestampLocal().slice(11)}.sql`;
        try { fs.renameSync(path.join(carpetaDestino, f), path.join(carpetaDestino, nuevo)); renombrados++; }
        catch {}
    }
    return renombrados;
}

module.exports = {
    ejecutarDump,
    limpiarBackupsViejos,
    copiarOffsite,
    renombrarBackupsConZonaIncorrecta,
    timestampLocal,
    RETENCION_DIAS_DEFAULT
};
