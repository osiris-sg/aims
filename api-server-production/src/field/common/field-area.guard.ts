import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { atLeast, type FieldLevel } from './field-access';
import { FieldContextService } from './field-context.service';
import type { FieldArea } from './field-flags';

export const FIELD_AREA_KEY = 'fieldArea';
export interface FieldAreaMeta {
  area: FieldArea | 'any';
  level: FieldLevel;
}

/** Marks a Field route: its area (flag) and the access level it needs. */
export const FieldRoute = (area: FieldArea | 'any', level: FieldLevel) => SetMetadata(FIELD_AREA_KEY, { area, level } as FieldAreaMeta);

/** The request's FieldCtx (set by FieldAreaGuard). */
export const Field = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().field);

/**
 * Runs after ClerkAuthGuard. Flag off for the area: 404 (the route does not exist for the org).
 * Level below what the route needs: 403. A route without @FieldRoute is refused (fail closed).
 */
@Injectable()
export class FieldAreaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly contexts: FieldContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<FieldAreaMeta>(FIELD_AREA_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) throw new ForbiddenException('Not a Field route');
    const req = context.switchToHttp().getRequest();
    const ctx = await this.contexts.build(req, meta.area);
    if (meta.area !== 'any' && !atLeast(ctx.access.levels[meta.area], meta.level)) throw new ForbiddenException('You do not have access to this part of Field');
    req.field = ctx;
    return true;
  }
}
