import { Injectable, Logger } from '@nestjs/common';

/**
 * Round BB — "records changed" signal (an order / shipment created or edited, a B/L or PI typed, orders renumbered).
 * The email intake listens and matches its open question cards again (EmailTriageService.rematchOpen), so a card
 * that now matches exactly closes and the others get fresher guesses. In-process, fire-and-forget; listeners
 * never block or fail the write that emitted.
 */
@Injectable()
export class TradeRecordEvents {
  private readonly logger = new Logger(TradeRecordEvents.name);
  private readonly listeners: Array<(organizationId: string, what: string) => void> = [];

  on(fn: (organizationId: string, what: string) => void) {
    this.listeners.push(fn);
  }

  changed(organizationId: string, what: string) {
    for (const fn of this.listeners) {
      try {
        fn(organizationId, what);
      } catch (e) {
        this.logger.warn(`[record-events] ${what}: ${(e as Error)?.message}`);
      }
    }
  }
}
