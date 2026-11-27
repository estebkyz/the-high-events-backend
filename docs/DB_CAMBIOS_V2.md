# Cambios del esquema v2 frente al script original (.mwb)

Fuente de verdad: el `.mwb`. Estos cambios deben aplicarse también en Workbench (Database > Synchronize Model).
Probado en MariaDB 10.11; compatible con MySQL 8 (sin sintaxis VISIBLE/INVISIBLE).

## Correcciones (el original impedía el proceso de negocio)
| Tabla | Problema original | Corrección v2 |
|---|---|---|
| cotizacion_detalle | UNIQUE en `cotizacion_id` y en `servicio_id`: 1 servicio por cotización y cada servicio cotizable una sola vez; sin cantidad | Se quitan; UNIQUE (cotizacion_id, servicio_id); se añade `cantidad` |
| incidente | `fecha_solucion` NOT NULL: no se podía registrar un incidente abierto | Nullable; se añaden `titulo`, `area_afectada`, `acciones_tomadas` |
| cliente | exigía nombre, apellido y razón social a la vez | Todos opcionales + CHECK por `tipo_cliente`; se añaden `ciudad`, `contacto_nombre` |
| pago_cliente / pago_proveedor / recepcion_detalle / venta | comprobantes y evidencias NOT NULL | Nullable (la evidencia se adjunta después) |
| privilegio | sin AUTO_INCREMENT ni código | AUTO_INCREMENT + `codigo` UNIQUE (ej. `clientes.crear`) |
| usuario | sin control de intentos ni recuperación | `intentos_fallidos`, `bloqueado_hasta`, `reset_token_hash`, `reset_token_expira` |
| registro_acceso.tipo_acceso | el código escribía valores fuera del ENUM | ENUM: login_exitoso, login_fallido, logout, recuperacion_password |

## Tablas nuevas
- `evento_servicio` (servicios contratados por evento, con proveedor, cantidad y costo)
- `evento_equipo` (equipos asignados al evento)

## Columnas añadidas por necesidad del frontend
equipo(codigo, costo_adquisicion, costo_alquiler_dia, mantenimiento_proximo), empleado(vinculacion, emergencia_*, correo, apellido nullable),
evento(modalidad, tipo_evento, publico_objetivo, estado ampliado), agendamiento(tipo, motivo, notas, *_tentativa*), recepcion(estado con_novedades, firmas),
prestamo_equipo(fecha_devolucion_estimada, observaciones_*), prestamo_detalle(estado_retorno), evento_tarea(prioridad, observaciones).

## Reglas de negocio ahora en la BD (CHECK)
Evento: fin > inicio; evento de cliente exige cliente. Equipo alquilado exige proveedor. Montos > 0 en pagos. Cantidades > 0.
