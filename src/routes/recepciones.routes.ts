import { exec, query, type Conn } from "../config/db.js"
import {
  codigoRecepcion as codigo,
  devolverPrestamos,
  exigirSalida,
  prepararDevolucion,
  recepcionConfirmada,
  retirarDevolucion,
  sincronizarDocumentos,
  liberarEntrega,
  montajeDe,
} from "../utils/documentos.js"
import { equipoTextoSql, personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, groupBy, whereIds, type AfterCtx, type Obj } from "../utils/resource.js"
import { enlace } from "../utils/validar.js"
import { asArray, dateToDb, dateToFront, dtToFront, enumMap, intOrNull, nowDb, str, strOrNull } from "../utils/format.js"
import { bad, conflict } from "../utils/http.js"
import { condicion } from "./prestamos.routes.js"

const tipo = enumMap({ "Recepción Montaje": "recepcion_montaje", "Recepción Desmontaje": "recepcion_desmontaje" })
export const estado = enumMap({
  Pendiente: "pendiente",
  Conforme: "conforme",
  Cerrada: "cerrada",
  Anulada: "anulada",
  // Existe en la BD; EstadoRecepcion del frontend no la declara
  "Con Novedades": "con_novedades",
})

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
    ver: ["recepciones.ver"],
    crear: ["recepciones.crear", "recepciones.devolucion"],
    editar: ["recepciones.editar"],
    estado: ["recepciones.estado"],
    eliminar: ["recepciones.eliminar"],
  },
  catalogo: { modulos: ["dashboard"] },
  estadoKeys: ["estado_recepcion"],
  // Con solo `recepciones.devolucion` se puede registrar el desmontaje, no el montaje
  canCreate: (have, db) => have.has("recepciones.crear") || db.tipo_recepcion === "recepcion_desmontaje",
  async load(ids, conn) {
    const w = whereIds("r.id_recepcion", ids)
    const rows = await query<Obj>(
      `SELECT r.*, e.nombre_evento, p.razon_social, ${personaSql("em")} AS responsable,
              (SELECT m.id_recepcion FROM recepcion m
                WHERE r.tipo_recepcion = 'recepcion_desmontaje' AND m.evento_id = r.evento_id
                  AND m.proveedor_id <=> r.proveedor_id AND m.tipo_recepcion = 'recepcion_montaje'
                  AND m.estado_recepcion <> 'anulada' LIMIT 1) AS montaje_id
         FROM recepcion r
         JOIN evento e ON e.id_evento = r.evento_id
         LEFT JOIN proveedor p ON p.id_proveedor = r.proveedor_id
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
      // Vacío = recepción interna de equipos propios
      proveedor: r.razon_social ?? "",
      automatico: r.automatico === 1,
      tipo: tipo.toFront(r.tipo_recepcion),
      fecha: dateToFront(r.hora_registro),
      fecha_hora: dtToFront(r.hora_registro),
      estado: estado.toFront(r.estado_recepcion),
      // Una sola columna: `descripcion` repite las observaciones
      descripcion: r.observaciones ?? "",
      observaciones: r.observaciones ?? "",
      ...(r.montaje_id ? { parentCodigo: codigo(r.montaje_id) } : {}),
      items: (items.get(r.id_recepcion) ?? []).map((i) => ({
        equipo_id: i.equipo_id,
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
    const proveedor_id = str(b.proveedor) ? await requireId("proveedor", null, b.proveedor, conn) : null
    const tipoActa = tipo.toDb(b.tipo, "Tipo de acta")
    // La devolución corresponde al montaje del mismo evento y proveedor: una entrega por proveedor
    const montaje = tipoActa === "recepcion_desmontaje" ? await montajeDe(conn, evento_id, proveedor_id) : undefined
    if (id === null) await liberarEntrega(conn, evento_id, proveedor_id, tipoActa)
    const entregados = new Map(
      (montaje
        ? await query<{ equipo_id: number; n: number }>(
            "SELECT equipo_id, SUM(cantidad_recibida) AS n FROM recepcion_detalle WHERE recepcion_id = ? GROUP BY equipo_id",
            [montaje.id],
            conn,
          )
        : []
      ).map((x) => [x.equipo_id, Number(x.n)]),
    )
    const items: Item[] = []
    for (const it of asArray(b.items, "items") as Obj[]) {
      const equipo_id = await requireId("equipo", it.equipo_id, it.nombre, conn)
      const recibida = intOrNull(it.cantidad ?? 1)
      if (recibida === null || recibida < 0) throw bad("La cantidad de cada equipo debe ser un entero válido")
      items.push({
        equipo_id,
        // En desmontaje lo esperado es lo que se recibió en el montaje
        esperada: entregados.get(equipo_id) ?? recibida,
        recibida,
        estado: condicion.toDb(it.estado ?? "Bueno", "Estado del equipo"),
        observaciones: strOrNull(it.observaciones),
        evidencia: enlace(it.evidencia_foto, "La evidencia"),
      })
    }
    if (!items.length) throw bad("El acta debe incluir al menos un equipo")
    if (!proveedor_id) {
      const [ajeno] = await query<{ nombre: string }>(
        "SELECT nombre FROM equipo WHERE id_equipo IN (?) AND tipo_propiedad <> 'propio' LIMIT 1",
        [items.map((i) => i.equipo_id)],
        conn,
      )
      if (ajeno) throw bad(`"${ajeno.nombre}" es alquilado: selecciona su proveedor`)
    }
    const est = estado.toDb(b.estado ?? "Pendiente", "Estado")
    const fecha = dateToDb(b.fecha, "La fecha", true)
    return {
      evento_id,
      proveedor_id,
      // NOT NULL en la BD; el formulario todavía no pide el responsable
      empleado_id: await requireId("empleado", b.responsable_id, b.responsable, conn),
      tipo_recepcion: tipoActa,
      estado_recepcion: est,
      hora_registro: id === null && fecha === new Date().toLocaleDateString("sv-SE") ? undefined : `${fecha} 00:00:00`,
      observaciones: strOrNull(b.observaciones),
      $items: items,
    }
  },
  async afterSave(ctx) {
    const { conn, id, db, created, changed } = ctx
    if (changed("$items")) await guardarItems(ctx)
    // Al confirmar un borrador automático la fecha es hoy, no la prevista
    if (!created && !antes(ctx) && recepcionConfirmada(db.estado_recepcion) && !changed("hora_registro"))
      await exec("UPDATE recepcion SET hora_registro = ? WHERE id_recepcion = ? AND automatico = 1", [nowDb(), id], conn)
    if (db.tipo_recepcion === "recepcion_montaje") await reglasMontaje(ctx)
    else await reglasDesmontaje(ctx)
    // Un acta hecha a mano sale del borrador del evento
    if (created) await sincronizarDocumentos(conn, db.evento_id, { fechas: false, responsable: false })
  },
  async beforeDelete(conn, id) {
    const [r] = await query<{ tipo: string; interna: number; estado: string }>(
      "SELECT tipo_recepcion AS tipo, proveedor_id IS NULL AS interna, estado_recepcion AS estado FROM recepcion WHERE id_recepcion = ?",
      [id],
      conn,
    )
    if (!r) return
    if (r.tipo === "recepcion_montaje") await retirarDevolucion(conn, id)
    else if (r.interna && recepcionConfirmada(r.estado)) throw conflict(CERRO_PRESTAMO)
  },
})

const CERRO_PRESTAMO = "Esta recepción ya registró el regreso de los equipos a bodega: no se puede modificar"

async function guardarItems({ conn, id, db, created }: AfterCtx) {
  if (!created) await exec("DELETE FROM recepcion_detalle WHERE recepcion_id = ?", [id], conn)
  await exec(
    `INSERT INTO recepcion_detalle
       (recepcion_id, equipo_id, cantidad_esperada, cantidad_recibida, estado, observaciones, url_evidencia) VALUES ?`,
    [(db.$items as Item[]).map((i) => [id, i.equipo_id, i.esperada, i.recibida, i.estado, i.observaciones, i.evidencia])],
    conn,
  )
}

const antes = ({ created, before }: AfterCtx) => !created && recepcionConfirmada(before.estado_recepcion)

/** Confirmar la llegada exige que lo propio haya salido y deja lista la devolución. */
async function reglasMontaje(ctx: AfterCtx) {
  const { conn, id, db, created, changed } = ctx
  const confirmada = recepcionConfirmada(db.estado_recepcion)
  if (confirmada && !antes(ctx) && !db.proveedor_id)
    await exigirSalida(
      conn,
      db.evento_id,
      (db.$items as Item[]).map((i) => i.equipo_id),
    )
  if (!confirmada && antes(ctx)) await retirarDevolucion(conn, id)
  if (confirmada && (created || !antes(ctx) || changed("$items"))) await prepararDevolucion(conn, id)
}

/** Todo lo que llegó al evento debe regresar; lo perdido se registra como dañado, con su observación. */
async function exigirCompleta(conn: Conn, montaje: number | null, items: Item[]) {
  if (!montaje) return
  const llegaron = await query<{ id: number; nombre: string }>(
    `SELECT DISTINCT e.id_equipo AS id, e.nombre FROM recepcion_detalle d JOIN equipo e ON e.id_equipo = d.equipo_id
      WHERE d.recepcion_id = ?`,
    [montaje],
    conn,
  )
  const faltan = llegaron.filter((e) => !items.some((i) => i.equipo_id === e.id && i.recibida > 0))
  if (faltan.length)
    throw conflict(`Faltan por regresar: ${faltan.map((e) => e.nombre).join(", ")}. Si se perdió, regístralo como dañado`)
}

/** Confirmar el regreso a bodega de lo propio cierra su préstamo: es la única devolución. */
async function reglasDesmontaje(ctx: AfterCtx) {
  const { conn, id, db, created, changed } = ctx
  if (db.proveedor_id) return
  const confirmada = recepcionConfirmada(db.estado_recepcion)
  if (antes(ctx) && (!confirmada || changed("$items"))) throw conflict(CERRO_PRESTAMO)
  if (!confirmada || antes(ctx)) return
  await exigirCompleta(conn, (await montajeDe(conn, db.evento_id, db.proveedor_id))?.id ?? null, db.$items)
  await devolverPrestamos(conn, id, db.evento_id, db.$items)
}
