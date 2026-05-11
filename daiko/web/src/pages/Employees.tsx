import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Emp = {
  id: string;
  familyName: string;
  givenName: string;
  furigana: string | null;
  status: string;
};

export default function Employees(): JSX.Element {
  const [rows, setRows] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");

  async function load(): Promise<void> {
    const r = await apiFetch<{ employees: Emp[] }>("/employees?status=all");
    if (r.ok) setRows(r.data.employees);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
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
      <table style={{ marginTop: "0.75rem" }}>
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
    </Card>
  );
}
