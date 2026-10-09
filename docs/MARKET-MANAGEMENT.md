# 마켓 관리 구현 · 2026-10-09

## 범위

`/markets` 목록(20개 단위), `/markets/new` 초안 생성, `/markets/[id]` 설정·상태·담당자 관리. 기존 Pretendard·크림 배경·딥그린 토큰과 공통 입력/버튼/안내를 사용한다. 공개 모집 웹페이지와 셀러 신청은 다음 단계다. 실제 마켓 운영값을 받지 않았으므로 원격 DB에 예시 마켓을 생성하거나 공개하지 않았다.

## 권한과 API

| 경로 | 용도 | 권한 |
|---|---|---|
| GET /api/projects | 배정 마켓 또는 관리자 전체 목록 | STAFF 배정 범위, 전체 관리자 |
| POST /api/projects | DRAFT 생성 | 전체 관리자 또는 활성 OPERATOR 배정이 있는 STAFF |
| GET /api/projects/{id}/settings | 비공개 전체 설정 | 해당 OPERATOR 또는 관리자 |
| PATCH /api/projects/{id} | 기본·모집·동의·심사·부스 설정 | 해당 OPERATOR 또는 관리자 |
| POST /api/projects/{id}/status | 명시 상태 변경 | 해당 OPERATOR 또는 관리자 |
| GET/POST /api/projects/{id}/members | 이메일 기준 역할 배정·변경·해제 | 전체 관리자 |
| GET /api/public/projects/{id} | 공개 데이터 필드만 반환 | 인증 불필요, DRAFT 제외 |
| GET /api/me/requests/{operation}/{key} | 같은 actor 요청 결과 조회 | 현재 업무 권한 재검사 |

전체 관리자 권한 부여 endpoint는 제공하지 않는다. 최초 관리자는 사용자가 지정한 계정의 Auth 이메일 인증과 기존 관리자 부재를 확인한 뒤 DB 트랜잭션에서 STAFF/PLATFORM_ADMIN으로 변경하고 INITIAL_ADMIN_GRANTED 감사 기록을 남겼다. 기존 테스트 셀러는 USER/SELLER로 유지했다. 로그인된 Chrome의 계정 화면과 빈 마켓 목록에서 실제 연결을 확인했다.

생성자는 항상 해당 마켓의 STAFF/OPERATOR가 된다. SELLER 상태의 전체 관리자가 생성하는 경우에도 같은 트랜잭션에서 STAFF로 전환하고 전환 이력을 남긴다. `/me.can_create_project`는 목록 페이지와 독립적으로 계산하여 REVIEWER/VIEWER/미배정 STAFF의 생성 화면 직접 접근도 차단한다.

권한 배정은 먼저 이메일 인증·bootstrap을 완료한 활성 사용자만 대상으로 한다. 활성 배정 시 STAFF로 전환하며 마켓 역할은 OPERATOR/REVIEWER/VIEWER 중 하나다. 배정 해제는 해당 마켓 권한만 해제한다. 이 화면으로 전체 관리자 권한을 부여하거나 해제하지 않는다. REVIEWER/VIEWER는 목록과 요약만 읽고 운영 설정을 수정할 수 없다.

## 데이터 규칙

- 새 마켓은 항상 DRAFT. 공개 시 품목·동의 버전/본문·심사 항목·부스 조건이 모두 필요하다. 동의 본문은 실제 승인된 운영 문구를 입력하며 앱이 법률 문구를 생성하지 않는다.
- 날짜 입력은 KST 고정 `YYYY-MM-DD HH:mm`. 행사 종료의 KST 날짜가 행사일이다. 모집 시작 < 마감 ≤ 행사 종료. 종료된 행사 편집과 과거로 종료 시각 변경을 거절한다.
- 심사 항목은 중복 없는 1~20개, 각 비중 1~100, 합계 100. 금액·정원·문자 길이·배열 크기는 API 모델로 제한한다. JSON에 알 수 없는 필드를 받지 않는다.
- 상태는 DRAFT → RECRUITING → REVIEWING → CLOSED → COMPLETED. REVIEWING → RECRUITING은 새 미래 시작 시간·마감·사유가 필요하다. CLOSED → REVIEWING은 종료 전만 가능하다. COMPLETED는 CLOSED에서 행사 종료 후만 가능하고 이후 변경하지 않는다.
- 모든 변경에 사유·Idempotency-Key, 생성 외 expected_version이 필수다. 프로젝트 행 잠금으로 동시 버전 변경을 직렬화한다. 설정 변경 시 version 증가, 정책 JSON 변경 시 policy_version도 증가한다. 감사/멱등 결과와 업무 변경은 같은 트랜잭션이다.
- 공개 API는 생성자·감사·멤버·내부 심사 기준을 노출하지 않는다. `accepting_applications`는 상태와 기간으로 계산하지만 신청 endpoint가 구현되었다는 뜻은 아니다.

## 복구와 화면 행동

요청 본문과 사유/이메일은 화면 메모리에만 보관한다. sessionStorage에는 actor·화면별 키/operation/경로/메서드만 저장한다. 응답 유실 시 2/4/8초 한정으로 같은 요청을 조회하고, 명시 UNRESOLVED일 때만 원래 본문·키로 재실행한다. 새로고침 후 본문이 없으면 결과 조회만 하며 새 키로 업무를 재실행하지 않는다. 만료·운영자 확인 필요·권한 상실은 화면에 지속한다.

409 후 입력을 유지한다. 최신 마켓을 조회해 버전과 요약을 확인한 다음 명시적으로 현재 입력을 대체한다. 성공은 4초 토스트(hover/focus 일시정지), 오류는 inline Notice. 상태·권한 변경은 대상·영향·사유를 다이얼로그에서 확인하며 취소 버튼 최초 초점, Escape 취소를 제공한다. 저장 전 in-app 링크 이동은 앱 확인창, 실제 페이지 unload는 브라우저 이탈 보호를 사용한다.

동일 문서의 브라우저 뒤로/앞으로 이동은 Navigation API로 이탈 전에 보호한다. 현재 Chrome에서 취소 후 입력 보존을 검증했다. Navigation API를 지원하지 않는 브라우저의 동일 문서 history 보호는 아직 보장하지 않으므로, 다른 브라우저 지원 확정 시 대체 보호 및 검증이 필요하다.

## 검증

- API: 실제 로컬 PostgreSQL의 격리 DB로 중복 생성·동시 생성·동시 수정 충돌·역할·권한 회수 후 재생 차단·정책 버전·공개 필드·필수값·종료 후 변경 차단을 검증한다.
- 웹: KST 변환/유효 날짜/심사 가중치 단위 검증, 인증 relay 경로·본문·페이지 인자 제한 검증.
- Chrome 자동화: Auth/업무 API fixture로 실제 UI/SDK의 초안 생성 → 수정 → 충돌 → 최신 적용 → 상태 확인 → 멤버 배정, 미확정 복구, 빈 목록·셀러 차단·모바일·키보드·이탈 확인을 검증한다. 실제 원격 마켓 변경 E2E와 구분한다.
- 실행: `npm.cmd run check`(로컬 테스트 DB 설정), `npm.cmd run build`, 웹 서버 시작 후 `npm.cmd run web:test:browser`. 정적 UI 검사 출력은 Git 제외 `output/premium-audit.json`.

최종 결과: API/DB **38개 통과**, 웹 단위 **28개 통과**, Chrome **14개 통과**. 타입·계약 동기화·Ruff·브랜드 에셋·production build 통과, strict UI 정적 검사 오류/경고 0건. 코드 리뷰에서 생성 권한 UI 선차단과 동일 문서 뒤로가기 입력 유실을 보완했고 각각 회귀 테스트를 추가했다. 실제 관리자 화면 증빙은 Git 제외 `output/admin-account.png`, `output/markets-admin.png`, `output/market-create-admin.png`에 저장했다.

## 다음 범위와 한계

셀러 프로필·신청(P4), 파일 업로드(P5), 실제 선정/확정 수에 따른 정원 하한 및 신청 집계, 공개 모집 웹페이지가 남았다. `/status`로 재검토를 제공하며 전용 `/reopen-review` 별칭은 아직 없다. 실제 기존 계정 재로그인·장시간 세션 만료는 별도 실증이 필요하다. 운영용 최소 권한 DB 계정 분리와 Vercel/Render 환경변수·배포는 다음 배포 작업이다. 제품 전체 AC/E2E 44개 완료를 의미하지 않는다.
