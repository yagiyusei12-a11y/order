import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Employee = { id: string; familyName: string; givenName: string };
type Complaint = {
  id: string;
  receivedAt: string;
  receivedBy: string | null;
  occurredOn: string | null;
  placeOrSection: string | null;
  driverEmployeeId: string | null;
  complainantName: string | null;
  complainantAddress: string | null;
  complainantContact: string | null;
  category: string | null;
  categoryOther: string | null;
  detail: string | null;
  causeAnalysis: string | null;
  rebuttal: string | null;
  correctiveAction: string | null;
  handlerName: string | null;
  completedOn: string | null;
  representativeChecked: boolean;
};
type Guidance = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  location: string | null;
  instructorName: string | null;
  topicFeeCollection: boolean;
  topicTerms: boolean;
  topicConditionExplain: boolean;
  topicMarking: boolean;
  topicRoadTransportLaw: boolean;
  topicOther: string | null;
  topicOtherDetail: string | null;
  remarks: string | null;
  representativeChecked: boolean;
  attendees: { employeeId: string | null; attendeeName: string | null }[];
};
type ChangeNotice = {
  id: string;
  changeType: string | null;
  submittedOn: string | null;
  changedOn: string | null;
  effectiveOn: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  notes: string | null;
};

function ymdNow(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Legal(): JSX.Element {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [guidances, setGuidances] = useState<Guidance[]>([]);
  const [changes, setChanges] = useState<ChangeNotice[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(ymdNow);
  const [driverEmployeeId, setDriverEmployeeId] = useState("");
  const [complaintDetail, setComplaintDetail] = useState("");
  const [guidanceAt, setGuidanceAt] = useState(ymdNow);
  const [guidanceAttendee, setGuidanceAttendee] = useState("");
  const [guidanceNote, setGuidanceNote] = useState("");
  const [changeType, setChangeType] = useState("");
  const [changeNew, setChangeNew] = useState("");
  const [changeOld, setChangeOld] = useState("");
  const [changeReason, setChangeReason] = useState("");

  async function loadAll(): Promise<void> {
    setErr(null);
    const [e, c, g, ch] = await Promise.all([
      apiFetch<{ employees: Employee[] }>("/employees?status=active"),
      apiFetch<{ items: Complaint[] }>("/legal/complaints"),
      apiFetch<{ items: Guidance[] }>("/legal/guidance"),
      apiFetch<{ items: ChangeNotice[] }>("/legal/change-notices"),
    ]);
    if (e.ok) setEmployees(e.data.employees);
    if (c.ok) setComplaints(c.data.items);
    if (g.ok) setGuidances(g.data.items);
    if (ch.ok) setChanges(ch.data.items);
    const errors = [e, c, g, ch].filter((x) => !x.ok).map((x) => x.error);
    if (errors.length) setErr(errors.join(" / "));
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createComplaint(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const r = await apiFetch("/legal/complaints", {
      method: "POST",
      json: {
        receivedAt: `${receivedAt}T09:00:00+09:00`,
        driverEmployeeId: driverEmployeeId || null,
        detail: complaintDetail,
      },
    });
    if (!r.ok) setErr(r.error);
    else {
      setComplaintDetail("");
      await loadAll();
    }
  }

  async function createGuidance(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const r = await apiFetch("/legal/guidance", {
      method: "POST",
      json: {
        startedAt: `${guidanceAt}T09:00:00+09:00`,
        topicOther: "その他",
        topicOtherDetail: guidanceNote,
        attendees: [{ employeeId: guidanceAttendee || null }],
      },
    });
    if (!r.ok) setErr(r.error);
    else {
      setGuidanceNote("");
      await loadAll();
    }
  }

  async function createChangeNotice(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const r = await apiFetch("/legal/change-notices", {
      method: "POST",
      json: {
        changeType,
        submittedOn: `${ymdNow()}T09:00:00+09:00`,
        oldValue: changeOld,
        newValue: changeNew,
        reason: changeReason,
      },
    });
    if (!r.ok) setErr(r.error);
    else {
      setChangeType("");
      setChangeOld("");
      setChangeNew("");
      setChangeReason("");
      await loadAll();
    }
  }

  async function deleteItem(path: string): Promise<void> {
    const r = await apiFetch(path, { method: "DELETE" });
    if (!r.ok) setErr(r.error);
    else await loadAll();
  }

  return (
    <>
      <Card title="法定入力（苦情処理簿）">
        <Err msg={err} />
        <form onSubmit={(e) => void createComplaint(e)}>
          <label>受付日</label>
          <input type="date" value={receivedAt} onChange={(ev) => setReceivedAt(ev.target.value)} />
          <label>運転者</label>
          <select value={driverEmployeeId} onChange={(ev) => setDriverEmployeeId(ev.target.value)}>
            <option value="">（未指定）</option>
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.familyName} {x.givenName}
              </option>
            ))}
          </select>
          <label>苦情内容</label>
          <textarea rows={3} value={complaintDetail} onChange={(ev) => setComplaintDetail(ev.target.value)} />
          <button type="submit">苦情を追加</button>
        </form>
        <p style={{ fontSize: "0.85rem" }}>登録件数: {complaints.length}</p>
        {complaints.slice(0, 10).map((x) => (
          <div key={x.id} style={{ borderTop: "1px solid #ddd", marginTop: 6, paddingTop: 6 }}>
            <div style={{ fontSize: "0.85rem" }}>
              {x.receivedAt.slice(0, 10)} / {x.detail || "（内容未記入）"}
            </div>
            <button type="button" onClick={() => void deleteItem(`/legal/complaints/${x.id}`)}>
              削除
            </button>
          </div>
        ))}
      </Card>

      <Card title="法定入力（指導記録簿）">
        <form onSubmit={(e) => void createGuidance(e)}>
          <label>指導日</label>
          <input type="date" value={guidanceAt} onChange={(ev) => setGuidanceAt(ev.target.value)} />
          <label>受講者</label>
          <select value={guidanceAttendee} onChange={(ev) => setGuidanceAttendee(ev.target.value)}>
            <option value="">（未指定）</option>
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.familyName} {x.givenName}
              </option>
            ))}
          </select>
          <label>その他要点・備考</label>
          <textarea rows={3} value={guidanceNote} onChange={(ev) => setGuidanceNote(ev.target.value)} />
          <button type="submit">指導記録を追加</button>
        </form>
        <p style={{ fontSize: "0.85rem" }}>登録件数: {guidances.length}</p>
        {guidances.slice(0, 10).map((x) => (
          <div key={x.id} style={{ borderTop: "1px solid #ddd", marginTop: 6, paddingTop: 6 }}>
            <div style={{ fontSize: "0.85rem" }}>
              {x.startedAt.slice(0, 10)} / {x.topicOtherDetail || "（備考なし）"}
            </div>
            <button type="button" onClick={() => void deleteItem(`/legal/guidance/${x.id}`)}>
              削除
            </button>
          </div>
        ))}
      </Card>

      <Card title="法定入力（変更届履歴）">
        <form onSubmit={(e) => void createChangeNotice(e)}>
          <label>変更事項</label>
          <input value={changeType} onChange={(ev) => setChangeType(ev.target.value)} />
          <label>新</label>
          <textarea rows={2} value={changeNew} onChange={(ev) => setChangeNew(ev.target.value)} />
          <label>旧</label>
          <textarea rows={2} value={changeOld} onChange={(ev) => setChangeOld(ev.target.value)} />
          <label>変更理由</label>
          <textarea rows={2} value={changeReason} onChange={(ev) => setChangeReason(ev.target.value)} />
          <button type="submit">変更履歴を追加</button>
        </form>
        <p style={{ fontSize: "0.85rem" }}>登録件数: {changes.length}</p>
        {changes.slice(0, 10).map((x) => (
          <div key={x.id} style={{ borderTop: "1px solid #ddd", marginTop: 6, paddingTop: 6 }}>
            <div style={{ fontSize: "0.85rem" }}>
              {x.changeType || "変更"} / 新: {x.newValue || "-"} / 旧: {x.oldValue || "-"}
            </div>
            <button type="button" onClick={() => void deleteItem(`/legal/change-notices/${x.id}`)}>
              削除
            </button>
          </div>
        ))}
      </Card>
    </>
  );
}
