import { query } from "../config/db.js"
import { clienteNombreSql, requireId } from "../utils/lookup.js"
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
  evento: "evento",
  visita_tecnica: "visita_tecnica",
  reunion_cliente: "reunion_cliente",
  otro: "otro",
})
const TIPO_LABEL: Record<string, string> = {
  evento: "Evento",
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

function inicioDe(b: Obj): string {
  const [year, month, day] = [b.year, b.month, b.day].map(intOrNull)
  if (year == null || month == null || day == null) throw bad("La fecha del agendamiento es obligatoria")
  if (month < 0 || month > 11) throw bad("El mes debe estar entre 0 y 11")
  const hora = timeToDb(b.time, "La hora")
  if (!hora) throw bad("La hora es obligatoria")
  const f = new Date(Date.UTC(year, month, day))
  if (f.getUTCMonth() !== month || f.getUTCDate() !== day) throw bad("La fecha del agendamiento no existe")
  return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(day, 2)} ${hora}:00`
}

export const agendamientosRouter = crudRouter({
  table: "agendamiento",
  pk: "id_agendamiento",
  perms: {
    crear: ["agendamiento.crear"],
    editar: ["agendamiento.editar"],
    estado: ["agendamiento.estado"],
    eliminar: ["agendamiento.eliminar"],
  },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("a.id_agendamiento", ids)
    const rows = await query<Obj>(
      `SELECT a.*, ${clienteNombreSql("c")} AS cliente, e.modalidad AS evento_modalidad
         FROM agendamiento a
         LEFT JOIN cliente c ON c.id_cliente = a.cliente_id
         LEFT JOIN evento e ON e.id_evento = a.evento_id
        ${w.sql} ORDER BY a.fecha_hora_inicio DESC, a.id_agendamiento DESC`,
      w.params,
      conn,
    )
    return rows.map((r) => {
      const [y, m, d] = r.fecha_hora_inicio.slice(0, 10).split("-").map(Number)
      return {
        id: String(r.id_agendamiento),
        kind: r.tipo_agendamiento === "reunion_cliente" ? "cita" : r.tipo_agendamiento,
        tipo_agendamiento: r.tipo_agendamiento,
        title: r.titulo,
        type: TIPO_LABEL[r.tipo_agendamiento], // `type` no tiene columna: se deriva del tipo
        time: timeToFront(r.fecha_hora_inicio),
        day: d,
        month: m - 1,
        year: y,
        client: r.cliente || (r.evento_modalidad === "propio" ? "The High Events" : "Cliente por confirmar"),
        estado: estado.toFront(r.estado),
        venue: r.ubicacion ?? undefined,
        modalidadCita: r.modalidad_cita ?? undefined,
        motivo: r.motivo ?? undefined,
        notas: r.notas ?? undefined,
        fechaTentativaEvento: r.fecha_tentativa_evento ? dateToFront(r.fecha_tentativa_evento) : undefined,
        tipoEventoTentativo: r.tipo_tentativa_evento ?? undefined,
        lugarTentativo: r.ubicacion_tentativa_evento ?? undefined,
        cliente_id: r.cliente_id ? String(r.cliente_id) : undefined,
        evento_id: r.evento_id ? String(r.evento_id) : undefined,
        cotizacion_id: r.cotizacion_id ? String(r.cotizacion_id) : undefined,
      }
    })
  },
  async toDb(b, { conn }) {
    const inicio = inicioDe(b)
    const est = str(b.estado) || "Pendiente"
    // El selector de eventos mezcla eventos ("12") y cotizaciones ("cot-5"); "propio" no es un cliente.
    const refCot = str(b.evento_id).match(/^cot-(\d+)$/)?.[1]
    const cliente = intOrNull(b.cliente_id)
    const evento = refCot ? null : intOrNull(b.evento_id)
    return {
      evento_id: evento ? await requireId("evento", evento, null, conn) : null,
      cliente_id: cliente ? await requireId("cliente", cliente, null, conn) : null,
      cotizacion_id: intOrNull(refCot ?? b.cotizacion_id),
      titulo: reqStr(b.title, "El título"),
      tipo_agendamiento: tipo.toDb(b.tipo_agendamiento || (b.kind === "cita" ? "reunion_cliente" : b.kind), "Tipo de agendamiento"),
      fecha_hora_inicio: inicio,
      fecha_hora_fin: addToDt(inicio, HORA),
      estado: estado.toDb(ALIAS[est] ?? est, "Estado"),
      ubicacion: strOrNull(b.venue),
      modalidad_cita: strOrNull(b.modalidadCita),
      motivo: strOrNull(b.motivo),
      notas: strOrNull(b.notas),
      fecha_tentativa_evento: dateToDb(b.fechaTentativaEvento, "La fecha tentativa"),
      tipo_tentativa_evento: strOrNull(b.tipoEventoTentativo),
      ubicacion_tentativa_evento: strOrNull(b.lugarTentativo),
    }
  },
})
