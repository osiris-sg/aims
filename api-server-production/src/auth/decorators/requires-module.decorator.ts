import { SetMetadata } from '@nestjs/common';

export const REQUIRES_MODULE_KEY = 'requiresModule';

/**
 * Round Y (2026-10-22): the controller (or route) belongs to an org MODULE (MODULE_CATALOG code, e.g. 'SHIPMENTS').
 * ModuleGuard answers 403 when the request's organization does not have that module enabled — the UI hides the
 * screens, this makes the API refuse too.
 */
export const RequiresModule = (moduleCode: string) => SetMetadata(REQUIRES_MODULE_KEY, moduleCode);
