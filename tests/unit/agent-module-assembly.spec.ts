import 'reflect-metadata';

import {
  MODULE_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AgentExecutionModule } from
  '@server/modules/agent-core/agent-execution.module';
import { AgentWorkflowService } from
  '@server/modules/agent-core/agent-workflow.service';
import { SALES_KNOWLEDGE_QA } from
  '@server/modules/knowledge/sales-knowledge-qa.ports';
import { SalesMaterialModule } from
  '@server/modules/knowledge/sales-material.module';
import { PlaybookOptimizationModule } from
  '@server/modules/knowledge/playbook-optimization.module';
import { PLAYBOOK_OPTIMIZATION_OBSERVER } from
  '@server/modules/knowledge/playbook-optimization.ports';

interface DeclaredDependency {
  index: number;
  param: unknown;
}

describe('Agent knowledge QA module assembly', (): void => {
  it('imports and re-exports the sales material module', (): void => {
    const imports: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AgentExecutionModule,
    ) ?? [];
    const exports: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      AgentExecutionModule,
    ) ?? [];

    expect(imports).toContain(SalesMaterialModule);
    expect(exports).toContain(SalesMaterialModule);
    expect(imports).toContain(PlaybookOptimizationModule);
    expect(exports).toContain(PlaybookOptimizationModule);
  });

  it('requires the knowledge QA port in the workflow constructor', (): void => {
    const dependencies: DeclaredDependency[] = Reflect.getMetadata(
      SELF_DECLARED_DEPS_METADATA,
      AgentWorkflowService,
    ) ?? [];

    expect(dependencies).toContainEqual({
      index: 8,
      param: SALES_KNOWLEDGE_QA,
    });
    expect(dependencies).toContainEqual({
      index: 9,
      param: PLAYBOOK_OPTIMIZATION_OBSERVER,
    });
  });
});
