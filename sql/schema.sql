-- =============================================================================
-- THE HIGH EVENTS — Script DDL Base para MySQL (Generado desde el Diagrama ER)
-- =============================================================================
CREATE DATABASE IF NOT EXISTS `the_high_events`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `the_high_events`;

-- 1. Seguridad y Acceso
CREATE TABLE IF NOT EXISTS `rol` (
  `id_rol` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(60) NOT NULL,
  `descripcion` VARCHAR(255) NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `permiso` (
  `id_modulo` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS `privilegio` (
  `id_privilegio` INT AUTO_INCREMENT PRIMARY KEY,
  `id_modulo` INT NOT NULL,
  `nombre` VARCHAR(45) NOT NULL,
  `codigo` VARCHAR(45) NOT NULL,
  FOREIGN KEY (`id_modulo`) REFERENCES `permiso`(`id_modulo`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `rol_privilegio` (
  `rol_id` INT NOT NULL,
  `privilegio_id` INT NOT NULL,
  PRIMARY KEY (`rol_id`, `privilegio_id`),
  FOREIGN KEY (`rol_id`) REFERENCES `rol`(`id_rol`) ON DELETE CASCADE,
  FOREIGN KEY (`privilegio_id`) REFERENCES `privilegio`(`id_privilegio`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `usuario` (
  `id_usuario` INT AUTO_INCREMENT PRIMARY KEY,
  `rol_id` INT NOT NULL,
  `tipo_documento` ENUM('CC', 'CE', 'NIT', 'PASAPORTE') NOT NULL DEFAULT 'CC',
  `numero_documento` VARCHAR(25) NOT NULL,
  `nombre` VARCHAR(50) NOT NULL,
  `apellido` VARCHAR(50) NOT NULL,
  `correo` VARCHAR(150) NOT NULL UNIQUE,
  `telefono` VARCHAR(20) NULL,
  `contrasena_hash` VARCHAR(255) NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `sesion_acceso` TIMESTAMP NULL,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`rol_id`) REFERENCES `rol`(`id_rol`)
);

CREATE TABLE IF NOT EXISTS `registro_acceso` (
  `id_sesion` INT AUTO_INCREMENT PRIMARY KEY,
  `usuario_id` INT NOT NULL,
  `ip_address` VARCHAR(45) NULL,
  `tipo_acceso` ENUM('login', 'logout', 'fallido') NOT NULL DEFAULT 'login',
  `fecha_hora` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id_usuario`) ON DELETE CASCADE
);

-- 2. Terceros y Personal
CREATE TABLE IF NOT EXISTS `empleado` (
  `id_empleado` INT AUTO_INCREMENT PRIMARY KEY,
  `tipo_documento` ENUM('CC', 'CE', 'NIT', 'PASAPORTE') NOT NULL DEFAULT 'CC',
  `numero_documento` VARCHAR(25) NOT NULL,
  `nombre` VARCHAR(50) NOT NULL,
  `apellido` VARCHAR(50) NOT NULL,
  `cargo` VARCHAR(45) NOT NULL,
  `telefono` VARCHAR(20) NULL,
  `correo` VARCHAR(150) NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `cliente` (
  `id_cliente` INT AUTO_INCREMENT PRIMARY KEY,
  `tipo_cliente` ENUM('Empresa', 'Natural') NOT NULL DEFAULT 'Empresa',
  `razon_social` VARCHAR(150) NULL,
  `nombre` VARCHAR(50) NULL,
  `apellido` VARCHAR(50) NULL,
  `contacto_nombre` VARCHAR(100) NULL,
  `tipo_documento` ENUM('CC', 'CE', 'NIT', 'PASAPORTE') NOT NULL DEFAULT 'NIT',
  `numero_documento` VARCHAR(25) NOT NULL,
  `correo` VARCHAR(150) NULL,
  `telefono` VARCHAR(20) NULL,
  `direccion` VARCHAR(200) NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `proveedor` (
  `id_proveedor` INT AUTO_INCREMENT PRIMARY KEY,
  `tipo_documento` ENUM('CC', 'CE', 'NIT', 'PASAPORTE') NOT NULL DEFAULT 'NIT',
  `numero_documento` VARCHAR(50) NOT NULL,
  `razon_social` VARCHAR(150) NOT NULL,
  `contacto_nombre` VARCHAR(50) NULL,
  `contacto_apellido` VARCHAR(50) NULL,
  `telefono` VARCHAR(20) NULL,
  `correo` VARCHAR(150) NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Catálogos de Servicios y Equipos
CREATE TABLE IF NOT EXISTS `categoria_servicio` (
  `id_categoria_servicio` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(100) NOT NULL,
  `estado` TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `servicio` (
  `id_servicio` INT AUTO_INCREMENT PRIMARY KEY,
  `categoria_id` INT NOT NULL,
  `nombre` VARCHAR(120) NOT NULL,
  `descripcion` TEXT NULL,
  `precio_base` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `estado` TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (`categoria_id`) REFERENCES `categoria_servicio`(`id_categoria_servicio`)
);

CREATE TABLE IF NOT EXISTS `proveedor_servicio` (
  `proveedor_id` INT NOT NULL,
  `servicio_id` INT NOT NULL,
  `valor` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`proveedor_id`, `servicio_id`),
  FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`id_proveedor`) ON DELETE CASCADE,
  FOREIGN KEY (`servicio_id`) REFERENCES `servicio`(`id_servicio`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `categoria_equipo` (
  `id_categoria_equipo` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(45) NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `equipo` (
  `id_equipo` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(120) NOT NULL,
  `numero_serie` VARCHAR(80) NULL,
  `tipo_propiedad` ENUM('propio', 'alquilado') NOT NULL DEFAULT 'propio',
  `cantidad_total` INT NOT NULL DEFAULT 1,
  `estado` ENUM('disponible', 'en_evento', 'prestado', 'en_mantenimiento', 'de_baja') NOT NULL DEFAULT 'disponible',
  `observaciones` TEXT NULL,
  `categoria_id` INT NOT NULL,
  `proveedor_id` INT NULL,
  FOREIGN KEY (`categoria_id`) REFERENCES `categoria_equipo`(`id_categoria_equipo`),
  FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`id_proveedor`)
);

-- 4. Flujo Comercial (Cotizaciones, Eventos, Ventas, Pagos)
CREATE TABLE IF NOT EXISTS `cotizacion` (
  `id_cotizacion` INT AUTO_INCREMENT PRIMARY KEY,
  `cliente_id` INT NOT NULL,
  `empleado_id` INT NULL,
  `nombre_evento` VARCHAR(150) NOT NULL,
  `ubicacion_evento` VARCHAR(150) NULL,
  `fecha_hora_inicio` DATETIME NULL,
  `fecha_hora_fin` DATETIME NULL,
  `presupuesto_estimado` DECIMAL(12,2) NULL DEFAULT 0.00,
  `estado` ENUM('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida') NOT NULL DEFAULT 'borrador',
  `aforo_esperado` INT NULL,
  `concepto_espectaculo` VARCHAR(255) NULL,
  `total_cotizado` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `observaciones` TEXT NULL,
  `url_documento` VARCHAR(255) NULL,
  `fecha_emision` DATE NULL,
  `fecha_vencimiento` DATE NULL,
  FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id_cliente`),
  FOREIGN KEY (`empleado_id`) REFERENCES `empleado`(`id_empleado`)
);

CREATE TABLE IF NOT EXISTS `cotizacion_detalle` (
  `id_cotizacion_detalle` INT AUTO_INCREMENT PRIMARY KEY,
  `cotizacion_id` INT NOT NULL,
  `servicio_id` INT NOT NULL,
  `precio_unitario` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `observaciones` VARCHAR(255) NULL,
  FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizacion`(`id_cotizacion`) ON DELETE CASCADE,
  FOREIGN KEY (`servicio_id`) REFERENCES `servicio`(`id_servicio`)
);

CREATE TABLE IF NOT EXISTS `evento` (
  `id_evento` INT AUTO_INCREMENT PRIMARY KEY,
  `cliente_id` INT NULL,
  `cotizacion_id` INT NULL,
  `modalidad` ENUM('cliente', 'propio') NOT NULL DEFAULT 'cliente',
  `nombre_evento` VARCHAR(150) NOT NULL,
  `ubicacion_evento` VARCHAR(200) NULL,
  `fecha_hora_inicio` DATETIME NULL,
  `fecha_hora_fin` DATETIME NULL,
  `presupuesto_estimado` DECIMAL(12,2) NULL DEFAULT 0.00,
  `estado` ENUM('Planificación', 'Confirmado', 'Montaje', 'En ejecución', 'Desmontaje', 'Finalizado', 'Cerrado financiero', 'Cancelado') NOT NULL DEFAULT 'Planificación',
  `fecha_creacion` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `aforo_esperado` INT NULL,
  `concepto_espectaculo` VARCHAR(255) NULL,
  `observaciones` TEXT NULL,
  FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id_cliente`),
  FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizacion`(`id_cotizacion`)
);

CREATE TABLE IF NOT EXISTS `venta` (
  `id_venta` INT AUTO_INCREMENT PRIMARY KEY,
  `evento_id` INT NOT NULL,
  `cliente_id` INT NOT NULL,
  `numero_factura` VARCHAR(30) NOT NULL,
  `fecha_venta` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `total` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `url_comprobante` VARCHAR(255) NULL,
  `estado` ENUM('pendiente', 'parcial', 'pagado', 'anulada') NOT NULL DEFAULT 'pendiente',
  FOREIGN KEY (`evento_id`) REFERENCES `evento`(`id_evento`),
  FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id_cliente`)
);

CREATE TABLE IF NOT EXISTS `pago_cliente` (
  `id_pago_cliente` INT AUTO_INCREMENT PRIMARY KEY,
  `venta_id` INT NOT NULL,
  `tipo_pago` ENUM('anticipo', 'saldo') NOT NULL DEFAULT 'anticipo',
  `monto` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `fecha_pago` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `medio_pago` ENUM('transferencia', 'efectivo', 'tarjeta', 'consignacion') NOT NULL DEFAULT 'transferencia',
  `estado` ENUM('pagado', 'pendiente') NOT NULL DEFAULT 'pagado',
  `url_comprobante` VARCHAR(255) NULL,
  `observaciones` TEXT NULL,
  FOREIGN KEY (`venta_id`) REFERENCES `venta`(`id_venta`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `pago_proveedor` (
  `id_pago_proveedor` INT AUTO_INCREMENT PRIMARY KEY,
  `evento_id` INT NOT NULL,
  `proveedor_id` INT NOT NULL,
  `tipo_pago` ENUM('anticipo', 'saldo') NOT NULL DEFAULT 'anticipo',
  `monto` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `fecha_pago` DATE NOT NULL,
  `medio_pago` ENUM('transferencia', 'efectivo', 'tarjeta', 'consignacion') NOT NULL DEFAULT 'transferencia',
  `url_comprobante` VARCHAR(255) NULL,
  `estado` ENUM('pagado', 'pendiente') NOT NULL DEFAULT 'pagado',
  `observaciones` VARCHAR(255) NULL,
  FOREIGN KEY (`evento_id`) REFERENCES `evento`(`id_evento`) ON DELETE CASCADE,
  FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`id_proveedor`)
);

-- 5. Operación, Tareas, Agendamiento, Bodega e Incidentes
CREATE TABLE IF NOT EXISTS `tarea` (
  `id_tarea` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(120) NOT NULL,
  `descripcion` TEXT NULL
);

CREATE TABLE IF NOT EXISTS `evento_tarea` (
  `id_evento_tarea` INT AUTO_INCREMENT PRIMARY KEY,
  `evento_id` INT NOT NULL,
  `tarea_id` INT NOT NULL,
  `empleado_id` INT NOT NULL,
  `fase` ENUM('planificacion', 'montaje', 'ejecucion', 'desmontaje') NOT NULL DEFAULT 'montaje',
  `fecha_hora_inicio` DATETIME NULL,
  `fecha_hora_fin` DATETIME NULL,
  `estado` ENUM('pendiente', 'en_proceso', 'completada') NOT NULL DEFAULT 'pendiente',
  `prioridad` VARCHAR(45) NULL DEFAULT 'Media',
  `observaciones` VARCHAR(45) NULL,
  FOREIGN KEY (`evento_id`) REFERENCES `evento`(`id_evento`) ON DELETE CASCADE,
  FOREIGN KEY (`tarea_id`) REFERENCES `tarea`(`id_tarea`),
  FOREIGN KEY (`empleado_id`) REFERENCES `empleado`(`id_empleado`)
);

CREATE TABLE IF NOT EXISTS `agendamiento` (
  `id_agendamiento` INT AUTO_INCREMENT PRIMARY KEY,
  `evento_id` INT NULL,
  `cliente_id` INT NULL,
  `empleado_id` INT NULL,
  `titulo` VARCHAR(150) NOT NULL,
  `tipo_agendamiento` ENUM('evento', 'visita_tecnica', 'reunion_cliente', 'otro') NOT NULL DEFAULT 'evento',
  `fecha_hora_inicio` DATETIME NOT NULL,
  `fecha_hora_fin` DATETIME NULL,
  `estado` ENUM('pendiente', 'confirmado', 'cancelado', 'realizado') NOT NULL DEFAULT 'pendiente',
  `ubicacion` VARCHAR(200) NULL,
  `fecha_tentativa_evento` DATETIME NULL,
  `tipo_tentativa_evento` VARCHAR(100) NULL,
  `ubicacion_tentativa_evento` VARCHAR(200) NULL,
  FOREIGN KEY (`evento_id`) REFERENCES `evento`(`id_evento`) ON DELETE SET NULL,
  FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id_cliente`) ON DELETE SET NULL,
  FOREIGN KEY (`empleado_id`) REFERENCES `empleado`(`id_empleado`) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS `incidente` (
  `id_incidente` INT AUTO_INCREMENT PRIMARY KEY,
  `evento_id` INT NOT NULL,
  `responsable_id` INT NOT NULL,
  `tipo_incidente` ENUM('falla_electrica', 'corte_agua', 'dano_equipo', 'inconveniente_proveedor', 'retraso_montaje', 'seguridad_orden_publico', 'emergencia_medica', 'otro') NOT NULL DEFAULT 'otro',
  `descripcion` TEXT NOT NULL,
  `estado` ENUM('reportado', 'en_atencion', 'solucionado', 'escalado') NOT NULL DEFAULT 'reportado',
  `acciones_tomadas` TEXT NULL,
  `fecha_solucion` TIMESTAMP NULL,
  FOREIGN KEY (`evento_id`) REFERENCES `evento`(`id_evento`) ON DELETE CASCADE,
  FOREIGN KEY (`responsable_id`) REFERENCES `empleado`(`id_empleado`)
);

CREATE TABLE IF NOT EXISTS `prestamo_equipo` (
  `id_prestamo_equipo` INT AUTO_INCREMENT PRIMARY KEY,
  `evento_id` INT NOT NULL,
  `empleado_id` INT NOT NULL,
  `fecha_salida` DATETIME NOT NULL,
  `fecha_devolucion` DATETIME NULL,
  `estado` ENUM('activo', 'devuelto', 'con_retraso', 'con_danos') NOT NULL DEFAULT 'activo',
  FOREIGN KEY (`evento_id`) REFERENCES `evento`(`id_evento`) ON DELETE CASCADE,
  FOREIGN KEY (`empleado_id`) REFERENCES `empleado`(`id_empleado`)
);

CREATE TABLE IF NOT EXISTS `prestamo_detalle` (
  `id_prestamo_detalle` INT AUTO_INCREMENT PRIMARY KEY,
  `prestamo_id` INT NOT NULL,
  `equipo_id` INT NOT NULL,
  `estado` ENUM('excelente', 'bueno', 'regular', 'dañado') NOT NULL DEFAULT 'bueno',
  `observaciones` VARCHAR(255) NULL,
  `url_evidencia` VARCHAR(255) NULL,
  FOREIGN KEY (`prestamo_id`) REFERENCES `prestamo_equipo`(`id_prestamo_equipo`) ON DELETE CASCADE,
  FOREIGN KEY (`equipo_id`) REFERENCES `equipo`(`id_equipo`)
);

CREATE TABLE IF NOT EXISTS `recepcion` (
  `id_recepcion` INT AUTO_INCREMENT PRIMARY KEY,
  `evento_id` INT NOT NULL,
  `proveedor_id` INT NOT NULL,
  `empleado_id` INT NOT NULL,
  `tipo_recepcion` ENUM('recepcion_montaje', 'recepcion_desmontaje') NOT NULL DEFAULT 'recepcion_montaje',
  `estado_recepcion` ENUM('pendiente', 'conforme', 'cerrada', 'anulada') NOT NULL DEFAULT 'pendiente',
  `hora_registro` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `observaciones` VARCHAR(255) NULL,
  `url_firma_empleado` VARCHAR(255) NULL,
  `url_firma_proveedor` VARCHAR(255) NULL,
  FOREIGN KEY (`evento_id`) REFERENCES `evento`(`id_evento`) ON DELETE CASCADE,
  FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`id_proveedor`),
  FOREIGN KEY (`empleado_id`) REFERENCES `empleado`(`id_empleado`)
);

CREATE TABLE IF NOT EXISTS `recepcion_detalle` (
  `id_recepcion_detalle` INT AUTO_INCREMENT PRIMARY KEY,
  `recepcion_id` INT NOT NULL,
  `equipo_id` INT NOT NULL,
  `cantidad_esperada` INT NOT NULL DEFAULT 1,
  `cantidad_recibida` INT NOT NULL DEFAULT 1,
  `estado` ENUM('excelente', 'bueno', 'regular', 'dañado') NOT NULL DEFAULT 'bueno',
  `url_evidencia` VARCHAR(255) NULL,
  `observaciones` VARCHAR(255) NULL,
  FOREIGN KEY (`recepcion_id`) REFERENCES `recepcion`(`id_recepcion`) ON DELETE CASCADE,
  FOREIGN KEY (`equipo_id`) REFERENCES `equipo`(`id_equipo`)
);
