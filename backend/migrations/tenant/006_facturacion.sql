-- ===========================================================================
-- 006 · FACTURACIÓN INTERNA
-- ===========================================================================
-- Emitir comprobantes con numeración propia, IVA por renglón y salida de stock.
-- Es la base de 3 de los 6 reportes (ventas por mes, facturación por cliente y
-- cuentas por cobrar), así que va antes que ellos.
--
-- ESTO NO ES FACTURACIÓN ELECTRÓNICA.
-- Lo que sale de acá es un comprobante interno con numeración correlativa por
-- empresa. No se emite ante ARCA/AFIP, no tiene CAI ni punto de venta, y por
-- lo tanto NO SIRVE como comprobante fiscal. La facturación electrónica es
-- otra etapa, aparte, con sus propias credenciales y sus deadlines. Decirlo
-- ahora evita que alguien emite thinking que esto ya cumple con la ley.
--
-- DECISIONES:
--  - `numero` correlativo por EMPRESA, con la tabla `secuencias` y el mismo
--    mecanismo atómico de los presupuestos. Como cada empresa tiene su base,
--    el correlativo es independiente por empresa sin código adicional. La
--    columna es UNIQUE y NULL mientras el documento es un borrador: el numero
--    se saca al EMITIR, no al crear.
--
--  - El cliente queda COPIADO (snapshot), igual que en presupuestos. Una
--    factura es un documento: si el cliente cambia de nombre o de dirección el
--    año que viene, la factura del año pasado tiene que seguir diciendo lo que
--    decía. Por eso `cliente_id` es solo un vinculo, y puede quedar en NULL si
--    el cliente se borra (ON DELETE SET NULL).
--
--  - IVA POR RENGLÓN, no uno general para toda la factura. En Argentina el
--    determinante de la alícuota es el tipo de cosa, y en un taller conviven
--    repuestos y mano de obra con alícuotas distintas. Un 21% único en toda la
--    factura estaria mal siempre que mixe.
--
--  - La MONEDA ES DECIMAL(12,2), nunca float. Suma de plata en float se
--    pierde: 0.1 + 0.2 = 0.30000000000000004, y una factura que no cuadra es
--    una factura que nadie firma.
--
--  - `stock_descontado` para que el descuento de stock pase UNA sola vez. Sin
--    ese flag, volver a emitir la factura descuenta el stock otra vez. Mismo
--    criterio que `reparaciones.stock_descontado`.
--
--  - `estado` como ENUM, no como texto libre. Los cuatro estados son los del
--    circuito de una factura; si aparece un quinto es un error de tipeo y tiene
--    que salir, no guardarse como un estado que ningún reporte contempla.
--
-- EXPAND: dos tablas nuevas y una columna nueva. NO se toca ninguna tabla ni
-- columna existente. El código anterior sigue funcionando contra este esquema
-- mientras se despliega el nuevo, que es lo que permiteActualizar sin cortar.
-- Empresa sin el módulo `facturacion` no ve ningún cambio.
-- ===========================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- facturas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `facturas` (
    `id`                INT NOT NULL AUTO_INCREMENT,

    -- NULL mientras esta en BORRADOR. El numero se saca AL EMITIR, no al crear.
    -- Si el borrador quedara con numero, cada borrador que nunca se emite
    -- quemaria un numero y dejaria un hueco en la numeracion — y en una
    -- numeracion, un hueco es un numero que alguien esta usando y no se sabe
    -- de que. MySQL admite varios NULL en un indice UNIQUE, asi que el indice
    -- sigue garantizando que dos facturas emitidas no compartan numero.
    `numero`            INT NULL COMMENT 'Correlativo por empresa. NULL hasta que se emite.',
    `fecha`             DATE NOT NULL COMMENT 'Fecha de emision (comprobante)',

    -- Vinculo al cliente. Snapshot abajo: el documento no depende de que el
    -- cliente siga existiendo ni de que siga teniendo los mismos datos.
    `cliente_id`        INT NULL COMMENT 'FK a clientes.id. Solo referencia.',
    `cliente_nombre`    VARCHAR(200) NOT NULL,
    `cliente_doc`       VARCHAR(20) NULL,
    `cliente_telefono`  VARCHAR(30) NULL,
    `cliente_email`     VARCHAR(150) NULL,
    `cliente_direccion` VARCHAR(255) NULL,

    `presupuesto_id`    INT NULL COMMENT 'Presupuesto del que salio, si salio de uno',

    -- Los cuatro importes. La formula es una sola y esta escrita aca para que
    -- no haya que deducirla:
    --     total = subtotal - descuento + iva_monto
    -- `subtotal` es BRUTO (sin descontar nada) y `descuento` es la suma de los
    -- descuentos por renglon. Mismo criterio que `presupuestos`.
    `subtotal`          DECIMAL(12,2) NOT NULL DEFAULT '0.00',
    `descuento`         DECIMAL(12,2) NOT NULL DEFAULT '0.00',
    `iva_monto`         DECIMAL(12,2) NOT NULL DEFAULT '0.00',
    `total`             DECIMAL(12,2) NOT NULL DEFAULT '0.00',

    `estado`            ENUM('BORRADOR','EMITIDA','PAGADA','ANULADA') NOT NULL DEFAULT 'BORRADOR',
    `forma_pago`        VARCHAR(40) NULL COMMENT 'Efectivo, Transferencia, Tarjeta, Cuenta corriente...',
    `fecha_pago`        DATETIME NULL COMMENT 'Se llena al marcar como pagada',

    -- Para que el descuento de stock no se aplique dos veces.
    `stock_descontado`  TINYINT(1) NOT NULL DEFAULT 0,

    `notas`             TEXT NULL,
    `usuario_nombre`    VARCHAR(100) NULL COMMENT 'Quien la emitio (snapshot)',

    `creado_en`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `actualizado_en`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),

    -- El correlativo no se repite dentro de una empresa.
    UNIQUE KEY `uq_fact_numero` (`numero`),

    -- Los reportes filtran por estado y por fecha todo el tiempo; los dos
    -- indices no sobran.
    KEY `idx_fact_fecha` (`fecha`),
    KEY `idx_fact_estado` (`estado`),
    KEY `idx_fact_cliente` (`cliente_id`),
    KEY `idx_fact_presupuesto` (`presupuesto_id`),

    CONSTRAINT `fk_fact_cliente` FOREIGN KEY (`cliente_id`)
        REFERENCES `clientes` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_fact_presupuesto` FOREIGN KEY (`presupuesto_id`)
        REFERENCES `presupuestos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- factura_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `factura_items` (
    `id`               INT NOT NULL AUTO_INCREMENT,
    `factura_id`       INT NOT NULL,

    `producto_id`      INT NULL COMMENT 'NULL si el renglon no sale del catalogo',
    `descripcion`      VARCHAR(200) NOT NULL,

    `cantidad`         DECIMAL(12,3) NOT NULL DEFAULT '1.000',
    `precio_unitario`  DECIMAL(12,2) NOT NULL DEFAULT '0.00',

    -- Descuento DEL RENGLON, en dinero (no en porcentaje). asi se puede
    -- descontar $500 fijos sin repartirlos en porcentaje.
    `descuento`        DECIMAL(12,2) NOT NULL DEFAULT '0.00',

    -- Alícuota de ESTE renglón. 0 / 10.50 / 21.00 segun la mercaderia.
    `iva_porcentaje`   DECIMAL(5,2) NOT NULL DEFAULT '21.00',

    -- cantidad * precio_unitario, SIN descontar. El descuento va aparte para
    -- poder mostrar las dos cosas en el comprobante.
    `subtotal`         DECIMAL(12,2) NOT NULL DEFAULT '0.00',

    `orden`            SMALLINT NOT NULL DEFAULT '0',

    `creado_en`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_fi_factura` (`factura_id`),
    KEY `idx_fi_producto` (`producto_id`),

    -- CASCADE y no SET NULL: si se borra la factura, sus renglones no tienen
    -- sentido solos. El documento va con sus partes.
    CONSTRAINT `fk_fi_factura` FOREIGN KEY (`factura_id`)
        REFERENCES `facturas` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_fi_producto` FOREIGN KEY (`producto_id`)
        REFERENCES `productos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- EXPAND: cuanto se le cobro al cliente por la reparacion
-- ---------------------------------------------------------------------------
-- `reparaciones` ya tenia `costo_mano_obra`, `costo_repuestos` y `total`, pero
-- NINGUN campo de cuanto se le cobro. Los tres son costos: con eso solo se
-- puede saber cuanto costo el trabajo, no cuanto se gano, y el reporte de
-- rentabilidad es exactamente eso.
--
-- NULL y no 0 a proposito. Con 0 de defecto, un 0 es indistinguible de "no se
-- cargo" y el reporte muestra 0 de ganancia en las reparaciones que nadie
-- completo — que es un numero que parece verdad y no lo es. Con NULL el
-- reporte puede decir "sin precio cargado".
--
-- Y POR QUE NO ES UN `ALTER` DIRECTO
-- ---------------------------------------------------------------------------
-- La base de una empresa nueva se arma en dos pasos, y el orden importa:
--
--     1. se carga `schema/schema-actual.sql` — que es el esquema ACTUAL, con
--        esta columna YA PUESTA, porque es un volcado de una base que ya la
--        tiene;
--     2. DESPUES se corre esta cadena de migraciones encima.
--
-- O sea, la columna puede existir antes de que corra este archivo. Un
-- `ALTER TABLE ... ADD COLUMN` a secas falla en ese caso con
-- `Duplicate column name 'precio_cobrado'`, y el alta de la empresa muere con
-- ese error, que no dice nada de que el problema es la migracion.
--
-- Esto ya paso. La 006 fue la PRIMERA migracion con un `ALTER` —004 y 005 solo
-- usan `CREATE TABLE IF NOT EXISTS`, que no tiene este problema— y toda empresa
-- nueva se habria rechazado al registrarse. Lo encontro `f4-verificar.js`, que
-- arma una base de empresa desde cero exactamente como lo hace el alta.
--
-- LA REGLA: toda migracion tiene que ser REAPLICABLE. Corrida sobre un esquema
-- que ya la tiene, no cambia nada. No es un detalle de forma: es lo que hace que
-- `schema-actual.sql` + la cadena puedan seguir siendo el camino de alta.
--
-- MySQL no tiene `ADD COLUMN IF NOT EXISTS` (MariaDB si), asi que va con SQL
-- dinamico: se mira en `information_schema` y el ALTER se ejecuta solo si la
-- columna no esta.
SET @precio_cobrado_ya_existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'reparaciones'
       AND COLUMN_NAME  = 'precio_cobrado'
);

SET @precio_cobrado_sql := IF(@precio_cobrado_ya_existe > 0,
    'DO 0',
    'ALTER TABLE `reparaciones`
        ADD COLUMN `precio_cobrado` DECIMAL(12,2) NULL
        COMMENT ''Cuanto se le cobro al cliente. NULL = no se cargo todavia.''
        AFTER `total`'
);

PREPARE agregar_precio_cobrado FROM @precio_cobrado_sql;
EXECUTE agregar_precio_cobrado;
DEALLOCATE PREPARE agregar_precio_cobrado;
