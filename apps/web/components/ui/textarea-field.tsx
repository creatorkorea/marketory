"use client";
import type { ComponentProps } from "react";
type Props = ComponentProps<"textarea"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};
export function TextareaField({ id, label, hint, error, ...props }: Props) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        {...props}
        id={id}
        className="input resize-none"
        style={{ minHeight: 132 }}
        rows={4}
        aria-invalid={!!error}
        aria-describedby={`${id}-help`}
        onInput={(e) => {
          e.currentTarget.style.height = "auto";
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
        }}
      />
      <p
        id={`${id}-help`}
        className={`field-help ${error ? "error" : "muted"}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}
