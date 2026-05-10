/** セッション内で最も早い SalesOrder（テイクアウト照合などに使用） */
export function firstSalesOrderByTime(
  orders: { id: string; createdAt: Date }[] | undefined,
): { id: string; createdAt: Date } | null {
  if (!orders?.length) return null;
  return orders.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
}
