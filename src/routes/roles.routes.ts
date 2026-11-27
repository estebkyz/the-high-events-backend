import { exec, query, tx, type Conn } from "../config/db.js"
import { clearPermissionCache, requirePrivilege } from "../middleware/auth.js"
import { codigosDeRol, exigirAdministrador, exigirAlcance, exigirAlcanceRol } from "../utils/autorizacion.js"
import { actorDe, crudRouter, permisoLectura, whereIds } from "../utils/resource.js"
import { activoToDb, estadoActivo, req as reqStr, str } from "../utils/format.js"
import { asArray } from "../utils/format.js"
import { bad, conflict, idParam, notFound, wrap } from "../utils/http.js"

// Los códigos del módulo en el catálogo son `config.roles.*`
const perms = {
  ver: ["config.roles.ver"],
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
  // El formulario de usuarios elige el rol por nombre
  catalogo: { modulos: ["usuarios"], campos: ["nombre", "estado"] },
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
  async afterSave({ conn, actor, id, created, changed }) {
    if (!created) await exigirAlcanceRol(actor, id, conn, "No puede modificar un rol con más permisos que el suyo")
    if (changed("estado")) {
      if (id === actor.rol) throw conflict("No puede cambiar el estado de su propio rol")
      await exigirAdministrador(conn)
    }
    clearPermissionCache(id)
  },
  async beforeDelete(conn, id, actor) {
    await exigirAlcanceRol(actor, id, conn, "No puede eliminar un rol con más permisos que el suyo")
    const [{ n }] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM usuario WHERE rol_id = ?", [id], conn)
    if (n > 0) throw conflict(`No se puede eliminar: el rol tiene ${n} usuario(s) asignado(s)`)
    clearPermissionCache(id)
  },
})

async function existe(id: number, conn?: Conn) {
  const rows = await query(`SELECT 1 FROM rol WHERE id_rol = ?${conn ? " FOR UPDATE" : ""}`, [id], conn)
  if (!rows.length) throw notFound("Rol no encontrado")
}

/** GET → string[] de códigos `modulo.accion` */
rolesRouter.get(
  "/:id/permisos",
  permisoLectura({ perms }),
  wrap(async (req, res) => {
    const id = idParam(req)
    await existe(id)
    res.json(await codigosDeRol(id))
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
    const pedidos = asArray(lista, "permisos").map(str).filter(Boolean)
    // Acceder al módulo (`*.ver`) es requisito de sus demás acciones: se agrega si falta
    const codigos = [...new Set(pedidos.flatMap((c) => [c, ...(c.includes(".") ? [`${c.slice(0, c.lastIndexOf("."))}.ver`] : [])]))]
    const actor = await actorDe(req)
    const out = await tx(async (conn) => {
      await existe(id, conn)
      exigirAlcance(actor, await codigosDeRol(id, conn), "No puede modificar un rol con más permisos que el suyo")
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
      exigirAlcance(actor, codigos, "No puede conceder permisos que no tiene")
      await exec("DELETE FROM rol_privilegio WHERE rol_id = ?", [id], conn)
      if (found.length)
        await exec(
          "INSERT INTO rol_privilegio (rol_id, privilegio_id) VALUES ?",
          [found.map((f) => [id, f.id_privilegio])],
          conn,
        )
      await exigirAdministrador(conn)
      return codigosDeRol(id, conn)
    })
    clearPermissionCache(id)
    res.json(out)
  }),
)
