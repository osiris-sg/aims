import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /guest(.*) is the no-login guest delivery surface — Clerk protect() is skipped
// so a driver with only a share-link token can reach it. The page itself sends
// no auth; the backend authorises solely via the URL token (Phase 6).
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/guest(.*)"]);

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
