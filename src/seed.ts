import bcrypt from "bcryptjs"
import { exec, pool, query } from "./config/db.js"
import { passwordSchema } from "./utils/password.js"
import "dotenv/config"

/**
 * Crea el usuario administrador (rol 1 de sql/02_seed.sql). Los datos llegan por variables de
 * entorno; si el correo ya existe no toca nada.
 */
const need = (name: string) => {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Falta la variable de entorno ${name}`)
  return v
}

try {
  const correo = need("ADMIN_EMAIL")
  const clave = passwordSchema.min(10, "debe tener al menos 10 caracteres").safeParse(need("ADMIN_PASSWORD"))
  if (!clave.success) throw new Error(`ADMIN_PASSWORD ${clave.error.issues[0].message}`)
  const [rol] = await query("SELECT id_rol FROM rol WHERE id_rol = 1")
  if (!rol) throw new Error("No existe el rol 1: cargue primero sql/02_seed.sql")
  const [existe] = await query("SELECT id_usuario FROM usuario WHERE correo = ?", [correo])
  if (existe) console.log("El administrador ya existe; no se hicieron cambios.")
  else {
    await exec(
      `INSERT INTO usuario (rol_id, tipo_documento, numero_documento, nombre, apellido, correo, contrasena_hash)
       VALUES (1, 'CC', ?, ?, ?, ?, ?)`,
      [
        need("ADMIN_DOCUMENTO"),
        need("ADMIN_NOMBRE"),
        need("ADMIN_APELLIDO"),
        correo,
        await bcrypt.hash(clave.data, 12),
      ],
    )
    console.log("Administrador creado.")
  }
} catch (e) {
  console.error("[seed]", e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
