import { exec, query } from "../config/db.js"
import { resolveId, requireId } from "../utils/lookup.js"
import { crudRouter, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import { consultarDisponibilidad } from "../utils/disponibilidad.js"
import { dtToDb, enumMap, intOrNull, moneyOrNull, pad, req as reqStr, strOrNull } from "../utils/format.js"
import { bad, wrap } from "../utils/http.js"

const estadoOperativo = enumMap({
  Disponible: "disponible",
  "En Evento": "en_evento",
  Prestado: "prestado",
  "En Mantenimiento": "en_mantenimiento",
  "De Baja": "de_baja",
})
const propiedad = enumMap({ Propio: "propio", Alquilado: "alquilado" })

/** `?inicio=YYYY-MM-DDTHH:mm&fin=…&evento=id` (el evento que se edita no choca consigo mismo). */
export const disponibilidadHandler = wrap(async (req, res) => {
  const inicio = dtToDb(req.query.inicio, "La fecha de inicio")
  const fin = dtToDb(req.query.fin, "La fecha de fin")
  if (Boolean(inicio) !== Boolean(fin)) throw bad("Indique inicio y fin")
  if (inicio && fin && fin <= inicio) throw bad("El fin debe ser posterior al inicio")
  const rango = inicio && fin ? { inicio, fin } : null
  res.json(await consultarDisponibilidad(rango, intOrNull(req.query.evento)))
})

export const equiposRouter = crudRouter({
  table: "equipo",
  pk: "id_equipo",
  perms: stdPerms("equipos"),
  catalogo: {
    modulos: ["agendamiento", "eventos", "prestamos", "proveedores", "recepciones", "dashboard"],
    campos: ["codigo", "nombre", "categoria", "serie", "estadoOperativo", "propiedad", "proveedor_id", "proveedor_nombre"],
  },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("e.id_equipo", ids)
    const rows = await query<Obj>(
      `SELECT e.*, c.nombre AS categoria, p.razon_social AS proveedor
         FROM equipo e
         JOIN categoria_equipo c ON c.id_categoria_equipo = e.categoria_id
         LEFT JOIN proveedor p ON p.id_proveedor = e.proveedor_id
        ${w.sql} ORDER BY e.id_equipo DESC`,
      w.params,
      conn,
    )
    return rows.map((r) => ({
      id: String(r.id_equipo),
      codigo: r.codigo ?? "",
      nombre: r.nombre,
      categoria: r.categoria,
      serie: r.numero_serie ?? "",
      estadoOperativo: estadoOperativo.toFront(r.estado),
      propiedad: propiedad.toFront(r.tipo_propiedad),
      proveedor_id: r.proveedor_id, // number | null en EquipoItem
      proveedor_nombre: r.proveedor ?? undefined,
      costo_adquisicion: r.costo_adquisicion ?? undefined,
      costo_alquiler: r.costo_alquiler ?? undefined,
    }))
  },
  async toDb(b, { conn }) {
    const tipo = propiedad.toDb(b.propiedad ?? "Propio", "Propiedad")
    const proveedor = tipo === "alquilado" ? await resolveId("proveedor", b.proveedor_id, b.proveedor_nombre, conn) : null
    if (tipo === "alquilado" && !proveedor) throw bad("Un equipo alquilado debe tener proveedor")
    return {
      nombre: reqStr(b.nombre, "El nombre del equipo"),
      numero_serie: strOrNull(b.serie),
      tipo_propiedad: tipo,
      estado: estadoOperativo.toDb(b.estadoOperativo ?? "Disponible", "Estado operativo"),
      costo_adquisicion: moneyOrNull(b.costo_adquisicion, "El costo de adquisición"),
      costo_alquiler: moneyOrNull(b.costo_alquiler, "El costo de alquiler"),
      categoria_id: await requireId("categoriaEquipo", null, b.categoria, conn),
      proveedor_id: proveedor,
    }
  },
  // El código lo asigna el servidor: el frontend lo calcula contando filas y se repite tras un borrado.
  async afterSave({ conn, id, created }) {
    if (created) await exec("UPDATE equipo SET codigo = ? WHERE id_equipo = ?", [`EQ-${pad(id)}`, id], conn)
  },
})
