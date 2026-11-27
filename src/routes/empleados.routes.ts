import { query } from "../config/db.js"
import { crudRouter, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import { validar, validarDocumento } from "../utils/validar.js"
import { activoToDb, enumMap, estadoActivo, joinName, req as reqStr, splitName, strOrNull } from "../utils/format.js"

const tipoDoc = enumMap({ CC: "CC", CE: "CE", NIT: "NIT", PASAPORTE: "PASAPORTE" })
const vinculacion = enumMap({ Fijo: "fijo", "Por Evento": "por_evento" })

export const empleadosRouter = crudRouter({
  table: "empleado",
  pk: "id_empleado",
  perms: stdPerms("empleados"),
  catalogo: {
    modulos: ["agendamiento", "cotizaciones", "eventos", "incidentes", "prestamos", "recepciones", "tareas"],
    campos: ["primer_nombre", "segundo_nombre", "primer_apellido", "segundo_apellido", "cargo", "estado", "vinculacion"],
  },
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
    }))
  },
  async toDb(b, { current }) {
    const documento = tipoDoc.toDb(b.tipo_documento ?? "CC", "Tipo de documento")
    validar(b, current, {
      correo: ["correo", "El correo"],
      telefono: ["telefono", "El teléfono"],
    })
    validarDocumento(b, current, "numero_documento", documento)
    return {
      tipo_documento: documento,
      numero_documento: reqStr(b.numero_documento, "El número de documento"),
      nombre: reqStr(joinName(b.primer_nombre, b.segundo_nombre), "El primer nombre"),
      apellido: strOrNull(joinName(b.primer_apellido, b.segundo_apellido)),
      cargo: reqStr(b.cargo, "El cargo"),
      telefono: reqStr(b.telefono, "El teléfono"),
      correo: strOrNull(b.correo),
      vinculacion: vinculacion.toDb(b.vinculacion ?? "Fijo", "Vinculación"),
      activo: activoToDb(b.estado ?? "Activo"),
    }
  },
})
