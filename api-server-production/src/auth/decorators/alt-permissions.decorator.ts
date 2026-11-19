// src/auth/decorators/alt-permissions.decorator.ts
//
// A second way through a route's @Permissions (WCT round 30, Elroy 2026-11-20: Operations may
// update DOs and jobs, not every document type). ClerkAuthGuard consults it ONLY after the
// route's own @Permissions check has FAILED, so everyone who passes today passes exactly as
// before; a caller who fails it is let through when they hold one of `permissions` and, when
// `docTypes` is set, the document the request is about (route param `id` or body `id`) is one
// of those types in their org.
import { SetMetadata } from '@nestjs/common';

export const ALT_PERMISSIONS_KEY = 'altPermissions';

export interface AltPermissionsRule {
  /** Any ONE of these admits the caller. */
  permissions: string[];
  /** Only for a document of these types (Document.type, upper case). */
  docTypes?: string[];
  /** Where the document id is: the route param `id` (default) or the body's `id`. */
  docIdFrom?: 'param' | 'body';
}

export const AltPermissions = (rule: AltPermissionsRule) => SetMetadata(ALT_PERMISSIONS_KEY, rule);

/** Delivery orders: what `deliveries:update` may change through the generic document routes. */
export const DO_DOC_TYPES = ['DELIVERY_ORDER', 'DO'];

/** Update on jobs and delivery orders only (the Operations preset), instead of documents:update. */
export const DELIVERIES_UPDATE = 'deliveries:update';
export const DO_UPDATE_ALT = (docIdFrom: 'param' | 'body' = 'param'): AltPermissionsRule => ({ permissions: [DELIVERIES_UPDATE], docTypes: DO_DOC_TYPES, docIdFrom });
export const JOB_UPDATE_ALT: AltPermissionsRule = { permissions: [DELIVERIES_UPDATE] };
