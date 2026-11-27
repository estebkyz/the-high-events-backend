import crypto from "node:crypto"
import type { AddressInfo } from "node:net"
import { app } from "../src/app.js"
import { env } from "../src/config/env.js"
import { pool, query } from "../src/config/db.js"
import { signToken } from "../src/middleware/auth.js"
import { pad } from "../src/utils/format.js"
import * as D from "./datos.js"

/**
 * Llena la base con datos ficticios a través de la propia API, así que cumplen todas sus reglas y generan
 * sus documentos (préstamos y recepciones). Solo agrega: se puede repetir sin duplicar ni tocar lo existente.
 */
type Obj = Record<string, any>

let url = ""
let token = ""
async function api(metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
  const r = await fetch(url + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  if (r.status === 429) {
    console.log("Límite de escrituras: espero un minuto…")
    await new Promise((ok) => setTimeout(ok, 61_000))
    return api(metodo, ruta, cuerpo)
  }
  const datos = await r.json()
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${datos.message} ${JSON.stringify(cuerpo)?.slice(0, 160) ?? ""}`)
  return datos
}

const resumen: Record<string, number> = {}
/** Devuelve los registros en el orden pedido: usa los que ya existen y crea los que faltan. */
async function asegurar<T>(ruta: string, deseados: T[], igual: (existente: Obj, d: T) => boolean, datos: (d: T) => Obj): Promise<Obj[]> {
  const existentes: Obj[] = await api("GET", ruta)
  const out: Obj[] = []
  for (const d of deseados) {
    const previo = existentes.find((e) => igual(e, d))
    if (!previo) resumen[ruta] = (resumen[ruta] ?? 0) + 1
    out.push(previo ?? (await api("POST", ruta, datos(d))))
  }
  return out
}

const hoy = new Date()
function fecha(dias: number): string {
  const d = new Date(hoy)
  d.setDate(d.getDate() + dias)
  return d.toLocaleDateString("sv-SE")
}
const porNombre = (nombres: string[]) => nombres.map((nombre) => ({ nombre, descripcion: nombre }))
const porDocumento = (e: Obj, d: { numero_documento: string }) => e.numero_documento === d.numero_documento
const mismoNombre = (e: Obj, d: { nombre: unknown }) => e.nombre === d.nombre

async function personas() {
  const roles = await asegurar("/roles", D.ROLES, mismoNombre, ({ nombre, descripcion }) => ({ nombre, descripcion, estado: "Activo" }))
  for (const [i, rol] of roles.entries()) {
    // Los permisos que alguien haya ajustado después no se reescriben
    const actuales: string[] = await api("GET", `/roles/${rol.id}/permisos`)
    if (!actuales.length) await api("PUT", `/roles/${rol.id}/permisos`, D.ROLES[i].permisos)
  }
  // Sin DEMO_PASSWORD nadie conoce la clave: el administrador la restablece desde Usuarios
  const clave = process.env.DEMO_PASSWORD?.trim() || `Aa1${crypto.randomBytes(18).toString("base64url")}`
  await asegurar("/usuarios", D.USUARIOS, porDocumento, (u) => ({ ...u, contrasena: clave, estado: "Activo" }))
  return {
    clientes: await asegurar("/clientes", D.CLIENTES, porDocumento, (c) => ({ ...c, estado: "Activo" })),
    empleados: await asegurar("/empleados", D.EMPLEADOS, porDocumento, (e) => ({ ...e, estado: "Activo" })),
  }
}

async function catalogos() {
  await asegurar("/categorias-servicio", porNombre(D.CATEGORIAS_SERVICIO), mismoNombre, (c) => c)
  await asegurar("/categorias-equipo", porNombre(D.CATEGORIAS_EQUIPO), mismoNombre, (c) => c)
  const tareas = await asegurar(
    "/tareas-catalogo",
    D.TAREAS_CATALOGO,
    (e, [nombre]) => e.nombre_tarea === nombre,
    ([nombre_tarea, descripcion, fase_sugerida]) => ({ nombre_tarea, descripcion, fase_sugerida }),
  )
  const servicios = await asegurar("/servicios", D.SERVICIOS, mismoNombre, (s) => ({ ...s, estado: "Activo" }))
  const proveedores = await asegurar(
    "/proveedores",
    D.PROVEEDORES,
    (e, p) => e.nit_documento === p.nit_documento,
    (p) => ({ ...p, estado: "Activo" }),
  )
  const equipos = await asegurar(
    "/equipos",
    D.EQUIPOS,
    (e, q) => e.serie === q.serie,
    ({ proveedor, ...q }) => ({ ...q, proveedor_id: proveedor === undefined ? null : proveedores[proveedor].id, estadoOperativo: "Disponible", mantenimiento_proximo: fecha(90) }),
  )
  return { tareas, servicios, proveedores, equipos }
}

type Contexto = Awaited<ReturnType<typeof personas>> & Awaited<ReturnType<typeof catalogos>>

/**
 * Cada evento de cliente nace de su cotización (así funciona v3); los propios se crean directo.
 * Las cotizaciones de la lista se usan tal cual; los demás eventos de cliente reciben una aceptada.
 */
function cotizacionesDe(): D.CotizacionDemo[] {
  const listadas = new Set(D.COTIZACIONES.map((x) => x.evento))
  const derivadas = D.EVENTOS.filter((e) => e.cliente !== undefined && !listadas.has(e.nombre)).map((e) => ({
    evento: e.nombre,
    cliente: e.cliente!,
    dia: e.dia,
    estado: "Aceptada",
    servicios: e.servicios.map(([s]) => [s, 1] as [number, number]),
  }))
  return [...derivadas, ...D.COTIZACIONES]
}

/**
 * Precios del detalle. Si la cotización aceptada tiene evento, sus precios se escalan para que el total
 * sea el valor del evento (el valor de un evento de cliente sale de su cotización aceptada).
 */
function detallesDe(c: Contexto, x: D.CotizacionDemo, ev: D.EventoDemo | undefined) {
  const base = x.servicios.map(([s, cantidad]) => ({ servicio_id: c.servicios[s].id, nombre: c.servicios[s].nombre, cantidad, precio_unitario: c.servicios[s].precioBaseNum as number }))
  if (!ev || x.estado !== "Aceptada") return base
  const bruto = base.reduce((t, d) => t + d.cantidad * d.precio_unitario, 0)
  const escalados = base.map((d) => ({ ...d, precio_unitario: Math.round((d.precio_unitario * ev.presupuesto) / bruto / 1000) * 1000 }))
  // El redondeo se ajusta en el primer servicio
  const resto = ev.presupuesto - escalados.reduce((t, d) => t + d.cantidad * d.precio_unitario, 0)
  escalados[0].precio_unitario += Math.round((resto / escalados[0].cantidad) * 100) / 100
  return escalados
}

const cotizaciones = (c: Contexto) =>
  asegurar(
    "/cotizaciones",
    cotizacionesDe(),
    (e, x) => e.nombre_evento === x.evento,
    (x) => {
      const ev = D.EVENTOS.find((e) => e.nombre === x.evento)
      return {
        cliente_id: c.clientes[x.cliente].id,
        empleado_id: c.empleados[1].id,
        nombre_evento: x.evento,
        fecha_evento: fecha(x.dia),
        hora_inicio: ev?.horas[0] ?? "16:00",
        hora_fin: ev?.horas[1] ?? "22:00",
        direccion: ev?.lugar ?? `Por definir · ${x.evento}`,
        aforo_esperado: ev?.aforo ?? 200,
        fecha: fecha(Math.min(-1, x.dia - 30)),
        fechaVence: fecha(Math.max(5, x.dia)),
        estado: x.estado,
        notas: "Cotización de demostración.",
        detalles: detallesDe(c, x, ev),
      }
    },
  )

const MARCA = "Datos ficticios."

/** Los propios se crean; los de cliente ya existen por su cotización y aquí se completan una sola vez. */
async function eventos(c: Contexto): Promise<Obj[]> {
  const datos = (e: D.EventoDemo) => ({
    modalidad: e.cliente === undefined ? "Propio" : "Cliente",
    cliente_id: e.cliente === undefined ? null : c.clientes[e.cliente].id,
    responsable_id: c.empleados[e.responsable].id,
    nombre: e.nombre,
    direccion: e.lugar,
    hora_inicio: `${fecha(e.dia)}T${e.horas[0]}`,
    hora_fin: `${fecha(e.dia)}T${e.horas[1]}`,
    // El de cliente lo fija su cotización aceptada
    ...(e.cliente === undefined && { valor_total: e.presupuesto }),
    presupuesto_estimado: Math.round(e.presupuesto * 0.6),
    estado: e.estado,
    aforo_esperado: String(e.aforo),
    concepto_evento: "Evento de demostración",
    observaciones: MARCA,
    servicios: e.servicios.map(([s]) => c.servicios[s].nombre),
    serviciosDetalles: e.servicios.map(([s, p, costo]) => ({ nombre: c.servicios[s].nombre, servicio_catalogo_id: c.servicios[s].id, proveedor_id: p === null ? null : c.proveedores[p].id, costo, cantidad: 1 })),
    empleadosAsignados: [],
    equiposAsignados: e.equipos.map((q) => c.equipos[q].id),
  })
  const out: Obj[] = []
  for (const e of D.EVENTOS) {
    const existentes: Obj[] = await api("GET", "/eventos")
    const previo = existentes.find((x) => x.nombre === e.nombre)
    if (!previo) {
      resumen["/eventos"] = (resumen["/eventos"] ?? 0) + 1
      out.push(await api("POST", "/eventos", datos(e)))
    } else if (previo.observaciones !== MARCA) {
      resumen["/eventos (completados)"] = (resumen["/eventos (completados)"] ?? 0) + 1
      out.push(await api("PUT", `/eventos/${previo.id}`, { ...previo, ...datos(e) }))
    } else out.push(previo)
  }
  return out
}

/** Salida, llegada y regreso de equipos: un evento completo, uno en curso y el resto en borrador. */
async function documentos(evs: Obj[]) {
  const CONCLUIDO = 3
  const EN_CURSO = 4
  const POR_SALIR = 5
  for (const i of [CONCLUIDO, EN_CURSO, POR_SALIR]) {
    const prestamos: Obj[] = await api("GET", "/prestamos")
    for (const p of prestamos.filter((x) => String(x.evento_id) === evs[i].id && x.estado === "Programado"))
      await api("PUT", `/prestamos/${p.id}`, { ...p, estado: "Activo" })
  }
  const confirmar = async (evento: Obj, tipo: string) => {
    const actas: Obj[] = await api("GET", "/recepciones")
    for (const r of actas.filter((x) => String(x.evento_id) === evento.id && x.tipo === tipo && x.estado === "Pendiente"))
      await api("PUT", `/recepciones/${r.id}`, { ...r, estado: "Conforme" })
  }
  for (const i of [CONCLUIDO, EN_CURSO]) await confirmar(evs[i], "Recepción Montaje")
  await confirmar(evs[CONCLUIDO], "Recepción Desmontaje")
  for (const [i, e] of D.EVENTOS.entries())
    if (e.final && evs[i].estado !== e.final) await api("PUT", `/eventos/${evs[i].id}`, { ...(await api("GET", `/eventos/${evs[i].id}`)), estado: e.final })
}

async function dinero(c: Contexto, evs: Obj[]) {
  const numero = (evento: number) => `DEMO-${pad(evento + 1, 4)}`
  const ventas = await asegurar(
    "/ventas",
    D.VENTAS,
    (e, v) => e.numero_factura === numero(v.evento),
    (v) => ({ evento_id: evs[v.evento].id, numero_factura: numero(v.evento), fecha: fecha(v.dia) }),
  )
  const pagar = async (ref: string, pagos: Obj[], extra: Obj = {}) => {
    const actual = await api("GET", `/abonos/${ref}`)
    // La referencia identifica cada pago: al repetir la carga no se registra otra vez
    const nuevos = pagos.filter((p) => !actual.historial.some((h: Obj) => h.comprobante === p.comprobante))
    if (!nuevos.length) return
    resumen["/abonos (pagos)"] = (resumen["/abonos (pagos)"] ?? 0) + nuevos.length
    await api("PUT", `/abonos/${ref}`, { ...extra, historial: nuevos })
  }
  const cuota = (a: Obj, tipo: string) => (tipo === "Anticipo" ? a.anticipoNum : a.saldoNum)
  for (const [i, v] of D.VENTAS.entries()) {
    const ref = `C-${ventas[i].id}`
    const a = await api("GET", `/abonos/${ref}`)
    await pagar(
      ref,
      v.pagos.map((p) => ({ tipoPago: p.tipo, montoNum: cuota(a, p.tipo), fecha: fecha(p.dia), metodo: i % 2 ? "Efectivo" : "Transferencia", comprobante: `${numero(v.evento)}-${p.tipo}`, estado: p.verificado ? "Pagado" : "Pendiente" })),
    )
  }
  for (const [i, e] of D.EVENTOS.entries()) {
    if (i === 8) continue // aún en planificación
    const terminado = e.estado === "Finalizado" || e.estado === "Cerrado financiero"
    for (const p of new Set(e.servicios.flatMap(([, prov]) => (prov === null ? [] : [prov])))) {
      const ref = `P-${evs[i].id}-${c.proveedores[p].id}`
      const a = await api("GET", `/abonos/${ref}`)
      const tipos = terminado ? ["Anticipo", "Saldo"] : ["Anticipo"]
      await pagar(
        ref,
        tipos.map((tipo) => ({ tipoPago: tipo, montoNum: cuota(a, tipo), fecha: fecha(Math.min(0, tipo === "Saldo" ? e.dia + 3 : e.dia - 6)), metodo: "Transferencia", comprobante: `${numero(i)}-P${p + 1}-${tipo}`, estado: "Pagado" })),
        { cumplimientoVerificado: true },
      )
    }
  }
}

async function operacion(c: Contexto, evs: Obj[]) {
  await asegurar(
    "/agendamientos",
    D.REUNIONES,
    (e, r) => e.title === r.titulo,
    (r) => {
      const [year, month, day] = fecha(r.dia).split("-").map(Number)
      const [h, m] = r.hora.split(":").map(Number)
      const fin = `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      return { tipo_agendamiento: r.tipo, title: r.titulo, time: r.hora, timeEnd: fin, day, month: month - 1, year, cliente_id: c.clientes[r.cliente].id, responsable_id: c.empleados[r.cliente % 2].id, estado: r.estado, motivo: r.motivo, notas: "Reunión de demostración.", fechaTentativaEvento: fecha(r.dia + 30) }
    },
  )
  await asegurar(
    "/evento-tareas",
    D.TAREAS,
    (e, t) => e.evento === D.EVENTOS[t.evento].nombre && e.tarea === t.tarea,
    (t) => ({ evento_id: evs[t.evento].id, tarea: t.tarea, responsable_id: c.empleados[t.empleado].id, fase: t.fase, prioridad: t.prioridad, fechaLimite: fecha(D.EVENTOS[t.evento].dia), hora_inicio_estimada: "08:00", hora_fin_estimada: "12:00", estado: t.estado, notas: "Tarea de demostración." }),
  )
  await asegurar(
    "/incidentes",
    D.INCIDENTES,
    (e, x) => e.titulo === x.titulo,
    (x) => ({ evento_id: evs[x.evento].id, reportado_por_id: c.empleados[4].id, tipo_incidente: x.tipo, criticidad: x.criticidad, titulo: x.titulo, descripcion: `${x.titulo} (registro de demostración).`, estado: x.estado, accionCorrectiva: x.accion }),
  )
}

async function iniciarSesion() {
  const [admin] = await query<{ id: number; hash: string }>(
    `SELECT u.id_usuario AS id, u.contrasena_hash AS hash FROM usuario u JOIN rol r ON r.id_rol = u.rol_id AND r.estado = 1
      WHERE u.activo = 1 AND (SELECT COUNT(*) FROM rol_privilegio rp WHERE rp.rol_id = r.id_rol) = (SELECT COUNT(*) FROM privilegio)
      ORDER BY u.id_usuario LIMIT 1`,
  )
  if (!admin) throw new Error("No hay un administrador con todos los permisos: ejecute antes `npm run seed`")
  token = signToken(admin.id, admin.hash)
}

const RUTAS = ["clientes", "empleados", "usuarios", "roles", "categorias-servicio", "servicios", "proveedores", "categorias-equipo", "equipos", "cotizaciones", "eventos", "agendamientos", "ventas", "abonos", "tareas-catalogo", "evento-tareas", "prestamos", "recepciones", "incidentes"]

if (env.isProd) throw new Error("Los datos ficticios no se cargan con NODE_ENV=production")
const server = app.listen(0, "127.0.0.1")
try {
  await new Promise((ok) => server.once("listening", ok))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
  await iniciarSesion()
  const contexto: Contexto = { ...(await personas()), ...(await catalogos()) }
  await cotizaciones(contexto)
  const evs = await eventos(contexto)
  await documentos(evs)
  await dinero(contexto, evs)
  await operacion(contexto, evs)
  console.log("Agregados:", resumen)
  const totales = await Promise.all(RUTAS.map(async (r) => [r, (await api("GET", `/${r}`)).length] as const))
  console.log("Total por módulo:", Object.fromEntries(totales))
} catch (e) {
  console.error("[demo]", e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  server.closeAllConnections()
  server.close()
  await pool.end()
}
