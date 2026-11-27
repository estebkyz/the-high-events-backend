# Despliegue y operación

Arquitectura: frontend en Vercel → API y MariaDB en alwaysdata (plan gratis, sin tarjeta, uso personal).
El plan gratis de alwaysdata no permite alojar SOLO la base: la API debe correr allí también. `render.yaml` queda para usar Render con otra base MySQL.
El historial público del repositorio (commit `d77f17d`) trae una cuenta de administrador de demostración: no reutilizar su clave.

## 1. Subir el código
Frontend y backend se publican juntos. Vercel lee la rama `main` de GitHub.

## 2. Cuenta y base (alwaysdata)
1. alwaysdata.com → cuenta gratis (1 GB, 256 MB de RAM, 40 conexiones).
2. Databases → MySQL: base `<cuenta>_highevents` y un usuario con todos los permisos sobre ella.
3. Remote access → SSH/SFTP: permitir al usuario la conexión con contraseña.
4. Environment → Node.js: versión 22.

## 3. Crear tablas y administrador (desde el computador, una vez)
1. Crear `backend/.env.produccion` (Git lo ignora):
   ```
   DB_HOST=mysql-<cuenta>.alwaysdata.net
   DB_PORT=3306
   DB_NAME=<cuenta>_highevents
   DB_USER=<usuario de la base>
   DB_PASSWORD=<clave, sin espacios ni #>
   DB_SSL=require
   ADMIN_EMAIL=
   ADMIN_PASSWORD=
   ADMIN_DOCUMENTO=
   ADMIN_NOMBRE=
   ADMIN_APELLIDO=
   ```
   En un servidor propio, agregar `DB_ADMIN_URL=mysql://usuario:clave@host:puerto`: crea también la base y el usuario.
2. En PowerShell, dentro de `backend`: `$env:DOTENV_CONFIG_PATH=".env.produccion"`, `npm run db:instalar`, `npm run seed`. Cerrar esa terminal y borrar el archivo.
3. Si avisa que el servidor no admite cifrado, usar `DB_SSL=off` (solo datos de prueba en esa conexión).

## 4. API (alwaysdata)
1. En `backend`: `npm run build`; crear la carpeta con `ssh <cuenta>@ssh-<cuenta>.alwaysdata.net "mkdir -p api"` y copiar con `scp -r dist package.json package-lock.json <cuenta>@ssh-<cuenta>.alwaysdata.net:api/`.
2. En el servidor: `cd api && npm ci --omit=dev`.
3. Web → Sites → sitio tipo Node.js en `<cuenta>.alwaysdata.net`: comando `node /home/<cuenta>/api/dist/index.js`, directorio `/home/<cuenta>/api` y variables de entorno:
   ```
   NODE_ENV=production
   TZ=America/Bogota
   TRUST_PROXY=1
   DB_POOL=5
   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL
   JWT_SECRET=<64 caracteres aleatorios>
   CORS_ORIGINS=<URL de Vercel, sin / final>
   ```
   `IP` y `PORT` los pone alwaysdata.
4. Salud: `https://<cuenta>.alwaysdata.net/api/health` → 200 con base conectada, 503 sin ella. Registros: `/home/<cuenta>/admin/logs/sites/`.

## 5. Frontend (Vercel)
1. vercel.com → Add New → Project → repositorio del frontend (lee `vercel.json`).
2. Variable `VITE_API_URL` = `https://<cuenta>.alwaysdata.net/api`. Deploy.
3. Volver al sitio de alwaysdata, poner en `CORS_ORIGINS` la URL real de Vercel y reiniciarlo.
`VITE_API_URL` se incluye al compilar: si cambia, hay que volver a desplegar.

## 6. Comprobar
- Entrar y revisar en Usuarios → detalle que la IP de la sesión sea la propia (si no, ajustar `TRUST_PROXY`).
- La API se detiene tras 30 minutos sin uso y arranca con la siguiente petición; se puede cambiar en Advanced.
- `DB_SSL=require` cifra pero no verifica el certificado; `verify` con `DB_SSL_CA` es lo más seguro si el proveedor lo entrega.

## Plan B: mostrarlo desde el computador, con enlace público
1. XAMPP con MySQL encendido; en `backend`: `npm run build` y `npm start`.
2. En `frontend`, sin `VITE_API_URL`: `npm run build` y `npm run preview`.
3. `cloudflared tunnel --url http://localhost:8443` (sin cuenta). El enlace `trycloudflare.com` cambia cada vez y vive mientras la terminal esté abierta.

## Pruebas
`npm test` borra y recrea solo `the_high_events_test`. Usa `TEST_DB_HOST/PORT/USER/PASSWORD` (por defecto `root` sin clave en `127.0.0.1:3399`), nunca los `DB_*`.

## Respaldo y vuelta atrás
- Diario: `mysqldump --single-transaction the_high_events_db > respaldo.sql`. Probar la restauración en otra base.
- Vuelta atrás: publicar el commit anterior. Los scripts de `sql/` solo agregan columnas, así que la versión anterior sigue funcionando.

## Incidentes frecuentes
| Síntoma | Causa probable | Acción |
|---|---|---|
| 503 en todo | Base caída o credenciales | Revisar `/api/health` y las variables `DB_*` |
| No arranca: "Variables de entorno ausentes" | Falta o es inválida la variable indicada | Corregirla |
| 429 a muchos usuarios a la vez | `TRUST_PROXY` en 0 detrás de un proxy | Ajustar el número de proxies |
| Cuenta bloqueada (423) | 5 claves fallidas | Esperar o restablecer la clave en Usuarios |

## Límites conocidos
- Los listados se envían completos (sin paginación del servidor): revisar al pasar de unos miles de registros por módulo.
- El caché de permisos vive en memoria (30 s): con varias instancias, un cambio de rol puede tardar ese tiempo.

## Datos ficticios
`npm run demo` agrega datos de demostración a la base de `.env` (o de `DOTENV_CONFIG_PATH`): al menos 5 por módulo, sin tocar lo existente; repetirlo no duplica. Requiere un administrador (`npm run seed`). En una base publicada, dejar `DEMO_PASSWORD` vacía.
