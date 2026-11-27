import "dotenv/config"

const isProd = process.env.NODE_ENV === "production"

function required(name: string, devDefault?: string): string {
  const v = process.env[name]
  if (v && v.length > 0) return v
  if (!isProd && devDefault !== undefined) return devDefault
  throw new Error(`Falta la variable de entorno ${name}`)
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:4173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    name: process.env.DB_NAME ?? "the_high_events_db",
  },
  // En producción es obligatorio un secreto propio (mínimo 32 caracteres).
  jwtSecret: required("JWT_SECRET", "dev-only-secret-change-me-dev-only-secret"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5),
  lockMinutes: Number(process.env.LOCK_MINUTES ?? 15),
}

if (isProd && env.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres en producción")
}
