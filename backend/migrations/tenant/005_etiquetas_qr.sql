-- ===========================================================================
-- 005 · ETIQUETAS QR PARA STOCK
-- ===========================================================================
-- Una etiqueta QR por producto (1:1). Permite rotular repuestos en el depósito
-- y que cualquiera escanee y vea la info pública sin login.
--
-- DECISIONES:
--  - 1:1 con productos. ON DELETE CASCADE: borra producto -> borra etiqueta.
--  - `codigo` es la clave pública corta (12-16 chars) para URL `/e/:codigo`.
--  - `datos_json` es snapshot INMUTABLE al momento de generar: lo que ve el
--    usuario al escanear NUNCA cambia aunque el producto se edite después.
--    Esto es crítico: la etiqueta impresa en el estante debe seguir siendo cierta.
--  - `activo` permite desactivar sin borrar (histórico).
--
-- EXPAND: tabla nueva, no toca nada existente. Empresa sin modulo `etiquetas_qr`
-- no ve cambio. El modulo se habilita desde el panel SuperAdmin.
-- ===========================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- etiquetas_qr
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `etiquetas_qr` (
    `id`             INT NOT NULL AUTO_INCREMENT,
    `producto_id`    INT NOT NULL COMMENT 'FK a productos.id',
    `codigo`         VARCHAR(32) NOT NULL COMMENT 'Clave publica corta para /e/:codigo',
    `datos_json`     JSON NOT NULL COMMENT 'Snapshot inmutable del producto al generar',
    `activo`         TINYINT(1) NOT NULL DEFAULT 1,
    `creado_en`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `actualizado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_eq_producto` (`producto_id`),
    UNIQUE KEY `uq_eq_codigo` (`codigo`),

    CONSTRAINT `fk_eq_producto` FOREIGN KEY (`producto_id`)
        REFERENCES `productos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;