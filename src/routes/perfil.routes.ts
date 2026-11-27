import { Router } from "express"
import bcrypt from "bcryptjs"
import { exec, query, tx, type Conn } from "../config/db.js"
import { signToken } from "../middleware/auth.js"
import { passwordSchema } from "../utils/password.js"
import { validar, validarDocumento } from "../utils/validar.js"
import { enumMap, req as reqStr, str, strOrNull } from "../utils/format.js"
import { bad, HttpError, wrap } from "../utils/http.js"
import { perfilDeSesion } from "./auth.routes.js"

/**
 * Mi perfil: cualquier persona con sesión ve y cambia sus propios datos, sin privilegios del módulo
 * Usuarios. El rol y el estado de la cuenta no se cambian aquí (eso es del administrador).
 * Cambiar el correo o la contraseña exige la contraseña actual.
 */
export const perfilRouter = Router()

const tipoDoc = enumMap({ CC: "CC", CE: "CE", NIT: "NIT", PASAPORTE: "PASAPORTE" })

interface Fila {
  tipo_documento: string
  numero_documento: string
  nombre: string
  apellido: string
  correo: string
  telefono: string | null
  contrasena_hash: string
  sesion_acceso: string | null
  fecha_creacion: string
  rol: string
}

async function leer(id: number, conn?: Conn) {
  const [u] = await query<Fila>(
    `SELECT u.tipo_documento, u.numero_documento, u.nombre, u.apellido, u.correo, u.telefono, u.contrasena_hash,
            u.sesion_acceso, u.fecha_creacion, r.nombre AS rol
       FROM usuario u JOIN rol r ON r.id_rol = u.rol_id WHERE u.id_usuario = ?`,
    [id],
    conn,
  )
  return u
}

const aFront = (u: Fila) => ({
  tipo_documento: u.tipo_documento,
  numero_documento: u.numero_documento,
  nombre: u.nombre,
  apellido: u.apellido,
  correo: u.correo,
  telefono: u.telefono ?? "",
  rol: u.rol,
  ultimoAcceso: u.sesion_acceso ? u.sesion_acceso.slice(0, 16) : "",
  fecha_creacion: u.fecha_creacion,
})

perfilRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(aFront(await leer(req.user!.id)))
  }),
)

perfilRouter.put(
  "/",
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const id = req.user!.id
    const out = await tx(async (conn) => {
      const actual = await leer(id, conn)
      const tipo = tipoDoc.toDb(b.tipo_documento ?? actual.tipo_documento, "Tipo de documento")
      validar(b, actual, { correo: ["correo", "El correo"], telefono: ["telefono", "El teléfono"] })
      validarDocumento(b, actual, "numero_documento", tipo)
      const datos = {
        tipo_documento: tipo,
        numero_documento: reqStr(b.numero_documento ?? actual.numero_documento, "El número de documento"),
        nombre: reqStr(b.nombre ?? actual.nombre, "El nombre"),
        apellido: reqStr(b.apellido ?? actual.apellido, "El apellido"),
        correo: reqStr(b.correo ?? actual.correo, "El correo"),
        telefono: b.telefono === undefined ? actual.telefono : strOrNull(b.telefono),
      }
      if (datos.nombre.length > 50 || datos.apellido.length > 50) throw bad("El nombre y el apellido admiten máximo 50 caracteres")
      const nueva = str(b.contrasena_nueva)
      const cambiaCorreo = datos.correo.toLowerCase() !== actual.correo.toLowerCase()
      if (nueva || cambiaCorreo) {
        const vigente = str(b.contrasena_actual)
        if (!vigente || !(await bcrypt.compare(vigente, actual.contrasena_hash)))
          throw new HttpError(403, "La contraseña actual no es correcta")
      }
      let hash = actual.contrasena_hash
      if (nueva) {
        const parsed = passwordSchema.safeParse(nueva)
        if (!parsed.success) throw bad(`La contraseña ${parsed.error.issues[0].message}`)
        if (await bcrypt.compare(parsed.data, actual.contrasena_hash)) throw bad("La contraseña nueva debe ser distinta de la actual")
        hash = await bcrypt.hash(parsed.data, 12)
      }
      await exec(
        `UPDATE usuario SET tipo_documento = ?, numero_documento = ?, nombre = ?, apellido = ?, correo = ?, telefono = ?,
                            contrasena_hash = ? WHERE id_usuario = ?`,
        [datos.tipo_documento, datos.numero_documento, datos.nombre, datos.apellido, datos.correo, datos.telefono, hash, id],
        conn,
      )
      return { perfil: aFront(await leer(id, conn)), hash: nueva ? hash : null }
    })
    // Cambiar la contraseña cierra las demás sesiones; esta sigue con un token nuevo
    res.json({
      perfil: out.perfil,
      user: await perfilDeSesion(id),
      ...(out.hash && { token: signToken(id, out.hash) }),
    })
  }),
)
