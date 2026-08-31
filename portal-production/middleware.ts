import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /guest(.*) is the no-login guest delivery surface — Clerk protect() is skipped
// so a driver with only a share-link token can reach it. The page itself sends
// no auth; the backend authorises solely via the URL token (Phase 6).
// /pay(.*) is the public "Click to pay" invoice page — reached from emailed
// links; the backend authorises solely via the unguessable pay token.
// /sign(.*) is the public client e-signature page for quotations (token URL).
// /schedule(.*) is the public client link to a project's live weekly schedule.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/guest(.*)", "/pay(.*)", "/sign/(.*)", "/schedule/(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const { protect } = await auth();
    await protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
  runtime: "nodejs",
};
