import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`bp-button ${className}`.trim()} {...props} />;
}

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`bp-panel ${className}`.trim()} {...props} />;
}

export function Status({ tone = "neutral", children }: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "danger" }>) {
  return (
    <p className={`bp-status bp-status-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </p>
  );
}
