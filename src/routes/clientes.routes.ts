import { Router } from "express"
import { pool } from "../config/db.js"
import type { ResultSetHeader, RowDataPacket } from "mysql2"

export const clientesRouter = Router()

interface ClienteRow extends RowDataPacket {
  id_cliente: number
  tipo_cliente: "Empresa" | "Natural"
  razon_social: string | null
  nombre: string | null
  apellido: string | null
  contacto_nombre: string | null
  tipo_documento: string
  numero_documento: string
  correo: string | null
  telefono: string | null
  direccion: string | null
  estado: number
  fecha_creacion: string
}

function mapRowToFrontend(row: ClienteRow) {
  const nombres = (row.nombre || "").trim().split(/\s+/)
  const apellidos = (row.apellido || "").trim().split(/\s+/)
  return {
    id: String(row.id_cliente),
    tipo_cliente: row.tipo_cliente,
    razon_social: row.razon_social || "",
    primer_nombre: nombres[0] || "",
    segundo_nombre: nombres.slice(1).join(" ") || "",
    primer_apellido: apellidos[0] || "",
    segundo_apellido: apellidos.slice(1).join(" ") || "",
    contacto_nombre: row.contacto_nombre || "",
    tipo_documento: row.tipo_documento,
    numero_documento: row.numero_documento,
    correo: row.correo || "",
    telefono: row.telefono || "",
    direccion: row.direccion || "",
    ciudad: "",
    estado: row.estado === 1 ? "Activo" : "Inactivo",
    fecha_creacion: row.fecha_creacion,
  }
}

clientesRouter.get("/", async (_req, res) => {
  try {
    const [rows] = await pool.query<ClienteRow[]>(
      "SELECT * FROM cliente ORDER BY id_cliente DESC",
    )
    res.json(rows.map(mapRowToFrontend))
  } catch (error) {
    res.status(500).json({ message: "Error al obtener clientes", error })
  }
})

clientesRouter.post("/", async (req, res) => {
  try {
    const body = req.body
    const nombre = [body.primer_nombre, body.segundo_nombre]
      .filter(Boolean)
      .join(" ")
      .trim()
    const apellido = [body.primer_apellido, body.segundo_apellido]
      .filter(Boolean)
      .join(" ")
      .trim()
    const estadoNum = body.estado === "Inactivo" ? 0 : 1

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO cliente (
        tipo_cliente, razon_social, nombre, apellido, contacto_nombre,
        tipo_documento, numero_documento, correo, telefono, direccion, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.tipo_cliente || "Empresa",
        body.razon_social || null,
        nombre || null,
        apellido || null,
        body.contacto_nombre || null,
        body.tipo_documento || "NIT",
        body.numero_documento,
        body.correo || null,
        body.telefono || null,
        body.direccion || null,
        estadoNum,
      ],
    )

    const [rows] = await pool.query<ClienteRow[]>(
      "SELECT * FROM cliente WHERE id_cliente = ?",
      [result.insertId],
    )
    res.status(201).json(mapRowToFrontend(rows[0]))
  } catch (error) {
    res.status(500).json({ message: "Error al crear cliente", error })
  }
})

clientesRouter.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const body = req.body

    // Si solo viene actualización de estado
    if (Object.keys(body).length === 1 && body.estado !== undefined) {
      const estadoNum = body.estado === "Activo" || body.estado === 1 ? 1 : 0
      await pool.query("UPDATE cliente SET estado = ? WHERE id_cliente = ?", [
        estadoNum,
        id,
      ])
    } else {
      const nombre = [body.primer_nombre, body.segundo_nombre]
        .filter(Boolean)
        .join(" ")
        .trim()
      const apellido = [body.primer_apellido, body.segundo_apellido]
        .filter(Boolean)
        .join(" ")
        .trim()
      const estadoNum = body.estado === "Inactivo" ? 0 : 1

      await pool.query(
        `UPDATE cliente SET
          tipo_cliente = ?, razon_social = ?, nombre = ?, apellido = ?,
          contacto_nombre = ?, tipo_documento = ?, numero_documento = ?,
          correo = ?, telefono = ?, direccion = ?, estado = ?
        WHERE id_cliente = ?`,
        [
          body.tipo_cliente,
          body.razon_social || null,
          nombre || null,
          apellido || null,
          body.contacto_nombre || null,
          body.tipo_documento,
          body.numero_documento,
          body.correo || null,
          body.telefono || null,
          body.direccion || null,
          estadoNum,
          id,
        ],
      )
    }

    const [rows] = await pool.query<ClienteRow[]>(
      "SELECT * FROM cliente WHERE id_cliente = ?",
      [id],
    )
    res.json(mapRowToFrontend(rows[0]))
  } catch (error) {
    res.status(500).json({ message: "Error al actualizar cliente", error })
  }
})

clientesRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params
    await pool.query("DELETE FROM cliente WHERE id_cliente = ?", [id])
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ message: "Error al eliminar cliente", error })
  }
})
