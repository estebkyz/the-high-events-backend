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

export function signToken(u: AuthUser): string {
  return jwt.sign(u, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions)
}

/** Verifica el token y que la cuenta siga activa: el rol se lee de la BD, no del token. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const h = req.headers.authorization
  if (!h?.startsWith("Bearer ")) return next(new HttpError(401, "Sesión no iniciada"))
  let id: number
  try {
    id = (jwt.verify(h.slice(7), env.jwtSecret, { algorithms: ["HS256"] }) as AuthUser).id
  } catch {
    return next(new HttpError(401, "Sesión inválida o expirada"))
  }
  try {
    const [u] = await query<{ rol_id: number; correo: string }>(
      "SELECT rol_id, correo FROM usuario WHERE id_usuario = ? AND activo = 1",
      [id],
    )
    if (!u) return next(new HttpError(401, "Sesión inválida o expirada"))
    req.user = { id, rol: u.rol_id, correo: u.correo }
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
