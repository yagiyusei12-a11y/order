import { useEffect, useState } from "react";
import { apiFetch, apiFetchBlob } from "../api";
import { Card, Err } from "../ui";

type CatDoc = { kind: string; label: string; dataSources: string };

type MissingField = { key: string; labelJa: string };

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Documents(): JSX.Element {
  const [catalog, setCatalog] = useState<CatDoc[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [businessDate, setBusinessDate] = useState(todayYmd);
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<{ id: string; familyName: string; givenName: string; status: string }[]>(
    [],
  );
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [dataPreview, setDataPreview] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingField[] | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ documents: CatDoc[] }>("/documents/legal-catalog");
      if (r.ok) setCatalog(r.data.documents);
      else setErr(r.error);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ employees: { id: string; familyName: string; givenName: string; status: string }[] }>(
        "/employees?status=active",
      );
      if (r.ok) setEmployees(r.data.employees);
    })();
  }, []);

  function previewBody(kind: string): Record<string, unknown> {
    const body: Record<string, unknown> = { kind, periodYm: ym };
    if (kind === "joroku_kensyu") body.businessDate = businessDate;
    if (kind === "seiyaku_jukyu") body.employeeId = employeeId || undefined;
    return body;
  }

  async function previewAuto(kind: string): Promise<void> {
    setErr(null);
    setActiveKind(kind);
    const r = await apiFetch<{
      html: string;
      data?: Record<string, string>;
      missingRequired?: MissingField[];
    }>("/documents/preview-auto", {
      method: "POST",
      json: previewBody(kind),
    });
    if (!r.ok) setErr(r.error);
    else {
      setHtml(r.data.html);
      setDataPreview(r.data.data ? JSON.stringify(r.data.data, null, 2) : null);
      setMissing(r.data.missingRequired ?? []);
    }
  }

  async function pdfAuto(kind: string): Promise<void> {
    setErr(null);
    const r = await apiFetchBlob("/documents/render-pdf-auto", {
      method: "POST",
      json: previewBody(kind),
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
          テナント設定の法定プロフィール列・<code>documentForms</code> と業務データ（苦情/指導/日報等）から自動埋めします。印刷はプレビュー表示後にブラウザの印刷を利用してください。
        </p>
        <label>表示・集計用の月（YYYY-MM）</label>
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
        <label style={{ display: "block", marginTop: "0.5rem" }}>乗務記録・酒気確認用 運行日（YYYY-MM-DD）</label>
        <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        <label style={{ display: "block", marginTop: "0.5rem" }}>誓約書用 従事者</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={{ minWidth: 220 }}>
          <option value="">（未選択）</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.familyName} {e.givenName}
            </option>
          ))}
        </select>
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
          {missing && missing.length > 0 ? (
            <div
              style={{
                marginBottom: "0.5rem",
                padding: "0.5rem 0.65rem",
                background: "#fff8e6",
                border: "1px solid #e6c200",
                fontSize: "0.85rem",
              }}
            >
              <strong>未入力の必須項目</strong>
              <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.2rem" }}>
                {missing.map((m) => (
                  <li key={m.key}>
                    {m.labelJa} <code style={{ fontSize: "0.75rem" }}>{m.key}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
