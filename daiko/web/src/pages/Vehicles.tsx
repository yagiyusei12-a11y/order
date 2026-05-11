import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type V = {
  id: string;
  label: string;
  plate: string | null;
  active: boolean;
  legalCoverageStartOn: string | null;
};

function toYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function Vehicles(): JSX.Element {
  const [rows, setRows] = useState<V[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [newLegalStart, setNewLegalStart] = useState("");

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
    const json: Record<string, unknown> = { label };
    if (newPlate.trim()) json.plate = newPlate.trim();
    if (newLegalStart.trim()) json.legalCoverageStartOn = `${newLegalStart.trim()}T00:00:00.000Z`;
    const r = await apiFetch<V>("/vehicles", { method: "POST", json });
    if (!r.ok) setErr(r.error);
    else {
      setLabel("");
      setNewPlate("");
      setNewLegalStart("");
      await load();
    }
  }

  async function toggleActive(v: V): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/vehicles/${v.id}`, { method: "PATCH", json: { active: !v.active } });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  async function saveVehicle(v: V, plate: string, legalYmd: string): Promise<void> {
    setErr(null);
    const json: Record<string, unknown> = {
      plate: plate.trim() || null,
      legalCoverageStartOn: legalYmd.trim() ? `${legalYmd.trim()}T00:00:00.000Z` : null,
    };
    const r = await apiFetch(`/vehicles/${v.id}`, { method: "PATCH", json });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="車両">
      <Err msg={err} />
      <form onSubmit={(e) => void add(e)}>
        <label>表示名</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} required />
        <label>ナンバー（任意）</label>
        <input value={newPlate} onChange={(e) => setNewPlate(e.target.value)} />
        <label>補償開始日 legalCoverageStartOn（任意・YYYY-MM-DD）</label>
        <input type="date" value={newLegalStart} onChange={(e) => setNewLegalStart(e.target.value)} />
        <button type="submit">追加</button>
      </form>
      <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
        <table style={{ fontSize: "0.88rem", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: 6, textAlign: "left" }}>名称</th>
              <th style={{ border: "1px solid #ccc", padding: 6, textAlign: "left" }}>ナンバー</th>
              <th style={{ border: "1px solid #ccc", padding: 6 }}>補償開始日</th>
              <th style={{ border: "1px solid #ccc", padding: 6 }}>有効</th>
              <th style={{ border: "1px solid #ccc", padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <VehicleRow key={x.id} v={x} onSave={saveVehicle} onToggle={() => void toggleActive(x)} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VehicleRow({
  v,
  onSave,
  onToggle,
}: {
  v: V;
  onSave: (v: V, plate: string, legalYmd: string) => void;
  onToggle: () => void;
}): JSX.Element {
  const [plate, setPlate] = useState(v.plate ?? "");
  const [legalYmd, setLegalYmd] = useState(toYmd(v.legalCoverageStartOn));

  useEffect(() => {
    setPlate(v.plate ?? "");
    setLegalYmd(toYmd(v.legalCoverageStartOn));
  }, [v.id, v.plate, v.legalCoverageStartOn]);

  return (
    <tr>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>{v.label}</td>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>
        <input value={plate} onChange={(e) => setPlate(e.target.value)} style={{ width: 120 }} />
      </td>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>
        <input type="date" value={legalYmd} onChange={(e) => setLegalYmd(e.target.value)} />
      </td>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>{v.active ? "はい" : "いいえ"}</td>
      <td style={{ border: "1px solid #ccc", padding: 6, whiteSpace: "nowrap" }}>
        <button type="button" onClick={() => onSave(v, plate, legalYmd)}>
          保存
        </button>{" "}
        <button type="button" onClick={onToggle}>
          有効切替
        </button>
      </td>
    </tr>
  );
}
