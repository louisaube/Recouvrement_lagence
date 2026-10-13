import { Module } from '@nestjs/common'
import { ImportsModule } from '../imports/imports.module'
import { UsersImportController } from './users-import.controller'
import { UsersImportDefinition } from './users-import.definition'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  imports: [ImportsModule],
  controllers: [UsersController, UsersImportController],
  providers: [UsersService, UsersImportDefinition],
})
export class UsersModule {}
