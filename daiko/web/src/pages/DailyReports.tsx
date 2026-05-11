import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Veh = { id: string; label: string };
type Trip = {
  id: string;
  clientName: string;
  fareYen: number;
  distanceM: number;
  waitingMinutes: number;
};
type DR = {
  id: string;
  businessDate: string;
  meterStart: number;
  meterEnd: number;
  vehicleId: string;
  mainEmployeeId: string;
  trips: Trip[];
};

export default function DailyReports(): JSX.Element {
  const [rows, setRows] = useState<DR[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [vehs, setVehs] = useState<Veh[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [mainEmployeeId, setMainEmployeeId] = useState("");
  const [meterStart, setMeterStart] = useState("");
  const [meterEnd, setMeterEnd] = useState("");

  async function load(): Promise<void> {
    const [r1, r2, r3] = await Promise.all([
      apiFetch<{ dailyReports: DR[] }>("/daily-reports"),
      apiFetch<{ employees: Emp[] }>("/employees"),
      apiFetch<{ vehicles: Veh[] }>("/vehicles"),
    ]);
    if (r1.ok) setRows(r1.data.dailyReports);
    else setErr(r1.error);
    if (r2.ok) setEmps(r2.data.employees);
    if (r3.ok) setVehs(r3.data.vehicles);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const r = await apiFetch<DR>("/daily-reports", {
      method: "POST",
      json: {
        vehicleId,
        mainEmployeeId,
        meterStart: Number(meterStart),
        meterEnd: Number(meterEnd),
      },
    });
    if (!r.ok) setErr(r.error);
    else await load();
  }

  return (
    <Card title="日報">
      <Err msg={err} />
      <form onSubmit={(e) => void add(e)}>
        <label>車両</label>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
          <option value="">選択</option>
          {vehs.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <label>主ドライバー</label>
        <select value={mainEmployeeId} onChange={(e) => setMainEmployeeId(e.target.value)} required>
          <option value="">選択</option>
          {emps.map((x) => (
            <option key={x.id} value={x.id}>
              {x.familyName} {x.givenName}
            </option>
          ))}
        </select>
        <label>メーター開始</label>
        <input value={meterStart} onChange={(e) => setMeterStart(e.target.value)} required />
        <label>メーター終了</label>
        <input value={meterEnd} onChange={(e) => setMeterEnd(e.target.value)} required />
        <button type="submit">日報作成</button>
      </form>
      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>日付</th>
            <th>運行</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>{x.businessDate}</td>
              <td>{x.trips.length} 件</td>
              <td>
                <Link to={`/daily-reports/${x.id}`}>詳細</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
