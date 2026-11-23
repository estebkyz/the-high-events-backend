import { Router } from "express"
import { pool } from "../config/db.js"
import type { RowDataPacket } from "mysql2"

export const authRouter = Router()

interface UsuarioAuthRow extends RowDataPacket {
  id_usuario: number
  rol_id: number
  nombre: string
  apellido: string
  correo: string
  contrasena_hash: string
  activo: number
  rol_nombre?: string
}

// POST /api/auth/register — Permite crear el primer usuario/admin desde Thunder Client o Postman
authRouter.post("/register", async (req, res) => {
  try {
    const {
      nombre = "Administrador",
      apellido = "General",
      correo,
      email,
      contrasena,
      password,
      rol_nombre = "Administrador General",
      tipo_documento = "CC",
      numero_documento = "1000000000",
      telefono = null,
    } = req.body || {}

    const finalEmail = (correo || email || "").trim()
    const finalPass = contrasena || password || ""

    if (!finalEmail || !finalPass) {
      res.status(400).json({
        message: "Debes enviar 'correo' (o 'email') y 'contrasena' (o 'password')",
      })
      return
    }

    // 1. Asegurar que exista al menos un rol en la tabla `rol`
    const [roles] = await pool.query<RowDataPacket[]>(
      "SELECT id_rol FROM rol ORDER BY id_rol ASC LIMIT 1",
    )
    let rolId: number
    if (roles.length === 0) {
      const [rolInsert] = await pool.query<any>(
        "INSERT INTO rol (nombre, descripcion, estado) VALUES (?, 'Acceso total al sistema', 1)",
        [rol_nombre],
      )
      rolId = rolInsert.insertId
    } else {
      rolId = roles[0].id_rol
    }

    // 2. Insertar el usuario en la tabla `usuario`
    const [result] = await pool.query<any>(
      `INSERT INTO usuario (
        rol_id, tipo_documento, numero_documento, nombre, apellido,
        correo, telefono, contrasena_hash, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        rolId,
        tipo_documento,
        numero_documento,
        nombre,
        apellido,
        finalEmail,
        telefono,
        finalPass,
      ],
    )

    res.status(201).json({
      message: "Cuenta creada exitosamente",
      user: {
        id: String(result.insertId),
        rol_id: rolId,
        nombre,
        apellido,
        correo: finalEmail,
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Error al registrar la cuenta", error })
  }
})

// POST /api/auth/login
authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      res.status(400).json({ message: "Correo y contraseña requeridos" })
      return
    }

    const [rows] = await pool.query<UsuarioAuthRow[]>(
      `SELECT u.*, r.nombre AS rol_nombre
       FROM usuario u
       LEFT JOIN rol r ON r.id_rol = u.rol_id
       WHERE u.correo = ? LIMIT 1`,
      [String(email).trim()],
    )

    const user = rows[0]
    if (!user) {
      res.status(401).json({ message: "Credenciales inválidas" })
      return
    }

    if (user.activo === 0) {
      res.status(403).json({ message: "La cuenta de usuario está inactiva" })
      return
    }

    if (user.contrasena_hash !== password) {
      await pool
        .query(
          "INSERT INTO registro_acceso (usuario_id, ip_address, tipo_acceso) VALUES (?, ?, 'fallido')",
          [user.id_usuario, req.ip || "127.0.0.1"],
        )
        .catch(() => {})
      res.status(401).json({ message: "Credenciales inválidas" })
      return
    }

    await pool
      .query("UPDATE usuario SET sesion_acceso = NOW() WHERE id_usuario = ?", [
        user.id_usuario,
      ])
      .catch(() => {})

    await pool
      .query(
        "INSERT INTO registro_acceso (usuario_id, ip_address, tipo_acceso) VALUES (?, ?, 'login')",
        [user.id_usuario, req.ip || "127.0.0.1"],
      )
      .catch(() => {})

    const token = Buffer.from(
      `${user.id_usuario}:${user.correo}:${Date.now()}`,
    ).toString("base64")

    res.json({
      token,
      user: {
        id: String(user.id_usuario),
        name: `${user.nombre || ""} ${user.apellido || ""}`.trim(),
        email: user.correo,
        role: user.rol_nombre || String(user.rol_id),
      },
    })
  } catch (error) {
    res.status(500).json({ message: "Error al iniciar sesión", error })
  }
})
