import { Injectable } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import type { Readable } from 'node:stream';

import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  MinutesTranscriptGatewayError,
  type MinutesTranscriptGateway,
} from
  '@server/modules/sales-behavior/minutes-ingestion.service';
import { FeishuClientFactory } from './feishu-client.factory';

@Injectable()
class FeishuMinutesGateway implements MinutesTranscriptGateway {
  constructor(private readonly clients: FeishuClientFactory) {}

  async readTranscript(input: {
    integration: TenantIntegration;
    minuteToken: string;
    accessToken: string;
  }): Promise<{ title: string; transcript: string }> {
    const client: lark.Client = this.clients.getClient(input.integration);
    try {
      const options = lark.withUserAccessToken(input.accessToken);
      const metadata = await client.minutes.v1.minute.get(
        {
          path: { minute_token: input.minuteToken },
          params: { user_id_type: 'open_id' },
        },
        options,
      );
      if (metadata.code !== undefined && metadata.code !== 0) {
        throw this.fromCode(metadata.code);
      }
      const transcriptResponse = await client.minutes.v1.minuteTranscript.get(
        {
          path: { minute_token: input.minuteToken },
          params: {
            need_speaker: true,
            need_timestamp: true,
            file_format: 'txt',
          },
        },
        options,
      );
      const transcript: string = await this.readUtf8(
        transcriptResponse.getReadableStream(),
      );
      return {
        title: metadata.data?.minute?.title?.trim() || '飞书妙记',
        transcript,
      };
    } catch (error: unknown) {
      if (error instanceof MinutesTranscriptGatewayError) throw error;
      const code: number | undefined = this.readUpstreamCode(error);
      if (code === 2091005 || code === 99991679) {
        throw new MinutesTranscriptGatewayError('ACCESS_DENIED');
      }
      throw new MinutesTranscriptGatewayError('UNAVAILABLE');
    }
  }

  private async readUtf8(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), 'utf8'));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private fromCode(code: number): MinutesTranscriptGatewayError {
    return new MinutesTranscriptGatewayError(
      code === 2091005 || code === 99991679
        ? 'ACCESS_DENIED'
        : 'UNAVAILABLE',
    );
  }

  private readUpstreamCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const response: unknown = Reflect.get(error, 'response');
    if (typeof response !== 'object' || response === null) return undefined;
    const data: unknown = Reflect.get(response, 'data');
    if (typeof data !== 'object' || data === null) return undefined;
    const code: unknown = Reflect.get(data, 'code');
    return typeof code === 'number' ? code : undefined;
  }
}

export { FeishuMinutesGateway };
