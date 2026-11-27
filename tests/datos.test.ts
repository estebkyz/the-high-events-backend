import assert from "node:assert/strict"
import { test } from "node:test"
import { administrador, api, baseEvento, CLIENTE, EMPLEADO, entorno, ok, sql, type Persona } from "./ayuda.js"

let admin: Persona
entorno(async () => {
  admin = await administrador()
})

for (const [campo, malos] of Object.entries({
  correo: ["", "ana", "ana@", "ana@x", "a b@x.co", "ana@x..co", `${"a".repeat(150)}@x.co`],
  telefono: ["", "abc", "123", "1".repeat(16), "300-ABC-4567"],
  numero_documento: ["", "abc", "12", "1".repeat(21), "52.12<script>"],
  primer_nombre: ["", "   ", "x".repeat(60), { a: 1 }, ["x"]],
  direccion: ["", "x".repeat(201)],
  tipo_cliente: ["", "Otro"],
}))
  test(`clientes rechaza ${campo} inválido`, async () => {
    for (const malo of malos) assert.equal((await api("POST", "/clientes", admin.token, { ...CLIENTE, [campo]: malo })).status, 400, JSON.stringify(malo))
  })

test("clientes acepta formatos colombianos habituales", async () => {
  const casos = [
    { telefono: "+57 300 123 4567", numero_documento: "1.020.304.050" },
    { telefono: "(604) 4445566 ext 12", numero_documento: "900123456-7", tipo_documento: "NIT" },
    { telefono: "6044445566", numero_documento: "AB123456", tipo_documento: "PASAPORTE", correo: "a.b+c@sub.ejemplo.com.co" },
  ]
  for (const [i, c] of casos.entries()) ok(await api("POST", "/clientes", admin.token, { ...CLIENTE, correo: `ok${i}@ejemplo.test`, ...c }), 201)
})

test("un registro antiguo con datos imperfectos se puede inactivar", async () => {
  const id = (await sql("INSERT INTO cliente (tipo_cliente, nombre, apellido, tipo_documento, numero_documento, correo, telefono, direccion) VALUES ('persona_natural','Vieja','Data','CC','X','sin-correo','1','Calle')")).insertId
  const c = ok(await api("GET", `/clientes/${id}`, admin.token))
  assert.equal(ok(await api("PUT", `/clientes/${id}`, admin.token, { ...c, estado: "Inactivo" })).estado, "Inactivo")
  assert.equal((await api("PUT", `/clientes/${id}`, admin.token, { ...c, correo: "peor" })).status, 400)
})

test("duplicados, ids inválidos e inyección no rompen nada", async () => {
  const c = { ...CLIENTE, numero_documento: "55667788", correo: "dup@ejemplo.test" }
  ok(await api("POST", "/clientes", admin.token, c), 201)
  assert.equal((await api("POST", "/clientes", admin.token, c)).status, 409)
  for (const id of ["abc", "0", "-1", "1%20OR%201=1", "1.5"]) assert.equal((await api("GET", `/clientes/${id}`, admin.token)).status, 400, id)
  assert.equal((await api("GET", "/clientes/999999", admin.token)).status, 404)
  const r = ok(await api("POST", "/clientes", admin.token, { ...CLIENTE, numero_documento: "55667799", correo: "iny@ejemplo.test", primer_nombre: "'; DROP TABLE cliente; --" }), 201)
  assert.equal([r.primer_nombre, r.segundo_nombre].join(" ").startsWith("'; DROP"), true)
  assert.equal((await api("POST", "/clientes", admin.token, [1, 2])).status, 400)
})

test("contraseñas débiles se rechazan", async () => {
  const [{ nombre }] = await sql("SELECT nombre FROM rol WHERE id_rol = ?", [admin.rol])
  const u = { rol: nombre, tipo_documento: "CC", numero_documento: "33445566", primer_nombre: "A", primer_apellido: "B", correo: "u@ejemplo.test" }
  for (const contrasena of ["", "corta1", "soloLetras", "12345678", "password123", `Aa1${"x".repeat(80)}`])
    assert.equal((await api("POST", "/usuarios", admin.token, { ...u, contrasena })).status, 400, contrasena)
  ok(await api("POST", "/usuarios", admin.token, { ...u, contrasena: "Segura2026" }), 201)
})

test("listas gigantes se rechazan", async () => {
  const { evento } = await baseEvento(admin.token)
  const r = await api("PUT", `/eventos/${evento.id}`, admin.token, { equiposAsignados: Array.from({ length: 501 }, () => "1") })
  assert.equal(r.status, 400)
})

test("eventos: fechas invertidas y cruce de ubicación", async () => {
  const { evento, empleado } = await baseEvento(admin.token)
  const base = { modalidad: "Propio", concepto_evento: "Prueba", responsable_id: empleado.id, nombre: "Otro", direccion: evento.direccion }
  assert.equal((await api("POST", "/eventos", admin.token, { ...base, hora_inicio: "2030-01-02T10:00", hora_fin: "2030-01-02T09:00" })).status, 400)
  assert.equal((await api("POST", "/eventos", admin.token, { ...base, hora_inicio: "2030-05-10T22:00", hora_fin: "2030-05-11T02:00" })).status, 409)
})

test("equipos: un equipo no se asigna a dos eventos a la vez", async () => {
  const eq = ok(await api("POST", "/equipos", admin.token, { nombre: "Consola", categoria: "Audio", propiedad: "Propio" }), 201)
  await baseEvento(admin.token, { equiposAsignados: [eq.id] })
  await assert.rejects(baseEvento(admin.token, { equiposAsignados: [eq.id] }), /409/)
  const d = ok(await api("GET", "/equipos/disponibilidad?inicio=2030-05-10T18:00&fin=2030-05-10T20:00", admin.token))
  assert.equal(d.find((x: { id: string }) => x.id === eq.id).disponible, false)
})

test("empleados: teléfono con formato", async () => {
  assert.equal((await api("POST", "/empleados", admin.token, { ...EMPLEADO, numero_documento: "71999888", telefono: "no tiene" })).status, 400)
})

test("la base responde en la hora del negocio", async () => {
  const { query } = await import("../src/config/db.js")
  const [z] = await query<{ z: string }>("SELECT @@session.time_zone AS z")
  assert.equal(z.z, "-05:00")
})

test("respuestas: comprimidas, sin caché pública y con límite de escritura", async () => {
  const r = await api("GET", "/eventos", admin.token)
  assert.match(r.headers.get("cache-control") ?? "", /private/)
  assert.ok(r.headers.get("etag"))
  assert.equal(r.headers.get("x-powered-by"), null)
  const todos = await Promise.all(Array.from({ length: 200 }, () => api("DELETE", "/clientes/999999", admin.token)))
  assert.ok(todos.some((x) => x.status === 429))
})

test("nombres y apellidos de varias palabras se editan completos y no se duplican al guardar", async () => {
  // Otro administrador: el límite de escrituras es por usuario y este archivo ya hizo muchas
  const yo = await administrador()
  const nombre = { primer_nombre: "Juan Esteban", primer_apellido: "Castañeda de León" }
  const [{ nombre: rol }] = await sql("SELECT nombre FROM rol WHERE id_rol = ?", [yo.rol])
  const casos: [string, object][] = [
    ["/clientes", { ...CLIENTE, ...nombre, numero_documento: "52888001", correo: "nom1@ejemplo.test" }],
    ["/empleados", { ...EMPLEADO, ...nombre, numero_documento: "71888001" }],
    ["/usuarios", { ...nombre, rol, tipo_documento: "CC", numero_documento: "33888001", correo: "nom2@ejemplo.test", contrasena: "Prueba2026x" }],
  ]
  for (const [ruta, cuerpo] of casos) {
    const creado = ok(await api("POST", ruta, yo.token, cuerpo), 201)
    assert.deepEqual([creado.primer_nombre, creado.primer_apellido], ["Juan Esteban", "Castañeda de León"], ruta)
    const { contrasena: _, ...sinClave } = creado
    const guardado = ok(await api("PUT", `${ruta}/${creado.id}`, yo.token, sinClave))
    assert.deepEqual([guardado.primer_nombre, guardado.primer_apellido], ["Juan Esteban", "Castañeda de León"], `${ruta} al guardar`)
  }
  const prov = ok(await api("POST", "/proveedores", yo.token, { nit_documento: "900888001", razon_social: "Proveedor Nombres", contacto_primer_nombre: "María José", contacto_primer_apellido: "Pérez Gómez", telefono: "3001112233", correo: "pn@ejemplo.test", servicios: [] }), 201)
  const prov2 = ok(await api("PUT", `/proveedores/${prov.id}`, yo.token, prov))
  assert.deepEqual([prov2.contacto_primer_nombre, prov2.contacto_primer_apellido], ["María José", "Pérez Gómez"])
})
