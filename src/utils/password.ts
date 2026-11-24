import { z } from "zod"

/** Mínimo 6 caracteres (regla del formulario de usuarios); bcrypt ignora lo que pase de 72 bytes. */
export const passwordSchema = z
  .string("es obligatoria")
  .min(6, "debe tener al menos 6 caracteres")
  .refine((s) => Buffer.byteLength(s) <= 72, "es demasiado larga")
