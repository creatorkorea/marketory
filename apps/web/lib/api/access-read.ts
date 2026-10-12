import type { Reply } from "../requests/recovery";

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Only initial account GETs use this. Mutations retain request-result recovery. */
export async function readAccess(
  read: () => Promise<Reply>,
  signal: AbortSignal,
  onRetry?: (attempt: number) => void,
): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await read();
      signal.throwIfAborted();
      if (![502, 503, 504].includes(result.status) || attempt === 2) return result;
    } catch (error) {
      signal.throwIfAborted();
      const temporary = error instanceof TypeError ||
        (error instanceof DOMException && error.name === "TimeoutError");
      if (!temporary || attempt === 2) throw error;
    }
    onRetry?.(attempt + 1);
    await pause(attempt === 0 ? 2000 : 4000, signal);
  }
}
