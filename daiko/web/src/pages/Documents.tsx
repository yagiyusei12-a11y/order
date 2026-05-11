import { useEffect, useState } from "react";
import { apiFetch, apiFetchBlob } from "../api";
import { Card, Err } from "../ui";

type Tpl = { id: string; kind: string; version: number; label: string };

export default function Documents(): JSX.Element {
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [version, setVersion] = useState("1");
  const [dataJson, setDataJson] = useState('{"employeeName":"山田太郎","businessDate":"2026-05-01","phase":"出勤前"}');
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ templates: Tpl[] }>("/document-templates");
      if (r.ok) {
        setTemplates(r.data.templates);
        if (r.data.templates[0]) setKind(r.data.templates[0].kind);
      } else setErr(r.error);
    })();
  }, []);

  async function preview(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    let data: Record<string, string>;
    try {
      data = JSON.parse(dataJson) as Record<string, string>;
    } catch {
      setErr("データ JSON が不正です");
      return;
    }
    const r = await apiFetch<{ html: string }>("/documents/preview", {
      method: "POST",
      json: { kind, version: Number(version), data },
    });
    if (!r.ok) setErr(r.error);
    else setHtml(r.data.html);
  }

  async function pdf(): Promise<void> {
    setErr(null);
    let data: Record<string, string>;
    try {
      data = JSON.parse(dataJson) as Record<string, string>;
    } catch {
      setErr("データ JSON が不正です");
      return;
    }
    const r = await apiFetchBlob("/documents/render-pdf", {
      method: "POST",
      json: { kind, version: Number(version), data },
    });
    if (!r.ok) {
      setErr(
        r.status === 403
          ? `${r.error}（プランで PDF 無効、または権限がありません）`
          : r.error,
      );
      return;
    }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.filename || `${kind}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Card title="帳票テンプレート">
        <Err msg={err} />
        <ul style={{ margin: "0.25rem 0", paddingLeft: "1.1rem" }}>
          {templates.map((t) => (
            <li key={t.id}>
              {t.label} — <code>{t.kind}</code> v{t.version}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="プレビュー / PDF">
        <form onSubmit={(e) => void preview(e)}>
          <label>kind</label>
          <input value={kind} onChange={(e) => setKind(e.target.value)} required />
          <label>version</label>
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
          <label>データ（JSON オブジェクト、値は文字列）</label>
          <textarea rows={4} value={dataJson} onChange={(e) => setDataJson(e.target.value)} style={{ width: "100%" }} />
          <button type="submit">HTML プレビュー</button>
          <button type="button" onClick={() => void pdf()}>
            PDF ダウンロード
          </button>
        </form>
        {html ? (
          <iframe title="preview" srcDoc={html} style={{ width: "100%", height: 360, marginTop: "0.75rem", border: "1px solid #ccc" }} />
        ) : null}
      </Card>
    </>
  );
}
