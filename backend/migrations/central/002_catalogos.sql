-- ===========================================================================
-- 002 · CATALOGOS
-- ===========================================================================
-- Modulos que se pueden contratar y planes de suscripcion.
--
-- Es un INSERT ... ON DUPLICATE KEY UPDATE para que, si alguna vez hay que
-- corregir un nombre o una descripcion, la migracion se pueda reaplicar sin
-- romper nada. Los datos que carga el negocio (precios) NO se tocan aca.
-- ===========================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- MODULOS
-- ---------------------------------------------------------------------------
INSERT INTO `modulos` (`codigo`, `nombre`, `descripcion`, `es_base`, `orden`) VALUES
  ('stock',        'Stock e inventario', 'Productos, entradas y salidas de stock',            1, 10),
  ('reparaciones', 'Reparaciones',       'Ordenes de reparacion con seguimiento de estado',  1, 20),
  ('clientes',     'Clientes',           'Ficha de clientes e historial de trabajos',        1, 30),
  ('pedidos',      'Pedidos',            'Pedidos y detalle de items',                       1, 40),
  ('etiquetas_qr', 'Etiquetas QR',       'Consulta publica del estado de una reparacion',    0, 50),
  ('presupuestos', 'Presupuestos',       'Presupuestos imprimibles y su aprobacion',         0, 60),
  ('reportes',     'Reportes',           'Reportes de ventas, stock y productividad',        0, 70),
  ('facturacion',  'Facturacion',        'Comprobantes y facturacion electronica',           0, 80)
AS `nuevo`
ON DUPLICATE KEY UPDATE
  `nombre`      = `nuevo`.`nombre`,
  `descripcion` = `nuevo`.`descripcion`,
  `es_base`     = `nuevo`.`es_base`,
  `orden`       = `nuevo`.`orden`;


-- ---------------------------------------------------------------------------
-- PLANES
-- ---------------------------------------------------------------------------
-- precio_mensual queda NULL: lo define el dueño del negocio, no el sistema.
-- max_usuarios NULL = sin limite.
-- ---------------------------------------------------------------------------
INSERT INTO `planes` (`codigo`, `nombre`, `precio_mensual`, `moneda`, `max_usuarios`, `orden`, `activo`) VALUES
  ('basico',      'Basico',      NULL, 'ARS',  3,   10, 1),
  ('profesional', 'Profesional', NULL, 'ARS', 10,   20, 1),
  ('ilimitado',   'Ilimitado',   NULL, 'ARS', NULL, 30, 1)
AS `nuevo`
ON DUPLICATE KEY UPDATE
  `nombre`       = `nuevo`.`nombre`,
  `moneda`       = `nuevo`.`moneda`,
  `max_usuarios` = `nuevo`.`max_usuarios`,
  `orden`        = `nuevo`.`orden`;
