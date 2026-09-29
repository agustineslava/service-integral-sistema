-- ===========================================================================
-- 003 · LIMITE DE USUARIOS POR EMPRESA
-- ===========================================================================
-- El plan define cuantos usuarios entran (Basico = 3, Profesional = 10,
-- Ilimitado = sin tope). Pero la realidad no siempre coincide con el plan: el
-- primer cliente ya tiene 4 usuarios con un plan que permite 3.
--
-- En vez de inventar un plan nuevo por cada excepcion, la empresa puede tener
-- su propio tope. Vale NULL = "usar el del plan".
--
-- Limite efectivo = COALESCE(empresas.max_usuarios, planes.max_usuarios)
--
-- Por que una columna y no el JSON de empresa_modulos: los usuarios no son un
-- modulo vendible. Mezclarlos hacia que "cuantos usuarios entran" hubiera que
-- buscarlo en una tabla de modulos.
--
-- EXPAND: se agrega una columna NULL. No rompe el codigo anterior ni el nuevo.
-- ===========================================================================

SET NAMES utf8mb4;

-- DDL guardado: si la columna ya existe, no hace nada.
-- MySQL no tiene ADD COLUMN IF NOT EXISTS, asi que se consulta el catalogo y
-- se prepara la sentencia. Asi, si una migracion se corta a la mitad, se puede
-- volver a correr sin que explote con "Duplicate column name".
SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'empresas'
      AND COLUMN_NAME  = 'max_usuarios'
);

SET @ddl := IF(@existe = 0,
    'ALTER TABLE `empresas`
       ADD COLUMN `max_usuarios` SMALLINT UNSIGNED NULL
       COMMENT ''Excepcion al plan. NULL = usar planes.max_usuarios''
       AFTER `plan`',
    'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
