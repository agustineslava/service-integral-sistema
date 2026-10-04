/* ==========================================================================
   REPORTES
   ==========================================================================
   Los seis reportes del módulo `reportes`. Todo lo de esta pantalla sale de
   acá: las consultas, los nombres de las columnas y cómo se arma el CSV.

   POR QUÉ ESTÁ EN UN SERVICIO Y NO DENTRO DE server.js
   --------------------------------------------------------------------------
   server.js ya tiene 3900 líneas y las rutas van pegadas una a otra. Los
   reportes se diferencian del resto en tres cosas que, si están repetidas seis
   veces, alguno de los seis las va a hacer distinto:

     1. la validación del rango de fechas,
     2. el formato del CSV,
     3. el nombre de las columnas.

   Adentro de server.js cada reporte repetiría esas tres cosas y el que se
   olvidara de una no se vería en ningún lado. Acá hay UNA copia de cada una y
   los seis reportes son datos.

   LO QUE NO SE HACE ACÁ, Y POR QUÉ
   --------------------------------------------------------------------------
   No hay `require('mysql2')` ni `obtenerPool` en este archivo. El `db` lo pasa
   quien llama, y quien llama es `server.js`, que lo saca del contexto de la
   sesión. Es el mismo camino que usan las otras 28 rutas, y es la razón por la
   que un reporte de la empresa 2 no puede terminar mirando los datos de la
   empresa 1: este archivo no tiene con qué mirar otra base.

   Si alguien mete un `obtenerPool` acá, el verificador lo avisa.

   EL RANGO DE FECHAS NUNCA SE PEGA AL SQL
   --------------------------------------------------------------------------
   `desde` y `hasta` se validan contra `AAAA-MM-DD` y se mandan como
   PARÁMETRO. En ningún punto de este archivo se arma una frase de SQL
   concatenando lo que vino en el query string. El código del reporte tampoco:
   sale de `REPORTES`, que es un objeto de este archivo, no de la petición.

   COTA SUPERIOR EXCLUSIVA
   --------------------------------------------------------------------------
   El filtro de arriba es `< hasta + 1 día`, nunca `<= hasta`. La razón es que
   las fechas del sistema no son todas del mismo tipo:

       facturas.fecha               DATE
       presupuestos.creado_en       DATETIME
       reparaciones.fecha_ingreso   TIMESTAMP

   Con `<= '2026-10-31'` una columna DATE incluye todo el día 31, pero una
   DATETIME incluye solo la medianoche: el reporte pierde la factura emitida a
   las 16:00. Con `< '2026-11-01'` las tres columnas incluyen el día 31
   entero y el resultado es el mismo para las tres, que es lo que quiere
   alguien que pide "de octubre".

   LO QUE CUENTA COMO VENTA
   --------------------------------------------------------------------------
   Una factura `BORRADOR` no se emitió y una `ANULADA` se dio de baja. Sumarlas
   sería vender dos veces lo mismo o contar como plata algo que nadie compró.
   Los tres reportes que miran plata usan `estado IN ('EMITIDA','PAGADA')`, y
   el de cuentas por cobrar usa `estado = 'EMITIDA'`, que es exactamente lo que
   significa "emitida y todavía no pagada".

   El nombre del repuesto sale del CATÁLOGO, no del renglón
   --------------------------------------------------------------------------
   `factura_items.descripcion` es una foto del nombre el día de la factura. Si
   el repuesto se renombra, el reporte tiene que decir el nombre nuevo (es el
   reporte de "qué vendo hoy"), así que se usa `productos.nombre` cuando existe
   el producto, y la foto solo cuando el renglón no viene del catálogo. Para que
   el total del reporte cuadre con el de la factura, los importes salen de los
   valores GUARDADOS (`factura_items.subtotal`, que es el bruto) y no de
   recalcular la multiplicación: la única pieza que hay que calcular es el IVA,
   que no se guarda por renglón.

   EL CSV
   --------------------------------------------------------------------------
   Sale del servidor, no del navegador, y con la misma consulta que la pantalla.
   Si cada lado arman el archivo por su cuenta, con el tiempo uno se va a
   desfasar del otro y el archivo va a dejar de ser el reporte.

   Tres cosas que hacen falta y que no son obvias:

   - El BOM (`﻿`) al principio. Excel en Windows, con la configuración de
     Argentina, abre un CSV sin BOM en ANSI y convierte las tildes y la eñe en
     caracteres raros. El archivo está bien; lo que está mal es cómo lo lee.

   - Los números CRUDOS. En el JSON van crudos y el navegador los formatea para
     pintar; en el CSV van crudos y Excel los suma. Si el CSV saliera con
     `$ 5.000,00`, la columna sería texto y `SUM` daría cero.

   - El prefijo `'` en los textos que arrancan con `=`, `+`, `-` o `@`. Excel y
     LibreOffice los ejecutan como fórmula: un producto llamado
     `=HYPERLINK("http://x","Entrar")` se convierte en un enlace que se abre
     solo cuando alguien abre el archivo. Los nombres y las notas los escribe
     el usuario, así que no es una amenaza teórica. A los números NO se les
     toca el prefijo: `-1234.56` es un número negativo, no una fórmula.
   ========================================================================== */

/* Los estados de `facturas.estado`. El ENUM de MySQL tiene exactamente estos
   cuatro; si la migración cambia, el verificador compara las dos listas. */
const ESTADOS_FACTURA_VENDIDA = ['EMITIDA', 'PAGADA'];
const ESTADO_FACTURA_PENDIENTE = 'EMITIDA';

/* Los estados de `presupuestos.estado`. Un presupuesto en BORRADOR nunca se
   envió, así que no cuenta ni para el numerador ni para el denominador de la
   conversión. */
const ESTADO_PRESUPUESTO_APROBADO = 'APROBADO';
const ESTADOS_PRESUPUESTO_DECIDIDO = ['ENVIADO', 'APROBADO', 'RECHAZADO'];

/** Estados de `reparaciones.estado` que no son trabajo real para el taller. */
const ESTADO_REPARACION_CANCELADA = 'Cancelado';

/** Una fecha que existe de verdad, no solo una que tiene la forma. */
const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function fechaReal(valor) {
    if (typeof valor !== 'string' || !RE_ISO.test(valor)) return false;
    const [anio, mes, dia] = valor.split('-').map(Number);
    const f = new Date(0);
    f.setUTCHours(0, 0, 0, 0);
    f.setUTCFullYear(anio, mes - 1, dia);
    return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

/** Un día después de una fecha, en el mismo formato. Suma en UTC, sin sorpresas de zona horaria. */
function diaSiguiente(iso) {
    const [anio, mes, dia] = iso.split('-').map(Number);
    const f = new Date(0);
    f.setUTCHours(0, 0, 0, 0);
    f.setUTCFullYear(anio, mes - 1, dia + 1);
    return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`;
}

/** Número con dos decimales, igual que el `a2()` de server.js. */
const a2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Un `COALESCE` para que `SUM` de una tabla vacía no devuelva NULL. */
const n2 = (v) => a2(Number(v) || 0);

const col = (clave, titulo, tipo) => ({ clave, titulo, tipo });

/* ==========================================================================
   LOS SEIS REPORTES
   --------------------------------------------------------------------------
   Cada uno declara sus columnas con nombre y tipo. El tipo es lo que permite
   que las seis tablas se pinten con la misma función: no hay un `if (columna
   === 'total')` por reporte, hay un formateador por tipo.

   `consulta` devuelve el texto y los parámetros. Devuelve el `params` porque el
   orden depende de dónde cae el filtro en el `WHERE` de cada consulta, y
   obligar a que todas lo pongan en el mismo lugar obligaría a escribir el SQL
   más raro del mundo.
   ========================================================================== */
const REPORTES = {

    'ventas-por-mes': {
        titulo: 'Ventas por mes',
        descripcion: 'Cuánto se facturó, agrupado por mes. Solo cuenta facturas emitidas y pagadas.',
        columnas: [
            col('mes', 'Mes', 'mes'),
            col('facturas', 'Facturas', 'entero'),
            col('neto', 'Neto', 'pesos'),
            col('iva', 'IVA', 'pesos'),
            col('total', 'Total', 'pesos')
        ],
        consulta(lim) {
            return {
                sql: `SELECT DATE_FORMAT(f.fecha, '%Y-%m') AS mes,
                             COUNT(*) AS facturas,
                             COALESCE(SUM(f.subtotal), 0) - COALESCE(SUM(f.descuento), 0) AS neto,
                             COALESCE(SUM(f.iva_monto), 0) AS iva,
                             COALESCE(SUM(f.total), 0) AS total
                      FROM facturas f
                      WHERE f.estado IN ('EMITIDA', 'PAGADA')
                      ${lim.sql}
                      GROUP BY mes
                      ORDER BY mes ASC`,
                params: lim.params
            };
        },
        resumen(filas) {
            const total = filas.reduce((a, f) => a + n2(f.total), 0);
            const facturas = filas.reduce((a, f) => a + Number(f.facturas || 0), 0);
            const mejor = filas.reduce((a, f) => (n2(f.total) > n2(a.total) ? f : a), filas[0] || { total: 0, mes: '' });
            return [
                { etiqueta: 'Total del período', valor: total, tipo: 'pesos' },
                { etiqueta: 'Facturas', valor: facturas, tipo: 'entero' },
                { etiqueta: 'Meses con ventas', valor: filas.length, tipo: 'entero' },
                { etiqueta: 'Mejor mes', valor: mejor.mes || '—', tipo: 'mes' }
            ];
        }
    },

    'facturacion-por-cliente': {
        titulo: 'Facturación por cliente',
        descripcion: 'Cuánto le facturamos a cada cliente, y cuándo fue la última vez.',
        columnas: [
            col('cliente', 'Cliente', 'texto'),
            col('facturas', 'Facturas', 'entero'),
            col('total', 'Total', 'pesos'),
            col('primera', 'Primera factura', 'fecha'),
            col('ultima', 'Última factura', 'fecha')
        ],
        consulta(lim) {
            /* El nombre se agrupa por la MISMA expresión que se elige en el SELECT.
               Agrupar por `f.cliente_id` solo parte los renglones del mismo
               cliente cuando el nombre cambió, que es justo cuando el reporte
               tiene que juntarlos. */
            const nombre = "COALESCE(NULLIF(TRIM(f.cliente_nombre), ''), 'Cliente eliminado')";
            return {
                sql: `SELECT ${nombre} AS cliente,
                             COUNT(*) AS facturas,
                             COALESCE(SUM(f.total), 0) AS total,
                             MIN(f.fecha) AS primera,
                             MAX(f.fecha) AS ultima
                      FROM facturas f
                      WHERE f.estado IN ('EMITIDA', 'PAGADA')
                      ${lim.sql}
                      GROUP BY ${nombre}
                      ORDER BY total DESC, cliente ASC`,
                params: lim.params
            };
        },
        resumen(filas) {
            const total = filas.reduce((a, f) => a + n2(f.total), 0);
            const facturas = filas.reduce((a, f) => a + Number(f.facturas || 0), 0);
            return [
                { etiqueta: 'Facturado', valor: total, tipo: 'pesos' },
                { etiqueta: 'Clientes', valor: filas.length, tipo: 'entero' },
                {
                    etiqueta: 'Ticket promedio',
                    valor: facturas ? a2(total / facturas) : 0,
                    tipo: 'pesos'
                }
            ];
        }
    },

    'cuentas-por-cobrar': {
        titulo: 'Cuentas por cobrar',
        descripcion: 'Facturas emitidas del período que todavía no se pagaron, de la más antigua a la más nueva.',
        columnas: [
            col('numero', 'Nº', 'entero'),
            col('fecha', 'Emisión', 'fecha'),
            col('dias', 'Días', 'entero'),
            col('cliente', 'Cliente', 'texto'),
            col('telefono', 'Teléfono', 'texto'),
            col('forma_pago', 'Forma de pago', 'texto'),
            col('total', 'Total', 'pesos')
        ],
        consulta(lim) {
            return {
                sql: `SELECT f.numero AS numero,
                             f.fecha AS fecha,
                             DATEDIFF(CURDATE(), f.fecha) AS dias,
                             COALESCE(NULLIF(TRIM(f.cliente_nombre), ''), 'Cliente eliminado') AS cliente,
                             COALESCE(NULLIF(TRIM(f.cliente_telefono), ''), '') AS telefono,
                             COALESCE(NULLIF(TRIM(f.forma_pago), ''), '') AS forma_pago,
                             COALESCE(f.total, 0) AS total
                      FROM facturas f
                      WHERE f.estado = '${ESTADO_FACTURA_PENDIENTE}'
                        AND f.fecha_pago IS NULL
                      ${lim.sql}
                      ORDER BY dias DESC, f.fecha DESC`,
                params: lim.params
            };
        },
        resumen(filas) {
            const total = filas.reduce((a, f) => a + n2(f.total), 0);
            const viejo = filas.reduce((a, f) => Math.max(a, Number(f.dias || 0)), 0);
            const vencido = filas.filter((f) => Number(f.dias || 0) > 30).reduce((a, f) => a + n2(f.total), 0);
            return [
                { etiqueta: 'Total a cobrar', valor: total, tipo: 'pesos' },
                { etiqueta: 'Facturas impagas', valor: filas.length, tipo: 'entero' },
                { etiqueta: 'La más antigua', valor: viejo, tipo: 'dias' },
                { etiqueta: 'Más de 30 días', valor: vencido, tipo: 'pesos' }
            ];
        }
    },

    'repuestos-mas-vendidos': {
        titulo: 'Repuestos más vendidos',
        descripcion: 'Qué sale del depósito y cuánta plata mueve. Usa el nombre del catálogo, no el que tenía el renglón.',
        columnas: [
            col('repuesto', 'Repuesto', 'texto'),
            col('codigo', 'Código', 'texto'),
            col('cantidad', 'Cantidad', 'decimal'),
            col('facturas', 'Facturas', 'entero'),
            col('neto', 'Neto', 'pesos'),
            col('iva', 'IVA', 'pesos'),
            col('total', 'Total', 'pesos')
        ],
        consulta(lim) {
            /* `MAX(p.nombre)` y no `p.nombre`: MySQL con ONLY_FULL_GROUP_BY rechaza
               una columna que no está ni agrupada ni dentro de una función de
               agregado, y `fi.producto_id` no es clave única dentro del grupo
               (el mismo repuesto aparece en muchas facturas). Como el producto
               está determinado por el id, el MAX da ese único valor. */
            return {
                sql: `SELECT COALESCE(MAX(p.nombre), MAX(fi.descripcion)) AS repuesto,
                             COALESCE(MAX(NULLIF(TRIM(p.codigoDistribuidor), '')), '') AS codigo,
                             COALESCE(SUM(fi.cantidad), 0) AS cantidad,
                             COUNT(DISTINCT f.id) AS facturas,
                             COALESCE(SUM(fi.subtotal), 0) - COALESCE(SUM(fi.descuento), 0) AS neto,
                             COALESCE(SUM(ROUND((fi.subtotal - fi.descuento) * fi.iva_porcentaje / 100, 2)), 0) AS iva,
                             COALESCE(SUM(fi.subtotal), 0) - COALESCE(SUM(fi.descuento), 0)
                                 + COALESCE(SUM(ROUND((fi.subtotal - fi.descuento) * fi.iva_porcentaje / 100, 2)), 0) AS total
                      FROM factura_items fi
                      JOIN facturas f ON f.id = fi.factura_id
                      LEFT JOIN productos p ON p.id = fi.producto_id
                      WHERE f.estado IN ('EMITIDA', 'PAGADA')
                      ${lim.sql}
                      GROUP BY fi.producto_id
                      ORDER BY cantidad DESC, total DESC`,
                params: lim.params
            };
        },
        resumen(filas) {
            const total = filas.reduce((a, f) => a + n2(f.total), 0);
            const unidades = filas.reduce((a, f) => a + Number(f.cantidad || 0), 0);
            const tope = filas[0];
            return [
                { etiqueta: 'Facturado', valor: total, tipo: 'pesos' },
                { etiqueta: 'Unidades', valor: a2(unidades), tipo: 'decimal' },
                { etiqueta: 'Repuestos que giraron', valor: filas.length, tipo: 'entero' },
                { etiqueta: 'El que más sale', valor: (tope && tope.repuesto) || '—', tipo: 'texto' }
            ];
        }
    },

    'ordenes-de-reparacion': {
        titulo: 'Órdenes de reparación',
        descripcion: 'Qué entró al taller en el período, quién lo atender y cuánto quedó de margen.',
        columnas: [
            col('id', 'Nº', 'entero'),
            col('fecha_ingreso', 'Ingreso', 'fecha'),
            col('cliente', 'Cliente', 'texto'),
            col('equipo', 'Equipo', 'texto'),
            col('tecnico', 'Técnico', 'texto'),
            col('estado', 'Estado', 'texto'),
            col('total', 'Costo', 'pesos'),
            col('cobrado', 'Cobrado', 'pesos'),
            col('resultado', 'Resultado', 'pesos')
        ],
        consulta(lim) {
            return {
                sql: `SELECT r.id AS id,
                             r.fecha_ingreso AS fecha_ingreso,
                             COALESCE(NULLIF(TRIM(r.cliente_nombre), ''), '') AS cliente,
                             COALESCE(NULLIF(TRIM(r.equipo), ''), '') AS equipo,
                             COALESCE(NULLIF(TRIM(r.tecnico_asignado), ''), 'Sin asignar') AS tecnico,
                             r.estado AS estado,
                             COALESCE(r.total, 0) AS total,
                             COALESCE(r.precio_cobrado, 0) AS cobrado,
                             COALESCE(r.precio_cobrado, 0) - COALESCE(r.total, 0) AS resultado
                      FROM reparaciones r
                      WHERE 1 = 1
                      ${lim.sql}
                      ORDER BY r.fecha_ingreso DESC`,
                params: lim.params
            };
        },
        resumen(filas) {
            /* Una orden cancelada no es trabajo: se la muestra en la tabla
               porque existió y el taller tiene que verla, pero su costo no suma
               al resultado del período. Contarla sería mostrar que el mes cerró
               en rojo por un equipo al que ni se le tocó una llave. */
            const reales = filas.filter((f) => f.estado !== ESTADO_REPARACION_CANCELADA);
            const costo = reales.reduce((a, f) => a + n2(f.total), 0);
            const cobrado = reales.reduce((a, f) => a + n2(f.cobrado), 0);
            const canceladas = filas.length - reales.length;
            return [
                { etiqueta: 'Órdenes del período', valor: filas.length, tipo: 'entero' },
                { etiqueta: 'Costo total', valor: costo, tipo: 'pesos' },
                { etiqueta: 'Cobrado', valor: cobrado, tipo: 'pesos' },
                { etiqueta: 'Resultado', valor: a2(cobrado - costo), tipo: 'pesos' },
                { etiqueta: 'Canceladas', valor: canceladas, tipo: 'entero' }
            ];
        }
    },

    'presupuestos-y-conversion': {
        titulo: 'Presupuestos y conversión',
        descripcion: 'Cuántos presupuestos salieron, cuántos aceptaron y cuánto se perdió.',
        columnas: [
            col('estado', 'Estado', 'texto'),
            col('presupuestos', 'Presupuestos', 'entero'),
            col('total', 'Total', 'pesos'),
            col('promedio', 'Promedio', 'pesos'),
            col('participacion', 'Participación', 'porcentaje')
        ],
        consulta(lim) {
            /* NO hay columna "neto": en un presupuesto el total ya es el neto
               (`total = subtotal - descuento`, no hay IVA), así que una columna
               "neto" al lado de "total" mostraría el mismo número dos veces y
               haría pensar que hay algo que no se ve. En su lugar va el promedio
               por presupuesto, que sí dice algo nuevo: si el taller recibe
               presupuestos de $ 20.000 y de $ 30.000, el total no lo cuenta. */
            return {
                sql: `SELECT p.estado AS estado,
                             COUNT(*) AS presupuestos,
                             COALESCE(SUM(p.total), 0) AS total,
                             COALESCE(SUM(p.total), 0) / COUNT(*) AS promedio
                      FROM presupuestos p
                      WHERE 1 = 1
                      ${lim.sql}
                      GROUP BY p.estado
                      ORDER BY presupuestos DESC`,
                params: lim.params
            };
        },
        ajustar(filas) {
            /* La participación es la parte que representa cada estado sobre el
               total de presupuestos del período. Sin esto, la columna "Participación"
               quedaba declarada pero nunca producida, y la pantalla mostraba un
               guion en una columna que el dueño leía todas las semanas.

               El total sale de las MISMAS filas que se van a mostrar, no de una
               consulta aparte: si el resumen y la tabla tuvieran cada una su
               total, un cambio de filtro o un redondeo los separaría. */
            const total = filas.reduce((a, f) => a + Number(f.presupuestos || 0), 0);

            return filas.map((f) => ({
                ...f,
                participacion: total ? a2((Number(f.presupuestos || 0) / total) * 100) : 0
            }));
        },
        resumen(filas) {
            const porEstado = (codigo) => filas.find((f) => f.estado === codigo);
            const decididos = filas
                .filter((f) => ESTADOS_PRESUPUESTO_DECIDIDO.includes(f.estado))
                .reduce((a, f) => a + Number(f.presupuestos || 0), 0);
            const aprobados = Number((porEstado(ESTADO_PRESUPUESTO_APROBADO) || {}).presupuestos || 0);
            const enCurso = Number((porEstado('ENVIADO') || {}).presupuestos || 0);
            const perdidos = filas
                .filter((f) => f.estado === 'RECHAZADO')
                .reduce((a, f) => a + n2(f.total), 0);
            return [
                {
                    etiqueta: 'Presupuestos del período',
                    valor: filas.reduce((a, f) => a + Number(f.presupuestos || 0), 0),
                    tipo: 'entero'
                },
                { etiqueta: 'Aceptados', valor: aprobados, tipo: 'entero' },
                { etiqueta: 'Esperando respuesta', valor: enCurso, tipo: 'entero' },
                {
                    etiqueta: 'Conversión',
                    valor: decididos ? a2((aprobados / decididos) * 100) : 0,
                    tipo: 'porcentaje'
                },
                { etiqueta: 'Descartados', valor: perdidos, tipo: 'pesos' }
            ];
        }
    }
};

/* ==========================================================================
   EL FILTRO DE FECHAS
   --------------------------------------------------------------------------
   Arma el `WHERE` y los parámetros. Se llama una vez por consulta, no una vez
   por fila.

   Sin `desde` ni `hasta` no se filtra: el reporte sale de toda la historia. La
   pantalla siempre manda los dos (por defecto, el mes en curso), así que el
   caso "sin filtro" es el que se pega a mano en la barra de direcciones, y en
   ese caso tiene que devolver algo y no un error.
   ========================================================================== */
function filtroFechas(columna, desde, hasta) {
    if (!desde && !hasta) return { sql: '', params: [] };

    const params = [];
    const partes = [];

    if (desde) {
        partes.push(`${columna} >= ?`);
        params.push(desde);
    }
    if (hasta) {
        partes.push(`${columna} < ?`);
        params.push(diaSiguiente(hasta));
    }

    return { sql: ` AND ${partes.join('\n                       AND ')}`, params };
}

/**
 * Lee y valida `desde` y `hasta` del query string.
 *
 * Devuelve `{ ok, desde, hasta, error }`. No tira nunca: el error se le pasa al
 * route, que lo convierte en un 400 con un mensaje que el operador entiende.
 *
 * POR QUÉ VALIDA LA FECHA Y NO SOLO LA FORMA
 * --------------------------------------------------------------------------
 * `2026-02-31` tiene la forma correcta y no existe. MySQL la compararía contra
 * una fecha y devolvería un rango vacío en silencio, y el operador vería "no
 * hay ventas" sin entender por qué. Con el chequeo de fecha real se le dice
 * que esa fecha no existe.
 *
 * QUÉ PASE UN RANGO AL REVÉS
 * --------------------------------------------------------------------------
 * `desde` después de `hasta` devuelve un `WHERE` imposible, o sea, cero filas,
 * y de nuevo sin explicación. Se rechaza con un mensaje que dice cuál de los
 * dos está mal.
 */
function leerRango(query) {
    /* NO se hace `String(...)` antes de validar, y esa es toda la razón de que
       estas dos líneas sean así.

       La primera versión escribía `String(query.desde)`. Con eso `fechaReal`
       recibía SIEMPRE un string, así que su chequeo `typeof valor !== 'string'`
       no podía dispararse nunca: era una defensa muerta. Peor: un query como
       `?desde[]=2026-10-01` llega como ARRAY, y `String(['2026-10-01'])` vale
       `'2026-10-01'`, que pasa la validación de fecha sin haber sido una fecha.

       Que no haya inyección por acá no salva el arreglo: el rango se manda como
       parámetro, no se pega al SQL. Pero un endpoint que acepta
       `?desde[]=x` y lo trata como `desde=x` es un endpoint que acepta tipos que
       no dice aceptar, y mañana alguien le saca el `String` por performance y
       de golpe hay un problema de verdad.

       Se acepta un string o nada. Cualquier otra cosa es un 400 con un mensaje
       que dice qué se esperaba. */
    const bruto = (valor) => (typeof valor === 'string' ? valor.trim() : null);
    const desdeCrudo = bruto(query.desde);
    const hastaCrudo = bruto(query.hasta);

    if (query.desde !== undefined && desdeCrudo === null) {
        return { ok: false, error: 'La fecha de inicio no es válida.' };
    }
    if (query.hasta !== undefined && hastaCrudo === null) {
        return { ok: false, error: 'La fecha de fin no es válida.' };
    }

    const desde = desdeCrudo === '' ? null : desdeCrudo;
    const hasta = hastaCrudo === '' ? null : hastaCrudo;

    if (desde !== null && !fechaReal(desde)) {
        return { ok: false, error: 'La fecha de inicio no es una fecha válida (AAAA-MM-DD).' };
    }
    if (hasta !== null && !fechaReal(hasta)) {
        return { ok: false, error: 'La fecha de fin no es una fecha válida (AAAA-MM-DD).' };
    }
    if (desde !== null && hasta !== null && desde > hasta) {
        return { ok: false, error: 'La fecha de inicio es posterior a la fecha de fin.' };
    }

    return { ok: true, desde, hasta };
}

/** El catálogo: lo que la pantalla necesita para armar el menú de reportes sin haber corrido ninguno. */
function catalogo() {
    return Object.keys(REPORTES).map((codigo) => ({
        codigo,
        titulo: REPORTES[codigo].titulo,
        descripcion: REPORTES[codigo].descripcion,
        columnas: REPORTES[codigo].columnas
    }));
}

/** Los códigos válidos. Un pedido que no está acá no es un reporte: no hay ruta alternativa. */
const CODIGOS = Object.keys(REPORTES);

function existe(codigo) {
    return Object.prototype.hasOwnProperty.call(REPORTES, codigo);
}

/**
 * La columna por la que se filtra cada reporte.
 *
 * No es un detalle: `facturas` tiene `fecha` (día de emisión, que es lo que
 * quiere el reporte de ventas) y también `creado_en` (momento en que se creó
 * el borrador, que no sirve para contar cuando se filtra). `reparaciones`
 * tiene tres fechas y la del reporte es la de INGRESO del equipo: una orden
 * ingressada el 30 de septiembre y entregada el 3 de octubre pertenece a
 * septiembre, que es como se lee el mes de un taller.
 */
const COLUMNA_DE_FECHA = {
    'ventas-por-mes': 'f.fecha',
    'facturacion-por-cliente': 'f.fecha',
    'cuentas-por-cobrar': 'f.fecha',
    'repuestos-mas-vendidos': 'f.fecha',
    'ordenes-de-reparacion': 'r.fecha_ingreso',
    'presupuestos-y-conversion': 'p.creado_en'
};

function columnaDeFecha(codigo) {
    const columna = COLUMNA_DE_FECHA[codigo];
    if (!columna) throw new Error(`El reporte ${codigo} no declara por que columna se filtra.`);
    return columna;
}

/** MySQL devuelve los DECIMAL como string, para no perder precisión en el camino. */
const ES_NUMERO = /^-?\d+(\.\d+)?$/;

/** Los tipos de columna cuyos valores tienen que ser número, no texto. */
const TIPOS_NUMERICOS = new Set(['entero', 'decimal', 'pesos', 'porcentaje', 'dias']);

/**
 * Pasa los DECIMAL de string a número, O SOLO LOS QUE SON NÚMERO.
 *
 * POR QUÉ NO SE ADIVINA EL TIPO MIRANDO EL VALOR
 * --------------------------------------------------------------------------
 * La primera versión de esto convertía cualquier string que pareciera un
 * número. Con eso el teléfono `01112345678` volvía como `1112345678`: los ceros
 * del principio, que son parte del número, desaparecían de la pantalla y del
 * CSV. Y no es un caso raro: en Argentina los prefijos de zona llevan ceros.
 *
 * Un dato de más que se pierde y nadie se da cuenta.
 *
 * El tipo YA ESTÁ DECLARADO: cada columna dice si es `pesos`, `entero`,
 * `decimal`, `porcentaje` o `texto`. Se usa eso y no el valor.
 *
 * QUÉ PASA SI NO SE PUEDE CONVERTIR
 * --------------------------------------------------------------------------
 * Si MySQL devolviera algo raro, el `Number` da `NaN`, y `NaN` en la pantalla
 * es literalmente "NaN". Por eso, si la conversión no da un número finito, se
 * deja el string que vino: feo, pero el operador ve el dato real.
 */
function normalizar(filas, columnas) {
    /* El juego de claves numéricas se arma UNA vez, no una por fila. */
    const numeros = new Set(columnas.filter((c) => TIPOS_NUMERICOS.has(c.tipo)).map((c) => c.clave));

    return filas.map((fila) => {
        const salida = {};
        for (const [clave, valor] of Object.entries(fila)) {
            if (numeros.has(clave) && typeof valor === 'string' && ES_NUMERO.test(valor)) {
                const n = Number(valor);
                salida[clave] = Number.isFinite(n) ? n : valor;
            } else {
                salida[clave] = valor;
            }
        }
        return salida;
    });
}

/**
 * Corre un reporte.
 *
 * `db` es el pool de la empresa de la sesión: lo pasa quien llama. Este archivo
 * no sabe de empresas ni de bases de datos, y por eso no puede leer los datos
 * de otra.
 */
async function correr(db, codigo, rango) {
    const def = REPORTES[codigo];

    const { sql, params } = def.consulta(filtroFechas(columnaDeFecha(codigo), rango.desde, rango.hasta));
    const [filas] = await db.query(sql, params);

    /* Se normaliza UNA vez y la misma lista va a las dos cosas. La versión
       anterior corría `normalizar` dos veces sobre la misma fila, una para las
       filas y otra para el resumen: el doble de trabajo, y dos listas que
       podían dejar de ser iguales si mañana se toca el normalizador. */
    const limpias = normalizar(filas, def.columnas);

    /* Un reporte puede necesitar una columna que se calcula con TODAS las filas y
       no fila por fila. Una participación es el 32 % del total, y ese "32 % del
       total" no está en ninguna fila: sale de la suma. MySQL lo resuelve con una
       función de ventana, pero eso ataría el reporte a MySQL 8, y esta base
       corre en la versión que instale el taller.

       Por eso el enganche es `ajustar`, que es opcional: los cinco reportes que
       no lo necesitan no lo declaran, y los que lo necesitan lo escriben en
       JavaScript, que es donde ya vive el resto de las cuentas.

       Va DESPUÉS de `normalizar` a propósito: así recibe números y no los
       DECIMAL que MySQL devuelve como texto, y no hay que convertirlos dos
       veces. */
    const ajustadas = typeof def.ajustar === 'function' ? def.ajustar(limpias, rango) : limpias;

    return {
        reporte: codigo,
        titulo: def.titulo,
        descripcion: def.descripcion,
        desde: rango.desde,
        hasta: rango.hasta,
        columnas: def.columnas,
        /* Las filas son las ya ajustadas, y el resumen se arma sobre las mismas.
           Si el resumen usara las limpias y la tabla las ajustadas, las dos
           cosas hablarían de números distintos. */
        filas: ajustadas,
        resumen: def.resumen(ajustadas)
    };
}

/* ==========================================================================
   CSV
   ========================================================================== */

/* Lo que Excel y LibreOffice ejecutan como fórmula si el texto arranca con esto.
   El `\t` y el `\r` están porque hay versiones que los saca de adelante antes de
   mirar el signo. */
const ARRANQUE_DE_FORMULA = /^[=+\-@\t\r]/;

/** Escapa UN campo segun la RFC 4180. */
function campoCsv(valor) {
    const texto = (valor === null || valor === undefined) ? '' : String(valor);

    /* Solo los TEXTOS reciben el prefijo anti-fórmula. Un número que empieza con
       `-` es un número negativo, y anteponerle un apóstrofo lo convierte en
       texto: la columna deja de sumar en Excel, que es justo lo que se pidió
       para el archivo. */
    const conPrefijo = (typeof valor !== 'number' && ARRANQUE_DE_FORMULA.test(texto)) ? `'${texto}` : texto;

    if (/["\r\n,;]/.test(conPrefijo)) {
        return `"${conPrefijo.replace(/"/g, '""')}"`;
    }
    return conPrefijo;
}

/**
 * Arma el CSV de un resultado de reporte.
 *
 * Devuelve un Buffer con el BOM adelante. El BOM es lo que hace que Excel en
 * Windows lea el archivo como UTF-8 y no como ANSI: sin él, "San José" aparece
 * como "San JosÃ©" y el operador cree que el sistema escribió mal.
 *
 * La PRIMERA fila son los nombres de columna que declaró el reporte, los mismos
 * que se ven en pantalla. Vienen del mismo lugar a propósito: si están escritos
 * dos veces, el archivo y la tabla se van a desfasar y no hay forma de saber
 * cuál de los dos está bien.
 */
function aCsv(resultado) {
    const lineas = [resultado.columnas.map((c) => campoCsv(c.titulo)).join(',')];

    for (const fila of resultado.filas) {
        lineas.push(resultado.columnas.map((c) => campoCsv(fila[c.clave])).join(','));
    }

    /* Una fila de total, para el que abre el archivo sin mirar los filtros. Va
       al final y con un encabezado, para que no se confunda con un dato. */
    if (resultado.resumen && resultado.resumen.length) {
        lineas.push('');
        lineas.push(campoCsv('Totales del período'));
        for (const r of resultado.resumen) {
            lineas.push(`${campoCsv(r.etiqueta)},${campoCsv(r.valor)}`);
        }
    }

    const texto = `${lineas.join('\r\n')}\r\n`;
    return Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(texto, 'utf8')
    ]);
}

/**
 * El nombre del archivo: reporte, código y rango. Solo letras, números, punto,
 * guion y guion bajo.
 *
 * El filtro NO se acorta: si 400 caracteres de nombre no los banca el sistema de
 * archivos, lo que tiene que pasar es que se llame distinto, no que el archivo
 * diga un rango que no es el que tiene adentro.
 */
function nombreArchivo(codigo, rango) {
    const partes = ['reporte', codigo];
    if (rango.desde || rango.hasta) {
        partes.push(`${rango.desde || 'inicio'}_a_${rango.hasta || 'hoy'}`);
    }
    return partes.join('_').replace(/[^A-Za-z0-9._-]/g, '_') + '.csv';
}

module.exports = {
    REPORTES,
    CODIGOS,
    ESTADOS_FACTURA_VENDIDA,
    ESTADO_FACTURA_PENDIENTE,
    ESTADOS_PRESUPUESTO_DECIDIDO,
    ESTADO_PRESUPUESTO_APROBADO,
    ESTADO_REPARACION_CANCELADA,
    COLUMNA_DE_FECHA,
    TIPOS_NUMERICOS,
    catalogo,
    existe,
    leerRango,
    correr,
    aCsv,
    campoCsv,
    nombreArchivo,
    fechaReal,
    diaSiguiente,
    normalizar
};