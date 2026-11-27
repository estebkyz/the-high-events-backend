import compression from "compression"
import cors from "cors"
import express from "express"
import rateLimit from "express-rate-limit"
import helmet from "helmet"
import { env } from "./config/env.js"
import { query } from "./config/db.js"
import { authenticate } from "./middleware/auth.js"
import { errorHandler, notFoundHandler } from "./middleware/errors.js"
import { authRouter, sesionHandler } from "./routes/auth.routes.js"
import { perfilRouter } from "./routes/perfil.routes.js"
import { rolesRouter } from "./routes/roles.routes.js"
import { usuariosRouter } from "./routes/usuarios.routes.js"
import { clientesRouter } from "./routes/clientes.routes.js"
import { empleadosRouter } from "./routes/empleados.routes.js"
import { proveedoresRouter } from "./routes/proveedores.routes.js"
import { categoriasServicioRouter } from "./routes/categorias-servicio.routes.js"
import { serviciosRouter } from "./routes/servicios.routes.js"
import { categoriasEquipoRouter } from "./routes/categorias-equipo.routes.js"
import { disponibilidadHandler, equiposRouter } from "./routes/equipos.routes.js"
import { permisoLectura, stdPerms } from "./utils/resource.js"
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

const PERMS_EQUIPOS = stdPerms("equipos")

/** Frena envíos masivos o repetidos de formularios; por usuario, no por IP (una oficina comparte IP). */
const limiteEscritura = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET",
  keyGenerator: (req) => `u:${req.user!.id}`,
  message: { message: "Demasiados cambios seguidos. Espere un momento." },
})

export const app = express()
app.disable("x-powered-by")
app.set("trust proxy", env.trustProxy)
app.use(helmet())
app.use(cors({ origin: env.corsOrigins, maxAge: 86_400 }))
app.use(compression())
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
// Respuestas con datos personales: el navegador las revalida (ETag) y ningún proxy las guarda.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-cache")
  next()
})
app.use("/api", limiteEscritura)
app.get("/api/sesion", sesionHandler)
// Mis datos: sin privilegios de Usuarios
app.use("/api/perfil", perfilRouter)
app.use("/api/roles", rolesRouter)
app.use("/api/usuarios", usuariosRouter)
app.use("/api/clientes", clientesRouter)
app.use("/api/empleados", empleadosRouter)
app.use("/api/proveedores", proveedoresRouter)
app.use("/api/categorias-servicio", categoriasServicioRouter)
app.use("/api/servicios", serviciosRouter)
app.use("/api/categorias-equipo", categoriasEquipoRouter)
app.get(
  "/api/equipos/disponibilidad",
  permisoLectura({ perms: PERMS_EQUIPOS, catalogo: { modulos: ["equipos", "eventos", "prestamos", "recepciones", "agendamiento"] } }),
  disponibilidadHandler,
) // antes de /equipos/:id
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
