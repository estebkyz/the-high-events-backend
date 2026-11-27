import type { NextFunction, Request, RequestHandler, Response } from "express"

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const bad = (msg: string) => new HttpError(400, msg)
export const notFound = (msg = "Registro no encontrado") => new HttpError(404, msg)
export const conflict = (msg: string) => new HttpError(409, msg)

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<unknown>
export const wrap =
  (fn: AsyncFn): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next)
  }

export function idParam(req: Request, name = "id"): number {
  const n = Number(req.params[name])
  if (!Number.isInteger(n) || n <= 0) throw bad("Identificador inválido")
  return n
}
