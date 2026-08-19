/* Clerk's request interceptor, but only when Clerk is configured.
 *
 * Named proxy.js: Next 16 deprecated the `middleware` file convention in
 * favour of `proxy`, and the old name warns on every dev boot.
 *
 * clerkMiddleware() throws without a secret key, which would break every
 * request for anyone running Vault locally with no account. So when the key
 * is absent this exports a pass-through and the app behaves exactly as it
 * did before auth existed.
 *
 * The import is dynamic for the same reason: pulling in @clerk/nextjs/server
 * at module scope would run its own key assertions at boot.
 */
import { NextResponse } from "next/server";

const hasClerk = Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

let clerkHandler = null;

export default async function proxy(request, event) {
  if (!hasClerk) return NextResponse.next();
  if (!clerkHandler) {
    const { clerkMiddleware } = await import("@clerk/nextjs/server");
    clerkHandler = clerkMiddleware();
  }
  return clerkHandler(request, event);
}

export const config = {
  matcher: [
    // Everything except Next internals and static files, plus API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
