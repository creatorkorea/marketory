# 인증 UI와 개발 환경 연결

2026-10-09. `/login` 이메일 OTP 화면, `/account` 계정 확인·로그아웃, 같은 요청 키를 이용한 복구 UI를 구현했다. Chrome creatorkorea 계정에서 marketory 프로젝트(xtuznofafxlwlggnolns, ap-south-1) 접근을 확인했다. 웹·API 로컬 환경에 URL/publishable key를 설정하고 Auth settings HTTP 200 및 이메일 인증 활성화를 확인했다. 실제 Supabase DB 연결·foundation migration 적용을 완료했다. 실제 OTP 수신·신규 계정 인증·bootstrap·계정 조회를 확인했다. 로그아웃·기존 계정 재로그인은 별도 검증이 남아 있다. 기존 Supabase MCP 계정 권한과 Chrome 로그인은 별개다.

## Git

- 원격: `https://github.com/creatorkorea/marketory.git`
- 현재 폴더에서 Git 초기화, `origin` 등록·fetch 성공. 초기 조회 시 원격 refs 없음.
- 초기 연결 단계에서는 원격만 등록했으며, 최신 커밋·동기화 상태는 Git 이력에서 확인한다. `.env`, `.local`, DB 데이터, node_modules, 테스트 결과는 `.gitignore`로 제외한다.

## 실제 Supabase 연결 순서

1. 사용할 MARKETORY 개발 프로젝트 ID를 확인한다. 새 프로젝트는 조직·리전·비용 확인이 먼저 필요하다.
2. [migration 안내](../supabase/migrations/README.md)에 따라 기존 스키마·migration 이력을 확인하고 개발 DB에 적용한다. 기존 다른 서비스 DB를 재사용하지 않는다.
3. `apps/api/.env`에 `MARKETORY_SUPABASE_URL`, `MARKETORY_SUPABASE_PUBLISHABLE_KEY`, 서버 전용 `MARKETORY_DATABASE_URL`을 설정한다. API 계정에는 업무 SQL 권한이 필요하며 anon/authenticated 직접 조회는 차단한다.
4. `apps/web/.env.local`에는 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_BASE_URL`, `APP_ORIGIN`을 설정한다. `APP_ORIGIN`은 브라우저에서 접속하는 정확한 origin이며 로컬은 `http://127.0.0.1:3000`, 배포는 해당 HTTPS 주소다. 경로·마지막 슬래시는 넣지 않고 preview별로도 설정한다. Next 내부 주소와 달라도 이 서버 설정만 신뢰하며 Host/Forwarded 헤더로 허용 범위를 넓히지 않는다. 웹과 API의 Supabase 프로젝트가 일치해야 한다. 웹에서는 최신 `sb_publishable_` 키만 받으며 service role/secret/DB URL을 공개하지 않는다.
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

## 2026-10-09 실제 DB 연결 검증

- 사용자가 저장한 DB 비밀번호로 세션 풀러에 연결했다. `apps/api/.env`의 중복 DB URL 항목을 정리하고 비밀번호의 특수문자를 URL 인코딩했다. 값은 Git·문서·로그에 기록하지 않는다.
- 대상은 `xtuznofafxlwlggnolns`, 세션 풀러 `aws-0-ap-south-1.pooler.supabase.com:5432`이다. psycopg 클라이언트 TLS 사용과 PostgreSQL 17.11을 확인했다.
- 적용 전 public 업무 테이블과 migration 이력이 없는 상태를 확인했다. Supabase CLI 2.120.0의 dry-run에서 foundation 한 건만 확인한 뒤 `202610090001_foundation.sql`을 적용했다. 원격 migration 이력에 version `202610090001`, name `foundation`이 기록됐다.
- 업무 테이블 6개 모두 RLS 활성화, anon/authenticated의 SELECT·INSERT·UPDATE·DELETE 권한 없음, 제약 trigger 3개 존재를 조회했다. 실제 사용자를 만들거나 업무 데이터를 삽입하지 않았다.
- 로컬 API·웹을 재시작했다. 실제 DB를 사용하는 `/health/ready` 200, 비로그인 `/api/me` 401, 웹 `/api/auth/config` 200 및 대상 프로젝트 일치, `/login` 200을 확인했다. 이는 실제 OTP 인증·계정 생성·전체 업무 E2E 완료의 증거는 아니다.
- 현재 개발 연결은 postgres 계정을 사용한다. 외부 배포 전 migration 계정과 런타임 최소 권한 계정을 분리하고 API의 역할·소유권 검사를 실제 로그인 세션으로 검증해야 한다.

## 실제 OTP 로그인 검증

- Resend SMTP와 가입·로그인 숫자 OTP 템플릿 저장을 완료했다. 사용자가 지정한 수신자로 OTP 발송을 요청하고 Resend Delivered 상태를 확인했다. 사용자가 실제 수신 코드 입력을 완료한 뒤 `/account`에서 계정 확인 완료·셀러·프로필 작성 필요 표시를 확인했다.
- 2026-10-09 실제 로그인 UI에서 사용자 지정 주소로 신규 가입 인증 메일 1건을 요청했다. Resend에서 제목 `마켓토리 이메일 인증번호`, 상태 `Delivered`를 확인했다. 전달 완료는 수신 서버의 수락 증거이며 받은 편지함 위치나 사용자 확인·로그인 성공을 증명하지 않는다. 증빙은 Git 제외 경로 `output/resend-otp-delivered.png`에 저장했다. OTP 값은 기록하지 않았다.
- 첫 실제 로그인에서 Next 내부 request URL과 브라우저 origin 불일치로 bootstrap POST가 403으로 차단됐다. 서버 설정 `APP_ORIGIN` 기준으로 검사하도록 수정했다. 실패를 재현한 테스트 후 웹 테스트 25개와 빌드가 통과했고, 실제 서버에서도 올바른 origin의 무효 토큰은 API 401, 외부 origin은 relay 403임을 확인했다.
- 새로고침 후 기존 요청 키를 이용해 계정 생성이 복구됐다. 실제 DB에서 이메일 확인 완료, ACTIVE/USER/SELLER 계정, 성공 bootstrap 결과 1건·감사 로그 1건을 조회했다. 로그인 성공 화면은 `output/auth-real-account-success.png`에 저장했다. 실제 로그아웃·기존 계정 OTP 재로그인과 전체 업무 E2E는 아직 별도 검증이 필요하며 현재 로그인 세션은 유지했다.

## SMTP 연결과 OTP 템플릿 적용 절차

발송 서비스는 사용자 선택으로 **Resend**로 결정했다. 로그인된 계정에서 기존 `send.creatorkorea.org`의 Verified 상태를 확인했고, 사용자 승인 후 해당 도메인으로 제한한 Sending access 키 `marketory-supabase-auth`를 생성했다. Supabase SMTP 연결과 OTP 템플릿 저장까지 완료했다. 유료 전환은 수행하지 않았다.

Resend 연결값은 SMTP host `smtp.resend.com`, port `465`, username `resend`, password는 Resend API key이다. 키를 Supabase SMTP 비밀번호 필드에 저장했으며 프로젝트 파일이나 공개 설정에 추가하지 않았다. 발신 주소는 `marketory@send.creatorkorea.org`, 발신 이름은 `마켓토리`다. [Resend 공식 Supabase SMTP 안내](https://resend.com/docs/send-with-supabase-smtp).

2026-10-09 적용 확인: SMTP 저장 성공 안내 후 페이지를 새로 열어 Enable custom SMTP 활성화, 저장된 비밀번호 안내, host·port·발신 이름을 확인했다. 사용자별 최소 발송 간격은 60초를 유지했다. 아래 HTML과 제목을 가입·로그인 템플릿에 각각 저장했고, 다시 열어 한국어 본문과 `{{ .Token }}` 미리보기를 확인했다. 파일 추가만으로 호스팅 프로젝트에 자동 반영되는 것은 아니므로 후속 수정도 대시보드 저장이 필요하다. 화면 증빙은 Git 제외 경로 `output/supabase-smtp-connected.png`, `output/supabase-signup-otp.png`, `output/supabase-login-otp.png`에 저장했다.

연결에는 발송 서비스의 SMTP host·port·username·password와 인증된 발신 이메일 주소가 필요하다. 발신 표시 이름은 `마켓토리`로 사용한다. 비밀번호/API 키는 채팅·Git·웹 공개 환경변수에 넣지 않고 Supabase SMTP 설정에 입력한다. 서비스 미정이면 먼저 서비스와 소유 도메인을 정하고 해당 서비스에서 발신 도메인 인증을 완료한다.

1. [프로젝트 SMTP 설정](https://supabase.com/dashboard/project/xtuznofafxlwlggnolns/auth/smtp)에 실제 발송 정보를 저장한다. DNS 레코드는 선택한 발송 서비스에서 제공한 실제 값으로 설정한다.
2. [메일 템플릿](https://supabase.com/dashboard/project/xtuznofafxlwlggnolns/auth/templates)에서 아래 제목과 HTML을 각각 적용한다. 저장 후 다시 열어 `{{ .Token }}` 포함 여부를 확인한다.

| Supabase 템플릿 | 제목 | HTML 준비본 |
| --- | --- | --- |
| Magic link or OTP | 마켓토리 로그인 인증번호 | [magic-link.html](../supabase/templates/magic-link.html) |
| Confirm sign up | 마켓토리 이메일 인증번호 | [confirmation.html](../supabase/templates/confirmation.html) |

3. Email provider의 OTP 만료·길이, 재발송 제한을 확인한다. 앱은 숫자 6~10자리를 받고 `verifyOtp`의 `type: "email"`로 검증한다. 메일에는 설정과 어긋나는 고정 만료 시간이나 자리 수를 쓰지 않는다. 이메일 확인을 비활성화하지 않는다.
4. 사용자가 지정한 테스트 수신자로 신규/기존 계정의 실제 수신→코드 입력→bootstrap→본인 정보→로그아웃을 각각 검증한다. 코드를 로그나 증빙 문서에 남기지 않는다. SMTP 저장 성공·메일 발송 요청 성공·실제 수신·로그인 성공은 구분해서 기록한다.

근거: [SMTP 연결](https://supabase.com/docs/guides/auth/auth-smtp), [템플릿 변수](https://supabase.com/docs/guides/auth/auth-email-templates), [2026-06-03 Free 플랜 템플릿 변경](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier). 현재 프로젝트의 Free 플랜은 custom SMTP 연결로 템플릿 편집이 가능하며, 이를 위해 Pro 전환이 필수인 것은 아니다.

## 2026-10-09 관리자 연결 후속 확인

사용자가 별도로 지정한 관리자 이메일로 OTP 인증을 완료했다. Auth의 이메일 인증 완료와 public 계정 생성을 확인한 뒤 최초 관리자 권한을 부여하고 감사 이력을 기록했다. 기존 셀러 계정은 USER/SELLER로 유지했다. Chrome에서 실제 `/account`의 플랫폼 관리자 표시와 `/markets` 목록 조회를 확인했다. 관리자 이메일과 사용자 UUID는 저장소 문서에 복제하지 않는다.

기존 셀러의 실제 로그아웃을 확인했으며, 관리자 신규 계정 로그인도 확인했다. 기존 계정의 OTP 재로그인과 실제 장시간 경과에 따른 세션 만료는 아직 별도 실증하지 않았다. 자동화의 갱신·401·타 탭 로그아웃 테스트는 provider fixture 근거다. 마켓 관리 구현 이후 전체 API/DB 테스트는 38개, 웹 단위 테스트는 28개 통과했다. 상세 범위는 [마켓 관리](MARKET-MANAGEMENT.md) 참조.
