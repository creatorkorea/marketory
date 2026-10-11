import psycopg
import pytest
from test_p1_p3 import isolated_db  # noqa: F401


def test_booth_tables_private_and_assignment_constraints(isolated_db):  # noqa: F811
    with psycopg.connect(isolated_db) as conn:
        tables = conn.execute(
            "SELECT c.relname,c.relrowsecurity FROM pg_class c "
            "JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND c.relname IN ('booths','booth_assignments') "
            "ORDER BY c.relname"
        ).fetchall()
        assert tables == [("booth_assignments", True), ("booths", True)]
        for role in ("anon", "authenticated"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with conn.transaction():
                    conn.execute(f"SET LOCAL ROLE {role}")
                    conn.execute("SELECT * FROM public.booths")
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with conn.transaction():
                    conn.execute(f"SET LOCAL ROLE {role}")
                    conn.execute("SELECT * FROM public.booth_assignments")
        indexes = " ".join(
            r[0]
            for r in conn.execute(
                "SELECT indexdef FROM pg_indexes WHERE tablename='booth_assignments'"
            )
        )
        assert "UNIQUE" in indexes and "confirmed" in indexes and "released_at IS NULL" in indexes
        fks = conn.execute(
            "SELECT count(*) FROM pg_constraint WHERE conrelid="
            "'public.booth_assignments'::regclass AND contype='f' AND array_length(conkey,1)=2"
        ).fetchone()[0]
        assert fks == 2
