import { Module } from '@nestjs/common';

import { FeishuApiModule } from
  '@server/modules/feishu/feishu-api.module';
import { FeishuSalesMaterialGateway } from
  './feishu-sales-material.gateway';
import { SalesKnowledgeQaService } from './sales-knowledge-qa.service';
import { SALES_KNOWLEDGE_QA } from './sales-knowledge-qa.ports';
import { SalesMaterialRetrievalService } from
  './sales-material-retrieval.service';
import { SALES_MATERIAL_GATEWAY } from './sales-material.ports';

@Module({
  imports: [FeishuApiModule],
  providers: [
    FeishuSalesMaterialGateway,
    SalesKnowledgeQaService,
    SalesMaterialRetrievalService,
    {
      provide: SALES_MATERIAL_GATEWAY,
      useExisting: FeishuSalesMaterialGateway,
    },
    {
      provide: SALES_KNOWLEDGE_QA,
      useExisting: SalesKnowledgeQaService,
    },
  ],
  exports: [
    SALES_KNOWLEDGE_QA,
    SalesKnowledgeQaService,
    SalesMaterialRetrievalService,
  ],
})
class SalesMaterialModule {}

export { SalesMaterialModule };
