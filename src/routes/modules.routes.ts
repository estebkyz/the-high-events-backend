import { createCrudRouter } from "../utils/createCrudRouter.js"

const splitNames = (nombre?: string | null, apellido?: string | null) => {
  const n = (nombre || "").trim().split(/\s+/)
  const a = (apellido || "").trim().split(/\s+/)
  return {
    primer_nombre: n[0] || "",
    segundo_nombre: n.slice(1).join(" ") || "",
    primer_apellido: a[0] || "",
    segundo_apellido: a.slice(1).join(" ") || "",
  }
}

const joinNames = (p1?: string, p2?: string) =>
  [p1, p2].filter(Boolean).join(" ").trim() || null

// 1. Tabla `rol`
export const rolesRouter = createCrudRouter({
  table: "rol",
  primaryKey: "id_rol",
  toFrontend: (r) => ({
    id: String(r.id_rol),
    nombre: r.nombre,
    descripcion: r.descripcion || "",
    usuariosCount: 0,
    estado: r.estado === 1 ? "Activo" : "Inactivo",
  }),
  toDatabase: (b) => ({
    nombre: b.nombre,
    descripcion: b.descripcion ?? null,
    estado: b.estado === "Inactivo" ? 0 : 1,
  }),
})

// 2. Tabla `usuario`
export const usuariosRouter = createCrudRouter({
  table: "usuario",
  primaryKey: "id_usuario",
  toFrontend: (r) => ({
    id: String(r.id_usuario),
    tipo_documento: r.tipo_documento || "CC",
    numero_documento: r.numero_documento || "",
    ...splitNames(r.nombre, r.apellido),
    correo: r.correo || "",
    telefono: r.telefono || "",
    rol: String(r.rol_id || "Operador"),
    ultimoAcceso: r.sesion_acceso ? String(r.sesion_acceso) : "Nunca",
    estado: r.activo === 1 ? "Activo" : "Inactivo",
    fecha_creacion: r.fecha_creacion,
  }),
  toDatabase: (b) => ({
    rol_id: Number(b.rol_id) || 1,
    tipo_documento: b.tipo_documento || "CC",
    numero_documento: b.numero_documento,
    nombre: joinNames(b.primer_nombre, b.segundo_nombre),
    apellido: joinNames(b.primer_apellido, b.segundo_apellido),
    correo: b.correo,
    telefono: b.telefono || null,
    ...(b.contrasena ? { contrasena_hash: b.contrasena } : {}),
    activo: b.estado === "Inactivo" ? 0 : 1,
  }),
})

// 3. Tabla `empleado`
export const empleadosRouter = createCrudRouter({
  table: "empleado",
  primaryKey: "id_empleado",
  toFrontend: (r) => ({
    id: String(r.id_empleado),
    tipo_documento: r.tipo_documento || "CC",
    numero_documento: r.numero_documento || "",
    ...splitNames(r.nombre, r.apellido),
    cargo: r.cargo || "",
    telefono: r.telefono || "",
    correo: r.correo || "",
    vinculacion: "Fijo",
    estado: r.activo === 1 ? "Activo" : "Inactivo",
  }),
  toDatabase: (b) => ({
    tipo_documento: b.tipo_documento || "CC",
    numero_documento: b.numero_documento,
    nombre: joinNames(b.primer_nombre, b.segundo_nombre),
    apellido: joinNames(b.primer_apellido, b.segundo_apellido),
    cargo: b.cargo,
    telefono: b.telefono || null,
    correo: b.correo || null,
    activo: b.estado === "Inactivo" ? 0 : 1,
  }),
})

// 4. Tabla `proveedor`
export const proveedoresRouter = createCrudRouter({
  table: "proveedor",
  primaryKey: "id_proveedor",
  toFrontend: (r) => {
    const names = splitNames(r.contacto_nombre, r.contacto_apellido)
    return {
      id: String(r.id_proveedor),
      nit_documento: r.numero_documento || "",
      razon_social: r.razon_social || "",
      contacto_primer_nombre: names.primer_nombre,
      contacto_segundo_nombre: names.segundo_nombre,
      contacto_primer_apellido: names.primer_apellido,
      contacto_segundo_apellido: names.segundo_apellido,
      telefono: r.telefono || "",
      correo: r.correo || "",
      servicios: [],
      equipos: [],
      estado: r.estado === 1 ? "Activo" : "Inactivo",
      contratosCount: 0,
      historial: [],
      fecha_creacion: r.fecha_creacion,
    }
  },
  toDatabase: (b) => ({
    tipo_documento: "NIT",
    numero_documento: b.nit_documento,
    razon_social: b.razon_social,
    contacto_nombre: joinNames(
      b.contacto_primer_nombre,
      b.contacto_segundo_nombre,
    ),
    contacto_apellido: joinNames(
      b.contacto_primer_apellido,
      b.contacto_segundo_apellido,
    ),
    telefono: b.telefono || null,
    correo: b.correo || null,
    estado: b.estado === "Inactivo" ? 0 : 1,
  }),
})

// 5. Tabla `categoria_servicio`
export const categoriasServicioRouter = createCrudRouter({
  table: "categoria_servicio",
  primaryKey: "id_categoria_servicio",
  toFrontend: (r) => ({
    id: String(r.id_categoria_servicio),
    nombre: r.nombre,
    descripcion: "Categoría de servicios",
    estado: r.estado === 1 ? "Activo" : "Inactivo",
  }),
  toDatabase: (b) => ({
    nombre: b.nombre,
    estado: b.estado === "Inactivo" ? 0 : 1,
  }),
})

// 6. Tabla `servicio`
export const serviciosRouter = createCrudRouter({
  table: "servicio",
  primaryKey: "id_servicio",
  toFrontend: (r) => ({
    id: String(r.id_servicio),
    nombre: r.nombre,
    categoria: String(r.categoria_id || "Sonido"),
    tipo_cobro: "por_evento",
    descripcion: r.descripcion || "",
    precioBase: `$ ${Number(r.precio_base || 0).toLocaleString("es-CO")}`,
    precioBaseNum: Number(r.precio_base || 0),
    estado: r.estado === 1 ? "Activo" : "Inactivo",
  }),
  toDatabase: (b) => ({
    categoria_id: Number(b.categoria_id) || 1,
    nombre: b.nombre,
    descripcion: b.descripcion || null,
    precio_base:
      b.precioBaseNum ??
      (Number(String(b.precioBase || "0").replace(/[^0-9]/g, "")) || 0),
    estado: b.estado === "Inactivo" ? 0 : 1,
  }),
})

// 7. Tabla `categoria_equipo`
export const categoriasEquipoRouter = createCrudRouter({
  table: "categoria_equipo",
  primaryKey: "id_categoria_equipo",
  toFrontend: (r) => ({
    id: String(r.id_categoria_equipo),
    nombre: r.nombre,
    descripcion: "Categoría de equipos técnicos",
    estado: r.activo === 1 ? "Activo" : "Inactivo",
  }),
  toDatabase: (b) => ({
    nombre: b.nombre,
    activo: b.estado === "Inactivo" ? 0 : 1,
  }),
})

// 8. Tabla `equipo`
export const equiposRouter = createCrudRouter({
  table: "equipo",
  primaryKey: "id_equipo",
  toFrontend: (r) => ({
    id: String(r.id_equipo),
    codigo: `EQ-${String(r.id_equipo).padStart(3, "0")}`,
    nombre: r.nombre,
    serie: r.numero_serie || "",
    categoria: String(r.categoria_id || "Audio"),
    propiedad: r.tipo_propiedad === "alquilado" ? "Alquilado" : "Propio",
    estadoOperativo: r.estado || "Disponible",
    proveedor_id: r.proveedor_id,
  }),
  toDatabase: (b) => ({
    nombre: b.nombre,
    numero_serie: b.serie || null,
    tipo_propiedad: (b.propiedad || "propio").toLowerCase(),
    cantidad_total: 1,
    estado: (b.estadoOperativo || "disponible")
      .toLowerCase()
      .replace(/\s+/g, "_"),
    observaciones: b.observaciones || null,
    categoria_id: Number(b.categoria_id) || 1,
    proveedor_id: b.proveedor_id || null,
  }),
})

// 9. Tabla `cotizacion`
export const cotizacionesRouter = createCrudRouter({
  table: "cotizacion",
  primaryKey: "id_cotizacion",
  toFrontend: (r) => ({
    id: String(r.id_cotizacion),
    codigo: `COT-2026-${String(r.id_cotizacion).padStart(3, "0")}`,
    cliente: String(r.cliente_id || ""),
    cliente_id: String(r.cliente_id || ""),
    empleado_id: String(r.empleado_id || ""),
    nombre_evento: r.nombre_evento || "",
    direccion: r.ubicacion_evento || "",
    aforo_esperado: r.aforo_esperado,
    fecha: r.fecha_emision ? String(r.fecha_emision).slice(0, 10) : "",
    fechaVence: r.fecha_vencimiento
      ? String(r.fecha_vencimiento).slice(0, 10)
      : "",
    totalNum: Number(r.total_cotizado || 0),
    total: `$ ${Number(r.total_cotizado || 0).toLocaleString("es-CO")}`,
    estado: r.estado || "Borrador",
    notas: r.observaciones || "",
    url_documento: r.url_documento || "",
    servicios: [],
    montos: [],
  }),
  toDatabase: (b) => ({
    cliente_id: Number(b.cliente_id) || 1,
    empleado_id: Number(b.empleado_id) || 1,
    nombre_evento: b.nombre_evento || "Evento",
    ubicacion_evento: b.direccion || null,
    fecha_hora_inicio: b.fecha_evento ? `${b.fecha_evento} 08:00:00` : null,
    fecha_hora_fin: b.fecha_evento ? `${b.fecha_evento} 23:00:00` : null,
    presupuesto_estimado: b.totalNum || 0,
    estado: (b.estado || "borrador").toLowerCase(),
    aforo_esperado: b.aforo_esperado || 100,
    total_cotizado: b.totalNum || 0,
    observaciones: b.notas || null,
    fecha_emision: b.fecha || new Date().toISOString().slice(0, 10),
    fecha_vencimiento: b.fechaVence || null,
  }),
})

// 10. Tabla `venta`
export const ventasRouter = createCrudRouter({
  table: "venta",
  primaryKey: "id_venta",
  toFrontend: (r) => ({
    id: String(r.id_venta),
    codigo: `VEN-2026-${String(r.id_venta).padStart(3, "0")}`,
    numero_factura: r.numero_factura || "",
    tipo: "Cliente",
    clienteEvento: `Evento #${r.evento_id} - Cliente #${r.cliente_id}`,
    fecha: r.fecha_venta ? String(r.fecha_venta).slice(0, 10) : "",
    totalNum: Number(r.total || 0),
    total: `$ ${Number(r.total || 0).toLocaleString("es-CO")}`,
    estadoPago: r.estado || "Pendiente",
  }),
  toDatabase: (b) => ({
    evento_id: Number(b.evento_id) || 1,
    cliente_id: Number(b.cliente_id) || 1,
    numero_factura: b.numero_factura || `FACT-${Date.now()}`,
    total: b.totalNum || 0,
    estado: (b.estadoPago || "pendiente").toLowerCase(),
  }),
})

// 11. Tabla `evento`
export const eventosRouter = createCrudRouter({
  table: "evento",
  primaryKey: "id_evento",
  toFrontend: (r) => ({
    id: String(r.id_evento),
    cliente_id: r.cliente_id ? String(r.cliente_id) : null,
    cliente_nombre: r.cliente_id ? `Cliente #${r.cliente_id}` : "The High Events",
    cotizacion_id: String(r.cotizacion_id || ""),
    cotizacion_codigo: r.cotizacion_id ? `COT-${r.cotizacion_id}` : "",
    modalidad: r.modalidad === "propio" ? "Propio" : "Cliente",
    nombre: r.nombre_evento || "",
    direccion: r.ubicacion_evento || "",
    hora_inicio: r.fecha_hora_inicio ? String(r.fecha_hora_inicio) : "",
    hora_fin: r.fecha_hora_fin ? String(r.fecha_hora_fin) : "",
    presupuesto_estimado: Number(r.presupuesto_estimado || 0),
    estado: r.estado || "Planificación",
    fecha_creacion: r.fecha_creacion ? String(r.fecha_creacion) : "",
    aforo_esperado: String(r.aforo_esperado || ""),
    concepto_espectaculo: r.concepto_espectaculo || "",
    observaciones: r.observaciones || "",
    servicios: [],
  }),
  toDatabase: (b) => ({
    cliente_id: b.cliente_id ? Number(b.cliente_id) : null,
    cotizacion_id: b.cotizacion_id ? Number(b.cotizacion_id) : null,
    modalidad: (b.modalidad || "cliente").toLowerCase(),
    nombre_evento: b.nombre,
    ubicacion_evento: b.direccion,
    fecha_hora_inicio: b.hora_inicio,
    fecha_hora_fin: b.hora_fin,
    presupuesto_estimado: Number(b.presupuesto_estimado) || 0,
    estado: b.estado || "Planificación",
    aforo_esperado: parseInt(String(b.aforo_esperado || "0"), 10) || 0,
    concepto_espectaculo: b.concepto_espectaculo || null,
    observaciones: b.observaciones || null,
  }),
})

// 12. Tabla `agendamiento`
export const agendamientosRouter = createCrudRouter({
  table: "agendamiento",
  primaryKey: "id_agendamiento",
  toFrontend: (r) => {
    const dt = r.fecha_hora_inicio ? new Date(r.fecha_hora_inicio) : new Date()
    return {
      id: String(r.id_agendamiento),
      kind: r.tipo_agendamiento || "evento",
      tipo_agendamiento: r.tipo_agendamiento || "evento",
      title: r.titulo || "",
      type: r.tipo_agendamiento || "evento",
      time: dt.toTimeString().slice(0, 5),
      day: dt.getDate(),
      month: dt.getMonth(),
      year: dt.getFullYear(),
      client: r.cliente_id ? `Cliente #${r.cliente_id}` : "General",
      estado: r.estado || "Pendiente",
      venue: r.ubicacion || "",
    }
  },
  toDatabase: (b) => ({
    evento_id: b.evento_id ? Number(b.evento_id) : null,
    cliente_id: b.cliente_id ? Number(b.cliente_id) : null,
    titulo: b.title,
    tipo_agendamiento: b.tipo_agendamiento || "evento",
    fecha_hora_inicio: `${b.year}-${String(b.month + 1).padStart(2, "0")}-${String(b.day).padStart(2, "0")} ${b.time || "10:00"}:00`,
    estado: (b.estado || "pendiente").toLowerCase(),
    ubicacion: b.venue || null,
  }),
})

// 13. Tabla `incidente`
export const incidentesRouter = createCrudRouter({
  table: "incidente",
  primaryKey: "id_incidente",
  toFrontend: (r) => ({
    id: String(r.id_incidente),
    codigo: `INC-2026-${String(r.id_incidente).padStart(3, "0")}`,
    titulo: r.tipo_incidente || "Incidente",
    evento: `Evento #${r.evento_id}`,
    evento_id: r.evento_id,
    reporta: `Empleado #${r.responsable_id}`,
    reportado_por_id: r.responsable_id,
    tipo_incidente: r.tipo_incidente || "otro",
    criticidad: "Media",
    fecha: r.fecha_solucion ? String(r.fecha_solucion).slice(0, 10) : "",
    estado: r.estado || "Reportado",
    descripcion: r.descripcion || "",
    acciones_tomadas: r.acciones_tomadas || "",
  }),
  toDatabase: (b) => ({
    evento_id: Number(b.evento_id) || 1,
    responsable_id: Number(b.reportado_por_id) || 1,
    tipo_incidente: b.tipo_incidente || "otro",
    descripcion: b.descripcion || b.titulo,
    estado: (b.estado || "reportado").toLowerCase().replace(/\s+/g, "_"),
    acciones_tomadas: b.acciones_tomadas || b.accionCorrectiva || null,
  }),
})

// 14. Tabla `prestamo_equipo`
export const prestamosRouter = createCrudRouter({
  table: "prestamo_equipo",
  primaryKey: "id_prestamo_equipo",
  toFrontend: (r) => ({
    id: String(r.id_prestamo_equipo),
    codigo: `PR-${100 + Number(r.id_prestamo_equipo)}`,
    responsable: `Empleado #${r.empleado_id}`,
    responsable_id: r.empleado_id,
    evento: `Evento #${r.evento_id}`,
    evento_id: r.evento_id,
    equipos: [],
    fechaSalida: r.fecha_salida ? String(r.fecha_salida).slice(0, 10) : "",
    fechaDevolucion: r.fecha_devolucion
      ? String(r.fecha_devolucion).slice(0, 10)
      : "",
    estado: r.estado || "Activo",
  }),
  toDatabase: (b) => ({
    evento_id: Number(b.evento_id) || 1,
    empleado_id: Number(b.responsable_id) || 1,
    fecha_salida: b.fechaSalida,
    fecha_devolucion: b.fechaDevolucion || null,
    estado: (b.estado || "activo").toLowerCase().replace(/\s+/g, "_"),
  }),
})

// 15. Tabla `recepcion`
export const recepcionesRouter = createCrudRouter({
  table: "recepcion",
  primaryKey: "id_recepcion",
  toFrontend: (r) => ({
    id: String(r.id_recepcion),
    codigo: `RCP-2026-${String(r.id_recepcion).padStart(3, "0")}`,
    evento: `Evento #${r.evento_id}`,
    evento_id: r.evento_id,
    proveedor: `Proveedor #${r.proveedor_id}`,
    responsable_id: r.empleado_id,
    tipo:
      r.tipo_recepcion === "recepcion_desmontaje"
        ? "Recepción Desmontaje"
        : "Recepción Montaje",
    fecha: r.hora_registro ? String(r.hora_registro).slice(0, 10) : "",
    estado: r.estado_recepcion || "Pendiente",
    descripcion: r.observaciones || "",
    observaciones: r.observaciones || "",
    items: [],
  }),
  toDatabase: (b) => ({
    evento_id: Number(b.evento_id) || 1,
    proveedor_id: Number(b.proveedor_id) || 1,
    empleado_id: Number(b.responsable_id) || 1,
    tipo_recepcion:
      b.tipo === "Recepción Desmontaje"
        ? "recepcion_desmontaje"
        : "recepcion_montaje",
    estado_recepcion: (b.estado || "pendiente").toLowerCase(),
    observaciones: b.observaciones || null,
  }),
})

// 16. Tabla `tarea` (Catálogo Maestro de Tareas -> /api/tareas-catalogo)
export const tareasCatalogoRouter = createCrudRouter({
  table: "tarea",
  primaryKey: "id_tarea",
  toFrontend: (r) => ({
    id: String(r.id_tarea),
    codigo: `TAR-${String(r.id_tarea).padStart(3, "0")}`,
    nombre_tarea: r.nombre || "",
    descripcion: r.descripcion || "",
    fase_sugerida: "Montaje",
  }),
  toDatabase: (b) => ({
    nombre: b.nombre_tarea || b.nombre,
    descripcion: b.descripcion || null,
  }),
})

// 17. Tabla `evento_tarea` (Tareas Asignadas a Eventos -> /api/evento-tareas)
export const eventoTareasRouter = createCrudRouter({
  table: "evento_tarea",
  primaryKey: "id_evento_tarea",
  toFrontend: (r) => ({
    id: String(r.id_evento_tarea),
    tarea_id: String(r.tarea_id || ""),
    codigo_tarea: `TAR-${String(r.tarea_id || 1).padStart(3, "0")}`,
    tarea: `Tarea #${r.tarea_id}`,
    evento_id: r.evento_id,
    evento: `Evento #${r.evento_id}`,
    responsable_id: r.empleado_id,
    responsable: `Empleado #${r.empleado_id}`,
    fase: r.fase || "Montaje",
    prioridad: r.prioridad || "Media",
    fechaLimite: r.fecha_hora_inicio
      ? String(r.fecha_hora_inicio).slice(0, 10)
      : "",
    estado: r.estado || "Pendiente",
    notas: r.observaciones || "",
  }),
  toDatabase: (b) => ({
    evento_id: Number(b.evento_id) || 1,
    tarea_id: Number(b.tarea_id) || 1,
    empleado_id: Number(b.responsable_id) || 1,
    fase: (b.fase || "montaje").toLowerCase(),
    fecha_hora_inicio: b.fechaLimite ? `${b.fechaLimite} 08:00:00` : null,
    fecha_hora_fin: b.fechaLimite ? `${b.fechaLimite} 13:00:00` : null,
    estado: (b.estado || "pendiente").toLowerCase().replace(/\s+/g, "_"),
    prioridad: b.prioridad || "Media",
    observaciones: b.notas ? String(b.notas).slice(0, 45) : null,
  }),
})

// 18. Tablas `pago_cliente` / `pago_proveedor` (/api/abonos)
export const abonosRouter = createCrudRouter({
  table: "pago_cliente",
  primaryKey: "id_pago_cliente",
  toFrontend: (r) => {
    const montoNum = Number(r.monto || 0)
    const fmt = `$ ${montoNum.toLocaleString("es-CO")}`
    return {
      id: String(r.id_pago_cliente),
      tipoCartera: "Clientes",
      evento: `Venta #${r.venta_id}`,
      cliente: `Venta #${r.venta_id}`,
      total: fmt,
      totalNum: montoNum,
      anticipo: fmt,
      anticipoNum: montoNum,
      saldo: "$ 0",
      saldoNum: 0,
      estadoAnticipo: r.estado === "pagado" ? "Pagado" : "Pendiente",
      estadoSaldo: "Pendiente",
      porcentaje: r.estado === "pagado" ? 50 : 0,
      fechaPago: r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : "",
      observaciones: r.observaciones || "",
      historial: [],
    }
  },
  toDatabase: (b) => ({
    venta_id: Number(b.venta_id) || 1,
    tipo_pago: "anticipo",
    monto: b.totalNum || b.anticipoNum || 0,
    fecha_pago: b.fechaPago || new Date().toISOString().slice(0, 10),
    medio_pago: "transferencia",
    estado: b.estadoAnticipo === "Pagado" ? "pagado" : "pendiente",
    observaciones: b.observaciones || null,
  }),
})

