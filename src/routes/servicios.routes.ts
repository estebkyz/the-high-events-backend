import { query } from "../config/db.js"
import { requireId } from "../utils/lookup.js"
import { crudRouter, pickChanged, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import { activoToDb, enumMap, estadoActivo, formatCOP, moneyReq, req as reqStr, strOrNull } from "../utils/format.js"

const tipoCobro = enumMap({
  por_evento: "por_evento",
  por_hora: "por_hora",
  por_dia: "por_dia",
  por_persona: "por_persona",
  tarifa_fija: "tarifa_fija",
})

export const serviciosRouter = crudRouter({
  table: "servicio",
  pk: "id_servicio",
  perms: stdPerms("servicios"),
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("s.id_servicio", ids)
    const rows = await query<Obj>(
      `SELECT s.*, c.nombre AS categoria FROM servicio s
         JOIN categoria_servicio c ON c.id_categoria_servicio = s.categoria_id
        ${w.sql} ORDER BY s.id_servicio DESC`,
      w.params,
      conn,
    )
    return rows.map((r) => ({
      id: String(r.id_servicio),
      nombre: r.nombre,
      categoria: r.categoria,
      tipo_cobro: r.tipo_cobro,
      descripcion: r.descripcion ?? "",
      precioBase: formatCOP(r.precio_base),
      precioBaseNum: r.precio_base,
      estado: estadoActivo(r.estado),
    }))
  },
  async toDb(b, { conn, current }) {
    return {
      categoria_id: await requireId("categoriaServicio", null, b.categoria, conn),
      nombre: reqStr(b.nombre, "El nombre del servicio"),
      descripcion: strOrNull(b.descripcion),
      tipo_cobro: tipoCobro.toDb(b.tipo_cobro ?? "por_evento", "Tipo de cobro"),
      // El formulario edita el texto precioBase y deja precioBaseNum con el valor viejo
      precio_base: moneyReq(pickChanged(b, current, ["precioBaseNum", "precioBase"]), "El precio base"),
      estado: activoToDb(b.estado ?? "Activo"),
    }
  },
})
