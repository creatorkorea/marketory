# 배포 구성 결정

결정일: 2026-10-08. 사용자 승인으로 아래 제공사와 서비스 구성을 확정했습니다. 상태는 **P0 로컬 기반 구현, 외부 연결·배포 미완료**입니다. [실행 안내](LOCAL-DEVELOPMENT.md)와 [검증 범위](P0-VERIFICATION.md)를 참고합니다.

## 확정 구성

| 역할 | 배포 대상 | 책임 |
|---|---|---|
| Next.js 웹 | Vercel | 공개 모집·셀러·운영자 화면 |
| FastAPI | Render Web Service | 인증 검증·권한·업무 API·트랜잭션 |
| Python worker | Render Background Worker | AI 처리·안내 발송·실패 복구 |
| PostgreSQL·Auth·Storage | Supabase | 영속 데이터·OTP 인증·private 첨부파일 |

API와 worker는 같은 Python 코드와 Docker 이미지를 사용하되 실행 명령을 분리합니다. 초기 API 1개·worker 1개를 기준으로 시작합니다. P0에서 공통 Dockerfile과 실행 명령을 작성했습니다. 이 PC에는 Docker가 없어 이미지 실행은 아직 검증하지 않았습니다.

## 처리와 복구 경계

웹은 업무 변경을 API에 요청합니다. API는 사용자와 권한을 검사하고 업무 변경·감사·비동기 작업 등록을 하나의 DB 트랜잭션으로 기록합니다. worker는 DB에 기록된 작업을 claim하여 처리하며, 기존 명세의 claim_token·revision·재시도·UNKNOWN 규칙을 유지합니다.

작업 상태를 프로세스 메모리에만 두지 않습니다. 재배포·종료 후에도 DB 기록으로 복구하고, 오래된 worker 결과가 최신 작업을 덮어쓰지 않도록 검증합니다. 이미지 공유는 프로세스 메모리 공유를 뜻하지 않습니다. API와 worker는 독립적으로 실행됩니다.

별도 Redis나 추가 큐 서비스는 이번 결정에 포함하지 않습니다. DB 작업 저장·claim의 구체적인 구현과 연결 방식은 P0/P3에서 결정합니다. 실제 외부 발송의 UNKNOWN을 단순 재시도로 해결하지 않습니다.

## 연결 전에 정할 항목

- 계정·프로젝트 식별자, 요금제·리소스와 월 예산.
- API·worker·DB 리전과 연결 지연 확인.
- local·preview·production 데이터 및 인증 설정 분리. preview가 운영 발송을 실행하지 않도록 수신처와 제공사 설정 구분.
- 웹/API URL, 인증 redirect, 허용 origin과 서버 전용 비밀값의 주입 위치.
- DB 연결·migration 실행 주체, API health와 worker 생존 확인, 로그·오류 알림.
- AI·메일 제공사 및 모델, timeout·재시도·동시 처리 제한.

서버 비밀키를 브라우저 공개 환경변수에 넣지 않습니다. 실제 값은 이 문서에 기록하지 않고 환경별 설정 이름과 책임만 구현 문서에 남깁니다.

## 완료 증거

연결 후 웹→API→DB 정상 흐름, 권한 차단, worker 재시작·작업 복구, 테스트 수신함 발송, 환경 격리를 확인합니다. 결과는 [QA 실행 기록](qa/README.md)에 남깁니다. 제공사 선택만으로 해당 검증을 통과 처리하지 않습니다.

## 기준 문서와 관계

Word v1.3의 Render/Railway 후보 중 Render를 선택한 후속 결정입니다. 호스트 선택은 이 문서를 우선 참조하며, 업무 상태·데이터·API 계약은 기존 v1.3을 유지합니다. 원본 Word와 자동 생성 참조본은 이력 보존을 위해 이번 결정으로 재작성하지 않았습니다.

제공사의 서비스 설명: [Render Background Workers](https://render.com/docs/background-workers). 요금제 선택 시 [Render 요금](https://render.com/pricing)을 다시 확인합니다.
