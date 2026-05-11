import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Block = { title: string; path: string; kind: string; err: string | null; items: unknown[]; note?: string };

const ROUTES: { title: string; path: string; kind: string }[] = [
  { title: "苦情", path: "/legal/complaints", kind: "complaint" },
  { title: "指導", path: "/legal/guidance", kind: "guidance" },
  { title: "名簿", path: "/legal/roster", kind: "roster" },
];

export default function Legal(): JSX.Element {
  const [blocks, setBlocks] = useState<Block[]>(() =>
    ROUTES.map((r) => ({ ...r, err: null, items: [] as unknown[] })),
  );

  useEffect(() => {
    void (async () => {
      const next: Block[] = [];
      for (const b of ROUTES) {
        const r = await apiFetch<{ items: unknown[]; note?: string }>(b.path);
        if (!r.ok) next.push({ ...b, err: r.error, items: [] });
        else next.push({ ...b, err: null, items: r.data.items ?? [], note: r.data.note });
      }
      setBlocks(next);
    })();
  }, []);

  return (
    <>
      {blocks.map((b) => (
        <Card key={b.path} title={`法定（スタブ）: ${b.title}`}>
          <Err msg={b.err} />
          {b.note ? <p style={{ fontSize: "0.85rem" }}>{b.note}</p> : null}
          <p style={{ fontSize: "0.85rem" }}>
            kind: <code>{b.kind}</code> / 件数: {b.items.length}
          </p>
          {b.items.length > 0 ? (
            <pre style={{ fontSize: "0.75rem", overflow: "auto" }}>{JSON.stringify(b.items, null, 2)}</pre>
          ) : (
            !b.err && <p>データなし</p>
          )}
        </Card>
      ))}
    </>
  );
}
