import { query } from "../config/db.js"
import { personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, pickChanged, whereIds, type Obj } from "../utils/resource.js"
import { dateToFront, dtToDb, dtToFront, enumMap, nowDb, pad, req as reqStr, strOrNull } from "../utils/format.js"

const TIPOS = [
  "falla_electrica",
  "corte_agua",
  "dano_equipo",
  "inconveniente_proveedor",
  "retraso_montaje",
  "seguridad_orden_publico",
  "emergencia_medica",
  "otro",
] as const
const tipo = enumMap(Object.fromEntries(TIPOS.map((t) => [t, t])))
const criticidad = enumMap({ Baja: "baja", Media: "media", Alta: "alta", Crítica: "critica" })
const estado = enumMap({
  Reportado: "reportado",
  "En Atención": "en_atencion",
  Solucionado: "solucionado",
  Escalado: "escalado",
})

export const incidentesRouter = crudRouter({
  table: "incidente",
  pk: "id_incidente",
  // Nombres reales en el catálogo: reportar = crear, gestionar = editar
  perms: {
    ver: ["incidentes.ver"],
    crear: ["incidentes.reportar"],
    editar: ["incidentes.gestionar"],
    estado: ["incidentes.estado"],
    eliminar: ["incidentes.eliminar"],
  },
  catalogo: { modulos: ["dashboard"] },
  estadoKeys: ["estado", "fecha_hora_solucion"],
  async load(ids, conn) {
    const w = whereIds("i.id_incidente", ids)
    const rows = await query<Obj>(
      `SELECT i.*, e.nombre_evento, ${personaSql("em")} AS responsable
         FROM incidente i
         JOIN evento e ON e.id_evento = i.evento_id
         JOIN empleado em ON em.id_empleado = i.responsable_id
        ${w.sql} ORDER BY i.id_incidente DESC`,
      w.params,
      conn,
    )
    return rows.map((r) => ({
      id: String(r.id_incidente),
      codigo: `INC-${pad(r.id_incidente)}`,
      titulo: r.titulo ?? "",
      evento: r.nombre_evento,
      evento_id: r.evento_id, // number en IncidenteItem
      reporta: r.responsable,
      reportado_por_id: r.responsable_id,
      tipo_incidente: r.tipo_incidente,
      criticidad: criticidad.toFront(r.criticidad),
      fecha: dateToFront(r.fecha_hora_reporte),
      estado: estado.toFront(r.estado),
      descripcion: r.descripcion,
      // Dos campos del frontend para una sola columna
      accionCorrectiva: r.acciones_tomadas ?? "",
      acciones_tomadas: r.acciones_tomadas ?? "",
      resuelto_en: r.fecha_hora_solucion ? dtToFront(r.fecha_hora_solucion) : undefined,
    }))
  },
  async toDb(b, { conn, current }) {
    const est = estado.toDb(b.estado ?? "Reportado", "Estado")
    return {
      evento_id: await requireId("evento", b.evento_id, b.evento, conn),
      responsable_id: await requireId("empleado", b.reportado_por_id, b.reporta, conn),
      tipo_incidente: tipo.toDb(b.tipo_incidente, "Tipo de incidente"),
      criticidad: criticidad.toDb(b.criticidad ?? "Media", "Criticidad"),
      titulo: reqStr(b.titulo, "El título"),
      descripcion: reqStr(b.descripcion, "La descripción"),
      estado: est,
      acciones_tomadas: strOrNull(pickChanged(b, current, ["accionCorrectiva", "acciones_tomadas"])),
      // Se sella al solucionar y se limpia al reabrir
      fecha_hora_solucion: est !== "solucionado" ? null : current?.resuelto_en ? dtToDb(current.resuelto_en, "Fecha de solución") : nowDb(),
    }
  },
})
