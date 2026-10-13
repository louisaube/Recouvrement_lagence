import { Injectable } from '@nestjs/common'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { getConfig } from '../config/config'
import type { Role } from '../access/access.decorators'

/** Session lifetime: 24 hours, stateless (Q-AUTH-03). */
export const SESSION_SECONDS = 24 * 60 * 60

const claimsSchema = z.object({ sub: z.uuid(), role: z.enum(['user', 'admin']) })
export interface SessionClaims {
  userId: string
  /** Role at login time: frozen until the next login (Q-AUTH-04). */
  role: Role
}

@Injectable()
export class TokenService {
  sign(claims: SessionClaims): string {
    return jwt.sign({ role: claims.role }, getConfig().jwtSecret, {
      algorithm: 'HS256',
      subject: claims.userId,
      expiresIn: SESSION_SECONDS,
    })
  }

  /** Returns the claims of a valid token, `null` for any invalid, tampered or expired token. */
  verify(token: string): SessionClaims | null {
    try {
      const payload = jwt.verify(token, getConfig().jwtSecret, { algorithms: ['HS256'] })
      const parsed = claimsSchema.safeParse(payload)
      return parsed.success ? { userId: parsed.data.sub, role: parsed.data.role } : null
    } catch {
      return null
    }
  }
}
