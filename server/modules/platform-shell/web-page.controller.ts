import { Controller, Get, Res } from '@nestjs/common';
import { join } from 'node:path';

import type { Response } from 'express';

@Controller()
class WebPageController {
  @Get([
    '/',
    'customers',
    'opportunities',
    'followups',
    'followups/new',
    'followups/:id',
    'followups/:id/edit',
    'tasks',
    'reviews/team',
    'analytics',
    'playbooks',
    'admin/members',
    'admin/audit',
  ])
  show(@Res() response: Response): void {
    response.sendFile(
      join(process.cwd(), 'dist/agent-web/agent.html'),
    );
  }
}

export { WebPageController };
