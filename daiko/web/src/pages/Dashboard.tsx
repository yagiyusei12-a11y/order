import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Dash = {
  ym: string;
  salesYen: number;
  tripLegCount: number;
  dailyReportCount: number;
  attendance: { minutesTotal: number; completedPunchCount: number };
};

export default function Dashboard(): JSX.Element {
  const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [v, setV] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<Dash>(`/dashboard?ym=${encodeURIComponent(ym)}`);
      if (r.ok) setV(r.data);
      else setErr(r.error);
    })();
  }, [ym]);

  return (
    <>
      <Card title="ダッシュボード">
        <p style={{ margin: 0, fontSize: "0.9rem" }}>集計月: {ym}</p>
        <Err msg={err} />
        {v ? (
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
            <li>売上（運賃合計）: {v.salesYen.toLocaleString()} 円</li>
            <li>運行件数: {v.tripLegCount}</li>
            <li>日報件数: {v.dailyReportCount}</li>
            <li>勤怠打刻（退勤済み）: {v.attendance.completedPunchCount} 件</li>
            <li>勤怠合計時間: {v.attendance.minutesTotal} 分</li>
          </ul>
        ) : !err ? (
          <p>読み込み中…</p>
        ) : null}
      </Card>
    </>
  );
}
