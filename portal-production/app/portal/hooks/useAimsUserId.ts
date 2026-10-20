"use client";

import { useUser } from "@clerk/nextjs";

/**
 * The signed-in user's AIMS id: the id every database row stores.
 *
 * Normally that is the Clerk user id. After the move to the Clerk PRODUCTION
 * instance (docs/clerk-cutover.md) imported users get a new Clerk id and keep
 * their old one as Clerk's `externalId`, which is what the DB still holds. So:
 * externalId when set, else the Clerk id. On the dev instance externalId is
 * null or equal to the id, so this is exactly `user.id`.
 *
 * Use this (not useUser().id / useAuth().userId) whenever the id is compared
 * with, or written into, AIMS data.
 */
export function useAimsUserId(): string | null {
  const { user } = useUser();
  if (!user) return null;
  return user.externalId || user.id;
}
