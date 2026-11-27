import crypto from "node:crypto"
import type { RequestHandler } from "express"
import jwt from "jsonwebtoken"
import { env } from "../config/env.js"
import { HttpError } from "../utils/http.js"
import { query } from "../config/db.js"

export interface AuthUser {
  id: number
  rol: number
  correo: string
}
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser
  }
}

interface TokenPayload {
  id: number
  /** Huella de la contraseña vigente al iniciar sesión */
  v: string
}

/** Cambiar la contraseña cambia la huella: todas las sesiones anteriores dejan de servir. */
const huella = (hash: string) => crypto.createHmac("sha256", env.jwtSecret).update(hash).digest("base64url").slice(0, 22)

export function signToken(id: number, contrasenaHash: string): string {
  const payload: TokenPayload = { id, v: huella(contrasenaHash) }
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions)
}

/** Verifica el token y que la cuenta y su rol sigan activos: el rol se lee de la BD, no del token. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const h = req.headers.authorization
  if (!h?.startsWith("Bearer ")) return next(new HttpError(401, "Sesión no iniciada"))
  let t: TokenPayload
  try {
    t = jwt.verify(h.slice(7), env.jwtSecret, { algorithms: ["HS256"] }) as TokenPayload
  } catch {
    return next(new HttpError(401, "Sesión inválida o expirada"))
  }
  try {
    const [u] = await query<{ rol_id: number; correo: string; contrasena_hash: string }>(
      `SELECT u.rol_id, u.correo, u.contrasena_hash FROM usuario u
         JOIN rol r ON r.id_rol = u.rol_id AND r.estado = 1
        WHERE u.id_usuario = ? AND u.activo = 1`,
      [t.id],
    )
    if (!u || huella(u.contrasena_hash) !== t.v) return next(new HttpError(401, "Sesión inválida o expirada"))
    req.user = { id: t.id, rol: u.rol_id, correo: u.correo }
    next()
  } catch (e) {
    next(e)
  }
}

const cache = new Map<number, { at: number; codes: Set<string> }>()
export function clearPermissionCache(rolId?: number) {
  if (rolId) cache.delete(rolId)
  else cache.clear()
}

export async function privilegesOf(rolId: number): Promise<Set<string>> {
  const hit = cache.get(rolId)
  if (hit && Date.now() - hit.at < 30_000) return hit.codes
  const rows = await query<{ codigo: string }>(
    `SELECT p.codigo FROM rol_privilegio rp
       JOIN privilegio p ON p.id_privilegio = rp.privilegio_id
       JOIN rol r ON r.id_rol = rp.rol_id AND r.estado = 1
      WHERE rp.rol_id = ?`,
    [rolId],
  )
  const codes = new Set(rows.map((r) => r.codigo))
  cache.set(rolId, { at: Date.now(), codes })
  return codes
}

/** Exige al menos uno de los privilegios indicados (p. ej. "clientes.crear"). */
export const requirePrivilege =
  (...codes: string[]): RequestHandler =>
  async (req, _res, next) => {
    try {
      const have = await privilegesOf(req.user!.rol)
      if (codes.some((c) => have.has(c))) return next()
      next(new HttpError(403, "No tiene permiso para realizar esta acción"))
    } catch (e) {
      next(e)
    }
  }
