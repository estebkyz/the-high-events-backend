import { query } from "../config/db.js"
import { clienteNombreSql, requireId } from "../utils/lookup.js"
import { crudRouter, whereIds, type Obj } from "../utils/resource.js"
import { dateToDb, dateToFront, enumMap, formatCOP, intOrNull, pad, req as reqStr, sid } from "../utils/format.js"
import { conflict } from "../utils/http.js"

const estadoVenta = enumMap({ Confirmada: "confirmada", Anulada: "anulada" })

const estadoPago = (total: number, pagado: number) =>
  pagado <= 0 ? "Pendiente" : pagado >= total ? "Pagado" : "Parcial"

export const ventasRouter = crudRouter({
  table: "venta",
  pk: "id_venta",
  perms: {
    ver: ["ventas.ver"],
    crear: ["ventas.crear"],
    editar: ["ventas.editar"],
    estado: ["ventas.anular"],
    eliminar: ["ventas.eliminar"],
  },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("v.id_venta", ids)
    const rows = await query<Obj>(
      `SELECT v.*, e.nombre_evento, e.modalidad, e.valor_total AS total, e.cotizacion_id, ${clienteNombreSql("c")} AS cliente,
              (SELECT COALESCE(SUM(p.monto), 0) FROM pago_cliente p
                WHERE p.venta_id = v.id_venta AND p.estado = 'confirmado') AS pagado
         FROM venta v
         JOIN (SELECT ev.*, (SELECT q.id_cotizacion FROM cotizacion q WHERE q.evento_id = ev.id_evento AND q.estado = 'aceptada') AS cotizacion_id
                 FROM evento ev) e ON e.id_evento = v.evento_id
         LEFT JOIN cliente c ON c.id_cliente = e.cliente_id
        ${w.sql} ORDER BY v.id_venta DESC`,
      w.params,
      conn,
    )
    return rows.map((r) => ({
      id: String(r.id_venta),
      codigo: `VEN-${pad(r.id_venta)}`,
      tipo: r.modalidad === "propio" ? "Propio" : "Cliente",
      clienteEvento: r.cliente ? `${r.cliente} — ${r.nombre_evento}` : r.nombre_evento,
      numero_factura: r.numero_factura,
      fecha: dateToFront(r.fecha_venta),
      total: formatCOP(r.total ?? 0),
      totalNum: r.total ?? 0,
      estadoPago: estadoPago(r.total ?? 0, r.pagado),
      estado_venta: estadoVenta.toFront(r.estado),
      cotizacion_id: r.cotizacion_id ? String(r.cotizacion_id) : undefined,
      evento_id: sid(r.evento_id), // requerido por el contrato; VentaItem aún no lo declara
    }))
  },
  async toDb(b, { conn, id }) {
    const evento_id = await requireId("evento", b.evento_id, intOrNull(b.evento_id) ? null : b.clienteEvento, conn)
    const [ev] = await query<{ valor: number | null; estado: string }>(
      "SELECT valor_total AS valor, estado FROM evento WHERE id_evento = ?",
      [evento_id],
      conn,
    )
    if (ev.estado === "cotizacion" || ev.estado === "cancelado") throw conflict("Solo se vende un evento aceptado o en curso")
    if (!(Number(ev.valor) > 0)) throw conflict("Defina primero el valor del evento (en Eventos o aceptando su cotización)")
    const est = estadoVenta.toDb(b.estado_venta ?? "Confirmada", "Estado de la venta")
    if (est === "confirmada") {
      const [otra] = await query<{ numero_factura: string }>(
        "SELECT numero_factura FROM venta WHERE evento_id = ? AND estado = 'confirmada' AND id_venta <> ?",
        [evento_id, id ?? 0],
        conn,
      )
      if (otra) throw conflict(`El evento ya tiene la venta ${otra.numero_factura}`)
    }
    const fecha = dateToDb(b.fecha, "La fecha de la venta", true)
    const hoy = new Date().toLocaleDateString("sv-SE")
    return {
      evento_id,
      numero_factura: reqStr(b.numero_factura, "El número de factura"),
      // Hoy: se deja la hora real que pone la BD
      fecha_venta: id === null && fecha === hoy ? undefined : `${fecha} 00:00:00`,
      estado: est,
    }
  },
})
