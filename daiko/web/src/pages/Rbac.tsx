import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { Card, Err } from "../ui";

type Role = { id: string; name: string; permissions: unknown };
type UserRow = { id: string; email: string; displayName: string | null; roles: { id: string; name: string }[] };

export default function Rbac(): JSX.Element {
  const { can } = useAuth();
  const manage = can("rbac.manage");
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPerms, setNewPerms] = useState("tenant.settings\npayroll.unlock");
  const [assignRole, setAssignRole] = useState<Record<string, string>>({});

  async function loadRoles(): Promise<void> {
    const r = await apiFetch<{ roles: Role[] }>("/roles");
    if (r.ok) setRoles(r.data.roles);
    else setErr(r.error);
  }

  async function loadUsers(): Promise<void> {
    if (!manage) return;
    const r = await apiFetch<{ users: UserRow[] }>("/users");
    if (!r.ok) {
      setUsers(null);
      setUsersErr(r.error);
      return;
    }
    setUsersErr(null);
    setUsers(r.data.users);
  }

  useEffect(() => {
    void (async () => {
      await loadRoles();
      if (manage) await loadUsers();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回と manage 切替のみで十分
  }, [manage]);

  async function createRole(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!manage) return;
    setErr(null);
    const permissions = newPerms
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await apiFetch<Role>("/roles", { method: "POST", json: { name: newName.trim(), permissions } });
    if (!r.ok) setErr(r.error);
    else {
      setNewName("");
      await loadRoles();
    }
  }

  async function delRole(id: string, name: string): Promise<void> {
    if (!manage || !confirm(`ロール「${name}」を削除しますか？`)) return;
    setErr(null);
    const r = await apiFetch(`/roles/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await loadRoles();
  }

  async function assign(userId: string): Promise<void> {
    if (!manage) return;
    const roleId = assignRole[userId];
    if (!roleId) return;
    setErr(null);
    const r = await apiFetch(`/users/${userId}/roles`, { method: "POST", json: { roleId } });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await loadUsers();
  }

  async function removeRole(userId: string, roleId: string): Promise<void> {
    if (!manage) return;
    setErr(null);
    const r = await apiFetch(`/users/${userId}/roles/${roleId}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await loadUsers();
  }

  return (
    <>
      <Card title="ロール一覧">
        <Err msg={err} />
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>権限</th>
              {manage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.name}</td>
                <td>
                  <code style={{ fontSize: "0.75rem" }}>{JSON.stringify(role.permissions)}</code>
                </td>
                {manage ? (
                  <td>
                    {role.name !== "owner" ? (
                      <button type="button" onClick={() => void delRole(role.id, role.name)}>
                        削除
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {manage ? (
        <>
          <Card title="ロール作成">
            <form onSubmit={(e) => void createRole(e)}>
              <label>名前</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
              <label>権限（1 行 1 権限文字列）</label>
              <textarea rows={5} value={newPerms} onChange={(e) => setNewPerms(e.target.value)} style={{ width: "100%" }} />
              <button type="submit">作成</button>
            </form>
          </Card>
          <Card title="ユーザーとロール">
            <Err msg={usersErr} />
            {users ? (
              <table>
                <thead>
                  <tr>
                    <th>メール</th>
                    <th>表示名</th>
                    <th>付与済み</th>
                    <th>追加</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.displayName ?? "—"}</td>
                      <td>
                        {u.roles.map((r) => (
                          <span key={r.id} style={{ marginRight: 6 }}>
                            {r.name}
                            {r.name !== "owner" ? (
                              <button type="button" onClick={() => void removeRole(u.id, r.id)}>
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </td>
                      <td>
                        <select
                          value={assignRole[u.id] ?? ""}
                          onChange={(e) => setAssignRole((m) => ({ ...m, [u.id]: e.target.value }))}
                        >
                          <option value="">ロールを選択</option>
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <button type="button" onClick={() => void assign(u.id)}>
                          付与
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ fontSize: "0.9rem" }}>ユーザー一覧を読み込み中…</p>
            )}
          </Card>
        </>
      ) : (
        <Card title="ユーザー割当">
          <p style={{ fontSize: "0.9rem" }}>ユーザーへのロール付与は rbac.manage が必要です。</p>
        </Card>
      )}
    </>
  );
}
