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

function toYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function isoDay(ymd: string, hour = 9): string {
  if (!ymd.trim()) return "";
  return `${ymd.trim()}T${String(hour).padStart(2, "0")}:00:00+09:00`;
}

function emptyComplaintForm(): Record<string, string | boolean> {
  return {
    receivedAtYmd: ymdNow(),
    receivedBy: "",
    occurredOnYmd: "",
    placeOrSection: "",
    driverEmployeeId: "",
    complainantName: "",
    complainantAddress: "",
    complainantContact: "",
    category: "",
    categoryOther: "",
    detail: "",
    causeAnalysis: "",
    rebuttal: "",
    correctiveAction: "",
    handlerName: "",
    completedOnYmd: "",
    representativeChecked: false,
  };
}

function complaintFromRow(c: Complaint): Record<string, string | boolean> {
  return {
    receivedAtYmd: toYmd(c.receivedAt),
    receivedBy: c.receivedBy ?? "",
    occurredOnYmd: toYmd(c.occurredOn),
    placeOrSection: c.placeOrSection ?? "",
    driverEmployeeId: c.driverEmployeeId ?? "",
    complainantName: c.complainantName ?? "",
    complainantAddress: c.complainantAddress ?? "",
    complainantContact: c.complainantContact ?? "",
    category: c.category ?? "",
    categoryOther: c.categoryOther ?? "",
    detail: c.detail ?? "",
    causeAnalysis: c.causeAnalysis ?? "",
    rebuttal: c.rebuttal ?? "",
    correctiveAction: c.correctiveAction ?? "",
    handlerName: c.handlerName ?? "",
    completedOnYmd: toYmd(c.completedOn),
    representativeChecked: c.representativeChecked,
  };
}

function complaintPayload(f: Record<string, string | boolean>): Record<string, unknown> {
  const receivedAt = isoDay(String(f.receivedAtYmd));
  if (!receivedAt) throw new Error("receivedAt required");
  const out: Record<string, unknown> = {
    receivedAt,
    receivedBy: String(f.receivedBy).trim() || undefined,
    driverEmployeeId: String(f.driverEmployeeId).trim() || null,
    placeOrSection: String(f.placeOrSection).trim() || undefined,
    complainantName: String(f.complainantName).trim() || undefined,
    complainantAddress: String(f.complainantAddress).trim() || undefined,
    complainantContact: String(f.complainantContact).trim() || undefined,
    category: String(f.category).trim() || undefined,
    categoryOther: String(f.categoryOther).trim() || undefined,
    detail: String(f.detail).trim() || undefined,
    causeAnalysis: String(f.causeAnalysis).trim() || undefined,
    rebuttal: String(f.rebuttal).trim() || undefined,
    correctiveAction: String(f.correctiveAction).trim() || undefined,
    handlerName: String(f.handlerName).trim() || undefined,
    representativeChecked: Boolean(f.representativeChecked),
  };
  const occ = String(f.occurredOnYmd).trim();
  if (occ) out.occurredOn = isoDay(occ, 0);
  const comp = String(f.completedOnYmd).trim();
  if (comp) out.completedOn = isoDay(comp, 0);
  return out;
}

function emptyGuidanceForm(): Record<string, string | boolean | { employeeId: string | null; attendeeName: string }[]> {
  return {
    startedAtYmd: ymdNow(),
    endedAtYmd: "",
    location: "",
    instructorName: "",
    topicFeeCollection: false,
    topicTerms: false,
    topicConditionExplain: false,
    topicMarking: false,
    topicRoadTransportLaw: false,
    topicOther: "",
    topicOtherDetail: "",
    remarks: "",
    representativeChecked: false,
    attendees: [{ employeeId: null, attendeeName: "" }],
  };
}

function guidanceFromRow(g: Guidance): Record<string, string | boolean | { employeeId: string | null; attendeeName: string }[]> {
  return {
    startedAtYmd: toYmd(g.startedAt),
    endedAtYmd: toYmd(g.endedAt),
    location: g.location ?? "",
    instructorName: g.instructorName ?? "",
    topicFeeCollection: g.topicFeeCollection,
    topicTerms: g.topicTerms,
    topicConditionExplain: g.topicConditionExplain,
    topicMarking: g.topicMarking,
    topicRoadTransportLaw: g.topicRoadTransportLaw,
    topicOther: g.topicOther ?? "",
    topicOtherDetail: g.topicOtherDetail ?? "",
    remarks: g.remarks ?? "",
    representativeChecked: g.representativeChecked,
    attendees:
      g.attendees.length > 0
        ? g.attendees.map((a) => ({ employeeId: a.employeeId, attendeeName: a.attendeeName ?? "" }))
        : [{ employeeId: null, attendeeName: "" }],
  };
}

function guidancePayload(f: Record<string, string | boolean | { employeeId: string | null; attendeeName: string }[]>): Record<string, unknown> {
  const startedAt = isoDay(String(f.startedAtYmd));
  if (!startedAt) throw new Error("startedAt required");
  const attendees = (f.attendees as { employeeId: string | null; attendeeName: string }[])
    .map((a) => ({
      employeeId: a.employeeId?.trim() || null,
      attendeeName: a.attendeeName?.trim() || undefined,
    }))
    .filter((a) => a.employeeId || a.attendeeName);
  const out: Record<string, unknown> = {
    startedAt,
    location: String(f.location).trim() || undefined,
    instructorName: String(f.instructorName).trim() || undefined,
    topicFeeCollection: Boolean(f.topicFeeCollection),
    topicTerms: Boolean(f.topicTerms),
    topicConditionExplain: Boolean(f.topicConditionExplain),
    topicMarking: Boolean(f.topicMarking),
    topicRoadTransportLaw: Boolean(f.topicRoadTransportLaw),
    topicOther: String(f.topicOther).trim() || undefined,
    topicOtherDetail: String(f.topicOtherDetail).trim() || undefined,
    remarks: String(f.remarks).trim() || undefined,
    representativeChecked: Boolean(f.representativeChecked),
    attendees: attendees.length ? attendees : undefined,
  };
  const end = String(f.endedAtYmd).trim();
  if (end) out.endedAt = isoDay(end, 0);
  return out;
}

function emptyChangeForm(): Record<string, string> {
  return {
    changeType: "",
    submittedOnYmd: ymdNow(),
    changedOnYmd: "",
    effectiveOnYmd: "",
    oldValue: "",
    newValue: "",
    reason: "",
    notes: "",
  };
}

function changeFromRow(x: ChangeNotice): Record<string, string> {
  return {
    changeType: x.changeType ?? "",
    submittedOnYmd: toYmd(x.submittedOn),
    changedOnYmd: toYmd(x.changedOn),
    effectiveOnYmd: toYmd(x.effectiveOn),
    oldValue: x.oldValue ?? "",
    newValue: x.newValue ?? "",
    reason: x.reason ?? "",
    notes: x.notes ?? "",
  };
}

function changePayload(f: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    changeType: String(f.changeType).trim() || undefined,
    oldValue: String(f.oldValue).trim() || undefined,
    newValue: String(f.newValue).trim() || undefined,
    reason: String(f.reason).trim() || undefined,
    notes: String(f.notes).trim() || undefined,
  };
  const sub = String(f.submittedOnYmd).trim();
  if (sub) out.submittedOn = isoDay(sub, 0);
  const ch = String(f.changedOnYmd).trim();
  if (ch) out.changedOn = isoDay(ch, 0);
  const ef = String(f.effectiveOnYmd).trim();
  if (ef) out.effectiveOn = isoDay(ef, 0);
  return out;
}

export default function Legal(): JSX.Element {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [guidances, setGuidances] = useState<Guidance[]>([]);
  const [changes, setChanges] = useState<ChangeNotice[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [newComplaint, setNewComplaint] = useState(() => emptyComplaintForm());
  const [editComplaintId, setEditComplaintId] = useState<string | null>(null);
  const [editComplaint, setEditComplaint] = useState<Record<string, string | boolean>>(emptyComplaintForm());

  const [newGuidance, setNewGuidance] = useState(() => emptyGuidanceForm());
  const [editGuidanceId, setEditGuidanceId] = useState<string | null>(null);
  const [editGuidance, setEditGuidance] = useState(() => emptyGuidanceForm());

  const [newChange, setNewChange] = useState(() => emptyChangeForm());
  const [editChangeId, setEditChangeId] = useState<string | null>(null);
  const [editChange, setEditChange] = useState<Record<string, string>>(emptyChangeForm());

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
    setErr(null);
    try {
      const json = complaintPayload(newComplaint);
      const r = await apiFetch("/legal/complaints", { method: "POST", json });
      if (!r.ok) setErr(r.error);
      else {
        setNewComplaint(emptyComplaintForm());
        await loadAll();
      }
    } catch (x) {
      setErr(String(x));
    }
  }

  async function saveComplaint(id: string): Promise<void> {
    setErr(null);
    try {
      const json = complaintPayload(editComplaint);
      const r = await apiFetch(`/legal/complaints/${id}`, { method: "PATCH", json });
      if (!r.ok) setErr(r.error);
      else {
        setEditComplaintId(null);
        await loadAll();
      }
    } catch (x) {
      setErr(String(x));
    }
  }

  async function createGuidance(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      const json = guidancePayload(newGuidance);
      const r = await apiFetch("/legal/guidance", { method: "POST", json });
      if (!r.ok) setErr(r.error);
      else {
        setNewGuidance(emptyGuidanceForm());
        await loadAll();
      }
    } catch (x) {
      setErr(String(x));
    }
  }

  async function saveGuidance(id: string): Promise<void> {
    setErr(null);
    try {
      const json = guidancePayload(editGuidance);
      const r = await apiFetch(`/legal/guidance/${id}`, { method: "PATCH", json });
      if (!r.ok) setErr(r.error);
      else {
        setEditGuidanceId(null);
        await loadAll();
      }
    } catch (x) {
      setErr(String(x));
    }
  }

  async function createChangeNotice(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      const json = changePayload(newChange);
      const r = await apiFetch("/legal/change-notices", { method: "POST", json });
      if (!r.ok) setErr(r.error);
      else {
        setNewChange(emptyChangeForm());
        await loadAll();
      }
    } catch (x) {
      setErr(String(x));
    }
  }

  async function saveChangeNotice(id: string): Promise<void> {
    setErr(null);
    try {
      const json = changePayload(editChange);
      const r = await apiFetch(`/legal/change-notices/${id}`, { method: "PATCH", json });
      if (!r.ok) setErr(r.error);
      else {
        setEditChangeId(null);
        await loadAll();
      }
    } catch (x) {
      setErr(String(x));
    }
  }

  async function deleteItem(path: string): Promise<void> {
    const r = await apiFetch(path, { method: "DELETE" });
    if (!r.ok) setErr(r.error);
    else await loadAll();
  }

  function setNc<K extends string>(k: K, v: string | boolean): void {
    setNewComplaint((p) => ({ ...p, [k]: v }));
  }
  function setEc<K extends string>(k: K, v: string | boolean): void {
    setEditComplaint((p) => ({ ...p, [k]: v }));
  }

  function setNg<K extends string>(k: K, v: string | boolean | { employeeId: string | null; attendeeName: string }[]): void {
    setNewGuidance((p) => ({ ...p, [k]: v }));
  }
  function setEg<K extends string>(k: K, v: string | boolean | { employeeId: string | null; attendeeName: string }[]): void {
    setEditGuidance((p) => ({ ...p, [k]: v }));
  }

  function addAttendee(which: "new" | "edit"): void {
    if (which === "new") {
      setNewGuidance((p) => ({
        ...p,
        attendees: [...(p.attendees as { employeeId: string | null; attendeeName: string }[]), { employeeId: null, attendeeName: "" }],
      }));
    } else {
      setEditGuidance((p) => ({
        ...p,
        attendees: [...(p.attendees as { employeeId: string | null; attendeeName: string }[]), { employeeId: null, attendeeName: "" }],
      }));
    }
  }

  function setAttendee(which: "new" | "edit", i: number, field: "employeeId" | "attendeeName", v: string): void {
    const fn = which === "new" ? setNewGuidance : setEditGuidance;
    fn((p) => {
      const arr = [...(p.attendees as { employeeId: string | null; attendeeName: string }[])];
      const row = { ...arr[i] };
      if (field === "employeeId") row.employeeId = v || null;
      else row.attendeeName = v;
      arr[i] = row;
      return { ...p, attendees: arr };
    });
  }

  const fieldStyle = { width: "100%", maxWidth: 520 } as const;

  return (
    <>
      <Card title="法定入力（苦情処理簿）">
        <Err msg={err} />
        <h4 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>新規登録（全項目）</h4>
        <form onSubmit={(e) => void createComplaint(e)} style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem" }}>
          <label>受付日</label>
          <input type="date" value={String(newComplaint.receivedAtYmd)} onChange={(ev) => setNc("receivedAtYmd", ev.target.value)} />
          <label>受付者</label>
          <input value={String(newComplaint.receivedBy)} onChange={(ev) => setNc("receivedBy", ev.target.value)} style={fieldStyle} />
          <label>発生日</label>
          <input type="date" value={String(newComplaint.occurredOnYmd)} onChange={(ev) => setNc("occurredOnYmd", ev.target.value)} />
          <label>場所・区間</label>
          <input value={String(newComplaint.placeOrSection)} onChange={(ev) => setNc("placeOrSection", ev.target.value)} style={fieldStyle} />
          <label>運転者</label>
          <select value={String(newComplaint.driverEmployeeId)} onChange={(ev) => setNc("driverEmployeeId", ev.target.value)}>
            <option value="">（未指定）</option>
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.familyName} {x.givenName}
              </option>
            ))}
          </select>
          <label>苦情者氏名</label>
          <input value={String(newComplaint.complainantName)} onChange={(ev) => setNc("complainantName", ev.target.value)} style={fieldStyle} />
          <label>苦情者住所</label>
          <textarea rows={2} value={String(newComplaint.complainantAddress)} onChange={(ev) => setNc("complainantAddress", ev.target.value)} style={fieldStyle} />
          <label>苦情者連絡先</label>
          <input value={String(newComplaint.complainantContact)} onChange={(ev) => setNc("complainantContact", ev.target.value)} style={fieldStyle} />
          <label>区分</label>
          <input value={String(newComplaint.category)} onChange={(ev) => setNc("category", ev.target.value)} style={fieldStyle} />
          <label>区分（その他）</label>
          <input value={String(newComplaint.categoryOther)} onChange={(ev) => setNc("categoryOther", ev.target.value)} style={fieldStyle} />
          <label>苦情内容</label>
          <textarea rows={3} value={String(newComplaint.detail)} onChange={(ev) => setNc("detail", ev.target.value)} style={fieldStyle} />
          <label>原因分析</label>
          <textarea rows={2} value={String(newComplaint.causeAnalysis)} onChange={(ev) => setNc("causeAnalysis", ev.target.value)} style={fieldStyle} />
          <label>反論・主張</label>
          <textarea rows={2} value={String(newComplaint.rebuttal)} onChange={(ev) => setNc("rebuttal", ev.target.value)} style={fieldStyle} />
          <label>是正処置</label>
          <textarea rows={2} value={String(newComplaint.correctiveAction)} onChange={(ev) => setNc("correctiveAction", ev.target.value)} style={fieldStyle} />
          <label>担当者名</label>
          <input value={String(newComplaint.handlerName)} onChange={(ev) => setNc("handlerName", ev.target.value)} style={fieldStyle} />
          <label>完了日</label>
          <input type="date" value={String(newComplaint.completedOnYmd)} onChange={(ev) => setNc("completedOnYmd", ev.target.value)} />
          <label>
            <input type="checkbox" checked={Boolean(newComplaint.representativeChecked)} onChange={(ev) => setNc("representativeChecked", ev.target.checked)} />{" "}
            代表者確認済
          </label>
          <button type="submit">苦情を追加</button>
        </form>
        <p style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>登録件数: {complaints.length}</p>
        {complaints.slice(0, 30).map((x) => (
          <div key={x.id} style={{ borderTop: "1px solid #ddd", marginTop: 8, paddingTop: 8 }}>
            <div style={{ fontSize: "0.85rem" }}>
              {toYmd(x.receivedAt)} / {x.detail?.slice(0, 80) || "（内容未記入）"}
            </div>
            {editComplaintId === x.id ? (
              <div style={{ marginTop: 8, display: "grid", gap: "0.35rem", fontSize: "0.85rem" }}>
                <label>受付日</label>
                <input type="date" value={String(editComplaint.receivedAtYmd)} onChange={(ev) => setEc("receivedAtYmd", ev.target.value)} />
                <label>受付者</label>
                <input value={String(editComplaint.receivedBy)} onChange={(ev) => setEc("receivedBy", ev.target.value)} style={fieldStyle} />
                <label>発生日</label>
                <input type="date" value={String(editComplaint.occurredOnYmd)} onChange={(ev) => setEc("occurredOnYmd", ev.target.value)} />
                <label>場所・区間</label>
                <input value={String(editComplaint.placeOrSection)} onChange={(ev) => setEc("placeOrSection", ev.target.value)} style={fieldStyle} />
                <label>運転者</label>
                <select value={String(editComplaint.driverEmployeeId)} onChange={(ev) => setEc("driverEmployeeId", ev.target.value)}>
                  <option value="">（未指定）</option>
                  {employees.map((em) => (
                    <option key={em.id} value={em.id}>
                      {em.familyName} {em.givenName}
                    </option>
                  ))}
                </select>
                <label>苦情者氏名</label>
                <input value={String(editComplaint.complainantName)} onChange={(ev) => setEc("complainantName", ev.target.value)} style={fieldStyle} />
                <label>苦情者住所</label>
                <textarea rows={2} value={String(editComplaint.complainantAddress)} onChange={(ev) => setEc("complainantAddress", ev.target.value)} style={fieldStyle} />
                <label>苦情者連絡先</label>
                <input value={String(editComplaint.complainantContact)} onChange={(ev) => setEc("complainantContact", ev.target.value)} style={fieldStyle} />
                <label>区分</label>
                <input value={String(editComplaint.category)} onChange={(ev) => setEc("category", ev.target.value)} style={fieldStyle} />
                <label>区分（その他）</label>
                <input value={String(editComplaint.categoryOther)} onChange={(ev) => setEc("categoryOther", ev.target.value)} style={fieldStyle} />
                <label>苦情内容</label>
                <textarea rows={3} value={String(editComplaint.detail)} onChange={(ev) => setEc("detail", ev.target.value)} style={fieldStyle} />
                <label>原因分析</label>
                <textarea rows={2} value={String(editComplaint.causeAnalysis)} onChange={(ev) => setEc("causeAnalysis", ev.target.value)} style={fieldStyle} />
                <label>反論・主張</label>
                <textarea rows={2} value={String(editComplaint.rebuttal)} onChange={(ev) => setEc("rebuttal", ev.target.value)} style={fieldStyle} />
                <label>是正処置</label>
                <textarea rows={2} value={String(editComplaint.correctiveAction)} onChange={(ev) => setEc("correctiveAction", ev.target.value)} style={fieldStyle} />
                <label>担当者名</label>
                <input value={String(editComplaint.handlerName)} onChange={(ev) => setEc("handlerName", ev.target.value)} style={fieldStyle} />
                <label>完了日</label>
                <input type="date" value={String(editComplaint.completedOnYmd)} onChange={(ev) => setEc("completedOnYmd", ev.target.value)} />
                <label>
                  <input type="checkbox" checked={Boolean(editComplaint.representativeChecked)} onChange={(ev) => setEc("representativeChecked", ev.target.checked)} />{" "}
                  代表者確認済
                </label>
                <button type="button" onClick={() => void saveComplaint(x.id)}>
                  保存
                </button>{" "}
                <button type="button" onClick={() => setEditComplaintId(null)}>
                  キャンセル
                </button>
              </div>
            ) : (
              <button type="button" style={{ marginTop: 4 }} onClick={() => { setEditComplaintId(x.id); setEditComplaint(complaintFromRow(x)); }}>
                編集
              </button>
            )}{" "}
            <button type="button" onClick={() => void deleteItem(`/legal/complaints/${x.id}`)}>
              削除
            </button>
          </div>
        ))}
      </Card>

      <Card title="法定入力（指導記録簿）">
        <h4 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>新規登録（全項目）</h4>
        <form onSubmit={(e) => void createGuidance(e)} style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem" }}>
          <label>指導開始日</label>
          <input type="date" value={String(newGuidance.startedAtYmd)} onChange={(ev) => setNg("startedAtYmd", ev.target.value)} />
          <label>指導終了日</label>
          <input type="date" value={String(newGuidance.endedAtYmd)} onChange={(ev) => setNg("endedAtYmd", ev.target.value)} />
          <label>場所</label>
          <input value={String(newGuidance.location)} onChange={(ev) => setNg("location", ev.target.value)} style={fieldStyle} />
          <label>指導者氏名</label>
          <input value={String(newGuidance.instructorName)} onChange={(ev) => setNg("instructorName", ev.target.value)} style={fieldStyle} />
          <label>題目（チェック）</label>
          <label>
            <input type="checkbox" checked={Boolean(newGuidance.topicFeeCollection)} onChange={(ev) => setNg("topicFeeCollection", ev.target.checked)} />{" "}
            運賃の収受
          </label>
          <label>
            <input type="checkbox" checked={Boolean(newGuidance.topicTerms)} onChange={(ev) => setNg("topicTerms", ev.target.checked)} /> 約款
          </label>
          <label>
            <input type="checkbox" checked={Boolean(newGuidance.topicConditionExplain)} onChange={(ev) => setNg("topicConditionExplain", ev.target.checked)} />{" "}
            運送条件の説明
          </label>
          <label>
            <input type="checkbox" checked={Boolean(newGuidance.topicMarking)} onChange={(ev) => setNg("topicMarking", ev.target.checked)} /> 標識の取付け
          </label>
          <label>
            <input type="checkbox" checked={Boolean(newGuidance.topicRoadTransportLaw)} onChange={(ev) => setNg("topicRoadTransportLaw", ev.target.checked)} />{" "}
            道路運送法
          </label>
          <label>題目（その他・名称）</label>
          <input value={String(newGuidance.topicOther)} onChange={(ev) => setNg("topicOther", ev.target.value)} style={fieldStyle} />
          <label>題目（その他・内容）</label>
          <textarea rows={2} value={String(newGuidance.topicOtherDetail)} onChange={(ev) => setNg("topicOtherDetail", ev.target.value)} style={fieldStyle} />
          <label>備考</label>
          <textarea rows={2} value={String(newGuidance.remarks)} onChange={(ev) => setNg("remarks", ev.target.value)} style={fieldStyle} />
          <label>
            <input type="checkbox" checked={Boolean(newGuidance.representativeChecked)} onChange={(ev) => setNg("representativeChecked", ev.target.checked)} />{" "}
            代表者確認済
          </label>
          <span>受講者（複数可）</span>
          {(newGuidance.attendees as { employeeId: string | null; attendeeName: string }[]).map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={a.employeeId ?? ""} onChange={(ev) => setAttendee("new", i, "employeeId", ev.target.value)}>
                <option value="">（氏名手入力）</option>
                {employees.map((em) => (
                  <option key={em.id} value={em.id}>
                    {em.familyName} {em.givenName}
                  </option>
                ))}
              </select>
              <input placeholder="氏名（外部受講者等）" value={a.attendeeName} onChange={(ev) => setAttendee("new", i, "attendeeName", ev.target.value)} style={{ minWidth: 160 }} />
            </div>
          ))}
          <button type="button" onClick={() => addAttendee("new")}>
            受講者を追加
          </button>
          <button type="submit">指導記録を追加</button>
        </form>
        <p style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>登録件数: {guidances.length}</p>
        {guidances.slice(0, 30).map((x) => (
          <div key={x.id} style={{ borderTop: "1px solid #ddd", marginTop: 8, paddingTop: 8 }}>
            <div style={{ fontSize: "0.85rem" }}>
              {toYmd(x.startedAt)} / {x.topicOtherDetail?.slice(0, 60) || x.remarks?.slice(0, 60) || "—"}
            </div>
            {editGuidanceId === x.id ? (
              <div style={{ marginTop: 8, display: "grid", gap: "0.35rem", fontSize: "0.85rem" }}>
                <label>指導開始日</label>
                <input type="date" value={String(editGuidance.startedAtYmd)} onChange={(ev) => setEg("startedAtYmd", ev.target.value)} />
                <label>指導終了日</label>
                <input type="date" value={String(editGuidance.endedAtYmd)} onChange={(ev) => setEg("endedAtYmd", ev.target.value)} />
                <label>場所</label>
                <input value={String(editGuidance.location)} onChange={(ev) => setEg("location", ev.target.value)} style={fieldStyle} />
                <label>指導者氏名</label>
                <input value={String(editGuidance.instructorName)} onChange={(ev) => setEg("instructorName", ev.target.value)} style={fieldStyle} />
                <label>
                  <input type="checkbox" checked={Boolean(editGuidance.topicFeeCollection)} onChange={(ev) => setEg("topicFeeCollection", ev.target.checked)} />{" "}
                  運賃の収受
                </label>
                <label>
                  <input type="checkbox" checked={Boolean(editGuidance.topicTerms)} onChange={(ev) => setEg("topicTerms", ev.target.checked)} /> 約款
                </label>
                <label>
                  <input type="checkbox" checked={Boolean(editGuidance.topicConditionExplain)} onChange={(ev) => setEg("topicConditionExplain", ev.target.checked)} />{" "}
                  運送条件の説明
                </label>
                <label>
                  <input type="checkbox" checked={Boolean(editGuidance.topicMarking)} onChange={(ev) => setEg("topicMarking", ev.target.checked)} /> 標識
                </label>
                <label>
                  <input type="checkbox" checked={Boolean(editGuidance.topicRoadTransportLaw)} onChange={(ev) => setEg("topicRoadTransportLaw", ev.target.checked)} />{" "}
                  道路運送法
                </label>
                <label>題目（その他・名称）</label>
                <input value={String(editGuidance.topicOther)} onChange={(ev) => setEg("topicOther", ev.target.value)} style={fieldStyle} />
                <label>題目（その他・内容）</label>
                <textarea rows={2} value={String(editGuidance.topicOtherDetail)} onChange={(ev) => setEg("topicOtherDetail", ev.target.value)} style={fieldStyle} />
                <label>備考</label>
                <textarea rows={2} value={String(editGuidance.remarks)} onChange={(ev) => setEg("remarks", ev.target.value)} style={fieldStyle} />
                <label>
                  <input type="checkbox" checked={Boolean(editGuidance.representativeChecked)} onChange={(ev) => setEg("representativeChecked", ev.target.checked)} />{" "}
                  代表者確認済
                </label>
                {(editGuidance.attendees as { employeeId: string | null; attendeeName: string }[]).map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select value={a.employeeId ?? ""} onChange={(ev) => setAttendee("edit", i, "employeeId", ev.target.value)}>
                      <option value="">（氏名手入力）</option>
                      {employees.map((em) => (
                        <option key={em.id} value={em.id}>
                          {em.familyName} {em.givenName}
                        </option>
                      ))}
                    </select>
                    <input placeholder="氏名" value={a.attendeeName} onChange={(ev) => setAttendee("edit", i, "attendeeName", ev.target.value)} />
                  </div>
                ))}
                <button type="button" onClick={() => addAttendee("edit")}>
                  受講者を追加
                </button>
                <button type="button" onClick={() => void saveGuidance(x.id)}>
                  保存
                </button>{" "}
                <button type="button" onClick={() => setEditGuidanceId(null)}>
                  キャンセル
                </button>
              </div>
            ) : (
              <button type="button" style={{ marginTop: 4 }} onClick={() => { setEditGuidanceId(x.id); setEditGuidance(guidanceFromRow(x)); }}>
                編集
              </button>
            )}{" "}
            <button type="button" onClick={() => void deleteItem(`/legal/guidance/${x.id}`)}>
              削除
            </button>
          </div>
        ))}
      </Card>

      <Card title="法定入力（変更届履歴）">
        <h4 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>新規登録（全項目）</h4>
        <form onSubmit={(e) => void createChangeNotice(e)} style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem" }}>
          <label>変更事項</label>
          <input value={newChange.changeType} onChange={(ev) => setNewChange((p) => ({ ...p, changeType: ev.target.value }))} style={fieldStyle} />
          <label>提出日</label>
          <input type="date" value={newChange.submittedOnYmd} onChange={(ev) => setNewChange((p) => ({ ...p, submittedOnYmd: ev.target.value }))} />
          <label>変更日</label>
          <input type="date" value={newChange.changedOnYmd} onChange={(ev) => setNewChange((p) => ({ ...p, changedOnYmd: ev.target.value }))} />
          <label>効力発生日</label>
          <input type="date" value={newChange.effectiveOnYmd} onChange={(ev) => setNewChange((p) => ({ ...p, effectiveOnYmd: ev.target.value }))} />
          <label>旧</label>
          <textarea rows={2} value={newChange.oldValue} onChange={(ev) => setNewChange((p) => ({ ...p, oldValue: ev.target.value }))} style={fieldStyle} />
          <label>新</label>
          <textarea rows={2} value={newChange.newValue} onChange={(ev) => setNewChange((p) => ({ ...p, newValue: ev.target.value }))} style={fieldStyle} />
          <label>変更理由</label>
          <textarea rows={2} value={newChange.reason} onChange={(ev) => setNewChange((p) => ({ ...p, reason: ev.target.value }))} style={fieldStyle} />
          <label>備考</label>
          <textarea rows={2} value={newChange.notes} onChange={(ev) => setNewChange((p) => ({ ...p, notes: ev.target.value }))} style={fieldStyle} />
          <button type="submit">変更履歴を追加</button>
        </form>
        <p style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>登録件数: {changes.length}</p>
        {changes.slice(0, 30).map((x) => (
          <div key={x.id} style={{ borderTop: "1px solid #ddd", marginTop: 8, paddingTop: 8 }}>
            <div style={{ fontSize: "0.85rem" }}>
              {x.changeType || "変更"} / 新: {(x.newValue || "-").slice(0, 40)}
            </div>
            {editChangeId === x.id ? (
              <div style={{ marginTop: 8, display: "grid", gap: "0.35rem", fontSize: "0.85rem" }}>
                <label>変更事項</label>
                <input value={editChange.changeType} onChange={(ev) => setEditChange((p) => ({ ...p, changeType: ev.target.value }))} style={fieldStyle} />
                <label>提出日</label>
                <input type="date" value={editChange.submittedOnYmd} onChange={(ev) => setEditChange((p) => ({ ...p, submittedOnYmd: ev.target.value }))} />
                <label>変更日</label>
                <input type="date" value={editChange.changedOnYmd} onChange={(ev) => setEditChange((p) => ({ ...p, changedOnYmd: ev.target.value }))} />
                <label>効力発生日</label>
                <input type="date" value={editChange.effectiveOnYmd} onChange={(ev) => setEditChange((p) => ({ ...p, effectiveOnYmd: ev.target.value }))} />
                <label>旧</label>
                <textarea rows={2} value={editChange.oldValue} onChange={(ev) => setEditChange((p) => ({ ...p, oldValue: ev.target.value }))} style={fieldStyle} />
                <label>新</label>
                <textarea rows={2} value={editChange.newValue} onChange={(ev) => setEditChange((p) => ({ ...p, newValue: ev.target.value }))} style={fieldStyle} />
                <label>変更理由</label>
                <textarea rows={2} value={editChange.reason} onChange={(ev) => setEditChange((p) => ({ ...p, reason: ev.target.value }))} style={fieldStyle} />
                <label>備考</label>
                <textarea rows={2} value={editChange.notes} onChange={(ev) => setEditChange((p) => ({ ...p, notes: ev.target.value }))} style={fieldStyle} />
                <button type="button" onClick={() => void saveChangeNotice(x.id)}>
                  保存
                </button>{" "}
                <button type="button" onClick={() => setEditChangeId(null)}>
                  キャンセル
                </button>
              </div>
            ) : (
              <button type="button" style={{ marginTop: 4 }} onClick={() => { setEditChangeId(x.id); setEditChange(changeFromRow(x)); }}>
                編集
              </button>
            )}{" "}
            <button type="button" onClick={() => void deleteItem(`/legal/change-notices/${x.id}`)}>
              削除
            </button>
          </div>
        ))}
      </Card>
    </>
  );
}
