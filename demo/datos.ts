/** Datos ficticios: personas, empresas, documentos y teléfonos inventados; correos en un dominio reservado. */
const correo = (usuario: string) => `${usuario}@ejemplo.test`

const PERSONAS_CLIENTE = [
  ["Mariana", "Restrepo", "Laureles", "Medellín"],
  ["Santiago", "Ochoa", "El Poblado", "Medellín"],
  ["Valentina", "Muñoz", "Centro", "Envigado"],
  ["Julián", "Cardona", "Niquía", "Bello"],
] as const
const EMPRESAS = [
  ["Colegio Horizonte Azul", "900100201-1", "Paula Giraldo", "Itagüí"],
  ["Cafés del Valle Alto S.A.S.", "900100202-2", "Andrés Villa", "Rionegro"],
  ["Fundación Voces Nuevas", "900100203-3", "Laura Zapata", "Medellín"],
  ["TecnoAndes S.A.S.", "900100204-4", "Camilo Rojas", "Medellín"],
] as const

export const CLIENTES = [
  ...PERSONAS_CLIENTE.map(([nombre, apellido, barrio, ciudad], i) => ({
    tipo_cliente: "Natural",
    primer_nombre: nombre,
    primer_apellido: apellido,
    tipo_documento: "CC",
    numero_documento: `10000001${10 + i}`,
    correo: correo(`cliente${i + 1}`),
    telefono: `30000001${10 + i}`,
    direccion: `${barrio}, Calle ${40 + i} # ${10 + i}-25, ${ciudad}`,
  })),
  ...EMPRESAS.map(([razon, nit, contacto, ciudad], i) => ({
    tipo_cliente: "Empresa",
    razon_social: razon,
    contacto_nombre: contacto,
    tipo_documento: "NIT",
    numero_documento: nit,
    correo: correo(`empresa${i + 1}`),
    telefono: `60400002${10 + i}`,
    direccion: `Carrera ${50 + i} # ${20 + i}-14, ${ciudad}`,
  })),
]

export const EMPLEADOS = [
  ["Felipe", "Arango", "Ingeniero de Audio", "Fijo"],
  ["Daniela", "Mejía", "Coordinadora Logística", "Fijo"],
  ["Tomás", "Quintero", "Técnico de Luces", "Fijo"],
  ["Isabela", "Correa", "Directora de Escenografía", "Fijo"],
  ["Mateo", "Londoño", "Auxiliar de Montaje", "Por Evento"],
  ["Sofía", "Henao", "Fotógrafa", "Por Evento"],
  ["Nicolás", "Vélez", "DJ Residente", "Por Evento"],
  ["Gabriela", "Duque", "Videógrafa", "Por Evento"],
].map(([primer_nombre, primer_apellido, cargo, vinculacion], i) => ({
  tipo_documento: "CC",
  numero_documento: `10000002${10 + i}`,
  primer_nombre,
  primer_apellido,
  cargo,
  vinculacion,
  telefono: `30000003${10 + i}`,
  correo: correo(`empleado${i + 1}`),
}))

export const CATEGORIAS_SERVICIO = ["Sonido", "Iluminación", "Pantallas", "Estructuras", "Producción audiovisual", "DJs y artistas", "Logística", "Efectos especiales"]
export const CATEGORIAS_EQUIPO = ["Audio", "Iluminación", "Video", "Estructuras", "Efectos Especiales / Humo", "Accesorios"]

export const SERVICIOS = [
  ["Sonido profesional para 300 personas", "Sonido", "por_evento", 2_800_000],
  ["Iluminación robótica", "Iluminación", "por_evento", 1_900_000],
  ["Pantalla LED 4 x 3 m", "Pantallas", "por_dia", 2_400_000],
  ["Tarima 6 x 4 m", "Estructuras", "por_evento", 1_500_000],
  ["Fotografía y video", "Producción audiovisual", "por_hora", 180_000],
  ["DJ en vivo", "DJs y artistas", "por_hora", 250_000],
  ["Personal logístico", "Logística", "por_persona", 120_000],
  ["Chispas frías y CO2", "Efectos especiales", "por_evento", 850_000],
].map(([nombre, categoria, tipo_cobro, precioBaseNum]) => ({ nombre, categoria, tipo_cobro, precioBaseNum, descripcion: `Servicio de demostración: ${String(nombre).toLowerCase()}.` }))

export const PROVEEDORES = [
  ["Sonido Cumbre S.A.S.", "900200301-1", "Óscar", "Salazar", [0]],
  ["LuzViva Rental", "900200302-2", "Natalia", "Pineda", [1, 7]],
  ["Pantallas Norte S.A.S.", "900200303-3", "Esteban", "Gil", [2]],
  ["Estructuras Roca", "900200304-4", "Claudia", "Marín", [3]],
  ["Foco Audiovisual", "900200305-5", "Ricardo", "Ruiz", [4]],
  ["Apoyo Logístico ABC", "900200306-6", "Mónica", "Castaño", [6]],
].map(([razon_social, nit_documento, nombre, apellido, servicios], i) => ({
  razon_social,
  nit_documento,
  contacto_primer_nombre: nombre,
  contacto_primer_apellido: apellido,
  telefono: `60400005${10 + i}`,
  correo: correo(`proveedor${i + 1}`),
  servicios: (servicios as number[]).map((s) => SERVICIOS[s].nombre),
}))

/** El último número es la posición del proveedor; sin él, el equipo es propio. */
const EQUIPOS_BASE: [string, string, number, number?][] = [
  ["Consola digital 32 canales", "Audio", 14_000_000],
  ["Parlante activo 15 pulgadas A", "Audio", 3_200_000],
  ["Parlante activo 15 pulgadas B", "Audio", 3_200_000],
  ["Micrófono inalámbrico doble", "Audio", 1_800_000],
  ["Cabeza móvil beam A", "Iluminación", 4_500_000],
  ["Cabeza móvil beam B", "Iluminación", 4_500_000],
  ["Controlador DMX", "Iluminación", 2_600_000],
  ["Proyector 6000 lúmenes", "Video", 7_500_000],
  ["Máquina de humo 1500 W", "Efectos Especiales / Humo", 900_000],
  ["Kit de cableado y extensiones", "Accesorios", 650_000],
  ["Subwoofer doble 18 pulgadas", "Audio", 180_000, 0],
  ["Barra LED RGBW", "Iluminación", 90_000, 1],
  ["Módulos pantalla LED", "Video", 420_000, 2],
  ["Truss de aluminio 12 m", "Estructuras", 260_000, 3],
]
export const EQUIPOS = EQUIPOS_BASE.map(([nombre, categoria, costo, proveedor], i) => ({
  nombre,
  categoria,
  serie: `DEMO-${String(i + 1).padStart(3, "0")}`,
  proveedor,
  propiedad: proveedor === undefined ? "Propio" : "Alquilado",
  ...(proveedor === undefined ? { costo_adquisicion: costo } : { costo_alquiler: costo }),
}))

const modulo = (m: string, ...acciones: string[]) => acciones.map((a) => `${m}.${a}`)
const VER_TODO = ["cotizaciones", "eventos", "agendamiento", "clientes", "servicios", "tareas", "equipos", "prestamos", "recepciones", "incidentes", "proveedores", "empleados"].map((m) => `${m}.ver`)
export const ROLES = [
  { nombre: "Comercial (demo)", descripcion: "Clientes, cotizaciones y agenda", permisos: [...VER_TODO, ...modulo("clientes", "crear", "editar"), ...modulo("cotizaciones", "crear", "editar", "estado", "pdf"), ...modulo("agendamiento", "crear", "editar", "estado")] },
  { nombre: "Coordinador de eventos (demo)", descripcion: "Eventos, tareas y personal", permisos: ["dashboard.ver", "dashboard.agenda", ...VER_TODO, ...modulo("eventos", "crear", "editar", "estado"), ...modulo("tareas", "crear", "editar", "estado")] },
  { nombre: "Bodega (demo)", descripcion: "Equipos, préstamos y recepciones", permisos: [...VER_TODO, ...modulo("equipos", "crear", "editar", "estado", "categorias"), ...modulo("prestamos", "crear", "editar", "devolucion"), ...modulo("recepciones", "crear", "editar", "devolucion", "estado")] },
  { nombre: "Caja (demo)", descripcion: "Registra pagos sin confirmarlos", permisos: ["eventos.ver", "ventas.ver", "ventas.crear", "abonos.ver", "abonos.crear"] },
  { nombre: "Contabilidad (demo)", descripcion: "Verifica pagos", permisos: ["dashboard.ver", "eventos.ver", "ventas.ver", "ventas.comprobante", "abonos.ver", "abonos.crear", "abonos.editar", "abonos.estado"] },
]
export const USUARIOS = [
  ["Camila", "Torres"],
  ["David", "Escobar"],
  ["Jorge", "Bedoya"],
  ["Luisa", "Franco"],
  ["Manuela", "Gómez"],
].map(([primer_nombre, primer_apellido], i) => ({
  primer_nombre,
  primer_apellido,
  tipo_documento: "CC",
  numero_documento: `10000006${10 + i}`,
  correo: correo(`usuario${i + 1}`),
  telefono: `30000007${10 + i}`,
  rol: ROLES[i].nombre,
}))

/** Días respecto a hoy; las posiciones apuntan a las listas de arriba. */
export interface EventoDemo {
  nombre: string
  lugar: string
  dia: number
  horas: [string, string]
  /** Sin cliente = evento propio */
  cliente?: number
  estado: string
  /** Estado al cerrar la carga, si los documentos exigen empezar en otro */
  final?: string
  /** Valor del evento (lo acordado con el cliente o lo que se espera vender) */
  presupuesto: number
  aforo: number
  servicios: [servicio: number, proveedor: number | null, costo: number][]
  equipos: number[]
  responsable: number
}
export const EVENTOS: EventoDemo[] = [
  { nombre: "Grado Colegio Horizonte Azul", lugar: "Auditorio Horizonte, Itagüí", dia: -62, horas: ["15:00", "20:00"], cliente: 4, estado: "Cerrado financiero", presupuesto: 8_200_000, aforo: 350, servicios: [[0, 0, 2_100_000], [4, 4, 900_000]], equipos: [0, 1], responsable: 1 },
  { nombre: "Cumpleaños Mariana Restrepo", lugar: "Finca Los Almendros, Rionegro", dia: -33, horas: ["19:00", "23:30"], cliente: 0, estado: "Finalizado", presupuesto: 5_600_000, aforo: 120, servicios: [[5, null, 1_000_000], [1, 1, 1_300_000]], equipos: [4, 5], responsable: 0 },
  { nombre: "Lanzamiento Café Valle Alto", lugar: "Plaza Central, Rionegro", dia: -12, horas: ["10:00", "18:00"], cliente: 5, estado: "Finalizado", presupuesto: 11_400_000, aforo: 400, servicios: [[2, 2, 1_800_000], [6, 5, 1_200_000]], equipos: [7, 6], responsable: 1 },
  { nombre: "Concierto Voces Nuevas", lugar: "Teatro La Montaña, Medellín", dia: -1, horas: ["17:00", "22:00"], cliente: 6, estado: "Desmontaje", final: "Finalizado", presupuesto: 14_800_000, aforo: 600, servicios: [[0, 0, 2_300_000], [3, 3, 1_100_000]], equipos: [0, 1, 10], responsable: 2 },
  { nombre: "Cumbre TecnoAndes", lugar: "Centro de Eventos Andino, Medellín", dia: 0, horas: ["08:00", "23:00"], cliente: 7, estado: "En ejecución", presupuesto: 18_900_000, aforo: 500, servicios: [[2, 2, 1_900_000], [1, 1, 1_400_000], [4, 4, 1_000_000]], equipos: [2, 6, 11], responsable: 0 },
  { nombre: "Boda Valentina Muñoz", lugar: "Hacienda El Roble, Envigado", dia: 4, horas: ["16:00", "23:30"], cliente: 2, estado: "Montaje", presupuesto: 16_300_000, aforo: 220, servicios: [[0, 0, 2_000_000], [7, 1, 600_000]], equipos: [3, 8], responsable: 1 },
  { nombre: "Festival High Nights", lugar: "Parque Norte Alto, Medellín", dia: 11, horas: ["14:00", "23:00"], estado: "Confirmado", presupuesto: 32_000_000, aforo: 1500, servicios: [[0, 0, 4_200_000], [2, 2, 2_600_000], [3, 3, 1_800_000]], equipos: [4, 7, 12, 13], responsable: 3 },
  { nombre: "Fiesta de fin de año Ochoa", lugar: "Salón Mirador, Medellín", dia: 24, horas: ["18:00", "23:00"], cliente: 1, estado: "Confirmado", presupuesto: 9_700_000, aforo: 180, servicios: [[5, null, 1_250_000], [1, 1, 1_300_000]], equipos: [5, 9], responsable: 2 },
  { nombre: "Aniversario Cardona", lugar: "Club Campestre Norte, Bello", dia: 41, horas: ["17:00", "22:00"], cliente: 3, estado: "Planificación", presupuesto: 7_100_000, aforo: 150, servicios: [[4, 4, 720_000], [6, 5, 600_000]], equipos: [1, 8], responsable: 1 },
]

export interface CotizacionDemo {
  evento: string
  cliente: number
  dia: number
  estado: string
  servicios: [servicio: number, cantidad: number][]
}
// Las aceptadas cotizan los mismos servicios de su evento: el evento de cliente los toma de ahí
export const COTIZACIONES: CotizacionDemo[] = [
  { evento: "Cumbre TecnoAndes", cliente: 7, dia: 0, estado: "Aceptada", servicios: [[2, 1], [1, 1], [4, 8]] },
  { evento: "Boda Valentina Muñoz", cliente: 2, dia: 4, estado: "Aceptada", servicios: [[0, 1], [7, 1]] },
  { evento: "Aniversario Cardona", cliente: 3, dia: 41, estado: "Aceptada", servicios: [[4, 4], [6, 5]] },
  { evento: "Feria de proyectos", cliente: 4, dia: 55, estado: "Borrador", servicios: [[2, 2], [3, 1]] },
  { evento: "Cata nocturna", cliente: 5, dia: 30, estado: "Rechazada", servicios: [[1, 1], [5, 4]] },
  { evento: "Encuentro de voluntarios", cliente: 6, dia: 20, estado: "Enviada", servicios: [[0, 1], [6, 8]] },
]

export const REUNIONES = [
  { titulo: "Propuesta de boda", cliente: 2, dia: -20, hora: "10:00", estado: "Realizado", motivo: "Presentación de Propuesta", tipo: "reunion_cliente" },
  { titulo: "Firma contrato TecnoAndes", cliente: 7, dia: -9, hora: "15:30", estado: "Realizado", motivo: "Firma de Contrato", tipo: "reunion_cliente" },
  { titulo: "Cotización feria de proyectos", cliente: 4, dia: 2, hora: "09:00", estado: "Confirmado", motivo: "Reunión de Cotización", tipo: "reunion_cliente" },
  { titulo: "Seguimiento aniversario", cliente: 3, dia: 6, hora: "11:00", estado: "Pendiente", motivo: "Seguimiento Comercial", tipo: "reunion_cliente" },
  { titulo: "Visita técnica voluntariado", cliente: 6, dia: 9, hora: "14:00", estado: "Pendiente", motivo: "Reunión de Cotización", tipo: "visita_tecnica" },
  { titulo: "Reunión café de temporada", cliente: 5, dia: 13, hora: "16:00", estado: "Cancelado", motivo: "Seguimiento Comercial", tipo: "otro" },
]

/** Ventas: evento, días desde hoy y cuotas ya registradas (`verificado` = confirmadas). */
export const VENTAS: { evento: number; dia: number; pagos: { tipo: "Anticipo" | "Saldo"; dia: number; verificado: boolean }[] }[] = [
  { evento: 0, dia: -80, pagos: [{ tipo: "Anticipo", dia: -78, verificado: true }, { tipo: "Saldo", dia: -58, verificado: true }] },
  { evento: 1, dia: -50, pagos: [{ tipo: "Anticipo", dia: -48, verificado: true }, { tipo: "Saldo", dia: -30, verificado: true }] },
  { evento: 2, dia: -27, pagos: [{ tipo: "Anticipo", dia: -25, verificado: true }, { tipo: "Saldo", dia: -8, verificado: true }] },
  { evento: 3, dia: -18, pagos: [{ tipo: "Anticipo", dia: -16, verificado: true }] },
  { evento: 4, dia: -9, pagos: [{ tipo: "Anticipo", dia: -7, verificado: true }] },
  { evento: 5, dia: -5, pagos: [{ tipo: "Anticipo", dia: -3, verificado: false }] },
  { evento: 7, dia: -1, pagos: [] },
]

export const TAREAS = [
  { evento: 3, tarea: "Desmontaje y devolución de equipos", empleado: 4, fase: "Desmontaje", prioridad: "Alta", estado: "En Proceso" },
  { evento: 4, tarea: "Coordinación de ejecución", empleado: 1, fase: "Ejecución", prioridad: "Alta", estado: "En Proceso" },
  { evento: 4, tarea: "Montaje de sonido", empleado: 0, fase: "Montaje", prioridad: "Alta", estado: "Completada" },
  { evento: 5, tarea: "Montaje de iluminación", empleado: 2, fase: "Montaje", prioridad: "Media", estado: "Pendiente" },
  { evento: 6, tarea: "Visita técnica a la locación", empleado: 3, fase: "Planificación", prioridad: "Media", estado: "Pendiente" },
  { evento: 7, tarea: "Recepción de equipos de proveedores", empleado: 4, fase: "Montaje", prioridad: "Baja", estado: "Pendiente" },
]
export const TAREAS_CATALOGO: [string, string, string][] = [
  ["Visita técnica a la locación", "Inspección de espacio, energía y accesos", "Planificación"],
  ["Montaje de sonido", "Instalación y prueba de sistema de sonido", "Montaje"],
  ["Montaje de iluminación", "Instalación y programación de luces", "Montaje"],
  ["Recepción de equipos de proveedores", "Inspección conjunta y formato de entrega", "Montaje"],
  ["Coordinación de ejecución", "Supervisión de servicios durante el evento", "Ejecución"],
  ["Desmontaje y devolución de equipos", "Verificación de cantidad y estado", "Desmontaje"],
]

export const INCIDENTES = [
  { evento: 0, tipo: "retraso_montaje", criticidad: "Media", titulo: "Retraso en el ingreso al auditorio", estado: "Solucionado", accion: "Se reorganizó el montaje con personal adicional.", costo: 0 },
  { evento: 1, tipo: "falla_electrica", criticidad: "Alta", titulo: "Caída de una fase eléctrica", estado: "Solucionado", accion: "Se conectó la planta de respaldo.", costo: 350_000 },
  { evento: 2, tipo: "inconveniente_proveedor", criticidad: "Media", titulo: "Módulo de pantalla sin señal", estado: "Solucionado", accion: "El proveedor reemplazó el módulo.", costo: 0 },
  { evento: 3, tipo: "dano_equipo", criticidad: "Alta", titulo: "Cable de señal dañado", estado: "En Atención", accion: "Se usa un cable de repuesto mientras se repara.", costo: 80_000 },
  { evento: 4, tipo: "corte_agua", criticidad: "Baja", titulo: "Corte de agua en camerinos", estado: "Reportado", accion: "", costo: 0 },
  { evento: 4, tipo: "seguridad_orden_publico", criticidad: "Crítica", titulo: "Aforo cercano al límite en el ingreso", estado: "Escalado", accion: "Se reforzó el control de acceso.", costo: 200_000 },
]
