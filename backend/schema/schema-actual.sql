-- ===========================================================================
-- Esquema de: ServiceIntegralsistema
-- Servidor:   MySQL 9.5.0
-- Generado:   2/10/2026, 07:30:29
--
-- FUENTE DE VERDAD del esquema. Reemplaza al esquema que se creaba a mano
-- en MySQL Workbench sin versionar.
-- La F2 lo transforma en migraciones incrementales versionadas.
-- ===========================================================================

SET FOREIGN_KEY_CHECKS=0;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Tabla: _schema_migrations   (5 columnas, 1 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `_schema_migrations` (
  `version` varchar(20) NOT NULL,
  `nombre` varchar(200) NOT NULL,
  `checksum` char(64) NOT NULL,
  `aplicada_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duracion_ms` int unsigned NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Tabla: clientes   (7 columnas, 2 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `clientes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `telefono` varchar(50) NULL,
  `direccion` varchar(255) NULL,
  `email` varchar(150) NULL,
  `notas` text NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_clientes_telefono` (`telefono`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Tabla: etiquetas_qr   (7 columnas, 3 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `etiquetas_qr` (
  `id` int NOT NULL AUTO_INCREMENT,
  `producto_id` int NOT NULL COMMENT 'FK a productos.id',
  `codigo` varchar(32) NOT NULL COMMENT 'Clave publica corta para /e/:codigo',
  `datos_json` json NOT NULL COMMENT 'Snapshot inmutable del producto al generar',
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_eq_codigo` (`codigo`) USING BTREE,
  UNIQUE KEY `uq_eq_producto` (`producto_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `etiquetas_qr` ADD CONSTRAINT `fk_eq_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Tabla: movimientos_stock   (9 columnas, 2 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `movimientos_stock` (
  `id` int NOT NULL AUTO_INCREMENT,
  `producto_id` int NOT NULL,
  `producto_nombre` varchar(150) NOT NULL,
  `usuario_nombre` varchar(100) NULL DEFAULT 'Sistema',
  `tipo` enum('ALTA','EDICION','AJUSTE','VENTA','REPARACION') NOT NULL,
  `cantidad_afectada` int NOT NULL,
  `stock_resultante` int NOT NULL,
  `motivo` varchar(255) NULL,
  `fecha` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `producto_id` (`producto_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `movimientos_stock` ADD CONSTRAINT `movimientos_stock_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Tabla: pedido_items   (4 columnas, 3 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `pedido_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pedido_id` int NULL,
  `producto_id` int NULL,
  `cantidad` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `pedido_id` (`pedido_id`) USING BTREE,
  KEY `producto_id` (`producto_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `pedido_items` ADD CONSTRAINT `pedido_items_ibfk_1` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE `pedido_items` ADD CONSTRAINT `pedido_items_ibfk_2` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON UPDATE NO ACTION ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Tabla: pedidos   (4 columnas, 1 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `pedidos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fecha` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  `notas` text NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Tabla: presupuesto_items   (8 columnas, 3 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `presupuesto_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `presupuesto_id` int NOT NULL,
  `producto_id` int NULL COMMENT 'NULL si el item no viene del catalogo',
  `descripcion` varchar(200) NOT NULL,
  `cantidad` decimal(12,3) NOT NULL DEFAULT '1.000',
  `precio_unitario` decimal(12,2) NOT NULL DEFAULT '0.00',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `orden` smallint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_pi_presupuesto` (`presupuesto_id`) USING BTREE,
  KEY `idx_pi_producto` (`producto_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `presupuesto_items` ADD CONSTRAINT `fk_pi_presupuesto` FOREIGN KEY (`presupuesto_id`) REFERENCES `presupuestos` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE `presupuesto_items` ADD CONSTRAINT `fk_pi_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON UPDATE NO ACTION ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Tabla: presupuestos   (17 columnas, 5 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `presupuestos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `numero` int NOT NULL COMMENT 'Correlativo de la empresa. Unico.',
  `cliente_id` int NULL COMMENT 'NULL si el cliente no esta en la ficha',
  `cliente_nombre` varchar(150) NOT NULL,
  `cliente_doc` varchar(30) NULL,
  `cliente_telefono` varchar(40) NULL,
  `cliente_email` varchar(150) NULL,
  `cliente_direccion` varchar(200) NULL,
  `estado` enum('BORRADOR','ENVIADO','APROBADO','RECHAZADO') NOT NULL DEFAULT 'BORRADOR',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `descuento` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `notas` text NULL,
  `valido_hasta` date NULL COMMENT 'Fecha de vencimiento de la oferta',
  `usuario_nombre` varchar(120) NULL COMMENT 'Quien lo preparo. Texto, a proposito: es un historico',
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_presup_cliente` (`cliente_id`) USING BTREE,
  KEY `idx_presup_creado` (`creado_en`) USING BTREE,
  KEY `idx_presup_estado` (`estado`) USING BTREE,
  UNIQUE KEY `uq_presup_numero` (`numero`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `presupuestos` ADD CONSTRAINT `fk_presup_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON UPDATE NO ACTION ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Tabla: productos   (12 columnas, 1 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `productos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(500) NOT NULL,
  `categoria` varchar(100) NULL,
  `stock` int NULL DEFAULT '0',
  `stockMinimo` int NULL DEFAULT '0',
  `precio` decimal(10,2) NULL,
  `distribuidor` varchar(50) NULL,
  `descripcion` varchar(100) NULL,
  `codigoDistribuidor` varchar(100) NULL,
  `imagen_1` varchar(255) NULL,
  `imagen_2` varchar(255) NULL,
  `imagen_3` varchar(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Tabla: reparaciones   (22 columnas, 2 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `reparaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NULL,
  `cliente_nombre` varchar(120) NOT NULL,
  `cliente_telefono` varchar(50) NULL,
  `direccion` varchar(200) NULL,
  `tipo_cobertura` enum('Fuera de Garantia','En Garantia') NULL DEFAULT 'Fuera de Garantia',
  `equipo` varchar(120) NOT NULL,
  `falla_declarada` text NOT NULL,
  `diagnostico_tecnico` text NULL,
  `notas_servicio` text NULL,
  `repuestos_usados` text NULL,
  `repuestos_detalle` json NULL,
  `costo_mano_obra` decimal(10,2) NULL DEFAULT '0.00',
  `costo_repuestos` decimal(10,2) NULL DEFAULT '0.00',
  `total` decimal(10,2) NULL DEFAULT '0.00',
  `estado` enum('Pendiente','En Reparacion','Esperando Repuesto','Listo','Entregado','Cancelado') NULL DEFAULT 'Pendiente',
  `stock_descontado` tinyint(1) NULL DEFAULT '0',
  `tecnico_asignado` varchar(100) NULL,
  `fecha_inicio` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_modificacion` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `fecha_ingreso` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_entrega` datetime NULL,
  PRIMARY KEY (`id`),
  KEY `fk_reparaciones_cliente` (`cliente_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `reparaciones` ADD CONSTRAINT `fk_reparaciones_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON UPDATE NO ACTION ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Tabla: secuencias   (4 columnas, 1 indices)
-- ---------------------------------------------------------------------------
CREATE TABLE `secuencias` (
  `nombre` varchar(40) NOT NULL COMMENT 'Que secuencia es: presupuesto, pedido, reparacion...',
  `ultimo` int NOT NULL DEFAULT '0',
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS=1;
