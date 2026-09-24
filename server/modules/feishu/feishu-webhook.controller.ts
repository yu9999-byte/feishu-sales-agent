import { Controller, Post, Req, Res } from '@nestjs/common';

import type { Request, Response } from 'express';
import { FeishuWebhookBridge } from './feishu-webhook.bridge';

@Controller('webhooks/feishu')
export class FeishuWebhookController {
  constructor(private readonly bridge: FeishuWebhookBridge) {}

  @Post('events')
  async receiveEvent(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.bridge.handleEvent(request, response);
  }

  @Post('cards')
  async receiveCardAction(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.bridge.handleCard(request, response);
  }
}
