import { exec, query, type Conn } from "../config/db.js"
import { nowDb, pad } from "./format.js"
import { conflict } from "./http.js"
import { groupBy, whereIds } from "./resource.js"

/**
 * Documentos de un evento: el préstamo de sus equipos propios y las recepciones (una interna para
 * lo propio y una por proveedor para lo alquilado).
 *
 * Regla de cobertura: el borrador automático contiene los equipos asignados que todavía no estén en
 * otro documento vigente. Por eso editar el evento actualiza el borrador y nunca toca lo confirmado.
 */

export const codigoPrestamo = (id: number) => `PR-${pad(id)}`
export const codigoRecepcion = (id: number) => `RCP-${pad(id)}`

const CONFIRMADA = ["conforme", "con_novedades", "cerrada"]
export const recepcionConfirmada = (estado: unknown) => CONFIRMADA.includes(String(estado))

/** Línea de préstamo con el equipo todavía fuera de bodega. */
export const FUERA = "p.estado IN ('activo','con_retraso') AND p.fecha_devolucion IS NULL AND d.estado_retorno IS NULL"
/**
 * Una entrega por evento y origen: la devolución de un montaje es la recepción de desmontaje del mismo
 * evento y el mismo proveedor (o de los equipos propios, con proveedor vacío).
 */
export const DEVOLUCION_DE = (v: string, r: string) =>
  `${v}.evento_id = ${r}.evento_id AND ${v}.proveedor_id <=> ${r}.proveedor_id AND ${v}.tipo_recepcion = 'recepcion_desmontaje'`
const VIGENTE = "estado_recepcion <> 'anulada'"

/** Montaje confirmado de un proveedor (`r`) cuya devolución aún no se confirma. */
export const SIN_DEVOLVER = `r.tipo_recepcion = 'recepcion_montaje' AND r.proveedor_id IS NOT NULL
  AND r.estado_recepcion IN ('conforme','con_novedades','cerrada')
  AND NOT EXISTS (SELECT 1 FROM recepcion v WHERE ${DEVOLUCION_DE("v", "r")}
                     AND v.estado_recepcion IN ('conforme','con_novedades','cerrada'))`

interface Asignado {
  id: number
  propio: boolean
  proveedor: number | null
}
interface Evento {
  // Un evento en cotización puede no tener fechas: no prepara documentos
  inicio: string
  fin: string
  responsable: number | null
  estado: string
}
export interface CambiosEvento {
  fechas: boolean
  responsable: boolean
}

const dia = (dt: string) => `${dt.slice(0, 10)} 00:00:00`
const ids = (rows: { equipo_id: number }[]) => new Set(rows.map((r) => r.equipo_id))

/** Deja los borradores del evento iguales a sus equipos, fechas y responsable. */
export async function sincronizarDocumentos(conn: Conn, evento: number, cambios: CambiosEvento) {
  const [ev] = await query<Evento>(
    `SELECT fecha_hora_inicio AS inicio, fecha_hora_fin AS fin, responsable_id AS responsable, estado
       FROM evento WHERE id_evento = ?`,
    [evento],
    conn,
  )
  if (!ev) return
  if (ev.estado === "cancelado") {
    await exigirDevolucion(conn, evento)
    await descartarBorradores(conn, evento)
    return
  }
  // Un evento terminado ya no prepara documentos
  if (!ev.responsable || !ev.inicio || ["cotizacion", "finalizado", "cerrado_financiero"].includes(ev.estado)) return

  const asignados = (
    await query<{ id: number; tipo: string; proveedor: number | null }>(
      `SELECT e.id_equipo AS id, e.tipo_propiedad AS tipo, e.proveedor_id AS proveedor
         FROM evento_equipo ee JOIN equipo e ON e.id_equipo = ee.equipo_id
        WHERE ee.evento_id = ? ORDER BY e.id_equipo`,
      [evento],
      conn,
    )
  ).map((e): Asignado => {
    const propio = e.tipo === "propio"
    return { id: e.id, propio, proveedor: propio ? null : e.proveedor }
  })
  await sincronizarPrestamo(conn, evento, ev, asignados, cambios)
  await sincronizarRecepciones(conn, evento, ev, asignados, cambios)
}

async function sincronizarPrestamo(conn: Conn, evento: number, ev: Evento, asignados: Asignado[], cambios: CambiosEvento) {
  const cubiertos = ids(
    await query(
      `SELECT d.equipo_id FROM prestamo_detalle d JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
        WHERE p.evento_id = ? AND NOT (p.automatico = 1 AND p.estado = 'programado')`,
      [evento],
      conn,
    ),
  )
  const equipos = asignados.filter((e) => e.propio && !cubiertos.has(e.id)).map((e) => e.id)
  const [borrador] = await query<{ id: number }>(
    "SELECT id_prestamo_equipo AS id FROM prestamo_equipo WHERE evento_id = ? AND automatico = 1 AND estado = 'programado'",
    [evento],
    conn,
  )
  if (!equipos.length) {
    if (borrador) await exec("DELETE FROM prestamo_equipo WHERE id_prestamo_equipo = ?", [borrador.id], conn)
    return
  }
  let id = borrador?.id
  if (!id) {
    const r = await exec(
      `INSERT INTO prestamo_equipo (evento_id, empleado_id, fecha_salida, fecha_devolucion_estimada, estado, automatico)
       VALUES (?, ?, ?, ?, 'programado', 1)`,
      [evento, ev.responsable, dia(ev.inicio), dia(ev.fin)],
      conn,
    )
    id = r.insertId
  } else {
    if (cambios.fechas)
      await exec(
        "UPDATE prestamo_equipo SET fecha_salida = ?, fecha_devolucion_estimada = ? WHERE id_prestamo_equipo = ?",
        [dia(ev.inicio), dia(ev.fin), id],
        conn,
      )
    if (cambios.responsable)
      await exec("UPDATE prestamo_equipo SET empleado_id = ? WHERE id_prestamo_equipo = ?", [ev.responsable, id], conn)
  }
  await ajustarLineas(conn, "prestamo_detalle", "prestamo_id", id, equipos)
}

async function sincronizarRecepciones(conn: Conn, evento: number, ev: Evento, asignados: Asignado[], cambios: CambiosEvento) {
  const cubiertos = ids(
    await query(
      `SELECT d.equipo_id FROM recepcion_detalle d JOIN recepcion r ON r.id_recepcion = d.recepcion_id
        WHERE r.evento_id = ? AND r.tipo_recepcion = 'recepcion_montaje' AND r.estado_recepcion <> 'anulada'
          AND NOT (r.automatico = 1 AND r.estado_recepcion = 'pendiente')`,
      [evento],
      conn,
    ),
  )
  const borradores = await query<{ id: number; proveedor: number | null }>(
    `SELECT id_recepcion AS id, proveedor_id AS proveedor FROM recepcion
      WHERE evento_id = ? AND automatico = 1 AND estado_recepcion = 'pendiente' AND tipo_recepcion = 'recepcion_montaje'`,
    [evento],
    conn,
  )
  const grupos = new Map<number | null, number[]>(borradores.map((b) => [b.proveedor, []]))
  for (const e of asignados)
    if (!cubiertos.has(e.id)) grupos.set(e.proveedor, [...(grupos.get(e.proveedor) ?? []), e.id])

  for (const [proveedor, equipos] of grupos) {
    const borrador = borradores.find((b) => b.proveedor === proveedor)
    if (!equipos.length) {
      if (borrador) await exec("DELETE FROM recepcion WHERE id_recepcion = ?", [borrador.id], conn)
      continue
    }
    let id = borrador?.id
    if (!id) {
      // Ya hay un acta confirmada de ese origen: no cabe otra entrega (se avisa en el evento)
      const [vigente] = await query(
        `SELECT 1 FROM recepcion WHERE evento_id = ? AND proveedor_id <=> ? AND tipo_recepcion = 'recepcion_montaje' AND ${VIGENTE}`,
        [evento, proveedor],
        conn,
      )
      if (vigente) continue
      const r = await exec(
        `INSERT INTO recepcion (evento_id, proveedor_id, empleado_id, tipo_recepcion, estado_recepcion, automatico, hora_registro)
         VALUES (?, ?, ?, 'recepcion_montaje', 'pendiente', 1, ?)`,
        [evento, proveedor, ev.responsable, dia(ev.inicio)],
        conn,
      )
      id = r.insertId
    } else {
      if (cambios.fechas)
        await exec("UPDATE recepcion SET hora_registro = ? WHERE id_recepcion = ?", [dia(ev.inicio), id], conn)
      if (cambios.responsable)
        await exec("UPDATE recepcion SET empleado_id = ? WHERE id_recepcion = ?", [ev.responsable, id], conn)
    }
    await ajustarLineas(conn, "recepcion_detalle", "recepcion_id", id, equipos)
  }
  // Las devoluciones en borrador siguen al evento
  const pendientes = "evento_id = ? AND automatico = 1 AND estado_recepcion = 'pendiente' AND tipo_recepcion = 'recepcion_desmontaje'"
  if (cambios.fechas) await exec(`UPDATE recepcion SET hora_registro = ? WHERE ${pendientes}`, [dia(ev.fin), evento], conn)
  if (cambios.responsable) await exec(`UPDATE recepcion SET empleado_id = ? WHERE ${pendientes}`, [ev.responsable, evento], conn)
}

/** Agrega y quita equipos sin perder lo que ya se anotó en las líneas que permanecen. */
async function ajustarLineas(conn: Conn, tabla: string, llave: string, id: number, equipos: number[]) {
  await exec(`DELETE FROM ${tabla} WHERE ${llave} = ? AND equipo_id NOT IN (?)`, [id, equipos], conn)
  const actuales = ids(await query(`SELECT equipo_id FROM ${tabla} WHERE ${llave} = ?`, [id], conn))
  const nuevos = equipos.filter((e) => !actuales.has(e))
  if (nuevos.length)
    await exec(`INSERT INTO ${tabla} (${llave}, equipo_id) VALUES ?`, [nuevos.map((e) => [id, e])], conn)
}

export async function descartarBorradores(conn: Conn, evento: number) {
  await exec("DELETE FROM prestamo_equipo WHERE evento_id = ? AND automatico = 1 AND estado = 'programado'", [evento], conn)
  // Primero las devoluciones: apuntan a su montaje
  for (const tipo of ["recepcion_desmontaje", "recepcion_montaje"])
    await exec(
      "DELETE FROM recepcion WHERE evento_id = ? AND automatico = 1 AND estado_recepcion = 'pendiente' AND tipo_recepcion = ?",
      [evento, tipo],
      conn,
    )
}

/** Un evento con equipos afuera no se puede cancelar hasta devolverlos. */
async function exigirDevolucion(conn: Conn, evento: number) {
  const prestamos = await query<{ id: number }>(
    `SELECT DISTINCT p.id_prestamo_equipo AS id FROM prestamo_detalle d
       JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id WHERE p.evento_id = ? AND ${FUERA}`,
    [evento],
    conn,
  )
  const recepciones = await query<{ id: number }>(
    `SELECT r.id_recepcion AS id FROM recepcion r WHERE r.evento_id = ? AND ${SIN_DEVOLVER}`,
    [evento],
    conn,
  )
  const codigos = [...prestamos.map((p) => codigoPrestamo(p.id)), ...recepciones.map((r) => codigoRecepcion(r.id))]
  if (codigos.length)
    throw conflict(`No se puede cancelar el evento: registra primero la devolución de los equipos de ${codigos.join(", ")}`)
}

/** Lo propio no puede llegar al evento sin haber salido de bodega. */
export async function exigirSalida(conn: Conn, evento: number, equipos: number[]) {
  const fuera = ids(
    await query(
      `SELECT d.equipo_id FROM prestamo_detalle d JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
        WHERE p.evento_id = ? AND ${FUERA}`,
      [evento],
      conn,
    ),
  )
  const faltan = equipos.filter((e) => !fuera.has(e))
  if (!faltan.length) return
  const nombres = await query<{ nombre: string }>("SELECT nombre FROM equipo WHERE id_equipo IN (?)", [faltan], conn)
  throw conflict(`Confirma primero la salida en Préstamos de: ${nombres.map((n) => n.nombre).join(", ")}`)
}

async function copiarLineas(conn: Conn, origen: number, destino: number) {
  await exec("DELETE FROM recepcion_detalle WHERE recepcion_id = ?", [destino], conn)
  await exec(
    `INSERT INTO recepcion_detalle (recepcion_id, equipo_id, cantidad_esperada, cantidad_recibida)
     SELECT ?, equipo_id, SUM(cantidad_recibida), SUM(cantidad_recibida) FROM recepcion_detalle
      WHERE recepcion_id = ? GROUP BY equipo_id`,
    [destino, origen],
    conn,
  )
}

/** Al confirmar un montaje queda lista, en borrador, su devolución con lo realmente recibido. */
export async function prepararDevolucion(conn: Conn, montaje: number) {
  const hijas = await query<{ id: number; borrador: number }>(
    `SELECT v.id_recepcion AS id, v.automatico = 1 AND v.estado_recepcion = 'pendiente' AS borrador
       FROM recepcion v JOIN recepcion r ON ${DEVOLUCION_DE("v", "r")}
      WHERE r.id_recepcion = ? AND v.${VIGENTE}`,
    [montaje],
    conn,
  )
  if (hijas.some((h) => !h.borrador)) return
  let id = hijas[0]?.id
  if (!id) {
    const r = await exec(
      `INSERT INTO recepcion (evento_id, proveedor_id, empleado_id, tipo_recepcion, estado_recepcion, automatico, hora_registro)
       SELECT r.evento_id, r.proveedor_id, COALESCE(e.responsable_id, r.empleado_id), 'recepcion_desmontaje',
              'pendiente', 1, CONCAT(DATE(e.fecha_hora_fin), ' 00:00:00')
         FROM recepcion r JOIN evento e ON e.id_evento = r.evento_id WHERE r.id_recepcion = ?`,
      [montaje],
      conn,
    )
    id = r.insertId
  }
  await copiarLineas(conn, montaje, id)
}

/** Borra la devolución en borrador de un montaje; si ya se confirmó, el montaje no puede cambiar. */
export async function retirarDevolucion(conn: Conn, montaje: number) {
  const hijas = await query<{ id: number; borrador: number }>(
    `SELECT v.id_recepcion AS id, v.automatico = 1 AND v.estado_recepcion = 'pendiente' AS borrador
       FROM recepcion v JOIN recepcion r ON ${DEVOLUCION_DE("v", "r")}
      WHERE r.id_recepcion = ? AND v.${VIGENTE}`,
    [montaje],
    conn,
  )
  const firme = hijas.find((h) => !h.borrador)
  if (firme) throw conflict(`Este montaje ya tiene la devolución ${codigoRecepcion(firme.id)}`)
  for (const h of hijas) await exec("DELETE FROM recepcion WHERE id_recepcion = ?", [h.id], conn)
}

/**
 * Antes de registrar un acta a mano: el borrador automático del mismo evento, origen y tipo se
 * reemplaza; si ya hay un acta en firme, no cabe otra entrega.
 */
export async function liberarEntrega(conn: Conn, evento: number, proveedor: number | null, tipo: string) {
  const actas = await query<{ id: number; borrador: number }>(
    `SELECT id_recepcion AS id, automatico = 1 AND estado_recepcion = 'pendiente' AS borrador FROM recepcion
      WHERE evento_id = ? AND proveedor_id <=> ? AND tipo_recepcion = ? AND ${VIGENTE} FOR UPDATE`,
    [evento, proveedor, tipo],
    conn,
  )
  const firme = actas.find((a) => !a.borrador)
  if (firme)
    throw conflict(
      `Este evento ya tiene el acta ${codigoRecepcion(firme.id)} para ese origen: cada proveedor hace una sola entrega por evento`,
    )
  for (const a of actas) await exec("DELETE FROM recepcion WHERE id_recepcion = ?", [a.id], conn)
}

/** Montaje vigente del mismo evento y origen que una devolución. */
export async function montajeDe(conn: Conn, evento: number, proveedor: number | null) {
  const [m] = await query<{ id: number; estado: string }>(
    `SELECT id_recepcion AS id, estado_recepcion AS estado FROM recepcion
      WHERE evento_id = ? AND proveedor_id <=> ? AND tipo_recepcion = 'recepcion_montaje' AND ${VIGENTE}`,
    [evento, proveedor],
    conn,
  )
  return m
}

interface Devuelto {
  equipo_id: number
  recibida: number
  estado: string
}

/** La recepción de regreso a bodega cierra el préstamo: equipo por equipo, hasta completar. */
export async function devolverPrestamos(conn: Conn, recepcion: number, evento: number, items: Devuelto[]) {
  const afectados = new Set<number>()
  for (const it of items.filter((i) => i.recibida > 0)) {
    const [linea] = await query<{ id: number; prestamo: number }>(
      `SELECT d.id_prestamo_detalle AS id, d.prestamo_id AS prestamo FROM prestamo_detalle d
         JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
        WHERE p.evento_id = ? AND d.equipo_id = ? AND ${FUERA} FOR UPDATE`,
      [evento, it.equipo_id],
      conn,
    )
    if (!linea) continue
    afectados.add(linea.prestamo)
    await exec("UPDATE prestamo_detalle SET estado_retorno = ? WHERE id_prestamo_detalle = ?", [it.estado, linea.id], conn)
    await exec(
      "UPDATE equipo SET estado = ? WHERE id_equipo = ? AND estado = 'prestado'",
      [it.estado === "mal" ? "en_mantenimiento" : "disponible", it.equipo_id],
      conn,
    )
  }
  for (const id of afectados) {
    const [r] = await query<{ faltan: number; danos: number; estimada: string | null }>(
      `SELECT SUM(d.estado_retorno IS NULL) AS faltan, SUM(COALESCE(d.estado_retorno, '') = 'mal') AS danos,
              MAX(p.fecha_devolucion_estimada) AS estimada
         FROM prestamo_detalle d JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id WHERE d.prestamo_id = ?`,
      [id],
      conn,
    )
    if (Number(r.faltan) > 0) continue
    const ahora = nowDb()
    const tarde = r.estimada !== null && ahora.slice(0, 10) > r.estimada.slice(0, 10)
    const estado = Number(r.danos) > 0 ? "con_danos" : tarde ? "con_retraso" : "devuelto"
    await exec(
      `UPDATE prestamo_equipo SET estado = ?, fecha_devolucion = ?, observaciones_devolucion = ? WHERE id_prestamo_equipo = ?`,
      [estado, ahora, `Cerrado con la recepción ${codigoRecepcion(recepcion)}`, id],
      conn,
    )
  }
}

/** Recepción interna vigente que debe cerrar un préstamo, por préstamo. */
export async function recepcionesDePrestamos(prestamos: number[] | null, conn?: Conn): Promise<Map<number, string>> {
  const w = whereIds("p.id_prestamo_equipo", prestamos)
  const rows = await query<{ prestamo: number; id: number }>(
    `SELECT p.id_prestamo_equipo AS prestamo, MAX(r.id_recepcion) AS id
       FROM prestamo_equipo p
       JOIN prestamo_detalle d ON d.prestamo_id = p.id_prestamo_equipo
       JOIN recepcion_detalle rd ON rd.equipo_id = d.equipo_id
       JOIN recepcion r ON r.id_recepcion = rd.recepcion_id AND r.evento_id = p.evento_id
        AND r.proveedor_id IS NULL AND r.estado_recepcion <> 'anulada'
      ${w.sql} GROUP BY p.id_prestamo_equipo`,
    w.params,
    conn,
  )
  return new Map(rows.map((r) => [r.prestamo, codigoRecepcion(r.id)]))
}

export interface Documento {
  tipo: "prestamo" | "recepcion"
  id: string
  codigo: string
  titulo: string
  estado: string
  equipos: number
}

/** Préstamos y recepciones de cada evento (estado en formato de la BD: lo traduce quien llama). */
export async function documentosDe(eventos: number[] | null, conn?: Conn) {
  const p = whereIds("p.evento_id", eventos)
  const r = whereIds("r.evento_id", eventos)
  const prestamos = await query<{ evento: number; id: number; estado: string; equipos: number }>(
    `SELECT p.evento_id AS evento, p.id_prestamo_equipo AS id, p.estado, COUNT(d.equipo_id) AS equipos
       FROM prestamo_equipo p LEFT JOIN prestamo_detalle d ON d.prestamo_id = p.id_prestamo_equipo
      ${p.sql} GROUP BY p.id_prestamo_equipo ORDER BY p.id_prestamo_equipo`,
    p.params,
    conn,
  )
  const recepciones = await query<{ evento: number; id: number; estado: string; tipo: string; proveedor: string | null; equipos: number }>(
    `SELECT r.evento_id AS evento, r.id_recepcion AS id, r.estado_recepcion AS estado, r.tipo_recepcion AS tipo,
            MAX(pr.razon_social) AS proveedor, COUNT(d.equipo_id) AS equipos
       FROM recepcion r LEFT JOIN proveedor pr ON pr.id_proveedor = r.proveedor_id
       LEFT JOIN recepcion_detalle d ON d.recepcion_id = r.id_recepcion
      ${r.sql} GROUP BY r.id_recepcion ORDER BY r.id_recepcion`,
    r.params,
    conn,
  )
  const lista = [
    ...prestamos.map((x) => ({
      evento: x.evento,
      tipo: "prestamo" as const,
      id: String(x.id),
      codigo: codigoPrestamo(x.id),
      titulo: "Préstamo de equipos propios",
      estado: x.estado,
      equipos: Number(x.equipos),
    })),
    ...recepciones.map((x) => ({
      evento: x.evento,
      tipo: "recepcion" as const,
      id: String(x.id),
      codigo: codigoRecepcion(x.id),
      titulo: `${x.tipo === "recepcion_montaje" ? "Llegada al evento" : x.proveedor ? "Devolución" : "Regreso a bodega"} · ${x.proveedor ?? "Equipos propios"}`,
      estado: x.estado,
      equipos: Number(x.equipos),
    })),
  ]
  return groupBy(lista, (d) => d.evento)
}

/** Diferencias entre el evento y lo ya confirmado, que no se modifica solo. */
export async function avisosDe(eventos: number[] | null, conn?: Conn): Promise<Map<number, string[]>> {
  const filtro = (col: string) => {
    const w = whereIds(col, eventos)
    return { sql: w.sql ? `${w.sql} AND` : "WHERE", params: w.params }
  }
  const p = filtro("p.evento_id")
  const r = filtro("r.evento_id")
  const salieron = await query<{ evento: number; id: number; nombre: string }>(
    `SELECT p.evento_id AS evento, p.id_prestamo_equipo AS id, e.nombre
       FROM prestamo_detalle d JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
       JOIN equipo e ON e.id_equipo = d.equipo_id
       LEFT JOIN evento_equipo ee ON ee.evento_id = p.evento_id AND ee.equipo_id = d.equipo_id
      ${p.sql} ${FUERA} AND ee.equipo_id IS NULL`,
    p.params,
    conn,
  )
  const recibidos = await query<{ evento: number; id: number; nombre: string }>(
    `SELECT r.evento_id AS evento, r.id_recepcion AS id, e.nombre
       FROM recepcion_detalle d JOIN recepcion r ON r.id_recepcion = d.recepcion_id
       JOIN equipo e ON e.id_equipo = d.equipo_id
       LEFT JOIN evento_equipo ee ON ee.evento_id = r.evento_id AND ee.equipo_id = d.equipo_id
      ${r.sql} ${SIN_DEVOLVER} AND ee.equipo_id IS NULL`,
    r.params,
    conn,
  )
  const fechas = await query<{ evento: number; id: number; estimada: string }>(
    `SELECT p.evento_id AS evento, p.id_prestamo_equipo AS id, p.fecha_devolucion_estimada AS estimada
       FROM prestamo_equipo p JOIN evento ev ON ev.id_evento = p.evento_id
      ${p.sql} p.automatico = 1 AND p.estado IN ('activo','con_retraso') AND p.fecha_devolucion IS NULL
        AND DATE(p.fecha_devolucion_estimada) <> DATE(ev.fecha_hora_fin)`,
    p.params,
    conn,
  )
  const v = filtro("ev.id_evento")
  const vigente = (a: string) =>
    `${a}.estado NOT IN ('cancelado','finalizado','cerrado_financiero') AND ${a}.fecha_hora_fin > NOW()`
  const fueraDeServicio = await query<{ evento: number; nombre: string; estado: string }>(
    `SELECT ev.id_evento AS evento, e.nombre, e.estado FROM evento ev
       JOIN evento_equipo ee ON ee.evento_id = ev.id_evento JOIN equipo e ON e.id_equipo = ee.equipo_id
      ${v.sql} ${vigente("ev")} AND e.estado IN ('en_mantenimiento','de_baja')`,
    v.params,
    conn,
  )
  const cruces = await query<{ evento: number; nombre: string; otro: string }>(
    `SELECT ev.id_evento AS evento, e.nombre, o.nombre_evento AS otro FROM evento ev
       JOIN evento_equipo ee ON ee.evento_id = ev.id_evento JOIN equipo e ON e.id_equipo = ee.equipo_id
       JOIN evento_equipo oe ON oe.equipo_id = ee.equipo_id AND oe.evento_id <> ev.id_evento
       JOIN evento o ON o.id_evento = oe.evento_id
      ${v.sql} ${vigente("ev")} AND ${vigente("o")}
        AND o.fecha_hora_inicio < ev.fecha_hora_fin AND o.fecha_hora_fin > ev.fecha_hora_inicio`,
    v.params,
    conn,
  )
  const avisos = [
    ...fueraDeServicio.map((x) => ({
      evento: x.evento,
      texto: `"${x.nombre}" está ${x.estado === "de_baja" ? "de baja" : "en mantenimiento"}: cámbialo por otro equipo`,
    })),
    ...cruces.map((x) => ({
      evento: x.evento,
      texto: `"${x.nombre}" también está asignado a "${x.otro}" en esas fechas`,
    })),
    ...salieron.map((x) => ({
      evento: x.evento,
      texto: `"${x.nombre}" ya salió en ${codigoPrestamo(x.id)} y no está asignado: registra su devolución`,
    })),
    ...recibidos.map((x) => ({
      evento: x.evento,
      texto: `"${x.nombre}" ya se recibió en ${codigoRecepcion(x.id)} y no está asignado: registra su devolución`,
    })),
    ...fechas.map((x) => ({
      evento: x.evento,
      texto: `${codigoPrestamo(x.id)} ya está confirmado y conserva su devolución del ${x.estimada.slice(0, 10)}`,
    })),
  ]
  return new Map([...groupBy(avisos, (a) => a.evento)].map(([k, v]) => [k, v.map((a) => a.texto)]))
}
