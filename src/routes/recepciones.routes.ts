import { exec, query } from "../config/db.js"
import { equipoTextoSql, personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, groupBy, whereIds, type Obj } from "../utils/resource.js"
import { asArray, dateToDb, dateToFront, dtToFront, enumMap, intOrNull, pad, str, strOrNull } from "../utils/format.js"
import { bad } from "../utils/http.js"
import { condicion } from "./prestamos.routes.js"

const tipo = enumMap({ "Recepción Montaje": "recepcion_montaje", "Recepción Desmontaje": "recepcion_desmontaje" })
const estado = enumMap({
  Pendiente: "pendiente",
  Conforme: "conforme",
  Cerrada: "cerrada",
  Anulada: "anulada",
  // Existe en la BD; EstadoRecepcion del frontend no la declara
  "Con Novedades": "con_novedades",
})
const codigo = (id: number) => `RCP-${pad(id)}`

interface Item {
  equipo_id: number
  esperada: number
  recibida: number
  estado: string
  observaciones: string | null
  evidencia: string | null
}

export const recepcionesRouter = crudRouter({
  table: "recepcion",
  pk: "id_recepcion",
  perms: {
    crear: ["recepciones.crear", "recepciones.devolucion"],
    editar: ["recepciones.editar"],
    estado: ["recepciones.estado"],
    eliminar: ["recepciones.eliminar"],
  },
  estadoKeys: ["estado_recepcion"],
  // Con solo `recepciones.devolucion` se puede registrar el desmontaje, no el montaje
  canCreate: (have, db) => have.has("recepciones.crear") || db.tipo_recepcion === "recepcion_desmontaje",
  async load(ids, conn) {
    const w = whereIds("r.id_recepcion", ids)
    const rows = await query<Obj>(
      `SELECT r.*, e.nombre_evento, p.razon_social, ${personaSql("em")} AS responsable
         FROM recepcion r
         JOIN evento e ON e.id_evento = r.evento_id
         JOIN proveedor p ON p.id_proveedor = r.proveedor_id
         JOIN empleado em ON em.id_empleado = r.empleado_id
        ${w.sql} ORDER BY r.id_recepcion DESC`,
      w.params,
      conn,
    )
    const d = whereIds("d.recepcion_id", ids)
    const items = groupBy(
      await query<Obj & { recepcion_id: number }>(
        `SELECT d.*, ${equipoTextoSql("e")} AS nombre FROM recepcion_detalle d
           JOIN equipo e ON e.id_equipo = d.equipo_id ${d.sql} ORDER BY d.id_recepcion_detalle`,
        d.params,
        conn,
      ),
      (r) => r.recepcion_id,
    )
    return rows.map((r) => ({
      id: String(r.id_recepcion),
      codigo: codigo(r.id_recepcion),
      evento: r.nombre_evento,
      evento_id: r.evento_id, // number en Recepcion
      responsable: r.responsable,
      responsable_id: r.empleado_id,
      proveedor: r.razon_social,
      tipo: tipo.toFront(r.tipo_recepcion),
      fecha: dateToFront(r.hora_registro),
      fecha_hora: dtToFront(r.hora_registro),
      estado: estado.toFront(r.estado_recepcion),
      // Una sola columna: `descripcion` repite las observaciones
      descripcion: r.observaciones ?? "",
      observaciones: r.observaciones ?? "",
      ...(r.recepcion_origen_id ? { parentCodigo: codigo(r.recepcion_origen_id) } : {}),
      items: (items.get(r.id_recepcion) ?? []).map((i) => ({
        nombre: i.nombre,
        cantidad: i.cantidad_recibida,
        estado: condicion.toFront(i.estado),
        observaciones: i.observaciones ?? undefined,
        evidencia_foto: i.url_evidencia ?? undefined,
      })),
    }))
  },
  async toDb(b, { conn, id }) {
    const evento_id = await requireId("evento", b.evento_id, b.evento, conn)
    const proveedor_id = await requireId("proveedor", null, b.proveedor, conn)
    let origen: number | null = null
    if (str(b.parentCodigo)) {
      origen = intOrNull(str(b.parentCodigo).match(/^RCP-0*(\d+)$/)?.[1] ?? "")
      const [p] = origen
        ? await query<{ evento_id: number; proveedor_id: number; tipo_recepcion: string }>(
            "SELECT evento_id, proveedor_id, tipo_recepcion FROM recepcion WHERE id_recepcion = ?",
            [origen],
            conn,
          )
        : []
      if (!p) throw bad(`No existe el acta de origen "${str(b.parentCodigo)}"`)
      if (p.evento_id !== evento_id || p.proveedor_id !== proveedor_id || p.tipo_recepcion !== "recepcion_montaje")
        throw bad("El acta de origen debe ser el montaje del mismo evento y proveedor")
    }
    const entregados = new Map(
      (origen
        ? await query<{ equipo_id: number; n: number }>(
            "SELECT equipo_id, SUM(cantidad_recibida) AS n FROM recepcion_detalle WHERE recepcion_id = ? GROUP BY equipo_id",
            [origen],
            conn,
          )
        : []
      ).map((x) => [x.equipo_id, Number(x.n)]),
    )
    const items: Item[] = []
    for (const it of asArray(b.items, "items") as Obj[]) {
      const equipo_id = await requireId("equipo", null, it.nombre, conn)
      const recibida = intOrNull(it.cantidad ?? 1)
      if (recibida === null || recibida < 0) throw bad("La cantidad de cada equipo debe ser un entero válido")
      items.push({
        equipo_id,
        // En desmontaje lo esperado es lo que se recibió en el montaje
        esperada: entregados.get(equipo_id) ?? recibida,
        recibida,
        estado: condicion.toDb(it.estado ?? "Bueno", "Estado del equipo"),
        observaciones: strOrNull(it.observaciones),
        evidencia: strOrNull(it.evidencia_foto),
      })
    }
    if (!items.length) throw bad("El acta debe incluir al menos un equipo")
    const fecha = dateToDb(b.fecha, "La fecha", true)
    return {
      evento_id,
      proveedor_id,
      // NOT NULL en la BD; el formulario todavía no pide el responsable
      empleado_id: await requireId("empleado", b.responsable_id, b.responsable, conn),
      recepcion_origen_id: origen,
      tipo_recepcion: tipo.toDb(b.tipo, "Tipo de acta"),
      estado_recepcion: estado.toDb(b.estado ?? "Pendiente", "Estado"),
      hora_registro: id === null && fecha === new Date().toLocaleDateString("sv-SE") ? undefined : `${fecha} 00:00:00`,
      observaciones: strOrNull(b.observaciones),
      $items: items,
    }
  },
  async afterSave({ conn, id, db, created, changed }) {
    if (!changed("$items")) return
    if (!created) await exec("DELETE FROM recepcion_detalle WHERE recepcion_id = ?", [id], conn)
    await exec(
      `INSERT INTO recepcion_detalle
         (recepcion_id, equipo_id, cantidad_esperada, cantidad_recibida, estado, observaciones, url_evidencia) VALUES ?`,
      [(db.$items as Item[]).map((i) => [id, i.equipo_id, i.esperada, i.recibida, i.estado, i.observaciones, i.evidencia])],
      conn,
    )
  },
})
