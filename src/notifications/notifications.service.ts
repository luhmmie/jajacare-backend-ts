import { Injectable, MessageEvent, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { AuthUser } from '../common/types';
import { AppEvent, shouldReceive, StreamIdentity } from './notification-filter';

const TICKET_TTL_MS = 30_000;
const HEARTBEAT_MS = 25_000;

/**
 * Real-time events over Server-Sent Events.
 *
 * Browsers' EventSource cannot send an Authorization header, so the client first calls POST /notifications/ticket
 * (normal JWT auth) and then opens the stream with the returned single-use, 30-second ticket.
 *
 * State is in memory, which is right for a single API instance. Running several instances needs a shared
 * broker (Redis pub/sub) behind `publish` and a shared ticket store. Events are not persisted: a client that
 * reconnects should refetch GET /appointments/queue to catch up.
 */
@Injectable()
export class NotificationsService {
  private readonly events$ = new Subject<AppEvent>();
  private readonly tickets = new Map<string, { identity: StreamIdentity; expiresAt: number }>();

  publish(event: AppEvent): void {
    this.events$.next(event);
  }

  issueTicket(user: AuthUser): { ticket: string; expiresInSeconds: number } {
    this.pruneTickets();
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { identity: { userId: user.id, role: user.role }, expiresAt: Date.now() + TICKET_TTL_MS });
    return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 };
  }

  /** Single use: the ticket is deleted the moment it is redeemed. */
  redeemTicket(ticket: string | undefined): StreamIdentity {
    const entry = ticket ? this.tickets.get(ticket) : undefined;
    if (ticket) this.tickets.delete(ticket);
    if (!entry || entry.expiresAt < Date.now()) throw new UnauthorizedException('Invalid or expired stream ticket');
    return entry.identity;
  }

  streamFor(identity: StreamIdentity): Observable<MessageEvent> {
    const events = this.events$.pipe(
      filter((e) => shouldReceive(identity, e)),
      map((e): MessageEvent => ({ type: e.type, data: e })),
    );
    // Keeps proxies and load balancers from closing an idle connection.
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));
    return merge(events, heartbeat);
  }

  private pruneTickets(): void {
    const now = Date.now();
    for (const [t, v] of this.tickets) if (v.expiresAt < now) this.tickets.delete(t);
  }
}
