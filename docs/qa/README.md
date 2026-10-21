# 검증 목록과 실행 기록

- [2026-10-19 셀러·운영자 UI/UX 점검](UI-UX-2026-10-19.md): 로컬 fixture 기반 화면 개선 및 브라우저 회귀 결과. 아래 AC/E2E CSV 실행 원장과 별도이다.

현재 **실행한 AC/E2E 업무 테스트는 없습니다**. P0 기반 테스트 결과는 [P0 검증 기록](../P0-VERIFICATION.md)에 별도로 기록합니다. 두 CSV는 Word v1.3의 표를 그대로 추출한 요구사항 목록입니다.

- [수용 기준 AC 44개](acceptance-cases.csv): 03 기능명세의 완료조건
- [E2E 시나리오 44개](e2e-cases.csv): 05 개발명세의 테스트 조건
- [실행 기록](execution-log.csv): 실제 수행 결과를 누적하는 원장, 현재 헤더만 존재

AC와 E2E는 각각 독립 목록입니다. 번호가 같다는 이유만으로 같은 검증이라고 단정하지 말고 시나리오와 기대 결과를 읽습니다. 각 행의 source는 근거 문서의 표 앵커로 연결됩니다. 생성 CSV의 baseline_status는 항상 NOT_RUN이며 실제 실행 상태는 실행 로그에서 판단합니다.

## 실행 기록 필드

| 필드 | 내용 |
|---|---|
| run_id | 실행 묶음의 고유 이름 |
| case_id | AC-01 또는 E2E-01 등 실제 항목 |
| status | PASS / FAIL / BLOCKED / SKIPPED |
| environment | local / preview / production 및 mock 여부 |
| revision | 검증한 커밋 SHA, 없으면 명시적 snapshot 식별자 |
| executed_at | 시간대 포함 실행시각 |
| evidence | 재현 로그·테스트 결과·스크린샷 경로 |
| notes | 미검증 외부 경계·실패 원인·제외 근거 |

실행하지 않은 항목은 실행 로그에 PASS를 추가하지 않습니다. 재실행은 기존 행을 덮어쓰지 않고 새 run_id로 추가합니다. 한 번 통과한 항목도 최신 변경으로 영향받으면 다시 실행합니다. 검증 증빙에는 비밀키·민감정보를 마스킹합니다.

## 검증 수준

| 수준 | 확인할 내용 | 이 수준만으로 증명할 수 없는 것 |
|---|---|---|
| 문서 검사 | 링크·원본 해시·44개 목록·로드맵 연결 | 제품 동작 |
| 디자인 견본 | 실제 폰트·토큰·색 대비·정적 배치 | 모달 키보드 동작·업무 API |
| API/DB | 상태·소유권·원자성·제약·경합 | 실제 브라우저 흐름·메일 수신 |
| worker/adapter | claim·중단·늦은 응답·제공사 실패 | 실제 제공사 결과(mock인 경우) |
| 브라우저 E2E | 사용자 동선·권한·복구 표시 | production 구성·운영 데이터 |
| 운영 리허설 | 실제 OTP/안내·배포·복원·행사 설정 | 이후 모든 운영 결과 |

E2E-38–44처럼 트랜잭션·worker·만료·동시성에 관한 시나리오는 클릭 테스트만으로 통과시키지 않습니다. 해당 계층의 검증과 UI 결과를 함께 남깁니다.

## 매 단계 확인

- 원본의 기대 결과를 테스트 assertion에 반영했는가?
- 역할·타 프로젝트·타 셀러·권한 회수를 부정 사례로 검증했는가?
- 상태 변경 성공과 중단/재시도에서 부수 효과가 한 번만 발생하는가?
- 저장·파일 연결·선정·참가확정·발송 접수를 UI가 과장하지 않는가?
- 모바일·키보드·오류 표시와 실제 서버 권한 검사를 각각 확인했는가?

현재 문서 정리의 확인 결과는 [문서 검사 결과](../document-check.json)에 보관합니다. 디자인 확인 결과는 [디자인 검증](../../design-system/verification.json)에 별도로 있습니다.

## 운영 예외 경계 검증 — 2026-10-12

검증 대상은 `341860f` 기반 API와 후속 테스트 보완이다. API 검증은 loopback PostgreSQL에 매 테스트마다 독립 DB를 생성하고 기존 migration을 적용한다. 인증 제공사는 테스트 대역이며 실제 API·권한 검사·트랜잭션·DB 제약을 실행한다. 첨부 권한 테스트의 저장소는 메모리 대역이다. 운영 Supabase 데이터 변경이나 실제 메일 발송을 포함하지 않는다.

| 경계 | 기대 결과 | 테스트 근거 |
|---|---|---|
| 정원 1자리 동시 선정 | 1건 성공, 나머지 CAPACITY_FULL; 안내 초안 1건 | `test_reviews.py::test_decision_capacity_serializes_competing_approvals` |
| 선정 취소 후 대기 승격 | 취소로 1자리 회수; 과거 실패 요청은 실패를 재생하며 새 요청으로만 승격 | `test_operation_boundaries.py::test_cancelled_selection_frees_one_slot_without_replaying_failed_approval` |
| 확정·취소 동시 요청 | 동일 버전 요청 중 1건 성공, 나머지 충돌 | `test_confirmation.py::test_owner_confirm_replay_and_cancel_race` |
| 취소와 부스 확정 경합 | 최신 버전으로 취소 완료 후 활성 확정/초안 배정 모두 없음 | `test_booth_cancellation.py::test_cancel_and_saved_draft_confirm_race` |
| 참가 취소의 부스 회수 | 확정 배정과 초안을 한 트랜잭션에서 회수, 동일 요청 재실행에도 중복 효과 없음 | `test_booth_cancellation.py::test_owner_booth_projection_and_atomic_cancellation` |
| 타 셀러 신청·첨부 접근 | 조회·수정·취소·확정·파일 조회 404, 원본 상태·버전·상품명과 감사 로그 불변 | `test_operation_boundaries.py::test_other_seller_cannot_read_change_or_download_an_application` |
| 권한 강등·회수 | 저장 결과 재조회도 현재 권한으로 검사; UI의 이전 상세 정보 제거 | `test_confirmation.py::test_confirmation_deadline_and_staff_evidence`, `reviews.spec.ts` |
| 타 마켓 부스·중복 배치·행사 종료 | 교차 배정·중복 배정·종료 후 변경 거절 | `test_booths.py::test_conditions_unconfirmed_cross_project_duplicates_and_event_end` |

재현은 `apps/api`에서 로컬 전용 `MARKETORY_TEST_DATABASE_URL`을 지정하고 `.venv/Scripts/python.exe -m pytest -q`로 실행한다. 운영 DB URL을 테스트 환경변수에 넣지 않는다. 추가 2개 테스트의 JUnit 결과는 `output/operation-boundaries-20261012.xml`에 저장한다. 심사·배치 화면 검증 명령은 저장소 루트의 `npm.cmd run test:browser --workspace @marketory/web -- tests/browser/reviews.spec.ts tests/browser/booths.spec.ts --reporter=list`이며 브라우저 API는 fixture다.

실행 결과: 기존 전체 API 테스트 110개 PASS(384.91초), 추가 경계 테스트 2개 PASS(13.86초), 심사·부스 브라우저 테스트 18개 PASS(1.1분). 추가 테스트 파일의 Ruff 검사·포맷 검사와 문서 무결성 검사도 통과했다. 제품 코드·DB migration 변경은 없으며 테스트와 문서만 보완했다.

이 기록은 공개 배포에서 실제 다중 사용자 동시 접속을 재현했다는 뜻이 아니다. 공개 테스트 마켓의 기존 확정·부스·첨부 기록은 유지한다.

## 지정 메일 실행 릴리스 점검 — 2026-10-14

`test_worker_cli.py`, `test_communication_worker.py`, `test_email_provider.py`, `test_foundation.py`, `test_communications.py`를 로컬 격리 PostgreSQL에서 함께 실행했다. **53개 통과(106.15초)**. 지정 대상 외 큐 불변, 이미 처리된 ID/없는 ID의 다른 메일 선택 차단, 지정/일반 실행의 동시 claim 중복 방지, CLI 인자·비활성 차단, 기존 승인·요청·결과 확인 API를 포함한다. 외부 메일 제공사는 테스트 대역이다. JUnit은 Git 제외 `output/mail-release-20261014.xml`에 저장했다. 변경 Python 파일 Ruff·포맷 검사와 diff 검사를 통과했다.

별도 실제 연결 점검에서는 기존 테스트 메시지 `9eb9b0ff-b78d-491b-b71c-7d6d9513a557`에 대해 `MARKETORY_EMAIL_DELIVERY_ENABLED=false`를 해당 프로세스에 명시하고 `--once --communication-id`를 실행했다. `worker_target delivery_disabled`, 종료 코드 2를 확인했으며, 전후 communications/communication_attempts/audit_logs 전체 행 해시와 건수가 동일했다. 실제 발송·복구·설정 변경은 없었다. 증거는 Git 제외 `output/disabled-target-20261014.json`이다. 이는 비활성 차단 검증이며 활성화된 지정 발송의 실제 수신 증거는 아니다.
