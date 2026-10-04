-- ===========================================================================
-- 007 · ÍNDICES PARA LOS REPORTES
-- ===========================================================================
-- Los reportes leen la base entera todos los días, así que los indices que
-- usan tienen que estar. Esta migración es la que se los da a la ÚNICA tabla que
-- no los tenía.
--
-- Las otras cinco ya estaban cubiertas, y no fue casualidad: la 006 los agregó
-- cuando se armó facturación, con el mismo criterio de esta. El detalle es que
-- `reparaciones` quedó afuera porque en ese momento ningún reporte la leía, y
-- hoy hay uno que la lee de punta a punta.
--
-- POR QUÉ SOLO `reparaciones`
-- -----------------------------------------------------------------------
-- Se repasó cada columna por la que filtran o agrupan los seis reportes, contra
-- los índices que ya existen:
--
--     facturas.fecha                 idx_fact_fecha          ✓ (006)
--     facturas.estado                idx_fact_estado         ✓ (006)
--     facturas.cliente_id            idx_fact_cliente        ✓ (006)
--     factura_items.producto_id      idx_fi_producto         ✓ (006)
--     factura_items.factura_id       idx_fi_factura          ✓ (006)
--     presupuestos.creado_en         idx_presup_creado       ✓ (004)
--     presupuestos.estado            idx_presup_estado       ✓ (004)
--     reparaciones.fecha_ingreso     —                       ✗ ESTE
--     reparaciones.estado            —                       ✗ ESTE
--
-- `reparaciones` solo tenía `fk_reparaciones_cliente`, que sirve para buscar
-- las órdenes de UN cliente y no para las dos cosas que hace el reporte:
-- listar las órdenes que entraron en un rango de fechas, y agruparlas por
-- estado para las tarjetas del resumen.
--
-- POR QUÉ UN ÍNDICE Y NO NADA
-- -----------------------------------------------------------------------
-- Un taller con seis órdenes de reparación no lo nota: MySQL lee las seis filas
-- enteras y listo, es más rápido que leer el índice. El índice se paga solo con
-- la historia: cuando la tabla llegue a las decenas de miles de filas, sin
-- esto el reporte "órdenes de reparación" es un recorrido completo por cada
-- pedido, y el operador espera.
--
-- Y hay un motivo más que no es de velocidad: un recorrido completo de la
-- tabla es el escenario donde un `WHERE` mal escrito se convierte en una tabla
-- entera en memoria. Con el índice, MySQL toca lo que necesita y nada más.
--
-- No se agrega índice por cada columna: solo por las dos por las que el
-- reporte FILTRA. `tecnico_asignado` se muestra pero no se filtra, y un índice
-- que nadie consulta solo hace que escribir en la tabla sea más lento.
--
-- NOTA SOBRE EL ÍNDICE DE `estado`
-- -----------------------------------------------------------------------
-- El reporte de órdenes muestra el estado de cada orden en una columna, pero el
-- resumen con la cantidad por estado se calcula en JavaScript, sobre las filas
-- que ya trajo la consulta. Entonces el índice de `estado` NO lo usa el reporte
-- de hoy.
--
-- Va igual, por dos razones. La primera es que `estado` es por donde va a
-- filtrar el día que haya un reporte de "órdenes atrasadas" o "pendientes de
-- repuesto", que es lo primero que va a pedir cualquiera que use esta pantalla.
-- La segunda es que es el mismo criterio con el que la 006 indexó `facturas`:
-- si una columna tiene un conjunto pequeño de valores por los que se filtra
-- seguido, se indexa. Agregarlo ahora cuesta un `ALTER` de segundos;
-- agregarlo dentro de seis meses, con la tabla grande y en horario de
-- trabajo, cuesta minutos de bloqueo.
--
-- LA REGLA: toda migración tiene que ser REAPLICABLE. Corrida sobre un esquema
-- que ya la tiene, no cambia nada. MySQL no tiene `ADD INDEX IF NOT EXISTS`
-- (MariaDB sí), así que va con SQL dinámico: se mira en `information_schema` y
-- el ALTER se ejecuta solo si el índice no está.
--
-- Ojo con el nombre: se compara contra `INDEX_NAME` en `information_schema`, y
-- no contra la lista de columnas. Si mañana alguien indexa `fecha_ingreso` con
-- otro nombre, este `IF` lo va a agregar de nuevo. Va contra el nombre, que es
-- lo único que el motor garantiza único dentro de la tabla.
--
-- Y no se toca `schema/base.sql`: esa es la congelación de antes de la 001.

-- ---------------------------------------------------------------------------
-- reparaciones.fecha_ingreso
-- ---------------------------------------------------------------------------
-- El filtro del reporte de órdenes, y su `ORDER BY fecha_ingreso DESC`.
-- La columna por la que se filtra un rango se indexa; por la que se ordena
-- después de filtrar, también, porque el rango ya acortó el conjunto.
SET @idx_rep_fecha_ya_existe := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'reparaciones'
       AND INDEX_NAME   = 'idx_repar_fecha_ingreso'
);

SET @idx_rep_fecha_sql := IF(@idx_rep_fecha_ya_existe > 0,
    'DO 0',
    'ALTER TABLE `reparaciones`
        ADD INDEX `idx_repar_fecha_ingreso` (`fecha_ingreso`)'
);

PREPARE agregar_idx_rep_fecha FROM @idx_rep_fecha_sql;
EXECUTE agregar_idx_rep_fecha;
DEALLOCATE PREPARE agregar_idx_rep_fecha;

-- ---------------------------------------------------------------------------
-- reparaciones.estado
-- ---------------------------------------------------------------------------
SET @idx_rep_estado_ya_existe := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'reparaciones'
       AND INDEX_NAME   = 'idx_repar_estado'
);

SET @idx_rep_estado_sql := IF(@idx_rep_estado_ya_existe > 0,
    'DO 0',
    'ALTER TABLE `reparaciones`
        ADD INDEX `idx_repar_estado` (`estado`)'
);

PREPARE agregar_idx_rep_estado FROM @idx_rep_estado_sql;
EXECUTE agregar_idx_rep_estado;
DEALLOCATE PREPARE agregar_idx_rep_estado;