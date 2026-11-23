import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import { pool } from "./config/db.js"
import { authRouter } from "./routes/auth.routes.js"
import { clientesRouter } from "./routes/clientes.routes.js"
import {
  rolesRouter,
  usuariosRouter,
  empleadosRouter,
  proveedoresRouter,
  categoriasServicioRouter,
  serviciosRouter,
  categoriasEquipoRouter,
  equiposRouter,
  cotizacionesRouter,
  ventasRouter,
  eventosRouter,
  agendamientosRouter,
  incidentesRouter,
  prestamosRouter,
  recepcionesRouter,
  tareasCatalogoRouter,
  eventoTareasRouter,
  abonosRouter,
} from "./routes/modules.routes.js"

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT || 3000)

app.use(cors())
app.use(express.json())

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1")
    res.json({ status: "ok", database: "connected" })
  } catch (error) {
    res.status(500).json({ status: "error", database: "disconnected", error })
  }
})

// Rutas REST mapeadas 1:1 con los endpoints del Frontend y las tablas de MySQL Workbench
app.use("/api/auth", authRouter)
app.use("/api/clientes", clientesRouter)
app.use("/api/roles", rolesRouter)
app.use("/api/usuarios", usuariosRouter)
app.use("/api/empleados", empleadosRouter)
app.use("/api/proveedores", proveedoresRouter)
app.use("/api/categorias-servicio", categoriasServicioRouter)
app.use("/api/servicios", serviciosRouter)
app.use("/api/categorias-equipo", categoriasEquipoRouter)
app.use("/api/equipos", equiposRouter)
app.use("/api/cotizaciones", cotizacionesRouter)
app.use("/api/ventas", ventasRouter)
app.use("/api/eventos", eventosRouter)
app.use("/api/agendamientos", agendamientosRouter)
app.use("/api/incidentes", incidentesRouter)
app.use("/api/prestamos", prestamosRouter)
app.use("/api/recepciones", recepcionesRouter)
app.use("/api/tareas-catalogo", tareasCatalogoRouter)
app.use("/api/evento-tareas", eventoTareasRouter)
app.use("/api/abonos", abonosRouter)

app.listen(PORT, () => {
  console.log(`🚀 The High Events Backend corriendo en http://localhost:${PORT}`)
})
