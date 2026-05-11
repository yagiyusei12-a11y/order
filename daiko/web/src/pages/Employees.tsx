import { useEffect, useState } from "react";
import { apiFetch } from "../api";
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

const EXT_FIELDS: { key: string; label: string }[] = [
  { key: "gender", label: "性別" },
  { key: "postalCode", label: "郵便番号" },
  { key: "dateOfBirthYmd", label: "生年月日（YYYY-MM-DD）" },
  { key: "phoneHome", label: "電話（自宅）" },
  { key: "phoneMobile", label: "電話（携帯）" },
  { key: "emergencyContactName", label: "緊急連絡先 氏名" },
  { key: "emergencyPhone", label: "緊急連絡先 電話" },
  { key: "emergencyAddress", label: "緊急連絡先 住所" },
  { key: "emergencyRelation", label: "緊急連絡先 続柄" },
  { key: "hiredOnYmd", label: "採用年月日" },
  { key: "retiredOnYmd", label: "退職年月日（名簿記録）" },
  { key: "employmentType", label: "採用区分" },
  { key: "interviewerName", label: "面接担当者名" },
  { key: "jobCategory", label: "職種" },
  { key: "licenseTypes", label: "免許の種類" },
  { key: "licenseNumber", label: "免許証の番号" },
  { key: "licenseExpiresOnYmd", label: "免許有効期限" },
  { key: "licenseConditionsNote", label: "免許の条件等" },
  { key: "pledgeSignedOnYmd", label: "誓約日" },
  { key: "educationNotes", label: "教育・講習の記録" },
  { key: "rosterNotes", label: "名簿備考" },
];

export default function Employees(): JSX.Element {
  const [rows, setRows] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
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
    const r = await apiFetch<Emp>("/employees", { method: "POST", json: { familyName, givenName } });
    if (!r.ok) setErr(r.error);
    else {
      setFamilyName("");
      setGivenName("");
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
      <form onSubmit={(e) => void add(e)}>
        <label>姓</label>
        <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
        <label>名</label>
        <input value={givenName} onChange={(e) => setGivenName(e.target.value)} />
        <button type="submit">追加</button>
      </form>
      <table style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            <th>氏名</th>
            <th>状態</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>
                {x.familyName} {x.givenName}
              </td>
              <td>{x.status}</td>
              <td>
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

      {editId ? (
        <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4 }}>
          <h3 style={{ fontSize: "1rem", marginTop: 0 }}>従事者名簿用・基本情報</h3>
          <form onSubmit={(e) => void saveEdit(e)}>
            <label>姓</label>
            <input value={editFamily} onChange={(e) => setEditFamily(e.target.value)} required />
            <label>名</label>
            <input value={editGiven} onChange={(e) => setEditGiven(e.target.value)} required />
            <label>ふりがな</label>
            <input value={editFurigana} onChange={(e) => setEditFurigana(e.target.value)} />
            <label>住所</label>
            <textarea rows={2} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} style={{ width: "100%" }} />
            {EXT_FIELDS.map((f) => (
              <div key={f.key} style={{ marginTop: "0.35rem" }}>
                <label>{f.label}</label>
                <input
                  value={editExt[f.key] ?? ""}
                  onChange={(e) => setExtField(f.key, e.target.value)}
                  style={{ width: "100%", maxWidth: 420 }}
                />
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
      ) : null}
    </Card>
  );
}
