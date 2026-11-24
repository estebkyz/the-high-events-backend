import { exec, query, tx, type Conn } from "../config/db.js"
import { clearPermissionCache, requirePrivilege } from "../middleware/auth.js"
import { crudRouter, whereIds } from "../utils/resource.js"
import { activoToDb, estadoActivo, req as reqStr, str } from "../utils/format.js"
import { asArray } from "../utils/format.js"
import { bad, conflict, idParam, notFound, wrap } from "../utils/http.js"

// Los códigos del módulo en el catálogo son `config.roles.*`
const perms = {
  crear: ["config.roles.crear"],
  editar: ["config.roles.editar"],
  eliminar: ["config.roles.eliminar"],
  estado: ["config.roles.estado"],
}

interface RolRow {
  id_rol: number
  nombre: string
  descripcion: string | null
  estado: number
  usuarios: number
}

export const rolesRouter = crudRouter({
  table: "rol",
  pk: "id_rol",
  perms,
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("r.id_rol", ids)
    const rows = await query<RolRow>(
      `SELECT r.*, (SELECT COUNT(*) FROM usuario u WHERE u.rol_id = r.id_rol) AS usuarios
         FROM rol r ${w.sql} ORDER BY r.id_rol`,
      w.params,
      conn,
    )
    return rows.map((r) => ({
      id: String(r.id_rol),
      nombre: r.nombre,
      descripcion: r.descripcion ?? "",
      usuariosCount: r.usuarios,
      estado: estadoActivo(r.estado),
    }))
  },
  async toDb(b) {
    return {
      nombre: reqStr(b.nombre, "El nombre del rol"),
      descripcion: str(b.descripcion) || null,
      estado: activoToDb(b.estado ?? "Activo"),
    }
  },
  async afterSave({ id }) {
    clearPermissionCache(id)
  },
  async beforeDelete(conn, id) {
    const [{ n }] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM usuario WHERE rol_id = ?", [id], conn)
    if (n > 0) throw conflict(`No se puede eliminar: el rol tiene ${n} usuario(s) asignado(s)`)
    clearPermissionCache(id)
  },
})

const codigosDe = async (id: number, conn?: Conn): Promise<string[]> =>
  (
    await query<{ codigo: string }>(
      `SELECT p.codigo FROM rol_privilegio rp JOIN privilegio p ON p.id_privilegio = rp.privilegio_id
        WHERE rp.rol_id = ? ORDER BY p.id_privilegio`,
      [id],
      conn,
    )
  ).map((r) => r.codigo)

async function existe(id: number, conn?: Conn) {
  const rows = await query(`SELECT 1 FROM rol WHERE id_rol = ?${conn ? " FOR UPDATE" : ""}`, [id], conn)
  if (!rows.length) throw notFound("Rol no encontrado")
}

/** GET → string[] de códigos `modulo.accion` */
rolesRouter.get(
  "/:id/permisos",
  wrap(async (req, res) => {
    const id = idParam(req)
    await existe(id)
    res.json(await codigosDe(id))
  }),
)

/** PUT string[] (o `{ permisos: string[] }`) → reemplaza el conjunto completo */
rolesRouter.put(
  "/:id/permisos",
  requirePrivilege(...perms.editar),
  wrap(async (req, res) => {
    const id = idParam(req)
    const lista = Array.isArray(req.body) ? req.body : req.body?.permisos
    if (lista === undefined) throw bad("Debe enviar la lista de permisos")
    const codigos = [...new Set(asArray(lista, "permisos").map(str).filter(Boolean))]
    const out = await tx(async (conn) => {
      await existe(id, conn)
      const found = codigos.length
        ? await query<{ id_privilegio: number; codigo: string }>(
            "SELECT id_privilegio, codigo FROM privilegio WHERE codigo IN (?)",
            [codigos],
            conn,
          )
        : []
      const validos = new Set(found.map((f) => f.codigo))
      const malos = codigos.filter((c) => !validos.has(c))
      if (malos.length) throw bad(`Permisos inexistentes: ${malos.join(", ")}`)
      await exec("DELETE FROM rol_privilegio WHERE rol_id = ?", [id], conn)
      if (found.length)
        await exec(
          "INSERT INTO rol_privilegio (rol_id, privilegio_id) VALUES ?",
          [found.map((f) => [id, f.id_privilegio])],
          conn,
        )
      return codigosDe(id, conn)
    })
    clearPermissionCache(id)
    res.json(out)
  }),
)
