import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, Err } from "../ui";

export default function Register(): JSX.Element {
  const { register } = useAuth();
  const nav = useNavigate();
  const [tenantName, setTenantName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const er = await register({
      tenantName: tenantName.trim(),
      slug: slug.trim(),
      email: email.trim(),
      password,
      displayName: displayName.trim() || undefined,
    });
    if (er) setErr(er);
    else nav("/", { replace: true });
  }

  return (
    <div className="app-main">
      <Card title="新規テナント登録">
        <form onSubmit={(e) => void onSubmit(e)}>
          <label>事業者名</label>
          <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
          <label>slug（英小文字・数字・ハイフン）</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <label>メール</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>表示名（任意）</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label>パスワード（8文字以上）</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Err msg={err} />
          <button type="submit">登録してログイン</button>
        </form>
        <p style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
          <Link to="/login">ログインへ</Link>
        </p>
      </Card>
    </div>
  );
}
