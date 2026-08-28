import LegalPage from "@/components/LegalPage";

export const metadata = {
  title: "Privacy Policy — Vault",
  description: "How Vault handles your data: local-first by design, optional sync, and strict limits on Google data use.",
};

/* Written to match how Vault actually works — local-first, optional sync —
 * rather than boilerplate. The "Google user data" section follows the
 * disclosure structure Google's OAuth verification expects (Limited Use). */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="26 August 2026">
      <h2>The short version</h2>
      <p>
        Vault is local-first: your notes, tasks, finances and files live in
        <b> your browser</b> by default. Nothing leaves your device unless you
        turn something on — an account, backend sync, file storage, an AI
        model, or a Google connection. We don&rsquo;t run ads, we don&rsquo;t sell data,
        and we collect nothing we don&rsquo;t need to run the product.
      </p>

      <h2>What we store, and where</h2>
      <ul>
        <li><b>By default (no account):</b> everything is stored in your browser&rsquo;s
          local storage on your device. We cannot see it. Clearing your browser
          data deletes it, which is why the app offers backups.</li>
        <li><b>If you sign in and enable Backend sync:</b> your items, tasks,
          boards, finance entries and tags are mirrored to our database
          (hosted on Neon/PostgreSQL via Render) so they survive your browser
          and follow you across devices. Search indexes (embeddings) of your
          content are stored alongside them to power &ldquo;Ask your Vault&rdquo;.</li>
        <li><b>If you upload files:</b> the file bytes are stored in our storage
          bucket (AWS S3). Uploads and downloads use short-lived signed URLs
          scoped to your account, and each account has a storage limit.</li>
        <li><b>Account details:</b> sign-in is handled by Clerk. We receive your
          user ID and email address — no passwords ever touch our servers.</li>
      </ul>

      <h2>AI features</h2>
      <p>
        When you use an AI feature (Ask your Vault, summaries, smart add,
        statement parsing), the relevant text is sent to the configured model
        provider to generate the answer — either <b>your own</b> model/key
        (including a local model, in which case nothing leaves your machine)
        or our server-configured provider (NVIDIA-hosted open models). Prompts
        are processed to produce your answer and are not used by us to train
        models. We never send your data to an AI provider in the background —
        only when you invoke an AI action.
      </p>

      <h2>Google user data</h2>
      <p>
        If you connect Google, we request these scopes, each for one visible
        feature — and nothing else:
      </p>
      <ul>
        <li><b>Calendar events</b> (<span className="mono">calendar.events</span>):
          to show your upcoming events inside Vault and, if you enable it, to
          create or update the events that mirror your Vault tasks.</li>
        <li><b>Drive, read-only</b> (<span className="mono">drive.readonly</span>):
          to list your files and import the ones you pick into Vault.</li>
        <li><b>Docs</b> (<span className="mono">documents</span>): to update a
          Google Doc when you edit its imported copy in Vault and press
          &ldquo;Update Google Doc&rdquo;.</li>
      </ul>
      <p>
        Vault&rsquo;s use and transfer of information received from Google APIs
        adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>, including the <b>Limited Use</b> requirements. In plain words:
        Google data is used only to provide the features above; it is never
        used for advertising, never sold, never used to train AI models, and
        no human reads it except with your explicit consent, for security, or
        where the law requires. OAuth tokens are stored encrypted, and
        disconnecting Google (or deleting your account) removes them.
      </p>

      <h2>What we don&rsquo;t do</h2>
      <ul>
        <li>No advertising, no ad trackers, no selling or renting data — ever.</li>
        <li>No third-party analytics scripts on your vault&rsquo;s content.</li>
        <li>No reading your content, except automated processing you invoke
          (search indexing, AI answers) or debugging with your explicit consent.</li>
      </ul>
      <p>
        One operational exception: when error reporting is enabled, crashes
        send a technical report (the error, stack trace, and browser details —
        never your notes, files, or finance records) to Sentry so we can fix
        what broke. That&rsquo;s diagnostics, not analytics.
      </p>

      <h2>Cookies</h2>
      <p>
        The only cookies come from Clerk, our sign-in provider, to keep you
        signed in. There are no advertising or cross-site tracking cookies.
      </p>

      <h2>Your rights: export and delete</h2>
      <p>
        Settings → Account lets you <b>export everything</b> we hold about you
        as a single JSON file, and <b>delete your account</b> — which erases
        your synced data, search indexes, uploaded files and Google tokens
        from our systems. Data in your own browser is always yours to keep or
        clear locally. If anything fails, email us and we&rsquo;ll do it by hand.
      </p>

      <h2>Retention &amp; security</h2>
      <p>
        Synced data is kept while your account exists and deleted when you
        delete it. Backups of our database age out on a rolling schedule.
        Traffic is encrypted in transit (HTTPS); stored Google tokens are
        encrypted at rest; access to production systems is limited to the
        operator.
      </p>

      <h2>Children</h2>
      <p>Vault is not directed at children under 13, and we don&rsquo;t knowingly
        collect their data.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes materially, the date above changes and the
        in-app link will point at the new version. Continued use after a
        change means the new version applies.
      </p>
    </LegalPage>
  );
}
