import { Module } from '@nestjs/common';

import { ControlDatabaseModule } from
  '@server/modules/control-store/control-database.module';
import { PlatformShellModule } from
  '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { PlaybookAuthoringController } from './playbook-authoring.controller';
import { PlaybookAuthoringService } from './playbook-authoring.service';
import { PLAYBOOK_AUTHORING_REPOSITORY } from './playbook-authoring.ports';
import { PostgresPlaybookAuthoringRepository } from './postgres-playbook-authoring.repository';
import { PlaybookDraftReviewController } from './playbook-draft-review.controller';
import { PlaybookDraftReviewService } from './playbook-draft-review.service';
import { PLAYBOOK_DRAFT_REVIEW_REPOSITORY } from './playbook-authoring.ports';
import { PostgresPlaybookDraftReviewRepository } from './postgres-playbook-draft-review.repository';
import { PlaybookPublicationController } from './playbook-publication.controller';
import { PlaybookPublicationService } from './playbook-publication.service';
import { PLAYBOOK_PUBLICATION_REPOSITORY } from './playbook-publication.ports';
import { PostgresPlaybookPublicationRepository } from './postgres-playbook-publication.repository';
import { PlaybookAdoptionController } from './playbook-adoption.controller';
import { PlaybookAdoptionService } from './playbook-adoption.service';
import { PLAYBOOK_ADOPTION_REPOSITORY } from './playbook-adoption.ports';
import { PostgresPlaybookAdoptionRepository } from './postgres-playbook-adoption.repository';
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
  controllers: [PlaybookOptimizationController, PlaybookAuthoringController, PlaybookDraftReviewController,
    PlaybookPublicationController, PlaybookAdoptionController],
  providers: [
    PlaybookPublicationService,
    PostgresPlaybookPublicationRepository,
    { provide: PLAYBOOK_PUBLICATION_REPOSITORY, useExisting: PostgresPlaybookPublicationRepository },
    PlaybookAdoptionService,
    PostgresPlaybookAdoptionRepository,
    { provide: PLAYBOOK_ADOPTION_REPOSITORY, useExisting: PostgresPlaybookAdoptionRepository },
    PlaybookAuthoringService,
    PostgresPlaybookAuthoringRepository,
    { provide: PLAYBOOK_AUTHORING_REPOSITORY, useExisting: PostgresPlaybookAuthoringRepository },
    PlaybookDraftReviewService,
    PostgresPlaybookDraftReviewRepository,
    { provide: PLAYBOOK_DRAFT_REVIEW_REPOSITORY, useExisting: PostgresPlaybookDraftReviewRepository },
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
