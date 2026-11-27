import assert from "node:assert/strict"
import { test } from "node:test"
import { administrador, api, baseEvento, CLAVE, CLIENTE, entorno, ok, sql, usuarioCon } from "./ayuda.js"

entorno()
const RUTAS: Record<string, string> = {
  roles: "config.roles.ver",
  usuarios: "usuarios.ver",
  clientes: "clientes.ver",
  empleados: "empleados.ver",
  proveedores: "proveedores.ver",
  "categorias-servicio": "servicios.ver",
  servicios: "servicios.ver",
  "categorias-equipo": "equipos.ver",
  equipos: "equipos.ver",
  cotizaciones: "cotizaciones.ver",
  eventos: "eventos.ver",
  agendamientos: "agendamiento.ver",
  ventas: "ventas.ver",
  abonos: "abonos.ver",
  incidentes: "incidentes.ver",
  prestamos: "prestamos.ver",
  recepciones: "recepciones.ver",
  "tareas-catalogo": "tareas.ver",
  "evento-tareas": "tareas.ver",
}

test("un rol sin privilegios no lee ni escribe ningún módulo", async () => {
  const p = await usuarioCon()
  for (const r of [...Object.keys(RUTAS), "equipos/disponibilidad"]) assert.equal((await api("GET", `/${r}`, p.token)).status, 403, r)
  for (const r of Object.keys(RUTAS)) {
    assert.equal((await api("POST", `/${r}`, p.token, {})).status, 403, r)
    assert.equal((await api("PUT", `/${r}/${r === "abonos" ? "C-1" : 1}`, p.token, {})).status, 403, r)
    if (r !== "abonos") assert.equal((await api("DELETE", `/${r}/1`, p.token)).status, 403, r)
  }
})

test("cada privilegio `ver` abre solo su módulo", async () => {
  for (const [r, codigo] of Object.entries(RUTAS)) {
    const p = await usuarioCon(codigo)
    assert.equal((await api("GET", `/${r}`, p.token)).status, 200, r)
    assert.equal((await api("POST", `/${r}`, p.token, {})).status, 403, r)
  }
})

test("otro módulo recibe el catálogo sin datos personales ni montos", async () => {
  const admin = await administrador()
  const { cliente, empleado, evento } = await baseEvento(admin.token)
  const cot = await usuarioCon("cotizaciones.crear")
  const c = ok(await api("GET", `/clientes/${cliente.id}`, cot.token))
  assert.equal(c.primer_nombre, "Ana")
  assert.deepEqual([c.correo, c.telefono, c.direccion], ["", "", ""])
  const e = ok(await api("GET", `/empleados/${empleado.id}`, cot.token))
  assert.equal(e.cargo, "Logística")
  assert.deepEqual([e.numero_documento, e.telefono, e.correo], ["", "", ""])
  const inc = await usuarioCon("incidentes.reportar")
  const ev = ok(await api("GET", `/eventos/${evento.id}`, inc.token))
  assert.equal(ev.nombre, evento.nombre)
  assert.equal(ev.presupuesto_estimado, undefined)
  assert.equal(ev.valor_total, undefined)
  assert.deepEqual(ev.serviciosDetalles, [])
})

test("quien solo cambia el estado no edita otros campos", async () => {
  const admin = await administrador()
  const c = ok(await api("POST", "/clientes", admin.token, CLIENTE), 201)
  const p = await usuarioCon("clientes.estado")
  assert.equal(ok(await api("PUT", `/clientes/${c.id}`, p.token, { ...c, estado: "Inactivo" })).estado, "Inactivo")
  assert.equal((await api("PUT", `/clientes/${c.id}`, p.token, { ...c, direccion: "Otra dirección 1" })).status, 403)
})

// ---- escalada de privilegios ------------------------------------------------
const GESTOR = ["usuarios.ver", "usuarios.crear", "usuarios.editar", "usuarios.eliminar", "usuarios.estado"]

test("un gestor no asigna, edita ni elimina cuentas con más permisos", async () => {
  const admin = await administrador()
  const gestor = await usuarioCon(...GESTOR)
  const simple = await usuarioCon("usuarios.ver")
  const [{ nombre: rolAdmin }] = await sql("SELECT nombre FROM rol WHERE id_rol = ?", [admin.rol])
  assert.equal((await api("PUT", `/usuarios/${simple.id}`, gestor.token, { rol: rolAdmin })).status, 403, "ascender a otro")
  assert.equal((await api("PUT", `/usuarios/${gestor.id}`, gestor.token, { rol: rolAdmin })).status, 403, "ascenderse")
  assert.equal((await api("PUT", `/usuarios/${admin.id}`, gestor.token, { contrasena: "Robada2026x" })).status, 403, "clave del administrador")
  assert.equal((await api("PUT", `/usuarios/${admin.id}`, gestor.token, { correo: "otro@ejemplo.test" })).status, 403)
  assert.equal((await api("PUT", `/usuarios/${admin.id}`, gestor.token, { estado: "Inactivo" })).status, 403)
  assert.equal((await api("DELETE", `/usuarios/${admin.id}`, gestor.token)).status, 403)
  const nuevo = { rol: rolAdmin, tipo_documento: "CC", numero_documento: "99887766", primer_nombre: "X", primer_apellido: "Y", correo: "x@ejemplo.test", contrasena: CLAVE }
  assert.equal((await api("POST", "/usuarios", gestor.token, nuevo)).status, 403, "crear administrador")
  const [{ n }] = await sql("SELECT COUNT(*) AS n FROM usuario WHERE correo = 'x@ejemplo.test'")
  assert.equal(n, 0, "la transacción se revierte")
  ok(await api("PUT", `/usuarios/${simple.id}`, gestor.token, { contrasena: "Nueva2026xy" }))
})

test("nadie concede permisos que no tiene ni toca roles superiores", async () => {
  const admin = await administrador()
  const p = await usuarioCon("config.roles.ver", "config.roles.editar", "config.roles.estado", "config.roles.eliminar")
  const otro = await usuarioCon("config.roles.ver")
  assert.equal((await api("PUT", `/roles/${p.rol}/permisos`, p.token, ["config.roles.ver", "config.roles.editar", "abonos.estado"])).status, 403)
  assert.equal((await api("PUT", `/roles/${otro.rol}/permisos`, p.token, ["usuarios.editar"])).status, 403)
  assert.equal((await api("PUT", `/roles/${admin.rol}/permisos`, p.token, [])).status, 403)
  assert.equal((await api("PUT", `/roles/${admin.rol}`, p.token, { estado: "Inactivo" })).status, 403)
  assert.equal((await api("PUT", `/roles/${admin.rol}`, p.token, { nombre: "Otro" })).status, 403)
  ok(await api("PUT", `/roles/${otro.rol}/permisos`, p.token, ["config.roles.editar"]))
})

test("siempre queda un administrador", async () => {
  const admin = await administrador()
  await sql("UPDATE usuario SET activo = 0 WHERE id_usuario <> ?", [admin.id])
  assert.equal((await api("PUT", `/usuarios/${admin.id}`, admin.token, { estado: "Inactivo" })).status, 409)
  assert.equal((await api("DELETE", `/usuarios/${admin.id}`, admin.token)).status, 409)
  assert.equal((await api("PUT", `/roles/${admin.rol}/permisos`, admin.token, ["clientes.ver"])).status, 409)
  assert.equal((await api("PUT", `/roles/${admin.rol}`, admin.token, { estado: "Inactivo" })).status, 409)
  ok(await api("GET", "/roles", admin.token))
})

test("acceder al módulo es requisito de sus demás acciones: se agrega al guardar el rol", async () => {
  const admin = await administrador()
  const otro = await usuarioCon()
  const guardados: string[] = ok(await api("PUT", `/roles/${otro.rol}/permisos`, admin.token, ["eventos.editar", "config.roles.crear"]))
  assert.deepEqual([...guardados].sort(), ["config.roles.crear", "config.roles.ver", "eventos.editar", "eventos.ver"])
})
