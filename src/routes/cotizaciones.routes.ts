import { exec, query } from "../config/db.js"
import { clienteNombreSql, personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, groupBy, whereIds, type Obj, type SaveCtx } from "../utils/resource.js"
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
import { bad } from "../utils/http.js"

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
  let finDt = fin ? `${fecha} ${fin}:00` : null
  if (finDt && finDt <= inicio) finDt = addToDt(finDt, DIA)
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

export const cotizacionesRouter = crudRouter({
  table: "cotizacion",
  pk: "id_cotizacion",
  perms: {
    crear: ["cotizaciones.crear"],
    editar: ["cotizaciones.editar"],
    estado: ["cotizaciones.estado"],
    eliminar: ["cotizaciones.eliminar"],
  },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("c.id_cotizacion", ids)
    const rows = await query<Obj>(
      `SELECT c.*, ${clienteNombreSql("cl")} AS cliente, ${personaSql("em")} AS asesor
         FROM cotizacion c
         JOIN cliente cl ON cl.id_cliente = c.cliente_id
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
      // Sin hora de fin y a medianoche = solo se registró la fecha
      const soloFecha = !r.fecha_hora_fin && timeToFront(r.fecha_hora_inicio) === "00:00"
      return {
        id: String(r.id_cotizacion),
        codigo: codigoCotizacion(r.id_cotizacion),
        cliente: r.cliente,
        cliente_id: sid(r.cliente_id),
        asesor: r.asesor,
        empleado_id: sid(r.empleado_id),
        nombre_evento: r.nombre_evento,
        fecha_evento: dateToFront(r.fecha_hora_inicio),
        direccion: r.ubicacion_evento ?? "",
        hora_inicio: soloFecha ? "" : timeToFront(r.fecha_hora_inicio),
        hora_fin: timeToFront(r.fecha_hora_fin),
        aforo_esperado: r.aforo_esperado ?? undefined,
        fecha: dateToFront(r.fecha_emision),
        fechaVence: dateToFront(r.fecha_vencimiento),
        total: formatCOP(r.total_cotizado),
        totalNum: r.total_cotizado,
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
        items: det.map((x) => ({
          nombre: x.nombre,
          cantidad: x.cantidad,
          valor_unitario: x.precio_unitario,
          subtotal: sub(x),
        })),
      }
    })
  },
  async toDb(b, ctx) {
    const { inicio, fin } = horario(b)
    const emision = dateToDb(b.fecha, "La fecha de emisión", true)!
    const vence = dateToDb(b.fechaVence, "La fecha de vencimiento", true)!
    if (vence < emision) throw bad("La fecha de vencimiento no puede ser anterior a la de emisión")
    const detalles = await leerDetalles(b, ctx)
    const aforo = intOrNull(b.aforo_esperado)
    return {
      cliente_id: await requireId("cliente", b.cliente_id, b.cliente, ctx.conn),
      empleado_id: await requireId("empleado", b.empleado_id, b.asesor, ctx.conn),
      nombre_evento: reqStr(b.nombre_evento, "El nombre del evento"),
      ubicacion_evento: strOrNull(b.direccion),
      fecha_hora_inicio: inicio,
      fecha_hora_fin: fin,
      estado: estado.toDb(b.estado ?? "Borrador", "Estado"),
      aforo_esperado: aforo,
      // El total se calcula: se ignora `total` / `totalNum` del cuerpo
      total_cotizado: Math.round(detalles.reduce((s, d) => s + d.cantidad * d.precio_unitario, 0) * 100) / 100,
      observaciones: strOrNull(b.notas),
      url_documento: strOrNull(b.url_documento),
      fecha_emision: emision,
      fecha_vencimiento: vence,
      $detalles: detalles,
    }
  },
  async afterSave({ conn, id, db, created, changed }) {
    if (!changed("$detalles")) return
    if (!created) await exec("DELETE FROM cotizacion_detalle WHERE cotizacion_id = ?", [id], conn)
    const det: Detalle[] = db.$detalles
    if (det.length)
      await exec(
        "INSERT INTO cotizacion_detalle (cotizacion_id, servicio_id, cantidad, precio_unitario, observaciones) VALUES ?",
        [det.map((d) => [id, d.servicio_id, d.cantidad, d.precio_unitario, d.observaciones])],
        conn,
      )
  },
})
