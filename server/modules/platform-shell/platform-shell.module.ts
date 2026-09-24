import { Module } from '@nestjs/common';

import { IdentityAccessModule } from '@server/modules/identity-access/identity-access.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { PlatformShellController } from './platform-shell.controller';
import { PlatformSessionService } from './platform-session.service';
import { PlatformShellService } from './platform-shell.service';
import { WebPageController } from './web-page.controller';

@Module({
  imports: [IdentityAccessModule, WebAuthModule],
  controllers: [PlatformShellController, WebPageController],
  providers: [PlatformSessionService, PlatformShellService],
  exports: [PlatformSessionService, PlatformShellService],
})
class PlatformShellModule {}

export { PlatformShellModule };
