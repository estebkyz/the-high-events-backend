import { str } from "./format.js"
import { bad } from "./http.js"
import type { Obj } from "./resource.js"

/** Formatos que el servidor exige aunque la petición no venga del formulario. */
const CORREO = /^[^\s@<>()",;:\\[\]]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i
const TELEFONO = /^\+?[\d\s().-]+(?:\s*(?:ext|x)\.?\s*\d{1,6})?$/i
const DOCUMENTO: Record<string, RegExp> = {
  CC: /^\d{5,10}$/,
  CE: /^[a-z0-9]{4,15}$/i,
  NIT: /^\d{6,10}(?:-?\d)?$/,
  PASAPORTE: /^[a-z0-9]{5,15}$/i,
}

export const esCorreo = (v: string) => v.length <= 150 && CORREO.test(v) && !v.includes("..")
export const esTelefono = (v: string) => {
  const digitos = v.replace(/\D/g, "").length
  return v.length <= 20 && digitos >= 7 && digitos <= 15 && TELEFONO.test(v)
}
/** Los puntos y espacios de miles no cuentan: "900.123.456-7" es válido. */
export const esDocumento = (tipo: string, v: string) => DOCUMENTO[tipo]?.test(v.replace(/[.\s]/g, "")) ?? false
/** Solo enlaces web o un nombre de archivo: nunca `javascript:` ni `data:`. */
export const esEnlace = (v: string) => v.length <= 255 && (/^https?:\/\/[^\s<>"]+$/i.test(v) || !/[:<>"]/.test(v))

/** Comprobante o referencia de pago: texto libre, salvo un enlace ejecutable. */
export const esReferencia = (v: string) => v.length <= 255 && !/[<>]/.test(v) && !/^\s*(?:javascript|data|vbscript|file):/i.test(v)

const REGLAS = {
  correo: { ok: esCorreo, msg: "no es un correo válido" },
  telefono: { ok: esTelefono, msg: "debe tener entre 7 y 15 dígitos" },
  enlace: { ok: esEnlace, msg: "debe ser un enlace http(s)" },
} as const

/**
 * Valida solo lo que cambia: un registro antiguo con un dato imperfecto se puede seguir usando
 * (cambiar su estado, por ejemplo) sin obligar a corregirlo en ese momento.
 */
export function validar(b: Obj, current: Obj | undefined, campos: Record<string, [keyof typeof REGLAS, string]>) {
  for (const [campo, [regla, etiqueta]] of Object.entries(campos)) {
    const v = str(b[campo])
    if (!v || (current && v === str(current[campo]))) continue
    if (!REGLAS[regla].ok(v)) throw bad(`${etiqueta} ${REGLAS[regla].msg}`)
  }
}

export function validarDocumento(b: Obj, current: Obj | undefined, campo: string, tipo: string) {
  const v = str(b[campo])
  if (!v || (current && v === str(current[campo]) && tipo === (current.tipo_documento ?? tipo))) return
  if (!esDocumento(tipo, v)) throw bad(`El número de documento no es válido para ${tipo}`)
}

export function enlace(v: unknown, etiqueta: string): string | null {
  const s = str(v)
  if (!s) return null
  if (!esEnlace(s)) throw bad(`${etiqueta} debe ser un enlace http(s)`)
  return s
}

export function referencia(v: unknown, etiqueta: string): string | null {
  const s = str(v)
  if (!s) return null
  if (!esReferencia(s)) throw bad(`${etiqueta} no es válido`)
  return s
}
