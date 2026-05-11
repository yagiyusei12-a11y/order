import { useEffect, useState } from "react";
import { apiFetch, apiFetchBlob } from "../api";
import { Card, Err } from "../ui";

type CatDoc = { kind: string; label: string; dataSources: string };

export default function Documents(): JSX.Element {
  const [catalog, setCatalog] = useState<CatDoc[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [dataPreview, setDataPreview] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ documents: CatDoc[] }>("/documents/legal-catalog");
      if (r.ok) setCatalog(r.data.documents);
      else setErr(r.error);
    })();
  }, []);

  async function previewAuto(kind: string): Promise<void> {
    setErr(null);
    setActiveKind(kind);
    const r = await apiFetch<{ html: string; data?: Record<string, string> }>("/documents/preview-auto", {
      method: "POST",
      json: { kind, periodYm: ym },
    });
    if (!r.ok) setErr(r.error);
    else {
      setHtml(r.data.html);
      setDataPreview(r.data.data ? JSON.stringify(r.data.data, null, 2) : null);
    }
  }

  async function pdfAuto(kind: string): Promise<void> {
    setErr(null);
    const r = await apiFetchBlob("/documents/render-pdf-auto", {
      method: "POST",
      json: { kind, periodYm: ym },
    });
    if (!r.ok) {
      setErr(
        r.status === 403
          ? `${r.error}（プランで PDF 無効のときはブラウザ印刷を利用してください）`
          : r.error,
      );
      return;
    }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.filename || `${kind}-auto.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Card title="法定・届出系帳票（9 種）">
        <Err msg={err} />
        <p style={{ fontSize: "0.85rem", marginTop: 0 }}>
          テナント設定の <code>customJson.dispatchProfile</code> と業務データから自動埋めします。印刷はプレビュー表示後にブラウザの印刷を利用してください。
        </p>
        <label>集計・表示用の月（YYYY-MM）</label>
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
      </Card>
      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.5rem" }}>
        {catalog.map((d) => (
          <Card key={d.kind} title={d.label}>
            <p style={{ fontSize: "0.75rem", margin: "0 0 0.5rem", color: "#444" }}>
              <code>{d.kind}</code>
            </p>
            <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>{d.dataSources}</p>
            <button type="button" onClick={() => void previewAuto(d.kind)}>
              プレビュー（自動埋め）
            </button>{" "}
            <button type="button" onClick={() => void pdfAuto(d.kind)}>
              PDF（自動埋め）
            </button>
          </Card>
        ))}
      </div>
      {html ? (
        <Card title={activeKind ? `プレビュー: ${activeKind}` : "プレビュー"}>
          {dataPreview ? (
            <details style={{ marginBottom: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>埋め込みデータ（JSON）</summary>
              <pre style={{ fontSize: "0.7rem", overflow: "auto", maxHeight: 160 }}>{dataPreview}</pre>
            </details>
          ) : null}
          <iframe
            title="doc-preview"
            srcDoc={html}
            style={{ width: "100%", height: 520, border: "1px solid #ccc" }}
          />
        </Card>
      ) : null}
    </>
  );
}
