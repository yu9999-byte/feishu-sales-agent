import { Module } from '@nestjs/common';

import { ControlDatabaseModule } from
  '@server/modules/control-store/control-database.module';
import { PlatformShellModule } from
  '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { PlaybookOptimizationController } from
  './playbook-optimization.controller';
import {
  PLAYBOOK_OPTIMIZATION_OBSERVER,
  PLAYBOOK_OPTIMIZATION_REPOSITORY,
} from './playbook-optimization.ports';
import { PlaybookOptimizationService } from
  './playbook-optimization.service';
import { PostgresPlaybookOptimizationRepository } from
  './postgres-playbook-optimization.repository';

@Module({
  imports: [ControlDatabaseModule, PlatformShellModule, WebAuthModule],
  controllers: [PlaybookOptimizationController],
  providers: [
    PlaybookOptimizationService,
    PostgresPlaybookOptimizationRepository,
    {
      provide: PLAYBOOK_OPTIMIZATION_REPOSITORY,
      useExisting: PostgresPlaybookOptimizationRepository,
    },
    {
      provide: PLAYBOOK_OPTIMIZATION_OBSERVER,
      useExisting: PlaybookOptimizationService,
    },
  ],
  exports: [PLAYBOOK_OPTIMIZATION_OBSERVER, PlaybookOptimizationService],
})
class PlaybookOptimizationModule {}

export { PlaybookOptimizationModule };
