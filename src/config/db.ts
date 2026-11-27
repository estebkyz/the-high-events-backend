import mysql from "mysql2/promise"
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { env } from "./env.js"

/**
 * Pool MySQL real. NO existe ningún respaldo en JSON: si la base de datos
 * no está disponible la API responde 503 (ver /api/health).
 */
export const pool: Pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: env.db.pool,
  connectTimeout: 10_000,
  ssl: env.db.ssl,
  decimalNumbers: true, // DECIMAL llega como number, no string
  dateStrings: true, // DATE/DATETIME llegan como texto 'YYYY-MM-DD HH:mm:ss' (sin desfases de zona horaria)
  timezone: "Z",
  charset: "utf8mb4",
})

/**
 * XAMPP/MariaDB trae sql_mode SIN modo estricto: un ENUM inválido se guarda como ''
 * y un texto largo se trunca en silencio. Se fuerza el modo estricto por conexión.
 */
pool.on("connection", (conn) => {
  conn.query(
    "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
  )
  // NOW() y los TIMESTAMP, en la hora del negocio y no en la del servidor
  conn.query(`SET SESSION time_zone = '${env.db.timeZone}'`)
})

export type Row = RowDataPacket
export type Conn = PoolConnection

export async function query<T = Row>(sql: string, params: unknown[] = [], conn?: Conn): Promise<T[]> {
  const [rows] = await (conn ?? pool).query(sql, params)
  return rows as T[]
}

export async function exec(sql: string, params: unknown[] = [], conn?: Conn): Promise<ResultSetHeader> {
  const [res] = await (conn ?? pool).query(sql, params)
  return res as ResultSetHeader
}

/** Ejecuta `fn` dentro de una transacción (commit/rollback automático). */
export async function tx<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const out = await fn(conn)
    await conn.commit()
    return out
  } catch (err) {
    await conn.rollback().catch(() => {}) // conservar el error original si la conexión murió
    throw err
  } finally {
    conn.release()
  }
}
