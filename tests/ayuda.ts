import { readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { after, before } from "node:test"
import mysql from "mysql2/promise"

/**
 * Pruebas contra una MariaDB/MySQL real. Se borra y recrea SOLO la base de pruebas: el nombre debe
 * terminar en `_test` y nunca se usan los DB_* del `.env`.
 */
const DB = {
  host: process.env.TEST_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT ?? 3399),
  user: process.env.TEST_DB_USER ?? "root",
  password: process.env.TEST_DB_PASSWORD ?? "",
}
const NOMBRE = process.env.TEST_DB_NAME ?? "the_high_events_test"
if (!/^\w+_test$/.test(NOMBRE)) throw new Error("TEST_DB_NAME debe terminar en _test")

Object.assign(process.env, {
  NODE_ENV: "test",
  DB_HOST: DB.host,
  DB_PORT: String(DB.port),
  DB_USER: DB.user,
  DB_PASSWORD: DB.password,
  DB_NAME: NOMBRE,
  JWT_SECRET: "secreto-solo-para-pruebas-automaticas-0123456789",
  MAX_LOGIN_ATTEMPTS: "5",
  CORS_ORIGINS: "http://localhost:8443",
})

export const CLAVE = "Prueba2026x"
export interface Respuesta {
  status: number
  body: any
  headers: Headers
}

let url = ""
let pool: mysql.Pool
export const sql = async (q: string, p: unknown[] = []) => (await pool.query(q, p))[0] as any

export async function api(metodo: string, ruta: string, token?: string, body?: unknown, crudo?: string): Promise<Respuesta> {
  const r = await fetch(url + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: crudo ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const texto = await r.text()
  return { status: r.status, body: texto ? JSON.parse(texto) : undefined, headers: r.headers }
}

let n = 1000
/** Crea un rol con esos privilegios y un usuario que lo usa; devuelve su id y su token. */
export async function usuarioCon(...codigos: string[]) {
  const { signToken } = await import("../src/middleware/auth.js")
  const bcrypt = (await import("bcryptjs")).default
  const k = ++n
  const rol = (await sql("INSERT INTO rol (nombre) VALUES (?)", [`Rol ${k}`])).insertId as number
  if (codigos.length)
    await sql("INSERT INTO rol_privilegio (rol_id, privilegio_id) SELECT ?, id_privilegio FROM privilegio WHERE codigo IN (?)", [rol, codigos])
  const hash = await bcrypt.hash(CLAVE, 4)
  const correo = `persona${k}@ejemplo.test`
  const id = (
    await sql(
      "INSERT INTO usuario (rol_id, tipo_documento, numero_documento, nombre, apellido, correo, contrasena_hash) VALUES (?, 'CC', ?, 'Persona', ?, ?, ?)",
      [rol, String(10_000_000 + k), `Número ${k}`, correo, hash],
    )
  ).insertId as number
  return { id, rol, correo, token: signToken(id, hash), documento: String(10_000_000 + k) }
}
export type Persona = Awaited<ReturnType<typeof usuarioCon>>

/** Levanta la base y la API para un archivo de pruebas. */
export function entorno(preparar?: () => Promise<void>) {
  let cerrar: () => Promise<void>
  before(async () => {
    const admin = await mysql.createConnection({ ...DB, multipleStatements: true })
    await admin.query(`DROP DATABASE IF EXISTS \`${NOMBRE}\``)
    for (const f of ["01_schema.sql", "02_seed.sql"])
      await admin.query(readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8").replaceAll("the_high_events_db", NOMBRE))
    await admin.end()
    pool = mysql.createPool({ ...DB, database: NOMBRE, decimalNumbers: true, dateStrings: true })
    const { app } = await import("../src/app.js")
    const db = await import("../src/config/db.js")
    const server = app.listen(0, "127.0.0.1")
    await new Promise((ok) => server.once("listening", ok))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
    cerrar = async () => {
      server.closeAllConnections()
      await new Promise((ok) => server.close(ok))
      await db.pool.end()
      await pool.end()
    }
    await preparar?.()
  })
  after(async () => cerrar?.())
}

/** Todos los privilegios del catálogo. */
export async function administrador() {
  const rows = await sql("SELECT codigo FROM privilegio")
  return usuarioCon(...rows.map((r: { codigo: string }) => r.codigo))
}

// ---- datos mínimos -------------------------------------------------------
export const CLIENTE = {
  tipo_cliente: "Natural",
  primer_nombre: "Ana",
  primer_apellido: "Prueba",
  tipo_documento: "CC",
  numero_documento: "52123456",
  correo: "ana@ejemplo.test",
  telefono: "300 123 4567",
  direccion: "Calle 1 # 2-3",
}
export const EMPLEADO = {
  tipo_documento: "CC",
  numero_documento: "71123456",
  primer_nombre: "Luis",
  primer_apellido: "Prueba",
  cargo: "Logística",
  telefono: "3011234567",
}
export const ok = (r: Respuesta, status = 200) => {
  if (r.status !== status) throw new Error(`Se esperaba ${status} y llegó ${r.status}: ${JSON.stringify(r.body)}`)
  return r.body
}
export async function baseEvento(token: string, extra: Record<string, unknown> = {}) {
  const cliente = ok(await api("POST", "/clientes", token, { ...CLIENTE, numero_documento: `52${Date.now() % 1e7}`, correo: `c${++n}@ejemplo.test` }), 201)
  const empleado = ok(await api("POST", "/empleados", token, { ...EMPLEADO, numero_documento: `71${(Date.now() + ++n) % 1e7}` }), 201)
  // El valor del evento de cliente es el total de su cotización aceptada
  const { valor_total: pedido, ...resto } = extra
  const valor = "valor_total" in extra ? (pedido as number | undefined) : 1_000_000
  const servicio = valor
    ? ok(await api("POST", "/servicios", token, { nombre: `Servicio ${++n}`, categoria: "Sonido", tipo_cobro: "por_evento", precioBaseNum: valor }), 201)
    : null
  // El evento de cliente nace de su cotización; luego se completa en Eventos
  const cot = ok(
    await api("POST", "/cotizaciones", token, {
      cliente_id: cliente.id,
      empleado_id: empleado.id,
      nombre_evento: `Evento ${n}`,
      fecha: "2026-11-01",
      fechaVence: "2026-12-01",
      detalles: servicio ? [{ servicio_id: servicio.id, nombre: servicio.nombre, cantidad: 1, precio_unitario: valor }] : [],
    }),
    201,
  )
  // Solo con la cotización aceptada el evento puede planificarse
  ok(await api("PUT", `/cotizaciones/${cot.id}`, token, { estado: "Aceptada" }))
  const nuevo = ok(await api("GET", `/eventos/${cot.evento_id}`, token))
  const evento = ok(
    await api("PUT", `/eventos/${cot.evento_id}`, token, {
      ...nuevo,
      responsable_id: empleado.id,
      direccion: `Salón ${n}`,
      hora_inicio: "2030-05-10T18:00",
      hora_fin: "2030-05-10T23:00",
      presupuesto_estimado: 1_000_000,
      estado: "Planificación",
      ...resto,
    }),
  )
  return { cliente, empleado, evento, cotizacion: cot }
}
