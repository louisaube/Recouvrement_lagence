import { Controller, Get, Put, Req } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited } from '../../platform/audit/audit.decorators'
import type { ApiRequest } from '../../platform/http/request-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidBody, ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import {
  SetUserProfileBody,
  setUserProfileBodySchema,
  setUserProfileResponseSchema,
  UserProfileParams,
  userProfileParamsSchema,
  UserProfilesListQuery,
  userProfilesListQuerySchema,
  userProfilesListResponseSchema,
  profilesMeResponseSchema,
} from './profiles.schemas'
import { ProfilesService } from './profiles.service'

const FORBIDDEN = { description: 'Forbidden - insufficient role permissions' }
const UNAUTHORIZED = { description: 'Unauthorized' }
const CONFLICT = { description: 'Conflict - profiles.channel_required, channel_not_allowed, channel_taken, agent_requires_user_role, cannot_change_own_profile' }

const PROFILE_LABEL: Record<string, string> = {
  supervisor: 'Superviseur',
  agent: 'Compte agent',
  litigation: 'Service litiges',
  indicators: 'Lecteur des indicateurs',
}
const CHANNEL_LABEL: Record<string, string> = { voice: 'Voix', email_sms: 'Courriel et SMS', mail: 'Courrier' }

@ApiTag('Profiles')
@Controller()
export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}

  /** rule-recouvrement-profile-server-enforced: the studio builds its menu from the profile read now. */
  @Get('profiles/me')
  @Access({ action: 'profiles:me', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to read the recovery profile and the channel of the connected account',
    responses: { 200: { description: 'Profile and channel (null without profile)', schema: profilesMeResponseSchema }, 401: UNAUTHORIZED },
  })
  me(@Req() req: ApiRequest) {
    return this.service.me(req.user!.id)
  }

  /** rule-recouvrement-profiles-assigned-by-admin. */
  @Get('user-profiles')
  @Access({ action: 'profiles:list', roles: ['admin'] })
  @ApiRoute({
    description: 'Use this API action to list the accounts that have a recovery profile (administrators only)',
    query: userProfilesListQuerySchema,
    responses: { 200: { description: 'Accounts with a profile, by e-mail', schema: userProfilesListResponseSchema }, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  list(@ValidQuery() query: UserProfilesListQuery) {
    return this.service.list(query)
  }

  /** rule-recouvrement-profiles-assigned-by-admin, rule-recouvrement-profile-single. */
  @Put('user-profiles/:userId')
  @Access({ action: 'profiles:set', roles: ['admin'] })
  @Audited({
    objectType: 'Profil de compte',
    describe: ({ response }) => {
      const { userProfile } = response
      const summary =
        userProfile.profile === null
          ? `Profil retiré à ${userProfile.email}.`
          : userProfile.channel
            ? `Profil ${PROFILE_LABEL[userProfile.profile]} (canal ${CHANNEL_LABEL[userProfile.channel]}) attribué à ${userProfile.email}.`
            : `Profil ${PROFILE_LABEL[userProfile.profile]} attribué à ${userProfile.email}.`
      return { objectId: userProfile.userId, summary }
    },
  })
  @ApiRoute({
    description: 'Use this API action to give, replace or remove the recovery profile of an account (administrators only)',
    params: userProfileParamsSchema,
    body: setUserProfileBodySchema,
    responses: {
      200: { description: 'The profile of the account after the change', schema: setUserProfileResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      409: CONFLICT,
    },
  })
  async set(@ValidParams() params: UserProfileParams, @ValidBody() body: SetUserProfileBody, @Req() req: ApiRequest) {
    return { userProfile: await this.service.set(params.userId, body, req.user!) }
  }
}
