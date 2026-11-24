import { exec, query, type Conn } from "../config/db.js"
import { personaSql, requireId } from "../utils/lookup.js"
import { crudRouter, groupBy, whereIds, type Obj } from "../utils/resource.js"
import { asArray, dateToDb, dateToFront, enumMap, nowDb, pad, strOrNull } from "../utils/format.js"
import { bad, conflict } from "../utils/http.js"

const estado = enumMap({
  Activo: "activo",
  Devuelto: "devuelto",
  "Con Retraso": "con_retraso",
  "Con Daños": "con_danos",
})
export const condicion = enumMap({ Excelente: "excelente", Bueno: "bueno", Regular: "regular", Dañado: "mal" })

interface Linea {
  equipo_id: number
  estado: string
}

/** Los equipos siguen fuera de bodega mientras no haya devolución. */
const abierto = (d: Obj) => (d.estado === "activo" || d.estado === "con_retraso") && !d.fecha_devolucion

async function marcarPrestados(conn: Conn, prestamoId: number, equipos: number[]) {
  if (!equipos.length) return
  const rows = await query<{ id_equipo: number; nombre: string; estado: string; otro: number | null }>(
    `SELECT e.id_equipo, e.nombre, e.estado,
            (SELECT MAX(p.id_prestamo_equipo) FROM prestamo_detalle d
               JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
              WHERE d.equipo_id = e.id_equipo AND p.id_prestamo_equipo <> ?
                AND p.estado IN ('activo','con_retraso') AND p.fecha_devolucion IS NULL) AS otro
       FROM equipo e WHERE e.id_equipo IN (?) FOR UPDATE`,
    [prestamoId, equipos],
    conn,
  )
  for (const e of rows) {
    if (e.otro) throw conflict(`El equipo "${e.nombre}" ya está en el préstamo PR-${pad(e.otro)}`)
    if (e.estado !== "disponible" && e.estado !== "en_evento")
      throw conflict(`El equipo "${e.nombre}" no está disponible para préstamo`)
  }
  await exec("UPDATE equipo SET estado = 'prestado' WHERE id_equipo IN (?)", [equipos], conn)
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
    return rows.map((r) => ({
      id: String(r.id_prestamo_equipo),
      codigo: `PR-${pad(r.id_prestamo_equipo)}`,
      responsable: r.responsable,
      responsable_id: r.empleado_id, // number en PrestamoItem
      evento: r.nombre_evento,
      evento_id: r.evento_id,
      equipos: (lineas.get(r.id_prestamo_equipo) ?? []).map((l) => ({
        id: String(l.equipo_id), // el frontend usa el id del equipo
        nombre: l.nombre,
        serie: l.numero_serie ?? "",
        condicionSalida: condicion.toFront(l.estado),
        ...(l.estado_retorno ? { condicionRetorno: condicion.toFront(l.estado_retorno) } : {}),
      })),
      fechaSalida: dateToFront(r.fecha_salida),
      fechaDevolucion: dateToFront(r.fecha_devolucion_estimada),
      fecha_devolucion_real: r.fecha_devolucion ? dateToFront(r.fecha_devolucion) : undefined,
      estado: estado.toFront(r.estado),
      observaciones_entrega: r.observaciones_entrega ?? undefined,
      observaciones_devolucion: r.observaciones_devolucion ?? undefined,
    }))
  },
  async toDb(b, { conn }) {
    const salida = dateToDb(b.fechaSalida, "La fecha de salida", true)!
    const estimada = dateToDb(b.fechaDevolucion, "La fecha de devolución esperada")
    if (estimada && estimada < salida) throw bad("La devolución esperada no puede ser anterior a la salida")
    const est = estado.toDb(b.estado ?? "Activo", "Estado")
    const real = dateToDb(b.fecha_devolucion_real, "La fecha de devolución")
    const equipos: Linea[] = []
    const retornos: Linea[] = []
    for (const e of asArray(b.equipos, "equipos") as Obj[]) {
      const equipo_id = await requireId("equipo", e.id, null, conn)
      if (equipos.some((x) => x.equipo_id === equipo_id)) throw bad("El préstamo tiene un equipo repetido")
      equipos.push({ equipo_id, estado: condicion.toDb(e.condicionSalida ?? "Bueno", "Condición de salida") })
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
      fecha_devolucion: est === "activo" ? null : real ? `${real} 00:00:00` : cerrado ? nowDb() : null,
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
    if (changed("$equipos") || changed("$retornos")) {
      await exec("DELETE FROM prestamo_detalle WHERE prestamo_id = ? AND equipo_id NOT IN (?)", [id, ids], conn)
      for (const l of lineas) {
        const retorno = retornos.find((r) => r.equipo_id === l.equipo_id)?.estado ?? null
        const u = await exec(
          "UPDATE prestamo_detalle SET estado = ?, estado_retorno = ? WHERE prestamo_id = ? AND equipo_id = ?",
          [l.estado, retorno, id, l.equipo_id],
          conn,
        )
        if (!u.affectedRows)
          await exec(
            "INSERT INTO prestamo_detalle (prestamo_id, equipo_id, estado, estado_retorno) VALUES (?, ?, ?, ?)",
            [id, l.equipo_id, l.estado, retorno],
            conn,
          )
      }
    }
    const antes: number[] = !created && before.$equipos && abierto(before) ? before.$equipos.map((l: Linea) => l.equipo_id) : []
    const ahora = abierto(db) ? ids : []
    await liberar(conn, antes.filter((x) => !ahora.includes(x)), retornos, db.estado === "con_danos")
    await marcarPrestados(conn, id, ahora.filter((x) => !antes.includes(x)))
  },
  async beforeDelete(conn, id) {
    const eq = await query<{ equipo_id: number }>(
      `SELECT d.equipo_id FROM prestamo_detalle d JOIN prestamo_equipo p ON p.id_prestamo_equipo = d.prestamo_id
        WHERE d.prestamo_id = ? AND p.estado IN ('activo','con_retraso') AND p.fecha_devolucion IS NULL`,
      [id],
      conn,
    )
    await liberar(conn, eq.map((x) => x.equipo_id), [], false)
  },
})
