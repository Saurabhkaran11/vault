import "./globals.css";
import { authEnabled } from "@/lib/authConfig";
import AuthGate from "@/components/AuthGate";

export const metadata = {
  title: "Vault — everything, one place",
  description:
    "A personal knowledge hub — notes, YouTube videos, PDFs/books and documents in one place, with date stamps, project tags, a graph view and a dashboard.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Vault", statusBarStyle: "default" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0F2237",
};

/* Clerk is imported lazily and only mounted when a publishable key exists.
 * Vault is local-first: with no key the app runs exactly as it always has,
 * signed into nothing, storing everything in this browser. Importing
 * ClerkProvider unconditionally would make the whole app depend on an
 * account existing, which is the opposite of that promise. */
export default async function RootLayout({ children }) {
  if (!authEnabled()) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  const { ClerkProvider } = await import("@clerk/nextjs");
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <AuthGate>{children}</AuthGate>
        </body>
      </html>
    </ClerkProvider>
  );
}
