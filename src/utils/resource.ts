import { Router } from "express"
import { exec, query, tx, type Conn } from "../config/db.js"
import { privilegesOf, requirePrivilege } from "../middleware/auth.js"
import { HttpError, idParam, notFound, wrap } from "./http.js"

export type Obj = Record<string, any>

export interface SaveCtx {
  conn: Conn
  /** null al crear */
  id: number | null
  /** Objeto actual en formato frontend (solo al actualizar) */
  current?: Obj
  /** Cuerpo tal como llegó, antes de combinarlo con el actual */
  raw: Obj
}

export interface AfterCtx {
  conn: Conn
  id: number
  created: boolean
  db: Obj
  before: Obj
  changed: (key: string) => boolean
}

export interface ResourceConfig {
  table: string
  pk: string
  /** `ver` solo en módulos sensibles: los demás los leen formularios de otros módulos como catálogo */
  perms: { ver?: string[]; crear: string[]; editar: string[]; eliminar: string[]; estado?: string[] }
  /** Claves de `toDb` que puede cambiar quien solo tiene el privilegio de estado */
  estadoKeys?: string[]
  /** Objetos en formato frontend; `ids = null` → todos (más recientes primero) */
  load: (ids: number[] | null, conn?: Conn) => Promise<Obj[]>
  /** Valida y traduce a columnas. Las claves que empiezan con `$` son hijos que guarda `afterSave`. */
  toDb: (body: Obj, ctx: SaveCtx) => Promise<Obj>
  afterSave?: (ctx: AfterCtx) => Promise<void>
  beforeDelete?: (conn: Conn, id: number, userId: number) => Promise<void>
  /** Regla extra de autorización al crear */
  canCreate?: (have: Set<string>, db: Obj) => boolean
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** CRUD REST sobre una tabla: ids como texto, transaccional, escribe solo las columnas que cambian. */
export function crudRouter(cfg: ResourceConfig): Router {
  const r = Router()
  const { table, pk } = cfg
  const one = async (id: number, conn?: Conn) => {
    const [row] = await cfg.load([id], conn)
    if (!row) throw notFound()
    return row
  }

  if (cfg.perms.ver) r.get(["/", "/:id"], requirePrivilege(...cfg.perms.ver))

  r.get(
    "/",
    wrap(async (_req, res) => res.json(await cfg.load(null))),
  )
  r.get(
    "/:id",
    wrap(async (req, res) => res.json(await one(idParam(req)))),
  )

  r.post(
    "/",
    requirePrivilege(...cfg.perms.crear),
    wrap(async (req, res) => {
      const raw: Obj = req.body ?? {}
      const have = await privilegesOf(req.user!.rol)
      const saved = await tx(async (conn) => {
        const db = await cfg.toDb(raw, { conn, id: null, raw })
        if (cfg.canCreate && !cfg.canCreate(have, db))
          throw new HttpError(403, "No tiene permiso para realizar esta acción")
        const cols = Object.keys(db).filter((k) => !k.startsWith("$") && db[k] !== undefined)
        const result = await exec(
          `INSERT INTO ${table} (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          cols.map((c) => db[c]),
          conn,
        )
        const id = result.insertId
        await cfg.afterSave?.({ conn, id, created: true, db, before: {}, changed: () => true })
        return one(id, conn)
      })
      res.status(201).json(saved)
    }),
  )

  r.put(
    "/:id",
    requirePrivilege(...cfg.perms.editar, ...(cfg.perms.estado ?? [])),
    wrap(async (req, res) => {
      const id = idParam(req)
      const raw: Obj = req.body ?? {}
      const have = await privilegesOf(req.user!.rol)
      const puedeEditar = cfg.perms.editar.some((c) => have.has(c))
      const saved = await tx(async (conn) => {
        const locked = await query(`SELECT 1 FROM ${table} WHERE ${pk} = ? FOR UPDATE`, [id], conn)
        if (!locked.length) throw notFound()
        const current = await one(id, conn)
        // Con `id` es el objeto completo del frontend (lo ausente se vació); sin `id` es un cambio parcial.
        const body = raw.id !== undefined ? raw : { ...current, ...raw }
        const before = await cfg.toDb(current, { conn, id, current, raw: current }).catch(() => ({}) as Obj)
        const db = await cfg.toDb(body, { conn, id, current, raw })
        const keys = Object.keys(db).filter((k) => db[k] !== undefined && !same(db[k], before[k]))
        if (!puedeEditar && keys.some((k) => !cfg.estadoKeys?.includes(k)))
          throw new HttpError(403, "Solo tiene permiso para cambiar el estado de este registro")
        const cols = keys.filter((k) => !k.startsWith("$"))
        if (cols.length)
          await exec(
            `UPDATE ${table} SET ${cols.map((c) => `\`${c}\` = ?`).join(", ")} WHERE ${pk} = ?`,
            [...cols.map((c) => db[c]), id],
            conn,
          )
        await cfg.afterSave?.({ conn, id, created: false, db, before, changed: (k) => keys.includes(k) })
        return one(id, conn)
      })
      res.json(saved)
    }),
  )

  r.delete(
    "/:id",
    requirePrivilege(...cfg.perms.eliminar),
    wrap(async (req, res) => {
      const id = idParam(req)
      await tx(async (conn) => {
        await cfg.beforeDelete?.(conn, id, req.user!.id)
        const result = await exec(`DELETE FROM ${table} WHERE ${pk} = ?`, [id], conn)
        if (!result.affectedRows) throw notFound()
      })
      res.json({ ok: true })
    }),
  )

  return r
}

export const stdPerms = (m: string) => ({
  crear: [`${m}.crear`],
  editar: [`${m}.editar`],
  eliminar: [`${m}.eliminar`],
  estado: [`${m}.estado`],
})

/** `WHERE col IN (?)` opcional para los `load`. */
export const whereIds = (col: string, ids: number[] | null) =>
  ids
    ? { sql: `WHERE ${col} IN (?)`, params: [ids.length ? ids : [0]] as unknown[] }
    : { sql: "", params: [] as unknown[] }

export function groupBy<T>(rows: T[], key: (r: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>()
  for (const r of rows) {
    const list = m.get(key(r))
    if (list) list.push(r)
    else m.set(key(r), [r])
  }
  return m
}

/**
 * Dos campos del frontend representan la misma columna (p. ej. precioBase / precioBaseNum) y el
 * formulario solo actualiza uno: se toma el que cambió frente al valor guardado.
 */
export function pickChanged(body: Obj, current: Obj | undefined, keys: string[]): unknown {
  if (current) {
    const diff = keys.find((k) => body[k] !== undefined && !same(body[k], current[k]))
    if (diff) return body[diff]
  }
  const present = keys.find((k) => body[k] !== undefined && body[k] !== null && body[k] !== "")
  return present ? body[present] : undefined
}
