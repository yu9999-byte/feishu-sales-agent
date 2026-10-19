import { Module } from '@nestjs/common';

import { FeishuClientFactory } from './feishu-client.factory';
import { FeishuMessengerService } from './feishu-messenger.service';

@Module({
  providers: [FeishuClientFactory, FeishuMessengerService],
  exports: [FeishuClientFactory, FeishuMessengerService],
})
class FeishuApiModule {}

export { FeishuApiModule };
