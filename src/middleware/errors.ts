import type { ErrorRequestHandler, RequestHandler } from "express"
import { ZodError } from "zod"
import { HttpError } from "../utils/http.js"

/** Traduce errores de MySQL a respuestas HTTP seguras (sin filtrar SQL ni estructura interna). */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Ruta no encontrada" })
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ message: err.message })
  if (err instanceof ZodError) {
    const first = err.issues[0]
    return void res.status(400).json({ message: `${first?.path.join(".") || "Datos"}: ${first?.message ?? "inválidos"}` })
  }
  const e = err as { code?: string; errno?: number; type?: string }
  // CHECK violado: 3819 en MySQL 8, 4025 en MariaDB (mysql2 le pone a 4025 el nombre de otro error de MySQL 8)
  if (e.errno === 4025 || e.errno === 3819)
    return void res.status(400).json({ message: "Los datos incumplen una regla de negocio (fechas, montos o campos obligatorios)" })
  switch (e.code) {
    case "ER_DUP_ENTRY":
      return void res.status(409).json({ message: "Ya existe un registro con ese valor único (documento, correo, código o nombre)" })
    case "ER_NO_REFERENCED_ROW_2":
      return void res.status(400).json({ message: "Referencia inválida: el registro relacionado no existe" })
    case "ER_ROW_IS_REFERENCED_2":
      return void res.status(409).json({ message: "No se puede eliminar: el registro tiene información asociada. Inactívelo en su lugar." })
    case "ER_BAD_NULL_ERROR":
    case "ER_TRUNCATED_WRONG_VALUE":
    case "ER_DATA_TOO_LONG":
    case "WARN_DATA_TRUNCATED":
    case "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD":
    case "ER_WARN_DATA_OUT_OF_RANGE":
    case "ER_NO_DEFAULT_FOR_FIELD":
      return void res.status(400).json({ message: "Algún campo es obligatorio, demasiado largo o tiene un valor no permitido" })
    case "ER_LOCK_DEADLOCK":
    case "ER_LOCK_WAIT_TIMEOUT":
      return void res.status(409).json({ message: "Otro usuario está modificando estos datos. Intente de nuevo." })
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "ETIMEDOUT":
    case "ENOTFOUND":
    case "ER_CON_COUNT_ERROR":
    case "ER_ACCESS_DENIED_ERROR":
    case "ER_BAD_DB_ERROR":
    case "PROTOCOL_CONNECTION_LOST":
      return void res.status(503).json({ message: "Base de datos no disponible" })
  }
  if ((err as { type?: string }).type === "entity.parse.failed")
    return void res.status(400).json({ message: "JSON inválido" })
  if (e.type === "encoding.unsupported" || e.type === "charset.unsupported")
    return void res.status(415).json({ message: "Formato de solicitud no admitido" })
  if (e.type === "entity.too.large") return void res.status(413).json({ message: "La solicitud es demasiado grande" })
  console.error(`[error] ${req.method} ${req.path}`, err)
  res.status(500).json({ message: "Error interno del servidor" })
}
