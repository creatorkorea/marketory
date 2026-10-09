"use client";
import { useEffect, useState } from "react";
export function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (hover || focus) return;
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [message, hover, focus, onClose]);
  return (
    <div
      className="toast"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
    >
      <span role="status">{message}</span>
      <button className="text-button" aria-label="알림 닫기" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}
