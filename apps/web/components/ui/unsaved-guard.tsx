"use client";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";
type HistoryNavigation = EventTarget & { traverseTo: (key: string) => unknown };
type HistoryEvent = Event & {
  navigationType: string;
  destination: { key: string; url: string };
  canIntercept: boolean;
};
export function UnsavedGuard({ active }: { active: boolean }) {
  const [href, setHref] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const leaving = useRef(false);
  useEffect(() => {
    if (!active) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!leaving.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      const a = (event.target as Element).closest?.("a");
      if (
        !a ||
        a.target === "_blank" ||
        a.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        a.href === location.href ||
        a.hash
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setHref(a.href);
    };
    // Navigation API cancels same-document Back/Forward before Next unmounts the draft.
    const navigation = (window as unknown as { navigation?: HistoryNavigation })
      .navigation;
    const traverse = (event: Event) => {
      const e = event as HistoryEvent;
      if (
        !leaving.current &&
        e.navigationType === "traverse" &&
        e.canIntercept &&
        e.cancelable
      ) {
        e.preventDefault();
        setHistoryKey(e.destination.key);
        setHref(e.destination.url);
      }
    };
    navigation?.addEventListener("navigate", traverse);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", traverse);
    };
  }, [active]);
  return href ? (
    <ConfirmDialog
      title="이 화면을 나갈까요?"
      confirm="입력을 두고 나가기"
      onCancel={() => {
        setHref(null);
        setHistoryKey(null);
      }}
      onConfirm={() => {
        leaving.current = true;
        if (historyKey)
          (
            window as unknown as { navigation: HistoryNavigation }
          ).navigation.traverseTo(historyKey);
        else location.assign(href);
      }}
    >
      <p>
        저장하지 않은 입력은 사라집니다. 진행 중인 서버 작업은 취소되지 않으며,
        돌아오면 기존 요청 결과부터 확인합니다.
      </p>
    </ConfirmDialog>
  ) : null;
}
