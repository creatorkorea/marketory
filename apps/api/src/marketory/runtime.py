"""Psycopg async needs SelectorEventLoop on Windows; no global policy mutation."""

import asyncio
import selectors
import sys
from collections.abc import Coroutine
from typing import Any, TypeVar

T = TypeVar("T")


def run_async(coroutine: Coroutine[Any, Any, T]) -> T:
    factory = (
        (lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()))
        if sys.platform == "win32"
        else asyncio.new_event_loop
    )
    return asyncio.run(coroutine, loop_factory=factory)
