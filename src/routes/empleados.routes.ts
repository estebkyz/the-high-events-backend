import { query } from "../config/db.js"
import { crudRouter, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import { activoToDb, enumMap, estadoActivo, joinName, req as reqStr, splitName, strOrNull } from "../utils/format.js"

const tipoDoc = enumMap({ CC: "CC", CE: "CE", NIT: "NIT", PASAPORTE: "PASAPORTE" })
const vinculacion = enumMap({ Fijo: "fijo", "Por Evento": "por_evento" })

export const empleadosRouter = crudRouter({
  table: "empleado",
  pk: "id_empleado",
  perms: stdPerms("empleados"),
  estadoKeys: ["activo"],
  async load(ids, conn) {
    const w = whereIds("id_empleado", ids)
    const rows = await query<Obj>(`SELECT * FROM empleado ${w.sql} ORDER BY id_empleado DESC`, w.params, conn)
    return rows.map((r) => ({
      id: String(r.id_empleado),
      tipo_documento: r.tipo_documento,
      numero_documento: r.numero_documento,
      ...splitName(r.nombre, r.apellido),
      cargo: r.cargo,
      telefono: r.telefono,
      correo: r.correo ?? "",
      estado: estadoActivo(r.activo),
      vinculacion: vinculacion.toFront(r.vinculacion),
      emergenciaNombre: r.emergencia_nombre ?? "",
      emergenciaTel: r.emergencia_telefono ?? "",
      emergenciaParentesco: r.emergencia_parentesco ?? "",
    }))
  },
  async toDb(b) {
    return {
      tipo_documento: tipoDoc.toDb(b.tipo_documento ?? "CC", "Tipo de documento"),
      numero_documento: reqStr(b.numero_documento, "El número de documento"),
      nombre: reqStr(joinName(b.primer_nombre, b.segundo_nombre), "El primer nombre"),
      apellido: strOrNull(joinName(b.primer_apellido, b.segundo_apellido)),
      cargo: reqStr(b.cargo, "El cargo"),
      telefono: reqStr(b.telefono, "El teléfono"),
      correo: strOrNull(b.correo),
      vinculacion: vinculacion.toDb(b.vinculacion ?? "Fijo", "Vinculación"),
      emergencia_nombre: strOrNull(b.emergenciaNombre),
      emergencia_telefono: strOrNull(b.emergenciaTel),
      emergencia_parentesco: strOrNull(b.emergenciaParentesco),
      activo: activoToDb(b.estado ?? "Activo"),
    }
  },
})
