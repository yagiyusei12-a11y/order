function log(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

async function refreshStats() {
  log("");
  try {
    const base = "/stores/" + encodeURIComponent(STORE);
    const [sess, kit, tbl] = await Promise.all([
      api(base + "/sessions?status=open"),
      api(base + "/kitchen/order-lines"),
      api(base + "/tables"),
    ]);
    const open = (sess.sessions && sess.sessions.length) || 0;
    const klines = (kit.lines && kit.lines.length) || 0;
    const tables = (tbl.tables && tbl.tables.filter((t) => t.active).length) || 0;
    document.getElementById("statOpen").textContent = "開店セッション " + open;
    document.getElementById("statKit").textContent = "キッチン明細（提供前） " + klines;
    document.getElementById("statTables").textContent = "有効卓 " + tables;
  } catch (e) {
    log(String(e.message || e));
  }
}

document.getElementById("btnDashRef").onclick = () => {
  refreshStats().catch((e) => log(String(e.message || e)));
};

refreshStats().catch((e) => log(String(e.message || e)));
