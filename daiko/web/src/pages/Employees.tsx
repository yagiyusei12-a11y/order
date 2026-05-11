import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { REGISTER_EXTENSION_UI_FIELDS } from "../lib/registerExtensionFields";
import { Card, Err } from "../ui";

type RegisterExt = Record<string, string>;

type Emp = {
  id: string;
  familyName: string;
  givenName: string;
  furigana: string | null;
  address: string | null;
  registerExtension: unknown;
  status: string;
};

function asExt(raw: unknown): RegisterExt {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: RegisterExt = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}

function ext(e: Emp, key: string): string {
  return asExt(e.registerExtension)[key] ?? "";
}

export default function Employees(): JSX.Element {
  const [rows, setRows] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [newFurigana, setNewFurigana] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editFamily, setEditFamily] = useState("");
  const [editGiven, setEditGiven] = useState("");
  const [editFurigana, setEditFurigana] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editExt, setEditExt] = useState<RegisterExt>({});

  async function load(): Promise<void> {
    const r = await apiFetch<{ employees: Emp[] }>("/employees?status=all");
    if (r.ok) setRows(r.data.employees);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  function openEdit(e: Emp): void {
    setEditId(e.id);
    setEditFamily(e.familyName);
    setEditGiven(e.givenName);
    setEditFurigana(e.furigana ?? "");
    setEditAddress(e.address ?? "");
    setEditExt(asExt(e.registerExtension));
  }

  function setExtField(key: string, v: string): void {
    setEditExt((prev) => ({ ...prev, [key]: v }));
  }

  async function saveEdit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!editId) return;
    setErr(null);
    const r = await apiFetch(`/employees/${editId}`, {
      method: "PATCH",
      json: {
        familyName: editFamily.trim(),
        givenName: editGiven.trim(),
        furigana: editFurigana.trim() || null,
        address: editAddress.trim() || null,
        registerExtension: editExt,
      },
    });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else {
      setEditId(null);
      await load();
    }
  }

  async function add(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setErr(null);
    const r = await apiFetch<Emp>("/employees", {
      method: "POST",
      json: {
        familyName,
        givenName,
        furigana: newFurigana.trim() || undefined,
        address: newAddress.trim() || undefined,
      },
    });
    if (!r.ok) setErr(r.error);
    else {
      setFamilyName("");
      setGivenName("");
      setNewFurigana("");
      setNewAddress("");
      await load();
    }
  }

  async function retire(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/employees/${id}`, { method: "PATCH", json: { status: "RETIRED" } });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="従業員">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        一覧の免許・電話は参照のみです。編集は各行の「名簿・基本情報」から全項目を入力してください。
      </p>
      <form onSubmit={(e) => void add(e)}>
        <label>姓</label>
        <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
        <label>名</label>
        <input value={givenName} onChange={(e) => setGivenName(e.target.value)} required />
        <label>ふりがな（任意）</label>
        <input value={newFurigana} onChange={(e) => setNewFurigana(e.target.value)} />
        <label>住所（任意）</label>
        <textarea rows={2} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} style={{ width: "100%", maxWidth: 480 }} />
        <button type="submit">追加</button>
      </form>
      <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
        <table style={{ fontSize: "0.78rem", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>氏名</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>ふりがな</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>携帯</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>免許種別</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>免許番号</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>有効期限</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>状態</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" }}>
                  {x.familyName} {x.givenName}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", maxWidth: 120 }}>{x.furigana ?? ""}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{ext(x, "phoneMobile")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{ext(x, "licenseTypes")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{ext(x, "licenseNumber")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" }}>{ext(x, "licenseExpiresOnYmd")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{x.status}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" }}>
                  <button type="button" onClick={() => openEdit(x)}>
                    名簿・基本情報
                  </button>{" "}
                  {x.status === "ACTIVE" ? (
                    <button type="button" onClick={() => void retire(x.id)}>
                      退職
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editId ? (
        <details open style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>従事者名簿用・基本情報（編集中）</summary>
          <div style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4 }}>
            <form onSubmit={(e) => void saveEdit(e)}>
              <label>姓</label>
              <input value={editFamily} onChange={(e) => setEditFamily(e.target.value)} required />
              <label>名</label>
              <input value={editGiven} onChange={(e) => setEditGiven(e.target.value)} required />
              <label>ふりがな</label>
              <input value={editFurigana} onChange={(e) => setEditFurigana(e.target.value)} />
              <label>住所</label>
              <textarea rows={2} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} style={{ width: "100%" }} />
              {REGISTER_EXTENSION_UI_FIELDS.map((f) => (
                <div key={f.key} style={{ marginTop: "0.35rem" }}>
                  <label>{f.label}</label>
                  {f.key === "educationNotes" || f.key === "rosterNotes" || f.key === "licenseConditionsNote" ? (
                    <textarea
                      rows={2}
                      value={editExt[f.key] ?? ""}
                      onChange={(e) => setExtField(f.key, e.target.value)}
                      style={{ width: "100%", maxWidth: 420 }}
                    />
                  ) : (
                    <input
                      value={editExt[f.key] ?? ""}
                      onChange={(e) => setExtField(f.key, e.target.value)}
                      style={{ width: "100%", maxWidth: 420 }}
                    />
                  )}
                </div>
              ))}
              <div style={{ marginTop: "0.75rem" }}>
                <button type="submit">保存</button>{" "}
                <button type="button" onClick={() => setEditId(null)}>
                  閉じる
                </button>
              </div>
            </form>
          </div>
        </details>
      ) : null}
    </Card>
  );
}
