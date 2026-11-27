import { query } from "../config/db.js"
import { crudRouter, whereIds, type Obj } from "../utils/resource.js"
import { activoToDb, estadoActivo, req as reqStr, strOrNull } from "../utils/format.js"

// Un solo privilegio en el catálogo: "Gestionar categorías de servicios".
const perm = ["servicios.categorias"]

export const categoriasServicioRouter = crudRouter({
  table: "categoria_servicio",
  pk: "id_categoria_servicio",
  perms: { ver: ["servicios.ver"], crear: perm, editar: perm, eliminar: perm },
  catalogo: { modulos: ["servicios", "cotizaciones", "eventos", "proveedores"] },
  async load(ids, conn) {
    const w = whereIds("id_categoria_servicio", ids)
    const rows = await query<Obj>(`SELECT * FROM categoria_servicio ${w.sql} ORDER BY id_categoria_servicio`, w.params, conn)
    return rows.map((r) => ({
      id: String(r.id_categoria_servicio),
      nombre: r.nombre,
      descripcion: r.descripcion ?? "",
      estado: estadoActivo(r.estado),
    }))
  },
  async toDb(b) {
    return {
      nombre: reqStr(b.nombre, "El nombre de la categoría"),
      descripcion: strOrNull(b.descripcion),
      estado: activoToDb(b.estado ?? "Activo"),
    }
  },
})
