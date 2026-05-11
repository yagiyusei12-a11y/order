import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../auth";

const links: { to: string; label: string; perm?: string }[] = [
  { to: "/", label: "ホーム" },
  { to: "/employees", label: "従業員" },
  { to: "/vehicles", label: "車両" },
  { to: "/tariffs", label: "料金" },
  { to: "/daily-reports", label: "日報" },
  { to: "/time-punches", label: "勤怠" },
  { to: "/alcohol", label: "酒気" },
  { to: "/payroll", label: "給与" },
  { to: "/documents", label: "帳票" },
  { to: "/settings", label: "設定", perm: "tenant.settings" },
  { to: "/rbac", label: "権限", perm: "rbac.manage" },
  { to: "/legal", label: "法定" },
];

export default function Shell(): JSX.Element {
  const { me, loading, logout, can } = useAuth();
  if (loading) return <div className="app-main">読み込み中…</div>;
  if (!me) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <nav className="app-nav">
        {links
          .filter((l) => !l.perm || can(l.perm))
          .map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              {l.label}
            </NavLink>
          ))}
        <span style={{ marginLeft: "auto", opacity: 0.85 }}>
          {me.tenant.slug} / {me.email}
        </span>
        <button type="button" onClick={logout} style={{ marginTop: 0 }}>
          ログアウト
        </button>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
