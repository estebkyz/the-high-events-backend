import { readFileSync } from "node:fs"
import mysql from "mysql2/promise"
import { env } from "./config/env.js"

/**
 * Prepara una base nueva: crea las tablas y los catálogos. Se puede repetir: no borra ni reemplaza registros.
 *  - Alojamiento compartido (alwaysdata…): la base y el usuario ya existen; basta con `DB_*`.
 *  - Servidor propio: con `DB_ADMIN_URL` (mysql://usuario:clave@host:puerto) crea además la base y el
 *    usuario de la aplicación, que solo puede leer y escribir datos.
 */
const CLAVE_MINIMA = 16
const { host, port, name, user, password, ssl } = env.db
const adminUrl = process.env.DB_ADMIN_URL?.trim()

function conexion() {
  const comun = { ssl, multipleStatements: true, charset: "utf8mb4", connectTimeout: 15_000 }
  if (!adminUrl) return mysql.createConnection({ ...comun, host, port, user, password, database: name })
  if (!URL.canParse(adminUrl) || !adminUrl.startsWith("mysql://")) throw new Error("DB_ADMIN_URL no es válida")
  const url = new URL(adminUrl)
  return mysql.createConnection({
    ...comun,
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  })
}

function leerSql(archivo: string): string {
  const sql = readFileSync(new URL(`../sql/${archivo}`, import.meta.url), "utf8")
  if (adminUrl) return sql.replaceAll("the_high_events_db", name)
  // La base la creó el panel y ya se eligió al conectar
  return sql.replace(/CREATE DATABASE[^;]*;/g, "").replace(/^USE [^;]*;/gm, "")
}

async function crearUsuario(conn: mysql.Connection) {
  // Sin marcadores: CREATE USER no admite parámetros preparados en todas las versiones
  const cuenta = `${conn.escape(user)}@'%'`
  await conn.query(`CREATE USER IF NOT EXISTS ${cuenta} IDENTIFIED BY ${conn.escape(password)}`)
  await conn.query(`ALTER USER ${cuenta} IDENTIFIED BY ${conn.escape(password)}`)
  await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${name}\`.* TO ${cuenta}`)
}

const AYUDA: Record<string, string> = {
  HANDSHAKE_NO_SSL_SUPPORT: "El servidor no admite conexión cifrada: use DB_SSL=off",
  ER_ACCESS_DENIED_ERROR: "Usuario o clave incorrectos",
  ER_DBACCESS_DENIED_ERROR: "El usuario no tiene permisos sobre la base: asígnelos en el panel",
  ER_BAD_DB_ERROR: `No existe la base ${name}: créela en el panel`,
  ENOTFOUND: "No se encuentra el servidor: revise DB_HOST",
  ETIMEDOUT: "El servidor no responde: revise DB_HOST, DB_PORT y su conexión",
  ECONNREFUSED: "El servidor rechazó la conexión: revise DB_HOST y DB_PORT",
}

try {
  if (!/^[\w-]+$/.test(name)) throw new Error("DB_NAME solo admite letras, números, guion y guion bajo")
  if (user === "root") throw new Error("DB_USER debe ser un usuario propio de la aplicación, distinto de root")
  if (adminUrl && password.length < CLAVE_MINIMA) throw new Error(`DB_PASSWORD debe tener al menos ${CLAVE_MINIMA} caracteres`)

  const conn = await conexion()
  try {
    for (const archivo of ["01_schema.sql", "02_seed.sql"]) {
      await conn.query(leerSql(archivo))
      console.log(`${archivo}: aplicado en ${name}`)
    }
    if (adminUrl) await crearUsuario(conn)
    const [tablas] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?", [name])
    const [cifrado] = await conn.query("SHOW STATUS LIKE 'Ssl_cipher'")
    const tls = Boolean((cifrado as { Value: string }[])[0]?.Value)
    console.log(`Listo: ${(tablas as { n: number }[])[0].n} tablas. Conexión ${tls ? "cifrada" : "SIN cifrar"}.`)
  } finally {
    await conn.end()
  }
} catch (e) {
  const { code = "", message } = e as Error & { code?: string }
  console.error("[instalar]", AYUDA[code] ?? message)
  process.exitCode = 1
}
