import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './decorators/public.decorator';

/** When this process started (the deploy check reads it with the commit). */
const STARTED_AT = new Date().toISOString();

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Deploy check (2026-11-03): which commit this instance runs. Render sets
  // RENDER_GIT_COMMIT; nothing else is returned. Not logged (SKIP_PATHS).
  @Public()
  @Get('health')
  health() {
    return { ok: true, commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null, startedAt: STARTED_AT };
  }
}
