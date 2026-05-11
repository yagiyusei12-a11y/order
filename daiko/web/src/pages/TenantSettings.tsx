import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Row = {
  tenantId: string;
  businessDayRollHour: number;
  featureFlags: Record<string, unknown>;
  customJson: Record<string, unknown>;
};

export default function TenantSettings(): JSX.Element {
  const [row, setRow] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hour, setHour] = useState("4");
  const [flagsText, setFlagsText] = useState("{}");
  const [customText, setCustomText] = useState("{}");

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<Row>("/tenant-settings");
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setRow(r.data);
      setHour(String(r.data.businessDayRollHour));
      setFlagsText(JSON.stringify(r.data.featureFlags ?? {}, null, 2));
      setCustomText(JSON.stringify(r.data.customJson ?? {}, null, 2));
    })();
  }, []);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    let featureFlags: Record<string, unknown>;
    let customJson: Record<string, unknown>;
    try {
      featureFlags = JSON.parse(flagsText) as Record<string, unknown>;
      customJson = JSON.parse(customText) as Record<string, unknown>;
    } catch {
      setErr("JSON の形式が不正です");
      return;
    }
    const r = await apiFetch<Row>("/tenant-settings", {
      method: "PATCH",
      json: {
        businessDayRollHour: Number(hour),
        featureFlags,
        customJson,
      },
    });
    if (!r.ok) setErr(r.error);
    else {
      setRow(r.data);
      setFlagsText(JSON.stringify(r.data.featureFlags ?? {}, null, 2));
      setCustomText(JSON.stringify(r.data.customJson ?? {}, null, 2));
    }
  }

  if (!row && !err) return <p>読み込み中…</p>;

  return (
    <Card title="テナント設定">
      <Err msg={err} />
      {row ? (
        <form onSubmit={(e) => void save(e)}>
          <label>事業日切替時刻（0–23 時）</label>
          <input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(e.target.value)} />
          <label>featureFlags（JSON）</label>
          <textarea rows={8} value={flagsText} onChange={(e) => setFlagsText(e.target.value)} style={{ width: "100%" }} />
          <label>customJson（JSON）</label>
          <textarea rows={8} value={customText} onChange={(e) => setCustomText(e.target.value)} style={{ width: "100%" }} />
          <button type="submit">保存</button>
        </form>
      ) : null}
    </Card>
  );
}
