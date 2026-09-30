-- ===========================================================================
-- 004 · PRESUPUESTOS  (modulo vendible `presupuestos`)
-- ===========================================================================
-- Un presupuesto es un documento comercial con vida propia: tiene un numero
-- correlativo, un cliente, items con precios, un estado y una validez. No es
-- "un pedido que todavia no paso", asi que va en su tabla y no escondido
-- adentro de pedidos.
--
-- DECISIONES QUE IMPORTAN LEER ANTES DE TOCAR ESTO
--
-- 1. El cliente se COPIA dentro del presupuesto.
--    `cliente_id` es un vinculo por comodidad, pero el documento lleva su
--    propia copia de nombre, documento, telefono, email y direccion. Si manana
--    se corrige el telefono del cliente, el presupuesto ya impreso tiene que
--    seguir diciendo el telefono de cuando se emitio, o el comprobante deja de
--    ser cierto. Por eso `cliente_id` es NULLable: un presupuesto puede no
--    tener cliente en la ficha (un particular que solo pasa por el taller).
--
-- 2. Los items tambien se copian.
--    `producto_id` es un vinculo, pero la descripcion y el precio viajan
--    guardados. Mismo motivo que arriba, y ademas permite items de taller que
--    no son del catalogo ("mano de obra", "diagnostico").
--
-- 3. El numero sale de `secuencias`, no del id.
--    Un comprobante comercial lleva numeracion correlativa, y suele tener
--    obligacion legal de que sea correlativo. El id no sirve: se puede borrar
--    una fila y el siguiente la reutiliza.
--    El incremento es atomico porque en InnoDB el INSERT ... ON DUPLICATE KEY
--    UPDATE toma un cerrojo exclusivo sobre la fila, asi que dos presupuestos
--    simultaneos no pueden obtener el mismo numero.
--
-- 4. DECIMAL, nunca FLOAT. Plata que se guarda en float se pierde. Todos los
--    importes son DECIMAL(12,2), salvo la cantidad, que admite fracciones
--    (0,5 kg de una pieza).
--
-- 5. No se guarda un total "confiado" al cliente ni al navegador. El total se
--    calcula siempre desde los items, en el servidor. El `descuento` es lo
--    unico que acepta el usuario, y validado contra el subtotal.
--
-- 6. `INT` CON SIGNO, no `INT UNSIGNED`, aunque lo unsigned sea "mejor".
--    Las 6 tablas que ya existen usan `int` con signo, y MySQL no deja crear
--    una clave foranea si los dos lados no coinciden exactamente:
--      "Referencing column 'cliente_id' and referenced column 'id' ... are
--       incompatible"
--    Si alguna vez se cambian las columnas de las tablas viejas a UNSIGNED, hay
--    que cambiar estas en el mismo movimiento. No las "mejores" por separado.
--
-- EXPAND: son tablas nuevas. No se toca ninguna de las 6 existentes, asi que
-- una empresa que no contrate `presupuestos` no ve cambio ninguno.
-- ===========================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- secuencias
-- ---------------------------------------------------------------------------
-- Generador de numeros correlativos. Se crea ahora aunque `presupuestos` no
-- este contratado, porque es generica y la proxima que la necesite va a ser
-- `pedidos` o `reparaciones`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `secuencias` (
    `nombre` VARCHAR(40)  NOT NULL COMMENT 'Que secuencia es: presupuesto, pedido, reparacion...',
    `ultimo` INT NOT NULL DEFAULT 0,
    `creado_en`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `actualizado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- presupuestos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `presupuestos` (
    `id`             INT NOT NULL AUTO_INCREMENT,
    `numero`         INT NOT NULL COMMENT 'Correlativo de la empresa. Unico.',
    `cliente_id`     INT NULL COMMENT 'NULL si el cliente no esta en la ficha',
    `cliente_nombre` VARCHAR(150) NOT NULL,
    `cliente_doc`    VARCHAR(30)  NULL,
    `cliente_telefono` VARCHAR(40) NULL,
    `cliente_email`  VARCHAR(150) NULL,
    `cliente_direccion` VARCHAR(200) NULL,
    `estado`         ENUM('BORRADOR','ENVIADO','APROBADO','RECHAZADO') NOT NULL DEFAULT 'BORRADOR',
    `subtotal`       DECIMAL(12,2) NOT NULL DEFAULT 0,
    `descuento`      DECIMAL(12,2) NOT NULL DEFAULT 0,
    `total`          DECIMAL(12,2) NOT NULL DEFAULT 0,
    `notas`          TEXT NULL,
    `valido_hasta`   DATE NULL COMMENT 'Fecha de vencimiento de la oferta',
    `usuario_nombre` VARCHAR(120) NULL COMMENT 'Quien lo preparo. Texto, a proposito: es un historico',
    `creado_en`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_presup_numero` (`numero`),
    KEY `idx_presup_estado` (`estado`),
    KEY `idx_presup_cliente` (`cliente_id`),
    KEY `idx_presup_creado` (`creado_en`),

    CONSTRAINT `fk_presup_cliente` FOREIGN KEY (`cliente_id`)
        REFERENCES `clientes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- presupuesto_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `presupuesto_items` (
    `id`              INT NOT NULL AUTO_INCREMENT,
    `presupuesto_id`  INT NOT NULL,
    `producto_id`     INT NULL COMMENT 'NULL si el item no viene del catalogo',
    `descripcion`     VARCHAR(200) NOT NULL,
    `cantidad`        DECIMAL(12,3) NOT NULL DEFAULT 1,
    `precio_unitario` DECIMAL(12,2) NOT NULL DEFAULT 0,
    `subtotal`        DECIMAL(12,2) NOT NULL DEFAULT 0,
    `orden`           SMALLINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`),
    KEY `idx_pi_presupuesto` (`presupuesto_id`),
    KEY `idx_pi_producto` (`producto_id`),

    CONSTRAINT `fk_pi_presupuesto` FOREIGN KEY (`presupuesto_id`)
        REFERENCES `presupuestos` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_pi_producto` FOREIGN KEY (`producto_id`)
        REFERENCES `productos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
