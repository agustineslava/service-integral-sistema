-- ===========================================================================
-- 006 · CONFIGURACION POR EMPRESA (defaults por modulo + override)
-- ===========================================================================
-- Personalizar por empresa = datos de configuracion en la CENTRAL, nunca
-- codigo distinto por empresa.
--
--   `modulos.config_default` (JSON): lo que trae cada funcion de fabrica.
--   `empresa_modulos.config` (JSON): solo lo que esa empresa cambia; se mezcla
--       sobre el default. NULL = no cambio nada.
--
-- Alcance v1: reparaciones (campos visibles/obligatorios y etiqueta; mensaje de
-- WhatsApp al tecnico), stock (categorias propias) y pedidos (mensaje de
-- WhatsApp). Los estados de la orden quedan afuera (son enum en la base).
--
-- NOTA DE NUMERACION
--   El plan `docs/plan-config-empresa.md` la llamo 005, pero la 005 ya la ocupa
--   Cloudinary (`005_cloudinary_empresa.sql`). Esta es la 006.
--
-- ES PER-MODULO, NO LA CONFIG DE TODA LA EMPRESA
--   La columna vive en la fila de `modulos`, asi que guarda solo la config de
--   ese modulo. El endpoint `/api/config-empresa` (paso 3) arma el objeto
--   {"reparaciones": {...}, "stock": {...}, ...} juntando los modulos activos.
--
-- DEFAULT = LO QUE HOY HACE EL SISTEMA
--   Service Integral conserva exactamente el comportamiento actual: los campos
--   que hoy se ven siguen visibles y con su etiqueta; `cliente_nombre`,
--   `equipo` y `falla_declarada` siguen obligatorios (D1: `equipo` igual se
--   puede ocultar, y entonces se guarda ''); las categorias son las cinco de
--   siempre. `tipo_cobertura` solo cambia visibilidad y etiqueta (D3): sus dos
--   valores son un enum de la base y NO se tocan aca. El mensaje de WhatsApp
--   arranca igual al de hoy, con `{{empresa}}` en lugar del literal.
--
-- EXPAND: dos columnas NULL y un seed que solo escribe donde esta NULL. No
-- rompe al codigo anterior (todavia nadie lee estas columnas) ni al nuevo.
-- ===========================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1) modulos.config_default
-- ---------------------------------------------------------------------------
-- MySQL no tiene ADD COLUMN IF NOT EXISTS: se consulta el catalogo y se arma
-- la sentencia. Asi, si la migracion se corta a la mitad, se puede volver a
-- correr sin "Duplicate column name" (mismo patron que la 003).
SET @existe_default := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'modulos'
      AND COLUMN_NAME  = 'config_default'
);

SET @ddl_default := IF(@existe_default = 0,
    'ALTER TABLE `modulos`
       ADD COLUMN `config_default` JSON NULL
       COMMENT ''Config de fabrica del modulo (JSON). NULL = sin config''
       AFTER `orden`',
    'DO 0'
);

PREPARE stmt_default FROM @ddl_default;
EXECUTE stmt_default;
DEALLOCATE PREPARE stmt_default;

-- ---------------------------------------------------------------------------
-- 2) empresa_modulos.config
-- ---------------------------------------------------------------------------
SET @existe_config := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'empresa_modulos'
      AND COLUMN_NAME  = 'config'
);

SET @ddl_config := IF(@existe_config = 0,
    'ALTER TABLE `empresa_modulos`
       ADD COLUMN `config` JSON NULL
       COMMENT ''Override de la empresa sobre el default (JSON). NULL = usa el default''
       AFTER `limites`',
    'DO 0'
);

PREPARE stmt_config FROM @ddl_config;
EXECUTE stmt_config;
DEALLOCATE PREPARE stmt_config;

-- ---------------------------------------------------------------------------
-- 3) Defaults de fabrica (solo donde `config_default` esta en NULL)
-- ---------------------------------------------------------------------------
-- El seed es solo para las filas del catalogo que todavia no la tienen: si
-- alguien ya cargo config, no se pisa.

UPDATE `modulos`
SET `config_default` = JSON_OBJECT(
        'campos', JSON_OBJECT(
            'cliente_nombre',  JSON_OBJECT('visible', TRUE,  'obligatorio', TRUE),
            'equipo',          JSON_OBJECT('visible', TRUE,  'obligatorio', TRUE,  'etiqueta', 'Equipo y Modelo'),
            'falla_declarada', JSON_OBJECT('visible', TRUE,  'obligatorio', TRUE),
            'tipo_cobertura',  JSON_OBJECT('visible', TRUE,  'obligatorio', FALSE, 'etiqueta', 'Cobertura'),
            'direccion',       JSON_OBJECT('visible', TRUE,  'obligatorio', FALSE)
        ),
        'whatsapp_tecnico', '🛠️ *ORDEN DE TALLER #{{id}}*\n------------------------------------\n👤 *Cliente:* {{cliente}}\n📞 *Teléfono:* {{telefono}}\n📍 *Dirección:* {{direccion}}\n⚙️ *Equipo:* {{equipo}} ({{cobertura}})\n⚠️ *Falla Declarada:* {{falla}}\n📝 *Notas/Logística:* {{notas}}\n🔧 *Trabajo realizado:* {{trabajo}}\n🔩 *Repuestos:* {{repuestos}}\n📌 *Estado:* {{estado}}\n💵 *Total:* ${{total}}'
    )
WHERE `codigo` = 'reparaciones'
  AND `config_default` IS NULL;

UPDATE `modulos`
SET `config_default` = JSON_OBJECT(
        'categorias', JSON_ARRAY('Lavarropas', 'Heladeras', 'Lavavajillas', 'Secarropas', 'Otros')
    )
WHERE `codigo` = 'stock'
  AND `config_default` IS NULL;

UPDATE `modulos`
SET `config_default` = JSON_OBJECT(
        'whatsapp', '🛠️ *PEDIDO DE REPUESTOS* - {{empresa}}\n-----------------------------------------------\n{{items}}\n📝 *Notas:* {{notas}}'
    )
WHERE `codigo` = 'pedidos'
  AND `config_default` IS NULL;
