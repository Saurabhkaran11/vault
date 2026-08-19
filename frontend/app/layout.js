import "./globals.css";

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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
