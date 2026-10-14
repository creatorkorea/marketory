from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from marketory import worker
from marketory.config import Settings
from marketory.runtime import run_async


def test_target_requires_once_and_uuid():
    for args in (["--communication-id", str(uuid4())], ["--once", "--communication-id", "bad"]):
        with pytest.raises(SystemExit) as exc:
            worker.parse_args(args)
        assert exc.value.code == 2


def test_targeted_main_does_not_recover_global_queue(monkeypatch):
    cid = uuid4()
    monkeypatch.setattr(
        worker,
        "Settings",
        lambda: Settings(_env_file=None, email_delivery_enabled=True, resend_api_key="fake"),
    )
    probe = AsyncMock(return_value=True)
    process = AsyncMock(return_value=True)
    recover = AsyncMock()
    monkeypatch.setattr(worker, "check_database", probe)
    monkeypatch.setattr(worker, "process_one", process)
    monkeypatch.setattr(worker, "recover_stale", recover)
    assert run_async(worker.main(True, cid)) == 0
    assert process.await_args.kwargs == {"communication_id": cid}
    recover.assert_not_awaited()


def test_target_no_work_returns_distinct_exit(monkeypatch):
    monkeypatch.setattr(
        worker,
        "Settings",
        lambda: Settings(_env_file=None, email_delivery_enabled=True, resend_api_key="fake"),
    )
    monkeypatch.setattr(worker, "check_database", AsyncMock(return_value=True))
    monkeypatch.setattr(worker, "process_one", AsyncMock(return_value=False))
    assert run_async(worker.main(True, uuid4())) == 2


def test_disabled_target_never_dispatches(monkeypatch):
    monkeypatch.setattr(
        worker, "Settings", lambda: Settings(_env_file=None, email_delivery_enabled=False)
    )
    monkeypatch.setattr(worker, "check_database", AsyncMock(return_value=True))
    process = AsyncMock()
    monkeypatch.setattr(worker, "process_one", process)
    assert run_async(worker.main(True, uuid4())) == 2
    process.assert_not_awaited()
