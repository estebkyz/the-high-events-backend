-- =============================================================================
-- The High Events — Esquema de base de datos v2
-- Compatible con MySQL 8.x y MariaDB 10.5+ (sin sintaxis VISIBLE/INVISIBLE).
-- Base: ingeniería inversa del .mwb original + correcciones (ver docs/DB_CAMBIOS_V2.md).
-- Idempotente: se puede ejecutar sobre una base vacía. Para una base v1 existente
-- use sql/03_migracion_v1_a_v2.sql.
-- =============================================================================
CREATE DATABASE IF NOT EXISTS `the_high_events_db`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `the_high_events_db`;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Seguridad: roles, permisos y usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `rol` (
  `id_rol` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(60) NOT NULL,
  `descripcion` VARCHAR(255) NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id_rol`),
  UNIQUE KEY `uq_rol_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `permiso` (
  `id_modulo` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id_modulo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `privilegio` (
  `id_privilegio` INT NOT NULL AUTO_INCREMENT,
  `id_modulo` INT NOT NULL,
  `nombre` VARCHAR(120) NOT NULL,
  `codigo` VARCHAR(60) NOT NULL,
  PRIMARY KEY (`id_privilegio`),
  UNIQUE KEY `uq_privilegio_codigo` (`codigo`),
  KEY `fk_privilegio_modulo_idx` (`id_modulo`),
  CONSTRAINT `fk_privilegio_modulo` FOREIGN KEY (`id_modulo`) REFERENCES `permiso` (`id_modulo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rol_privilegio` (
  `rol_id` INT NOT NULL,
  `privilegio_id` INT NOT NULL,
  PRIMARY KEY (`rol_id`, `privilegio_id`),
  KEY `fk_rp_privilegio_idx` (`privilegio_id`),
  CONSTRAINT `fk_rp_rol` FOREIGN KEY (`rol_id`) REFERENCES `rol` (`id_rol`) ON DELETE CASCADE,
  CONSTRAINT `fk_rp_privilegio` FOREIGN KEY (`privilegio_id`) REFERENCES `privilegio` (`id_privilegio`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `usuario` (
  `id_usuario` INT NOT NULL AUTO_INCREMENT,
  `rol_id` INT NOT NULL,
  `tipo_documento` ENUM('CC','CE','NIT','PASAPORTE') NOT NULL DEFAULT 'CC',
  `numero_documento` VARCHAR(20) NOT NULL,
  `nombre` VARCHAR(50) NOT NULL,
  `apellido` VARCHAR(50) NOT NULL,
  `correo` VARCHAR(150) NOT NULL,
  `telefono` VARCHAR(20) NULL,
  `contrasena_hash` VARCHAR(255) NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `sesion_acceso` TIMESTAMP NULL DEFAULT NULL,
  `intentos_fallidos` INT NOT NULL DEFAULT 0,
  `bloqueado_hasta` DATETIME NULL,
  `reset_token_hash` CHAR(64) NULL,
  `reset_token_expira` DATETIME NULL,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_usuario`),
  UNIQUE KEY `uq_usuario_documento` (`numero_documento`),
  UNIQUE KEY `uq_usuario_correo` (`correo`),
  KEY `fk_usuario_rol` (`rol_id`),
  CONSTRAINT `fk_usuario_rol` FOREIGN KEY (`rol_id`) REFERENCES `rol` (`id_rol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `registro_acceso` (
  `id_sesion` INT NOT NULL AUTO_INCREMENT,
  `usuario_id` INT NOT NULL,
  `ip_address` VARCHAR(45) NULL,
  `dispositivo` VARCHAR(255) NULL,
  `tipo_acceso` ENUM('login_exitoso','login_fallido','logout','recuperacion_password') NOT NULL DEFAULT 'login_exitoso',
  `fecha_hora` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_sesion`),
  KEY `fk_sesion_usuario` (`usuario_id`),
  CONSTRAINT `fk_sesion_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id_usuario`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Terceros: clientes, empleados, proveedores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cliente` (
  `id_cliente` INT NOT NULL AUTO_INCREMENT,
  `tipo_cliente` ENUM('persona_natural','empresa') NOT NULL DEFAULT 'persona_natural',
  `razon_social` VARCHAR(150) NULL,
  `nombre` VARCHAR(50) NULL,
  `apellido` VARCHAR(50) NULL,
  `contacto_nombre` VARCHAR(100) NULL,
  `tipo_documento` ENUM('CC','CE','NIT','PASAPORTE') NOT NULL,
  `numero_documento` VARCHAR(20) NOT NULL,
  `correo` VARCHAR(150) NOT NULL,
  `telefono` VARCHAR(20) NOT NULL,
  `direccion` VARCHAR(200) NOT NULL,
  `ciudad` VARCHAR(80) NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_cliente`),
  UNIQUE KEY `uq_cliente_documento` (`numero_documento`),
  UNIQUE KEY `uq_cliente_correo` (`correo`),
  CONSTRAINT `ck_cliente_identidad` CHECK (
    (`tipo_cliente` = 'empresa' AND `razon_social` IS NOT NULL)
    OR (`tipo_cliente` = 'persona_natural' AND `nombre` IS NOT NULL AND `apellido` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `empleado` (
  `id_empleado` INT NOT NULL AUTO_INCREMENT,
  `tipo_documento` ENUM('CC','CE','NIT','PASAPORTE') NOT NULL DEFAULT 'CC',
  `numero_documento` VARCHAR(20) NOT NULL,
  `nombre` VARCHAR(50) NOT NULL,
  `apellido` VARCHAR(50) NULL,
  `cargo` VARCHAR(45) NOT NULL,
  `telefono` VARCHAR(20) NOT NULL,
  `correo` VARCHAR(150) NULL,
  `vinculacion` ENUM('fijo','por_evento') NOT NULL DEFAULT 'fijo',
  `emergencia_nombre` VARCHAR(100) NULL,
  `emergencia_telefono` VARCHAR(20) NULL,
  `emergencia_parentesco` VARCHAR(40) NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_empleado`),
  UNIQUE KEY `uq_empleado_documento` (`numero_documento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proveedor` (
  `id_proveedor` INT NOT NULL AUTO_INCREMENT,
  `tipo_documento` ENUM('CC','CE','NIT','PASAPORTE') NOT NULL DEFAULT 'NIT',
  `numero_documento` VARCHAR(50) NOT NULL,
  `razon_social` VARCHAR(150) NOT NULL,
  `contacto_nombre` VARCHAR(50) NOT NULL,
  `contacto_apellido` VARCHAR(50) NOT NULL,
  `telefono` VARCHAR(20) NOT NULL,
  `correo` VARCHAR(150) NOT NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_proveedor`),
  UNIQUE KEY `uq_proveedor_documento` (`numero_documento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Catálogos: servicios y equipos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `categoria_servicio` (
  `id_categoria_servicio` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  `descripcion` VARCHAR(255) NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id_categoria_servicio`),
  UNIQUE KEY `uq_categoria_servicio_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `servicio` (
  `id_servicio` INT NOT NULL AUTO_INCREMENT,
  `categoria_id` INT NOT NULL,
  `nombre` VARCHAR(120) NOT NULL,
  `descripcion` TEXT NULL,
  `tipo_cobro` ENUM('por_evento','por_hora','por_dia','por_persona','tarifa_fija') NOT NULL DEFAULT 'por_evento',
  `precio_base` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id_servicio`),
  KEY `categoria_servicio_id_idx` (`categoria_id`),
  CONSTRAINT `fk_servicio_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categoria_servicio` (`id_categoria_servicio`),
  CONSTRAINT `ck_servicio_precio` CHECK (`precio_base` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proveedor_servicio` (
  `proveedor_id` INT NOT NULL,
  `servicio_id` INT NOT NULL,
  `valor` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`proveedor_id`, `servicio_id`),
  KEY `fk_ps_servicio` (`servicio_id`),
  CONSTRAINT `fk_ps_proveedor` FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor` (`id_proveedor`) ON DELETE CASCADE,
  CONSTRAINT `fk_ps_servicio` FOREIGN KEY (`servicio_id`) REFERENCES `servicio` (`id_servicio`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `categoria_equipo` (
  `id_categoria_equipo` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(45) NOT NULL,
  `descripcion` VARCHAR(255) NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id_categoria_equipo`),
  UNIQUE KEY `uq_categoria_equipo_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `equipo` (
  `id_equipo` INT NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(20) NULL,
  `nombre` VARCHAR(120) NOT NULL,
  `numero_serie` VARCHAR(80) NULL,
  `tipo_propiedad` ENUM('propio','alquilado') NOT NULL DEFAULT 'propio',
  `cantidad_total` INT NOT NULL DEFAULT 1,
  `estado` ENUM('disponible','en_evento','prestado','en_mantenimiento','de_baja') NOT NULL DEFAULT 'disponible',
  `costo_adquisicion` DECIMAL(12,2) NULL,
  `costo_alquiler_dia` DECIMAL(12,2) NULL,
  `mantenimiento_proximo` DATE NULL,
  `observaciones` TEXT NULL,
  `categoria_id` INT NOT NULL,
  `proveedor_id` INT NULL,
  PRIMARY KEY (`id_equipo`),
  UNIQUE KEY `uq_equipo_codigo` (`codigo`),
  KEY `fk_categoria_equipo_idx` (`categoria_id`),
  KEY `fk_equipo_proveedor_idx` (`proveedor_id`),
  CONSTRAINT `fk_categoria_equipo` FOREIGN KEY (`categoria_id`) REFERENCES `categoria_equipo` (`id_categoria_equipo`),
  CONSTRAINT `fk_proveedor_equipo` FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor` (`id_proveedor`),
  CONSTRAINT `ck_equipo_cantidad` CHECK (`cantidad_total` >= 0),
  -- Un equipo alquilado debe tener proveedor (regla de negocio de la ficha)
  CONSTRAINT `ck_equipo_alquilado_proveedor` CHECK (`tipo_propiedad` = 'propio' OR `proveedor_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Comercial: cotizaciones, eventos, agendamiento, ventas, pagos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cotizacion` (
  `id_cotizacion` INT NOT NULL AUTO_INCREMENT,
  `cliente_id` INT NOT NULL,
  `empleado_id` INT NOT NULL,
  `nombre_evento` VARCHAR(150) NOT NULL,
  `ubicacion_evento` VARCHAR(200) NULL,
  `fecha_hora_inicio` DATETIME NULL,
  `fecha_hora_fin` DATETIME NULL,
  `presupuesto_estimado` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `estado` ENUM('borrador','enviada','aceptada','rechazada','vencida') NOT NULL DEFAULT 'borrador',
  `aforo_esperado` INT NULL,
  `concepto_espectaculo` VARCHAR(255) NULL,
  `total_cotizado` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `observaciones` TEXT NULL,
  `url_documento` VARCHAR(255) NULL,
  `fecha_emision` DATE NOT NULL,
  `fecha_vencimiento` DATE NOT NULL,
  PRIMARY KEY (`id_cotizacion`),
  KEY `fk_cot_empleado_idx` (`empleado_id`),
  KEY `fk_cot_cliente_idx` (`cliente_id`),
  CONSTRAINT `fk_cot_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `empleado` (`id_empleado`),
  CONSTRAINT `fk_cot_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `cliente` (`id_cliente`),
  CONSTRAINT `ck_cot_fechas` CHECK (`fecha_vencimiento` >= `fecha_emision`),
  CONSTRAINT `ck_cot_horario` CHECK (`fecha_hora_inicio` IS NULL OR `fecha_hora_fin` IS NULL OR `fecha_hora_fin` > `fecha_hora_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v2: se eliminan los UNIQUE de cotizacion_id y servicio_id (v1 solo permitía 1 servicio por cotización)
CREATE TABLE IF NOT EXISTS `cotizacion_detalle` (
  `id_cotizacion_detalle` INT NOT NULL AUTO_INCREMENT,
  `cotizacion_id` INT NOT NULL,
  `servicio_id` INT NOT NULL,
  `cantidad` INT NOT NULL DEFAULT 1,
  `precio_unitario` DECIMAL(12,2) NOT NULL,
  `observaciones` VARCHAR(255) NULL,
  PRIMARY KEY (`id_cotizacion_detalle`),
  UNIQUE KEY `uq_cotdet_cot_serv` (`cotizacion_id`, `servicio_id`),
  KEY `fk_detalle_servicio` (`servicio_id`),
  CONSTRAINT `fk_detalle_cotizacion` FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizacion` (`id_cotizacion`) ON DELETE CASCADE,
  CONSTRAINT `fk_detalle_servicio` FOREIGN KEY (`servicio_id`) REFERENCES `servicio` (`id_servicio`),
  CONSTRAINT `ck_cotdet_cantidad` CHECK (`cantidad` > 0 AND `precio_unitario` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `evento` (
  `id_evento` INT NOT NULL AUTO_INCREMENT,
  `cliente_id` INT NULL,
  `cotizacion_id` INT NULL,
  `modalidad` ENUM('propio','cliente') NOT NULL DEFAULT 'cliente',
  `nombre_evento` VARCHAR(150) NOT NULL,
  `tipo_evento` VARCHAR(60) NULL,
  `ubicacion_evento` VARCHAR(200) NOT NULL,
  `fecha_hora_inicio` DATETIME NOT NULL,
  `fecha_hora_fin` DATETIME NOT NULL,
  `presupuesto_estimado` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `estado` ENUM('planificacion','confirmado','montaje','en_ejecucion','desmontaje','finalizado','cerrado_financiero','cancelado') NOT NULL DEFAULT 'planificacion',
  `aforo_esperado` INT NOT NULL DEFAULT 0,
  `concepto_espectaculo` VARCHAR(255) NULL,
  `publico_objetivo` VARCHAR(120) NULL,
  `observaciones` TEXT NULL,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_evento`),
  KEY `fk_evento_cliente` (`cliente_id`),
  KEY `fk_evento_cotizacion_idx` (`cotizacion_id`),
  KEY `idx_evento_fechas` (`fecha_hora_inicio`, `fecha_hora_fin`),
  CONSTRAINT `fk_evento_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `cliente` (`id_cliente`),
  CONSTRAINT `fk_evento_cotizacion` FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizacion` (`id_cotizacion`),
  CONSTRAINT `ck_evento_horario` CHECK (`fecha_hora_fin` > `fecha_hora_inicio`),
  -- Evento de cliente requiere cliente; evento propio no
  CONSTRAINT `ck_evento_modalidad_cliente` CHECK (`modalidad` = 'propio' OR `cliente_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Servicios contratados por evento (con proveedor y costo). Nuevo en v2.
CREATE TABLE IF NOT EXISTS `evento_servicio` (
  `id_evento_servicio` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NOT NULL,
  `servicio_id` INT NOT NULL,
  `proveedor_id` INT NULL,
  `cantidad` INT NOT NULL DEFAULT 1,
  `costo` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `observaciones` VARCHAR(255) NULL,
  PRIMARY KEY (`id_evento_servicio`),
  KEY `fk_evserv_evento` (`evento_id`),
  KEY `fk_evserv_servicio` (`servicio_id`),
  KEY `fk_evserv_proveedor` (`proveedor_id`),
  CONSTRAINT `fk_evserv_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`) ON DELETE CASCADE,
  CONSTRAINT `fk_evserv_servicio` FOREIGN KEY (`servicio_id`) REFERENCES `servicio` (`id_servicio`),
  CONSTRAINT `fk_evserv_proveedor` FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor` (`id_proveedor`),
  CONSTRAINT `ck_evserv_cantidad` CHECK (`cantidad` > 0 AND `costo` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Equipos asignados a un evento. Nuevo en v2.
CREATE TABLE IF NOT EXISTS `evento_equipo` (
  `evento_id` INT NOT NULL,
  `equipo_id` INT NOT NULL,
  PRIMARY KEY (`evento_id`, `equipo_id`),
  KEY `fk_eveq_equipo` (`equipo_id`),
  CONSTRAINT `fk_eveq_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`) ON DELETE CASCADE,
  CONSTRAINT `fk_eveq_equipo` FOREIGN KEY (`equipo_id`) REFERENCES `equipo` (`id_equipo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agendamiento` (
  `id_agendamiento` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NULL,
  `cliente_id` INT NULL,
  `empleado_id` INT NULL,
  `cotizacion_id` INT NULL,
  `titulo` VARCHAR(150) NOT NULL,
  `tipo_agendamiento` ENUM('evento','visita_tecnica','reunion_cliente','otro') NOT NULL DEFAULT 'evento',
  `fecha_hora_inicio` DATETIME NOT NULL,
  `fecha_hora_fin` DATETIME NOT NULL,
  `estado` ENUM('pendiente','confirmado','cancelado','realizado') NOT NULL DEFAULT 'pendiente',
  `ubicacion` VARCHAR(200) NULL,
  `modalidad_cita` VARCHAR(40) NULL,
  `motivo` VARCHAR(255) NULL,
  `notas` TEXT NULL,
  `fecha_tentativa_evento` DATETIME NULL,
  `tipo_tentativa_evento` VARCHAR(50) NULL,
  `ubicacion_tentativa_evento` VARCHAR(150) NULL,
  PRIMARY KEY (`id_agendamiento`),
  KEY `fk_reserva_evento` (`evento_id`),
  KEY `fk_agendamiento_cliente_idx` (`cliente_id`),
  KEY `fk_agendamiento_empleado_idx` (`empleado_id`),
  KEY `fk_agendamiento_cotizacion_idx` (`cotizacion_id`),
  KEY `idx_agendamiento_fecha` (`fecha_hora_inicio`),
  KEY `idx_agendamiento_fecha_tentativa` (`fecha_tentativa_evento`),
  CONSTRAINT `fk_reserva_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`),
  CONSTRAINT `fk_agendamiento_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `cliente` (`id_cliente`),
  CONSTRAINT `fk_agendamiento_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `empleado` (`id_empleado`),
  CONSTRAINT `fk_agendamiento_cotizacion` FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizacion` (`id_cotizacion`),
  CONSTRAINT `ck_agendamiento_horario` CHECK (`fecha_hora_fin` >= `fecha_hora_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `venta` (
  `id_venta` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NOT NULL,
  `cliente_id` INT NULL,
  `cotizacion_id` INT NULL,
  `numero_factura` VARCHAR(30) NOT NULL,
  `fecha_venta` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `total` DECIMAL(12,2) NOT NULL,
  `url_comprobante` VARCHAR(255) NULL,
  `estado` ENUM('confirmada','anulada') NOT NULL DEFAULT 'confirmada',
  PRIMARY KEY (`id_venta`),
  UNIQUE KEY `uq_venta_factura` (`numero_factura`),
  KEY `fk_venta_cliente` (`cliente_id`),
  KEY `fk_venta_evento_idx` (`evento_id`),
  KEY `fk_venta_cotizacion_idx` (`cotizacion_id`),
  CONSTRAINT `fk_venta_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `cliente` (`id_cliente`),
  CONSTRAINT `fk_venta_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`),
  CONSTRAINT `fk_venta_cotizacion` FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizacion` (`id_cotizacion`),
  CONSTRAINT `ck_venta_total` CHECK (`total` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pago_cliente` (
  `id_pago_cliente` INT NOT NULL AUTO_INCREMENT,
  `venta_id` INT NOT NULL,
  `tipo_pago` ENUM('anticipo','saldo') NOT NULL DEFAULT 'anticipo',
  `monto` DECIMAL(12,2) NOT NULL,
  `fecha_pago` DATETIME NOT NULL,
  `medio_pago` ENUM('transferencia','efectivo') NOT NULL,
  `estado` ENUM('pendiente_verificacion','confirmado','rechazado') NOT NULL DEFAULT 'pendiente_verificacion',
  `url_comprobante` VARCHAR(255) NULL,
  `observaciones` TEXT NULL,
  PRIMARY KEY (`id_pago_cliente`),
  KEY `fk_pago_cli_venta_idx` (`venta_id`),
  CONSTRAINT `fk_pago_cli_venta` FOREIGN KEY (`venta_id`) REFERENCES `venta` (`id_venta`),
  CONSTRAINT `ck_pago_cli_monto` CHECK (`monto` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pago_proveedor` (
  `id_pago_proveedor` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NOT NULL,
  `proveedor_id` INT NOT NULL,
  `tipo_pago` ENUM('anticipo','saldo') NOT NULL DEFAULT 'anticipo',
  `monto` DECIMAL(12,2) NOT NULL,
  `fecha_pago` DATE NOT NULL,
  `medio_pago` ENUM('transferencia','efectivo') NOT NULL,
  `url_comprobante` VARCHAR(255) NULL,
  `estado` ENUM('pendiente_verificacion','confirmado','rechazado') NOT NULL DEFAULT 'pendiente_verificacion',
  `observaciones` VARCHAR(255) NULL,
  PRIMARY KEY (`id_pago_proveedor`),
  KEY `fk_pago_prov_evento_idx` (`evento_id`),
  KEY `fk_pago_prov_proveedor_idx` (`proveedor_id`),
  CONSTRAINT `fk_pago_prov_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`),
  CONSTRAINT `fk_pago_prov_proveedor` FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor` (`id_proveedor`),
  CONSTRAINT `ck_pago_prov_monto` CHECK (`monto` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Operación: tareas, préstamos, recepciones, incidentes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tarea` (
  `id_tarea` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(120) NOT NULL,
  `descripcion` TEXT NOT NULL,
  `fase_sugerida` ENUM('planificacion','montaje','ejecucion','desmontaje') NOT NULL DEFAULT 'montaje',
  PRIMARY KEY (`id_tarea`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `evento_tarea` (
  `id_evento_tarea` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NOT NULL,
  `tarea_id` INT NOT NULL,
  `empleado_id` INT NOT NULL,
  `fase` ENUM('planificacion','montaje','ejecucion','desmontaje') NOT NULL,
  `fecha_hora_inicio` DATETIME NOT NULL,
  `fecha_hora_fin` DATETIME NOT NULL,
  `estado` ENUM('pendiente','en_proceso','completada') NOT NULL DEFAULT 'pendiente',
  `prioridad` ENUM('alta','media','baja') NOT NULL DEFAULT 'media',
  `observaciones` TEXT NULL,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_evento_tarea`),
  KEY `fk_evtarea_evento_idx` (`evento_id`),
  KEY `fk_evtarea_tarea_idx` (`tarea_id`),
  KEY `fk_evtarea_empleado_idx` (`empleado_id`),
  CONSTRAINT `fk_evtarea_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`) ON DELETE CASCADE,
  CONSTRAINT `fk_evtarea_tarea` FOREIGN KEY (`tarea_id`) REFERENCES `tarea` (`id_tarea`),
  CONSTRAINT `fk_evtarea_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `empleado` (`id_empleado`),
  CONSTRAINT `ck_evtarea_horario` CHECK (`fecha_hora_fin` >= `fecha_hora_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `prestamo_equipo` (
  `id_prestamo_equipo` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NOT NULL,
  `empleado_id` INT NOT NULL,
  `fecha_salida` DATETIME NOT NULL,
  `fecha_devolucion_estimada` DATETIME NULL,
  `fecha_devolucion` DATETIME NULL,
  `estado` ENUM('activo','devuelto','con_retraso','con_danos') NOT NULL DEFAULT 'activo',
  `observaciones_entrega` TEXT NULL,
  `observaciones_devolucion` TEXT NULL,
  PRIMARY KEY (`id_prestamo_equipo`),
  KEY `fk_prestamo_evento` (`evento_id`),
  KEY `fk_prestamo_empleado` (`empleado_id`),
  CONSTRAINT `fk_prestamo_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `empleado` (`id_empleado`),
  CONSTRAINT `fk_prestamo_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `prestamo_detalle` (
  `id_prestamo_detalle` INT NOT NULL AUTO_INCREMENT,
  `prestamo_id` INT NOT NULL,
  `equipo_id` INT NOT NULL,
  `estado` ENUM('excelente','bueno','regular','mal') NOT NULL DEFAULT 'bueno',
  `estado_retorno` ENUM('excelente','bueno','regular','mal') NULL,
  `observaciones` VARCHAR(255) NULL,
  `url_evidencia` VARCHAR(255) NULL,
  PRIMARY KEY (`id_prestamo_detalle`),
  KEY `fk_pd_prestamo` (`prestamo_id`),
  KEY `fk_pd_equipo` (`equipo_id`),
  CONSTRAINT `fk_pd_prestamo` FOREIGN KEY (`prestamo_id`) REFERENCES `prestamo_equipo` (`id_prestamo_equipo`) ON DELETE CASCADE,
  CONSTRAINT `fk_pd_equipo` FOREIGN KEY (`equipo_id`) REFERENCES `equipo` (`id_equipo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `recepcion` (
  `id_recepcion` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NOT NULL,
  `proveedor_id` INT NOT NULL,
  `empleado_id` INT NOT NULL,
  `recepcion_origen_id` INT NULL,
  `tipo_recepcion` ENUM('recepcion_montaje','recepcion_desmontaje') NOT NULL,
  `estado_recepcion` ENUM('pendiente','conforme','con_novedades','cerrada','anulada') NOT NULL DEFAULT 'pendiente',
  `hora_registro` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `observaciones` VARCHAR(255) NULL,
  `url_firma_empleado` VARCHAR(255) NULL,
  `url_firma_proveedor` VARCHAR(255) NULL,
  PRIMARY KEY (`id_recepcion`),
  KEY `fk_rep_evento_idx` (`evento_id`),
  KEY `fk_rep_proveedor_idx` (`proveedor_id`),
  KEY `fk_rep_empleado_idx` (`empleado_id`),
  KEY `fk_rep_origen_idx` (`recepcion_origen_id`),
  CONSTRAINT `fk_rep_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`),
  CONSTRAINT `fk_rep_proveedor` FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor` (`id_proveedor`),
  CONSTRAINT `fk_rep_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `empleado` (`id_empleado`),
  CONSTRAINT `fk_rep_origen` FOREIGN KEY (`recepcion_origen_id`) REFERENCES `recepcion` (`id_recepcion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `recepcion_detalle` (
  `id_recepcion_detalle` INT NOT NULL AUTO_INCREMENT,
  `recepcion_id` INT NOT NULL,
  `equipo_id` INT NOT NULL,
  `cantidad_esperada` INT NOT NULL DEFAULT 1,
  `cantidad_recibida` INT NOT NULL DEFAULT 1,
  `estado` ENUM('excelente','bueno','regular','mal') NOT NULL DEFAULT 'bueno',
  `url_evidencia` VARCHAR(255) NULL,
  `observaciones` VARCHAR(255) NULL,
  PRIMARY KEY (`id_recepcion_detalle`),
  KEY `fk_rep_detalle_recepcion_idx` (`recepcion_id`),
  KEY `fk_rep_detalle_equipo_idx` (`equipo_id`),
  CONSTRAINT `fk_rep_detalle_recepcion` FOREIGN KEY (`recepcion_id`) REFERENCES `recepcion` (`id_recepcion`) ON DELETE CASCADE,
  CONSTRAINT `fk_rep_detalle_equipo` FOREIGN KEY (`equipo_id`) REFERENCES `equipo` (`id_equipo`),
  CONSTRAINT `ck_rep_detalle_cant` CHECK (`cantidad_esperada` >= 0 AND `cantidad_recibida` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `incidente` (
  `id_incidente` INT NOT NULL AUTO_INCREMENT,
  `evento_id` INT NOT NULL,
  `responsable_id` INT NOT NULL,
  `tipo_incidente` ENUM('falla_electrica','corte_agua','dano_equipo','inconveniente_proveedor','retraso_montaje','seguridad_orden_publico','emergencia_medica','otro') NOT NULL,
  `criticidad` ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
  `titulo` VARCHAR(150) NULL,
  `descripcion` TEXT NOT NULL,
  `area_afectada` VARCHAR(100) NULL,
  `estado` ENUM('reportado','en_atencion','solucionado','escalado') NOT NULL DEFAULT 'reportado',
  `acciones_tomadas` TEXT NULL,
  `costo_adicional` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `fecha_reporte` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_solucion` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id_incidente`),
  KEY `fk_incidente_evento` (`evento_id`),
  KEY `fk_incidente_empleado_idx` (`responsable_id`),
  CONSTRAINT `fk_incidente_evento` FOREIGN KEY (`evento_id`) REFERENCES `evento` (`id_evento`),
  CONSTRAINT `fk_incidente_responsable` FOREIGN KEY (`responsable_id`) REFERENCES `empleado` (`id_empleado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
