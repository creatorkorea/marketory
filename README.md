# MARKETORY 마켓토리

플리마켓 셀러 모집·신청·심사·참가확정·부스·안내를 관리하는 반응형 웹 서비스입니다.

**현재 상태(2026-10-23): 웹·API 공개 배포 및 합성 테스트 마켓의 신청·심사·참가확정·부스·개별/공통 안내·취소 흐름 검증 완료.** 실제 Supabase 연결과 로그인 설정을 사용합니다. 각 기능의 로컬 검증·실제 서비스 연결·미완료 범위는 아래 구현 기록에서 구분합니다. 실제 행사 운영 개시는 준비 단계이며, 실제 고객 운영·실기기·전체 백업/복구·상시 메일 발송은 별도입니다. 최신 범위는 [MVP 통합 검증 결과](docs/qa/MVP-VERIFICATION.md)를 확인합니다. Git 원격은 `creatorkorea/marketory`입니다. [로컬 실행](docs/LOCAL-DEVELOPMENT.md) · [인증](docs/AUTH-SETUP.md) · [마켓 관리](docs/MARKET-MANAGEMENT.md) · [셀러 신청](docs/SELLER-APPLICATIONS.md) · [심사](docs/OPERATOR-REVIEW.md) · [부스 배치](docs/BOOTH-MANAGEMENT.md) · [운영 안내 메일](docs/COMMUNICATIONS.md). `design-system/preview.html`은 정적 디자인 견본이고 `/ui`는 제품 컴포넌트 견본입니다.

## 개발을 시작하려면

1. [개발 시작 안내](docs/DEVELOPMENT.md): 범위, 기술 구성, 경계, 읽는 순서
2. [문서 지도](docs/README.md): 최신 문서와 역할별 기준
3. [개발 로드맵](docs/ROADMAP.md): 의존 순서와 단계별 완료조건
4. [검증 목록](docs/qa/README.md): AC 44개·E2E 44개와 실행 기록
5. [운영 전 결정 목록](docs/READINESS.md): 구현 중 결정과 공개 전 필수 확인

## 현재 기준

**Vercel(웹) + Render(Python API·worker) + Supabase(DB·인증·파일)**로 확정했습니다(2026-10-08 사용자 결정). [배포 구성과 연결 준비](docs/DEPLOYMENT.md)를 참고합니다. 웹은 Vercel, API는 Render Free에 배포했습니다. 상시 worker는 무료 조건으로 배포 보류 상태입니다.

| 영역 | 기준 |
|---|---|
| 업무·데이터·API | [Word 명세 v1.3](문서_보완본_v1.3/) · [검색용 Markdown 참조본](docs/reference/00-common-contract.md) |
| 시각 디자인 | [DESIGN.md v1.0](DESIGN.md) |
| UI 동작·복구 | [UX-CONTRACT.md v1.0](UX-CONTRACT.md) |
| 컴포넌트·에셋 | [컴포넌트 명세](design-system/COMPONENTS.md) · [에셋 안내](design-system/README.md) |
| 선택한 화면 | [목록](디자인시안_v1.0/01_운영자_신청목록.png) · [모바일 신청](디자인시안_v1.0/02_셀러_모바일_상품소개.png) · [심사 상세](디자인시안_v1.0/03_운영자_심사상세.png) |

루트의 최초 Word 5종과 `문서_보완본_v1.0`–`v1.2`는 이력 보관용입니다. 신규 구현의 기준으로 혼용하지 않습니다. 원본 위치는 유지합니다.

## 문서 갱신

Word 업무 명세를 바꾸면 Markdown 참조본과 검증 목록을 다시 생성합니다. 디자인 수치를 바꾸면 토큰을 다시 생성합니다. [동기화와 검증 방법](docs/README.md#문서-갱신과-검증)을 따릅니다. 테스트 시나리오가 존재한다는 사실을 테스트 통과로 기록하지 않습니다.
