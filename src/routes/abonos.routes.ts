import { Router } from "express"
import { exec, query, tx, type Conn } from "../config/db.js"
import { privilegesOf, requirePrivilege } from "../middleware/auth.js"
import { clienteNombreSql, personaSql, requireId } from "../utils/lookup.js"
import { groupBy, type Obj } from "../utils/resource.js"
import { referencia } from "../utils/validar.js"
import { asArray, dateToDb, dateToFront, enumMap, formatCOP, intOrNull, moneyReq, str, strOrNull } from "../utils/format.js"
import { HttpError, bad, conflict, notFound, wrap } from "../utils/http.js"

/**
 * Cartera derivada: no hay tabla `abono`.
 *  - `C-<venta>`               → venta + pago_cliente
 *  - `P-<evento>-<proveedor>`  → evento_servicio + pago_proveedor
 * Los totales, anticipos, saldos y estados se calculan; lo único que se guarda son pagos.
 */
type Ref = { tipo: "C"; venta: number } | { tipo: "P"; evento: number; proveedor: number }

const tipoPago = enumMap({ Anticipo: "anticipo", Saldo: "saldo" })
const medio = enumMap({ Transferencia: "transferencia", Efectivo: "efectivo" })
// El tipo del frontend dice Pagado/Pendiente; su lista de opciones dice Confirmado/Pendiente Verificación/Rechazado
const estadoPago = enumMap({
  Pagado: "confirmado",
  Pendiente: "pendiente_verificacion",
  Rechazado: "rechazado",
  Confirmado: "confirmado",
  "Pendiente Verificación": "pendiente_verificacion",
})

interface Pago {
  id: number
  ref: string
  tipo_pago: string
  monto: number
  fecha_pago: string
  medio_pago: string
  estado: string
  url_comprobante: string | null
  observaciones: string | null
}

const refId = (r: Ref) => (r.tipo === "C" ? `C-${r.venta}` : `P-${r.evento}-${r.proveedor}`)

function parseRef(id: string): Ref {
  const c = id.match(/^C-(\d+)$/)
  if (c) return { tipo: "C", venta: Number(c[1]) }
  const p = id.match(/^P-(\d+)-(\d+)$/)
  if (p) return { tipo: "P", evento: Number(p[1]), proveedor: Number(p[2]) }
  throw bad("Identificador de abono inválido")
}

function armar(base: Obj, total: number, pagos: Pago[]): Obj {
  const ok = pagos.filter((p) => p.estado === "confirmado")
  const suma = (t: string) => ok.filter((p) => p.tipo_pago === t).reduce((s, p) => s + p.monto, 0)
  const ultima = (t: string) => {
    const f = ok.filter((p) => p.tipo_pago === t).map((p) => dateToFront(p.fecha_pago))
    return f.length ? f.sort().at(-1) : undefined
  }
  const anticipo = Math.round(total / 2)
  const saldo = total - anticipo
  const liquidado = total > 0 && suma("anticipo") + suma("saldo") >= total
  const antOk = liquidado || (total > 0 && suma("anticipo") >= anticipo)
  const salOk = liquidado || (total > 0 && suma("saldo") >= saldo)
  return {
    ...base,
    total: formatCOP(total),
    totalNum: total,
    anticipo: formatCOP(anticipo),
    anticipoNum: anticipo,
    saldo: formatCOP(saldo),
    saldoNum: saldo,
    estadoAnticipo: antOk ? "Pagado" : "Pendiente",
    estadoSaldo: salOk ? "Pagado" : "Pendiente",
    fechaAnticipo: ultima("anticipo"),
    fechaSaldo: ultima("saldo"),
    porcentaje: (antOk ? 50 : 0) + (salOk ? 50 : 0),
    fechaPago: pagos.length ? dateToFront(pagos.map((p) => p.fecha_pago).sort().at(-1)) : "",
    historial: pagos.map((p) => ({
      id: `pago-${p.id}`,
      fecha: dateToFront(p.fecha_pago),
      monto: formatCOP(p.monto),
      montoNum: p.monto,
      metodo: medio.toFront(p.medio_pago),
      concepto: tipoPago.toFront(p.tipo_pago),
      tipoPago: tipoPago.toFront(p.tipo_pago),
      comprobante: p.url_comprobante ?? undefined,
      estado: estadoPago.toFront(p.estado),
      observaciones: p.observaciones ?? undefined,
    })),
  }
}

async function cargarClientes(venta: number | null, conn?: Conn): Promise<Obj[]> {
  const args = venta ? [venta] : []
  const ventas = await query<Obj>(
    `SELECT v.id_venta, COALESCE(e.valor_total, 0) AS total, e.nombre_evento, e.estado AS ev_estado, ${clienteNombreSql("c")} AS cliente,
            ${personaSql("rs")} AS responsable
       FROM venta v JOIN evento e ON e.id_evento = v.evento_id LEFT JOIN cliente c ON c.id_cliente = e.cliente_id
       LEFT JOIN empleado rs ON rs.id_empleado = e.responsable_id
      WHERE v.estado = 'confirmada' ${venta ? "AND v.id_venta = ?" : ""} ORDER BY v.id_venta DESC`,
    args,
    conn,
  )
  const pagos = groupBy(
    await query<Pago & { venta_id: number }>(
      `SELECT id_pago_cliente AS id, p.* FROM pago_cliente p ${venta ? "WHERE venta_id = ?" : ""} ORDER BY fecha_pago DESC, id_pago_cliente DESC`,
      args,
      conn,
    ),
    (p) => p.venta_id,
  )
  return ventas.map((v) =>
    armar(
      {
        id: `C-${v.id_venta}`,
        tipoCartera: "Clientes",
        evento: v.nombre_evento,
        cliente: v.cliente || "The High Events",
        responsable: v.responsable || undefined,
        eventoFinalizado: ["finalizado", "cerrado_financiero"].includes(v.ev_estado),
      },
      v.total,
      pagos.get(v.id_venta) ?? [],
    ),
  )
}

async function cargarProveedores(ref: { evento: number; proveedor: number } | null, conn?: Conn): Promise<Obj[]> {
  const args = ref ? [ref.evento, ref.proveedor] : []
  const contratos = await query<Obj>(
    `SELECT es.evento_id, es.proveedor_id, MAX(e.nombre_evento) AS evento, MAX(p.razon_social) AS proveedor,
            GROUP_CONCAT(s.nombre ORDER BY es.id_evento_servicio SEPARATOR ', ') AS servicio, SUM(es.costo) AS total,
            MAX(${personaSql("rs")}) AS responsable
       FROM evento_servicio es
       JOIN evento e ON e.id_evento = es.evento_id
       JOIN proveedor p ON p.id_proveedor = es.proveedor_id
       JOIN servicio s ON s.id_servicio = es.servicio_id
       LEFT JOIN empleado rs ON rs.id_empleado = e.responsable_id
      WHERE e.estado <> 'cancelado' ${ref ? "AND es.evento_id = ? AND es.proveedor_id = ?" : ""}
      GROUP BY es.evento_id, es.proveedor_id ORDER BY es.evento_id DESC`,
    args,
    conn,
  )
  const pagos = await query<Pago & { evento_id: number; proveedor_id: number }>(
    `SELECT id_pago_proveedor AS id, p.* FROM pago_proveedor p
      ${ref ? "WHERE evento_id = ? AND proveedor_id = ?" : ""} ORDER BY fecha_pago DESC, id_pago_proveedor DESC`,
    args,
    conn,
  )
  return contratos.map((c) =>
    armar(
      {
        id: `P-${c.evento_id}-${c.proveedor_id}`,
        tipoCartera: "Proveedores",
        evento: c.evento,
        proveedor: c.proveedor,
        servicio: c.servicio,
        responsable: c.responsable || undefined,
      },
      c.total,
      pagos.filter((p) => p.evento_id === c.evento_id && p.proveedor_id === c.proveedor_id),
    ),
  )
}

async function uno(ref: Ref, conn?: Conn): Promise<Obj> {
  const [a] = ref.tipo === "C" ? await cargarClientes(ref.venta, conn) : await cargarProveedores(ref, conn)
  if (!a) throw notFound("No existe ese acuerdo de cartera")
  return a
}

/** Bloquea el acuerdo, inserta los pagos nuevos del historial y verifica los pendientes. */
async function aplicarHistorial(ref: Ref, body: Obj, have: Set<string>, conn: Conn) {
  if (ref.tipo === "C") await query("SELECT 1 FROM venta WHERE id_venta = ? FOR UPDATE", [ref.venta], conn)
  else await query("SELECT 1 FROM evento WHERE id_evento = ? FOR UPDATE", [ref.evento], conn)
  const actual = await uno(ref, conn)
  const existentes = new Map<string, Obj>(actual.historial.map((h: Obj) => [h.id, h]))
  let comprometido = (actual.historial as Obj[]).filter((h) => h.estado !== "Rechazado").reduce((s, h) => s + h.montoNum, 0)
  const tabla = ref.tipo === "C" ? "pago_cliente" : "pago_proveedor"
  const verifica = have.has("abonos.estado") || have.has("abonos.editar")
  // Huella de cada pago con comprobante: detecta reenvíos contra la BD y dentro de la misma petición
  const huella = (tipo: string, monto: number, fecha: string | null, comprobante: string) =>
    JSON.stringify([tipo, monto, fecha, comprobante])
  const vistos = new Set(
    (actual.historial as Obj[])
      .filter((x) => x.comprobante)
      .map((x) => huella(tipoPago.toDb(x.tipoPago), x.montoNum, x.fecha, x.comprobante)),
  )

  for (const h of asArray(body.historial, "historial") as Obj[]) {
    const previo = existentes.get(str(h.id))
    let estado = estadoPago.toDb(h.estado ?? "Pendiente", "Estado del pago")
    if (previo) {
      // Monto, fecha y medio son inmutables; solo se verifica lo pendiente (evita revertir con datos viejos).
      if (previo.estado === "Pendiente" && estado !== "pendiente_verificacion") {
        if (!verifica)
          throw new HttpError(403, "No tiene permiso para verificar pagos")
        const idPago = Number(str(h.id).slice("pago-".length))
        await exec(`UPDATE ${tabla} SET estado = ? WHERE id_${tabla} = ?`, [estado, idPago], conn)
      }
      continue
    }
    if (str(h.id).startsWith("pago-")) throw bad("El historial contiene un pago que no pertenece a este acuerdo")

    if (!have.has("abonos.crear")) throw new HttpError(403, "No tiene permiso para registrar pagos")
    // Registrar no es verificar: sin ese privilegio el pago queda pendiente, diga lo que diga la petición
    if (!verifica) estado = "pendiente_verificacion"
    const tipo = tipoPago.toDb(h.tipoPago ?? h.concepto, "Tipo de pago")
    const monto = moneyReq(h.montoNum ?? h.monto, "El monto")
    if (monto <= 0) throw bad("El monto del pago debe ser mayor que cero")
    const fecha = dateToDb(h.fecha, "La fecha del pago", true)
    const comprobante = referencia(h.comprobante, "El comprobante")
    if (comprobante) {
      const h = huella(tipo, monto, fecha, comprobante)
      if (vistos.has(h)) continue
      vistos.add(h)
    }
    if (tipo === "saldo") {
      // El cierre del evento se lee de la BD; el cumplimiento del proveedor lo declara quien verifica pagos
      const cumple = ref.tipo === "C" ? actual.eventoFinalizado : verifica && body.cumplimientoVerificado
      if (cumple !== true)
        throw conflict(
          ref.tipo === "C"
            ? "El saldo se registra cuando el evento haya finalizado"
            : "El saldo se paga tras verificar el cumplimiento del servicio",
        )
    }
    if (estado !== "rechazado") comprometido += monto
    if (comprometido > actual.totalNum) throw conflict("El pago supera el total del acuerdo")
    const comunes = [tipo, monto, fecha, medio.toDb(h.metodo, "Medio de pago"), estado, comprobante, strOrNull(h.observaciones)]
    const llaves = ref.tipo === "C" ? ["venta_id"] : ["evento_id", "proveedor_id"]
    const valores = ref.tipo === "C" ? [ref.venta] : [ref.evento, ref.proveedor]
    const cols = [...llaves, "tipo_pago", "monto", "fecha_pago", "medio_pago", "estado", "url_comprobante", "observaciones"]
    await exec(
      `INSERT INTO ${tabla} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      [...valores, ...comunes],
      conn,
    )
  }
}

/** POST: el formulario solo envía nombres; se ubica la venta o el contrato que ya existe (no se crean aquí). */
async function ubicar(b: Obj, conn: Conn): Promise<Ref> {
  if (b.tipoCartera !== "Clientes" && b.tipoCartera !== "Proveedores") throw bad("Tipo de cartera inválido")
  if (b.tipoCartera === "Clientes" && intOrNull(b.venta_id)) return { tipo: "C", venta: intOrNull(b.venta_id)! }
  const evento = await requireId("evento", b.evento_id, b.evento, conn)
  if (b.tipoCartera === "Clientes") {
    const ventas = await query<{ id: number }>(
      "SELECT id_venta AS id FROM venta WHERE evento_id = ? AND estado = 'confirmada'",
      [evento],
      conn,
    )
    if (!ventas.length) throw conflict("El evento no tiene una venta registrada: créela primero en Ventas")
    if (ventas.length > 1) throw conflict("El evento tiene varias ventas: registre el pago desde el acuerdo correspondiente")
    return { tipo: "C", venta: ventas[0].id }
  }
  const proveedor = await requireId("proveedor", b.proveedor_id, b.proveedor, conn)
  const [c] = await query(
    "SELECT 1 FROM evento_servicio WHERE evento_id = ? AND proveedor_id = ? LIMIT 1",
    [evento, proveedor],
    conn,
  )
  if (!c) throw conflict("El proveedor no tiene servicios asignados en ese evento: asígnelo primero en Eventos")
  return { tipo: "P", evento, proveedor }
}

export const abonosRouter = Router()

abonosRouter.get(["/", "/:id"], requirePrivilege("abonos.ver"))
abonosRouter.get(
  "/",
  wrap(async (_req, res) => res.json([...(await cargarClientes(null)), ...(await cargarProveedores(null))])),
)
abonosRouter.get("/:id", wrap(async (req, res) => res.json(await uno(parseRef(req.params.id)))))
abonosRouter.post(
  "/",
  requirePrivilege("abonos.crear"),
  wrap(async (req, res) => {
    const have = await privilegesOf(req.user!.rol)
    const out = await tx(async (conn) => {
      const ref = await ubicar(req.body ?? {}, conn)
      await aplicarHistorial(ref, req.body, have, conn)
      return uno(ref, conn)
    })
    res.status(201).json(out)
  }),
)
abonosRouter.put(
  "/:id",
  requirePrivilege("abonos.crear", "abonos.editar", "abonos.estado"),
  wrap(async (req, res) => {
    const ref = parseRef(req.params.id)
    const have = await privilegesOf(req.user!.rol)
    const out = await tx(async (conn) => {
      await aplicarHistorial(ref, req.body ?? {}, have, conn)
      return uno(ref, conn)
    })
    res.json(out)
  }),
)
abonosRouter.delete(
  "/:id",
  // Sin privilegio: la cartera es derivada y un pago nunca se borra
  wrap(async (req) => {
    const ref = parseRef(req.params.id)
    throw conflict(
      `El acuerdo ${refId(ref)} se deriva de ${ref.tipo === "C" ? "una venta: anúlela" : "los servicios del evento: retire el proveedor"} en su módulo`,
    )
  }),
)
