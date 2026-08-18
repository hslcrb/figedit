import { useState } from "react";
import { CodeExporter, downloadCodePackage } from "../domain/CodeExporter";
import { downloadText } from "../domain/DesignExporter";
import { useEditorStore } from "../store/editor";

type CodeTab = "HTML" | "REACT" | "CSS" | "MANIFEST";

export function CodeHandoffView() {
  const [tab, setTab] = useState<CodeTab>("REACT");
  const doc = useEditorStore((state) => state.doc);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const extraFiles = useEditorStore((state) => state.extraFiles);
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage);
  if (!doc) return null;
  const rootId = selectedIds.length === 1 ? selectedIds[0] : activePageId;
  const exporter = new CodeExporter(doc, rootId, extraFiles);
  const report = exporter.report();
  const source = tab === "HTML" ? exporter.html() : tab === "CSS" ? exporter.css() : tab === "MANIFEST" ? JSON.stringify(report, null, 2) : exporter.react();
  const blockerCount = report.issues.filter((issue) => issue.severity === "BLOCKER").length;
  const warningCount = report.issues.filter((issue) => issue.severity === "WARNING").length;

  return (
    <section className="code-handoff-view">
      <header className="code-handoff-header">
        <div><span className="eyebrow">LABELSTUDIO / HANDOFF</span><h1>그 모든 것을, 코드로 이어갑니다.</h1><p>디자인 의도·반응형 규칙·토큰·접근성 계약을 한 패키지로 확인하세요.</p></div>
        <div className="handoff-actions"><button className="btn btn-primary" onClick={() => { downloadCodePackage(exporter.package(), `${doc.name || "labelstudio"}-handoff.zip`); setStatusMessage("개발자 핸드오프 ZIP 내보냄"); }}>ZIP 내보내기</button><button className="btn btn-quiet" onClick={() => { downloadText(JSON.stringify(report, null, 2), `${doc.name || "labelstudio"}-handoff.json`, "application/json"); setStatusMessage("핸드오프 리포트 내보냄"); }}>리포트 저장</button></div>
      </header>
      <div className="handoff-metrics"><div><strong>{report.nodeCount}</strong><span>nodes</span></div><div className={blockerCount ? "has-issues" : ""}><strong>{blockerCount}</strong><span>blockers</span></div><div className={warningCount ? "has-issues" : ""}><strong>{warningCount}</strong><span>warnings</span></div><div><strong>{doc.labelTokens?.length ?? 0}</strong><span>tokens</span></div></div>
      <div className="code-handoff-workspace">
        <div className="code-source-panel">
          <nav className="code-tabs" aria-label="코드 포맷">
            {(["HTML", "REACT", "CSS", "MANIFEST"] as CodeTab[]).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item}</button>)}
          </nav>
          <pre className="code-source"><code>{source}</code></pre>
        </div>
        <aside className="readiness-panel">
          <div className="section-heading"><span className="section-title">READINESS</span><span className="section-note">before shipping</span></div>
          {report.issues.length === 0 && <div className="readiness-clear"><span>✓</span><strong>준비 완료</strong><small>코드 패키지를 바로 전달할 수 있습니다.</small></div>}
          <div className="readiness-list">{report.issues.map((issue, index) => <div className={`readiness-item severity-${issue.severity.toLowerCase()}`} key={`${issue.nodeId}-${issue.title}-${index}`}><span>{issue.severity}</span><strong>{issue.title}</strong><small>{issue.detail}</small></div>)}</div>
        </aside>
      </div>
    </section>
  );
}
