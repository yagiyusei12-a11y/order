import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Trip = {
  id: string;
  clientName: string;
  origin: string;
  destination: string;
  fareYen: number;
  distanceM: number;
  waitingMinutes: number;
  tariffVersionId: string | null;
};
type DR = {
  id: string;
  businessDate: string;
  trips: Trip[];
};
type DRRes = { dailyReports: DR[] };
type Ver = { id: string; version: number; planId: string };
type PlansRes = { plans: { id: string; versions: Ver[] }[] };

export default function DailyReportDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rep, setRep] = useState<DR | null>(null);
  const [versions, setVersions] = useState<Ver[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [clientName, setClientName] = useState("顧客");
  const [origin, setOrigin] = useState("A");
  const [destination, setDestination] = useState("B");
  const [distanceM, setDistanceM] = useState("3000");
  const [waitingMinutes, setWaitingMinutes] = useState("0");
  const [tariffVersionId, setTariffVersionId] = useState("");

  async function load(): Promise<void> {
    if (!id) return;
    const r = await apiFetch<DRRes>("/daily-reports");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const found = r.data.dailyReports.find((d) => d.id === id) ?? null;
    setRep(found);
    const rp = await apiFetch<PlansRes>("/tariff-plans");
    if (rp.ok) {
      const vers = rp.data.plans.flatMap((p) => p.versions);
      setVersions(vers);
      if (!tariffVersionId && vers[0]) setTariffVersionId(vers[0].id);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function addTrip(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!id) return;
    setErr(null);
    const r = await apiFetch<Trip>(`/daily-reports/${id}/trips`, {
      method: "POST",
      json: {
        clientName,
        origin,
        destination,
        departedAt: new Date().toISOString(),
        arrivedAt: new Date().toISOString(),
        distanceM: Number(distanceM),
        waitingMinutes: Number(waitingMinutes || 0),
        tariffVersionId: tariffVersionId || null,
      },
    });
    if (!r.ok) setErr(r.error);
    else await load();
  }

  async function delRep(): Promise<void> {
    if (!id || !confirm("この日報を削除しますか？")) return;
    setErr(null);
    const r = await apiFetch(`/daily-reports/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else navigate("/daily-reports", { replace: true });
  }

  if (!id) return <Err msg="id がありません" />;
  if (!rep) return <p>読み込み中…</p>;

  return (
    <>
      <Card title={`日報 ${rep.businessDate}`}>
        <Err msg={err} />
        <button type="button" onClick={() => void delRep()}>
          日報削除
        </button>
      </Card>
      <Card title="運行追加">
        <form onSubmit={(e) => void addTrip(e)}>
          <label>顧客名</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <label>出発地</label>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          <label>到着地</label>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} />
          <label>距離 (m)</label>
          <input value={distanceM} onChange={(e) => setDistanceM(e.target.value)} />
          <label>待機 (分)</label>
          <input value={waitingMinutes} onChange={(e) => setWaitingMinutes(e.target.value)} />
          <label>料金版（任意）</label>
          <select value={tariffVersionId} onChange={(e) => setTariffVersionId(e.target.value)}>
            <option value="">なし</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
              </option>
            ))}
          </select>
          <button type="submit">運行追加</button>
        </form>
      </Card>
      <Card title="運行一覧">
        <table>
          <thead>
            <tr>
              <th>顧客</th>
              <th>区間</th>
              <th>運賃</th>
              <th>距離</th>
              <th>待機</th>
            </tr>
          </thead>
          <tbody>
            {rep.trips.map((t) => (
              <tr key={t.id}>
                <td>{t.clientName}</td>
                <td>
                  {t.origin}→{t.destination}
                </td>
                <td>{t.fareYen}</td>
                <td>{t.distanceM}</td>
                <td>{t.waitingMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
