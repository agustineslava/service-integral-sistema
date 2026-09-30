-- ===========================================================================
-- Esquema de: ServiceIntegralsistema
-- Servidor:   MySQL 9.5.0
-- Generado:   30/9/2026, 12:39:05
--
-- FUENTE DE VERDAD del esquema. Reemplaza al esquema que se creaba a mano
-- en MySQL Workbench sin versionar.
-- La F2 lo transforma en migraciones incrementales versionadas.
-- ===========================================================================

SET FOREIGN_KEY_CHECKS=0;
SET NAMES utf8mb4;

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

SET FOREIGN_KEY_CHECKS=1;
