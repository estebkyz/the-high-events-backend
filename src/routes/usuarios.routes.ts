import bcrypt from "bcryptjs"
import { exec, query } from "../config/db.js"
import { requireId } from "../utils/lookup.js"
import { passwordSchema } from "../utils/password.js"
import { crudRouter, groupBy, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import { exigirAdministrador, exigirAlcanceRol } from "../utils/autorizacion.js"
import { validar, validarDocumento } from "../utils/validar.js"
import { activoToDb, enumMap, estadoActivo, joinName, req as reqStr, splitName, str, strOrNull } from "../utils/format.js"
import { bad, conflict, HttpError } from "../utils/http.js"

const tipoDoc = enumMap({ CC: "CC", CE: "CE", NIT: "NIT", PASAPORTE: "PASAPORTE" })

/** Las últimas sesiones por usuario que muestra el detalle */
const MAX_SESIONES = 10

interface SesionRow {
  usuario_id: number
  fecha_hora: string
  ip_address: string | null
  dispositivo: string | null
  tipo_acceso: string
}

export const usuariosRouter = crudRouter({
  table: "usuario",
  pk: "id_usuario",
  perms: stdPerms("usuarios"),
  estadoKeys: ["activo"],
  async load(ids, conn) {
    const w = whereIds("u.id_usuario", ids)
    // Nunca se selecciona contrasena_hash ni reset_token_hash
    const rows = await query<Obj>(
      `SELECT u.id_usuario, u.tipo_documento, u.numero_documento, u.nombre, u.apellido, u.correo, u.telefono,
              u.activo, u.sesion_acceso, u.fecha_creacion, r.nombre AS rol
         FROM usuario u JOIN rol r ON r.id_rol = u.rol_id ${w.sql} ORDER BY u.id_usuario DESC`,
      w.params,
      conn,
    )
    const s = whereIds("usuario_id", ids)
    const sesiones = groupBy(
      await query<SesionRow>(
        `SELECT * FROM (
           SELECT usuario_id, fecha_hora, ip_address, dispositivo, tipo_acceso, id_sesion,
                  ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY id_sesion DESC) AS n
             FROM registro_acceso ${s.sql ? `${s.sql} AND` : "WHERE"} tipo_acceso IN ('login_exitoso','login_fallido')
         ) t WHERE n <= ${MAX_SESIONES} ORDER BY id_sesion DESC`,
        s.params,
        conn,
      ),
      (x) => x.usuario_id,
    )
    return rows.map((r) => ({
      id: String(r.id_usuario),
      tipo_documento: r.tipo_documento,
      numero_documento: r.numero_documento,
      ...splitName(r.nombre, r.apellido),
      correo: r.correo,
      telefono: r.telefono ?? "",
      rol: r.rol,
      ultimoAcceso: r.sesion_acceso ? r.sesion_acceso.slice(0, 16) : "Nunca",
      estado: estadoActivo(r.activo),
      fecha_creacion: r.fecha_creacion,
      sesiones: (sesiones.get(r.id_usuario) ?? []).map((x) => ({
        fecha: x.fecha_hora.slice(0, 16),
        ip: x.ip_address ?? "",
        dispositivo: x.dispositivo ?? "",
        resultado: x.tipo_acceso === "login_exitoso" ? "Exitosa" : "Fallida",
      })),
    }))
  },
  async toDb(b, { conn, actor, id, current, raw }) {
    if (id !== null) {
      const [u] = await query<{ rol_id: number }>("SELECT rol_id FROM usuario WHERE id_usuario = ?", [id], conn)
      // Ni la clave, ni el correo, ni el estado de quien tiene más privilegios
      await exigirAlcanceRol(actor, u.rol_id, conn, "No puede modificar una cuenta con más permisos que la suya")
    }
    const tipo = tipoDoc.toDb(b.tipo_documento ?? "CC", "Tipo de documento")
    validar(b, current, { correo: ["correo", "El correo"], telefono: ["telefono", "El teléfono"] })
    validarDocumento(b, current, "numero_documento", tipo)
    const db: Obj = {
      // `rol` viaja por nombre (es lo que muestra y filtra UsuariosPage)
      rol_id: await requireId("rol", null, b.rol, conn),
      tipo_documento: tipo,
      numero_documento: reqStr(b.numero_documento, "El número de documento"),
      nombre: reqStr(joinName(b.primer_nombre, b.segundo_nombre), "El primer nombre"),
      apellido: reqStr(joinName(b.primer_apellido, b.segundo_apellido), "El primer apellido"),
      correo: reqStr(b.correo, "El correo"),
      telefono: strOrNull(b.telefono),
      activo: activoToDb(b.estado ?? "Activo"),
    }
    // raw === current es la lectura del estado anterior: la contraseña solo cambia si viene en el cuerpo
    const clave = raw === current ? "" : str(b.contrasena)
    if (id === null && !clave) throw bad("La contraseña inicial es obligatoria")
    if (clave) {
      const parsed = passwordSchema.safeParse(b.contrasena)
      if (!parsed.success) throw bad(`La contraseña ${parsed.error.issues[0].message}`)
      db.contrasena_hash = await bcrypt.hash(parsed.data, 12)
    }
    return db
  },
  async afterSave({ conn, actor, id, created, db, changed }) {
    // Restablecer la clave también desbloquea; las sesiones abiertas caducan solas (ver `huella`)
    if (changed("contrasena_hash") && !created)
      await exec("UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id_usuario = ?", [id], conn)
    if (id === actor.id) {
      if (changed("rol_id")) throw new HttpError(403, "No puede cambiar su propio rol")
      if (changed("activo")) throw conflict("No puede inactivar su propia cuenta")
    }
    if (created || changed("rol_id")) await exigirAlcanceRol(actor, db.rol_id, conn, "No puede asignar un rol con más permisos que el suyo")
    if (changed("rol_id") || changed("activo")) await exigirAdministrador(conn)
  },
  async beforeDelete(conn, id, actor) {
    if (id === actor.id) throw conflict("No puede eliminar su propia cuenta")
    const [u] = await query<{ rol_id: number }>("SELECT rol_id FROM usuario WHERE id_usuario = ?", [id], conn)
    if (u) await exigirAlcanceRol(actor, u.rol_id, conn, "No puede eliminar una cuenta con más permisos que la suya")
  },
  afterDelete: exigirAdministrador,
})
