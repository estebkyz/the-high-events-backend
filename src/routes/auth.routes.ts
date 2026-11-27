import crypto from "node:crypto"
import { Router, type Request } from "express"
import rateLimit from "express-rate-limit"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { env } from "../config/env.js"
import { exec, query } from "../config/db.js"
import { privilegesOf, signToken } from "../middleware/auth.js"
import { HttpError, wrap } from "../utils/http.js"

// Sin recuperación pública: el administrador restablece la contraseña desde Usuarios.
export const authRouter = Router()

authRouter.use(
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Demasiados intentos. Espere unos minutos." },
  }),
)

const loginSchema = z.object({
  email: z.string("es obligatorio").trim().min(1, "es obligatorio").max(150),
  password: z.string("es obligatoria").min(1, "es obligatoria").max(200),
})

interface UsuarioRow {
  id_usuario: number
  rol_id: number
  nombre: string
  apellido: string
  correo: string
  contrasena_hash: string
  activo: number
  intentos_fallidos: number
  bloqueado: number
  rol_nombre: string
  rol_activo: number
}

async function perfil(u: Pick<UsuarioRow, "id_usuario" | "rol_id" | "nombre" | "apellido" | "correo" | "rol_nombre">) {
  return {
    id: String(u.id_usuario),
    name: `${u.nombre} ${u.apellido}`.trim(),
    email: u.correo,
    role: u.rol_nombre,
    permissions: [...(await privilegesOf(u.rol_id))],
  }
}

/** Perfil de sesión (nombre, correo, rol y permisos vigentes) de un usuario. */
export async function perfilDeSesion(id: number) {
  const [u] = await query<UsuarioRow>(
    `SELECT u.id_usuario, u.rol_id, u.nombre, u.apellido, u.correo, r.nombre AS rol_nombre
       FROM usuario u JOIN rol r ON r.id_rol = u.rol_id WHERE u.id_usuario = ?`,
    [id],
  )
  return perfil(u)
}

/** Perfil y permisos vigentes: el frontend los refresca al abrir la aplicación. */
export const sesionHandler = wrap(async (req, res) => {
  res.json(await perfilDeSesion(req.user!.id))
})

type Acceso = "login_exitoso" | "login_fallido"
const registrar = (req: Request, usuarioId: number, tipo: Acceso) =>
  exec("INSERT INTO registro_acceso (usuario_id, ip_address, dispositivo, tipo_acceso) VALUES (?, ?, ?, ?)", [
    usuarioId,
    (req.ip ?? "").slice(0, 45) || null,
    (req.get("user-agent") ?? "").slice(0, 255) || null,
    tipo,
  ])

// Hash de relleno: el tiempo de respuesta no revela si el correo existe.
const dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12)

authRouter.post(
  "/login",
  wrap(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body ?? {})
    const [u] = await query<UsuarioRow>(
      `SELECT u.id_usuario, u.rol_id, u.nombre, u.apellido, u.correo, u.contrasena_hash, u.activo, u.intentos_fallidos,
              (u.bloqueado_hasta IS NOT NULL AND u.bloqueado_hasta > NOW()) AS bloqueado,
              r.nombre AS rol_nombre, r.estado AS rol_activo
         FROM usuario u JOIN rol r ON r.id_rol = u.rol_id
        WHERE u.correo = ?`,
      [email],
    )
    const ok = await bcrypt.compare(password, u?.contrasena_hash ?? dummyHash)
    if (!u) throw new HttpError(401, "Credenciales inválidas")
    if (u.bloqueado) {
      await registrar(req, u.id_usuario, "login_fallido")
      throw new HttpError(423, `Cuenta bloqueada por intentos fallidos. Intente de nuevo en ${env.lockMinutes} minutos.`)
    }
    if (!ok) {
      await registrar(req, u.id_usuario, "login_fallido")
      // Atómico: al llegar al máximo se bloquea y el contador vuelve a 0
      await exec(
        `UPDATE usuario
            SET bloqueado_hasta = IF(intentos_fallidos + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), bloqueado_hasta),
                intentos_fallidos = IF(intentos_fallidos + 1 >= ?, 0, intentos_fallidos + 1)
          WHERE id_usuario = ?`,
        [env.maxLoginAttempts, env.lockMinutes, env.maxLoginAttempts, u.id_usuario],
      )
      throw new HttpError(401, "Credenciales inválidas")
    }
    if (!u.activo) throw new HttpError(403, "La cuenta de usuario está inactiva")
    if (!u.rol_activo) throw new HttpError(403, "El rol asignado a su cuenta está inactivo")

    await exec(
      "UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, sesion_acceso = NOW() WHERE id_usuario = ?",
      [u.id_usuario],
    )
    await registrar(req, u.id_usuario, "login_exitoso")
    const user = await perfil(u)
    res.json({ token: signToken(u.id_usuario, u.contrasena_hash), user, permissions: user.permissions })
  }),
)
