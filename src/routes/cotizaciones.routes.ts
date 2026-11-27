import { exec, query, type Conn } from "../config/db.js"
import { clienteNombreSql, personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, groupBy, whereIds, type AfterCtx, type Obj, type SaveCtx } from "../utils/resource.js"
import {
  DIA,
  addToDt,
  asArray,
  dateToDb,
  dateToFront,
  enumMap,
  formatCOP,
  intOrNull,
  moneyOrNull,
  moneyReq,
  pad,
  req as reqStr,
  sid,
  str,
  strOrNull,
  timeToDb,
  timeToFront,
} from "../utils/format.js"
import { enlace } from "../utils/validar.js"
import { bad, conflict } from "../utils/http.js"

/**
 * La cotización es solo el documento de la oferta: lo que se cotiza (cliente, nombre, fecha, lugar y
 * aforo) vive en su evento. Crear una cotización crea el evento en estado `cotizacion`; editarla, mientras
 * el evento siga en cotización, actualiza el evento. Su total es la suma del detalle.
 */
const estado = enumMap({
  Borrador: "borrador",
  Enviada: "enviada",
  Aceptada: "aceptada",
  Rechazada: "rechazada",
  Vencida: "vencida",
})

export const codigoCotizacion = (id: number) => `COT-${pad(id)}`

interface Detalle {
  servicio_id: number
  cantidad: number
  precio_unitario: number
  observaciones: string | null
}

/** Fecha única + horas del frontend → DATETIME; si el fin es menor que el inicio, termina al día siguiente. */
function horario(b: Obj) {
  const fecha = dateToDb(b.fecha_evento, "La fecha del evento")
  const ini = timeToDb(b.hora_inicio, "La hora de inicio")
  const fin = timeToDb(b.hora_fin, "La hora de fin")
  if (!fecha) {
    if (ini || fin) throw bad("Indique la fecha del evento para poder guardar las horas")
    return { inicio: null, fin: null }
  }
  if (fin && !ini) throw bad("Indique la hora de inicio del evento")
  const inicio = `${fecha} ${ini ?? "00:00"}:00`
  // Sin hora de fin se reserva el día: el evento siempre tiene un fin posterior al inicio
  let finDt = fin ? `${fecha} ${fin}:00` : addToDt(inicio, DIA - 60_000)
  if (finDt <= inicio) finDt = addToDt(finDt, DIA)
  return { inicio, fin: finDt }
}

const cantidadDe = (v: unknown) => {
  const n = v == null || v === "" ? 1 : intOrNull(v)
  if (!n || n < 1) throw bad("La cantidad de cada servicio debe ser un entero mayor que cero")
  return n
}

const claveDetalles = (list: unknown) =>
  JSON.stringify(
    (Array.isArray(list) ? list : []).map((d: Obj) => [str(d.nombre), Number(d.cantidad ?? 1), Number(d.precio_unitario)]),
  )

/**
 * El formulario edita `servicios` + `montos` y reenvía `detalles` sin tocar: los detalles solo
 * mandan si cambiaron respecto a lo guardado (o si son lo único que llegó).
 */
async function leerDetalles(b: Obj, { conn, current, raw }: SaveCtx): Promise<Detalle[]> {
  const detalles: Obj[] = asArray(b.detalles, "detalles")
  const mandanDetalles = current
    ? raw.detalles !== undefined && claveDetalles(raw.detalles) !== claveDetalles(current.detalles)
    : detalles.length > 0
  const out: Detalle[] = []

  if (mandanDetalles) {
    for (const d of detalles)
      out.push({
        servicio_id: await requireId("servicio", d.servicio_id, d.nombre, conn),
        cantidad: cantidadDe(d.cantidad),
        precio_unitario: moneyReq(d.precio_unitario, "El precio unitario"),
        observaciones: strOrNull(d.observaciones),
      })
  } else {
    const montos = asArray(b.montos, "montos")
    const libres = [...detalles]
    for (const [i, nombre] of asArray(b.servicios, "servicios").entries()) {
      const pos = libres.findIndex((d) => str(d.nombre) === str(nombre))
      const det = pos >= 0 ? libres.splice(pos, 1)[0] : undefined
      const servicio_id = await requireId("servicio", det?.servicio_id, nombre, conn)
      const cantidad = cantidadDe(det?.cantidad)
      const monto = moneyOrNull(montos[i], `El monto de ${str(nombre)}`)
      let precio: number
      if (det && (monto === null || monto === Number(det.precio_unitario) * cantidad)) precio = Number(det.precio_unitario)
      else if (monto !== null) precio = monto / cantidad
      else precio = (await query<{ p: number }>("SELECT precio_base AS p FROM servicio WHERE id_servicio = ?", [servicio_id], conn))[0].p
      out.push({ servicio_id, cantidad, precio_unitario: precio, observaciones: strOrNull(det?.observaciones) })
    }
  }
  if (new Set(out.map((d) => d.servicio_id)).size !== out.length)
    throw bad("La cotización tiene un servicio repetido: use la cantidad en lugar de duplicarlo")
  return out
}

const totalDe = (det: Detalle[]) => Math.round(det.reduce((s, d) => s + d.cantidad * d.precio_unitario, 0) * 100) / 100

/** Datos del evento que el formulario de cotización edita. */
async function datosEvento(b: Obj, conn: Conn) {
  const { inicio, fin } = horario(b)
  const aforo = intOrNull(b.aforo_esperado)
  if (aforo !== null && aforo < 0) throw bad("El aforo no puede ser negativo")
  return {
    cliente_id: await requireId("cliente", b.cliente_id, b.cliente, conn),
    nombre_evento: reqStr(b.nombre_evento, "El nombre del evento"),
    ubicacion_evento: strOrNull(b.direccion),
    fecha_hora_inicio: inicio,
    fecha_hora_fin: fin,
    aforo_esperado: aforo ?? 0,
  }
}

/** El evento cambia desde la cotización solo mientras está en cotización. */
async function guardarEvento(ctx: SaveCtx, b: Obj, responsable: number): Promise<number> {
  const datos = await datosEvento(b, ctx.conn)
  if (ctx.id === null) {
    const r = await exec(
      `INSERT INTO evento (cliente_id, responsable_id, modalidad, nombre_evento, ubicacion_evento, fecha_hora_inicio,
                           fecha_hora_fin, aforo_esperado, estado)
       VALUES (?, ?, 'cliente', ?, ?, ?, ?, ?, 'cotizacion')`,
      [datos.cliente_id, responsable, datos.nombre_evento, datos.ubicacion_evento, datos.fecha_hora_inicio, datos.fecha_hora_fin, datos.aforo_esperado],
      ctx.conn,
    )
    return r.insertId
  }
  const evento = Number(ctx.current!.evento_id)
  const [ev] = await query<Obj>("SELECT * FROM evento WHERE id_evento = ? FOR UPDATE", [evento], ctx.conn)
  const cambia = Object.entries(datos).some(([k, v]) => String(v ?? "") !== String(ev[k] ?? ""))
  if (!cambia) return evento
  if (ev.estado !== "cotizacion")
    throw conflict("El evento ya salió de cotización: cambia su fecha, lugar o datos desde Eventos")
  await exec(
    `UPDATE evento SET cliente_id = ?, nombre_evento = ?, ubicacion_evento = ?, fecha_hora_inicio = ?, fecha_hora_fin = ?,
                       aforo_esperado = ? WHERE id_evento = ?`,
    [datos.cliente_id, datos.nombre_evento, datos.ubicacion_evento, datos.fecha_hora_inicio, datos.fecha_hora_fin, datos.aforo_esperado, evento],
    ctx.conn,
  )
  return evento
}

/**
 * Los servicios del evento de cliente son los de su cotización aceptada. Se conservan el proveedor, el costo
 * y las observaciones que el evento ya tenía; un servicio nuevo llega con el precio base como costo.
 */
export async function serviciosDesdeCotizacion(conn: Conn, evento: number, detalles: { servicio_id: number; cantidad: number }[]) {
  const actuales = await query<{ id_evento_servicio: number; servicio_id: number; cantidad: number }>(
    "SELECT id_evento_servicio, servicio_id, cantidad FROM evento_servicio WHERE evento_id = ?",
    [evento],
    conn,
  )
  const cotizados = new Set(detalles.map((d) => d.servicio_id))
  const sobran = actuales.filter((a) => !cotizados.has(a.servicio_id)).map((a) => a.id_evento_servicio)
  if (sobran.length) await exec("DELETE FROM evento_servicio WHERE id_evento_servicio IN (?)", [sobran], conn)
  for (const d of detalles) {
    const fila = actuales.find((a) => a.servicio_id === d.servicio_id)
    if (fila && fila.cantidad !== d.cantidad)
      await exec("UPDATE evento_servicio SET cantidad = ? WHERE id_evento_servicio = ?", [d.cantidad, fila.id_evento_servicio], conn)
    else if (!fila)
      await exec(
        `INSERT INTO evento_servicio (evento_id, servicio_id, cantidad, costo)
         SELECT ?, id_servicio, ?, precio_base FROM servicio WHERE id_servicio = ?`,
        [evento, d.cantidad, d.servicio_id],
        conn,
      )
  }
}

/** Aceptar fija el valor del evento y le pasa sus servicios; rechazar la única oferta cancela el evento en cotización. */
async function reflejarEstado({ conn, id, db, before, created, changed }: AfterCtx) {
  if (!created && !changed("estado") && !changed("$detalles")) return
  const evento = db.evento_id as number
  const [ev] = await query<{ estado: string; completo: number }>(
    `SELECT estado, fecha_hora_inicio IS NOT NULL AND fecha_hora_fin IS NOT NULL AND ubicacion_evento IS NOT NULL AS completo
       FROM evento WHERE id_evento = ? FOR UPDATE`,
    [evento],
    conn,
  )
  if (db.estado === "aceptada") {
    const [venta] = await query("SELECT 1 FROM venta WHERE evento_id = ? AND estado = 'confirmada'", [evento], conn)
    if (venta) throw conflict("El evento ya tiene una venta: su valor se cambia en Eventos")
    const nuevo = ev.estado === "cotizacion" && ev.completo ? "planificacion" : ev.estado
    await exec("UPDATE evento SET valor_total = ?, estado = ? WHERE id_evento = ?", [totalDe(db.$detalles), nuevo, evento], conn)
    await serviciosDesdeCotizacion(conn, evento, db.$detalles)
    return
  }
  if (!created && before.estado === "aceptada") {
    const [venta] = await query("SELECT 1 FROM venta WHERE evento_id = ? AND estado = 'confirmada'", [evento], conn)
    if (venta) throw conflict("No se puede retirar la aceptación: el evento ya tiene una venta")
    await exec("UPDATE evento SET valor_total = NULL WHERE id_evento = ?", [evento], conn)
  }
  if (["rechazada", "vencida"].includes(db.estado) && ev.estado === "cotizacion") {
    const [abierta] = await query(
      "SELECT 1 FROM cotizacion WHERE evento_id = ? AND id_cotizacion <> ? AND estado IN ('borrador','enviada','aceptada')",
      [evento, id],
      conn,
    )
    if (!abierta) await exec("UPDATE evento SET estado = 'cancelado' WHERE id_evento = ?", [evento], conn)
  }
}

export const cotizacionesRouter = crudRouter({
  table: "cotizacion",
  pk: "id_cotizacion",
  perms: {
    // El formulario de eventos muestra sus cotizaciones
    ver: ["cotizaciones.ver", "eventos.crear", "eventos.editar"],
    crear: ["cotizaciones.crear"],
    editar: ["cotizaciones.editar"],
    estado: ["cotizaciones.estado"],
    eliminar: ["cotizaciones.eliminar"],
  },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("c.id_cotizacion", ids)
    const rows = await query<Obj>(
      `SELECT c.*, e.cliente_id, e.nombre_evento, e.ubicacion_evento, e.fecha_hora_inicio, e.fecha_hora_fin, e.aforo_esperado,
              e.estado AS evento_estado, ${clienteNombreSql("cl")} AS cliente, ${personaSql("em")} AS asesor
         FROM cotizacion c
         JOIN evento e ON e.id_evento = c.evento_id
         LEFT JOIN cliente cl ON cl.id_cliente = e.cliente_id
         JOIN empleado em ON em.id_empleado = c.empleado_id
        ${w.sql} ORDER BY c.id_cotizacion DESC`,
      w.params,
      conn,
    )
    const d = whereIds("d.cotizacion_id", ids)
    const detalles = groupBy(
      await query<Obj & { cotizacion_id: number }>(
        `SELECT d.*, s.nombre FROM cotizacion_detalle d JOIN servicio s ON s.id_servicio = d.servicio_id
          ${d.sql} ORDER BY d.id_cotizacion_detalle`,
        d.params,
        conn,
      ),
      (r) => r.cotizacion_id,
    )
    return rows.map((r) => {
      const det = detalles.get(r.id_cotizacion) ?? []
      const sub = (x: Obj) => x.cantidad * x.precio_unitario
      const total = det.reduce((s, x) => s + sub(x), 0)
      return {
        id: String(r.id_cotizacion),
        codigo: codigoCotizacion(r.id_cotizacion),
        version: r.version,
        evento_id: sid(r.evento_id),
        evento_estado: r.evento_estado,
        cliente: r.cliente,
        cliente_id: sid(r.cliente_id),
        asesor: r.asesor,
        empleado_id: sid(r.empleado_id),
        nombre_evento: r.nombre_evento,
        fecha_evento: dateToFront(r.fecha_hora_inicio),
        direccion: r.ubicacion_evento ?? "",
        hora_inicio: r.fecha_hora_inicio ? timeToFront(r.fecha_hora_inicio) : "",
        hora_fin: r.fecha_hora_fin ? timeToFront(r.fecha_hora_fin) : "",
        aforo_esperado: r.aforo_esperado || undefined,
        fecha: dateToFront(r.fecha_emision),
        fechaVence: dateToFront(r.fecha_vencimiento),
        total: formatCOP(total),
        totalNum: total,
        estado: estado.toFront(r.estado),
        url_documento: r.url_documento ?? undefined,
        notas: r.observaciones ?? "",
        servicios: det.map((x) => x.nombre),
        montos: det.map((x) => formatCOP(sub(x))),
        detalles: det.map((x) => ({
          id: String(x.id_cotizacion_detalle),
          servicio_id: String(x.servicio_id),
          nombre: x.nombre,
          cantidad: x.cantidad,
          precio_unitario: x.precio_unitario,
          subtotal: sub(x),
          observaciones: x.observaciones ?? undefined,
        })),
        items: det.map((x) => ({ nombre: x.nombre, cantidad: x.cantidad, valor_unitario: x.precio_unitario, subtotal: sub(x) })),
      }
    })
  },
  async toDb(b, ctx) {
    const emision = dateToDb(b.fecha, "La fecha de emisión", true)!
    const vence = dateToDb(b.fechaVence, "La fecha de vencimiento", true)!
    if (vence < emision) throw bad("La fecha de vencimiento no puede ser anterior a la de emisión")
    const detalles = await leerDetalles(b, ctx)
    const empleado_id = await requireId("empleado", b.empleado_id, b.asesor, ctx.conn)
    // Al leer el estado anterior no se toca el evento
    const evento_id = ctx.raw === ctx.current ? Number(ctx.current!.evento_id) : await guardarEvento(ctx, b, empleado_id)
    return {
      evento_id,
      empleado_id,
      estado: estado.toDb(b.estado ?? "Borrador", "Estado"),
      observaciones: strOrNull(b.notas),
      url_documento: enlace(b.url_documento, "El documento"),
      fecha_emision: emision,
      fecha_vencimiento: vence,
      $detalles: detalles,
    }
  },
  async afterSave(ctx) {
    const { conn, id, db, created, changed } = ctx
    if (changed("$detalles")) {
      if (!created) await exec("DELETE FROM cotizacion_detalle WHERE cotizacion_id = ?", [id], conn)
      const det: Detalle[] = db.$detalles
      if (det.length)
        await exec(
          "INSERT INTO cotizacion_detalle (cotizacion_id, servicio_id, cantidad, precio_unitario, observaciones) VALUES ?",
          [det.map((d) => [id, d.servicio_id, d.cantidad, d.precio_unitario, d.observaciones])],
          conn,
        )
    }
    await reflejarEstado(ctx)
  },
  // Borrar la única cotización de un evento que no pasó de cotización borra también el evento
  async beforeDelete(conn, id) {
    const [c] = await query<{ evento_id: number; estado: string }>(
      "SELECT evento_id, estado FROM cotizacion WHERE id_cotizacion = ?",
      [id],
      conn,
    )
    if (c?.estado === "aceptada") {
      const [venta] = await query("SELECT 1 FROM venta WHERE evento_id = ? AND estado = 'confirmada'", [c.evento_id], conn)
      if (venta) throw conflict("No se puede eliminar: el evento ya tiene una venta")
    }
    return c?.evento_id
  },
  async afterDelete(conn, _id, evento) {
    if (typeof evento !== "number") return
    const [ev] = await query<{ estado: string; otras: number }>(
      "SELECT estado, (SELECT COUNT(*) FROM cotizacion WHERE evento_id = ?) AS otras FROM evento WHERE id_evento = ?",
      [evento, evento],
      conn,
    )
    if (!ev || Number(ev.otras) > 0 || ev.estado !== "cotizacion") return
    // Las reuniones del evento vuelven a quedar con su cliente
    await exec(
      `UPDATE agendamiento a JOIN evento e ON e.id_evento = a.evento_id
          SET a.cliente_id = e.cliente_id, a.evento_id = NULL WHERE a.evento_id = ?`,
      [evento],
      conn,
    )
    await exec("DELETE FROM evento WHERE id_evento = ?", [evento], conn)
  },
})
