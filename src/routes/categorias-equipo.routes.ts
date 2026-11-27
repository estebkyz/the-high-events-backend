import { query } from "../config/db.js"
import { crudRouter, whereIds, type Obj } from "../utils/resource.js"
import { activoToDb, estadoActivo, req as reqStr, strOrNull } from "../utils/format.js"

// Un solo privilegio en el catálogo: "Gestionar categorías de equipos".
const perm = ["equipos.categorias"]

export const categoriasEquipoRouter = crudRouter({
  table: "categoria_equipo",
  pk: "id_categoria_equipo",
  perms: { ver: ["equipos.ver"], crear: perm, editar: perm, eliminar: perm },
  catalogo: { modulos: ["equipos", "eventos", "prestamos", "recepciones"] },
  async load(ids, conn) {
    const w = whereIds("id_categoria_equipo", ids)
    const rows = await query<Obj>(`SELECT * FROM categoria_equipo ${w.sql} ORDER BY id_categoria_equipo`, w.params, conn)
    return rows.map((r) => ({
      id: String(r.id_categoria_equipo),
      nombre: r.nombre,
      descripcion: r.descripcion ?? "",
      estado: estadoActivo(r.activo),
    }))
  },
  async toDb(b) {
    return {
      nombre: reqStr(b.nombre, "El nombre de la categoría"),
      descripcion: strOrNull(b.descripcion),
      activo: activoToDb(b.estado ?? "Activo"),
    }
  },
})
