import { Module } from '@nestjs/common';

import { FeishuApiModule } from
  '@server/modules/feishu/feishu-api.module';
import { FeishuSalesMaterialGateway } from
  './feishu-sales-material.gateway';
import { SalesMaterialRetrievalService } from
  './sales-material-retrieval.service';
import { SALES_MATERIAL_GATEWAY } from './sales-material.ports';

@Module({
  imports: [FeishuApiModule],
  providers: [
    FeishuSalesMaterialGateway,
    SalesMaterialRetrievalService,
    {
      provide: SALES_MATERIAL_GATEWAY,
      useExisting: FeishuSalesMaterialGateway,
    },
  ],
  exports: [SalesMaterialRetrievalService],
})
class SalesMaterialModule {}

export { SalesMaterialModule };
