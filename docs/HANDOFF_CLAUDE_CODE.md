# Handoff — The High Events: dejar Frontend + API + BD funcionando

Decisión de gobernanza (Agente 00): **backend actual RECHAZADO para producción; esquema v2 APROBADO CON OBSERVACIONES; frontend APROBADO CON OBSERVACIONES.**

## 1. Defectos críticos del backend actual (todos a corregir)
1. `db.ts` cae en silencio a un JSON si MySQL falla (la API "funciona" sin BD). **Eliminar.** Si no hay BD → 503.
2. Contraseñas en texto plano (`contrasena_hash` guarda la clave) y `data/server_db.json` las publica en el repo. → bcrypt; sacar el JSON del repo y rotar claves.
3. Token = base64 sin firma; ninguna ruta `/api/*` exige login. → JWT firmado + middleware `authenticate` + `requirePrivilege`.
4. `createCrudRouter` devuelve `error` crudo de MySQL al cliente (filtra estructura). → error handler seguro.
5. Sin validación de entrada ni helmet/rate-limit/CORS restringido.
6. Los mappers escriben valores que el esquema no acepta (enums distintos) → fallan en MySQL real.
7. `.env.example` apunta a `the_high_events`; el esquema es `the_high_events_db`.

## 2. Ya hecho (carpeta `sql/` y `starter/`)
- `sql/01_schema.sql` v2 aplicado y probado (31 tablas). `sql/02_seed.sql`: roles, 17 módulos, 77 privilegios (generados desde `src/pages/roles/data.ts`), catálogos.
- `starter/`: base ya escrita (env, pool sin fallback, tx helper, errores, JWT/privilegios, helpers de formato). Copiar a `src/` del backend.

## 3. Contrato Frontend ↔ API ↔ BD (reglas de mapeo)
Todas las rutas bajo `/api`, JSON; ids como **string**; DELETE devuelve `{ok:true}`; errores `{message}`.
El hook `useCrudResource.setItems` envía el **objeto completo** del frontend en POST/PUT: la API debe ignorar campos derivados.

| Endpoint | Tabla(s) | Mapeos clave |
|---|---|---|
| /auth/login | usuario, registro_acceso | body `{email,password}` → `{token,user:{id,name,email,role}}` (+ `permissions:string[]`). 5 intentos fallidos → bloqueo 15 min |
| /clientes | cliente | `Empresa`/`Natural` ↔ empresa/persona_natural; primer/segundo nombre/apellido ↔ nombre/apellido; estado Activo/Inactivo ↔ TINYINT |
| /empleados | empleado | `Fijo`/`Por Evento` ↔ fijo/por_evento; emergenciaNombre/Tel/Parentesco ↔ emergencia_* |
| /proveedores | proveedor, proveedor_servicio, equipo | nit_documento ↔ numero_documento; `servicios`/`equipos` = arrays de nombres; historial desde evento_servicio |
| /categorias-servicio, /servicios | categoria_servicio, servicio | categoria = nombre ↔ categoria_id; precioBaseNum numérico |
| /categorias-equipo, /equipos | categoria_equipo, equipo | estadoOperativo: Disponible/En Evento/Prestado/En Mantenimiento/De Baja ↔ enum; propiedad Propio/Alquilado |
| /cotizaciones | cotizacion, cotizacion_detalle | codigo `COT-001` derivado del id; detalles se reemplazan completos; total = Σ cantidad×precio; estados Borrador… |
| /eventos | evento, evento_servicio, evento_equipo, evento_tarea | estados con tilde ↔ enum; `aforo_esperado` "200 personas" ↔ INT; hijos reemplazados en transacción; rechazar solapamiento de fechas en la misma ubicación |
| /agendamientos | agendamiento | AgendaEvent trae day/month(0-based)/year/time → fecha_hora_inicio; fin = inicio+1h si falta |
| /ventas | venta, pago_cliente | estadoPago es **derivado** de los pagos (Pendiente/Parcial/Pagado); `evento_id` obligatorio (hoy el formulario solo envía texto: cambiar a selector de evento) |
| /abonos | venta+pago_cliente (Clientes) y evento_servicio+pago_proveedor (Proveedores) | id `C-<venta>` / `P-<evento>-<proveedor>`; 50% anticipo / 50% saldo; historial nuevo → INSERT de pagos |
| /incidentes | incidente | tipo enum igual; Criticidad Baja…Crítica; estados Reportado/En Atención/Solucionado/Escalado |
| /prestamos | prestamo_equipo, prestamo_detalle | estados Activo/Devuelto/Con Retraso/Con Daños; devolución actualiza estado_retorno y equipo |
| /recepciones | recepcion, recepcion_detalle | tipo Recepción Montaje/Desmontaje; ítem estados Excelente/Bueno/Regular/Dañado(=mal) |
| /tareas-catalogo, /evento-tareas | tarea, evento_tarea | fase Planificación/Montaje/Ejecución/Desmontaje |
| /roles (+ /roles/:id/permisos), /usuarios | rol, rol_privilegio, usuario | permisos por código `modulo.accion`; **RolesPage hoy guarda permisos solo en memoria: conectarlo** |

Permisos: GET = solo autenticado (los formularios leen catálogos de otros módulos); POST/PUT/DELETE exigen `modulo.crear|editar|eliminar` (PUT de estado acepta `.estado`).

## 4. Pendiente (en orden)
1. Backend: reescribir routers según la tabla, `helmet`, `express-rate-limit`, CORS por `CORS_ORIGINS`, zod en auth, `.env.example` (`DB_NAME=the_high_events_db`, `JWT_SECRET` ≥32 chars).
2. `npm run seed`: crear admin con bcrypt (clave por variable de entorno, nunca en el repo).
3. `/auth/forgot-password` + `/auth/reset-password` (token hasheado, expira) — requerido por la ficha. Envío de correo: fuera de alcance, definir proveedor.
4. Pruebas de humo con la BD real: login, CRUD de cada módulo, flujo cotización→evento→venta→abonos.
5. Frontend: `npm run typecheck` y `npm run build`; venta con selector de evento; permisos de roles contra la API; ocultar menú según `permissions`.
6. Fuera de este alcance y aún sin construir: PDF de cotización en servidor, entregable móvil (acceso, eventos, tareas, incidentes), CI/CD y pruebas automatizadas.
7. Actualizar el `.mwb` con `docs/DB_CAMBIOS_V2.md`.

## 5. Prompt para pegar en Claude Code (en la carpeta del backend)
> Lee `docs/HANDOFF_CLAUDE_CODE.md`, `docs/DB_CAMBIOS_V2.md` y los `types.ts` de `../The High Events/src/pages/*`. Carga `sql/01_schema.sql` y `sql/02_seed.sql` en mi MySQL. Copia `starter/` a `src/`, elimina el respaldo JSON y reescribe los routers módulo por módulo siguiendo la tabla de contrato (un archivo por módulo, máx. 300 líneas). Después de cada módulo prueba con curl contra la BD real. Al final: `npm run build`, pruebas de humo de todos los endpoints, y en el frontend `npm run typecheck` y `npm run build`. No inventes campos: si el frontend y la BD no coinciden, dímelo.
