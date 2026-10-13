import { CanActivate, ExecutionContext, Inject, Injectable, mixin, Type } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DB, Database } from '../../platform/database/database.module'
import { accessDenied } from '../../platform/http/errors'
import type { ApiRequest } from '../../platform/http/request-context'
import { Profile, userProfiles } from './profiles.tables'

const cache = new Map<string, Type<CanActivate>>()

/**
 * rule-recouvrement-profile-server-enforced: the profile is read from the database at every request (never from the
 * token), before any validation or reading of the body, and a refusal reveals nothing about the object asked for.
 * rule-recouvrement-admin-no-business-access: the role of the account is not looked at, only its profile.
 * The platform has already answered 401 to a visitor (route declared `roles: []`).
 */
export function RequireProfile(...allowed: Profile[]): Type<CanActivate> {
  const key = [...allowed].sort().join('|')
  const known = cache.get(key)
  if (known) return known

  @Injectable()
  class RequireProfileGuard implements CanActivate {
    constructor(@Inject(DB) readonly db: Database) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest<ApiRequest>()
      if (!req.user) throw accessDenied()
      const [row] = await this.db.select({ profile: userProfiles.profile }).from(userProfiles).where(eq(userProfiles.userId, req.user.id))
      if (!row || !(allowed as string[]).includes(row.profile)) throw accessDenied()
      return true
    }
  }
  const guard = mixin(RequireProfileGuard)
  cache.set(key, guard)
  return guard
}
