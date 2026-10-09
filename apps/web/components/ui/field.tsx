import type { ComponentProps } from "react";
import { Input } from "./input";

type Props = ComponentProps<typeof Input> & { id: string; label: string; error?: string; hint?: string };
export function Field({ id, label, error, hint, ...props }: Props) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <Input {...props} id={id} aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} />
    <p id={`${id}-help`} className={`field-help ${error ? "error" : "muted"}`} role={error ? "alert" : undefined}>{error || hint || "\u00a0"}</p>
  </div>;
}
