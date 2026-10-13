import { Global, Module } from '@nestjs/common'
import { SessionService } from './session.service'
import { TokenService } from './token.service'

@Global()
@Module({ providers: [TokenService, SessionService], exports: [TokenService, SessionService] })
export class SecurityModule {}
