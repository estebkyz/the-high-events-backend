import assert from "node:assert/strict"
import { test } from "node:test"
import { administrador, api, baseEvento, CLIENTE, EMPLEADO, entorno, ok, sql, type Persona } from "./ayuda.js"

/** Reglas del modelo v3: el evento es la única fuente de sus datos y de su valor. */
let admin: Persona
let cliente: { id: string }
let asesor: { id: string }
let servicio: { id: string; nombre: string }
entorno(async () => {
  admin = await administrador()
  cliente = ok(await api("POST", "/clientes", admin.token, { ...CLIENTE, numero_documento: "52777001", correo: "m1@ejemplo.test" }), 201)
  asesor = ok(await api("POST", "/empleados", admin.token, { ...EMPLEADO, numero_documento: "71777001" }), 201)
  servicio = ok(await api("POST", "/servicios", admin.token, { nombre: "Sonido demo", categoria: "Sonido", tipo_cobro: "por_evento", precioBaseNum: 500_000 }), 201)
})

const cotizacion = (extra: object = {}) => ({
  cliente_id: cliente.id,
  empleado_id: asesor.id,
  nombre_evento: "Grado de prueba",
  direccion: "Salón Modelo 1",
  fecha_evento: "2031-03-10",
  hora_inicio: "18:00",
  hora_fin: "23:00",
  aforo_esperado: 150,
  fecha: "2026-11-01",
  fechaVence: "2026-12-01",
  detalles: [{ servicio_id: servicio.id, nombre: servicio.nombre, cantidad: 2, precio_unitario: 500_000 }],
  ...extra,
})

test("crear una cotización crea su evento en estado de cotización, sin repetir datos", async () => {
  const c = ok(await api("POST", "/cotizaciones", admin.token, cotizacion()), 201)
  assert.equal(c.totalNum, 1_000_000)
  const ev = ok(await api("GET", `/eventos/${c.evento_id}`, admin.token))
  assert.deepEqual([ev.estado, ev.nombre, ev.direccion, ev.hora_inicio], ["Cotización", "Grado de prueba", "Salón Modelo 1", "2031-03-10T18:00"])
  assert.equal(ev.valor_total, undefined)
  const [fila] = await sql("SELECT * FROM cotizacion WHERE id_cotizacion = ?", [c.id])
  assert.equal("nombre_evento" in fila || "total_cotizado" in fila || "cliente_id" in fila, false)
})

test("editar la cotización cambia el evento mientras está en cotización", async () => {
  const c = ok(await api("POST", "/cotizaciones", admin.token, cotizacion({ direccion: "Salón Modelo 2" })), 201)
  ok(await api("PUT", `/cotizaciones/${c.id}`, admin.token, { ...c, nombre_evento: "Grado editado" }))
  assert.equal(ok(await api("GET", `/eventos/${c.evento_id}`, admin.token)).nombre, "Grado editado")
})

test("aceptar fija el valor del evento y lo planifica; después, el evento manda", async () => {
  const c = ok(await api("POST", "/cotizaciones", admin.token, cotizacion({ direccion: "Salón Modelo 3" })), 201)
  ok(await api("PUT", `/cotizaciones/${c.id}`, admin.token, { estado: "Aceptada" }))
  const ev = ok(await api("GET", `/eventos/${c.evento_id}`, admin.token))
  assert.deepEqual([ev.estado, ev.valor_total], ["Planificación", 1_000_000])
  assert.equal((await api("PUT", `/cotizaciones/${c.id}`, admin.token, { direccion: "Otro lugar" })).status, 409)
  // Una sola aceptada por evento
  const [{ n }] = await sql("SELECT COUNT(*) AS n FROM cotizacion WHERE evento_id = ? AND estado = 'aceptada'", [c.evento_id])
  assert.equal(n, 1)
})

test("rechazar la única oferta cancela el evento; borrarla lo elimina", async () => {
  const a = ok(await api("POST", "/cotizaciones", admin.token, cotizacion({ direccion: "Salón Modelo 4" })), 201)
  ok(await api("PUT", `/cotizaciones/${a.id}`, admin.token, { estado: "Rechazada" }))
  assert.equal(ok(await api("GET", `/eventos/${a.evento_id}`, admin.token)).estado, "Cancelado")
  const b = ok(await api("POST", "/cotizaciones", admin.token, cotizacion({ direccion: "Salón Modelo 5" })), 201)
  ok(await api("DELETE", `/cotizaciones/${b.id}`, admin.token))
  assert.equal((await api("GET", `/eventos/${b.evento_id}`, admin.token)).status, 404)
})

test("un evento en cotización puede no tener fecha; planificado, no", async () => {
  const c = ok(await api("POST", "/cotizaciones", admin.token, cotizacion({ fecha_evento: "", hora_inicio: "", hora_fin: "", direccion: "" })), 201)
  ok(await api("PUT", `/cotizaciones/${c.id}`, admin.token, { estado: "Aceptada" }))
  const ev = ok(await api("GET", `/eventos/${c.evento_id}`, admin.token))
  assert.deepEqual([ev.hora_inicio, ev.estado], ["", "Cotización"], "aceptada sin fecha sigue en cotización")
  assert.equal((await api("PUT", `/eventos/${ev.id}`, admin.token, { ...ev, estado: "Planificación", responsable_id: asesor.id })).status, 400)
})

test("la venta toma el valor y el cliente del evento; una sola vigente", async () => {
  const { evento: sinValor } = await baseEvento(admin.token, { direccion: "Salón Modelo 6", valor_total: undefined })
  assert.equal((await api("POST", "/ventas", admin.token, { evento_id: sinValor.id, numero_factura: "MOD-0", fecha: "2026-11-20" })).status, 409)
  const { evento } = await baseEvento(admin.token, { direccion: "Salón Modelo 6b", valor_total: 2_500_000 })
  const v = ok(await api("POST", "/ventas", admin.token, { evento_id: evento.id, numero_factura: "MOD-1", fecha: "2026-11-20" }), 201)
  assert.equal(v.totalNum, 2_500_000)
  assert.equal((await api("POST", "/ventas", admin.token, { evento_id: evento.id, numero_factura: "MOD-2", fecha: "2026-11-20" })).status, 409)
  const [fila] = await sql("SELECT * FROM venta WHERE id_venta = ?", [v.id])
  assert.equal("total" in fila || "cliente_id" in fila, false)
})

test("el valor de un evento de cliente es el de su cotización aceptada", async () => {
  const { evento, cotizacion } = await baseEvento(admin.token, { direccion: "Salón Modelo 13", valor_total: 3_000_000 })
  assert.equal(evento.valor_total, 3_000_000)
  assert.equal((await api("PUT", `/eventos/${evento.id}`, admin.token, { ...evento, valor_total: 3_500_000 })).status, 409)
  ok(await api("PUT", `/eventos/${evento.id}`, admin.token, { ...evento, aforo_esperado: "120" }))
  // Para cambiarlo: la cotización vuelve a borrador, se ajusta el precio y se acepta de nuevo
  const cot = ok(await api("PUT", `/cotizaciones/${cotizacion.id}`, admin.token, { estado: "Borrador" }))
  const detalles = cot.detalles.map((d: object) => ({ ...d, precio_unitario: 3_400_000 }))
  ok(await api("PUT", `/cotizaciones/${cotizacion.id}`, admin.token, { ...cot, detalles, estado: "Aceptada" }))
  const nuevo = ok(await api("GET", `/eventos/${evento.id}`, admin.token))
  assert.deepEqual([nuevo.valor_total, nuevo.estado], [3_400_000, "Planificación"])
  // Un evento propio sí define su valor, sin bajar de lo abonado
  const propio = ok(await api("POST", "/eventos", admin.token, { modalidad: "Propio", responsable_id: asesor.id, nombre: "Show valor", concepto_evento: "Show", direccion: "Salón Modelo 14", hora_inicio: "2031-09-01T18:00", hora_fin: "2031-09-01T22:00", valor_total: 1_000_000 }), 201)
  assert.equal(ok(await api("PUT", `/eventos/${propio.id}`, admin.token, { ...propio, valor_total: 1_200_000 })).valor_total, 1_200_000)
})

test("recepciones: una sola entrega por proveedor en cada evento", async () => {
  const prov = ok(await api("POST", "/proveedores", admin.token, { nit_documento: "900777001", razon_social: "Proveedor Modelo", contacto_primer_nombre: "A", contacto_primer_apellido: "B", telefono: "3001112233", correo: "pm@ejemplo.test", servicios: [] }), 201)
  const eq = ok(await api("POST", "/equipos", admin.token, { nombre: "Truss modelo", categoria: "Estructuras", propiedad: "Alquilado", proveedor_id: prov.id, serie: "MOD-1" }), 201)
  const { evento, empleado } = await baseEvento(admin.token, { direccion: "Salón Modelo 7", equiposAsignados: [eq.id] })
  const actas = (await api("GET", "/recepciones", admin.token)).body.filter((r: { evento_id: number }) => String(r.evento_id) === evento.id)
  assert.equal(actas.length, 1, "el evento prepara un acta por proveedor")
  const acta = { evento_id: evento.id, proveedor: "Proveedor Modelo", responsable_id: empleado.id, tipo: "Recepción Montaje", fecha: "2030-05-10", estado: "Conforme", items: [{ equipo_id: eq.id, cantidad: 1, estado: "Bueno" }] }
  const manual = ok(await api("POST", "/recepciones", admin.token, acta), 201)
  assert.equal((await api("POST", "/recepciones", admin.token, acta)).status, 409, "no cabe una segunda entrega")
  const todas = (await api("GET", "/recepciones", admin.token)).body.filter((r: { evento_id: number }) => String(r.evento_id) === evento.id)
  const devolucion = todas.find((r: { tipo: string }) => r.tipo === "Recepción Desmontaje")
  assert.equal(devolucion.parentCodigo, manual.codigo, "la devolución se asocia a su montaje")
  assert.equal(todas.filter((r: { tipo: string }) => r.tipo === "Recepción Montaje").length, 1)
})

test("un evento para cliente solo nace de una cotización", async () => {
  const empleado = asesor.id
  const base = { cliente_id: cliente.id, responsable_id: empleado, nombre: "Directo", direccion: "Salón Modelo 9", hora_inicio: "2031-06-01T18:00", hora_fin: "2031-06-01T22:00" }
  assert.equal((await api("POST", "/eventos", admin.token, { ...base, modalidad: "Cliente" })).status, 409)
  const propio = ok(await api("POST", "/eventos", admin.token, { ...base, modalidad: "Propio", concepto_evento: "Show" }), 201)
  assert.equal((await api("PUT", `/eventos/${propio.id}`, admin.token, { ...propio, modalidad: "Cliente", cliente_id: cliente.id })).status, 409)
  const { evento } = await baseEvento(admin.token, { direccion: "Salón Modelo 10" })
  assert.equal((await api("PUT", `/eventos/${evento.id}`, admin.token, { ...evento, modalidad: "Propio" })).status, 409)
  ok(await api("PUT", `/eventos/${evento.id}`, admin.token, { ...evento, aforo_esperado: "300" }))
})

test("aceptar pasa los servicios al evento; el evento de cliente no los cambia, solo su proveedor y costo", async () => {
  const otro = ok(await api("POST", "/servicios", admin.token, { nombre: "Luces demo", categoria: "Sonido", tipo_cobro: "por_evento", precioBaseNum: 300_000 }), 201)
  const c = ok(await api("POST", "/cotizaciones", admin.token, cotizacion({ direccion: "Salón Modelo 11", fecha_evento: "2031-07-01" })), 201)
  const enCotizacion = ok(await api("GET", `/eventos/${c.evento_id}`, admin.token))
  assert.equal((await api("PUT", `/eventos/${c.evento_id}`, admin.token, { ...enCotizacion, estado: "Planificación", responsable_id: asesor.id })).status, 409, "sin aceptar no se planifica")
  ok(await api("PUT", `/cotizaciones/${c.id}`, admin.token, { estado: "Aceptada" }))
  const ev = ok(await api("GET", `/eventos/${c.evento_id}`, admin.token))
  assert.deepEqual(ev.servicios, [servicio.nombre])
  assert.deepEqual([ev.serviciosDetalles[0].cantidad, ev.serviciosDetalles[0].costo], [2, "$ 500.000"])
  const conOtro = { ...ev, responsable_id: asesor.id, servicios: [servicio.nombre, otro.nombre] }
  assert.equal((await api("PUT", `/eventos/${ev.id}`, admin.token, conOtro)).status, 409, "no agrega servicios")
  assert.equal((await api("PUT", `/eventos/${ev.id}`, admin.token, { ...ev, responsable_id: asesor.id, servicios: [] })).status, 409, "no quita servicios")
  const costo = { ...ev, responsable_id: asesor.id, serviciosDetalles: [{ ...ev.serviciosDetalles[0], costo: 420_000 }] }
  const guardado = ok(await api("PUT", `/eventos/${ev.id}`, admin.token, costo))
  assert.equal(guardado.serviciosDetalles[0].costo, "$ 420.000")
  // Un evento propio sí elige sus servicios
  const propio = ok(await api("POST", "/eventos", admin.token, { modalidad: "Propio", responsable_id: asesor.id, nombre: "Show propio", direccion: "Salón Modelo 12", hora_inicio: "2031-08-01T18:00", hora_fin: "2031-08-01T22:00", servicios: [servicio.nombre, otro.nombre] }), 201)
  assert.equal(propio.servicios.length, 2)
})

test("agendamiento: sobre un evento no repite el cliente; responsable y hora de fin se guardan", async () => {
  const { evento, empleado } = await baseEvento(admin.token, { direccion: "Salón Modelo 8" })
  const r = ok(await api("POST", "/agendamientos", admin.token, {
    title: "Visita técnica", tipo_agendamiento: "visita_tecnica", year: 2030, month: 4, day: 2, time: "09:00", timeEnd: "11:30",
    evento_id: evento.id, cliente_id: cliente.id, responsable_id: empleado.id, estado: "Pendiente",
  }), 201)
  const [fila] = await sql("SELECT cliente_id, fecha_hora_fin, empleado_id FROM agendamiento WHERE id_agendamiento = ?", [r.id])
  assert.deepEqual([fila.cliente_id, fila.fecha_hora_fin, String(fila.empleado_id)], [null, "2030-05-02 11:30:00", empleado.id])
  assert.equal(r.cliente_id, String(evento.cliente_id), "el cliente se lee del evento")
  assert.equal((await api("POST", "/agendamientos", admin.token, { title: "x", tipo_agendamiento: "evento", year: 2030, month: 4, day: 2, time: "09:00" })).status, 400)
})
