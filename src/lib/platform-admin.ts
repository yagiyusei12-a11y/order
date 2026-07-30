/** プラットフォーム管理者（全店舗の追加・一覧）のメール許可リスト */

export function platformAdminEmails(): string[] {
  const raw = process.env.ORDER_PLATFORM_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminEmail(email: string): boolean {
  const list = platformAdminEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
