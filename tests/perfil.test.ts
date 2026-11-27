import assert from "node:assert/strict"
import { test } from "node:test"
import { api, CLAVE, entorno, ok, sql, usuarioCon, type Persona } from "./ayuda.js"

/** Mi perfil: cualquiera con sesión cambia sus datos; correo y contraseña piden la contraseña actual. */
let yo: Persona
entorno(async () => {
  // Sin ningún privilegio: el perfil no depende del módulo Usuarios
  yo = await usuarioCon()
})

test("ve y cambia sus datos sin privilegios de Usuarios; nombres con espacios completos", async () => {
  const p = ok(await api("GET", "/perfil", yo.token))
  assert.equal(p.correo, yo.correo)
  assert.equal("contrasena_hash" in p, false)
  const r = ok(await api("PUT", "/perfil", yo.token, { ...p, nombre: "Juan Esteban", apellido: "Castañeda de León", telefono: "3001234567" }))
  assert.deepEqual([r.perfil.nombre, r.perfil.apellido, r.user.name], ["Juan Esteban", "Castañeda de León", "Juan Esteban Castañeda de León"])
  assert.equal(r.token, undefined, "sin cambio de clave no hay token nuevo")
  assert.equal((await api("GET", "/usuarios", yo.token)).status, 403)
})

test("no cambia su rol ni su estado desde el perfil", async () => {
  const [antes] = await sql("SELECT rol_id, activo FROM usuario WHERE id_usuario = ?", [yo.id])
  ok(await api("PUT", "/perfil", yo.token, { rol_id: 1, rol: "Administrador", activo: 0, estado: "Inactivo" }))
  const [despues] = await sql("SELECT rol_id, activo FROM usuario WHERE id_usuario = ?", [yo.id])
  assert.deepEqual(despues, antes)
})

test("cambiar correo o contraseña exige la actual; la clave nueva cierra las otras sesiones", async () => {
  assert.equal((await api("PUT", "/perfil", yo.token, { correo: "nuevo@ejemplo.test" })).status, 403)
  assert.equal((await api("PUT", "/perfil", yo.token, { correo: "nuevo@ejemplo.test", contrasena_actual: "Otra2026xx" })).status, 403)
  ok(await api("PUT", "/perfil", yo.token, { correo: "nuevo@ejemplo.test", contrasena_actual: CLAVE }))
  assert.equal((await api("PUT", "/perfil", yo.token, { contrasena_actual: CLAVE, contrasena_nueva: "corta" })).status, 400)
  assert.equal((await api("PUT", "/perfil", yo.token, { contrasena_actual: CLAVE, contrasena_nueva: CLAVE })).status, 400)
  const r = ok(await api("PUT", "/perfil", yo.token, { contrasena_actual: CLAVE, contrasena_nueva: "Nueva2026clave" }))
  assert.equal((await api("GET", "/perfil", yo.token)).status, 401, "el token anterior deja de servir")
  ok(await api("GET", "/perfil", r.token))
  const login = ok(await api("POST", "/auth/login", undefined, { email: "nuevo@ejemplo.test", password: "Nueva2026clave" }))
  assert.equal(login.user.email, "nuevo@ejemplo.test")
})

test("correo o documento de otra cuenta: conflicto", async () => {
  const otro = await usuarioCon()
  const r = await api("PUT", "/perfil", otro.token, { correo: "nuevo@ejemplo.test", contrasena_actual: CLAVE })
  assert.equal(r.status, 409)
})
