import { exec, query, type Conn } from "../config/db.js"
import { personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, groupBy, whereIds, type Obj } from "../utils/resource.js"
import { enlace } from "../utils/validar.js"
import { exigirDisponibles } from "../utils/disponibilidad.js"
import { codigoPrestamo, recepcionesDePrestamos, sincronizarDocumentos } from "../utils/documentos.js"
import { asArray, dateToDb, dateToFront, enumMap, nowDb, strOrNull } from "../utils/format.js"
import { bad, conflict } from "../utils/http.js"

export const estado = enumMap({
  Programado: "programado",
  Activo: "activo",
  Devuelto: "devuelto",
  "Con Retraso": "con_retraso",
  "Con Daños": "con_danos",
})
export const condicion = enumMap({ Excelente: "excelente", Bueno: "bueno", Regular: "regular", Dañado: "mal" })

interface Linea {
  equipo_id: number
  estado: string
  evidencia?: string | null
}

/** Los equipos siguen fuera de bodega mientras no haya devolución. */
const abierto = (d: Obj) => (d.estado === "activo" || d.estado === "con_retraso") && !d.fecha_devolucion

async function marcarPrestados(conn: Conn, prestamoId: number, equipos: number[]) {
  if (!equipos.length) return
  const rows = await query<{ id_equipo: number; nombre: string; estado: string; tipo_propiedad: string; otro: number | null }>(
    `SELECT e.id_equipo, e.nombre, e.estado, e.tipo_propiedad,
            (SELECT MAX(p.id_prestamo_equipo) FROM prestamo_detalle d
               JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
              WHERE d.equipo_id = e.id_equipo AND p.id_prestamo_equipo <> ?
                AND p.estado IN ('activo','con_retraso') AND p.fecha_devolucion IS NULL AND d.estado_retorno IS NULL) AS otro
       FROM equipo e WHERE e.id_equipo IN (?) FOR UPDATE`,
    [prestamoId, equipos],
    conn,
  )
  for (const e of rows) {
    if (e.tipo_propiedad !== "propio")
      throw conflict(`"${e.nombre}" es alquilado: se recibe en Recepciones, no se presta`)
    if (e.otro) throw conflict(`El equipo "${e.nombre}" ya está en el préstamo ${codigoPrestamo(e.otro)}`)
    if (e.estado !== "disponible" && e.estado !== "en_evento")
      throw conflict(`El equipo "${e.nombre}" no está disponible para préstamo`)
  }
  await exec("UPDATE equipo SET estado = 'prestado' WHERE id_equipo IN (?)", [equipos], conn)
}

/** Mientras dure el préstamo, ningún otro evento puede tener reservados los equipos que salen. */
async function validarFechas(conn: Conn, equipos: number[], db: Obj) {
  if (!equipos.length) return
  const [ev] = await query<{ fin: string }>("SELECT fecha_hora_fin AS fin FROM evento WHERE id_evento = ?", [db.evento_id], conn)
  const ahora = nowDb()
  const estimada: string | null = db.fecha_devolucion_estimada
  // Si vuelve el día en que acaba el evento, se libera al terminar
  const fin = !estimada || estimada.slice(0, 10) === ev.fin.slice(0, 10) ? ev.fin : `${estimada.slice(0, 10)} 23:59:59`
  await exigirDisponibles(conn, equipos, { inicio: ahora, fin: fin > ahora ? fin : ahora }, db.evento_id)
}

/** Vuelven a disponible; los dañados (o todos, si el préstamo quedó con daños sin detalle) pasan a mantenimiento. */
async function liberar(conn: Conn, equipos: number[], retornos: Linea[], conDanos: boolean) {
  for (const id of equipos) {
    const r = retornos.find((x) => x.equipo_id === id)
    const aMantenimiento = r ? r.estado === "mal" : conDanos
    await exec(
      "UPDATE equipo SET estado = ? WHERE id_equipo = ? AND estado = 'prestado'",
      [aMantenimiento ? "en_mantenimiento" : "disponible", id],
      conn,
    )
  }
}

export const prestamosRouter = crudRouter({
  table: "prestamo_equipo",
  pk: "id_prestamo_equipo",
  perms: {
    ver: ["prestamos.ver"],
    crear: ["prestamos.crear"],
    editar: ["prestamos.editar"],
    estado: ["prestamos.devolucion"],
    eliminar: ["prestamos.eliminar"],
  },
  estadoKeys: ["estado", "fecha_devolucion", "observaciones_devolucion", "$retornos"],
  async load(ids, conn) {
    const w = whereIds("p.id_prestamo_equipo", ids)
    const rows = await query<Obj>(
      `SELECT p.*, e.nombre_evento, ${personaSql("em")} AS responsable
         FROM prestamo_equipo p
         JOIN evento e ON e.id_evento = p.evento_id
         JOIN empleado em ON em.id_empleado = p.empleado_id
        ${w.sql} ORDER BY p.id_prestamo_equipo DESC`,
      w.params,
      conn,
    )
    const d = whereIds("d.prestamo_id", ids)
    const lineas = groupBy(
      await query<Obj & { prestamo_id: number }>(
        `SELECT d.*, e.nombre, e.numero_serie FROM prestamo_detalle d JOIN equipo e ON e.id_equipo = d.equipo_id
          ${d.sql} ORDER BY d.equipo_id`,
        d.params,
        conn,
      ),
      (r) => r.prestamo_id,
    )
    const recepciones = await recepcionesDePrestamos(ids, conn)
    return rows.map((r) => ({
      id: String(r.id_prestamo_equipo),
      codigo: codigoPrestamo(r.id_prestamo_equipo),
      responsable: r.responsable,
      responsable_id: r.empleado_id, // number en PrestamoItem
      evento: r.nombre_evento,
      evento_id: r.evento_id,
      equipos: (lineas.get(r.id_prestamo_equipo) ?? []).map((l) => ({
        id: String(l.equipo_id), // el frontend usa el id del equipo
        nombre: l.nombre,
        serie: l.numero_serie ?? "",
        condicionSalida: condicion.toFront(l.estado),
        evidencia: l.url_evidencia ?? undefined,
        ...(l.estado_retorno ? { condicionRetorno: condicion.toFront(l.estado_retorno) } : {}),
      })),
      fechaSalida: dateToFront(r.fecha_salida),
      fechaDevolucion: dateToFront(r.fecha_devolucion_estimada),
      fecha_devolucion_real: r.fecha_devolucion ? dateToFront(r.fecha_devolucion) : undefined,
      estado: estado.toFront(r.estado),
      automatico: r.automatico === 1,
      // Si existe, la devolución se registra allí
      recepcion: recepciones.get(r.id_prestamo_equipo),
      observaciones_entrega: r.observaciones_entrega ?? undefined,
      observaciones_devolucion: r.observaciones_devolucion ?? undefined,
    }))
  },
  async toDb(b, { conn, current }) {
    const est = estado.toDb(b.estado ?? "Activo", "Estado")
    let salida = dateToDb(b.fechaSalida, "La fecha de salida", true)!
    let estimada = dateToDb(b.fechaDevolucion, "La fecha de devolución esperada")
    // Al confirmar un borrador la salida es hoy, no la fecha prevista
    if (current?.estado === "Programado" && est === "activo" && salida === current.fechaSalida) {
      salida = nowDb().slice(0, 10)
      if (estimada && estimada < salida) estimada = salida
    }
    if (estimada && estimada < salida) throw bad("La devolución esperada no puede ser anterior a la salida")
    const real = dateToDb(b.fecha_devolucion_real, "La fecha de devolución")
    const equipos: Linea[] = []
    const retornos: Linea[] = []
    for (const e of asArray(b.equipos, "equipos") as Obj[]) {
      const equipo_id = await requireId("equipo", e.id, null, conn)
      if (equipos.some((x) => x.equipo_id === equipo_id)) throw bad("El préstamo tiene un equipo repetido")
      equipos.push({ equipo_id, estado: condicion.toDb(e.condicionSalida ?? "Bueno", "Condición de salida"), evidencia: enlace(e.evidencia, "La evidencia") })
      if (e.condicionRetorno) retornos.push({ equipo_id, estado: condicion.toDb(e.condicionRetorno, "Condición de retorno") })
    }
    if (!equipos.length) throw bad("El préstamo debe tener al menos un equipo")
    const porId = (x: Linea, y: Linea) => x.equipo_id - y.equipo_id
    const cerrado = est === "devuelto" || est === "con_danos"
    return {
      evento_id: await requireId("evento", b.evento_id, b.evento, conn),
      empleado_id: await requireId("empleado", b.responsable_id, b.responsable, conn),
      fecha_salida: `${salida} 00:00:00`,
      fecha_devolucion_estimada: estimada && `${estimada} 00:00:00`,
      fecha_devolucion: est === "activo" || est === "programado" ? null : real ? `${real} 00:00:00` : cerrado ? nowDb() : null,
      estado: est,
      observaciones_entrega: strOrNull(b.observaciones_entrega),
      observaciones_devolucion: strOrNull(b.observaciones_devolucion),
      $equipos: equipos.sort(porId),
      $retornos: retornos.sort(porId),
    }
  },
  async afterSave({ conn, id, db, before, created, changed }) {
    const lineas: Linea[] = db.$equipos
    const retornos: Linea[] = db.$retornos
    const ids = lineas.map((l) => l.equipo_id)
    if (!created) {
      if (before.estado === "programado" && !["programado", "activo"].includes(db.estado))
        throw conflict("Confirma primero la salida de los equipos")
      if (before.estado !== "programado" && db.estado === "programado")
        throw conflict("Un préstamo confirmado no puede volver a borrador")
      if (abierto(before) && (!abierto(db) || changed("$retornos"))) {
        const recepcion = (await recepcionesDePrestamos([id], conn)).get(id)
        if (recepcion) throw conflict(`La devolución de este préstamo se registra en Recepciones (${recepcion})`)
      }
    }
    if (changed("$equipos") || changed("$retornos")) {
      await exec("DELETE FROM prestamo_detalle WHERE prestamo_id = ? AND equipo_id NOT IN (?)", [id, ids], conn)
      for (const l of lineas) {
        const retorno = retornos.find((r) => r.equipo_id === l.equipo_id)?.estado ?? null
        const u = await exec(
          "UPDATE prestamo_detalle SET estado = ?, estado_retorno = ?, url_evidencia = ? WHERE prestamo_id = ? AND equipo_id = ?",
          [l.estado, retorno, l.evidencia, id, l.equipo_id],
          conn,
        )
        if (!u.affectedRows)
          await exec(
            "INSERT INTO prestamo_detalle (prestamo_id, equipo_id, estado, estado_retorno, url_evidencia) VALUES (?, ?, ?, ?, ?)",
            [id, l.equipo_id, l.estado, retorno, l.evidencia],
            conn,
          )
      }
    }
    const antes: number[] = !created && before.$equipos && abierto(before) ? before.$equipos.map((l: Linea) => l.equipo_id) : []
    const ahora = abierto(db) ? ids : []
    await liberar(conn, antes.filter((x) => !ahora.includes(x)), retornos, db.estado === "con_danos")
    const salen = ahora.filter((x) => !antes.includes(x))
    await marcarPrestados(conn, id, salen)
    await validarFechas(conn, salen, db)
    // Un préstamo hecho a mano sale del borrador del evento
    if (created) await sincronizarDocumentos(conn, db.evento_id, { fechas: false, responsable: false })
  },
  async beforeDelete(conn, id) {
    const eq = await query<{ equipo_id: number }>(
      `SELECT d.equipo_id FROM prestamo_detalle d JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
        WHERE d.prestamo_id = ? AND p.estado IN ('activo','con_retraso') AND p.fecha_devolucion IS NULL
          AND d.estado_retorno IS NULL`,
      [id],
      conn,
    )
    await liberar(conn, eq.map((x) => x.equipo_id), [], false)
  },
})
