"use client";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/notice";

export function AccessLoading({ title, retrying }: { title: string; retrying: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  return <Notice title={retrying ? "연결을 다시 확인하고 있어요." : title}>
    {slow || retrying
      ? "연결에 시간이 걸리고 있어요. 잠시 기다려 주세요. 자동 확인 후에도 연결되지 않으면 다시 시도할 수 있습니다."
      : "계정과 이용 권한을 확인합니다."}
  </Notice>;
}
