import assert from "node:assert/strict"
import { test } from "node:test"
import { administrador, api, CLAVE, entorno, ok, sql, usuarioCon } from "./ayuda.js"

entorno()
const entrar = (email: unknown, password: unknown = CLAVE) => api("POST", "/auth/login", undefined, { email, password })

test("login correcto devuelve permisos y un token que funciona", async () => {
  const p = await usuarioCon("clientes.ver")
  const r = ok(await entrar(p.correo))
  assert.deepEqual(r.user.permissions, ["clientes.ver"])
  ok(await api("GET", "/clientes", r.token))
  assert.deepEqual(ok(await api("GET", "/sesion", r.token)).permissions, ["clientes.ver"])
})

test("login inválido no distingue correo inexistente de clave mala", async () => {
  const p = await usuarioCon()
  const a = await entrar(p.correo, "otra-clave-1")
  const b = await entrar("nadie@ejemplo.test")
  assert.deepEqual([a.status, a.body], [401, { message: "Credenciales inválidas" }])
  assert.deepEqual([b.status, b.body], [a.status, a.body])
})

test("cuerpos inválidos dan 400, no 500", async () => {
  for (const c of [{}, { email: { $gt: "" }, password: ["x"] }, { email: "a@b.co" }]) assert.equal((await api("POST", "/auth/login", undefined, c)).status, 400)
  assert.equal((await api("POST", "/auth/login", undefined, undefined, "{mal")).status, 400)
})

test("cinco fallos bloquean la cuenta y el administrador la desbloquea con una clave nueva", async () => {
  const admin = await administrador()
  const p = await usuarioCon()
  for (let i = 0; i < 5; i++) assert.equal((await entrar(p.correo, "mala-clave-1")).status, 401)
  assert.equal((await entrar(p.correo)).status, 423)
  ok(await api("PUT", `/usuarios/${p.id}`, admin.token, { contrasena: "OtraClave2026" }))
  ok(await entrar(p.correo, "OtraClave2026"))
})

test("cambiar la contraseña cierra las sesiones abiertas", async () => {
  const admin = await administrador()
  const p = await usuarioCon("clientes.ver")
  ok(await api("GET", "/clientes", p.token))
  ok(await api("PUT", `/usuarios/${p.id}`, admin.token, { contrasena: "OtraClave2026" }))
  assert.equal((await api("GET", "/clientes", p.token)).status, 401)
})

test("inactivar la cuenta o el rol corta la sesión", async () => {
  const p = await usuarioCon("clientes.ver")
  await sql("UPDATE usuario SET activo = 0 WHERE id_usuario = ?", [p.id])
  assert.equal((await api("GET", "/clientes", p.token)).status, 401)
  const q = await usuarioCon("clientes.ver")
  await sql("UPDATE rol SET estado = 0 WHERE id_rol = ?", [q.rol])
  assert.equal((await api("GET", "/clientes", q.token)).status, 401)
})

test("sin token, con token falso o firmado con otro secreto: 401", async () => {
  assert.equal((await api("GET", "/clientes")).status, 401)
  assert.equal((await api("GET", "/clientes", "abc.def.ghi")).status, 401)
  const jwt = (await import("jsonwebtoken")).default
  assert.equal((await api("GET", "/clientes", jwt.sign({ id: 1, v: "x" }, "otro"))).status, 401)
  assert.equal((await api("GET", "/clientes", jwt.sign({ id: 1 }, "", { algorithm: "none" }))).status, 401)
})

test("no hay recuperación pública de contraseña", async () => {
  for (const r of ["forgot-password", "reset-password", "register"]) assert.notEqual((await api("POST", `/auth/${r}`, undefined, { email: "a@b.co" })).status, 200)
})

test("ninguna respuesta de usuarios incluye hashes", async () => {
  const admin = await administrador()
  const r = await api("GET", "/usuarios", admin.token)
  assert.ok(!/contrasena|hash|\$2[aby]\$/.test(JSON.stringify(ok(r))))
})
