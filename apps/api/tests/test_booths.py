import psycopg
from test_applications import client_for, setup
from test_confirmation import approved
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers


def booth_input(version, number="A01", **changes):
    return dict(
        expected_version=version,
        reason="현장 배치",
        booth_no=number,
        zone="A",
        electricity_available=True,
        fire_allowed=True,
        cold_storage_available=True,
        vehicle_access=True,
        table_capacity=2,
        note=None,
        status="AVAILABLE",
        **changes,
    )


def board(c, staff, pid):
    r = c.get(f"/api/projects/{pid}/booths", headers=headers(staff))
    assert r.status_code == 200, r.text
    return r.json()["data"]


def action(c, staff, pid, suffix, version, **values):
    return c.post(
        f"/api/projects/{pid}/{suffix}",
        headers=headers(staff),
        json=dict(expected_version=version, reason="운영 변경", **values),
    )


def confirmed(c, dsn, actor, pid):
    aid = approved(c, dsn, actor, pid)
    r = c.post(
        f"/api/applications/{aid}/confirm", headers=headers(actor), json={"expected_version": 3}
    )
    assert r.status_code == 200, r.text
    return aid


def test_board_create_draft_confirm_release_privacy(isolated_db):  # noqa: F811
    staff, seller, pid = setup(isolated_db)
    with client_for(isolated_db) as c:
        aid = confirmed(c, isolated_db, seller, pid)
        initial = board(c, staff, pid)
        h = headers(staff)
        body = booth_input(initial["project"]["version"])
        r = c.post(f"/api/projects/{pid}/booths", headers=h, json=body)
        assert r.status_code == 201, r.text
        assert c.post(f"/api/projects/{pid}/booths", headers=h, json=body).json() == r.json()
        data = r.json()["data"]
        bid = data["booths"][0]["booth_id"]
        assert data["unassigned_count"] == 1
        assert "seller_snapshot_json" not in data["applications"][0]
        assert "phone" not in data["applications"][0]
        r = action(
            c,
            staff,
            pid,
            "booth-draft",
            data["project"]["version"],
            items=[dict(application_id=aid, booth_id=bid, expected_application_version=4)],
        )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert len(data["drafts"]) == 1 and data["assignments"] == []
        r = action(c, staff, pid, "booth-confirm", data["project"]["version"])
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert len(data["assignments"]) == 1 and data["drafts"] == []
        assert data["applications"][0]["version"] == 5
        r = action(
            c,
            staff,
            pid,
            "booth-release",
            data["project"]["version"],
            application_id=aid,
            expected_application_version=5,
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["assignments"] == []
        assert len(r.json()["data"]["history"]) == 1
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET role='REVIEWER' WHERE user_id=%s", (staff,)
            )
        assert board(c, staff, pid)["can_manage"] is False
        assert (
            c.get(
                f"/api/me/requests/booths.create/{h['Idempotency-Key']}", headers=headers(staff)
            ).status_code
            == 403
        )
        assert c.post(f"/api/projects/{pid}/booths", headers=h, json=body).status_code == 403
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET role='VIEWER' WHERE user_id=%s", (staff,)
            )
        assert c.get(f"/api/projects/{pid}/booths", headers=headers(staff)).status_code == 403
        assert c.get(f"/api/projects/{pid}/booths", headers=headers(seller)).status_code == 404
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET active=false WHERE user_id=%s", (staff,)
            )
        assert (
            c.get(
                f"/api/me/requests/booths.create/{h['Idempotency-Key']}", headers=headers(staff)
            ).status_code
            == 404
        )


def test_swap_atomicity_stale_resources_and_concurrent_confirm(isolated_db):  # noqa: F811
    from concurrent.futures import ThreadPoolExecutor
    from uuid import uuid4

    staff, seller, pid = setup(isolated_db)
    second = uuid4()
    with psycopg.connect(isolated_db) as conn:
        conn.execute("INSERT INTO auth.users VALUES (%s)", (second,))
        conn.execute(
            "INSERT INTO public.users(user_id,email,account_role) VALUES(%s,%s,'SELLER')",
            (second, f"{second}@test.invalid"),
        )
    with client_for(isolated_db) as c:
        aids = [confirmed(c, isolated_db, person, pid) for person in (seller, second)]
        data = board(c, staff, pid)
        for number in ("A01", "A02"):
            r = c.post(
                f"/api/projects/{pid}/booths",
                headers=headers(staff),
                json=booth_input(data["project"]["version"], number),
            )
            assert r.status_code == 201, r.text
            data = r.json()["data"]
        bids = [b["booth_id"] for b in data["booths"]]
        items = [
            dict(application_id=a, booth_id=b, expected_application_version=4)
            for a, b in zip(aids, bids)
        ]
        r = action(c, staff, pid, "booth-draft", data["project"]["version"], items=items)
        assert r.status_code == 200, r.text
        version = r.json()["data"]["project"]["version"]
        with ThreadPoolExecutor(2) as pool:
            futures = [
                pool.submit(action, c, staff, pid, "booth-confirm", version) for _ in range(2)
            ]
            results = [f.result() for f in futures]
        assert sorted(r.status_code for r in results) == [200, 409]
        data = board(c, staff, pid)
        original = {(a["application_id"], a["booth_id"]) for a in data["assignments"]}
        items = [
            dict(application_id=a, booth_id=b, expected_application_version=5)
            for a, b in zip(aids, reversed(bids))
        ]
        r = action(c, staff, pid, "booth-draft", data["project"]["version"], items=items)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        patch = booth_input(data["project"]["version"])
        patch["note"] = "현장 메모 수정"
        r = c.patch(f"/api/projects/{pid}/booths/{bids[0]}", headers=headers(staff), json=patch)
        assert r.status_code == 200, r.text
        r = action(c, staff, pid, "booth-confirm", r.json()["data"]["project"]["version"])
        assert r.status_code == 409 and r.json()["code"] == "VERSION_CONFLICT"
        data = board(c, staff, pid)
        assert {(a["application_id"], a["booth_id"]) for a in data["assignments"]} == original
        assert data["history"] == []
        r = action(c, staff, pid, "booth-draft", data["project"]["version"], items=items)
        assert r.status_code == 200, r.text
        saved = r.json()["data"]
        # Fail after releasing old occupancy, inside the draft confirmation UPDATE.
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "CREATE FUNCTION public.fail_booth_confirm() RETURNS trigger "
                "LANGUAGE plpgsql AS $$ BEGIN IF NEW.confirmed AND NOT OLD.confirmed "
                "THEN RAISE EXCEPTION 'injected swap failure' USING ERRCODE='23514'; "
                "END IF; RETURN NEW; END $$"
            )
            conn.execute(
                "CREATE TRIGGER fail_booth_confirm BEFORE UPDATE ON public.booth_assignments "
                "FOR EACH ROW EXECUTE FUNCTION public.fail_booth_confirm()"
            )
        failed = action(c, staff, pid, "booth-confirm", saved["project"]["version"])
        assert failed.status_code == 503
        assert board(c, staff, pid) == saved
        with psycopg.connect(isolated_db) as conn:
            conn.execute("DROP TRIGGER fail_booth_confirm ON public.booth_assignments")
        r = action(c, staff, pid, "booth-confirm", r.json()["data"]["project"]["version"])
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert {(a["application_id"], a["booth_id"]) for a in data["assignments"]} == set(
            zip(aids, reversed(bids))
        )
        assert len(data["history"]) == 4  # Two superseded drafts and two old assignments.
        assert {a["version"] for a in data["applications"]} == {6}
        patch = booth_input(data["project"]["version"])
        patch["status"] = "BLOCKED"
        assert (
            c.patch(
                f"/api/projects/{pid}/booths/{bids[0]}", headers=headers(staff), json=patch
            ).status_code
            == 409
        )


def test_conditions_unconfirmed_cross_project_duplicates_and_event_end(isolated_db):  # noqa: F811
    from uuid import uuid4

    staff, seller, pid = setup(isolated_db)
    with client_for(isolated_db) as c:
        aid = approved(c, isolated_db, seller, pid)
        data = board(c, staff, pid)
        assert data["applications"] == []
        r = c.post(
            f"/api/projects/{pid}/booths",
            headers=headers(staff),
            json=booth_input(data["project"]["version"]),
        )
        data = r.json()["data"]
        bid = data["booths"][0]["booth_id"]
        item = dict(application_id=aid, booth_id=bid, expected_application_version=3)
        version = data["project"]["version"]
        assert action(c, staff, pid, "booth-draft", version, items=[item]).status_code == 409
        assert action(c, staff, pid, "booth-draft", version, items=[item, item]).status_code == 422
        assert (
            action(
                c,
                staff,
                pid,
                "booth-draft",
                version,
                items=[dict(item, application_id=str(uuid4()))],
            ).status_code
            == 404
        )
        assert (
            c.post(
                f"/api/applications/{aid}/confirm",
                headers=headers(seller),
                json={"expected_version": 3},
            ).status_code
            == 200
        )
        item["expected_application_version"] = 4
        from test_p1_p3 import seed

        _, _, other_pid = seed(isolated_db)
        with psycopg.connect(isolated_db) as conn:
            other_bid = conn.execute(
                "INSERT INTO public.booths(project_id,booth_no) VALUES(%s,'X') RETURNING booth_id",
                (other_pid,),
            ).fetchone()[0]
        assert (
            action(
                c, staff, pid, "booth-draft", version, items=[dict(item, booth_id=str(other_bid))]
            ).status_code
            == 404
        )
        for field in (
            "electricity_available",
            "fire_allowed",
            "cold_storage_available",
            "vehicle_access",
            "table_capacity",
        ):
            with psycopg.connect(isolated_db) as conn:
                conn.execute(
                    "UPDATE public.applications SET electricity_required=true,fire_required=true,"
                    "cold_storage_required=true,vehicle_entry_required=true,table_count=1 "
                    "WHERE application_id=%s",
                    (aid,),
                )
            patch = booth_input(version)
            patch[field] = None if field == "table_capacity" else False
            r = c.patch(f"/api/projects/{pid}/booths/{bid}", headers=headers(staff), json=patch)
            assert r.status_code == 200, r.text
            version = r.json()["data"]["project"]["version"]
            assert r.json()["data"]["candidates"][0]["compatible"] is False
            assert action(c, staff, pid, "booth-draft", version, items=[item]).status_code == 409
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,)
            )
        assert action(c, staff, pid, "booth-draft", version, items=[]).status_code == 409


def test_event_ended_board_disables_management(isolated_db):  # noqa: F811
    staff, _, pid = setup(isolated_db)
    with psycopg.connect(isolated_db) as conn:
        conn.execute("UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,))
    with client_for(isolated_db) as c:
        assert board(c, staff, pid)["can_manage"] is False
