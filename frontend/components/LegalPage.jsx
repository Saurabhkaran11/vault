/* Shared frame for the public legal pages (/privacy, /terms). Server-safe:
 * no hooks, no client state — these pages must render for signed-out
 * visitors, search engines, and OAuth verification reviewers alike. */

export default function LegalPage({ title, updated, children }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #EFF3F8)", color: "var(--ink, #16283C)" }}>
      <div className="legal-wrap">
        <header className="legal-head">
          <a href="/" className="legal-brand">Vault</a>
          <nav className="legal-nav">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </header>
        <main className="legal-main">
          <h1 className="display">{title}</h1>
          <p className="legal-updated mono">Last updated · {updated}</p>
          {children}
        </main>
        <footer className="legal-foot">
          <a href="/">← Back to Vault</a>
          <span>Questions? <a href="mailto:vikingrksk11@gmail.com">vikingrksk11@gmail.com</a></span>
        </footer>
      </div>
    </div>
  );
}
