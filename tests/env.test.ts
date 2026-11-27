import assert from "node:assert/strict"
import { test } from "node:test"
import { leerEnv } from "../src/config/env.js"

const PROD = {
  NODE_ENV: "production",
  CORS_ORIGINS: "https://app.ejemplo.test/",
  DB_HOST: "db",
  DB_USER: "highevents",
  DB_PASSWORD: "una-clave-larga",
  DB_NAME: "the_high_events_db",
  JWT_SECRET: "x".repeat(48),
}

test("desarrollo arranca sin variables y con un secreto distinto cada vez", () => {
  const a = leerEnv({})
  assert.equal(a.port, 3000)
  assert.ok(a.jwtSecret.length >= 32)
  assert.notEqual(a.jwtSecret, leerEnv({}).jwtSecret)
})

test("la dirección de escucha es opcional y debe ser una IP", () => {
  assert.equal(leerEnv({}).ip, undefined)
  assert.equal(leerEnv({ IP: "::" }).ip, "::")
  assert.throws(() => leerEnv({ IP: "mi-equipo" }))
})

test("producción completa arranca", () => {
  assert.deepEqual(leerEnv(PROD).corsOrigins, ["https://app.ejemplo.test"])
})

for (const [nombre, cambio] of Object.entries({
  "sin DB_PASSWORD": { DB_PASSWORD: "" },
  "con root": { DB_USER: "root" },
  "sin JWT_SECRET": { JWT_SECRET: undefined },
  "JWT_SECRET corto": { JWT_SECRET: "corto" },
  "CORS abierto": { CORS_ORIGINS: "*" },
  "CORS local": { CORS_ORIGINS: "http://localhost:8443" },
  "puerto inválido": { PORT: "abc" },
  "intentos en cero": { MAX_LOGIN_ATTEMPTS: "0" },
}))
  test(`producción no arranca ${nombre}`, () => {
    assert.throws(() => leerEnv({ ...PROD, ...cambio }))
  })

test("TLS de la base: apagado en local, cifrado o verificado en la nube", () => {
  assert.equal(leerEnv({}).db.ssl, undefined)
  assert.deepEqual(leerEnv({ ...PROD, DB_SSL: "require" }).db.ssl, { rejectUnauthorized: false })
  assert.deepEqual(leerEnv({ ...PROD, DB_SSL: "verify", DB_SSL_CA: "a\\nb" }).db.ssl, { rejectUnauthorized: true, ca: "a\nb" })
  assert.throws(() => leerEnv({ ...PROD, DB_SSL: "si" }))
  assert.throws(() => leerEnv({ ...PROD, DB_TIME_ZONE: "'; DROP TABLE x" }))
})

test("las fechas se calculan en hora de Colombia aunque el servidor esté en UTC", async () => {
  const { execFileSync } = await import("node:child_process")
  const codigo = "import('./src/config/env.ts').then(()=>console.log(new Date('2026-11-26T03:00:00Z').toLocaleDateString('sv-SE')))"
  const { TZ: _, ...resto } = process.env
  const salida = execFileSync(process.execPath, ["--import", "tsx", "-e", codigo], { env: resto, encoding: "utf8" })
  assert.equal(salida.trim().split("\n").at(-1), "2026-11-25")
})
