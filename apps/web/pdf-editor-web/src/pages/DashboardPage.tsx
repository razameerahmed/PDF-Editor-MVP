export function DashboardPage() {
  return (
    <main className="screen">
      <header className="page-header toolbar">
        <div>
          <span className="eyebrow">Overview</span>
          <h1>Dashboard</h1>
          <p className="muted-text">A modern summary of your local PDF workspace.</p>
        </div>
        <button>Upload PDF</button>
      </header>
      <section className="metric-grid">
        <article className="metric-card"><strong>24</strong><span className="muted-text">Active documents</span></article>
        <article className="metric-card"><strong>6</strong><span className="muted-text">Queued jobs</span></article>
        <article className="metric-card"><strong>18</strong><span className="muted-text">Saved annotations</span></article>
      </section>
      <section className="grid">
        <article className="feature-card"><strong>Recent Documents</strong><p className="muted-text">Resume editing from your latest uploads and versions.</p></article>
        <article className="feature-card"><strong>Compression Jobs</strong><p className="muted-text">See pending, failed, and completed jobs from one panel.</p></article>
        <article className="feature-card"><strong>Audit Activity</strong><p className="muted-text">Track user actions and security-sensitive events.</p></article>
      </section>
    </main>
  );
}
