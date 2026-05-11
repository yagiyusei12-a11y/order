import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Punch = {
  id: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  employee: Emp;
};

export default function TimePunches(): JSX.Element {
  const [punches, setPunches] = useState<Punch[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [employeeId, setEmployeeId] = useState("");

  async function load(): Promise<void> {
    const qs = businessDate ? `?businessDate=${encodeURIComponent(businessDate)}` : "";
    const r = await apiFetch<{ punches: Punch[] }>(`/time-punches${qs}`);
    if (r.ok) setPunches(r.data.punches);
    else setErr(r.error);
  }

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ employees: Emp[] }>("/employees");
      if (r.ok) {
        setEmps(r.data.employees);
        if (r.data.employees[0]) setEmployeeId(r.data.employees[0].id);
      }
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [businessDate]);

  async function clockIn(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const r = await apiFetch<Punch>("/time-punches/clock-in", { method: "POST", json: { employeeId } });
    if (!r.ok) setErr(r.error);
    else await load();
  }

  async function clockOut(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch<Punch>(`/time-punches/${id}/clock-out`, { method: "POST", json: {} });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="勤怠打刻">
      <Err msg={err} />
      <label>事業日で絞り込み（任意）</label>
      <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
      <button type="button" onClick={() => setBusinessDate("")}>
        クリア
      </button>
      <form onSubmit={(e) => void clockIn(e)} style={{ marginTop: "0.75rem" }}>
        <label>従業員</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
          {emps.map((x) => (
            <option key={x.id} value={x.id}>
              {x.familyName} {x.givenName}
            </option>
          ))}
        </select>
        <button type="submit">出勤打刻</button>
      </form>
      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>日付</th>
            <th>氏名</th>
            <th>出勤</th>
            <th>退勤</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {punches.map((p) => (
            <tr key={p.id}>
              <td>{p.businessDate}</td>
              <td>
                {p.employee.familyName} {p.employee.givenName}
              </td>
              <td>{new Date(p.clockInAt).toLocaleString()}</td>
              <td>{p.clockOutAt ? new Date(p.clockOutAt).toLocaleString() : "—"}</td>
              <td>
                {!p.clockOutAt ? (
                  <button type="button" onClick={() => void clockOut(p.id)}>
                    退勤
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
