-- ===========================================================================
-- 005 · CUENTA DE CLOUDINARY POR EMPRESA
-- ===========================================================================
-- Hoy hay UNA sola cuenta de Cloudinary (`CLOUDINARY_*` del .env) y todas las
-- empresas suben ahi. Esta tabla permite que cada empresa tenga la suya: el
-- SuperAdmin carga cloud_name / api_key / api_secret desde el panel y las
-- subidas de esa empresa van a su cuenta. Las empresas sin fila siguen usando
-- la de plataforma, asi que nada cambia para ellas.
--
-- POR QUE UNA TABLA APARTE Y NO COLUMNAS EN `empresas`
--   `registro.empresaPorId()` hace `SELECT e.*` y cachea esa fila por request.
--   Si el api_secret viviera ahi, viajaria en ese objeto (y podria terminar en
--   un log). Aca se consulta solo cuando hace falta subir o borrar.
--
-- EL SECRETO VA CIFRADO
--   `api_secret_cifrado` guarda base64(iv | auth_tag | ciphertext) de
--   AES-256-GCM con la clave del entorno `CREDENCIALES_KEY`. Nunca se devuelve
--   al frontend, ni se escribe en logs, ni en MEMORY.md.
--
-- `activo` ARRANCA EN 0
--   La cuenta pasa a 1 recien cuando el SuperAdmin prueba la conexion con esas
--   credenciales y la prueba pasa (D9). Hasta entonces no se usa: una carga a
--   medias no manda fotos a una cuenta rota y no rompe las subidas.
--
-- EXPAND: tabla nueva. No rompe al codigo anterior (nadie la mira) ni al nuevo.
-- ===========================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `empresa_cloudinary` (
  `empresa_id`         INT UNSIGNED NOT NULL COMMENT 'Una cuenta por empresa: la que trae el cliente.',

  `cloud_name`         VARCHAR(80)  NOT NULL,
  `api_key`            VARCHAR(64)  NOT NULL,
  `api_secret_cifrado` TEXT         NOT NULL COMMENT 'base64(iv | auth_tag | ciphertext), AES-256-GCM',

  `activo`             TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = probada y usable; 0 = todavia no',
  `configurado_en`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`empresa_id`),

  CONSTRAINT `fk_ec_empresa` FOREIGN KEY (`empresa_id`)
    REFERENCES `empresas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
