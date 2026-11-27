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
import { avisosDe, descartarBorradores, documentosDe, sincronizarDocumentos } from "../utils/documentos.js"
import { bloquearEquipos, EVENTO_INACTIVO, exigirDisponibles } from "../utils/disponibilidad.js"
import { codigoCotizacion } from "./cotizaciones.routes.js"
import { estado as estadoPrestamo } from "./prestamos.routes.js"
import { estado as estadoRecepcion } from "./recepciones.routes.js"

export const estadoEvento = enumMap({
  Cotización: "cotizacion",
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

/**
 * Un evento de cliente no elige servicios: son los de su cotización aceptada (o, si aún no la tiene, los que ya
 * tenía). Desde Eventos solo se completan el proveedor, el costo y las observaciones de cada uno.
 */
async function serviciosDeCliente(conn: Conn, evento: number, pedidos: Servicio[], revisar: boolean): Promise<Servicio[]> {
  const guardados = await query<Servicio>(
    "SELECT servicio_id, proveedor_id, cantidad, costo, observaciones FROM evento_servicio WHERE evento_id = ?",
    [evento],
    conn,
  )
  const cotizados = await query<{ servicio_id: number; cantidad: number; costo: number }>(
    `SELECT d.servicio_id, d.cantidad, s.precio_base AS costo
       FROM cotizacion c JOIN cotizacion_detalle d ON d.cotizacion_id = c.id_cotizacion
       JOIN servicio s ON s.id_servicio = d.servicio_id
      WHERE c.evento_id = ? AND c.estado = 'aceptada' ORDER BY d.id_cotizacion_detalle`,
    [evento],
    conn,
  )
  const [{ aceptada }] = await query<{ aceptada: number }>(
    "SELECT COUNT(*) AS aceptada FROM cotizacion WHERE evento_id = ? AND estado = 'aceptada'",
    [evento],
    conn,
  )
  const base = Number(aceptada) ? cotizados : guardados
  const clave = (l: { servicio_id: number }[]) => JSON.stringify(l.map((x) => x.servicio_id).sort((a, b) => a - b))
  if (revisar && clave(pedidos) !== clave(guardados) && clave(pedidos) !== clave(base))
    throw conflict("Los servicios de un evento de cliente vienen de su cotización aceptada: agrégalos o quítalos en Cotizaciones")
  return base.map((b) => {
    const p = pedidos.find((x) => x.servicio_id === b.servicio_id)
    const g = guardados.find((x) => x.servicio_id === b.servicio_id)
    return {
      servicio_id: b.servicio_id,
      cantidad: b.cantidad,
      proveedor_id: p ? p.proveedor_id : (g?.proveedor_id ?? null),
      costo: p?.costo ?? g?.costo ?? b.costo,
      observaciones: p ? p.observaciones : (g?.observaciones ?? null),
    }
  })
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

/** El valor del evento no puede quedar por debajo de lo que ya se registró en abonos. */
async function exigirValorCubreAbonos(conn: Conn, evento: number, valor: number) {
  const [{ pagado }] = await query<{ pagado: number }>(
    `SELECT COALESCE(SUM(p.monto), 0) AS pagado FROM pago_cliente p JOIN venta v ON v.id_venta = p.venta_id
      WHERE v.evento_id = ? AND v.estado = 'confirmada' AND p.estado <> 'rechazado'`,
    [evento],
    conn,
  )
  if (valor < pagado) throw conflict("El valor del evento no puede ser menor que los abonos registrados")
}

/** No puede haber dos eventos no cancelados en la misma ubicación con horarios cruzados. */
async function validarCruce({ conn, id, db }: AfterCtx) {
  if (db.estado === "cancelado" || !db.ubicacion_evento || !db.fecha_hora_inicio) return
  const [x] = await query<{ nombre_evento: string }>(
    `SELECT nombre_evento FROM evento
      WHERE id_evento <> ? AND estado <> 'cancelado' AND ubicacion_evento = ?
        AND fecha_hora_inicio < ? AND fecha_hora_fin > ? LIMIT 1 FOR UPDATE`,
    [id, db.ubicacion_evento, db.fecha_hora_fin, db.fecha_hora_inicio],
    conn,
  )
  if (x) throw conflict(`Ya existe el evento "${x.nombre_evento}" en esa ubicación y horario`)
}

/** Lo que se agrega debe estar en servicio; todo debe estar libre en las fechas del evento. */
async function validarEquipos({ conn, id, db, before, created, changed }: AfterCtx) {
  if (EVENTO_INACTIVO.includes(db.estado)) return
  const previos: number[] = created ? [] : (before.$equipos ?? [])
  const nuevos = (db.$equipos as number[]).filter((e) => !previos.includes(e))
  const reactivado = changed("estado") && EVENTO_INACTIVO.includes(before.estado)
  const todos = created || reactivado || changed("fecha_hora_inicio") || changed("fecha_hora_fin")
  await exigirDisponibles(
    conn,
    todos ? db.$equipos : nuevos,
    { inicio: db.fecha_hora_inicio, fin: db.fecha_hora_fin },
    id,
    reactivado ? db.$equipos : nuevos,
  )
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
  // Ventas propone el presupuesto como total; el Dashboard lo suma
  perms: { ...stdPerms("eventos"), ver: ["eventos.ver", "ventas.crear", "ventas.editar", "dashboard.ver"] },
  catalogo: {
    modulos: ["agendamiento", "incidentes", "prestamos", "recepciones", "tareas", "ventas", "abonos"],
    // Sin presupuesto ni costos de los servicios contratados
    campos: [
      "cliente_id", "cliente_nombre", "cotizacion_id", "cotizacion_codigo", "responsable_id", "responsable_nombre", "modalidad", "nombre",
      "direccion", "hora_inicio", "hora_fin", "estado", "aforo_esperado", "servicios", "equiposAsignados", "empleadosAsignados", "documentos", "avisos",
    ],
  },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("e.id_evento", ids)
    const rows = await query<Obj>(
      `SELECT e.*, ${clienteNombreSql("c")} AS cliente, ${personaSql("rs")} AS responsable,
              -- La cotización que fijó el valor; si aún no hay aceptada, la más reciente
              (SELECT q.id_cotizacion FROM cotizacion q WHERE q.evento_id = e.id_evento
                ORDER BY q.estado = 'aceptada' DESC, q.version DESC LIMIT 1) AS cotizacion_id
         FROM evento e LEFT JOIN cliente c ON c.id_cliente = e.cliente_id
         LEFT JOIN empleado rs ON rs.id_empleado = e.responsable_id
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
    const documentos = await documentosDe(ids, conn)
    const avisos = await avisosDe(ids, conn)
    return rows.map((r) => {
      const serv = servicios.get(r.id_evento) ?? []
      const propio = r.modalidad === "propio"
      return {
        id: String(r.id_evento),
        cliente_id: r.cliente_id == null ? null : String(r.cliente_id),
        cliente_nombre: propio ? "The High Events" : r.cliente,
        cotizacion_id: sid(r.cotizacion_id),
        cotizacion_codigo: r.cotizacion_id ? codigoCotizacion(r.cotizacion_id) : "",
        responsable_id: sid(r.responsable_id),
        responsable_nombre: r.responsable_id ? r.responsable : "",
        modalidad: modalidad.toFront(r.modalidad),
        nombre: r.nombre_evento,
        direccion: r.ubicacion_evento,
        hora_inicio: dtToFront(r.fecha_hora_inicio),
        hora_fin: dtToFront(r.fecha_hora_fin),
        presupuesto_estimado: r.presupuesto_estimado,
        valor_total: r.valor_total ?? undefined,
        estado: estadoEvento.toFront(r.estado),
        fecha_creacion: r.fecha_creacion,
        aforo_esperado: r.aforo_esperado ? String(r.aforo_esperado) : "",
        concepto_evento: r.concepto_evento ?? "",
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
        // Derivados: se preparan al guardar el evento y se gestionan en sus módulos
        documentos: (documentos.get(r.id_evento) ?? []).map(({ evento: _, ...d }) => ({
          ...d,
          estado: (d.tipo === "prestamo" ? estadoPrestamo : estadoRecepcion).toFront(d.estado),
        })),
        avisos: avisos.get(r.id_evento) ?? [],
      }
    })
  },
  async toDb(b, { conn, raw, id, current }) {
    const mod = modalidad.toDb(b.modalidad, "Modalidad")
    // Regla de negocio: un evento para cliente nace de su cotización (Cotizaciones lo crea)
    const eraCliente = current?.modalidad === "Cliente"
    if (mod === "cliente" && !eraCliente)
      throw conflict("Un evento para cliente se crea desde Cotizaciones: primero cotiza y el evento nace de esa cotización")
    if (mod === "propio" && eraCliente) throw conflict("Un evento de cliente no puede pasar a ser propio")
    const est = estadoEvento.toDb(b.estado ?? "Planificación", "Estado")
    // Al leer el estado guardado (raw === current) no se valida: solo lo que llega
    const leyendo = raw === current
    // Un evento de cliente sale de cotización solo con su cotización aceptada
    if (mod === "cliente" && !leyendo && current?.estado === "Cotización" && !["cotizacion", "cancelado"].includes(est)) {
      const [x] = await query("SELECT 1 FROM cotizacion WHERE evento_id = ? AND estado = 'aceptada'", [id], conn)
      if (!x) throw conflict("Para planificar un evento de cliente, primero acepta su cotización")
    }
    // En cotización (o cancelado) la fecha y el lugar pueden faltar; desde la planificación son obligatorios
    const programado = !["cotizacion", "cancelado"].includes(est)
    const inicio = dtToDb(b.hora_inicio, "La fecha y hora de inicio", programado)
    const fin = dtToDb(b.hora_fin, "La fecha y hora de fin", programado)
    if (inicio && fin && fin <= inicio) throw bad("La finalización debe ser posterior al inicio")
    if (Boolean(inicio) !== Boolean(fin)) throw bad("Indique el inicio y el fin del evento")
    // EventoFormPage envía cliente_nombre "Cliente General" aunque el id sea válido: manda el id.
    const cliente_id = mod === "cliente" ? await requireId("cliente", b.cliente_id, null, conn) : null
    // Un evento anterior puede no tener responsable; uno nuevo no, y el que lo tiene no puede perderlo
    const responsable = intOrNull(b.responsable_id)
    if (!responsable && (id === null || current?.responsable_id)) throw bad("El responsable del evento es obligatorio")
    const equipos = new Set<number>()
    for (const e of asArray(b.equiposAsignados, "equiposAsignados")) equipos.add(await requireId("equipo", e, null, conn))
    if (equipos.size && !inicio) throw bad("Defina las fechas del evento antes de asignar equipos")
    const tareas = await leerTareas(b, conn)
    if (tareas.length && !inicio) throw bad("Defina las fechas del evento antes de asignar personal")
    await bloquearEquipos(conn, [...equipos])
    let valor = moneyOrNull(b.valor_total, "El valor del evento")
    // El valor de un evento de cliente es el total de su cotización aceptada: solo Cotizaciones lo cambia
    if (mod === "cliente") {
      const actual = current?.valor_total ?? null
      if (!leyendo && valor !== actual && raw.valor_total !== undefined)
        throw conflict("El valor de un evento de cliente es el de su cotización aceptada: para cambiarlo, devuelve la cotización a borrador, ajusta sus precios y acéptala de nuevo")
      valor = actual
    } else if (id !== null && valor !== null && valor !== current?.valor_total) await exigirValorCubreAbonos(conn, id, valor)
    return {
      cliente_id,
      responsable_id: responsable ? await requireId("empleado", responsable, null, conn) : null,
      modalidad: mod,
      nombre_evento: reqStr(b.nombre, "El nombre del evento"),
      ubicacion_evento: programado ? reqStr(b.direccion, "La ubicación del evento") : strOrNull(b.direccion),
      fecha_hora_inicio: inicio,
      fecha_hora_fin: fin,
      presupuesto_estimado: moneyOrNull(b.presupuesto_estimado, "El presupuesto") ?? 0,
      valor_total: valor,
      estado: est,
      aforo_esperado: aforo(b.aforo_esperado),
      concepto_evento: strOrNull(b.concepto_evento),
      observaciones: strOrNull(b.observaciones),
      $servicios:
        mod === "cliente"
          ? await serviciosDeCliente(conn, id!, await leerServicios(b, raw, conn), !leyendo && (raw.servicios !== undefined || raw.serviciosDetalles !== undefined))
          : await leerServicios(b, raw, conn),
      $equipos: [...equipos].sort((x, y) => x - y),
      $tareas: tareas,
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
    await validarEquipos(ctx)
    if (changed("$tareas")) await guardarTareas(ctx)
    const cambios = {
      fechas: changed("fecha_hora_inicio") || changed("fecha_hora_fin"),
      responsable: changed("responsable_id"),
    }
    if (cambios.fechas || cambios.responsable || changed("$equipos") || changed("estado"))
      await sincronizarDocumentos(conn, id, cambios)
  },
  // Los borradores y las cotizaciones se van con el evento; la reunión de origen se conserva con su cliente.
  async beforeDelete(conn, id) {
    await descartarBorradores(conn, id)
    await exec("DELETE FROM cotizacion WHERE evento_id = ?", [id], conn)
    await exec(
      `UPDATE agendamiento a JOIN evento e ON e.id_evento = a.evento_id
          SET a.cliente_id = e.cliente_id, a.evento_id = NULL WHERE a.evento_id = ?`,
      [id],
      conn,
    )
  },
})
