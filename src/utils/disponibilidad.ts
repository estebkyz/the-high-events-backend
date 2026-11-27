import { query, type Conn } from "../config/db.js"
import { FUERA, SIN_DEVOLVER } from "./documentos.js"
import { nowDb } from "./format.js"
import { conflict } from "./http.js"
import { groupBy } from "./resource.js"

/**
 * Disponibilidad de un equipo = estado + fechas.
 *  - Estado: en mantenimiento o de baja nunca está disponible.
 *  - Fechas: lo ocupan los eventos vigentes que lo tienen asignado, los préstamos sin devolver y lo
 *    alquilado sin devolver. Lo que debía volver y no ha vuelto sigue ocupado hasta que regrese.
 */
export interface Rango {
  inicio: string
  fin: string
}
export interface Reserva extends Rango {
  equipo: number
  evento_id: number
  evento: string
  /** `reserva`: asignado a un evento · `salida`: ya está físicamente afuera */
  tipo: "reserva" | "salida"
}
interface Equipo {
  id: number
  nombre: string
  estado: string
}
export interface Disponibilidad {
  id: string
  disponible: boolean
  motivo?: string
  reservas: { evento_id: string; evento: string; inicio: string; fin: string; tipo: Reserva["tipo"] }[]
}

// Un evento en cotización aún no reserva equipos
export const EVENTO_INACTIVO = ["cotizacion", "cancelado", "finalizado", "cerrado_financiero"]
const FUERA_DE_SERVICIO: Record<string, string> = {
  en_mantenimiento: "Está en mantenimiento",
  de_baja: "Está de baja",
}

/** Ocupaciones vigentes después de `desde`. Con `bloquear` lee lo último confirmado (no la instantánea). */
async function cargarReservas(equipos: number[] | null, desde: string, conn?: Conn, bloquear = false) {
  const ahora = nowDb()
  const solo = (col: string) => (equipos ? `AND ${col} IN (?)` : "")
  const args = equipos ? [equipos] : []
  const lock = bloquear ? "LOCK IN SHARE MODE" : ""
  const asignados = await query<Reserva>(
    `SELECT ee.equipo_id AS equipo, ev.id_evento AS evento_id, ev.nombre_evento AS evento, 'reserva' AS tipo,
            ev.fecha_hora_inicio AS inicio, ev.fecha_hora_fin AS fin
       FROM evento_equipo ee JOIN evento ev ON ev.id_evento = ee.evento_id
      WHERE ev.estado NOT IN (?) AND ev.fecha_hora_fin > ? ${solo("ee.equipo_id")} ${lock}`,
    [EVENTO_INACTIVO, desde, ...args],
    conn,
  )
  // Si la devolución es el mismo día en que acaba el evento, se libera al terminar; si no, al final de ese día
  const prestados = await query<Reserva>(
    `SELECT d.equipo_id AS equipo, ev.id_evento AS evento_id, ev.nombre_evento AS evento, 'salida' AS tipo,
            LEAST(p.fecha_salida, ?) AS inicio,
            GREATEST(?, IF(p.fecha_devolucion_estimada IS NULL OR DATE(p.fecha_devolucion_estimada) = DATE(ev.fecha_hora_fin),
                           ev.fecha_hora_fin, CONCAT(DATE(p.fecha_devolucion_estimada), ' 23:59:59'))) AS fin
       FROM prestamo_detalle d JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
       JOIN evento ev ON ev.id_evento = p.evento_id
      WHERE ${FUERA} ${solo("d.equipo_id")} ${lock}`,
    [ahora, ahora, ...args],
    conn,
  )
  const recibidos = await query<Reserva>(
    `SELECT d.equipo_id AS equipo, ev.id_evento AS evento_id, ev.nombre_evento AS evento, 'salida' AS tipo,
            LEAST(ev.fecha_hora_inicio, ?) AS inicio, GREATEST(ev.fecha_hora_fin, ?) AS fin
       FROM recepcion_detalle d JOIN recepcion r ON r.id_recepcion = d.recepcion_id
       JOIN evento ev ON ev.id_evento = r.evento_id
      WHERE ${SIN_DEVOLVER} ${solo("d.equipo_id")} ${lock}`,
    [ahora, ahora, ...args],
    conn,
  )
  return groupBy([...prestados, ...recibidos, ...asignados], (r) => r.equipo)
}

/** `2027-03-20 19:00:00` → `20/03/2027 19:00` */
const fecha = (dt: string) => `${dt.slice(8, 10)}/${dt.slice(5, 7)}/${dt.slice(0, 4)} ${dt.slice(11, 16)}`

function porEstado(equipo: Equipo, reservas: Reserva[]): string | undefined {
  if (FUERA_DE_SERVICIO[equipo.estado]) return FUERA_DE_SERVICIO[equipo.estado]
  if (equipo.estado === "disponible") return undefined
  // Prestado o en evento: si hay una ocupación vigente manda su fecha; si no, se marcó a mano
  const ahora = nowDb()
  return reservas.some((r) => r.inicio <= ahora && r.fin >= ahora)
    ? undefined
    : `Está marcado como ${equipo.estado === "prestado" ? "prestado" : "en evento"} sin una reserva vigente`
}

function porFechas(reservas: Reserva[], rango: Rango, evento: number | null): string | undefined {
  const r = reservas.find((x) => x.evento_id !== evento && x.inicio < rango.fin && x.fin > rango.inicio)
  if (!r) return undefined
  return r.tipo === "salida"
    ? `Está afuera con "${r.evento}" hasta el ${fecha(r.fin)}`
    : `Reservado para "${r.evento}" del ${fecha(r.inicio)} al ${fecha(r.fin)}`
}

/** Estado de todos los equipos en un rango (sin rango: en este momento) y sus reservas futuras. */
export async function consultarDisponibilidad(rango: Rango | null, evento: number | null): Promise<Disponibilidad[]> {
  const ahora = nowDb()
  const r = rango ?? { inicio: ahora, fin: ahora.slice(0, 17) + "59" }
  const equipos = await query<Equipo>("SELECT id_equipo AS id, nombre, estado FROM equipo ORDER BY id_equipo DESC")
  const reservas = await cargarReservas(null, r.inicio < ahora ? r.inicio : ahora)
  return equipos.map((e) => {
    const suyas = reservas.get(e.id) ?? []
    const motivo = porEstado(e, suyas) ?? porFechas(suyas, r, evento)
    return {
      id: String(e.id),
      disponible: !motivo,
      motivo,
      reservas: suyas
        .filter((x) => x.fin >= ahora)
        .sort((x, y) => x.inicio.localeCompare(y.inicio))
        .map((x) => ({ evento_id: String(x.evento_id), evento: x.evento, inicio: fecha(x.inicio), fin: fecha(x.fin), tipo: x.tipo })),
    }
  })
}

/** Bloquea los equipos para que dos usuarios no los reserven a la vez. */
export async function bloquearEquipos(conn: Conn, equipos: number[]) {
  if (equipos.length) await query("SELECT 1 FROM equipo WHERE id_equipo IN (?) ORDER BY id_equipo FOR UPDATE", [equipos], conn)
}

/** Rechaza la operación si algún equipo no está libre en el rango. `conEstado`: también revisa su estado. */
export async function exigirDisponibles(conn: Conn, equipos: number[], rango: Rango, evento: number, conEstado: number[] = []) {
  if (!equipos.length) return
  const ahora = nowDb()
  const reservas = await cargarReservas(equipos, rango.inicio < ahora ? rango.inicio : ahora, conn, true)
  const rows = await query<Equipo>(
    "SELECT id_equipo AS id, nombre, estado FROM equipo WHERE id_equipo IN (?) ORDER BY id_equipo LOCK IN SHARE MODE",
    [equipos],
    conn,
  )
  const motivos = rows.flatMap((e) => {
    const suyas = reservas.get(e.id) ?? []
    const motivo = (conEstado.includes(e.id) ? porEstado(e, suyas) : undefined) ?? porFechas(suyas, rango, evento)
    return motivo ? [`"${e.nombre}": ${motivo}`] : []
  })
  if (motivos.length) throw conflict(`Equipo no disponible. ${motivos.join(". ")}`)
}
