import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { AsyncLocalStorage } from 'node:async_hooks'
import { IMPORT_TYPES, ImportType } from './recovery-imports.constants'

/**
 * The confirmation of the five imports is one route (`recovery-imports:confirm`, one action code) but the object type
 * of its audit entry depends on the file (« Import de créances », « Import de paiements »...). The declaration of the
 * route reads the type here, set around the handling of the request by `ImportTypeMiddleware`.
 */
export const importTypeStorage = new AsyncLocalStorage<{ type: ImportType }>()

const PATTERN = new RegExp(`/recovery-imports/(${IMPORT_TYPES.join('|')})/`)

@Injectable()
export class ImportTypeMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const found = PATTERN.exec(req.originalUrl ?? req.url)
    if (!found) return next()
    importTypeStorage.run({ type: found[1] as ImportType }, next)
  }
}
