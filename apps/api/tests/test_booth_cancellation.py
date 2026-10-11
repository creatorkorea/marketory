from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest
from test_applications import client_for, setup
from test_booths import action, board, booth_input, confirmed
from test_confirmation import approved
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers


def test_owner_booth_projection_and_atomic_cancellation(isolated_db):  # noqa: F811
    staff, seller, project = setup(isolated_db)
    with client_for(isolated_db) as client:
        aid = approved(client, isolated_db, seller, project)
        assert (
            client.post(
                f"/api/applications/{aid}/confirm",
                headers=headers(seller),
                json={"expected_version": 3},
            ).status_code
            == 200
        )
        booth, assignment = uuid4(), uuid4()
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "INSERT INTO public.booths(booth_id,project_id,booth_no,zone,note) "
                "VALUES(%s,%s,'A01','중앙','내부 연락 메모')",
                (booth, project),
            )
            conn.execute(
                "INSERT INTO public.booth_assignments(assignment_id,project_id,booth_id,"
                "application_id,source,assigned_by,confirmed,confirmed_at,"
                "input_application_version,input_booth_version,operation_id) "
                "VALUES(%s,%s,%s,%s,'MANUAL',%s,true,now(),4,1,%s)",
                (assignment, project, booth, aid, staff, uuid4()),
            )
            conn.execute(
                "INSERT INTO public.booth_assignments(project_id,booth_id,application_id,"
                "source,assigned_by,input_application_version,input_booth_version,operation_id) "
                "VALUES(%s,%s,%s,'MANUAL',%s,4,1,%s)",
                (project, booth, aid, staff, uuid4()),
            )
            before = conn.execute(
                "SELECT version FROM public.projects WHERE project_id=%s",
                (project,),
            ).fetchone()[0]
        data = client.get(f"/api/applications/{aid}", headers=headers(seller)).json()["data"]
        assert data["booth"]["booth_no"] == "A01"
        assert "note" not in data["booth"] and "assigned_by" not in data["booth"]
        h = headers(seller)
        body = {"expected_version": 4, "reason": "참가 일정 변경"}
        cancelled = client.post(f"/api/applications/{aid}/cancel", headers=h, json=body)
        assert cancelled.status_code == 200
        assert cancelled.json()["data"]["booth"] is None
        assert (
            client.post(
                f"/api/applications/{aid}/cancel",
                headers=h,
                json=body,
            ).json()
            == cancelled.json()
        )
        with psycopg.connect(isolated_db) as conn:
            assert (
                conn.execute(
                    "SELECT count(*) FROM public.booth_assignments WHERE application_id=%s "
                    "AND released_at IS NULL",
                    (aid,),
                ).fetchone()[0]
                == 0
            )
            row = conn.execute(
                "SELECT released_by,release_reason,version FROM public.booth_assignments "
                "WHERE assignment_id=%s AND released_at IS NOT NULL",
                (assignment,),
            ).fetchone()
            assert str(row[0]) == str(seller) and row[1] == body["reason"] and row[2] == 2
            assert (
                conn.execute(
                    "SELECT version FROM public.projects WHERE project_id=%s",
                    (project,),
                ).fetchone()[0]
                == before + 1
            )
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute(
                        "UPDATE public.booth_assignments SET reason='덮어쓰기' "
                        "WHERE assignment_id=%s",
                        (assignment,),
                    )


def test_cancel_and_saved_draft_confirm_race(isolated_db):  # noqa: F811
    staff, seller, pid = setup(isolated_db)
    with client_for(isolated_db) as c:
        aid = confirmed(c, isolated_db, seller, pid)
        data = board(c, staff, pid)
        data = c.post(
            f"/api/projects/{pid}/booths",
            headers=headers(staff),
            json=booth_input(data["project"]["version"]),
        ).json()["data"]
        r = action(
            c,
            staff,
            pid,
            "booth-draft",
            data["project"]["version"],
            items=[
                {
                    "application_id": aid,
                    "booth_id": data["booths"][0]["booth_id"],
                    "expected_application_version": 4,
                }
            ],
        )
        assert r.status_code == 200
        version = r.json()["data"]["project"]["version"]
        with ThreadPoolExecutor(2) as pool:
            cancellation = pool.submit(
                c.post,
                f"/api/applications/{aid}/cancel",
                headers=headers(seller),
                json={"expected_version": 4, "reason": "일정 변경"},
            )
            confirmation = pool.submit(action, c, staff, pid, "booth-confirm", version)
            results = [cancellation.result(), confirmation.result()]
        assert sorted(r.status_code for r in results) == [200, 409]
        # If booth confirmation won, the stale cancellation must retry with current version.
        if results[0].status_code == 409:
            assert (
                c.post(
                    f"/api/applications/{aid}/cancel",
                    headers=headers(seller),
                    json={"expected_version": 5, "reason": "최신 배치 확인 후 취소"},
                ).status_code
                == 200
            )
        current = board(c, staff, pid)
        assert current["assignments"] == [] and current["drafts"] == []
        assert current["applications"] == []
