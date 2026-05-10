import type { Prisma } from "@prisma/client";

/**
 * ネットテイクアウト用卓の publicCode。
 * 旧実装は storeId の先頭12文字のみで別店と衝突しうるため、新規作成はフル ID を使う。
 */
export function takeoutTablePrimaryPublicCode(storeId: string): string {
  return `takeout-${storeId}`;
}

/** 既存 DB に残る可能性のある旧コード（先頭12桁） */
export function takeoutTableLegacyPublicCode(storeId: string): string {
  return `takeout-${storeId.slice(0, 12)}`;
}

/** 当該店舗のテイクアウト卓を特定する where（必ず storeId で絞る） */
export function takeoutTableWhereForStore(storeId: string): Prisma.TableWhereInput {
  const primary = takeoutTablePrimaryPublicCode(storeId);
  const legacy = takeoutTableLegacyPublicCode(storeId);
  return {
    storeId,
    OR: [{ publicCode: primary }, { publicCode: legacy }],
  };
}

/** 卓の publicCode が当該店舗のテイクアウト用か（店内卓のバッシング工程とは無関係） */
export function isTakeoutTablePublicCode(publicCode: string | null | undefined, storeId: string): boolean {
  const pc = String(publicCode ?? "").trim();
  return pc === takeoutTablePrimaryPublicCode(storeId) || pc === takeoutTableLegacyPublicCode(storeId);
}
