-- Migración: responsable del evento y documentos automáticos (préstamos y recepciones en borrador).
-- Ejecutar UNA vez sobre una base creada antes del 24-nov-2026 (01_schema.sql ya incluye estos cambios).
-- Solo agrega: no elimina columnas ni datos.

-- Responsable del evento: encargado de sus préstamos, recepciones y pagos.
-- NULL solo en eventos anteriores sin personal; la API lo exige al crear.
ALTER TABLE `evento`
  ADD COLUMN `responsable_id` INT NULL AFTER `cotizacion_id`,
  ADD KEY `fk_evento_responsable_idx` (`responsable_id`),
  ADD CONSTRAINT `fk_evento_responsable` FOREIGN KEY (`responsable_id`) REFERENCES `empleado` (`id_empleado`);

UPDATE `evento` e
   SET e.`responsable_id` = (SELECT t.`empleado_id` FROM `evento_tarea` t
                              WHERE t.`evento_id` = e.`id_evento` ORDER BY t.`id_evento_tarea` LIMIT 1)
 WHERE e.`responsable_id` IS NULL;

-- `programado`: borrador que aún no saca equipos de bodega. `automatico`: lo preparó el evento.
ALTER TABLE `prestamo_equipo`
  MODIFY COLUMN `estado` ENUM('programado','activo','devuelto','con_retraso','con_danos') NOT NULL DEFAULT 'activo',
  ADD COLUMN `automatico` TINYINT(1) NOT NULL DEFAULT 0 AFTER `estado`;

-- Sin proveedor = recepción interna de equipos propios.
ALTER TABLE `recepcion`
  MODIFY COLUMN `proveedor_id` INT NULL,
  ADD COLUMN `automatico` TINYINT(1) NOT NULL DEFAULT 0 AFTER `estado_recepcion`;
