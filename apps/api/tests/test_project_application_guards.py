from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
from test_applications import client_for, setup
from test_confirmation import approved
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers, payload


def test_project_changes_preserve_occupied_capacity_and_deadlines(isolated_db):  # noqa: F811
    staff, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        aid = approved(c, isolated_db, actor, project)
        sid = uuid4()
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "INSERT INTO public.sellers(seller_id,user_id,shop_name,owner_name,phone) "
                "VALUES(%s,%s,'테스트','담당','01000000000')",
                (sid, staff),
            )
            conn.execute(
                "INSERT INTO public.applications(application_id,project_id,seller_id,status,"
                "product_name,product_desc,price_range,category,submitted_at,seller_snapshot_json,"
                "policy_version,consent_json,notification_email,notification_email_verified_at,"
                "confirm_due_at) SELECT %s,project_id,%s,status,product_name,product_desc,"
                "price_range,"
                "category,submitted_at,seller_snapshot_json,policy_version,consent_json,"
                "notification_email,notification_email_verified_at,confirm_due_at "
                "FROM public.applications WHERE application_id=%s",
                (uuid4(), sid, aid),
            )
        body = {**payload(), "expected_version": 1, "target_team_count": 1}
        result = c.patch(f"/api/projects/{project}", headers=headers(staff), json=body)
        assert result.status_code == 409, result.text
        assert result.json()["code"] == "CAPACITY_CONFLICT"
        end = datetime.now(timezone.utc) + timedelta(hours=1)
        body.update(
            target_team_count=10,
            event_date=end.astimezone(timezone(timedelta(hours=9))).date().isoformat(),
            event_end_at=end.isoformat(),
            recruit_start_at=(end - timedelta(hours=3)).isoformat(),
            recruit_end_at=(end - timedelta(hours=2)).isoformat(),
        )
        result = c.patch(f"/api/projects/{project}", headers=headers(staff), json=body)
        assert result.status_code == 409, result.text
        assert result.json()["code"] == "DEADLINE_CONFLICT"
