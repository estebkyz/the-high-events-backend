import { exec, query, type Conn } from "../config/db.js"
import { requireId } from "../utils/lookup.js"
import { crudRouter, groupBy, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import {
  activoToDb,
  asArray,
  dateToFront,
  estadoActivo,
  formatCOP,
  joinName,
  pad,
  req as reqStr,
  splitName,
  str,
} from "../utils/format.js"

interface HistRow {
  proveedor_id: number
  evento_id: number
  evento: string
  fecha: string
  estado: string
  costo: number
  pagado: number
  acta: number | null
}

/** Una contratación por evento, desde evento_servicio; pagos confirmados y acta de montaje si existen. */
async function historialDe(ids: number[] | null, conn?: Conn) {
  const w = whereIds("es.proveedor_id", ids)
  const rows = await query<HistRow>(
    `SELECT es.proveedor_id, es.evento_id, MAX(e.nombre_evento) AS evento, MAX(e.fecha_hora_inicio) AS fecha,
            MAX(e.estado) AS estado, SUM(es.costo) AS costo,
            (SELECT COALESCE(SUM(pp.monto), 0) FROM pago_proveedor pp
              WHERE pp.evento_id = es.evento_id AND pp.proveedor_id = es.proveedor_id AND pp.estado = 'confirmado') AS pagado,
            (SELECT MAX(rc.id_recepcion) FROM recepcion rc
              WHERE rc.evento_id = es.evento_id AND rc.proveedor_id = es.proveedor_id
                AND rc.tipo_recepcion = 'recepcion_montaje' AND rc.estado_recepcion <> 'anulada') AS acta
       FROM evento_servicio es JOIN evento e ON e.id_evento = es.evento_id
      ${w.sql ? `${w.sql} AND` : "WHERE"} es.proveedor_id IS NOT NULL
      GROUP BY es.proveedor_id, es.evento_id
      ORDER BY fecha DESC`,
    w.params,
    conn,
  )
  return groupBy(rows, (r) => r.proveedor_id)
}

const estadoContratacion = (estadoEvento: string) =>
  estadoEvento === "finalizado" || estadoEvento === "cerrado_financiero"
    ? "Completado"
    : estadoEvento === "cancelado"
      ? "Cancelado"
      : "Pendiente"

const modalidadPago = (r: HistRow) =>
  r.costo > 0 && r.pagado >= r.costo
    ? "Liquidado 100% (50% + 50%)"
    : r.costo > 0 && r.pagado >= r.costo / 2
      ? "Anticipo 50% Pagado"
      : "Pendiente Anticipo"

export const proveedoresRouter = crudRouter({
  table: "proveedor",
  pk: "id_proveedor",
  perms: stdPerms("proveedores"),
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("id_proveedor", ids)
    const rows = await query<Obj>(`SELECT * FROM proveedor ${w.sql} ORDER BY id_proveedor DESC`, w.params, conn)
    const s = whereIds("ps.proveedor_id", ids)
    const servicios = groupBy(
      await query<{ proveedor_id: number; nombre: string }>(
        `SELECT ps.proveedor_id, s.nombre FROM proveedor_servicio ps
           JOIN servicio s ON s.id_servicio = ps.servicio_id ${s.sql} ORDER BY s.id_servicio`,
        s.params,
        conn,
      ),
      (r) => r.proveedor_id,
    )
    const e = whereIds("proveedor_id", ids)
    const equipos = groupBy(
      await query<{ proveedor_id: number; nombre: string }>(
        `SELECT proveedor_id, nombre FROM equipo
          ${e.sql ? `${e.sql} AND` : "WHERE"} proveedor_id IS NOT NULL ORDER BY id_equipo`,
        e.params,
        conn,
      ),
      (r) => r.proveedor_id,
    )
    const historial = await historialDe(ids, conn)
    return rows.map((r) => {
      const c = splitName(r.contacto_nombre, r.contacto_apellido)
      const hist = historial.get(r.id_proveedor) ?? []
      return {
        id: String(r.id_proveedor),
        nit_documento: r.numero_documento,
        razon_social: r.razon_social,
        contacto_primer_nombre: c.primer_nombre,
        contacto_segundo_nombre: c.segundo_nombre,
        contacto_primer_apellido: c.primer_apellido,
        contacto_segundo_apellido: c.segundo_apellido,
        telefono: r.telefono,
        correo: r.correo,
        servicios: (servicios.get(r.id_proveedor) ?? []).map((x) => x.nombre),
        equipos: (equipos.get(r.id_proveedor) ?? []).map((x) => x.nombre),
        estado: estadoActivo(r.estado),
        contratosCount: hist.length,
        historial: hist.map((h) => ({
          evento: h.evento,
          fecha: dateToFront(h.fecha),
          monto: formatCOP(h.costo),
          estado: estadoContratacion(h.estado),
          modalidadPago: modalidadPago(h),
          ...(h.acta ? { actaRecepcion: `RCP-${pad(h.acta)}` } : {}),
        })),
        fecha_creacion: r.fecha_creacion,
      }
    })
  },
  async toDb(b, { conn }) {
    // `equipos` e `historial` son derivados: los equipos se vinculan desde el módulo de Equipos.
    const servicios: number[] = []
    for (const n of new Set(asArray(b.servicios, "servicios").map(str).filter(Boolean)))
      servicios.push(await requireId("servicio", null, n, conn))
    return {
      numero_documento: reqStr(b.nit_documento, "El NIT o documento"),
      razon_social: reqStr(b.razon_social, "La razón social"),
      contacto_nombre: reqStr(joinName(b.contacto_primer_nombre, b.contacto_segundo_nombre), "El nombre del contacto"),
      contacto_apellido: reqStr(
        joinName(b.contacto_primer_apellido, b.contacto_segundo_apellido),
        "El apellido del contacto",
      ),
      telefono: reqStr(b.telefono, "El teléfono"),
      correo: reqStr(b.correo, "El correo"),
      estado: activoToDb(b.estado ?? "Activo"),
      $servicios: servicios.sort((x, y) => x - y),
    }
  },
  async afterSave({ conn, id, db, changed }) {
    if (!changed("$servicios")) return
    const ids: number[] = db.$servicios
    // Se conserva `valor` de los servicios que permanecen
    await exec(
      "DELETE FROM proveedor_servicio WHERE proveedor_id = ? AND servicio_id NOT IN (?)",
      [id, ids.length ? ids : [0]],
      conn,
    )
    if (ids.length)
      await exec(
        "INSERT IGNORE INTO proveedor_servicio (proveedor_id, servicio_id) VALUES ?",
        [ids.map((s) => [id, s])],
        conn,
      )
  },
})
