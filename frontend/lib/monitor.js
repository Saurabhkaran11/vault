"use client";

/* Error reporting seam. Without NEXT_PUBLIC_SENTRY_DSN this is console-only —
 * zero network, zero bundle weight (Sentry loads via dynamic import, so its
 * chunk is never fetched unless a DSN is configured). With a DSN set, render
 * crashes and unhandled rejections land in Sentry with release context. */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

let sentryReady = null;   // Promise<module|null>, initialised once on demand

function getSentry() {
  if (!DSN) return Promise.resolve(null);
  if (!sentryReady) {
    sentryReady = import("@sentry/browser")
      .then((S) => {
        S.init({
          dsn: DSN,
          environment: process.env.NODE_ENV,
          /* privacy: never send user data payloads; errors only */
          sendDefaultPii: false,
          beforeSend(event) {
            /* strip anything that looks like vault content from breadcrumbs */
            if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.filter((b) => b.category !== "console");
            return event;
          },
        });
        return S;
      })
      .catch(() => null);
  }
  return sentryReady;
}

/** Report an error. Safe to call anywhere, never throws. */
export function reportError(error, context = {}) {
  try {
    console.error("[vault]", error, context);
    getSentry().then((S) => {
      if (S) S.captureException(error, { extra: context });
    });
  } catch { /* reporting must never break the app */ }
}

let installed = false;
/** Catch what React boundaries can't: async errors + unhandled rejections. */
export function installGlobalHandlers() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    /* resource-load errors have no .error; skip those */
    if (e.error) reportError(e.error, { via: "window.onerror" });
  });
  window.addEventListener("unhandledrejection", (e) => {
    reportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), { via: "unhandledrejection" });
  });
}
