import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Seg = { id: string; fromM: number; toM: number; fareYen: number };
type Ver = {
  id: string;
  version: number;
  initialDistanceM: number;
  initialFareYen: number;
  addUnitDistanceM: number;
  addFareYen: number;
  waitingFareYenPerMin: number;
  segments: Seg[];
};
type Plan = { id: string; name: string; versions: Ver[] };

export default function Tariffs(): JSX.Element {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selVer, setSelVer] = useState<string | null>(null);
  const [fromM, setFromM] = useState("");
  const [toM, setToM] = useState("");
  const [fareYen, setFareYen] = useState("");

  async function load(): Promise<void> {
    const r = await apiFetch<{ plans: Plan[] }>("/tariff-plans");
    if (r.ok) {
      setPlans(r.data.plans);
      if (!selVer && r.data.plans[0]?.versions[0]) setSelVer(r.data.plans[0].versions[0].id);
    } else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addPlan(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const r = await apiFetch<{ plan: Plan; version: Ver }>("/tariff-plans", { method: "POST", json: { name } });
    if (!r.ok) setErr(r.error);
    else {
      setName("");
      await load();
      setSelVer(r.data.version.id);
    }
  }

  async function addVersion(planId: string): Promise<void> {
    setErr(null);
    const r = await apiFetch<Ver>(`/tariff-plans/${planId}/versions`, { method: "POST", json: {} });
    if (!r.ok) setErr(r.error);
    else {
      setSelVer(r.data.id);
      await load();
    }
  }

  async function addSegment(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!selVer) return;
    setErr(null);
    const r = await apiFetch<Seg>(`/tariff-versions/${selVer}/segments`, {
      method: "POST",
      json: { fromM: Number(fromM), toM: Number(toM), fareYen: Number(fareYen) },
    });
    if (!r.ok) setErr(r.error);
    else {
      setFromM("");
      setToM("");
      setFareYen("");
      await load();
    }
  }

  async function delSegment(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/tariff-segments/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="料金プラン">
      <Err msg={err} />
      <form onSubmit={(e) => void addPlan(e)}>
        <label>新規プラン名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">プラン作成（初版付き）</button>
      </form>
      {plans.map((p) => (
        <div key={p.id} style={{ marginTop: "1rem" }}>
          <strong>{p.name}</strong>{" "}
          <button type="button" onClick={() => void addVersion(p.id)}>
            新版追加
          </button>
          <ul>
            {p.versions.map((v) => (
              <li key={v.id}>
                <label>
                  <input
                    type="radio"
                    name="ver"
                    checked={selVer === v.id}
                    onChange={() => setSelVer(v.id)}
                  />{" "}
                  v{v.version} 初乗り{v.initialDistanceM}m/{v.initialFareYen}円 加算{v.addUnitDistanceM}m/
                  {v.addFareYen}円 待機{v.waitingFareYenPerMin}円/分
                </label>
                <ul>
                  {v.segments.map((s) => (
                    <li key={s.id}>
                      {s.fromM}–{s.toM}m → {s.fareYen}円{" "}
                      <button type="button" onClick={() => void delSegment(s.id)}>
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form onSubmit={(e) => void addSegment(e)} style={{ marginTop: "0.75rem" }}>
        <p style={{ fontSize: "0.85rem", margin: 0 }}>選択中の版に距離帯セグメントを追加</p>
        <label>fromM (m)</label>
        <input value={fromM} onChange={(e) => setFromM(e.target.value)} />
        <label>toM (m)</label>
        <input value={toM} onChange={(e) => setToM(e.target.value)} />
        <label>fareYen</label>
        <input value={fareYen} onChange={(e) => setFareYen(e.target.value)} />
        <button type="submit" disabled={!selVer}>
          セグメント追加
        </button>
      </form>
    </Card>
  );
}
