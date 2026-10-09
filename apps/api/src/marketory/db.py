from contextlib import asynccontextmanager

import psycopg

from marketory.config import Settings


@asynccontextmanager
async def transaction(settings: Settings):
    """One connection/transaction boundary; commit on exit, rollback on exception."""
    if not settings.database_url:
        raise RuntimeError("Database is not configured")
    async with await psycopg.AsyncConnection.connect(
        settings.database_url.get_secret_value(),
        connect_timeout=3,
        options="-c statement_timeout=15000 -c lock_timeout=5000",
        prepare_threshold=None,
    ) as connection:
        yield connection


async def check_database(settings: Settings) -> bool:
    if not settings.database_url:
        return False
    async with transaction(settings) as connection:
        cursor = await connection.execute("SELECT 1")
        return await cursor.fetchone() == (1,)
