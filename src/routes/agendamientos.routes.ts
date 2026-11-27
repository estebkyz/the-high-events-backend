import { query } from "../config/db.js"
import { clienteNombreSql, personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, whereIds, type Obj } from "../utils/resource.js"
import {
  HORA,
  addToDt,
  dateToDb,
  dateToFront,
  enumMap,
  intOrNull,
  pad,
  req as reqStr,
  str,
  strOrNull,
  timeToDb,
  timeToFront,
} from "../utils/format.js"
import { bad } from "../utils/http.js"

const tipo = enumMap({
  reunion_cliente: "reunion_cliente",
  visita_tecnica: "visita_tecnica",
  otro: "otro",
})
const TIPO_LABEL: Record<string, string> = {
  visita_tecnica: "Visita Técnica",
  reunion_cliente: "Reunión con Cliente",
  otro: "Otro",
}
const estado = enumMap({
  Pendiente: "pendiente",
  Confirmado: "confirmado",
  Cancelado: "cancelado",
  Realizado: "realizado",
})
// Alias que el propio frontend agrupa así (agendamiento/utils.ts ESTADO_GRUPO); al crear envía Programado/Programada.
const ALIAS: Record<string, string> = {
  Programado: "Pendiente",
  Programada: "Pendiente",
  Confirmada: "Confirmado",
  Realizada: "Realizado",
  Cancelada: "Cancelado",
}

/** Fecha (`year`, `month` 0-11, `day`) y hora del frontend → DATETIME. */
function fechaHora(b: Obj, hora: unknown, etiqueta: string): string {
  const [year, month, day] = [b.year, b.month, b.day].map(intOrNull)
  if (year == null || month == null || day == null) throw bad("La fecha del agendamiento es obligatoria")
  if (month < 0 || month > 11) throw bad("El mes debe estar entre 0 y 11")
  const h = timeToDb(hora, etiqueta)
  if (!h) throw bad(`${etiqueta} es obligatoria`)
  const f = new Date(Date.UTC(year, month, day))
  if (f.getUTCMonth() !== month || f.getUTCDate() !== day) throw bad("La fecha del agendamiento no existe")
  return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(day, 2)} ${h}:00`
}

export const agendamientosRouter = crudRouter({
  table: "agendamiento",
  pk: "id_agendamiento",
  perms: {
    ver: ["agendamiento.ver", "dashboard.agenda"],
    crear: ["agendamiento.crear"],
    editar: ["agendamiento.editar"],
    estado: ["agendamiento.estado"],
    eliminar: ["agendamiento.eliminar"],
  },
  catalogo: { modulos: ["eventos", "dashboard"] },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("a.id_agendamiento", ids)
    const rows = await query<Obj>(
      `SELECT a.*, ${clienteNombreSql("c")} AS cliente, e.modalidad AS evento_modalidad, e.nombre_evento,
              COALESCE(a.cliente_id, e.cliente_id) AS cliente_real, ${personaSql("em")} AS responsable
         FROM agendamiento a
         LEFT JOIN evento e ON e.id_evento = a.evento_id
         LEFT JOIN cliente c ON c.id_cliente = COALESCE(a.cliente_id, e.cliente_id)
         LEFT JOIN empleado em ON em.id_empleado = a.empleado_id
        ${w.sql} ORDER BY a.fecha_hora_inicio DESC, a.id_agendamiento DESC`,
      w.params,
      conn,
    )
    return rows.map((r) => {
      const [y, m, d] = r.fecha_hora_inicio.slice(0, 10).split("-").map(Number)
      return {
        id: String(r.id_agendamiento),
        kind: "cita",
        tipo_agendamiento: r.tipo_agendamiento,
        title: r.titulo,
        type: TIPO_LABEL[r.tipo_agendamiento], // `type` no tiene columna: se deriva del tipo
        time: timeToFront(r.fecha_hora_inicio),
        timeEnd: timeToFront(r.fecha_hora_fin),
        day: d,
        month: m - 1,
        year: y,
        client: r.cliente || (r.evento_modalidad === "propio" ? "The High Events" : "Cliente por confirmar"),
        estado: estado.toFront(r.estado),
        motivo: r.motivo ?? undefined,
        notas: r.notas ?? undefined,
        fechaTentativaEvento: r.fecha_tentativa_evento ? dateToFront(r.fecha_tentativa_evento) : undefined,
        tipoEventoTentativo: r.tipo_tentativa_evento ?? undefined,
        lugarTentativo: r.ubicacion_tentativa_evento ?? undefined,
        cliente_id: r.cliente_real ? String(r.cliente_real) : undefined,
        evento_id: r.evento_id ? String(r.evento_id) : undefined,
        evento: r.nombre_evento ?? undefined,
        responsable_id: r.empleado_id ? String(r.empleado_id) : undefined,
        responsable: r.responsable || undefined,
      }
    })
  },
  async toDb(b, { conn }) {
    const inicio = fechaHora(b, b.time, "La hora de inicio")
    const fin = b.timeEnd ? fechaHora(b, b.timeEnd, "La hora de fin") : addToDt(inicio, HORA)
    if (fin < inicio) throw bad("La hora de fin no puede ser anterior a la de inicio")
    const est = str(b.estado) || "Pendiente"
    // Sobre un evento, el cliente se lee del evento; antes de existir el evento, la reunión es con el cliente
    const evento = intOrNull(b.evento_id)
    const cliente = evento ? null : intOrNull(b.cliente_id)
    const responsable = intOrNull(b.responsable_id)
    return {
      evento_id: evento ? await requireId("evento", evento, null, conn) : null,
      cliente_id: cliente ? await requireId("cliente", cliente, null, conn) : null,
      empleado_id: responsable ? await requireId("empleado", responsable, null, conn) : null,
      titulo: reqStr(b.title, "El título"),
      tipo_agendamiento: tipo.toDb(b.tipo_agendamiento || "reunion_cliente", "Tipo de agendamiento"),
      fecha_hora_inicio: inicio,
      fecha_hora_fin: fin,
      estado: estado.toDb(ALIAS[est] ?? est, "Estado"),
      motivo: strOrNull(b.motivo),
      notas: strOrNull(b.notas),
      fecha_tentativa_evento: dateToDb(b.fechaTentativaEvento, "La fecha tentativa"),
      tipo_tentativa_evento: strOrNull(b.tipoEventoTentativo),
      ubicacion_tentativa_evento: strOrNull(b.lugarTentativo),
    }
  },
})
