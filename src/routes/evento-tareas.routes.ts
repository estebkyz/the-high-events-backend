import { query } from "../config/db.js"
import { personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import { DIA, addToDt, dateToDb, dateToFront, enumMap, strOrNull, timeToDb, timeToFront } from "../utils/format.js"
import { bad } from "../utils/http.js"
import { faseTarea } from "./eventos.routes.js"
import { codigoTarea } from "./tareas-catalogo.routes.js"

const estado = enumMap({ Pendiente: "pendiente", "En Proceso": "en_proceso", Completada: "completada", "En proceso": "en_proceso" })
const prioridad = enumMap({ Alta: "alta", Media: "media", Baja: "baja" })

export const eventoTareasRouter = crudRouter({
  table: "evento_tarea",
  pk: "id_evento_tarea",
  perms: stdPerms("tareas"),
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("et.id_evento_tarea", ids)
    const rows = await query<Obj>(
      `SELECT et.*, t.nombre AS tarea, t.descripcion AS tarea_desc, e.nombre_evento,
              ${personaSql("em")} AS responsable, em.cargo
         FROM evento_tarea et
         JOIN tarea t ON t.id_tarea = et.tarea_id
         JOIN evento e ON e.id_evento = et.evento_id
         JOIN empleado em ON em.id_empleado = et.empleado_id
        ${w.sql} ORDER BY et.id_evento_tarea DESC`,
      w.params,
      conn,
    )
    return rows.map((r) => ({
      id: String(r.id_evento_tarea),
      tarea_id: String(r.tarea_id),
      codigo_tarea: codigoTarea(r.tarea_id),
      tarea: r.tarea,
      descripcion_catalogo: r.tarea_desc,
      evento_id: String(r.evento_id),
      evento: r.nombre_evento,
      responsable_id: String(r.empleado_id),
      responsable: r.responsable,
      cargo_responsable: r.cargo,
      fase: faseTarea.toFront(r.fase),
      prioridad: prioridad.toFront(r.prioridad),
      fechaLimite: dateToFront(r.fecha_hora_inicio),
      hora_inicio_estimada: timeToFront(r.fecha_hora_inicio),
      hora_fin_estimada: timeToFront(r.fecha_hora_fin),
      estado: estado.toFront(r.estado),
      notas: r.observaciones ?? "",
    }))
  },
  async toDb(b, { conn }) {
    const fecha = dateToDb(b.fechaLimite, "La fecha de la tarea", true)
    const ini = timeToDb(b.hora_inicio_estimada, "La hora de inicio")
    const fin = timeToDb(b.hora_fin_estimada, "La hora de fin")
    if (!ini || !fin) throw bad("Las horas de inicio y fin estimadas son obligatorias")
    const inicio = `${fecha} ${ini}:00`
    const finDt = fin < ini ? addToDt(`${fecha} ${fin}:00`, DIA) : `${fecha} ${fin}:00` // cruza medianoche
    return {
      evento_id: await requireId("evento", b.evento_id, b.evento, conn),
      tarea_id: await requireId("tarea", b.tarea_id, b.tarea, conn),
      empleado_id: await requireId("empleado", b.responsable_id, b.responsable, conn),
      fase: faseTarea.toDb(b.fase, "Fase"),
      fecha_hora_inicio: inicio,
      fecha_hora_fin: finDt,
      estado: estado.toDb(b.estado ?? "Pendiente", "Estado"),
      prioridad: prioridad.toDb(b.prioridad ?? "Media", "Prioridad"),
      observaciones: strOrNull(b.notas),
    }
  },
})
