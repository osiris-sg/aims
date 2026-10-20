# Clerk: development instance to production instance

AIMS runs on the Clerk **development** instance (`legal-sheep-37.clerk.accounts.dev`).
This is the checklist for moving `app.ai-ms.io` to a new Clerk **production**
instance while the dev instance stays on for local dev and staging.

**User ids in the database do not change.** Every AIMS table stores the Clerk id
the user had on the dev instance (`UserRole.userId`, `ActionLog.actorId`,
`Delivery.riderUserId`, about 70 columns, no User table). Imported production
users keep that id as their Clerk `external_id`, and the production session
token hands it back to the API as the `aims_uid` claim.

## What is already in the code (prep, a no-op on the dev instance)

| Piece | Where | Behaviour on the dev instance |
|---|---|---|
| `req.user.id = payload.aims_uid \|\| payload.sub`, `req.user.clerkId = sub` | `api-server-production/src/auth/clerk.strategy.ts` | No `aims_uid` claim, so `id = sub` exactly as before |
| Dual-key verify: `CLERK_SECRET_KEY`, then `CLERK_SECRET_KEY_LEGACY` | same | `..._LEGACY` unset, so one key as before |
| `CLERK_AUTHORIZED_PARTIES` (comma list, azp check) | same | Unset, so no azp check as before |
| One Clerk client (`@clerk/backend`) for the whole API | `src/clerk/clerk.module.ts` (global) | Same calls, one client instead of three |
| `ClerkIdentityService.toClerkUsers(dbIds)`: by `externalId`, then by `userId`, cached 5 min | `src/clerk/clerk-identity.service.ts`; used by users, admin, customers, organizations, trade-alerts, operator-auth | Same users as `getUser(id)`, in one batched call |
| New users get `external_id` = their own id | `users.service.ts`, `admin.service.ts` `createUser` | Harmless; every user then resolves the same way |
| `useAimsUserId()` = `user.externalId ?? user.id` | `portal-production/app/portal/hooks/useAimsUserId.ts`; used in TabbedDocumentCreator (salesman), IdDashboard (my row), IdQuotationList (designerUserId) | Equal to `user.id` |
| Import script, dry run by default | `api-server-production/scripts/_clerk-import-users.ts` | Not run |

## Numbers at the time of planning (2026-10-21)

- 71 users on the dev instance: 34 AIMS members (all with passwords, 2 with Google, 1 phone-only), 25 SiteClock-only, 4 both, 12 neither.
- SiteClock (`siteclock.osiris.sg`) is a **satellite of the same instance** (29 users carry `public_metadata.siteclock`). Decide before cutover: move SiteClock to the production instance too (its backend needs the same external_id treatment), or decouple it (plain link from the app switcher, separate logins, drop `allowedRedirectOrigins` in `portal-production/app/layout.tsx`).

## Manual setup (Clerk dashboard, DNS, Google)

1. Clerk dashboard: create the production instance for the AIMS application. Root domain `ai-ms.io` (app at `app.ai-ms.io`).
2. DNS for `ai-ms.io`: add the CNAMEs the dashboard lists (typically `clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`). Wait for verification and SSL.
3. Sign-in methods: same as dev. Email + password, email code, username if used, phone/SMS (check pricing), Google with **your own** Google Cloud OAuth client (redirect URI `https://clerk.ai-ms.io/v1/oauth_callback`).
4. Sessions, customise session token. Keep whatever the dev instance has (`first_name`, `last_name`, `email` if set, which saves the API a profile fetch per request) and add:
   ```json
   { "aims_uid": "{{user.external_id}}" }
   ```
5. Allowed origins and redirect URLs: `https://app.ai-ms.io` (+ `https://siteclock.osiris.sg` only if SiteClock moves; satellites may need a paid plan).
6. Export the dev users (dashboard user export, CSV). Check whether it includes `password_digest` + `password_hasher`. If not, users without a digest reset their password by email code after the move.
7. Copy the production `pk_live_...` and `sk_live_...` keys.
8. The Android app needs **no new APK**: production Clerk domains are under `*.ai-ms.io`, already in Capacitor `allowNavigation`, and the app loads the live site.

## Rehearsal (before the real day)

1. Point a subdomain of the production root domain (e.g. `preview.ai-ms.io`) at a Vercel preview with the production instance keys and the **staging** database.
2. Import into the production instance (dry run, then `--apply`), as below.
3. Sign in on the rehearsal site as an admin, an office user, a rider and a designer; check the items under "Verify" below.

## Import (dry run first)

```bash
cd api-server-production
# dev ids to import, e.g. the AIMS members (PROD UserOrganization / UserRole user ids)
CLERK_TARGET_SECRET_KEY=sk_live_... npx ts-node scripts/_clerk-import-users.ts \
  --file ~/Downloads/clerk-users-export.csv --only aims-member-ids.txt --out clerk-mapping.csv
# read clerk-mapping.csv (would_create / skip_*), then:
CLERK_TARGET_SECRET_KEY=sk_live_... npx ts-node scripts/_clerk-import-users.ts \
  --file ~/Downloads/clerk-users-export.csv --only aims-member-ids.txt --out clerk-mapping.csv --apply
```

Re-running is safe: users whose dev id is already an `external_id` on the target are skipped.

## Cutover day

Expected impact: the API stays up throughout. Every user is signed out once and signs in again (portal and field app).

1. **T-1h:** freeze user creation in AIMS (no new users in User Management).
2. Run the import again (delta) with `--apply`. Check `clerk-mapping.csv` has no `error` rows.
3. **Render (API, prod service):** set
   - `CLERK_SECRET_KEY` = production `sk_live_...`
   - `CLERK_PUBLISHABLE_KEY` = production `pk_live_...`
   - `CLERK_SECRET_KEY_LEGACY` = the dev instance `sk_test_...`
   - `CLERK_AUTHORIZED_PARTIES` = `https://app.ai-ms.io` (optional, recommended)

   Deploy. The API now accepts tokens from **both** instances, so nothing breaks yet. (Dev-instance tokens carry the dev id as `sub`, which is already the DB id.)
4. **Vercel (portal, Production):** set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to the production keys. They are build-time values: build a production deployment, then promote it (about 5 to 8 minutes of build, the switch itself is instant).
5. Users land on `/sign-in` once and sign in on the production instance. The field app (Capacitor) loads the live site, so riders do the same.

## Verify (after step 5)

- Sign in as osirisadmin, an office user, a rider and a designer.
- Activity Log: new rows show the **same actor id** as that user's rows from before the cutover (`ActionLog.actorId`).
- User Management list shows names and emails (the resolver finds imported users by `external_id`).
- Customer list and document editor show salesman names; a new quotation fills the salesperson code.
- ID dashboard shows "my row" for a designer; a new ID quotation sets the designer to the creator.
- WhatsApp operator: a linked number still acts as its user (`/whoami`, a read command).
- Field app: rider signs in, sees their in-progress runs (`mine=true`).
- Create a brand-new user: they can sign in (native production id, `external_id` stamped to itself).

## Rollback

1. Vercel: instant rollback to the previous production deployment (dev keys). The API still accepts dev-instance tokens through `CLERK_SECRET_KEY_LEGACY`.
2. Optional: on Render, put the dev key back in `CLERK_SECRET_KEY` and clear `CLERK_SECRET_KEY_LEGACY`.
3. No database rollback: ids never changed. Only users **created on the production instance during the window** lose access; recreate them on the dev instance.

## After a few stable days

- Remove `CLERK_SECRET_KEY_LEGACY` from Render.
- Optional: remove the unused `@clerk/clerk-sdk-node` dependency from `api-server-production/package.json`.
- Update the docs that say "one Clerk instance shared by dev, staging and prod" (`CIEL_HANDBOOK.md`, `HANDOFF.md`, `docs-site/backend/auth.mdx`): prod now has its own instance; ids still match because of `external_id`.
