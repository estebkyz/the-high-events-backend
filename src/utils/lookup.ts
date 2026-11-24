import { query, type Conn } from "../config/db.js"
import { bad } from "./http.js"
import { intOrNull, str } from "./format.js"

/** Nombre visible del cliente, igual a getClienteDisplayName() del frontend. */
export const clienteNombreSql = (a: string) =>
  `IF(${a}.tipo_cliente = 'empresa', ${a}.razon_social, TRIM(CONCAT_WS(' ', ${a}.nombre, ${a}.apellido)))`
export const personaSql = (a: string) => `TRIM(CONCAT_WS(' ', ${a}.nombre, ${a}.apellido))`
/** Texto con el que el formulario de recepciones identifica un equipo: "Nombre (SERIE)". */
export const equipoTextoSql = (a: string) =>
  `IF(${a}.numero_serie IS NULL, ${a}.nombre, CONCAT(${a}.nombre, ' (', ${a}.numero_serie, ')'))`

const ENTIDADES = {
  evento: { table: "evento", pk: "id_evento", label: "el evento", names: ["t.nombre_evento"] },
  empleado: { table: "empleado", pk: "id_empleado", label: "el empleado", names: [personaSql("t")] },
  cliente: {
    table: "cliente",
    pk: "id_cliente",
    label: "el cliente",
    // CotizacionFormDrawer muestra solo primer nombre + primer apellido
    names: [
      clienteNombreSql("t"),
      "CONCAT(SUBSTRING_INDEX(t.nombre, ' ', 1), ' ', SUBSTRING_INDEX(t.apellido, ' ', 1))",
    ],
  },
  proveedor: { table: "proveedor", pk: "id_proveedor", label: "el proveedor", names: ["t.razon_social"] },
  equipo: {
    table: "equipo",
    pk: "id_equipo",
    label: "el equipo",
    names: [equipoTextoSql("t"), "t.nombre", "t.codigo"],
  },
  servicio: { table: "servicio", pk: "id_servicio", label: "el servicio", names: ["t.nombre"] },
  categoriaServicio: {
    table: "categoria_servicio",
    pk: "id_categoria_servicio",
    label: "la categoría de servicio",
    names: ["t.nombre"],
  },
  categoriaEquipo: {
    table: "categoria_equipo",
    pk: "id_categoria_equipo",
    label: "la categoría de equipo",
    names: ["t.nombre"],
  },
  tarea: { table: "tarea", pk: "id_tarea", label: "la tarea del catálogo", names: ["t.nombre"] },
  rol: { table: "rol", pk: "id_rol", label: "el rol", names: ["t.nombre"] },
} as const

export type Entidad = keyof typeof ENTIDADES

/**
 * Resuelve una llave foránea a partir del id y/o el nombre que envía el frontend.
 * Varios formularios cambian el nombre sin cambiar el id: si no coinciden, manda el nombre.
 * Nunca se inventa un registro: sin coincidencia única → 400.
 */
export async function resolveId(ent: Entidad, idRaw: unknown, nameRaw: unknown, conn?: Conn): Promise<number | null> {
  const e = ENTIDADES[ent]
  const id = intOrNull(idRaw)
  const name = str(nameRaw)

  if (name) {
    const match = e.names.map((n) => `${n} = ?`).join(" OR ")
    const args = e.names.map(() => name)
    const rows = await query<{ id: number }>(
      `SELECT t.${e.pk} AS id FROM ${e.table} t WHERE ${match} LIMIT 50`,
      args,
      conn,
    )
    if (id && rows.some((r) => r.id === id)) return id
    if (rows.length === 1) return rows[0].id
    if (rows.length > 1) throw bad(`Hay más de un registro para ${e.label} "${name}": envíe su id`)
    throw bad(`No existe ${e.label} "${name}"`)
  }
  if (id) {
    const rows = await query(`SELECT 1 FROM ${e.table} WHERE ${e.pk} = ?`, [id], conn)
    if (!rows.length) throw bad(`No existe ${e.label} con id ${id}`)
    return id
  }
  return null
}

export async function requireId(ent: Entidad, idRaw: unknown, nameRaw: unknown, conn?: Conn): Promise<number> {
  const id = await resolveId(ent, idRaw, nameRaw, conn)
  if (id == null) throw bad(`Debe indicar ${ENTIDADES[ent].label}`)
  return id
}
