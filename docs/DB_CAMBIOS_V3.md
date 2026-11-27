# Base de datos v3: el evento como centro

Versión oficial (igual al `.mwb` del 26-nov-2026): `sql/01_schema.sql` + `sql/02_seed.sql`.
Base v2 existente: respaldo y luego `sql/04_migracion_v2_a_v3.sql`, una sola vez.
La API y el frontend ya trabajan con v3.

## Decisiones (26-nov-2026)
| # | Antes (v2) | Ahora (v3) | Por qué |
|---|---|---|---|
| D1 | La cotización repetía cliente, nombre, lugar, fechas, aforo, concepto y presupuesto del evento | La cotización solo guarda el documento: `evento_id`, asesor, `version`, estado, fechas de emisión y vencimiento, PDF y detalle | Un dato, un lugar: cambiar la fecha del evento ya no deja la cotización diciendo otra cosa |
| D2 | `evento.cotizacion_id` y `cotizacion.total_cotizado` | `cotizacion.evento_id`; el total de una cotización es la suma de `cotizacion_detalle` | Un evento puede tener varias versiones de cotización; el total guardado podía no cuadrar con su detalle |
| D3 | El precio estaba en `cotizacion.total_cotizado` y en `venta.total` | `evento.valor_total`: valor real del evento (lo acordado con el cliente, o lo que se espera vender si es propio) | Única fuente del precio para ventas, abonos y Dashboard. `presupuesto_estimado` sigue siendo lo que se espera gastar |
| D4 | El evento existía solo después de aceptar la cotización | Nuevo estado `cotizacion`: el evento nace con la solicitud; fecha y lugar son obligatorios desde `planificacion` (`ck_evento_programado`) | Todo el ciclo cuelga del evento; una cotización rechazada deja el evento `cancelado` como historial |
| D5 | `venta` repetía `cliente_id`, `cotizacion_id` y `total` | `venta`: evento, factura, fecha, comprobante y estado. Una sola venta confirmada por evento (`uq_venta_vigente`) | Cliente y valor se leen del evento; las anuladas quedan como historial |
| D6 | Varias cotizaciones aceptadas por evento eran posibles | Una sola aceptada por evento (`uq_cot_una_aceptada`) | Evita dos precios acordados para un mismo evento |
| D7 | `agendamiento` tenía `cotizacion_id` y el tipo `evento` | Sin `cotizacion_id`; tipos `reunion_cliente`, `visita_tecnica`, `otro`; `fecha_tentativa_evento` es DATE; si hay evento, el cliente se lee de él (`ck_agendamiento_relacion`) | Los eventos ya están en su tabla; la reunión es antes (cliente) o sobre un evento, nunca repite ambos |
| D8 | — | `recepcion.proveedor_id` se mantiene: un acta es la entrega de un solo proveedor (o de los equipos propios), firmada por él | Un evento con equipos de varios proveedores tiene un acta por proveedor; el proveedor de cada equipo ya está en `equipo` |
| D9 | Campos sin uso en el negocio | Retirados en el `.mwb`: `cliente.ciudad`, contacto de emergencia del empleado, `equipo.cantidad_total` y `mantenimiento_proximo`, `evento.publico_objetivo`, `agendamiento.ubicacion` y `modalidad_cita`, `incidente.area_afectada` y `costo_adicional`, recuperación de contraseña en `usuario` | Cada equipo es una unidad con serie; la clave la restablece el administrador |
| D10 | Nombres | `concepto_espectaculo` → `concepto_evento`; `costo_alquiler_dia` → `costo_alquiler`; `fecha_reporte`/`fecha_solucion` → `fecha_hora_reporte`/`fecha_hora_solucion` | Coherencia con el resto del modelo |
| D11 | `recepcion.recepcion_origen_id` | Retirado: una sola acta vigente por evento, origen (proveedor o propios) y tipo (`uq_rep_una_entrega`); la devolución es la de desmontaje del mismo evento y proveedor | Cada proveedor hace una sola entrega por evento |
| D12 | Un evento de cliente podía crearse en Eventos sin cotización | El evento de cliente nace de su cotización y solo pasa de `cotizacion` a `planificacion` con ella aceptada. La cotización lleva los servicios; al aceptarla pasan a `evento_servicio` | La cotización dice qué se vende; el evento, cómo se ejecuta (personal, tareas y equipos) |

`evento_aceptado`, `evento_vigente` y `entrega_vigente` son columnas calculadas (no se escriben): solo existen para las tres reglas de "una sola".

## Qué hace la migración
1. Cada cotización sin evento crea su evento en estado `cotizacion` (o `cancelado` si fue rechazada o venció).
2. `evento.valor_total` = suma de sus ventas confirmadas; si no tiene venta, el total de su cotización aceptada.
3. Un evento de cliente ya planificado sin cotización aceptada: si tiene una oferta abierta, la más reciente
   queda aceptada; si no, recibe una "Registrada al migrar" con los servicios del evento. La cotización
   aceptada y su evento quedan con la misma lista de servicios.
   Si un evento tenía varias cotizaciones aceptadas, queda la más reciente y las demás pasan a `rechazada`.
   Si tenía varias ventas confirmadas, se anulan las repetidas que no tienen pagos.
4. Agendamientos de tipo `evento` pasan a `otro`; los que tenían evento dejan de repetir el cliente.
5. Solo al final se borran las columnas repetidas: si un paso falla antes, no se ha perdido nada.

Probado en MariaDB 10.4 sobre copias de datos ficticios y de la base local: la estructura migrada
es idéntica a la de `sql/01_schema.sql` (columnas, índices, llaves y CHECK) y no quedan cotizaciones sin
evento, ventas sin valor ni pagos mayores al valor del evento. No probado en MySQL 8.

## Cómo lo usan la API y las pantallas
- Crear una cotización crea su evento (estado Cotización); editarla cambia el evento solo mientras sigue en cotización.
- Aceptarla fija `evento.valor_total`, copia sus servicios al evento y lo pasa a Planificación si ya tiene fecha y lugar; "Planificar evento" abre ese evento.
- Crear un evento para cliente en Eventos es elegir el cliente, luego una de sus cotizaciones aceptadas pendientes, y completar ese mismo evento: personal, tareas y equipos. Sus servicios no se agregan ni se quitan ahí (solo el proveedor) y su valor es de solo lectura: lo fija la cotización aceptada (para cambiarlo, la cotización vuelve a borrador, se ajustan sus precios y se acepta de nuevo). Un evento propio sí elige sus servicios y su valor.
- Desde una reunión de Agendamiento se crea la cotización, no el evento.
- Rechazar la única oferta cancela el evento; eliminarla lo borra si no salió de cotización.
- La venta no tiene monto: muestra el valor del evento. El valor no puede quedar por debajo de lo abonado.
- Agendamiento: tipo (reunión, visita técnica, otro), quién atiende y hora de fin.
