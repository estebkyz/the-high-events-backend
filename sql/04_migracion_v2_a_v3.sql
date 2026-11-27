-- =============================================================================
-- Migración de una base v2 a v3: el evento como centro, sin datos repetidos, y los campos
-- que se retiraron o renombraron en el .mwb del 26-nov-2026.
-- ANTES: respaldo completo (mysqldump). Los cambios de estructura no se pueden deshacer
-- con ROLLBACK. Primero se agrega y se copia; al final se borra lo que quedó repetido,
-- así que si un paso falla antes del bloque 6, no se ha perdido nada.
-- Compatible con MySQL 8.0.19+ y MariaDB 10.4+.
-- =============================================================================
USE `the_high_events_db`;

-- 1. Evento: precio real, estado de cotización y datos que pueden faltar mientras se cotiza
ALTER TABLE `evento`
  ADD COLUMN `valor_total` DECIMAL(12,2) NULL AFTER `presupuesto_estimado`,
  ADD COLUMN `cotizacion_origen` INT NULL,
  MODIFY COLUMN `ubicacion_evento` VARCHAR(200) NULL,
  MODIFY COLUMN `fecha_hora_inicio` DATETIME NULL,
  MODIFY COLUMN `fecha_hora_fin` DATETIME NULL,
  MODIFY COLUMN `estado` ENUM('cotizacion','planificacion','confirmado','montaje','en_ejecucion','desmontaje','finalizado','cerrado_financiero','cancelado') NOT NULL DEFAULT 'planificacion';

-- 2. Cada cotización sin evento pasa a ser un evento en cotización (o cancelado si no prosperó)
INSERT INTO `evento` (`cliente_id`, `responsable_id`, `modalidad`, `nombre_evento`, `ubicacion_evento`,
                      `fecha_hora_inicio`, `fecha_hora_fin`, `presupuesto_estimado`, `estado`,
                      `aforo_esperado`, `concepto_espectaculo`, `cotizacion_origen`)
SELECT c.`cliente_id`, c.`empleado_id`, 'cliente', c.`nombre_evento`, c.`ubicacion_evento`,
       c.`fecha_hora_inicio`, c.`fecha_hora_fin`, c.`presupuesto_estimado`,
       CASE WHEN c.`estado` IN ('rechazada','vencida') THEN 'cancelado' ELSE 'cotizacion' END,
       COALESCE(c.`aforo_esperado`, 0), c.`concepto_espectaculo`, c.`id_cotizacion`
  FROM `cotizacion` c
 WHERE NOT EXISTS (SELECT 1 FROM `evento` e WHERE e.`cotizacion_id` = c.`id_cotizacion`);

-- 3. La cotización apunta a su evento y numera sus versiones
ALTER TABLE `cotizacion`
  ADD COLUMN `evento_id` INT NULL AFTER `id_cotizacion`,
  ADD COLUMN `version` INT NOT NULL DEFAULT 1 AFTER `empleado_id`;

UPDATE `cotizacion` c
  JOIN (SELECT `cotizacion_id`, MIN(`id_evento`) AS ev FROM `evento`
         WHERE `cotizacion_id` IS NOT NULL GROUP BY `cotizacion_id`) x ON x.`cotizacion_id` = c.`id_cotizacion`
   SET c.`evento_id` = x.ev;
UPDATE `cotizacion` c JOIN `evento` e ON e.`cotizacion_origen` = c.`id_cotizacion`
   SET c.`evento_id` = e.`id_evento`;

CREATE TEMPORARY TABLE `tmp_version` AS
  SELECT `id_cotizacion`, ROW_NUMBER() OVER (PARTITION BY `evento_id` ORDER BY `fecha_emision`, `id_cotizacion`) AS v
    FROM `cotizacion`;
UPDATE `cotizacion` c JOIN `tmp_version` t ON t.`id_cotizacion` = c.`id_cotizacion` SET c.`version` = t.v;
DROP TEMPORARY TABLE `tmp_version`;

-- Una sola aceptada por evento: si hubiera varias, queda la más reciente
CREATE TEMPORARY TABLE `tmp_aceptada` AS
  SELECT `evento_id`, MAX(`id_cotizacion`) AS ultima FROM `cotizacion` WHERE `estado` = 'aceptada' GROUP BY `evento_id`;
UPDATE `cotizacion` c JOIN `tmp_aceptada` t ON t.`evento_id` = c.`evento_id`
   SET c.`estado` = 'rechazada'
 WHERE c.`estado` = 'aceptada' AND c.`id_cotizacion` <> t.ultima;
DROP TEMPORARY TABLE `tmp_aceptada`;

-- Regla de negocio: un evento para cliente que ya pasó de cotización tiene su cotización aceptada.
-- a) Si tiene una oferta abierta (borrador o enviada), la más reciente queda aceptada.
CREATE TEMPORARY TABLE `tmp_abierta` AS
  SELECT c.`evento_id`, MAX(c.`id_cotizacion`) AS ultima
    FROM `cotizacion` c JOIN `evento` e ON e.`id_evento` = c.`evento_id`
   WHERE e.`modalidad` = 'cliente' AND e.`estado` NOT IN ('cotizacion','cancelado')
     AND c.`estado` IN ('borrador','enviada')
     AND NOT EXISTS (SELECT 1 FROM `cotizacion` a WHERE a.`evento_id` = c.`evento_id` AND a.`estado` = 'aceptada')
   GROUP BY c.`evento_id`;
UPDATE `cotizacion` c JOIN `tmp_abierta` t ON t.`ultima` = c.`id_cotizacion` SET c.`estado` = 'aceptada';
DROP TEMPORARY TABLE `tmp_abierta`;
-- b) Si no tiene ninguna, recibe una cotización aceptada que lo deja indicado (su detalle se arma en el paso 4)
INSERT INTO `cotizacion` (`evento_id`, `cliente_id`, `nombre_evento`, `empleado_id`, `version`, `estado`, `observaciones`, `fecha_emision`, `fecha_vencimiento`)
SELECT e.`id_evento`, e.`cliente_id`, e.`nombre_evento`, COALESCE(e.`responsable_id`, (SELECT MIN(`id_empleado`) FROM `empleado`)),
       (SELECT COALESCE(MAX(v.`version`), 0) + 1 FROM `cotizacion` v WHERE v.`evento_id` = e.`id_evento`), 'aceptada',
       'Registrada al migrar: el evento de cliente no tenía cotización aceptada', DATE(e.`fecha_creacion`), DATE(e.`fecha_creacion`)
  FROM `evento` e
 WHERE e.`modalidad` = 'cliente'
   AND NOT EXISTS (SELECT 1 FROM `cotizacion` a WHERE a.`evento_id` = e.`id_evento` AND a.`estado` = 'aceptada')
   AND (e.`estado` NOT IN ('cotizacion','cancelado')
        OR NOT EXISTS (SELECT 1 FROM `cotizacion` c WHERE c.`evento_id` = e.`id_evento`));

-- 4. Valor real del evento: lo facturado; si no hay venta, lo aceptado en la cotización
UPDATE `evento` e
  JOIN (SELECT `evento_id`, SUM(`total`) AS t FROM `venta` WHERE `estado` = 'confirmada' GROUP BY `evento_id`) v
    ON v.`evento_id` = e.`id_evento`
   SET e.`valor_total` = v.t;
UPDATE `evento` e
  JOIN (SELECT c.`evento_id`, SUM(d.`cantidad` * d.`precio_unitario`) AS t
          FROM `cotizacion` c JOIN `cotizacion_detalle` d ON d.`cotizacion_id` = c.`id_cotizacion`
         WHERE c.`estado` = 'aceptada' GROUP BY c.`evento_id`) q ON q.`evento_id` = e.`id_evento`
   SET e.`valor_total` = q.t
 WHERE e.`valor_total` IS NULL;

-- Los servicios del evento de cliente son los de su cotización aceptada: ambos quedan con la misma lista.
-- La cotización registrada al migrar copia los servicios del evento (después de fijar el valor, que no cambia).
INSERT INTO `cotizacion_detalle` (`cotizacion_id`, `servicio_id`, `cantidad`, `precio_unitario`)
SELECT c.`id_cotizacion`, es.`servicio_id`, es.`cantidad`, s.`precio_base`
  FROM `cotizacion` c
  JOIN `evento` e ON e.`id_evento` = c.`evento_id` AND e.`modalidad` = 'cliente'
  JOIN `evento_servicio` es ON es.`evento_id` = c.`evento_id`
  JOIN `servicio` s ON s.`id_servicio` = es.`servicio_id`
 WHERE c.`estado` = 'aceptada'
   AND NOT EXISTS (SELECT 1 FROM `cotizacion_detalle` d WHERE d.`cotizacion_id` = c.`id_cotizacion` AND d.`servicio_id` = es.`servicio_id`);
INSERT INTO `evento_servicio` (`evento_id`, `servicio_id`, `cantidad`, `costo`)
SELECT c.`evento_id`, d.`servicio_id`, d.`cantidad`, s.`precio_base`
  FROM `cotizacion` c
  JOIN `evento` e ON e.`id_evento` = c.`evento_id` AND e.`modalidad` = 'cliente'
  JOIN `cotizacion_detalle` d ON d.`cotizacion_id` = c.`id_cotizacion`
  JOIN `servicio` s ON s.`id_servicio` = d.`servicio_id`
 WHERE c.`estado` = 'aceptada'
   AND NOT EXISTS (SELECT 1 FROM `evento_servicio` x WHERE x.`evento_id` = c.`evento_id` AND x.`servicio_id` = d.`servicio_id`);

-- Una sola venta vigente por evento: las repetidas sin pagos se anulan.
-- Si quedan repetidas con pagos, el paso 5 se detiene sin haber borrado nada.
UPDATE `venta` v
  JOIN (SELECT `evento_id`, MIN(`id_venta`) AS primera FROM `venta` WHERE `estado` = 'confirmada' GROUP BY `evento_id`) p
    ON p.`evento_id` = v.`evento_id`
   SET v.`estado` = 'anulada'
 WHERE v.`estado` = 'confirmada' AND v.`id_venta` <> p.primera
   AND NOT EXISTS (SELECT 1 FROM `pago_cliente` pc WHERE pc.`venta_id` = v.`id_venta`);

-- 5. Agendamiento: tipos de reunión, fecha tentativa sin hora y relación sin repetir el cliente
ALTER TABLE `agendamiento`
  MODIFY COLUMN `tipo_agendamiento` ENUM('evento','reunion_cliente','visita_tecnica','otro') NOT NULL DEFAULT 'reunion_cliente';
UPDATE `agendamiento` SET `tipo_agendamiento` = 'otro' WHERE `tipo_agendamiento` = 'evento';
UPDATE `agendamiento` a JOIN `cotizacion` c ON c.`id_cotizacion` = a.`cotizacion_id`
   SET a.`evento_id` = c.`evento_id`
 WHERE a.`evento_id` IS NULL;
UPDATE `agendamiento` SET `cliente_id` = NULL WHERE `evento_id` IS NOT NULL;
UPDATE `agendamiento` SET `fecha_tentativa_evento` = DATE(`fecha_tentativa_evento`) WHERE `fecha_tentativa_evento` IS NOT NULL;

-- Las nuevas reglas, antes de borrar: si alguna falla, no se ha perdido nada
ALTER TABLE `cotizacion`
  MODIFY COLUMN `evento_id` INT NOT NULL,
  ADD COLUMN `evento_aceptado` INT GENERATED ALWAYS AS (IF(`estado` = 'aceptada', `evento_id`, NULL)) STORED AFTER `fecha_vencimiento`,
  ADD UNIQUE KEY `uq_cot_evento_version` (`evento_id`, `version`),
  ADD UNIQUE KEY `uq_cot_una_aceptada` (`evento_aceptado`),
  ADD CONSTRAINT `fk_cot_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`),
  ADD CONSTRAINT `ck_cot_version` CHECK (`version` > 0);
ALTER TABLE `venta`
  ADD COLUMN `evento_vigente` INT GENERATED ALWAYS AS (IF(`estado` = 'confirmada', `evento_id`, NULL)) STORED,
  ADD UNIQUE KEY `uq_venta_vigente` (`evento_vigente`);
ALTER TABLE `evento`
  ADD CONSTRAINT `ck_evento_programado` CHECK (`estado` IN ('cotizacion','cancelado') OR (`fecha_hora_inicio` IS NOT NULL AND `fecha_hora_fin` IS NOT NULL AND `ubicacion_evento` IS NOT NULL)),
  ADD CONSTRAINT `ck_evento_valor` CHECK (`valor_total` IS NULL OR `valor_total` >= 0);
ALTER TABLE `agendamiento`
  MODIFY COLUMN `tipo_agendamiento` ENUM('reunion_cliente','visita_tecnica','otro') NOT NULL DEFAULT 'reunion_cliente',
  MODIFY COLUMN `fecha_tentativa_evento` DATE NULL,
  ADD CONSTRAINT `ck_agendamiento_relacion` CHECK (`evento_id` IS NULL OR `cliente_id` IS NULL);

-- Recepciones: una sola acta vigente por evento, origen (proveedor o propios) y tipo.
-- Si un proveedor ya tiene dos entregas vigentes en un mismo evento, esto falla sin haber borrado nada.
ALTER TABLE `recepcion`
  ADD COLUMN `entrega_vigente` VARCHAR(40) GENERATED ALWAYS AS (IF(`estado_recepcion` = 'anulada', NULL, CONCAT(`evento_id`, '-', IFNULL(`proveedor_id`, 0), '-', `tipo_recepcion`))) STORED AFTER `url_firma_proveedor`,
  ADD UNIQUE KEY `uq_rep_una_entrega` (`entrega_vigente`);

-- Nombres nuevos (sin pérdida de datos)
ALTER TABLE `evento` CHANGE COLUMN `concepto_espectaculo` `concepto_evento` VARCHAR(255) NULL;
ALTER TABLE `equipo` CHANGE COLUMN `costo_alquiler_dia` `costo_alquiler` DECIMAL(12,2) NULL;
ALTER TABLE `incidente`
  CHANGE COLUMN `fecha_reporte` `fecha_hora_reporte` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHANGE COLUMN `fecha_solucion` `fecha_hora_solucion` TIMESTAMP NULL DEFAULT NULL;

-- 6. Lo repetido sale: el evento es la única fuente de cliente, fechas, lugar, aforo y valor
ALTER TABLE `agendamiento`
  DROP FOREIGN KEY `fk_agendamiento_cotizacion`;
ALTER TABLE `agendamiento`
  DROP INDEX `fk_agendamiento_cotizacion_idx`,
  DROP COLUMN `cotizacion_id`;

ALTER TABLE `venta`
  DROP FOREIGN KEY `fk_venta_cliente`,
  DROP FOREIGN KEY `fk_venta_cotizacion`;
ALTER TABLE `venta`
  DROP CONSTRAINT `ck_venta_total`;
ALTER TABLE `venta`
  DROP INDEX `fk_venta_cliente`,
  DROP INDEX `fk_venta_cotizacion_idx`,
  DROP COLUMN `cliente_id`,
  DROP COLUMN `cotizacion_id`,
  DROP COLUMN `total`;

ALTER TABLE `evento`
  DROP FOREIGN KEY `fk_evento_cotizacion`;
ALTER TABLE `evento`
  DROP INDEX `fk_evento_cotizacion_idx`,
  DROP COLUMN `cotizacion_id`,
  DROP COLUMN `cotizacion_origen`;

ALTER TABLE `cotizacion`
  DROP FOREIGN KEY `fk_cot_cliente`;
ALTER TABLE `cotizacion`
  DROP CONSTRAINT `ck_cot_horario`;
ALTER TABLE `cotizacion`
  DROP INDEX `fk_cot_cliente_idx`,
  DROP COLUMN `cliente_id`,
  DROP COLUMN `nombre_evento`,
  DROP COLUMN `ubicacion_evento`,
  DROP COLUMN `fecha_hora_inicio`,
  DROP COLUMN `fecha_hora_fin`,
  DROP COLUMN `presupuesto_estimado`,
  DROP COLUMN `aforo_esperado`,
  DROP COLUMN `concepto_espectaculo`,
  DROP COLUMN `total_cotizado`;

-- 7. Campos que el modelo ya no usa (se pierden sus datos)
ALTER TABLE `recepcion` DROP FOREIGN KEY `fk_rep_origen`;
ALTER TABLE `recepcion` DROP INDEX `fk_rep_origen_idx`, DROP COLUMN `recepcion_origen_id`;
ALTER TABLE `equipo` DROP CONSTRAINT `ck_equipo_cantidad`;
ALTER TABLE `equipo` DROP COLUMN `cantidad_total`, DROP COLUMN `mantenimiento_proximo`;
ALTER TABLE `usuario` DROP COLUMN `reset_token_hash`, DROP COLUMN `reset_token_expira`;
ALTER TABLE `cliente` DROP COLUMN `ciudad`;
ALTER TABLE `empleado` DROP COLUMN `emergencia_nombre`, DROP COLUMN `emergencia_telefono`, DROP COLUMN `emergencia_parentesco`;
ALTER TABLE `evento` DROP COLUMN `publico_objetivo`;
ALTER TABLE `agendamiento` DROP COLUMN `ubicacion`, DROP COLUMN `modalidad_cita`;
ALTER TABLE `incidente` DROP COLUMN `area_afectada`, DROP COLUMN `costo_adicional`;
