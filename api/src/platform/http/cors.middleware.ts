import type { NextFunction, Request, Response } from 'express'

/**
 * EXI-PLAT-17: a response to a request carrying an `Origin` reflects it in `Access-Control-Allow-Origin`
 * (never `*`) with `Access-Control-Allow-Credentials: true`, so that the studio, served from another port of the
 * same site, sends its session cookie. Preflight requests are answered here, before any routing.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header('origin')
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.vary('Origin')
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
  }
  if (req.method === 'OPTIONS' && origin && req.header('access-control-request-method')) {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', req.header('access-control-request-headers') ?? 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '600')
    res.vary('Access-Control-Request-Headers')
    res.status(204).end()
    return
  }
  next()
}
