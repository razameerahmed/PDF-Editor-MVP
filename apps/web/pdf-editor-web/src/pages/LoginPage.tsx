export function LoginPage() {
  return (
    <main className="screen centered">
      <section className="panel auth-panel">
        <div className="hero-card">
          <span className="eyebrow">Modern PDF workspace</span>
          <h1 className="hero-title">
            Clean PDF tools,
            <span> zero noise</span>
          </h1>
          <p className="hero-copy-text">
            A softer, minimal UI for versioned PDF work. Upload, annotate,
            compress, and manage document operations from one polished surface.
          </p>
          <div className="hero-points">
            <div className="hero-point"><span className="dot" />Local document storage</div>
            <div className="hero-point"><span className="dot" />JWT auth and seeded access</div>
            <div className="hero-point"><span className="dot" />Job and version awareness</div>
          </div>
        </div>
        <div className="panel login-card">
          <span className="eyebrow">Sign in</span>
          <h2 className="section-heading"><span className="accent-text">Owner</span> access</h2>
          <form className="stack">
            <input placeholder="Email address" defaultValue="owner@pdfeditor.local" />
            <input placeholder="Password" type="password" defaultValue="Password123!" />
            <button type="submit">Enter workspace</button>
          </form>
          <p className="muted-text">Seeded users: owner, editor, viewer.</p>
        </div>
      </section>
    </main>
  );
}
