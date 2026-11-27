import { z } from "zod"

export const MIN_CLAVE = 8
// Las que se prueban primero en un ataque; se comparan en minúsculas
const COMUNES = new Set(["password1", "password123", "contrasena1", "contraseña1", "qwerty123", "abc12345", "admin123", "admin1234", "12345678a", "a12345678"])

/** Mínimo 8 caracteres con letras y números; bcrypt ignora lo que pase de 72 bytes. */
export const passwordSchema = z
  .string("es obligatoria")
  .min(MIN_CLAVE, `debe tener al menos ${MIN_CLAVE} caracteres`)
  .refine((s) => Buffer.byteLength(s) <= 72, "es demasiado larga")
  .refine((s) => /\p{L}/u.test(s) && /\d/.test(s), "debe combinar letras y números")
  .refine((s) => !COMUNES.has(s.toLowerCase()), "es demasiado común")
