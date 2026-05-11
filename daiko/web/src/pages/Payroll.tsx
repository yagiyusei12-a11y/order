import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Line = {
  id: string;
  grossSalesYen: number;
  netPayYen: number;
  employee: { familyName: string; givenName: string };
};
type Run = {
  id: string;
  periodYm: string;
  status: string;
  poolRateBps: number;
  lines: Line[];
};

export default function Payroll(): JSX.Element {
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filterYm, setFilterYm] = useState("");
  const [previewYm, setPreviewYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [poolBps, setPoolBps] = useState("0");

  async function load(): Promise<void> {
    setErr(null);
    const qs = filterYm && /^\d{4}-\d{2}$/.test(filterYm) ? `?periodYm=${encodeURIComponent(filterYm)}` : "";
    const r = await apiFetch<{ runs: Run[] }>(`/payroll-runs${qs}`);
    if (r.ok) setRuns(r.data.runs);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, [filterYm]);

  async function preview(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const r = await apiFetch<{ run: Run }>("/payroll-runs/preview", {
      method: "POST",
      json: { periodYm: previewYm, poolRateBps: Number(poolBps || 0) },
    });
    if (!r.ok) setErr(r.error);
    else await load();
  }

  async function lock(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/payroll-runs/${id}/lock`, { method: "POST" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  async function unlock(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/payroll-runs/${id}/unlock`, { method: "POST" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <>
      <Card title="給与（月次）">
        <Err msg={err} />
        <p style={{ fontSize: "0.85rem", marginTop: 0 }}>
          プレビューでドラフト行を再計算します。ロック後はその月の日報削除などが 403 になります。
        </p>
        <label>一覧フィルタ（YYYY-MM、空なら直近）</label>
        <input
          type="month"
          value={filterYm}
          onChange={(e) => setFilterYm(e.target.value)}
          placeholder="2026-05"
        />
        <button type="button" onClick={() => void load()}>
          再読込
        </button>
      </Card>
      <Card title="プレビュー再計算">
        <form onSubmit={(e) => void preview(e)}>
          <label>対象月（YYYY-MM）</label>
          <input type="month" value={previewYm} onChange={(e) => setPreviewYm(e.target.value)} required />
          <label>プール率（bps、0–10000）</label>
          <input value={poolBps} onChange={(e) => setPoolBps(e.target.value)} />
          <button type="submit">プレビュー保存</button>
        </form>
      </Card>
      <Card title="給与ラン一覧">
        <table>
          <thead>
            <tr>
              <th>月</th>
              <th>状態</th>
              <th>行数</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((x) => (
              <tr key={x.id}>
                <td>{x.periodYm}</td>
                <td>{x.status}</td>
                <td>{x.lines?.length ?? 0}</td>
                <td>
                  <Link to={`/payroll/${x.id}`}>明細</Link>{" "}
                  {x.status !== "LOCKED" ? (
                    <button type="button" onClick={() => void lock(x.id)}>
                      ロック
                    </button>
                  ) : (
                    <button type="button" onClick={() => void unlock(x.id)}>
                      解除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
