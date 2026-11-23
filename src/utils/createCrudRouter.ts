import { Router } from "express"
import { pool } from "../config/db.js"
import type { ResultSetHeader, RowDataPacket } from "mysql2"

interface TableResourceConfig {
  /** Nombre exacto de la tabla en MySQL Workbench (ej. "proveedor", "empleado", "rol") */
  table: string
  /** Nombre exacto de la llave primaria en MySQL Workbench (ej. "id_proveedor", "id_empleado") */
  primaryKey: string
  /** Transforma la fila de MySQL al objeto que espera el Frontend */
  toFrontend: (row: RowDataPacket) => Record<string, unknown>
  /** Transforma el body enviado por el Frontend a columnas de MySQL { columna: valor } */
  toDatabase: (body: Record<string, any>) => Record<string, unknown>
}

export function createCrudRouter(config: TableResourceConfig) {
  const router = Router()
  const { table, primaryKey, toFrontend, toDatabase } = config

  // GET /api/<recurso>
  router.get("/", async (_req, res) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM \`${table}\` ORDER BY \`${primaryKey}\` DESC`,
      )
      res.json(rows.map(toFrontend))
    } catch (error) {
      res.status(500).json({ message: `Error al listar ${table}`, error })
    }
  })

  // GET /api/<recurso>/:id
  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
        [req.params.id],
      )
      if (!rows.length) {
        res.status(404).json({ message: `Registro no encontrado en ${table}` })
        return
      }
      res.json(toFrontend(rows[0]))
    } catch (error) {
      res.status(500).json({ message: `Error al obtener ${table}`, error })
    }
  })

  // POST /api/<recurso>
  router.post("/", async (req, res) => {
    try {
      const dbPayload = toDatabase(req.body || {})
      const keys = Object.keys(dbPayload)
      const values = Object.values(dbPayload)
      const placeholders = keys.map(() => "?").join(", ")
      const cols = keys.map((k) => `\`${k}\``).join(", ")

      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
        values,
      )

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
        [result.insertId],
      )
      res.status(201).json(toFrontend(rows[0]))
    } catch (error) {
      res.status(500).json({ message: `Error al crear en ${table}`, error })
    }
  })

  // PUT /api/<recurso>/:id
  router.put("/:id", async (req, res) => {
    try {
      const dbPayload = toDatabase(req.body || {})
      const entries = Object.entries(dbPayload).filter(
        ([_, val]) => val !== undefined,
      )
      if (entries.length > 0) {
        const setClause = entries.map(([col]) => `\`${col}\` = ?`).join(", ")
        const values = entries.map(([_, val]) => val)
        await pool.query(
          `UPDATE \`${table}\` SET ${setClause} WHERE \`${primaryKey}\` = ?`,
          [...values, req.params.id],
        )
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
        [req.params.id],
      )
      res.json(rows[0] ? toFrontend(rows[0]) : { id: req.params.id })
    } catch (error) {
      res.status(500).json({ message: `Error al actualizar ${table}`, error })
    }
  })

  // DELETE /api/<recurso>/:id
  router.delete("/:id", async (req, res) => {
    try {
      await pool.query(
        `DELETE FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
        [req.params.id],
      )
      res.json({ ok: true, id: req.params.id })
    } catch (error) {
      res.status(500).json({ message: `Error al eliminar en ${table}`, error })
    }
  })

  return router
}
