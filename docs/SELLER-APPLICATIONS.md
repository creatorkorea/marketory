# 셀러 신청·비공개 첨부 구현 기록

2026-10-09. v1.3의 SEL/APP/ATT 흐름을 기존 Pretendard·딥그린·크림 UI에 연결했다. 구현 기준과 분할 작업은 [계획](superpowers/plans/2026-10-09-seller-applications.md), 향후 운영 범위는 [로드맵](ROADMAP.md)을 따른다.

## 구현 경로

| 화면 | 동작 |
|---|---|
| `/seller/profile` | 본인 프로필 저장, 버전 충돌 확인, 허용된 마켓 신청 경로로 복귀 |
| `/p/{project_id}` | 공개 마켓 일정·정책·신청 가능 여부 |
| `/p/{project_id}/apply` | 기존 신청 복원 또는 초안 생성, 기본 정보 → 상품/사진 → 운영 조건 → 동의/확인 |
| `/me/applications` | 본인 신청 목록, 20개 페이지, 상세 복귀 offset 유지 |
| `/me/applications/{id}` | 초안·보완 편집, 접수 내용 확인, 사유를 확인한 신청 취소 |

프로필은 인증 user ID로 연결하며 번호로 기존 셀러를 찾지 않는다. 같은 마켓·셀러의 신청은 취소 후에도 하나다. 첫 제출의 셀러/인증 이메일 snapshot은 이후 프로필 변경이나 보완 제출로 덮어쓰지 않는다. 이메일 명시 동기화 기능은 후속이다. 현재 정책 버전과 실제 동의 본문을 확인하고 서버 응답이 성공한 뒤 접수 완료를 표시한다. 접수 완료와 선정/참가확정은 구분한다. 내부 대기순위는 셀러 응답에서 제외한다.

## 파일 흐름과 권한

1. 현재 신청 version/revision으로 upload intent를 발급한다.
2. 브라우저가 정책의 `upload_origin`과 정확히 같은 API 주소에 Bearer 인증 PUT으로 원본을 전송한다. Vercel JSON relay를 통한 대용량 전송은 하지 않는다.
3. 서버는 10MiB 제한, 실제 이미지 형식/손상, PDF 구조(암호 없음·1~100쪽)를 확인한다. 무작위 불변 키에 저장하며 덮어쓰지 않는다. 악성코드 스캔을 제공한다는 의미는 아니다.
4. complete가 소유권·신청 상태·기한·발급 당시 버전·실제 파일 해시를 재검사하고 첨부/감사 기록/버전 증가를 한 트랜잭션에 반영한다.
5. 성공한 새 버전을 받은 뒤 다음 파일을 전송한다. 사진 10개, 사업자 증빙 1개까지다.

상품 사진은 JPG/PNG/WebP, 사업자 증빙은 이미지/PDF다. 파일당 최대 10MiB, 이미지는 최대 4천만 화소다. 저장소가 공개 상태면 서버 읽기·업로드·임시 링크 발급을 거절한다. 파일 조회는 매번 권한을 확인하고 5분 임시 링크를 발급한다. 셀러는 본인 파일, 해당 마켓 REVIEWER는 상품 사진, OPERATOR/관리자는 증빙까지 조회할 수 있다. VIEWER는 파일을 조회할 수 없다. 임시 링크는 만료 전까지 유효하므로 권한 회수 직후 이미 발급된 링크의 즉시 폐기를 보장하지 않는다.

전송 시간은 120초로 제한하며, 전송과 provider 쓰기는 DB 잠금 밖에서 수행한다. 완료 처리 전에는 다시 검증한다. 업로드 중 모집 종료·취소·다른 탭 변경이 발생하면 파일을 최신 신청에 조용히 연결하지 않는다. 원본 전송은 불변 키와 해시로 재시도하고, JSON 변경은 동일 Idempotency-Key로 결과를 복구한다.

미완료 intent는 서버 `pending_uploads`에서 복원한다. 브라우저 저장소를 지워도 미완료 선택을 해제할 수 있다. 실패/만료 intent 해제는 상태만 REJECTED로 바꾸며 파일을 삭제하지 않는다. 첨부 해제도 soft delete다. 보관기간과 자동 삭제 작업은 활성화하지 않았다.

## 동시 수정·복구 UI

입력 본문은 메모리, actor별 요청 키/operation/경로와 최소 intent 식별자는 sessionStorage에 둔다. 복구 정보에 토큰·파일 원본·연락처를 복제하지 않는다. 새로고침 후 본문이 없으면 결과만 조회하며 새 키로 자동 재실행하지 않는다. 프로필/신청/파일 변경은 같은 공유 recovery 상태를 사용한다.

신청은 800ms 지연 임시저장, IME 조합 중 보류, 파일 작업 중 다른 변경 제한을 적용한다. 보완 상태는 서버가 요청한 필드와 기한만 허용한다. 409에서는 현재 입력을 보존하고 최신 내용과 비교한다. 파일 조회로 새 버전을 받을 때 깨끗한 폼은 값도 함께 다시 표시하고, 미저장 입력이 있으면 비교 화면으로 이동한다. 버전만 새 값으로 바꾸고 오래된 폼을 자동 저장하지 않는다.

## 환경과 실제 연결

API의 gitignored `apps/api/.env`에 `MARKETORY_SUPABASE_SECRET_KEY`, `MARKETORY_STORAGE_BUCKET=seller-assets`, `MARKETORY_PUBLIC_API_URL`을 설정한다. 서버 키는 웹 환경변수·URL·Git에 넣지 않는다. Render 배포에서는 공개 HTTPS API 주소와 정확한 Vercel origin의 CORS가 필요하다. 개발 서버 환경변수를 바꾸면 API를 재시작한다.

- 실제 프로젝트 `xtuznofafxlwlggnolns`에 CLI dry-run으로 추가 migration 한 건을 확인한 뒤 `20261009073604_seller_applications_attachments`를 적용했다.
- 신규 테이블 4개의 RLS와 anon/authenticated SELECT 거절을 조회했다. 이 작업에서 실제 신청·첨부 업무 레코드는 생성하지 않았다.
- `seller-assets` 버킷을 private, 10MiB, 위 MIME 제한으로 생성하고 다시 조회했다.
- 개인정보 없는 76바이트 진단 PNG로 실제 upload/read와 5분 signed GET 200, public GET 400을 확인했다. 진단 객체는 삭제 정책 미정으로 보관한다. 로컬 증거 `output/storage-smoke.json`에는 키·해시·결과만 있고 자격증명/임시 링크는 없다.
- 실제 로그인한 셀러가 실운영 마켓에 신청·사진을 제출하는 전체 E2E는 별도다. 브라우저 자동 검증은 테스트 네트워크 fixture이고 운영 데이터에 예시 마켓을 만들지 않는다.

## 실행한 검증

- `npm.cmd run check`: assets/OpenAPI/typecheck/Ruff, 웹 단위 40개와 API/DB 50개 통과. DB 테스트는 loopback의 격리된 임시 데이터베이스를 사용했다.
- 추가 첨부 권한·권한 회수 및 intent 만료/신청 취소 회귀를 포함한 `test_attachments.py` 4개 통과(앞선 전체 실행의 2개와 추가 2개). 현재 API 테스트 총 52개 중 새 2개는 해당 집중 실행으로 검증했다.
- `npm.cmd run build`: production build 통과.
- `npm.cmd run web:test:browser`: 22개 통과. 기존 인증·마켓 관리 14개와 셀러 8개이며 2파일 순차 전송, 409/응답 유실/401, 미완료 intent 복원, NEED_INFO 필드 제한, 오래된 입력 덮어쓰기 방지를 포함한다. 10장 전체 업로드를 실행한 것으로 표시하지 않는다.
- 독립 리뷰 지적 3건(내부 순위, PATCH 필드 생략의 해시 의미, 파일 충돌 후 오래된 입력 덮어쓰기)을 재현하고 수정했다.
- `output/seller-profile-desktop.png`(1440px), `output/seller-application-mobile.png`(390px)를 저장해 시각 확인했다. Auth/API 응답은 테스트 fixture다. 실제 고객 화면이나 실신청 데이터가 아니다.
- 재시작한 로컬 API readiness 및 웹 relay의 공개 첨부 정책은 200이다. 외부 웹/API 배포 결과가 아니다.

## 후속 범위

운영자 심사 목록/메모/보완 요청·기한 연장·선정·탈락·대기·참가확정, 이메일 명시 동기화, AI 평가, 부스 회수, 안내 승인/발송은 후속 단계다. Vercel/Render 배포 및 런타임 DB 최소 권한 계정 분리도 아직 완료하지 않았다.

## 배포 후 검증 — 2026-10-12

Vercel → Render → Supabase 실제 연결로 테스트 셀러의 초안 생성·자동 저장·117바이트 PNG 업로드·비공개 조회·제출 완료를 확인했다. 테스트 모집은 종료했다. 합성 마켓 준비와 실제 브라우저 검증 범위, 남은 한계는 [배포 E2E 기록](DEPLOYMENT.md)에 정리했다. 실제 행사 신청이나 법적 동의 검증은 아니다.
