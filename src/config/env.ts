import "dotenv/config"
import crypto from "node:crypto"
import { z } from "zod"

// Los servidores en la nube corren en UTC: las fechas del negocio son de Colombia (sin horario de verano)
process.env.TZ ||= "America/Bogota"

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/

/** Lee y valida las variables de entorno. En producción no hay valores por defecto inseguros. */
export function leerEnv(origen: Record<string, string | undefined>) {
  const isProd = origen.NODE_ENV === "production"
  // Una variable vacía equivale a no definirla
  const fuente = Object.fromEntries(Object.entries(origen).filter(([, v]) => v !== undefined && v.trim() !== ""))
  const entero = (porDefecto: number, min = 1, max = 65_535) => z.coerce.number().int().min(min).max(max).default(porDefecto)
  const soloDev = (valor: string) => (isProd ? z.string() : z.string().default(valor))

  const parsed = z
    .object({
      PORT: entero(3000),
      // Dirección que asigna el alojamiento (alwaysdata); sin ella se escucha en todas
      IP: z.union([z.ipv4(), z.ipv6()]).optional(),
      CORS_ORIGINS: soloDev("http://localhost:8443,http://localhost:5173,http://localhost:4173"),
      DB_HOST: soloDev("127.0.0.1"),
      DB_PORT: entero(3306),
      DB_USER: soloDev("root"),
      DB_PASSWORD: soloDev(""),
      DB_NAME: soloDev("the_high_events_db"),
      DB_POOL: entero(10, 1, 100),
      // off: sin cifrar (solo base local) · require: cifra sin verificar el certificado · verify: cifra y verifica
      DB_SSL: z.enum(["off", "require", "verify"]).default("off"),
      // Certificado de la autoridad (PEM) para `verify`; sin él se usan las autoridades públicas
      DB_SSL_CA: z.string().optional(),
      DB_TIME_ZONE: z.string().regex(/^[+-]\d{2}:\d{2}$/).default("-05:00"),
      // Sin secreto en desarrollo se genera uno por arranque: nunca hay uno conocido en el código
      JWT_SECRET: soloDev(crypto.randomBytes(48).toString("hex")),
      JWT_EXPIRES_IN: z.string().default("8h"),
      MAX_LOGIN_ATTEMPTS: entero(5, 1, 100),
      LOCK_MINUTES: entero(15, 1, 1440),
      // Proxies de confianza delante de la API (Nginx, Render…): sin esto los límites se comparten entre usuarios
      TRUST_PROXY: entero(0, 0, 10),
    })
    .safeParse(fuente)
  if (!parsed.success) {
    const malas = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))]
    throw new Error(`Variables de entorno ausentes o inválidas: ${malas.join(", ")}`)
  }
  const e = parsed.data
  const corsOrigins = e.CORS_ORIGINS.split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean)

  if (isProd) {
    if (e.JWT_SECRET.length < 32) throw new Error("JWT_SECRET debe tener al menos 32 caracteres en producción")
    if (e.DB_USER === "root") throw new Error("DB_USER no puede ser root en producción: cree un usuario con permisos solo sobre la base")
    if (!corsOrigins.length || corsOrigins.some((o) => o === "*" || LOCAL.test(o)))
      throw new Error("CORS_ORIGINS debe listar el dominio real del frontend en producción")
  }

  return {
    isProd,
    port: e.PORT,
    ip: e.IP,
    corsOrigins,
    trustProxy: e.TRUST_PROXY,
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      name: e.DB_NAME,
      pool: e.DB_POOL,
      timeZone: e.DB_TIME_ZONE,
      ssl:
        e.DB_SSL === "off"
          ? undefined
          : e.DB_SSL === "require"
            ? { rejectUnauthorized: false }
            : // En los paneles web el PEM suele pegarse con "\\n" literales
              { rejectUnauthorized: true, ca: e.DB_SSL_CA?.replaceAll("\\n", "\n") },
    },
    jwtSecret: e.JWT_SECRET,
    jwtExpiresIn: e.JWT_EXPIRES_IN,
    maxLoginAttempts: e.MAX_LOGIN_ATTEMPTS,
    lockMinutes: e.LOCK_MINUTES,
  }
}

export const env = leerEnv(process.env)
