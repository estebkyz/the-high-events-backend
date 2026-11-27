import { query } from "../config/db.js"
import { crudRouter, stdPerms, whereIds, type Obj } from "../utils/resource.js"
import { validar, validarDocumento } from "../utils/validar.js"
import { activoToDb, enumMap, estadoActivo, joinName, req as reqStr, splitName, strOrNull } from "../utils/format.js"

const tipoCliente = enumMap({ Empresa: "empresa", Natural: "persona_natural" })
const tipoDoc = enumMap({ CC: "CC", CE: "CE", NIT: "NIT", PASAPORTE: "PASAPORTE" })

export const clientesRouter = crudRouter({
  table: "cliente",
  pk: "id_cliente",
  perms: stdPerms("clientes"),
  catalogo: {
    modulos: ["agendamiento", "cotizaciones", "eventos"],
    campos: ["tipo_cliente", "razon_social", "primer_nombre", "segundo_nombre", "primer_apellido", "segundo_apellido", "tipo_documento", "numero_documento", "estado"],
  },
  estadoKeys: ["estado"],
  async load(ids, conn) {
    const w = whereIds("id_cliente", ids)
    const rows = await query<Obj>(`SELECT * FROM cliente ${w.sql} ORDER BY id_cliente DESC`, w.params, conn)
    return rows.map((r) => ({
      id: String(r.id_cliente),
      tipo_cliente: tipoCliente.toFront(r.tipo_cliente),
      razon_social: r.razon_social ?? "",
      ...splitName(r.nombre, r.apellido),
      contacto_nombre: r.contacto_nombre ?? "",
      tipo_documento: r.tipo_documento,
      numero_documento: r.numero_documento,
      correo: r.correo,
      telefono: r.telefono,
      direccion: r.direccion,
      estado: estadoActivo(r.estado),
      fecha_creacion: r.fecha_creacion,
    }))
  },
  async toDb(b, { current }) {
    const tipo = tipoCliente.toDb(b.tipo_cliente, "Tipo de cliente")
    const nombre = joinName(b.primer_nombre, b.segundo_nombre)
    const apellido = joinName(b.primer_apellido, b.segundo_apellido)
    const natural = tipo === "persona_natural"
    const documento = tipoDoc.toDb(b.tipo_documento, "Tipo de documento")
    validar(b, current, { correo: ["correo", "El correo"], telefono: ["telefono", "El teléfono"] })
    validarDocumento(b, current, "numero_documento", documento)
    return {
      tipo_cliente: tipo,
      razon_social: natural ? strOrNull(b.razon_social) : reqStr(b.razon_social, "La razón social"),
      nombre: natural ? reqStr(nombre, "El primer nombre") : strOrNull(nombre),
      apellido: natural ? reqStr(apellido, "El primer apellido") : strOrNull(apellido),
      contacto_nombre: strOrNull(b.contacto_nombre),
      tipo_documento: documento,
      numero_documento: reqStr(b.numero_documento, "El número de documento"),
      // NOT NULL en la BD
      correo: reqStr(b.correo, "El correo"),
      telefono: reqStr(b.telefono, "El teléfono"),
      direccion: reqStr(b.direccion, "La dirección"),
      estado: activoToDb(b.estado ?? "Activo"),
    }
  },
})
