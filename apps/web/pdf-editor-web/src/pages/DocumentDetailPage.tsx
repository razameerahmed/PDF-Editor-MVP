export function DocumentDetailPage() {
  return (
    <main className="screen editor-layout">
      <aside className="panel sidebar-card">
        <span className="eyebrow">Pages</span>
        <div className="thumb-list">
          <div className="thumb-item">Page 1 thumbnail</div>
          <div className="thumb-item">Page 2 thumbnail</div>
          <div className="thumb-item">Page 3 thumbnail</div>
        </div>
      </aside>
      <section className="panel viewer-panel">
        <header className="toolbar">
          <button>Zoom</button>
          <button>Rotate</button>
          <button>Reorder</button>
          <button>Extract</button>
          <button>Split</button>
          <button>Merge</button>
          <button>Compress</button>
          <button>Annotations</button>
        </header>
        <div className="viewer-canvas">PDF.js viewer integration surface</div>
      </section>
      <aside className="panel sidebar-card">
        <span className="eyebrow">Inspector</span>
        <div className="right-panel-list">
          <div className="right-item"><strong>Version History</strong><p className="muted-text">Original upload, compressed output, and current version.</p></div>
          <div className="right-item"><strong>Job Tracking</strong><p className="muted-text">Pending, running, succeeded, and failed jobs.</p></div>
          <div className="right-item"><strong>Annotation Tools</strong><p className="muted-text">Text, highlight, shapes, and freehand actions.</p></div>
        </div>
      </aside>
    </main>
  );
}
