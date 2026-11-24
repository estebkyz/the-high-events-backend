import { query } from "../config/db.js"
import { crudRouter, whereIds, type Obj } from "../utils/resource.js"
import { pad, req as reqStr } from "../utils/format.js"
import { faseTarea } from "./eventos.routes.js"

export const codigoTarea = (id: number) => `TAR-${pad(id)}`

export const tareasCatalogoRouter = crudRouter({
  table: "tarea",
  pk: "id_tarea",
  perms: { crear: ["tareas.crear"], editar: ["tareas.editar"], eliminar: ["tareas.eliminar"] },
  async load(ids, conn) {
    const w = whereIds("id_tarea", ids)
    const rows = await query<Obj>(`SELECT * FROM tarea ${w.sql} ORDER BY id_tarea`, w.params, conn)
    return rows.map((r) => ({
      id: String(r.id_tarea),
      codigo: codigoTarea(r.id_tarea),
      nombre_tarea: r.nombre,
      descripcion: r.descripcion,
      fase_sugerida: faseTarea.toFront(r.fase_sugerida),
    }))
  },
  async toDb(b) {
    return {
      nombre: reqStr(b.nombre_tarea, "El nombre de la tarea"),
      descripcion: reqStr(b.descripcion, "La descripción"), // NOT NULL en la BD
      fase_sugerida: faseTarea.toDb(b.fase_sugerida ?? "Montaje", "Fase sugerida"),
    }
  },
})
