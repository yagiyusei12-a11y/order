import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Check = {
  id: string;
  businessDate: string;
  phase: string;
  checkedAt: string;
  detectorUsed: boolean;
  resultPositive: boolean;
  employee: Emp;
};

export default function Alcohol(): JSX.Element {
  const [checks, setChecks] = useState<Check[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phase, setPhase] = useState("出勤前");

  async function load(): Promise<void> {
    const qs = businessDate ? `?businessDate=${encodeURIComponent(businessDate)}` : "";
    const r = await apiFetch<{ checks: Check[] }>(`/alcohol-checks${qs}`);
    if (r.ok) setChecks(r.data.checks);
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

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const r = await apiFetch<Check>("/alcohol-checks", {
      method: "POST",
      json: { employeeId, phase, detectorUsed: true, resultPositive: false },
    });
    if (!r.ok) setErr(r.error);
    else await load();
  }

  return (
    <Card title="酒気確認">
      <Err msg={err} />
      <label>事業日で絞り込み（任意）</label>
      <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
      <button type="button" onClick={() => setBusinessDate("")}>
        クリア
      </button>
      <form onSubmit={(e) => void add(e)} style={{ marginTop: "0.75rem" }}>
        <label>従業員</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
          {emps.map((x) => (
            <option key={x.id} value={x.id}>
              {x.familyName} {x.givenName}
            </option>
          ))}
        </select>
        <label>段階（例: 出勤前 / 中間 / 帰庫前）</label>
        <input value={phase} onChange={(e) => setPhase(e.target.value)} required />
        <button type="submit">記録</button>
      </form>
      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>日付</th>
            <th>氏名</th>
            <th>段階</th>
            <th>検知器</th>
            <th>陽性</th>
            <th>日時</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id}>
              <td>{c.businessDate}</td>
              <td>
                {c.employee.familyName} {c.employee.givenName}
              </td>
              <td>{c.phase}</td>
              <td>{c.detectorUsed ? "はい" : "いいえ"}</td>
              <td>{c.resultPositive ? "はい" : "いいえ"}</td>
              <td>{new Date(c.checkedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
