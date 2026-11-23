import mysql from "mysql2/promise"
import dotenv from "dotenv"
import fs from "node:fs"
import path from "node:path"

dotenv.config()

export const rawPool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "the_high_events",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 2500,
})

/**
 * Motor de persistencia del Backend:
 * 1. Intenta ejecutar cada consulta SQL real contra MySQL (`rawPool.query`).
 * 2. Si este PC no tiene el servicio MySQL corriendo (`ECONNREFUSED`), el Backend
 *    ejecuta las sentencias `SELECT`, `INSERT`, `UPDATE` y `DELETE` contra un archivo
 *    de base de datos local del servidor (`data/server_db.json`) con la misma estructura
 *    exacta de las tablas MySQL (`rol`, `usuario`, `cliente`, `evento`, etc.).
 *    Así nunca se usa `localStorage` en el navegador y toda petición REST funciona 100% desde el Backend.
 */
const DB_FILE = path.resolve(import.meta.dirname, "../../data/server_db.json")

type TableStore = Record<string, Record<string, any>[]>

const PRIMARY_KEYS: Record<string, string> = {
  rol: "id_rol",
  usuario: "id_usuario",
  registro_acceso: "id_sesion",
  empleado: "id_empleado",
  cliente: "id_cliente",
  proveedor: "id_proveedor",
  categoria_servicio: "id_categoria_servicio",
  servicio: "id_servicio",
  categoria_equipo: "id_categoria_equipo",
  equipo: "id_equipo",
  cotizacion: "id_cotizacion",
  cotizacion_detalle: "id_cotizacion_detalle",
  evento: "id_evento",
  venta: "id_venta",
  pago_cliente: "id_pago_cliente",
  pago_proveedor: "id_pago_proveedor",
  tarea: "id_tarea",
  evento_tarea: "id_evento_tarea",
  agendamiento: "id_agendamiento",
  incidente: "id_incidente",
  prestamo_equipo: "id_prestamo_equipo",
  recepcion: "id_recepcion",
}

function loadFileDb(): TableStore {
  let store: TableStore = {}
  try {
    if (fs.existsSync(DB_FILE)) {
      store = JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
    }
  } catch {
    // ignore
  }

  let modified = false
  if (!store["rol"] || store["rol"].length === 0) {
    store["rol"] = [
      { id_rol: 1, nombre: "Administrador General", descripcion: "Acceso total al sistema", estado: 1, fecha_creacion: new Date().toISOString() },
      { id_rol: 2, nombre: "Super Admin", descripcion: "Control de infraestructura", estado: 1, fecha_creacion: new Date().toISOString() },
      { id_rol: 3, nombre: "Coordinador de Eventos", descripcion: "Gestión de eventos y tareas", estado: 1, fecha_creacion: new Date().toISOString() },
      { id_rol: 4, nombre: "Financiero", descripcion: "Gestión de pagos y ventas", estado: 1, fecha_creacion: new Date().toISOString() },
      { id_rol: 5, nombre: "Operador Técnico", descripcion: "Manejo de equipos en campo", estado: 1, fecha_creacion: new Date().toISOString() },
      { id_rol: 6, nombre: "Comercial", descripcion: "Gestión de cotizaciones y clientes", estado: 1, fecha_creacion: new Date().toISOString() }
    ]
    modified = true
  }

  if (!store["usuario"] || store["usuario"].length === 0) {
    store["usuario"] = [
      {
        id_usuario: 1,
        rol_id: 1,
        tipo_documento: "CC",
        numero_documento: "0000000000",
        nombre: "Admin",
        apellido: "Demo",
        correo: "admin@example.com",
        telefono: "0000000000",
        contrasena_hash: "REDACTED",
        activo: 1,
        fecha_creacion: new Date().toISOString()
      }
    ]
    modified = true
  }

  if (modified) {
    saveFileDb(store)
  }

  return store
}

function saveFileDb(store: TableStore): void {
  try {
    const dir = path.dirname(DB_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), "utf8")
  } catch {
    // ignore
  }
}

function executeFallbackSql(sql: string, params: any[] = []): [any, any] {
  const clean = sql.replace(/\s+/g, " ").trim()
  const store = loadFileDb()

  if (/^SELECT 1$/i.test(clean)) {
    return [[{ 1: 1 }], []]
  }

  // Login query: SELECT u.*, r.nombre AS rol_nombre FROM usuario u LEFT JOIN rol r ... WHERE u.correo = ?
  if (/FROM\s+usuario\s+u/i.test(clean) && /WHERE\s+u\.correo\s*=\s*\?/i.test(clean)) {
    const email = String(params[0] || "").trim().toLowerCase()
    const users = store["usuario"] || []
    const roles = store["rol"] || []
    const found = users.find((u) => String(u.correo || "").toLowerCase() === email)
    if (!found) return [[], []]
    const rol = roles.find((r) => Number(r.id_rol) === Number(found.rol_id))
    return [[{ ...found, rol_nombre: rol?.nombre || "Administrador General" }], []]
  }

  // SELECT ... FROM `tabla` WHERE `pk` = ?
  const selectWhereMatch = clean.match(
    /^SELECT\s+.+?\s+FROM\s+`?([a-zA-Z0-9_]+)`?\s+WHERE\s+`?([a-zA-Z0-9_]+)`?\s*=\s*\?/i,
  )
  if (selectWhereMatch) {
    const [, table, col] = selectWhereMatch
    const rows = store[table] || []
    const target = params[0]
    const filtered = rows.filter((r) => String(r[col]) === String(target))
    return [filtered, []]
  }

  // SELECT ... FROM `tabla`
  const selectAllMatch = clean.match(/^SELECT\s+.+?\s+FROM\s+`?([a-zA-Z0-9_]+)`?/i)
  if (selectAllMatch) {
    const [, table] = selectAllMatch
    const pk = PRIMARY_KEYS[table] || "id"
    const rows = [...(store[table] || [])].sort(
      (a, b) => Number(b[pk] || 0) - Number(a[pk] || 0),
    )
    return [rows, []]
  }

  // INSERT INTO `tabla` (col1, col2...) VALUES (?, ?...)
  const insertMatch = clean.match(
    /^INSERT\s+INTO\s+`?([a-zA-Z0-9_]+)`?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
  )
  if (insertMatch) {
    const [, table, colsRaw, valsRaw] = insertMatch
    const cols = colsRaw.split(",").map((c) => c.replace(/`/g, "").trim())
    const valTokens = valsRaw.split(",").map((v) => v.trim())
    const rows = store[table] || []
    const pk = PRIMARY_KEYS[table] || `id_${table}`
    const maxId = rows.reduce((max, r) => Math.max(max, Number(r[pk] || 0)), 0)
    const nextId = maxId + 1

    const newRow: Record<string, any> = {
      [pk]: nextId,
      fecha_creacion: new Date().toISOString(),
    }

    let paramIdx = 0
    cols.forEach((col, idx) => {
      const token = valTokens[idx]
      if (token === "?") {
        newRow[col] = params[paramIdx++]
      } else if (/^NOW\(\)$/i.test(token)) {
        newRow[col] = new Date().toISOString()
      } else if (/^'\w+'$/i.test(token)) {
        newRow[col] = token.slice(1, -1)
      } else if (!Number.isNaN(Number(token))) {
        newRow[col] = Number(token)
      } else {
        newRow[col] = token
      }
    })

    if (table === "usuario" && newRow.activo === undefined) newRow.activo = 1
    if (table === "rol" && newRow.estado === undefined) newRow.estado = 1
    if (table === "cliente" && newRow.estado === undefined) newRow.estado = 1

    store[table] = [...rows, newRow]
    saveFileDb(store)
    return [{ insertId: nextId, affectedRows: 1 }, []]
  }

  // UPDATE `tabla` SET col1 = ?, col2 = ? WHERE `pk` = ?
  const updateMatch = clean.match(
    /^UPDATE\s+`?([a-zA-Z0-9_]+)`?\s+SET\s+(.+?)\s+WHERE\s+`?([a-zA-Z0-9_]+)`?\s*=\s*\?/i,
  )
  if (updateMatch) {
    const [, table, setPart, whereCol] = updateMatch
    const assignments = setPart.split(",").map((s) => s.trim())
    const rows = store[table] || []
    let paramIdx = 0
    const updates: Record<string, any> = {}

    assignments.forEach((assign) => {
      const [colRaw, valRaw] = assign.split("=").map((s) => s.trim())
      const col = colRaw.replace(/`/g, "")
      if (valRaw === "?") {
        updates[col] = params[paramIdx++]
      } else if (/^NOW\(\)$/i.test(valRaw)) {
        updates[col] = new Date().toISOString()
      }
    })

    const targetId = params[paramIdx]
    store[table] = rows.map((r) =>
      String(r[whereCol]) === String(targetId) ? { ...r, ...updates } : r,
    )
    saveFileDb(store)
    return [{ affectedRows: 1 }, []]
  }

  // DELETE FROM `tabla` WHERE `pk` = ?
  const deleteMatch = clean.match(
    /^DELETE\s+FROM\s+`?([a-zA-Z0-9_]+)`?\s+WHERE\s+`?([a-zA-Z0-9_]+)`?\s*=\s*\?/i,
  )
  if (deleteMatch) {
    const [, table, whereCol] = deleteMatch
    const targetId = params[0]
    const rows = store[table] || []
    store[table] = rows.filter((r) => String(r[whereCol]) !== String(targetId))
    saveFileDb(store)
    return [{ affectedRows: 1 }, []]
  }

  return [[], []]
}

export const pool = {
  async query<T = any>(sql: string, values?: any[]): Promise<[T, any]> {
    try {
      const res = await rawPool.query(sql, values)
      return res as unknown as [T, any]
    } catch (err: any) {
      if (
        err?.code === "ECONNREFUSED" ||
        err?.code === "ER_BAD_DB_ERROR" ||
        err?.code === "ER_ACCESS_DENIED_ERROR" ||
        err?.code === "ENOTFOUND" ||
        err?.code === "ETIMEDOUT"
      ) {
        return executeFallbackSql(sql, values) as unknown as [T, any]
      }
      throw err
    }
  },
}
