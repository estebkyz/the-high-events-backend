import { exec, query, type Conn } from "../config/db.js"
import { clienteNombreSql, personaSql, requireId, resolveId } from "../utils/lookup.js"
import { crudRouter, groupBy, stdPerms, whereIds, type AfterCtx, type Obj } from "../utils/resource.js"
import {
  asArray,
  dtToDb,
  dtToFront,
  enumMap,
  formatCOP,
  intOrNull,
  moneyOrNull,
  req as reqStr,
  sid,
  str,
  strOrNull,
} from "../utils/format.js"
import { bad, conflict } from "../utils/http.js"
import { codigoCotizacion } from "./cotizaciones.routes.js"

export const estadoEvento = enumMap({
  Planificación: "planificacion",
  Confirmado: "confirmado",
  Montaje: "montaje",
  "En ejecución": "en_ejecucion",
  Desmontaje: "desmontaje",
  Finalizado: "finalizado",
  "Cerrado financiero": "cerrado_financiero",
  Cancelado: "cancelado",
})
const modalidad = enumMap({ Cliente: "cliente", Propio: "propio" })
export const faseTarea = enumMap({
  Planificación: "planificacion",
  Montaje: "montaje",
  Ejecución: "ejecucion",
  Desmontaje: "desmontaje",
})
// EventoItem escribe "En proceso"; TareaItem escribe "En Proceso"
const estadoTarea = enumMap({ Pendiente: "pendiente", "En proceso": "en_proceso", Completada: "completada" })

interface Servicio {
  servicio_id: number
  proveedor_id: number | null
  cantidad: number
  costo: number
  observaciones: string | null
}
interface Tarea {
  empleado_id: number
  tarea_id: number
  fase: string
}

/** "200 personas" | "1.000" | 200 → entero */
function aforo(v: unknown): number {
  if (v == null || v === "") return 0
  const m = str(v).match(/\d[\d.]*/)
  if (!m) throw bad(`Aforo inválido: "${str(v)}"`)
  return Number(m[0].replace(/\./g, ""))
}

/** `servicios` (nombres) manda; el detalle del mismo nombre aporta proveedor, cantidad, costo y observaciones. */
async function leerServicios(b: Obj, raw: Obj, conn: Conn): Promise<Servicio[]> {
  const libres: Obj[] = [...asArray(b.serviciosDetalles, "serviciosDetalles")]
  const soloDetalles = raw.servicios === undefined && raw.serviciosDetalles !== undefined
  const nombres = soloDetalles ? libres.map((d) => d.nombre) : asArray(b.servicios, "servicios")
  const out: Servicio[] = []
  for (const nombre of nombres) {
    const pos = libres.findIndex((d) => str(d.nombre) === str(nombre))
    const det = pos >= 0 ? libres.splice(pos, 1)[0] : undefined
    const servicio_id = await requireId("servicio", det?.servicio_catalogo_id, nombre, conn)
    let costo = moneyOrNull(det?.costo, `El costo de ${str(nombre)}`)
    // Sin detalle, el formulario muestra el precio base del catálogo
    if (costo === null)
      [{ costo }] = await query<{ costo: number }>("SELECT precio_base AS costo FROM servicio WHERE id_servicio = ?", [servicio_id], conn)
    const cantidad = det?.cantidad == null ? 1 : intOrNull(det.cantidad)
    if (!cantidad || cantidad < 1) throw bad("La cantidad de cada servicio debe ser un entero mayor que cero")
    out.push({
      servicio_id,
      proveedor_id: await resolveId("proveedor", det?.proveedor_id, null, conn),
      cantidad,
      costo,
      observaciones: strOrNull(det?.observaciones),
    })
  }
  return out
}

async function leerTareas(b: Obj, conn: Conn): Promise<Tarea[]> {
  const out: Tarea[] = []
  for (const a of asArray(b.empleadosAsignados, "empleadosAsignados") as Obj[])
    out.push({
      empleado_id: await requireId("empleado", a.empleado_id, null, conn),
      tarea_id: await requireId("tarea", a.tarea_id, null, conn),
      fase: faseTarea.toDb(a.fase, "Fase"),
    })
  return out
}

/** No puede haber dos eventos no cancelados en la misma ubicación con horarios cruzados. */
async function validarCruce({ conn, id, db }: AfterCtx) {
  if (db.estado === "cancelado") return
  const [x] = await query<{ nombre_evento: string }>(
    `SELECT nombre_evento FROM evento
      WHERE id_evento <> ? AND estado <> 'cancelado' AND ubicacion_evento = ?
        AND fecha_hora_inicio < ? AND fecha_hora_fin > ? LIMIT 1 FOR UPDATE`,
    [id, db.ubicacion_evento, db.fecha_hora_fin, db.fecha_hora_inicio],
    conn,
  )
  if (x) throw conflict(`Ya existe el evento "${x.nombre_evento}" en esa ubicación y horario`)
}

/** Actualiza las asignaciones sin perder estado, prioridad ni horario de las tareas que permanecen. */
async function guardarTareas({ conn, id, db }: AfterCtx) {
  const libres = await query<{ id_evento_tarea: number; empleado_id: number; tarea_id: number; fase: string }>(
    "SELECT id_evento_tarea, empleado_id, tarea_id, fase FROM evento_tarea WHERE evento_id = ?",
    [id],
    conn,
  )
  const tomar = (t: Tarea, conFase: boolean) => {
    const i = libres.findIndex(
      (x) => x.empleado_id === t.empleado_id && x.tarea_id === t.tarea_id && (!conFase || x.fase === t.fase),
    )
    return i >= 0 ? libres.splice(i, 1)[0] : undefined
  }
  const tareas: Tarea[] = db.$tareas
  const pares = tareas.map((t) => ({ t, fila: tomar(t, true) }))
  for (const p of pares) {
    const fila = p.fila ?? tomar(p.t, false)
    if (!fila)
      await exec(
        `INSERT INTO evento_tarea (evento_id, tarea_id, empleado_id, fase, fecha_hora_inicio, fecha_hora_fin)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, p.t.tarea_id, p.t.empleado_id, p.t.fase, db.fecha_hora_inicio, db.fecha_hora_fin],
        conn,
      )
    else if (fila.fase !== p.t.fase)
      await exec("UPDATE evento_tarea SET fase = ? WHERE id_evento_tarea = ?", [p.t.fase, fila.id_evento_tarea], conn)
  }
  if (libres.length)
    await exec("DELETE FROM evento_tarea WHERE id_evento_tarea IN (?)", [libres.map((x) => x.id_evento_tarea)], conn)
}

export const eventosRouter = crudRouter({
  table: "evento",
  pk: "id_evento",
  perms: stdPerms("eventos"),
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("e.id_evento", ids)
    const rows = await query<Obj>(
      `SELECT e.*, ${clienteNombreSql("c")} AS cliente
         FROM evento e LEFT JOIN cliente c ON c.id_cliente = e.cliente_id
        ${w.sql} ORDER BY e.id_evento DESC`,
      w.params,
      conn,
    )
    const hijos = async (sql: string, col: string) => {
      const x = whereIds(col, ids)
      const list = await query<Obj & { evento_id: number }>(sql.replace("{w}", x.sql), x.params, conn)
      return groupBy(list, (r) => r.evento_id)
    }
    const servicios = await hijos(
      `SELECT es.*, s.nombre, cs.nombre AS categoria, p.razon_social AS proveedor
         FROM evento_servicio es
         JOIN servicio s ON s.id_servicio = es.servicio_id
         JOIN categoria_servicio cs ON cs.id_categoria_servicio = s.categoria_id
         LEFT JOIN proveedor p ON p.id_proveedor = es.proveedor_id
        {w} ORDER BY es.id_evento_servicio`,
      "es.evento_id",
    )
    const equipos = await hijos("SELECT evento_id, equipo_id FROM evento_equipo {w} ORDER BY equipo_id", "evento_id")
    const tareas = await hijos(
      `SELECT et.*, ${personaSql("em")} AS empleado, em.cargo, t.nombre AS tarea
         FROM evento_tarea et
         JOIN empleado em ON em.id_empleado = et.empleado_id
         JOIN tarea t ON t.id_tarea = et.tarea_id
        {w} ORDER BY et.id_evento_tarea`,
      "et.evento_id",
    )
    return rows.map((r) => {
      const serv = servicios.get(r.id_evento) ?? []
      const propio = r.modalidad === "propio"
      return {
        id: String(r.id_evento),
        cliente_id: r.cliente_id == null ? null : String(r.cliente_id),
        cliente_nombre: propio ? "The High Events" : r.cliente,
        cotizacion_id: sid(r.cotizacion_id),
        cotizacion_codigo: r.cotizacion_id ? codigoCotizacion(r.cotizacion_id) : "",
        modalidad: modalidad.toFront(r.modalidad),
        nombre: r.nombre_evento,
        direccion: r.ubicacion_evento,
        hora_inicio: dtToFront(r.fecha_hora_inicio),
        hora_fin: dtToFront(r.fecha_hora_fin),
        presupuesto_estimado: r.presupuesto_estimado,
        estado: estadoEvento.toFront(r.estado),
        fecha_creacion: r.fecha_creacion,
        aforo_esperado: r.aforo_esperado ? String(r.aforo_esperado) : "",
        concepto_espectaculo: r.concepto_espectaculo ?? "",
        publico_objetivo: r.publico_objetivo ?? "",
        observaciones: r.observaciones ?? "",
        servicios: serv.map((s) => s.nombre),
        serviciosDetalles: serv.map((s) => ({
          id: String(s.id_evento_servicio),
          servicio_catalogo_id: String(s.servicio_id),
          nombre: s.nombre,
          categoria: s.categoria,
          observaciones: s.observaciones ?? "",
          costo: formatCOP(s.costo),
          cantidad: s.cantidad,
          ...(s.proveedor_id ? { proveedor_id: String(s.proveedor_id), proveedor_nombre: s.proveedor } : {}),
        })),
        empleadosAsignados: (tareas.get(r.id_evento) ?? []).map((t) => ({
          empleado_id: String(t.empleado_id),
          nombre: t.empleado,
          cargo: t.cargo,
          tarea_id: String(t.tarea_id),
          nombre_tarea: t.tarea,
          fase: faseTarea.toFront(t.fase),
          estado: estadoTarea.toFront(t.estado),
        })),
        equiposAsignados: (equipos.get(r.id_evento) ?? []).map((x) => String(x.equipo_id)),
      }
    })
  },
  async toDb(b, { conn, raw }) {
    const mod = modalidad.toDb(b.modalidad, "Modalidad")
    const inicio = dtToDb(b.hora_inicio, "La fecha y hora de inicio", true)!
    const fin = dtToDb(b.hora_fin, "La fecha y hora de fin", true)!
    if (fin <= inicio) throw bad("La finalización debe ser posterior al inicio")
    // EventoFormPage envía cliente_nombre "Cliente General" aunque el id sea válido: manda el id.
    // Para eventos propios envía cotizacion_id "5" fijo, que podría ser de un cliente: se descarta.
    const cliente_id = mod === "cliente" ? await requireId("cliente", b.cliente_id, null, conn) : null
    const cotizacion = mod === "cliente" ? intOrNull(b.cotizacion_id) : null
    if (cotizacion) {
      const [c] = await query("SELECT 1 FROM cotizacion WHERE id_cotizacion = ?", [cotizacion], conn)
      if (!c) throw bad("La cotización seleccionada no existe")
    }
    const equipos = new Set<number>()
    for (const e of asArray(b.equiposAsignados, "equiposAsignados")) equipos.add(await requireId("equipo", e, null, conn))
    return {
      cliente_id,
      cotizacion_id: cotizacion,
      modalidad: mod,
      nombre_evento: reqStr(b.nombre, "El nombre del evento"),
      ubicacion_evento: reqStr(b.direccion, "La ubicación del evento"),
      fecha_hora_inicio: inicio,
      fecha_hora_fin: fin,
      presupuesto_estimado: moneyOrNull(b.presupuesto_estimado, "El presupuesto") ?? 0,
      estado: estadoEvento.toDb(b.estado ?? "Planificación", "Estado"),
      aforo_esperado: aforo(b.aforo_esperado),
      concepto_espectaculo: strOrNull(b.concepto_espectaculo),
      publico_objetivo: strOrNull(b.publico_objetivo),
      observaciones: strOrNull(b.observaciones),
      $servicios: await leerServicios(b, raw, conn),
      $equipos: [...equipos].sort((x, y) => x - y),
      $tareas: await leerTareas(b, conn),
    }
  },
  async afterSave(ctx) {
    const { conn, id, db, changed, created } = ctx
    if (["ubicacion_evento", "fecha_hora_inicio", "fecha_hora_fin", "estado"].some(changed)) await validarCruce(ctx)
    if (changed("$servicios")) {
      if (!created) await exec("DELETE FROM evento_servicio WHERE evento_id = ?", [id], conn)
      const s: Servicio[] = db.$servicios
      if (s.length)
        await exec(
          "INSERT INTO evento_servicio (evento_id, servicio_id, proveedor_id, cantidad, costo, observaciones) VALUES ?",
          [s.map((x) => [id, x.servicio_id, x.proveedor_id, x.cantidad, x.costo, x.observaciones])],
          conn,
        )
    }
    if (changed("$equipos")) {
      if (!created) await exec("DELETE FROM evento_equipo WHERE evento_id = ?", [id], conn)
      if (db.$equipos.length)
        await exec("INSERT INTO evento_equipo (evento_id, equipo_id) VALUES ?", [db.$equipos.map((e: number) => [id, e])], conn)
    }
    if (changed("$tareas")) await guardarTareas(ctx)
  },
})
