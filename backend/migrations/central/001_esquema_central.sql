-- ===========================================================================
-- 001 · ESQUEMA CENTRAL
-- ===========================================================================
-- Esta base NO pertenece a ninguna empresa: es el registro de todas.
--
-- REGLA DE ORO: acá solo va lo que es COMUN a todas las empresas o lo que
-- el SuperAdmin necesita ver de un vistazo. Los datos operativos
-- (reparaciones, productos, clientes) viven en la base de cada empresa.
--
-- Por qué la marca (logo, colores, subtitulo) SI va acá:
--   el usuario tiene que ver el logo de SU empresa ANTES de escribir su
--   email. Eso obliga a responder una consulta sin autenticacion.
--
-- La columna `nombre_db` es la que decide a que base se conecta cada
-- empresa. La genera el servidor a partir del slug: NUNCA la escribe una
-- persona ni la manda el cliente.
-- ===========================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- EMPRESAS · una fila por cliente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `empresas` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,

  `nombre`            VARCHAR(150) NOT NULL,
  `slug`              VARCHAR(60)  NOT NULL COMMENT 'Identificador corto. Sera el subdominio.',
  `nombre_db`         VARCHAR(64)  NOT NULL COMMENT 'Base MySQL de esta empresa. Generada por el servidor.',
  `rubro`             VARCHAR(40)  NOT NULL DEFAULT 'taller' COMMENT 'Adapta categorias y textos: taller, cerrajeria, electricidad...',
  `plan`              VARCHAR(40)  NOT NULL DEFAULT 'basico',
  `estado`            ENUM('DEMO','ACTIVO','SUSPENDIDO','BAJA') NOT NULL DEFAULT 'DEMO',

  -- Marca: se usa ANTES del login y en comprobantes/ordenes/presupuestos
  `subtitulo`         VARCHAR(120) NULL,
  `color_primario`    CHAR(7)      NULL COMMENT 'Formato #RRGGBB',
  `color_secundario`  CHAR(7)      NULL COMMENT 'Formato #RRGGBB',
  `logo_url`          VARCHAR(500) NULL,

  -- Datos que salen impresos en comprobantes
  `telefono`          VARCHAR(50)  NULL,
  `email_contacto`    VARCHAR(150) NULL,
  `direccion`         VARCHAR(255) NULL,
  `cuit`              VARCHAR(20)  NULL,

  -- Suscripcion
  `fecha_alta`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_vencimiento` DATE         NULL,
  `notas`             TEXT         NULL,

  `creado_en`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_empresas_slug`      (`slug`),
  UNIQUE KEY `uq_empresas_nombre_db` (`nombre_db`),
  KEY `idx_empresas_estado`          (`estado`),
  KEY `idx_empresas_plan`            (`plan`),

  -- El nombre de la base debe ser seguro para interpolar en SQL.
  -- Estos CHECK son la ultima red: aunque alguien inserte a mano, no puede
  -- meter backticks, puntos y coma, ni nombres en mayuscula.
  --
  -- OJO con el 'c' final de REGEXP_LIKE: la columna es utf8mb4_0900_ai_ci
  -- (insensible a mayusculas), asi que un REGEXP normal dejaria pasar
  -- 'BaseMala'. En Windows MySQL tampoco distingue mayusculas en los nombres
  -- de base, asi que 'Si_Tenant_X' y 'si_tenant_x' serian LA MISMA base.
  -- El modificador 'c' obliga a comparar distinguiendo mayusculas.
  CONSTRAINT `chk_empresas_nombre_db` CHECK (REGEXP_LIKE(`nombre_db`, '^[a-z][a-z0-9_]{0,63}$', 'c')),

  -- El slug sera el subdominio: siempre minusculas, sin guion al principio
  -- ni al final. Mismo motivo que arriba para el modificador 'c'.
  CONSTRAINT `chk_empresas_slug` CHECK (REGEXP_LIKE(`slug`, '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$', 'c')),

  CONSTRAINT `chk_empresas_color_primario`   CHECK (`color_primario`   IS NULL OR `color_primario`   REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT `chk_empresas_color_secundario` CHECK (`color_secundario` IS NULL OR `color_secundario` REGEXP '^#[0-9A-Fa-f]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- USUARIOS GLOBALES · todos los logins del sistema, en un solo lugar
-- ---------------------------------------------------------------------------
-- El email es UNICO a nivel global. Eso es una decision de diseño, no un
-- descuido: permite que el login averigue la empresa con solo el email,
-- sin pedirle nada mas al usuario. La contra es que una misma persona no
-- puede tener cuenta en dos empresas distintas.
--
-- empresa_id es NULL solamente para los SUPERADMIN, que no pertenecen a
-- ninguna empresa. El CHECK de abajo lo hace cumplir.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `usuarios_globales` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id`     INT UNSIGNED NULL COMMENT 'NULL solo si rol = SUPERADMIN',
  `email`          VARCHAR(150) NOT NULL,
  `password_hash`  VARCHAR(255) NOT NULL,
  `nombre`         VARCHAR(150) NOT NULL,
  `rol`            ENUM('ADMIN','TECNICO','SUPERADMIN') NOT NULL DEFAULT 'TECNICO',
  `activo`         TINYINT(1)   NOT NULL DEFAULT 1,
  `ultimo_acceso`  DATETIME     NULL,
  `creado_en`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ug_email`    (`email`),
  KEY `idx_ug_empresa`        (`empresa_id`),
  KEY `idx_ug_empresa_rol`    (`empresa_id`, `rol`),

  CONSTRAINT `fk_ug_empresa` FOREIGN KEY (`empresa_id`)
    REFERENCES `empresas` (`id`) ON DELETE CASCADE,

  CONSTRAINT `chk_ug_empresa` CHECK (`rol` = 'SUPERADMIN' OR `empresa_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- MODULOS · catalogo de todo lo que se puede contratar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `modulos` (
  `codigo`      VARCHAR(40) NOT NULL,
  `nombre`      VARCHAR(80) NOT NULL,
  `descripcion` VARCHAR(255) NULL,
  `es_base`     TINYINT(1)  NOT NULL DEFAULT 0 COMMENT 'Se activa solo en toda empresa nueva',
  `orden`       SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  PRIMARY KEY (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- PLANES · que incluye cada nivel de suscripcion
-- ---------------------------------------------------------------------------
-- max_usuarios NULL significa sin limite.
-- Los precios quedan NULL a proposito: los carga el dueño del negocio.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `planes` (
  `codigo`         VARCHAR(40) NOT NULL,
  `nombre`         VARCHAR(80) NOT NULL,
  `precio_mensual` DECIMAL(12,2) NULL,
  `moneda`         CHAR(3)     NOT NULL DEFAULT 'ARS',
  `max_usuarios`   SMALLINT UNSIGNED NULL,
  `orden`          SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  `activo`         TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- EMPRESA_MODULOS · que contrato cada empresa
-- ---------------------------------------------------------------------------
-- `limites` es JSON y permite ajustar caso por caso sin tocar el plan:
--     {"max_usuarios": 5, "max_productos": 2000}
-- NULL en `limites` = usar lo que dice el plan.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `empresa_modulos` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id`     INT UNSIGNED NOT NULL,
  `modulo`         VARCHAR(40)  NOT NULL,
  `activo`         TINYINT(1)   NOT NULL DEFAULT 1,
  `limites`        JSON         NULL,
  `fecha_desde`    DATE         NULL,
  `fecha_hasta`    DATE         NULL,
  `creado_en`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_em_empresa_modulo` (`empresa_id`, `modulo`),
  KEY `idx_em_modulo`               (`modulo`),

  CONSTRAINT `fk_em_empresa` FOREIGN KEY (`empresa_id`)
    REFERENCES `empresas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_em_modulo` FOREIGN KEY (`modulo`)
    REFERENCES `modulos` (`codigo`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- EMPRESA_METRICAS · la foto periodica de cada empresa
-- ---------------------------------------------------------------------------
-- Sin esto el SuperAdmin esta ciego: no hay forma de ver el estado de 50
-- empresas sin entrar una por una.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `empresa_metricas` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id`       INT UNSIGNED NOT NULL,
  `tomada_en`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `filas_totales`    BIGINT UNSIGNED NULL,
  `usuarios_activos` SMALLINT UNSIGNED NULL,
  `tamano_bytes`     BIGINT UNSIGNED NULL,
  `schema_version`   VARCHAR(20)  NULL COMMENT 'Ultima migracion aplicada a esa base',
  `backup_ok`        TINYINT(1)   NULL,
  `backup_en`        DATETIME     NULL,
  `detalle`          JSON         NULL,

  PRIMARY KEY (`id`),
  KEY `idx_metricas_empresa_fecha` (`empresa_id`, `tomada_en`),

  CONSTRAINT `fk_metricas_empresa` FOREIGN KEY (`empresa_id`)
    REFERENCES `empresas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------------
-- AUDITORIA · quien hizo que, desde donde
-- ---------------------------------------------------------------------------
-- Sin claves foraneas a proposito: si se borra una empresa o un usuario,
-- el registro de lo que paso tiene que sobrevivir.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `auditoria` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id` INT UNSIGNED NULL,
  `email`      VARCHAR(150) NULL,
  `empresa_id` INT UNSIGNED NULL,
  `accion`     VARCHAR(60)  NOT NULL COMMENT 'ej: empresa.crear, empresa.suspender, modulo.activar',
  `detalle`    JSON         NULL,
  `ip`         VARCHAR(45)  NULL,
  `creado_en`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_aud_fecha`   (`creado_en`),
  KEY `idx_aud_empresa` (`empresa_id`),
  KEY `idx_aud_accion`  (`accion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
