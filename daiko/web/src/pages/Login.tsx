import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, Err } from "../ui";

export default function Login(): JSX.Element {
  const { login } = useAuth();
  const nav = useNavigate();
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const er = await login(slug.trim(), email.trim(), password);
    if (er) setErr(er);
    else nav("/", { replace: true });
  }

  return (
    <div className="app-main">
      <Card title="ログイン">
        <form onSubmit={(e) => void onSubmit(e)}>
          <label>テナント slug</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} autoComplete="organization" required />
          <label>メール</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>パスワード</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Err msg={err} />
          <button type="submit">ログイン</button>
        </form>
        <p style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
          <Link to="/register">新規テナント登録</Link>
        </p>
      </Card>
    </div>
  );
}
