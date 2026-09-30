-- ===========================================================================
-- 004 · CLAVE TEMPORAL Y OBLIGATORIO CAMBIARLA
-- ===========================================================================
-- Cuando un cliente llama y dice "se me olvidó la contraseña", alguien tiene que
-- poder darle una. El canal elegido es el teléfono, no el correo: el sistema no
-- tiene proveedor de mail y mientras tanto el cliente no puede entrar.
--
-- Que el SuperAdmin escriba la contraseña a mano es mala idea por una razón
-- concreta: se queda sabiendo la contraseña de un cliente. Por eso esta
-- migración no habilita eso, sino dos cosas:
--
--   1. `clave_temporal`: el sistema genera una clave aleatoria, la muestra una
--      sola vez y nunca más la guarda. El SuperAdmin la lee por teléfono y no
--      elige nada.
--
--   2. `debe_cambiar_password`: quedo marcada. La sesion de esa persona entra
--      pero no puede hacer NADA mas que cambiar la clave. No es una ayuda en la
--      pantalla: se verifica en el servidor, en cada request.
--
-- Por que una columna y no reusar algo: `activo` dice si la cuenta existe,
-- `debe_cambiar_password` dice si la clave que tiene sirve. Son preguntas
-- distintas y una persona desactivada con clave temporal pendiente no es un
-- estado que se pueda expresar con un solo booleano.
--
-- EXPAND: se agrega una columna NULL con default 0. No rompe el codigo anterior
-- (nadie la mira todavia) ni el nuevo. Los usuarios que ya existen arrancan con
-- 0 = "no tiene que cambiar nada", que es lo correcto: sus claves funcionan.
-- ===========================================================================

SET NAMES utf8mb4;

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'usuarios_globales'
      AND COLUMN_NAME  = 'debe_cambiar_password'
);

SET @ddl := IF(@existe = 0,
    'ALTER TABLE `usuarios_globales`
       ADD COLUMN `debe_cambiar_password` TINYINT(1) NOT NULL DEFAULT 0
       COMMENT ''1 = entro con una clave temporal y tiene que cambiarla''
       AFTER `activo`',
    'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;