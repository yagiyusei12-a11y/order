import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type V = { id: string; label: string; plate: string | null; active: boolean };

export default function Vehicles(): JSX.Element {
  const [rows, setRows] = useState<V[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  async function load(): Promise<void> {
    const r = await apiFetch<{ vehicles: V[] }>("/vehicles?active=0");
    if (r.ok) setRows(r.data.vehicles);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const r = await apiFetch<V>("/vehicles", { method: "POST", json: { label } });
    if (!r.ok) setErr(r.error);
    else {
      setLabel("");
      await load();
    }
  }

  async function toggleActive(v: V): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/vehicles/${v.id}`, { method: "PATCH", json: { active: !v.active } });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="車両">
      <Err msg={err} />
      <form onSubmit={(e) => void add(e)}>
        <label>表示名</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} required />
        <button type="submit">追加</button>
      </form>
      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>名称</th>
            <th>ナンバー</th>
            <th>有効</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>{x.label}</td>
              <td>{x.plate ?? ""}</td>
              <td>{x.active ? "はい" : "いいえ"}</td>
              <td>
                <button type="button" onClick={() => void toggleActive(x)}>
                  切替
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
