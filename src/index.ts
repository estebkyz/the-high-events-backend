import { app } from "./app.js"
import { env } from "./config/env.js"
import { pool } from "./config/db.js"

const server = app.listen({ port: env.port, host: env.ip }, () => console.log(`The High Events API en http://localhost:${env.port}/api`))
// Un cliente que no termina de enviar la petición no puede retener la conexión
server.requestTimeout = 30_000
server.headersTimeout = 15_000

/** Cierre ordenado: termina lo que está en curso y suelta las conexiones de la base. */
let cerrando = false
function cerrar(senal: string) {
  if (cerrando) return
  cerrando = true
  console.log(`[${senal}] cerrando la API…`)
  setTimeout(() => process.exit(1), 10_000).unref()
  server.close(() => {
    pool.end().finally(() => process.exit(0))
  })
}
for (const senal of ["SIGINT", "SIGTERM"] as const) process.on(senal, () => cerrar(senal))
