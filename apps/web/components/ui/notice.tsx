import type { ReactNode } from "react";

export function Notice({ title, children, tone = "info" }: { title: string; children?: ReactNode; tone?: "info" | "warning" | "danger" }) {
  return <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
    <p className="notice-title">{title}</p>{children && <div className="notice-body">{children}</div>}
  </div>;
}
