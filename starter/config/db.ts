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
  connectionLimit: 10,
  decimalNumbers: true, // DECIMAL llega como number, no string
  dateStrings: true, // DATE/DATETIME llegan como texto 'YYYY-MM-DD HH:mm:ss' (sin desfases de zona horaria)
  timezone: "Z",
  charset: "utf8mb4",
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
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
