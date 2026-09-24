import { Module } from '@nestjs/common';

import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { ControlDatabaseModule } from '@server/modules/control-store/control-database.module';
import { FeishuApiModule } from '@server/modules/feishu/feishu-api.module';
import { IdentityAccessModule } from '@server/modules/identity-access/identity-access.module';
import { FeishuOAuthApiGateway } from './feishu-oauth.gateway';
import { FeishuWebAuthController } from './feishu-web-auth.controller';
import { FeishuWebAuthService } from './feishu-web-auth.service';
import { PostgresWebAuthStore } from './postgres-web-auth.store';
import { SecureTokenGenerator } from './secure-token.generator';
import {
  FEISHU_OAUTH_GATEWAY,
  TOKEN_GENERATOR,
  WEB_AUTH_STORE,
  WEB_PUBLIC_URL,
} from './web-auth.ports';

@Module({
  imports: [
    ControlDatabaseModule,
    AgentControlModule,
    FeishuApiModule,
    IdentityAccessModule,
  ],
  controllers: [FeishuWebAuthController],
  providers: [
    FeishuOAuthApiGateway,
    FeishuWebAuthService,
    PostgresWebAuthStore,
    SecureTokenGenerator,
    {
      provide: FEISHU_OAUTH_GATEWAY,
      useExisting: FeishuOAuthApiGateway,
    },
    {
      provide: WEB_AUTH_STORE,
      useExisting: PostgresWebAuthStore,
    },
    {
      provide: TOKEN_GENERATOR,
      useExisting: SecureTokenGenerator,
    },
    {
      provide: WEB_PUBLIC_URL,
      useFactory: (): string => {
        const configured: string | undefined =
          process.env.WEB_PUBLIC_URL;
        if (configured) {
          return configured;
        }
        if (process.env.NODE_ENV !== 'production') {
          const port: string = process.env.AGENT_PORT || '3100';
          return `http://localhost:${port}`;
        }
        throw new Error('Missing required environment variable: WEB_PUBLIC_URL');
      },
    },
  ],
  exports: [FeishuWebAuthService],
})
class WebAuthModule {}

export { WebAuthModule };
