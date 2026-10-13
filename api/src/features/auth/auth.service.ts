import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import bcrypt from 'bcryptjs'
import { and, desc, eq } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { invalidCredentials } from '../../platform/http/errors'
import { TokenService } from '../../platform/security/token.service'
import { credentials, users } from '../users/users.tables'

/** Hash compared when the e-mail is unknown, so that both failures cost the same time. */
let decoyHash: string | undefined
const decoy = (): string => (decoyHash ??= bcrypt.hashSync(randomUUID(), 10))

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly tokens: TokenService,
  ) {
    decoy() // hashed once at start-up, so that the first unknown e-mail costs the same as any other
  }

  /**
   * rule-auth-login-email-password, rule-foundation-login-single-error: the e-mail is compared exactly (case
   * sensitive) and the password with the bcrypt hash of `base.credentials`. Unknown e-mail and wrong password give
   * the same error. Returns the signed session token.
   */
  async login(email: string, password: string): Promise<string> {
    const [row] = await this.db
      .select({ id: users.id, role: users.role, hash: credentials.password })
      .from(users)
      .innerJoin(credentials, and(eq(credentials.userId, users.id), eq(credentials.type, 'token')))
      .where(eq(users.email, email))
      .orderBy(desc(credentials.createdAt))
      .limit(1)

    const matches = await compare(password, row?.hash ?? decoy())
    if (!row || !matches) throw invalidCredentials()
    return this.tokens.sign({ userId: row.id, role: row.role })
  }
}

async function compare(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash)
  } catch {
    return false
  }
}
