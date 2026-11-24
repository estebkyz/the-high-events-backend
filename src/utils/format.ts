import { bad } from "./http.js"

export const pad = (n: number | string, len = 3) => String(n).padStart(len, "0")
export const sid = (n: number | null | undefined) => (n == null ? "" : String(n))

/** Convierte "$ 1.250.000" / "1250000" / 1250000 en número. */
export function money(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v !== "string") return 0
  const digits = v.replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", ".")
  const n = Number(digits)
  return Number.isFinite(n) ? n : 0
}

export const formatCOP = (n: number) => "$ " + Number(n || 0).toLocaleString("es-CO")

export const str = (v: unknown): string => (v == null ? "" : String(v).trim())
export const strOrNull = (v: unknown): string | null => {
  const s = str(v)
  return s === "" ? null : s
}
export function req(v: unknown, label: string): string {
  const s = str(v)
  if (!s) throw bad(`${label}: campo obligatorio`)
  return s
}
export const intOrNull = (v: unknown): number | null => {
  if (v === "" || v == null) return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}

/** Mapa bidireccional etiqueta-frontend <-> valor-BD. */
export function enumMap<T extends string>(pairs: Record<string, T>) {
  const toDb = (front: unknown, label = "valor"): T => {
    const key = str(front)
    const hit = pairs[key] ?? (Object.values(pairs) as string[]).find((v) => v === key.toLowerCase())
    if (!hit) throw bad(`${label} inválido: "${key}"`)
    return hit as T
  }
  const toFront = (db: string): string =>
    Object.entries(pairs).find(([, v]) => v === db)?.[0] ?? db
  return { toDb, toFront }
}

export const estadoActivo = (v: unknown): "Activo" | "Inactivo" =>
  v === 1 || v === true || v === "1" || v === "Activo" ? "Activo" : "Inactivo"
export const activoToDb = (v: unknown): number =>
  v === "Activo" || v === true || v === 1 || v === "1" ? 1 : 0

export function splitName(nombre?: string | null, apellido?: string | null) {
  const n = str(nombre).split(/\s+/).filter(Boolean)
  const a = str(apellido).split(/\s+/).filter(Boolean)
  return {
    primer_nombre: n[0] ?? "",
    segundo_nombre: n.slice(1).join(" "),
    primer_apellido: a[0] ?? "",
    segundo_apellido: a.slice(1).join(" "),
  }
}
export const joinName = (...p: unknown[]) => p.map(str).filter(Boolean).join(" ")

/** 'YYYY-MM-DD HH:mm:ss' -> 'YYYY-MM-DDTHH:mm' (formato de <input datetime-local>) */
export const dtToFront = (s?: string | null) => (s ? s.slice(0, 16).replace(" ", "T") : "")
export const dateToFront = (s?: string | null) => (s ? s.slice(0, 10) : "")
export const timeToFront = (s?: string | null) => (s ? s.slice(11, 16) : "")

/** 'YYYY-MM-DDTHH:mm' -> 'YYYY-MM-DD HH:mm:00' (o null) */
export function dtToDb(v: unknown, label: string, requiredField = false): string | null {
  const s = str(v)
  if (!s) {
    if (requiredField) throw bad(`${label} es obligatorio`)
    return null
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/)
  if (!m) throw bad(`${label} no tiene un formato de fecha y hora válido`)
  return `${m[1]} ${m[2]}:00`
}
export function dateToDb(v: unknown, label: string, requiredField = false): string | null {
  const s = str(v)
  if (!s) {
    if (requiredField) throw bad(`${label} es obligatoria`)
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw bad(`${label} no tiene un formato de fecha válido`)
  return s.slice(0, 10)
}

/** Dinero opcional: null si viene vacío; rechaza textos sin dígitos y negativos. */
export function moneyOrNull(v: unknown, label: string): number | null {
  if (v === "" || v == null) return null
  if (typeof v === "string" ? !/\d/.test(v) : typeof v !== "number" || !Number.isFinite(v))
    throw bad(`${label} no es un valor numérico válido`)
  const n = money(v)
  if (n < 0) throw bad(`${label} no puede ser negativo`)
  return n
}
export function moneyReq(v: unknown, label: string): number {
  const n = moneyOrNull(v, label)
  if (n == null) throw bad(`${label}: campo obligatorio`)
  return n
}

export const HORA = 3_600_000
export const DIA = 24 * HORA
/** Suma milisegundos a 'YYYY-MM-DD HH:mm:ss' sin depender de la zona horaria. */
export function addToDt(dt: string, ms: number): string {
  const t = Date.parse(dt.replace(" ", "T") + "Z")
  if (Number.isNaN(t)) throw bad("Fecha u hora inválida")
  return new Date(t + ms).toISOString().slice(0, 19).replace("T", " ")
}
/** Ahora en hora local del servidor, formato MySQL. */
export function nowDb(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace("T", " ")
}
export function timeToDb(v: unknown, label: string): string | null {
  const s = str(v)
  if (!s) return null
  if (!/^([01]\d|2[0-3]):[0-5]\d/.test(s)) throw bad(`${label} no tiene un formato de hora válido`)
  return s.slice(0, 5)
}
export function asArray(v: unknown, label: string): any[] {
  if (v == null) return []
  if (!Array.isArray(v)) throw bad(`${label} debe ser una lista`)
  return v
}
