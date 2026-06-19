import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const singleWorkspace =
  process.env.SINGLE_WORKSPACE === "true" || !process.env.CLERK_SECRET_KEY;

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health", // deploy smoke test hits this unauthenticated to verify DB
  "/api/cron(.*)",
  "/api/webhooks(.*)",
  // Inbound Slack (slash command + events) is server-to-server with no Clerk
  // session; it authenticates itself via Slack request-signature verification.
  "/api/slack(.*)",
  "/api/v1/connectors",
  "/api/v1/library(.*)",
]);

// SINGLE_WORKSPACE mode only checks cookie presence here; the signature is
// verified server-side in getSession() (proxy runs on the edge runtime).
function singleWorkspaceProxy(request: NextRequest) {
  if (isPublicRoute(request)) return NextResponse.next();
  if (!request.cookies.get("calyflow_session")) {
    const signIn = new URL("/sign-in", request.url);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export default singleWorkspace
  ? singleWorkspaceProxy
  : clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) await auth.protect();
    });

export const config = {
  matcher: [
    // Skip Next internals and static files
    "/((?!_next|.*\\.(?:ico|png|svg|jpg|jpeg|woff2?|css|js|map)$).*)",
    "/(api|trpc)(.*)",
  ],
};
