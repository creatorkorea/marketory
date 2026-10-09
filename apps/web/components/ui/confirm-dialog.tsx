"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./button";
export function ConfirmDialog({
  title,
  children,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    cancel.current?.focus();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={id}
      aria-describedby={`${id}-body`}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={id}>{title}</h2>
      <div id={`${id}-body`}>{children}</div>
      <div className="actions">
        <Button ref={cancel} variant="secondary" onClick={onCancel}>
          돌아가기
        </Button>
        <Button onClick={onConfirm}>{confirm}</Button>
      </div>
    </dialog>
  );
}
