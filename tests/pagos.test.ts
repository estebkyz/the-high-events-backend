import assert from "node:assert/strict"
import { test } from "node:test"
import { administrador, api, baseEvento, entorno, ok, sql, usuarioCon } from "./ayuda.js"

entorno()
const pago = (extra: object = {}) => ({ tipoPago: "Anticipo", montoNum: 100_000, fecha: "2026-11-20", metodo: "Transferencia", estado: "Pagado", ...extra })

async function venta(token: string) {
  const b = await baseEvento(token)
  const v = ok(await api("POST", "/ventas", token, { evento_id: b.evento.id, numero_factura: `F-${b.evento.id}`, fecha: "2026-11-20" }), 201)
  return { ...b, ref: `C-${v.id}` }
}

test("con solo `abonos.crear` el pago queda pendiente aunque llegue confirmado o rechazado", async () => {
  const admin = await administrador()
  const { ref } = await venta(admin.token)
  const p = await usuarioCon("abonos.ver", "abonos.crear")
  for (const estado of ["Pagado", "Confirmado", "Rechazado"]) {
    const a = ok(await api("PUT", `/abonos/${ref}`, p.token, { historial: [pago({ estado, montoNum: 1000 })] }))
    assert.equal(a.historial[0].estado, "Pendiente", estado)
  }
  const a = ok(await api("GET", `/abonos/${ref}`, p.token))
  assert.equal((await api("PUT", `/abonos/${ref}`, p.token, { historial: [{ ...a.historial[0], estado: "Pagado" }] })).status, 403)
})

test("quien verifica puede confirmar al registrar y después", async () => {
  const admin = await administrador()
  const { ref } = await venta(admin.token)
  const reg = await usuarioCon("abonos.ver", "abonos.crear")
  const ver = await usuarioCon("abonos.ver", "abonos.estado")
  const a = ok(await api("PUT", `/abonos/${ref}`, reg.token, { historial: [pago({ montoNum: 500_000 })] }))
  assert.equal(a.estadoAnticipo, "Pendiente")
  const b = ok(await api("PUT", `/abonos/${ref}`, ver.token, { historial: [{ ...a.historial[0], estado: "Pagado" }] }))
  assert.equal(b.estadoAnticipo, "Pagado")
  assert.equal((await api("PUT", `/abonos/${ref}`, ver.token, { historial: [pago()] })).status, 403, "verificar no es registrar")
  const c = ok(await api("PUT", `/abonos/${ref}`, admin.token, { historial: [pago({ montoNum: 1 })] }))
  assert.equal(c.historial[0].estado, "Pagado")
})

test("el saldo exige que el evento haya finalizado de verdad", async () => {
  const admin = await administrador()
  const { ref, evento } = await venta(admin.token)
  const saldo = { eventoFinalizado: true, historial: [pago({ tipoPago: "Saldo" })] }
  assert.equal((await api("PUT", `/abonos/${ref}`, admin.token, saldo)).status, 409)
  await sql("UPDATE evento SET estado = 'finalizado' WHERE id_evento = ?", [evento.id])
  ok(await api("PUT", `/abonos/${ref}`, admin.token, saldo))
})

test("montos inválidos, excedidos y enlaces peligrosos se rechazan", async () => {
  const admin = await administrador()
  const { ref } = await venta(admin.token)
  for (const [m, s] of [
    [0, 400],
    [-5, 400],
    ["abc", 400],
    [1_000_001, 409],
  ])
    assert.equal((await api("PUT", `/abonos/${ref}`, admin.token, { historial: [pago({ montoNum: m })] })).status, s, String(m))
  assert.equal((await api("PUT", `/abonos/${ref}`, admin.token, { historial: [pago({ comprobante: "javascript:alert(1)" })] })).status, 400)
  ok(await api("PUT", `/abonos/${ref}`, admin.token, { historial: [pago({ comprobante: "Ref: TR-2026-9941", montoNum: 10 })] }))
})

test("dos pagos simultáneos no superan el total", async () => {
  const admin = await administrador()
  const { ref } = await venta(admin.token)
  const r = await Promise.all([1, 2, 3].map(() => api("PUT", `/abonos/${ref}`, admin.token, { historial: [pago({ montoNum: 600_000 })] })))
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409, 409])
})
