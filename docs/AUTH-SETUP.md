# 인증 UI와 개발 환경 연결

2026-10-09. `/login` 이메일 OTP 화면, `/account` 계정 확인·로그아웃, 같은 요청 키를 이용한 복구 UI를 구현했다. 실제 Supabase 프로젝트·DB migration·OTP 수신은 아직 연결 전이다. 연결된 계정에서 MARKETORY 프로젝트를 찾지 못했고 사용자 요청으로 Git 연결을 먼저 완료했다.

## Git

- 원격: `https://github.com/creatorkorea/marketory.git`
- 현재 폴더에서 Git 초기화, `origin` 등록·fetch 성공. 초기 조회 시 원격 refs 없음.
- 초기 연결 단계에서는 원격만 등록했으며, 최신 커밋·동기화 상태는 Git 이력에서 확인한다. `.env`, `.local`, DB 데이터, node_modules, 테스트 결과는 `.gitignore`로 제외한다.

## 실제 Supabase 연결 순서

1. 사용할 MARKETORY 개발 프로젝트 ID를 확인한다. 새 프로젝트는 조직·리전·비용 확인이 먼저 필요하다.
2. [migration 안내](../supabase/migrations/README.md)에 따라 기존 스키마·migration 이력을 확인하고 개발 DB에 적용한다. 기존 다른 서비스 DB를 재사용하지 않는다.
3. `apps/api/.env`에 `MARKETORY_SUPABASE_URL`, `MARKETORY_SUPABASE_PUBLISHABLE_KEY`, 서버 전용 `MARKETORY_DATABASE_URL`을 설정한다. API 계정에는 업무 SQL 권한이 필요하며 anon/authenticated 직접 조회는 차단한다.
4. `apps/web/.env.local`에는 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_BASE_URL`을 설정한다. 웹과 API의 Supabase 프로젝트가 일치해야 한다. 웹에서는 최신 `sb_publishable_` 키만 받으며 service role/secret/DB URL을 공개하지 않는다.
5. Supabase Email provider 활성화와 **Magic Link 및 신규 가입 메일 템플릿**의 `{{ .Token }}` 출력을 확인한다. UI는 링크 방식이 아닌 숫자 OTP를 입력한다. Site URL·허용 URL을 개발/preview별로 제한한다. 설정 후 서버를 재시작하고 브라우저를 새로고침한다.
6. 발신 설정·허용된 테스트 수신자를 확인하고 신규/기존 계정 각각 OTP 실제 수신→인증→bootstrap→`/me`→로그아웃을 검증한다. 사용자 지정 SMTP가 없는 기본 발송의 수신자/속도 제한은 대시보드에서 확인한다.

공식 근거: [이메일 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [메일 템플릿](https://supabase.com/docs/guides/auth/auth-email-templates), [세션](https://supabase.com/docs/guides/auth/sessions). 요청 성공은 메일함 수신 확인과 다르다.

## 세션·요청 복구 경계

현재 계정 화면은 CSR이고 민감한 계정 데이터를 서버 HTML에 넣지 않는다. Supabase SDK가 브라우저 localStorage에 세션을 저장하고 자동 갱신한다. JS 접근 가능한 세션이므로 외부 스크립트/HTML 삽입을 추가하지 않으며 앱 로그·URL·별도 저장소에 토큰을 복제하지 않는다. SDK 세션은 API 권한 근거가 아니며 Python에서 Auth 서버·현재 DB 역할을 검증한다. 개인화 SSR 전환 시 cookie 전략을 별도 설계해야 한다.

Next relay는 bootstrap·본인 정보·허용된 요청 결과 조회만 전달한다. 사용자 제공 URL, Cookie, 임의 헤더는 전달하지 않는다. redirect를 거절하고 응답은 no-store이다. 20초 timeout은 작업 실패 확정이 아니라 결과 불확실 상태다.

복구 저장소에는 actor별 bootstrap UUID 키만 sessionStorage로 보관한다. 이메일·토큰·본문은 저장하지 않는다. 키는 완료 이후에도 탭이 유지되는 동안 남아 재조회하며 새로고침으로 임의 재발급하지 않는다. 탭 종료 시 이 보존 범위는 끝나며 다음 접속에서는 먼저 `/me`로 계정 존재를 확인한다. 2/4/8초 결과 조회에서 명시적 UNRESOLVED인 경우에만 같은 빈 본문과 키로 재요청한다. 이후 수동 확인으로 전환한다. 401·403·409·410은 상태별 안내로 중단한다. EXPIRED 후에는 현재 상태만 조회하며 재실행하지 않는다.

## 검증 재현

```powershell
npm.cmd run web:test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run start --workspace @marketory/web
# 별도 터미널, Google Chrome 설치 필요
npm.cmd run web:test:browser
```

브라우저 검증은 실제 UI와 Supabase SDK를 실행하되 Auth·업무 응답은 Playwright 네트워크 fixture로 제공한다. 운영 앱에 테스트 로그인 경로를 추가하지 않았다. 실제 OTP 수신·원격 DB 연결을 증명하지 않는다. 제품 전체 AC/E2E 44개 완료와도 별도다.

로컬 브라우저 JSON/이미지는 `output/auth-ui-browser.json`, `output/auth-desktop.png`, `output/auth-mobile.png`에 저장한다. UI 정적 검사는 `premium-ui.json`이 지정한 실제 앱 경로만 대상으로 하며 디자인용 정적 견본은 포함하지 않는다.

2026-10-09 검증 결과: 웹 단위 21개, Chrome 브라우저 10개, 기존 API/로컬 PostgreSQL 31개 통과. 웹 빌드·타입·API 계약 동기화·Ruff·문서·토큰 검사 통과. strict UI 정적 검사 0건. 브라우저는 360/390/768/1440px 가로 넘침, 키보드 입력·오류 초점, 인증 실패, 세션 갱신, 타 탭 로그아웃, 동일 키 복구, 410 후 재실행 금지, 200% 입력 글자 확대를 검증했다. 전체 OS 확대/실기기 키보드/스크린리더 인증은 별도다.

독립 검토 후 로그아웃 장애를 브라우저에서 재현했다. 현재 SDK는 서버 5xx에도 로컬 세션을 삭제하므로, 기기 로그아웃과 서버 처리 확인 실패를 구분하는 안내를 추가했다. 세션이 남는 예외 경로는 수동 복구 상태로 전환한다. 해당 두 브라우저 사례를 수정 전 실패·수정 후 통과로 확인했다.
