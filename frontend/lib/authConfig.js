/* Is a real identity provider configured?
 *
 * Everything auth-related is conditional on this. Vault has always been a
 * local-first app you can open and use immediately, and that must keep
 * working with no accounts, no keys and no network — so Clerk activates
 * only when its publishable key is actually present, and otherwise the app
 * runs exactly as it did before auth existed.
 *
 * NEXT_PUBLIC_ vars are inlined at build time, so this is a static boolean
 * in the bundle rather than a runtime lookup.
 */
export const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";

export const authEnabled = () => CLERK_PUBLISHABLE_KEY.length > 0;
