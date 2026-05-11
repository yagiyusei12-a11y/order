import type { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="card">
      {title ? <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Err({ msg }: { msg: string | null }): JSX.Element | null {
  if (!msg) return null;
  return <p className="err">{msg}</p>;
}
