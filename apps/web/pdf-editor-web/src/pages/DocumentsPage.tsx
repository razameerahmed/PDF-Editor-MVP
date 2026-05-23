export function DocumentsPage() {
  return (
    <main className="screen">
      <header className="page-header toolbar">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Documents</h1>
          <p className="muted-text">Minimal cards and a calm table for day-to-day PDF work.</p>
        </div>
        <button>Upload PDF</button>
      </header>
      <section className="tool-grid">
        <article className="tool-card coral"><strong>Convert</strong><span>Move between common formats and PDF.</span></article>
        <article className="tool-card blue"><strong>Version</strong><span>Compare current and historical outputs.</span></article>
        <article className="tool-card pink"><strong>Annotate</strong><span>Save comments and markup cleanly.</span></article>
      </section>
      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Version</th>
              <th>Status</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Quarterly Report</td>
              <td>v3</td>
              <td>Active</td>
              <td>3.1 MB</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
