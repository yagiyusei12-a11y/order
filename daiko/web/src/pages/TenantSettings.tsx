import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Row = {
  tenantId: string;
  businessDayRollHour: number;
  featureFlags: Record<string, unknown>;
  customJson: Record<string, unknown>;
  legalTradeName: string | null;
  legalRepresentativeName: string | null;
  legalBusinessAddress: string | null;
  legalPhone: string | null;
  legalPublicSafetyCommission: string | null;
  legalCertificationNumber: string | null;
  legalCertificationDate: string | null;
  legalMainOfficeName: string | null;
  legalMainOfficeAddress: string | null;
  legalSafetyManagerName: string | null;
  legalAlcoholDetectorModel: string | null;
  legalAlcoholInspectionDone: boolean | null;
  legalAlcoholInspectionDate: string | null;
  legalMutualAidOrganizationName: string | null;
  legalMutualAidContractFrom: string | null;
  legalMutualAidContractTo: string | null;
  legalBodilyCoverage: string | null;
  legalPropertyCoverage: string | null;
  legalVehicleCoverageLimitManYen: string | null;
};

function asYmd(s: string | null | undefined): string {
  if (!s) return "";
  return s.slice(0, 10);
}

function readDp(c: Record<string, unknown>): Record<string, string> {
  const p = c.dispatchProfile;
  if (!p || typeof p !== "object") return {};
  const o = p as Record<string, unknown>;
  const s = (k: string) => String(o[k] ?? "");
  return {
    tradeName: s("tradeName"),
    businessAddress: s("businessAddress"),
    phone: s("phone"),
    representativeName: s("representativeName"),
    registrationNumber: s("registrationNumber"),
    transportOfficeContact: s("transportOfficeContact"),
    extraNotes: s("extraNotes"),
    certificationAuthorityName: s("certificationAuthorityName"),
    mainOfficeName: s("mainOfficeName"),
    mainOfficeAddress: s("mainOfficeAddress"),
    publicSafetySubmissionAddressee: s("publicSafetySubmissionAddressee"),
    safeDrivingManagerName: s("safeDrivingManagerName"),
    alcoholDetectorModelName: s("alcoholDetectorModelName"),
    inspectionDoneYesNo: s("inspectionDoneYesNo"),
    inspectionDateYmd: s("inspectionDateYmd"),
  };
}

function readDf(c: Record<string, unknown>): {
  henko: Record<string, string>;
  songai: Record<string, string>;
  nintei: Record<string, string>;
} {
  const p = c.documentForms;
  if (!p || typeof p !== "object") {
    return {
      henko: {},
      songai: {},
      nintei: {},
    };
  }
  const o = p as Record<string, unknown>;
  const henko = (o.henko && typeof o.henko === "object" ? o.henko : {}) as Record<string, unknown>;
  const songai = (o.songai && typeof o.songai === "object" ? o.songai : {}) as Record<string, unknown>;
  const nintei = (o.nintei && typeof o.nintei === "object" ? o.nintei : {}) as Record<string, unknown>;
  const s = (x: Record<string, unknown>, k: string) => String(x[k] ?? "");
  return {
    henko: {
      submittedOnYmd: s(henko, "submittedOnYmd"),
      mutualAidPeriodOld: s(henko, "mutualAidPeriodOld"),
      mutualAidPeriodNew: s(henko, "mutualAidPeriodNew"),
      changeEffectiveOnYmd: s(henko, "changeEffectiveOnYmd"),
      changeReasonDetail: s(henko, "changeReasonDetail"),
    },
    songai: {
      mutualAidContractPeriod: s(songai, "mutualAidContractPeriod"),
      vehicleKyousaiLimitManYen: s(songai, "vehicleKyousaiLimitManYen"),
      vehicleApprovalNumber: s(songai, "vehicleApprovalNumber"),
      vehicleApprovedOnYmd: s(songai, "vehicleApprovedOnYmd"),
      incidentSummary: s(songai, "incidentSummary"),
    },
    nintei: {
      bodyOrMemo: s(nintei, "bodyOrMemo"),
    },
  };
}

export default function TenantSettings(): JSX.Element {
  const [row, setRow] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hour, setHour] = useState("4");
  const [flagsText, setFlagsText] = useState("{}");
  const [customText, setCustomText] = useState("{}");
  const [dpTradeName, setDpTradeName] = useState("");
  const [dpAddress, setDpAddress] = useState("");
  const [dpPhone, setDpPhone] = useState("");
  const [dpRep, setDpRep] = useState("");
  const [dpReg, setDpReg] = useState("");
  const [dpTransport, setDpTransport] = useState("");
  const [dpExtra, setDpExtra] = useState("");
  const [dpCertAuthority, setDpCertAuthority] = useState("");
  const [dpMainOfficeName, setDpMainOfficeName] = useState("");
  const [dpMainOfficeAddress, setDpMainOfficeAddress] = useState("");
  const [dpPublicSafety, setDpPublicSafety] = useState("");
  const [dpSafeManager, setDpSafeManager] = useState("");
  const [dpAlcoholModel, setDpAlcoholModel] = useState("");
  const [dpInspectionYn, setDpInspectionYn] = useState("");
  const [dpInspectionDate, setDpInspectionDate] = useState("");
  const [hkSubmitted, setHkSubmitted] = useState("");
  const [hkMutualOld, setHkMutualOld] = useState("");
  const [hkMutualNew, setHkMutualNew] = useState("");
  const [hkEffective, setHkEffective] = useState("");
  const [hkReason, setHkReason] = useState("");
  const [legalCertDate, setLegalCertDate] = useState("");
  const [legalMutualAidOrg, setLegalMutualAidOrg] = useState("");
  const [sgContractFrom, setSgContractFrom] = useState("");
  const [sgContractTo, setSgContractTo] = useState("");
  const [legalBodilyCoverageText, setLegalBodilyCoverageText] = useState("");
  const [legalPropertyCoverageText, setLegalPropertyCoverageText] = useState("");
  const [sgLimit, setSgLimit] = useState("");
  const [sgApprNo, setSgApprNo] = useState("");
  const [sgApprDate, setSgApprDate] = useState("");
  const [sgIncident, setSgIncident] = useState("");
  const [ntBody, setNtBody] = useState("");

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<Row>("/tenant-settings");
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setRow(r.data);
      setHour(String(r.data.businessDayRollHour));
      setFlagsText(JSON.stringify(r.data.featureFlags ?? {}, null, 2));
      const cj = (r.data.customJson ?? {}) as Record<string, unknown>;
      setCustomText(JSON.stringify(cj, null, 2));
      const dp = readDp(cj);
      setDpTradeName(r.data.legalTradeName ?? dp.tradeName);
      setDpAddress(r.data.legalBusinessAddress ?? dp.businessAddress);
      setDpPhone(r.data.legalPhone ?? dp.phone);
      setDpRep(r.data.legalRepresentativeName ?? dp.representativeName);
      setDpReg(r.data.legalCertificationNumber ?? dp.registrationNumber);
      setDpTransport(dp.transportOfficeContact);
      setDpExtra(dp.extraNotes);
      setDpCertAuthority(r.data.legalPublicSafetyCommission ?? dp.certificationAuthorityName);
      setDpMainOfficeName(r.data.legalMainOfficeName ?? dp.mainOfficeName);
      setDpMainOfficeAddress(r.data.legalMainOfficeAddress ?? dp.mainOfficeAddress);
      setDpPublicSafety(r.data.legalPublicSafetyCommission ?? dp.publicSafetySubmissionAddressee);
      setDpSafeManager(r.data.legalSafetyManagerName ?? dp.safeDrivingManagerName);
      setDpAlcoholModel(r.data.legalAlcoholDetectorModel ?? dp.alcoholDetectorModelName);
      setDpInspectionYn(
        r.data.legalAlcoholInspectionDone === null
          ? dp.inspectionDoneYesNo
          : r.data.legalAlcoholInspectionDone
            ? "有"
            : "無",
      );
      setDpInspectionDate(asYmd(r.data.legalAlcoholInspectionDate) || dp.inspectionDateYmd);
      setLegalCertDate(asYmd(r.data.legalCertificationDate));
      setLegalMutualAidOrg(r.data.legalMutualAidOrganizationName ?? "");
      setSgContractFrom(asYmd(r.data.legalMutualAidContractFrom));
      setSgContractTo(asYmd(r.data.legalMutualAidContractTo));
      setLegalBodilyCoverageText(r.data.legalBodilyCoverage ?? "");
      setLegalPropertyCoverageText(r.data.legalPropertyCoverage ?? "");
      setSgLimit(r.data.legalVehicleCoverageLimitManYen ?? "");
      const df = readDf(cj);
      setHkSubmitted(df.henko.submittedOnYmd ?? "");
      setHkMutualOld(df.henko.mutualAidPeriodOld ?? "");
      setHkMutualNew(df.henko.mutualAidPeriodNew ?? "");
      setHkEffective(df.henko.changeEffectiveOnYmd ?? "");
      setHkReason(df.henko.changeReasonDetail ?? "");
      if (!asYmd(r.data.legalMutualAidContractFrom) && !asYmd(r.data.legalMutualAidContractTo) && df.songai.mutualAidContractPeriod) {
        const raw = df.songai.mutualAidContractPeriod;
        const parts = raw.split(/[～~]/).map((x) => x.trim());
        if (parts.length >= 2) {
          setSgContractFrom(parts[0].slice(0, 10));
          setSgContractTo(parts[1].slice(0, 10));
        }
      }
      setSgLimit((prev) => prev || df.songai.vehicleKyousaiLimitManYen || "");
      setSgApprNo(df.songai.vehicleApprovalNumber ?? "");
      setSgApprDate(df.songai.vehicleApprovedOnYmd ?? "");
      setSgIncident(df.songai.incidentSummary ?? "");
      setNtBody(df.nintei.bodyOrMemo ?? "");
    })();
  }, []);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    let featureFlags: Record<string, unknown>;
    let customJson: Record<string, unknown>;
    try {
      featureFlags = JSON.parse(flagsText) as Record<string, unknown>;
      customJson = JSON.parse(customText) as Record<string, unknown>;
    } catch {
      setErr("JSON の形式が不正です");
      return;
    }
    const dispatchProfile: Record<string, string> = {
      tradeName: dpTradeName.trim(),
      businessAddress: dpAddress.trim(),
      phone: dpPhone.trim(),
      representativeName: dpRep.trim(),
      registrationNumber: dpReg.trim(),
      transportOfficeContact: dpTransport.trim(),
      extraNotes: dpExtra.trim(),
      certificationAuthorityName: dpCertAuthority.trim(),
      mainOfficeName: dpMainOfficeName.trim(),
      mainOfficeAddress: dpMainOfficeAddress.trim(),
      publicSafetySubmissionAddressee: dpPublicSafety.trim(),
      safeDrivingManagerName: dpSafeManager.trim(),
      alcoholDetectorModelName: dpAlcoholModel.trim(),
      inspectionDoneYesNo: dpInspectionYn.trim(),
      inspectionDateYmd: dpInspectionDate.trim(),
    };
    const cleanedDp: Record<string, string> = {};
    for (const [k, v] of Object.entries(dispatchProfile)) {
      if (v) cleanedDp[k] = v;
    }
    customJson.dispatchProfile = cleanedDp;

    const henko: Record<string, string> = {
      submittedOnYmd: hkSubmitted.trim(),
      mutualAidPeriodOld: hkMutualOld.trim(),
      mutualAidPeriodNew: hkMutualNew.trim(),
      changeEffectiveOnYmd: hkEffective.trim(),
      changeReasonDetail: hkReason.trim(),
    };
    const mutualAidPeriodStr = [sgContractFrom.trim(), sgContractTo.trim()].filter(Boolean).join(" ～ ");
    const songai: Record<string, string> = {
      mutualAidContractPeriod: mutualAidPeriodStr,
      vehicleKyousaiLimitManYen: sgLimit.trim(),
      vehicleApprovalNumber: sgApprNo.trim(),
      vehicleApprovedOnYmd: sgApprDate.trim(),
      incidentSummary: sgIncident.trim(),
    };
    const nintei: Record<string, string> = {
      bodyOrMemo: ntBody.trim(),
    };
    const cleanSection = (o: Record<string, string>): Record<string, string> | undefined => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) {
        if (v) out[k] = v;
      }
      return Object.keys(out).length ? out : undefined;
    };
    const dfOut: Record<string, Record<string, string>> = {};
    const h = cleanSection(henko);
    const s = cleanSection(songai);
    const n = cleanSection(nintei);
    if (h) dfOut.henko = h;
    if (s) dfOut.songai = s;
    if (n) dfOut.nintei = n;
    if (Object.keys(dfOut).length) customJson.documentForms = dfOut;
    else delete customJson.documentForms;

    const r = await apiFetch<Row>("/tenant-settings", {
      method: "PATCH",
      json: {
        businessDayRollHour: Number(hour),
        featureFlags,
        customJson,
        legalTradeName: dpTradeName.trim() || null,
        legalRepresentativeName: dpRep.trim() || null,
        legalBusinessAddress: dpAddress.trim() || null,
        legalPhone: dpPhone.trim() || null,
        legalPublicSafetyCommission: dpPublicSafety.trim() || dpCertAuthority.trim() || null,
        legalCertificationNumber: dpReg.trim() || null,
        legalMainOfficeName: dpMainOfficeName.trim() || null,
        legalMainOfficeAddress: dpMainOfficeAddress.trim() || null,
        legalSafetyManagerName: dpSafeManager.trim() || null,
        legalAlcoholDetectorModel: dpAlcoholModel.trim() || null,
        legalAlcoholInspectionDone:
          dpInspectionYn.trim() === ""
            ? null
            : dpInspectionYn.trim() === "有" || dpInspectionYn.trim().toLowerCase() === "yes",
        legalAlcoholInspectionDate: dpInspectionDate.trim() || null,
        legalCertificationDate: legalCertDate.trim() || null,
        legalMutualAidOrganizationName: legalMutualAidOrg.trim() || null,
        legalMutualAidContractFrom: sgContractFrom.trim() || null,
        legalMutualAidContractTo: sgContractTo.trim() || null,
        legalVehicleCoverageLimitManYen: sgLimit.trim() || null,
        legalBodilyCoverage: legalBodilyCoverageText.trim() || null,
        legalPropertyCoverage: legalPropertyCoverageText.trim() || null,
      },
    });
    if (!r.ok) setErr(r.error);
    else {
      setRow(r.data);
      setFlagsText(JSON.stringify(r.data.featureFlags ?? {}, null, 2));
      const cj = (r.data.customJson ?? {}) as Record<string, unknown>;
      setCustomText(JSON.stringify(cj, null, 2));
      const dp = readDp(cj);
      setDpTradeName(r.data.legalTradeName ?? dp.tradeName);
      setDpAddress(r.data.legalBusinessAddress ?? dp.businessAddress);
      setDpPhone(r.data.legalPhone ?? dp.phone);
      setDpRep(r.data.legalRepresentativeName ?? dp.representativeName);
      setDpReg(r.data.legalCertificationNumber ?? dp.registrationNumber);
      setDpTransport(dp.transportOfficeContact);
      setDpExtra(dp.extraNotes);
      setDpCertAuthority(r.data.legalPublicSafetyCommission ?? dp.certificationAuthorityName);
      setDpMainOfficeName(r.data.legalMainOfficeName ?? dp.mainOfficeName);
      setDpMainOfficeAddress(r.data.legalMainOfficeAddress ?? dp.mainOfficeAddress);
      setDpPublicSafety(r.data.legalPublicSafetyCommission ?? dp.publicSafetySubmissionAddressee);
      setDpSafeManager(r.data.legalSafetyManagerName ?? dp.safeDrivingManagerName);
      setDpAlcoholModel(r.data.legalAlcoholDetectorModel ?? dp.alcoholDetectorModelName);
      setDpInspectionYn(
        r.data.legalAlcoholInspectionDone === null
          ? dp.inspectionDoneYesNo
          : r.data.legalAlcoholInspectionDone
            ? "有"
            : "無",
      );
      setDpInspectionDate(asYmd(r.data.legalAlcoholInspectionDate) || dp.inspectionDateYmd);
      const df = readDf(cj);
      setHkSubmitted(df.henko.submittedOnYmd ?? "");
      setHkMutualOld(df.henko.mutualAidPeriodOld ?? "");
      setHkMutualNew(df.henko.mutualAidPeriodNew ?? "");
      setHkEffective(df.henko.changeEffectiveOnYmd ?? "");
      setHkReason(df.henko.changeReasonDetail ?? "");
      setLegalCertDate(asYmd(r.data.legalCertificationDate));
      setLegalMutualAidOrg(r.data.legalMutualAidOrganizationName ?? "");
      setSgContractFrom(asYmd(r.data.legalMutualAidContractFrom));
      setSgContractTo(asYmd(r.data.legalMutualAidContractTo));
      setLegalBodilyCoverageText(r.data.legalBodilyCoverage ?? "");
      setLegalPropertyCoverageText(r.data.legalPropertyCoverage ?? "");
      setSgLimit(r.data.legalVehicleCoverageLimitManYen ?? df.songai.vehicleKyousaiLimitManYen ?? "");
      setSgApprNo(df.songai.vehicleApprovalNumber ?? "");
      setSgApprDate(df.songai.vehicleApprovedOnYmd ?? "");
      setSgIncident(df.songai.incidentSummary ?? "");
      setNtBody(df.nintei.bodyOrMemo ?? "");
    }
  }

  if (!row && !err) return <p>読み込み中…</p>;

  return (
    <Card title="テナント設定">
      <Err msg={err} />
      {row ? (
        <form onSubmit={(e) => void save(e)}>
          <label>事業日切替時刻（0–23 時）</label>
          <input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(e.target.value)} />
          <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>届出・帳票用プロファイル（dispatchProfile）</h3>
          <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
            帳票9種の自動埋めに使います。未入力は空欄のまま出力されます。
          </p>
          <label>商号・屋号</label>
          <input value={dpTradeName} onChange={(e) => setDpTradeName(e.target.value)} />
          <label>本店・事業所所在地</label>
          <textarea rows={2} value={dpAddress} onChange={(e) => setDpAddress(e.target.value)} style={{ width: "100%" }} />
          <label>主たる事務所の名称</label>
          <input value={dpMainOfficeName} onChange={(e) => setDpMainOfficeName(e.target.value)} />
          <label>主たる事務所の所在地</label>
          <textarea
            rows={2}
            value={dpMainOfficeAddress}
            onChange={(e) => setDpMainOfficeAddress(e.target.value)}
            style={{ width: "100%" }}
          />
          <label>電話番号</label>
          <input value={dpPhone} onChange={(e) => setDpPhone(e.target.value)} />
          <label>代表者氏名</label>
          <input value={dpRep} onChange={(e) => setDpRep(e.target.value)} />
          <label>届出・認定番号など</label>
          <input value={dpReg} onChange={(e) => setDpReg(e.target.value)} />
          <label>認定年月日（DB: legalCertificationDate）</label>
          <input type="date" value={legalCertDate} onChange={(e) => setLegalCertDate(e.target.value)} />
          <label>認定を受けた公安委員会（認定帳票用）</label>
          <input value={dpCertAuthority} onChange={(e) => setDpCertAuthority(e.target.value)} />
          <label>変更届の提出先（例: ○○県公安委員会 殿）</label>
          <input value={dpPublicSafety} onChange={(e) => setDpPublicSafety(e.target.value)} />
          <label>運行管理者（氏名・乗務記録帳票用）</label>
          <input value={dpSafeManager} onChange={(e) => setDpSafeManager(e.target.value)} />
          <label>アルコール検知器の型式</label>
          <input value={dpAlcoholModel} onChange={(e) => setDpAlcoholModel(e.target.value)} />
          <label>点検の実施の有無（有 / 無 など）</label>
          <input value={dpInspectionYn} onChange={(e) => setDpInspectionYn(e.target.value)} />
          <label>点検実施日（YYYY-MM-DD など）</label>
          <input value={dpInspectionDate} onChange={(e) => setDpInspectionDate(e.target.value)} />
          <label>運輸支局・連絡</label>
          <textarea rows={2} value={dpTransport} onChange={(e) => setDpTransport(e.target.value)} style={{ width: "100%" }} />
          <label>その他備考（誓約文面の追記など）</label>
          <textarea rows={3} value={dpExtra} onChange={(e) => setDpExtra(e.target.value)} style={{ width: "100%" }} />

          <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>帳票専用入力（documentForms）</h3>
          <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>変更届・損害届・認定の記載欄です。</p>
          <h4 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.35rem" }}>変更届（henko）</h4>
          <label>提出年月日</label>
          <input value={hkSubmitted} onChange={(e) => setHkSubmitted(e.target.value)} placeholder="YYYY-MM-DD" />
          <label>変更の効力が生ずる日</label>
          <input value={hkEffective} onChange={(e) => setHkEffective(e.target.value)} />
          <label>協定組合 加入期間（変更前）</label>
          <input value={hkMutualOld} onChange={(e) => setHkMutualOld(e.target.value)} />
          <label>協定組合 加入期間（変更後）</label>
          <input value={hkMutualNew} onChange={(e) => setHkMutualNew(e.target.value)} />
          <label>変更の内容・理由</label>
          <textarea rows={4} value={hkReason} onChange={(e) => setHkReason(e.target.value)} style={{ width: "100%" }} />
          <h4 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.35rem" }}>損害てん補・協定（テナントDB列）</h4>
          <label>協定組合の名称（legalMutualAidOrganizationName）</label>
          <input value={legalMutualAidOrg} onChange={(e) => setLegalMutualAidOrg(e.target.value)} style={{ width: "100%", maxWidth: 480 }} />
          <label>協定組合の契約期間・開始日</label>
          <input type="date" value={sgContractFrom} onChange={(e) => setSgContractFrom(e.target.value)} />
          <label>協定組合の契約期間・終了日</label>
          <input type="date" value={sgContractTo} onChange={(e) => setSgContractTo(e.target.value)} />
          <label>対人賠償責任保険の補償限度額（例: 無制限）</label>
          <input value={legalBodilyCoverageText} onChange={(e) => setLegalBodilyCoverageText(e.target.value)} style={{ width: "100%", maxWidth: 480 }} />
          <label>対物賠償責任保険の補償限度額（例: 1億円）</label>
          <input value={legalPropertyCoverageText} onChange={(e) => setLegalPropertyCoverageText(e.target.value)} style={{ width: "100%", maxWidth: 480 }} />
          <h4 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.35rem" }}>損害てん補届（documentForms.songai）</h4>
          <label>車両共済の限度額（万円）</label>
          <input value={sgLimit} onChange={(e) => setSgLimit(e.target.value)} />
          <label>車両の認定番号</label>
          <input value={sgApprNo} onChange={(e) => setSgApprNo(e.target.value)} />
          <label>車両の認定年月日</label>
          <input value={sgApprDate} onChange={(e) => setSgApprDate(e.target.value)} />
          <label>事故・損害の経過・内容</label>
          <textarea rows={4} value={sgIncident} onChange={(e) => setSgIncident(e.target.value)} style={{ width: "100%" }} />
          <h4 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.35rem" }}>認定（nintei）</h4>
          <label>認定の内容・記載</label>
          <textarea rows={6} value={ntBody} onChange={(e) => setNtBody(e.target.value)} style={{ width: "100%" }} />

          <label>featureFlags（JSON）</label>
          <textarea rows={6} value={flagsText} onChange={(e) => setFlagsText(e.target.value)} style={{ width: "100%" }} />
          <label>customJson（上記以外の拡張・上書き用。保存時に dispatchProfile / documentForms が合成されます）</label>
          <textarea rows={6} value={customText} onChange={(e) => setCustomText(e.target.value)} style={{ width: "100%" }} />
          <button type="submit">保存</button>
        </form>
      ) : null}
    </Card>
  );
}
