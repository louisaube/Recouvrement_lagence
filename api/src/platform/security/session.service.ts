import { Injectable } from '@nestjs/common'
import type { CookieOptions, Request, Response } from 'express'
import { eq } from 'drizzle-orm'
import { users } from '../../features/users/users.tables'
import { getConfig } from '../config/config'
import { Database, InjectDb } from '../database/database.module'
import { invalidToken } from '../http/errors'
import type { AuthenticatedUser } from '../http/request-context'
import { SESSION_SECONDS, TokenService } from './token.service'

const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/

/** Where a request keeps its session token. */
export type TokenSource = { kind: 'none' } | { kind: 'present'; token: string } | { kind: 'malformed' }

/**
 * Session resolution shared by the access guard and `GET /auth/current-user`.
 * Bearer token first, then the session cookie `<slug>-jwt-<host of the Origin>` (Referer when there is no Origin,
 * port excluded): `rule-foundation-session-persists`.
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly tokens: TokenService,
  ) {}

  /** Host name (port excluded) of the Origin header; `null` when absent or unusable (login, logout). */
  originHost(req: Request): string | null {
    return hostOf(req.header('origin'))
  }

  /** Host name of the Origin, else of the Referer (page reload); `null` when neither is usable. */
  browserHost(req: Request): string | null {
    return hostOf(req.header('origin')) ?? hostOf(req.header('referer'))
  }

  cookieName(host: string): string {
    return `${getConfig().slug}-jwt-${host}`
  }

  /** Attributes shared by the login cookie and the logout cookie (Q-AUTH-05): they must match to delete it. */
  cookieOptions(host: string): CookieOptions {
    return { domain: host, path: '/', httpOnly: true, sameSite: 'strict', secure: host !== 'localhost' }
  }

  setSessionCookie(res: Response, host: string, token: string): void {
    res.cookie(this.cookieName(host), token, { ...this.cookieOptions(host), maxAge: SESSION_SECONDS * 1000 })
  }

  clearSessionCookie(res: Response, host: string): void {
    res.clearCookie(this.cookieName(host), this.cookieOptions(host))
  }

  tokenSource(req: Request): TokenSource {
    const authorization = req.header('authorization')
    if (authorization !== undefined) {
      // RFC 6750 §2.1: `Bearer`, one or more spaces (U+0020 only), then a token without any whitespace; no second
      // token (rule-foundation-session-expired). Node's HTTP parser already strips the whitespace around the whole
      // value, so padding there is invisible to the application.
      const match = /^Bearer +(\S+)$/i.exec(authorization)
      return match ? { kind: 'present', token: match[1] } : { kind: 'malformed' }
    }
    const host = this.browserHost(req)
    const cookies = req.header('cookie')
    if (host && cookies) {
      const wanted = this.cookieName(host)
      for (const part of cookies.split(';')) {
        const index = part.indexOf('=')
        if (index === -1 || part.slice(0, index).trim() !== wanted) continue
        const value = part.slice(index + 1).trim()
        if (value) return { kind: 'present', token: decodeCookieValue(value) }
      }
    }
    return { kind: 'none' }
  }

  /**
   * `null` without any token; `401 security.invalid_token` for a token that is present but invalid, expired,
   * or valid for an account that no longer exists (`rule-foundation-session-expired`).
   */
  async authenticate(req: Request): Promise<AuthenticatedUser | null> {
    const source = this.tokenSource(req)
    if (source.kind === 'none') return null
    if (source.kind === 'malformed') throw invalidToken()
    const claims = this.tokens.verify(source.token)
    if (!claims) throw invalidToken()
    const [row] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, claims.userId))
      .limit(1)
    if (!row) throw invalidToken()
    return { id: row.id, email: row.email, role: claims.role }
  }
}

function hostOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    const host = new URL(value).hostname
    return HOST_PATTERN.test(host) ? host : null
  } catch {
    return null // an unusable value counts as absent
  }
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
