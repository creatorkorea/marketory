"""Synthetic, loopback-only restore rehearsal. Never accepts a production DSN."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api/src"), str(ROOT / "apps/api/tests")]

import psycopg  # noqa: E402
from psycopg import sql  # noqa: E402
from test_applications import client_for, setup  # noqa: E402
from test_booths import action, board, booth_input, confirmed  # noqa: E402
from test_p1_p3 import isolated_db  # noqa: E402
from test_projects import headers  # noqa: E402

LOCAL_DSN = "postgresql://marketory:marketory_local@127.0.0.1:55432/marketory"


def snapshot(dsn):
    result = {}
    with psycopg.connect(dsn) as conn:
        tables = conn.execute(
            "SELECT schemaname,tablename FROM pg_tables "
            "WHERE schemaname IN ('public','auth') ORDER BY 1,2"
        ).fetchall()
        for schema, table in tables:
            rows = conn.execute(
                sql.SQL(
                    "SELECT to_jsonb(t)::text FROM {}.{} t ORDER BY to_jsonb(t)::text"
                ).format(sql.Identifier(schema), sql.Identifier(table))
            ).fetchall()
            digest = hashlib.sha256(json.dumps(rows).encode()).hexdigest()
            result[f"{schema}.{table}"] = {"rows": len(rows), "sha256": digest}
    return result


def run(pg_bin):
    for tool in ("pg_dump.exe", "pg_restore.exe"):
        if not (pg_bin / tool).is_file():
            raise RuntimeError(f"PostgreSQL tool unavailable: {tool}")
    os.environ["MARKETORY_TEST_DATABASE_URL"] = LOCAL_DSN
    os.environ["MARKETORY_EMAIL_DELIVERY_ENABLED"] = "false"
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("PG")}
    env.update(
        PGHOST="127.0.0.1",
        PGPORT="55432",
        PGUSER="marketory",
        PGPASSWORD="marketory_local",
        PGCONNECT_TIMEOUT="10",
    )
    target_name = "marketory_restore_" + uuid4().hex
    target = psycopg.conninfo.make_conninfo(LOCAL_DSN, dbname=target_name)
    output = ROOT / "output" / target_name
    output.mkdir(parents=True, exist_ok=False)
    fixture = isolated_db.__wrapped__()
    source = next(fixture)
    created = False
    started = time.monotonic()
    try:
        staff, seller, pid = setup(source)
        with client_for(source) as c:
            aid = confirmed(c, source, seller, pid)
            current = board(c, staff, pid)
            response = c.post(
                f"/api/projects/{pid}/booths",
                headers=headers(staff),
                json=booth_input(current["project"]["version"]),
            )
            assert response.status_code == 201, response.text
            current = response.json()["data"]
            response = action(
                c,
                staff,
                pid,
                "booth-draft",
                current["project"]["version"],
                items=[
                    dict(
                        application_id=aid,
                        booth_id=current["booths"][0]["booth_id"],
                        expected_application_version=4,
                    )
                ],
            )
            assert response.status_code == 200, response.text
            response = action(
                c,
                staff,
                pid,
                "booth-confirm",
                response.json()["data"]["project"]["version"],
            )
            assert response.status_code == 200, response.text
        before = snapshot(source)
        archive = output / "synthetic.dump"
        source_name = psycopg.conninfo.conninfo_to_dict(source)["dbname"]
        subprocess.run(
            [
                str(pg_bin / "pg_dump.exe"),
                "--format=custom",
                "--no-owner",
                "--file",
                str(archive),
                "--dbname",
                source_name,
            ],
            env=env,
            check=True,
            capture_output=True,
            timeout=120,
        )
        with psycopg.connect(LOCAL_DSN, autocommit=True) as conn:
            conn.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target_name))
            )
            created = True
        restore_started = time.monotonic()
        subprocess.run(
            [
                str(pg_bin / "pg_restore.exe"),
                "--exit-on-error",
                "--single-transaction",
                "--no-owner",
                "--dbname",
                target_name,
                str(archive),
            ],
            env=env,
            check=True,
            capture_output=True,
            timeout=120,
        )
        restore_seconds = round(time.monotonic() - restore_started, 3)
        assert snapshot(target) == before, "Restored rows differ from source"
        with psycopg.connect(target) as conn:
            try:
                with conn.transaction():
                    conn.execute("SET LOCAL ROLE authenticated")
                    conn.execute("SELECT * FROM public.applications")
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError(
                    "Direct authenticated table access was not blocked"
                )
        with client_for(target) as c:
            detail = c.get(f"/api/applications/{aid}", headers=headers(seller))
            assert detail.status_code == 200
            data = detail.json()["data"]
            assert data["status"] == "CONFIRMED" and data["booth"]["booth_no"] == "A01"
            assert (
                c.get(f"/api/applications/{aid}", headers=headers(staff)).status_code
                == 404
            )
            cancelled = c.post(
                f"/api/applications/{aid}/cancel",
                headers=headers(seller),
                json={"expected_version": data["version"], "reason": "복원 검증"},
            )
            assert cancelled.status_code == 200, cancelled.text
            assert board(c, staff, pid)["assignments"] == []
        assert snapshot(source) == before, "Restore rehearsal changed source"
        report = dict(
            status="PASS",
            checked_at=datetime.now(timezone.utc).isoformat(),
            scope="Synthetic local PostgreSQL only; no hosted Auth or Storage objects",
            tables=before,
            restore_seconds=restore_seconds,
            total_seconds=round(time.monotonic() - started, 3),
            archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
            checks=[
                "all table rows match",
                "direct authenticated access denied",
                "owner API and booth projection",
                "non-owner API denied",
                "restored cancellation releases booth",
                "source unchanged",
            ],
        )
        (output / "result.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        print(
            json.dumps(
                {
                    "status": "PASS",
                    "report": str(output / "result.json"),
                    "restore_seconds": restore_seconds,
                }
            )
        )
    finally:
        if created:
            # Only this invocation's generated database is eligible for cleanup.
            with psycopg.connect(LOCAL_DSN, autocommit=True) as conn:
                conn.execute(
                    sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                        sql.Identifier(target_name)
                    )
                )
        fixture.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pg-bin", type=Path, default=Path("C:/Program Files/PostgreSQL/17/bin")
    )
    args = parser.parse_args()
    run(args.pg_bin)
