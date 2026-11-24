import { query } from "../config/db.js"
import { clienteNombreSql, requireId } from "../utils/lookup.js"
import { crudRouter, pickChanged, whereIds, type Obj } from "../utils/resource.js"
import { dateToDb, dateToFront, enumMap, formatCOP, intOrNull, moneyReq, pad, req as reqStr, sid } from "../utils/format.js"
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
      `SELECT v.*, e.nombre_evento, e.modalidad, ${clienteNombreSql("c")} AS cliente,
              (SELECT COALESCE(SUM(p.monto), 0) FROM pago_cliente p
                WHERE p.venta_id = v.id_venta AND p.estado = 'confirmado') AS pagado
         FROM venta v
         JOIN evento e ON e.id_evento = v.evento_id
         LEFT JOIN cliente c ON c.id_cliente = v.cliente_id
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
      total: formatCOP(r.total),
      totalNum: r.total,
      estadoPago: estadoPago(r.total, r.pagado),
      estado_venta: estadoVenta.toFront(r.estado),
      cotizacion_id: r.cotizacion_id ? String(r.cotizacion_id) : undefined,
      evento_id: sid(r.evento_id), // requerido por el contrato; VentaItem aún no lo declara
    }))
  },
  async toDb(b, { conn, id, current }) {
    // `clienteEvento` solo se usa como nombre de evento si no viene evento_id; al editar es texto derivado.
    const evento_id = await requireId("evento", b.evento_id, intOrNull(b.evento_id) ? null : b.clienteEvento, conn)
    const [ev] = await query<{ cliente_id: number | null; cotizacion_id: number | null }>(
      "SELECT cliente_id, cotizacion_id FROM evento WHERE id_evento = ?",
      [evento_id],
      conn,
    )
    const total = moneyReq(pickChanged(b, current, ["totalNum", "total"]), "El total")
    if (id !== null) {
      const [{ pagado }] = await query<{ pagado: number }>(
        "SELECT COALESCE(SUM(monto), 0) AS pagado FROM pago_cliente WHERE venta_id = ? AND estado <> 'rechazado'",
        [id],
        conn,
      )
      if (total < pagado) throw conflict("El total no puede ser menor que los pagos registrados")
    }
    const fecha = dateToDb(b.fecha, "La fecha de la venta", true)
    const hoy = new Date().toLocaleDateString("sv-SE")
    return {
      evento_id,
      cliente_id: ev.cliente_id,
      cotizacion_id: intOrNull(b.cotizacion_id) ?? ev.cotizacion_id,
      numero_factura: reqStr(b.numero_factura, "El número de factura"),
      // Hoy: se deja la hora real que pone la BD
      fecha_venta: id === null && fecha === hoy ? undefined : `${fecha} 00:00:00`,
      total,
      estado: estadoVenta.toDb(b.estado_venta ?? "Confirmada", "Estado de la venta"),
    }
  },
})
