"""Database probe and explicitly enabled communication delivery loop."""

import argparse
import asyncio
import logging
import signal
from collections.abc import Awaitable, Callable
from uuid import UUID

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


async def main(once: bool, communication_id: UUID | None = None) -> int:
    if communication_id is not None and not once:
        raise ValueError("Targeted delivery requires once mode")
    settings = Settings()

    async def dispatch():
        if communication_id is not None:
            # A targeted send must never mutate unrelated stale claims.
            return await process_one(settings, communication_id=communication_id)
        await recover_stale(settings)
        return await process_one(settings)

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
                handled = await dispatch()
                if communication_id is not None:
                    logger.info("worker_target handled=%s", handled)
                    return 0 if handled else 2
            except Exception:
                logger.warning("worker_handler failed")
                return 1
        if healthy and communication_id is not None:
            logger.info("worker_target delivery_disabled")
            return 2
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


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--once",
        action="store_true",
        help="Probe database; when delivery is enabled, recover stale claims and process one item",
    )
    parser.add_argument(
        "--communication-id",
        type=UUID,
        help="With --once, process only this queued message; do not recover stale claims",
    )
    args = parser.parse_args(argv)
    if args.communication_id is not None and not args.once:
        parser.error("--communication-id requires --once")
    return args


if __name__ == "__main__":
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(run_async(main(args.once, args.communication_id)))
