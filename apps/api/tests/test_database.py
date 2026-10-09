"""Opt-in: dedicated disposable local/CI database only."""

import os

import pytest

from marketory.config import Settings
from marketory.db import check_database, transaction
from marketory.runtime import run_async


@pytest.mark.skipif(
    not os.getenv("MARKETORY_TEST_DATABASE_URL"), reason="Local test DB not configured"
)
def test_database_commit_rollback_and_probe():
    async def scenario():
        config = Settings(database_url=os.environ["MARKETORY_TEST_DATABASE_URL"])
        # TEMP objects stay on one connection and never modify application schemas.
        async with transaction(config) as connection:
            await connection.execute("CREATE TEMP TABLE p0_probe (id integer PRIMARY KEY)")
            await connection.commit()
            async with connection.transaction():
                await connection.execute("INSERT INTO p0_probe VALUES (1)")
            with pytest.raises(RuntimeError):
                async with connection.transaction():
                    await connection.execute("INSERT INTO p0_probe VALUES (2)")
                    raise RuntimeError("force rollback")
            result = await connection.execute("SELECT id FROM p0_probe ORDER BY id")
            assert await result.fetchall() == [(1,)]
        assert await check_database(config)

    run_async(scenario())
