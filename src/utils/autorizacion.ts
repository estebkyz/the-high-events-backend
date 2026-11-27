import { query, type Conn } from "../config/db.js"
import { conflict, HttpError } from "./http.js"

/** Quién hace la petición y qué privilegios tiene su rol. */
export interface Actor {
  id: number
  rol: number
  have: Set<string>
}

/** Privilegios guardados de un rol (sin caché y sin importar si está activo). */
export async function codigosDeRol(rolId: number, conn?: Conn): Promise<string[]> {
  const rows = await query<{ codigo: string }>(
    `SELECT p.codigo FROM rol_privilegio rp JOIN privilegio p ON p.id_privilegio = rp.privilegio_id
      WHERE rp.rol_id = ? ORDER BY p.id_privilegio`,
    [rolId],
    conn,
  )
  return rows.map((r) => r.codigo)
}

/** Nadie concede, quita ni administra privilegios que no tiene: impide ascender la propia cuenta. */
export function exigirAlcance(actor: Actor, codigos: Iterable<string>, mensaje: string) {
  for (const c of codigos) if (!actor.have.has(c)) throw new HttpError(403, mensaje)
}

export async function exigirAlcanceRol(actor: Actor, rolId: number, conn: Conn, mensaje: string) {
  exigirAlcance(actor, await codigosDeRol(rolId, conn), mensaje)
}

/** Siempre debe quedar una cuenta activa capaz de administrar usuarios y roles. */
export async function exigirAdministrador(conn: Conn) {
  const [{ n }] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM usuario u JOIN rol r ON r.id_rol = u.rol_id AND r.estado = 1
      WHERE u.activo = 1 AND 2 = (
        SELECT COUNT(*) FROM rol_privilegio rp JOIN privilegio p ON p.id_privilegio = rp.privilegio_id
         WHERE rp.rol_id = r.id_rol AND p.codigo IN ('usuarios.editar', 'config.roles.editar'))`,
    [],
    conn,
  )
  if (!n) throw conflict("Debe quedar al menos un administrador activo")
}
