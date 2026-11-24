import cors from "cors"
import express from "express"
import rateLimit from "express-rate-limit"
import helmet from "helmet"
import { env } from "./config/env.js"
import { query } from "./config/db.js"
import { authenticate } from "./middleware/auth.js"
import { errorHandler, notFoundHandler } from "./middleware/errors.js"
import { authRouter } from "./routes/auth.routes.js"
import { rolesRouter } from "./routes/roles.routes.js"
import { usuariosRouter } from "./routes/usuarios.routes.js"
import { clientesRouter } from "./routes/clientes.routes.js"
import { empleadosRouter } from "./routes/empleados.routes.js"
import { proveedoresRouter } from "./routes/proveedores.routes.js"
import { categoriasServicioRouter } from "./routes/categorias-servicio.routes.js"
import { serviciosRouter } from "./routes/servicios.routes.js"
import { categoriasEquipoRouter } from "./routes/categorias-equipo.routes.js"
import { equiposRouter } from "./routes/equipos.routes.js"
import { cotizacionesRouter } from "./routes/cotizaciones.routes.js"
import { eventosRouter } from "./routes/eventos.routes.js"
import { agendamientosRouter } from "./routes/agendamientos.routes.js"
import { ventasRouter } from "./routes/ventas.routes.js"
import { abonosRouter } from "./routes/abonos.routes.js"
import { incidentesRouter } from "./routes/incidentes.routes.js"
import { prestamosRouter } from "./routes/prestamos.routes.js"
import { recepcionesRouter } from "./routes/recepciones.routes.js"
import { tareasCatalogoRouter } from "./routes/tareas-catalogo.routes.js"
import { eventoTareasRouter } from "./routes/evento-tareas.routes.js"

const app = express()
app.disable("x-powered-by")
app.use(helmet())
app.use(cors({ origin: env.corsOrigins }))
app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { message: "Demasiadas solicitudes. Espere un momento." } }))
app.use(express.json({ limit: "1mb" }))

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1")
    res.json({ status: "ok", database: "connected" })
  } catch {
    res.status(503).json({ status: "error", database: "disconnected", message: "Base de datos no disponible" })
  }
})
app.use("/api/auth", authRouter)

// Todo lo demás exige sesión; crear/editar/eliminar exige además el privilegio del módulo.
app.use("/api", authenticate)
app.use("/api/roles", rolesRouter)
app.use("/api/usuarios", usuariosRouter)
app.use("/api/clientes", clientesRouter)
app.use("/api/empleados", empleadosRouter)
app.use("/api/proveedores", proveedoresRouter)
app.use("/api/categorias-servicio", categoriasServicioRouter)
app.use("/api/servicios", serviciosRouter)
app.use("/api/categorias-equipo", categoriasEquipoRouter)
app.use("/api/equipos", equiposRouter)
app.use("/api/cotizaciones", cotizacionesRouter)
app.use("/api/eventos", eventosRouter)
app.use("/api/agendamientos", agendamientosRouter)
app.use("/api/ventas", ventasRouter)
app.use("/api/abonos", abonosRouter)
app.use("/api/incidentes", incidentesRouter)
app.use("/api/prestamos", prestamosRouter)
app.use("/api/recepciones", recepcionesRouter)
app.use("/api/tareas-catalogo", tareasCatalogoRouter)
app.use("/api/evento-tareas", eventoTareasRouter)

app.use(notFoundHandler)
app.use(errorHandler)

app.listen(env.port, () => console.log(`The High Events API en http://localhost:${env.port}/api`))
