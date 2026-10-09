"""P0 worker process probe. Business queue handlers are added in P3/P5/P7."""

import argparse
import asyncio
import logging
import signal
from collections.abc import Awaitable, Callable

from marketory.config import Settings
from marketory.db import check_database
from marketory.runtime import run_async

logger = logging.getLogger("marketory.worker")


async def run_worker(
    stop: asyncio.Event,
    probe: Callable[[], Awaitable[bool]],
    interval: float,
) -> None:
    while not stop.is_set():
        try:
            healthy = await asyncio.wait_for(probe(), timeout=5)
        except Exception:
            healthy = False
        logger.info(
            "worker_probe database=%s handlers=not_configured",
            "available" if healthy else "unavailable",
        )
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass
    logger.info("worker_stopped")


async def main(once: bool) -> int:
    settings = Settings()
    if once:
        try:
            healthy = await asyncio.wait_for(check_database(settings), timeout=5)
        except Exception:
            healthy = False
        logger.info(
            "worker_probe database=%s handlers=not_configured",
            "available" if healthy else "unavailable",
        )
        return 0 if healthy else 1
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))
    await run_worker(stop, lambda: check_database(settings), settings.worker_poll_seconds)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Check database then exit 0/1")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(run_async(main(args.once)))
