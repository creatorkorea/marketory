"""Database probe and explicitly enabled communication delivery loop."""

import argparse
import asyncio
import logging
import signal
from collections.abc import Awaitable, Callable

from marketory.communication_worker import process_one, recover_stale
from marketory.config import Settings
from marketory.db import check_database
from marketory.runtime import run_async

logger = logging.getLogger("marketory.worker")


async def run_worker(
    stop: asyncio.Event,
    probe: Callable[[], Awaitable[bool]],
    interval: float,
    handler: Callable[[], Awaitable[None]] | None = None,
) -> None:
    while not stop.is_set():
        try:
            healthy = await asyncio.wait_for(probe(), timeout=5)
        except Exception:
            healthy = False
        logger.info(
            "worker_probe database=%s",
            "available" if healthy else "unavailable",
        )
        if healthy and handler is not None and not stop.is_set():
            try:
                await handler()
            except Exception:
                # Do not interpolate exceptions: provider/DB errors may contain secrets.
                logger.warning("worker_handler failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass
    logger.info("worker_stopped")


async def main(once: bool) -> int:
    settings = Settings()

    async def dispatch():
        await recover_stale(settings)
        await process_one(settings)

    if once:
        try:
            healthy = await asyncio.wait_for(check_database(settings), timeout=5)
        except Exception:
            healthy = False
        logger.info(
            "worker_probe database=%s",
            "available" if healthy else "unavailable",
        )
        if healthy and settings.email_delivery_enabled:
            try:
                await dispatch()
            except Exception:
                logger.warning("worker_handler failed")
                return 1
        return 0 if healthy else 1
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))
    await run_worker(
        stop,
        lambda: check_database(settings),
        settings.worker_poll_seconds,
        dispatch if settings.email_delivery_enabled else None,
    )
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--once",
        action="store_true",
        help="Probe database; when delivery is enabled, recover stale claims and process one item",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(run_async(main(args.once)))
