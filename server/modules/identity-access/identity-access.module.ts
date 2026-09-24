import { Module } from '@nestjs/common';

import {
  AuthorizationPolicyService,
} from './authorization-policy.service';
import {
  IDENTITY_ACCESS_REPOSITORY,
} from './identity-access.ports';
import {
  PostgresIdentityAccessRepository,
} from './postgres-identity-access.repository';
import {
  ControlDatabaseModule,
} from '@server/modules/control-store/control-database.module';

@Module({
  imports: [ControlDatabaseModule],
  providers: [
    AuthorizationPolicyService,
    PostgresIdentityAccessRepository,
    {
      provide: IDENTITY_ACCESS_REPOSITORY,
      useExisting: PostgresIdentityAccessRepository,
    },
  ],
  exports: [
    AuthorizationPolicyService,
    IDENTITY_ACCESS_REPOSITORY,
  ],
})
class IdentityAccessModule {}

export { IdentityAccessModule };
