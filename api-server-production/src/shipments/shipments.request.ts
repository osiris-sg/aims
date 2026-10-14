import { Request } from 'express';

export interface TradeRequest extends Request {
  userOrganization?: { id: string; name: string };
  user?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    emailAddresses?: { emailAddress: string }[];
  };
}

/** Who did it — stamped on steps and files. */
export interface TradeActor {
  id: string | null;
  name: string | null;
}

export function orgIdOf(req: TradeRequest): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

export function actorOf(req: TradeRequest): TradeActor {
  const u = req.user;
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.emailAddresses?.[0]?.emailAddress || null;
  return { id: u?.id ?? null, name };
}
