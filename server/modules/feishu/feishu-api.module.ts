import { Module } from '@nestjs/common';

import { FeishuClientFactory } from './feishu-client.factory';

@Module({
  providers: [FeishuClientFactory],
  exports: [FeishuClientFactory],
})
class FeishuApiModule {}

export { FeishuApiModule };
