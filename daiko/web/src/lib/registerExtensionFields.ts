/**
 * Employee.registerExtension のキーとラベル（バックエンド registerExtensionSchema と同期すること）
 */
export const REGISTER_EXTENSION_UI_FIELDS: { key: string; label: string }[] = [
  { key: "gender", label: "性別" },
  { key: "postalCode", label: "郵便番号" },
  { key: "dateOfBirthYmd", label: "生年月日（YYYY-MM-DD）" },
  { key: "phoneHome", label: "電話（自宅）" },
  { key: "phoneMobile", label: "電話（携帯）" },
  { key: "emergencyContactName", label: "緊急連絡先 氏名" },
  { key: "emergencyPhone", label: "緊急連絡先 電話" },
  { key: "emergencyAddress", label: "緊急連絡先 住所" },
  { key: "emergencyRelation", label: "緊急連絡先 続柄" },
  { key: "hiredOnYmd", label: "採用年月日" },
  { key: "retiredOnYmd", label: "退職年月日（名簿記録）" },
  { key: "employmentType", label: "採用区分" },
  { key: "interviewerName", label: "面接担当者名" },
  { key: "jobCategory", label: "職種" },
  { key: "licenseTypes", label: "免許の種類" },
  { key: "licenseNumber", label: "免許証の番号" },
  { key: "licenseExpiresOnYmd", label: "免許有効期限" },
  { key: "licenseConditionsNote", label: "免許の条件等" },
  { key: "pledgeSignedOnYmd", label: "誓約日" },
  { key: "educationNotes", label: "教育・講習の記録" },
  { key: "rosterNotes", label: "名簿備考" },
];
