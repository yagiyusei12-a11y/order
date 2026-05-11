import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Row = {
  tenantId: string;
  businessDayRollHour: number;
  featureFlags: Record<string, unknown>;
  customJson: Record<string, unknown>;
};

function readDp(c: Record<string, unknown>): Record<string, string> {
  const p = c.dispatchProfile;
  if (!p || typeof p !== "object") return {};
  const o = p as Record<string, unknown>;
  return {
    tradeName: String(o.tradeName ?? ""),
    businessAddress: String(o.businessAddress ?? ""),
    phone: String(o.phone ?? ""),
    representativeName: String(o.representativeName ?? ""),
    registrationNumber: String(o.registrationNumber ?? ""),
    transportOfficeContact: String(o.transportOfficeContact ?? ""),
    extraNotes: String(o.extraNotes ?? ""),
  };
}

export default function TenantSettings(): JSX.Element {
  const [row, setRow] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hour, setHour] = useState("4");
  const [flagsText, setFlagsText] = useState("{}");
  const [customText, setCustomText] = useState("{}");
  const [dpTradeName, setDpTradeName] = useState("");
  const [dpAddress, setDpAddress] = useState("");
  const [dpPhone, setDpPhone] = useState("");
  const [dpRep, setDpRep] = useState("");
  const [dpReg, setDpReg] = useState("");
  const [dpTransport, setDpTransport] = useState("");
  const [dpExtra, setDpExtra] = useState("");

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
      const cj = (r.data.customJson ?? {}) as Record<string, unknown>;
      setCustomText(JSON.stringify(cj, null, 2));
      const dp = readDp(cj);
      setDpTradeName(dp.tradeName);
      setDpAddress(dp.businessAddress);
      setDpPhone(dp.phone);
      setDpRep(dp.representativeName);
      setDpReg(dp.registrationNumber);
      setDpTransport(dp.transportOfficeContact);
      setDpExtra(dp.extraNotes);
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
    const dispatchProfile: Record<string, string> = {
      tradeName: dpTradeName.trim(),
      businessAddress: dpAddress.trim(),
      phone: dpPhone.trim(),
      representativeName: dpRep.trim(),
      registrationNumber: dpReg.trim(),
      transportOfficeContact: dpTransport.trim(),
      extraNotes: dpExtra.trim(),
    };
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(dispatchProfile)) {
      if (v) cleaned[k] = v;
    }
    customJson.dispatchProfile = cleaned;

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
      const cj = (r.data.customJson ?? {}) as Record<string, unknown>;
      setCustomText(JSON.stringify(cj, null, 2));
      const dp = readDp(cj);
      setDpTradeName(dp.tradeName);
      setDpAddress(dp.businessAddress);
      setDpPhone(dp.phone);
      setDpRep(dp.representativeName);
      setDpReg(dp.registrationNumber);
      setDpTransport(dp.transportOfficeContact);
      setDpExtra(dp.extraNotes);
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
          <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>届出・帳票用プロファイル（dispatchProfile）</h3>
          <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
            帳票9種の自動埋めに使います。未入力は空欄のまま出力されます。
          </p>
          <label>商号・屋号</label>
          <input value={dpTradeName} onChange={(e) => setDpTradeName(e.target.value)} />
          <label>本店・事業所所在地</label>
          <textarea rows={2} value={dpAddress} onChange={(e) => setDpAddress(e.target.value)} style={{ width: "100%" }} />
          <label>電話番号</label>
          <input value={dpPhone} onChange={(e) => setDpPhone(e.target.value)} />
          <label>代表者氏名</label>
          <input value={dpRep} onChange={(e) => setDpRep(e.target.value)} />
          <label>届出・認定番号など</label>
          <input value={dpReg} onChange={(e) => setDpReg(e.target.value)} />
          <label>運輸支局・連絡先メモ</label>
          <textarea rows={2} value={dpTransport} onChange={(e) => setDpTransport(e.target.value)} style={{ width: "100%" }} />
          <label>その他備考（変更内容・誓約文面など）</label>
          <textarea rows={3} value={dpExtra} onChange={(e) => setDpExtra(e.target.value)} style={{ width: "100%" }} />
          <label>featureFlags（JSON）</label>
          <textarea rows={6} value={flagsText} onChange={(e) => setFlagsText(e.target.value)} style={{ width: "100%" }} />
          <label>customJson（上記以外の拡張・上書き用。保存時に dispatchProfile が合成されます）</label>
          <textarea rows={6} value={customText} onChange={(e) => setCustomText(e.target.value)} style={{ width: "100%" }} />
          <button type="submit">保存</button>
        </form>
      ) : null}
    </Card>
  );
}
