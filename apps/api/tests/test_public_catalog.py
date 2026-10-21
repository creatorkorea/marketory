from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
from test_p1_p3 import isolated_db, seed  # noqa: F401
from test_projects import client_for


def test_public_catalog_excludes_unavailable_and_private_fields(isolated_db):  # noqa: F811
    actor, _, _ = seed(isolated_db)
    now = datetime.now(timezone.utc)
    visible = []
    with psycopg.connect(isolated_db) as conn:
        for name, status, start, end, deleted in [
            ("open-first", "RECRUITING", -1, 1, False),
            ("open-second", "RECRUITING", -1, 2, False),
            ("draft", "DRAFT", -1, 1, False),
            ("future", "RECRUITING", 1, 2, False),
            ("expired", "RECRUITING", -2, -1, False),
            ("reviewing", "REVIEWING", -1, 1, False),
            ("closed", "CLOSED", -1, 1, False),
            ("completed", "COMPLETED", -1, 1, False),
            ("deleted", "RECRUITING", -1, 1, True),
        ]:
            pid = uuid4()
            if name.startswith("open"):
                visible.append(str(pid))
            conn.execute(
                "INSERT INTO public.projects(project_id,name,venue,event_date,"
                "recruit_start_at,recruit_end_at,event_end_at,target_team_count,"
                "status,policy_json,evaluation_policy_json,created_by,deleted_at) "
                "VALUES (%s,%s,'광장',%s,%s,%s,%s,10,%s,"
                '\'{"allowed_categories":["공예"],"participation_fee_krw":0}\','
                '\'{"internal":"private"}\',%s,%s)',
                (
                    pid,
                    name,
                    (now + timedelta(days=3)).date(),
                    now + timedelta(days=start),
                    now + timedelta(days=end),
                    now + timedelta(days=3),
                    status,
                    actor,
                    now if deleted else None,
                ),
            )
    with client_for(isolated_db) as c:
        response = c.get("/api/public/projects?limit=1")
        assert response.status_code == 200
        body = response.json()
        assert body["has_more"] is True
        assert [p["project_id"] for p in body["data"]] == visible[:1]
        assert set(body["data"][0]) == {
            "project_id",
            "name",
            "venue",
            "event_date",
            "recruit_end_at",
            "allowed_categories",
            "participation_fee_krw",
        }
        second = c.get("/api/public/projects?limit=1&offset=1").json()
        assert [p["project_id"] for p in second["data"]] == visible[1:]
        assert second["has_more"] is False
        assert c.get("/api/public/projects?offset=2").json()["data"] == []
        for query in ("limit=0", "limit=51", "offset=-1"):
            assert c.get(f"/api/public/projects?{query}").status_code == 422
        # Closing recruitment immediately removes the market from discovery.
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET status='REVIEWING' WHERE project_id=%s", (visible[0],)
            )
        assert [p["project_id"] for p in c.get("/api/public/projects").json()["data"]] == visible[
            1:
        ]
