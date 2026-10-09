# 개발 문서 지도

정리일: 2026-10-08. 업무 명세 v1.3, 디자인 시스템 v1.0을 현재 기준으로 연결합니다. 기존 Word 파일을 이동·삭제·재작성하지 않았습니다.

## 권장 읽는 순서

실행하려면 [로컬 개발 안내](LOCAL-DEVELOPMENT.md), 현재 증거는 [P0 검증 기록](P0-VERIFICATION.md)을 먼저 확인합니다.

후속 [P1/P3 구현 기록](P1-P3-IMPLEMENTATION.md)은 인증·권한·요청 복구 API와 외부 연결 전의 검증 범위를 설명합니다.

[인증 연결 안내](AUTH-SETUP.md)는 OTP 로그인·계정·복구 UI, Git 연결 상태와 실제 Supabase 설정·수신 확인 절차를 설명합니다.

[마켓 관리](MARKET-MANAGEMENT.md)와 [셀러 신청·파일](SELLER-APPLICATIONS.md)은 후속 구현, 실제 연결 증거와 남은 운영 범위를 기록합니다.

| 순서 | 문서 | 읽고 확인할 내용 |
|---|---|---|
| 1 | [개발 시작 안내](DEVELOPMENT.md) | 범위·역할·기술 구성·개발 경계 |
| 2 | [공통계약](reference/00-common-contract.md) | 상태전이·권한·행사 종료·발송·요청 복구 |
| 3 | [기능명세](reference/03-features.md) | 기능 ID·MUST/SHOULD·완료조건 |
| 4 | [화면설계](reference/06-screens.md) | SCR-01–08와 셀러·운영자 동선 |
| 5 | [디자인 규칙](../DESIGN.md), [UI 동작 계약](../UX-CONTRACT.md) | 시각 수치·공통 상태·복구·반응형 |
| 6 | [DB 명세](reference/04-data-model.md), [개발명세](reference/05-development.md) | 스키마·제약·API·worker·트랜잭션 |
| 7 | [로드맵](ROADMAP.md), [검증](qa/README.md), [운영 준비](READINESS.md) | 구현 순서·증빙·미확정 사항 |

사업 배경은 [서비스기획](reference/01-product.md), 운영 예외 절차는 [업무프로세스](reference/02-workflow.md)를 참고합니다.

## 문서 책임과 충돌 처리

배포 제공사 후속 결정은 [배포 구성](DEPLOYMENT.md)을 따릅니다. 2026-10-08 사용자 승인으로 Vercel·Render·Supabase를 확정했으며, Word v1.3의 호스트 후보를 구체화한 결정입니다.

| 판단할 내용 | 우선 기준 | 파생 문서 |
|---|---|---|
| 범위·상태·역할·기본 정책 | Word 00 공통계약 v1.3 | reference/00, DEVELOPMENT 요약 |
| 개별 기능·완료조건 | Word 03 기능명세 v1.3 | reference/03, acceptance-cases.csv |
| 필드·제약·트랜잭션 | Word 04 DB 명세 v1.3 | reference/04 |
| API·실행 흐름·E2E | Word 05 개발명세 v1.3 | reference/05, e2e-cases.csv |
| 화면 동선 | Word 06 화면설계 v1.3 | reference/06, UX-CONTRACT |
| 색·글꼴·간격 | 루트 DESIGN.md | tokens.css, tokens.json, 정적 견본 |
| 컴포넌트 UI 동작 | UX-CONTRACT.md + 업무 계약 | COMPONENTS.md |
| 실제 검증 여부 | 실행 로그의 증빙 | QA 요약 |

새 문서가 있다는 이유만으로 기존 업무 규칙을 바꾸지 않습니다. 충돌을 발견하면 해당 기준 문서와 영향받는 문서를 함께 수정합니다. 이 로드맵은 순서를 정리한 안내이며 원본의 필수 기능을 삭제하거나 기술 권장안을 외부 서비스 선택 확정으로 바꾸지 않습니다.

## 파일 구조

```text
README.md                       시작점
DESIGN.md                       시각 규칙의 원본
UX-CONTRACT.md                  공통 UI 동작
docs/
  DEVELOPMENT.md               개발 시작 안내
  ROADMAP.md                   단계별 진행과 완료조건
  READINESS.md                 미확정 사항과 운영 공개 기준
  reference/                  Word v1.3 검색용 자동 생성본 7종
    manifest.json             원본 파일명·해시·표 수
  qa/
    README.md                 검증 방법과 증빙 기준
    acceptance-cases.csv      AC 44개 자동 추출
    e2e-cases.csv             E2E 44개 자동 추출
    execution-log.csv         실제 실행 증빙 기록용, 현재 비어 있음
  tools/
    sync_reference_docs.py    Word → Markdown·검증 목록
    verify_docs.py            링크·해시·항목·로드맵 커버리지 검증
design-system/                디자인 에셋·토큰·정적 견본
디자인시안_v1.0/               선택한 화면 시안 3종
문서_보완본_v1.3/              현재 Word 업무 기준 7종
문서_보완본_v1.0~v1.2/         이전 버전 보관
```

## 문서 갱신과 검증

현재 자동화는 Python과 `python-docx`를 사용합니다. 디자인 토큰 도구는 추가로 PyYAML·Pillow가 필요합니다. 아래는 저장소 루트에서 실행하는 **문서용 명령**이며 제품 실행 명령이 아닙니다.

```powershell
python docs/tools/sync_reference_docs.py
python docs/tools/sync_reference_docs.py --check
python docs/tools/verify_docs.py
python design-system/tools/build_tokens.py --check
python design-system/tools/verify_assets.py
```

`reference/*.md`와 두 검증 CSV는 자동 생성 파일이므로 직접 수정하지 않습니다. 원본 Word를 바꾼 뒤 재생성합니다. 실제 테스트 기록은 `qa/execution-log.csv`에만 추가하고, 생성 스크립트는 이 기록을 덮어쓰지 않습니다. Word 표는 문서 순서의 `table-01` 같은 앵커로 링크됩니다. 표를 삽입하면 재생성으로 앵커도 갱신합니다.

버전을 올릴 때는 생성 스크립트의 SOURCE를 새 폴더로 바꾸고 README·문서 지도·준비 목록의 기준 버전을 함께 변경합니다. 이전 버전은 승인된 보관 정책 없이 삭제하지 않습니다. 시안이나 데모의 날짜·개수는 실제 행사 설정값이 아닙니다.
