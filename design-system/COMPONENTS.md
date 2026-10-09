# 마켓토리 컴포넌트 명세 v1.0

2026-10-08. [시각 규칙](../DESIGN.md)과 [동작 계약](../UX-CONTRACT.md)을 함께 적용한다. 이 문서의 컴포넌트 이름은 **구현 시 공통 소유자로 만들 이름**이다. 견본 HTML은 상태 표현용이며 제품용 컴포넌트 구현체가 아니다.

## 1 기본 조작 요소

| ID / 컴포넌트 | 치수와 구성 | 상태·동작 |
|---|---|---|
| C01 Button | 기본 44px, 모바일 주요 CTA 48px, 좌우 20px, 아이콘 20px, gap 8px | solid/outline/ghost × brand/neutral/danger. 한 영역의 primary 하나. hover/pressed는 DESIGN 토큰. busy 폭 고정·중복 실행 차단 |
| C02 IconButton | 44×44px, 아이콘 20px | 이름 필수, tooltip은 보조. 터치에서도 이름 또는 주변 레이블 제공 |
| C03 Field | 최소 48px, 좌우 14px, 레이블과 8px 간격 | 기본/초점/오류/readonly/disabled. 입력과 label 연결, 도움말 및 오류 ID 연결 |
| C04 Textarea | 최소 112px, 패딩 14px, 자동 높이 증가 | `resize:none`, 긴 텍스트는 높이 증가 또는 확대. 카운터는 서버 제한이 있을 때만 |
| C05 Select | 최소 48px, chevron 20px | PC는 유지보수되는 접근성 Select, popup 폭 trigger±1px, 최대 높이 min(320px, 가용 높이). 모바일 native 사용 시 OS popup 차이를 명시 |
| C06 Checkbox / Radio | 시각 20px, 전체 라벨 목표 최소 44px | unchecked/checked/indeterminate(checkbox만)/disabled/error. 문구도 클릭 가능 |
| C07 Switch | 44×24px 본체, 44px 터치 영역 | 켜짐·꺼짐 텍스트 동반. 공개·권한 변경은 단순 외형 toggle만으로 즉시 성공 표시하지 않음 |
| C08 SearchField | 48px, 검색 아이콘·입력·지우기 | 값이 있으면 지우기. 조합 중 요청 보류, 300ms 검색, 오래된 응답 무시 |
| C09 DateTimeField | 날짜·시간을 명확히 분리하거나 통합 레이블 | 참가확정 기한은 KST. 서버 기한 제약 표시, 임의 기본 행사일 금지 |

버튼 기본 색은 primary/on-primary, hover는 primary-hover, pressed는 primary-pressed다. outline은 surface/text 및 control-border, hover는 surface-subtle. danger solid는 danger/흰색, hover는 텍스트·윤곽 강조로 구분한다. 비활성은 disabled/disabled-text이며 이벤트가 실행되지 않는다. busy는 원래 강조·색·치수를 유지한다.

오류는 placeholder에 넣지 않는다. 예: 필드명 ‘상호명’ → 사용자가 입력한 값 보존 → 아래 ‘상호명을 입력해 주세요’. 빨간 경계와 아이콘은 글자를 보완할 뿐 대체하지 않는다.

## 2 탐색과 메타데이터

| ID / 컴포넌트 | 규칙 |
|---|---|
| C10 AppHeader | PC 80px, 모바일 64px + 차양 8px. 화면 너비 부족 시 메뉴 버튼, 전체 내비게이션 한 줄 압축 금지 |
| C11 Breadcrumb | 14px/22px, 마지막 항목 현재 페이지. 좁으면 중간 경로를 접되 목록 복귀 유지 |
| C12 Tabs | 높이 최소 44px, 활성 2px underline. 페이지 링크와 콘텐츠 탭의 의미를 구분 |
| C13 FilterChip | 실제 필터만 button. 선택 여부 aria-pressed, 지우기와 전체 초기화 |
| C14 CategoryTag | 13px/20px, 높이 28px 이상, 사선 공간 6px+좌우 16px |
| C15 StatusBadge | 13px/20px, padding 4px 12px, 최소 28px, 정적 정보 |
| C16 Pagination | 버튼 최소 44px, 범위·총수 별도 표시, 현재 페이지 이름 포함 |
| C17 Stepper | 네 단계 제목·현재/완료 텍스트. 모바일 360px에서 줄바꿈 허용, 클릭 목표 확보 |

### 신청 상태의 정확한 색상 매핑

| 코드 | 표시 | 토큰 쌍 |
|---|---|---|
| DRAFT | 작성 중 | neutral / neutral-bg |
| SUBMITTED | 접수 완료 | info / info-bg |
| NEED_INFO | 보완 필요 | danger / danger-bg |
| REVIEWING | 검토 중 | warning / warning-bg |
| APPROVED | 선정 | success / success-bg |
| WAITING | 대기 | info / info-bg |
| REJECTED | 탈락 | neutral / neutral-bg |
| CONFIRMED | 참가 확정 | primary / selected |
| CANCELLED | 취소 | neutral / neutral-bg |

보완 필요의 danger 톤은 주의가 필요하다는 표시이며 탈락을 뜻하지 않는다. 같은 색을 공유하는 상태라도 글자를 합치지 않는다. 발송 배지는 UX 계약의 별도 enum을 사용하고 신청 배지와 재사용 매핑하지 않는다. 탈락은 위험 버튼과 달리 종료된 결과이므로 중립색이다.

## 3 업무 조합

| ID / 컴포넌트 | 해부 구조 | 상태·모바일 |
|---|---|---|
| C18 ApplicationRow | 썸네일 64px → 상호·요약 → 카테고리 → 상태 → 접수일 → 상세 링크 | 88px 이상, 긴 상호는 2줄. 모바일 96px 이상 세로 그룹, 상태·링크 유지 |
| C19 ApplicationSummary | 제출 snapshot·가격·상품 구성·운영 조건 | 수정 가능한 현재 셀러 마스터와 혼동 금지. 원문 긴 내용은 펼치기 제공 |
| C20 UploadQueue | 파일명·썸네일·전송률·연결 상태·오류·제거/재시도 | 전송/연결 구분, 한 파일씩 처리. 360px에서 썸네일 3열 가능하되 행동 목표 확보 |
| C21 AIReviewPanel | 제목·참고 안내·요약·근거·대상 revision/실행시각·상태 | 정상/대기/실행중/실패/이전 revision. 이전 결과는 상단 경고, 수동 심사 유지 |
| C22 ReviewNote | 레이블·textarea·저장 상태·저장 버튼 | 권한별 표시, 서버 성공 전 ‘저장됨’ 금지 |
| C23 BoothTile | 부스 ID·자원 조건·셀러·초안/확정 상태·배치 행동 | 빈 부스/초안/확정/충돌 구분, 색만으로 표현 금지. 키보드 배치 대안 |
| C24 CommunicationPanel | 수신자 snapshot·내용 버전·승인·발송 요청·결과 | READY와 QUEUED 분리. UNKNOWN은 조회/근거 확인. SENT는 제공사 접수 완료 |
| C25 AuditTimeline | 행동명·행위자·시각·변경 요약 | 권한 없는 개인정보 노출 금지. 원문이 아닌 요약 표시 가능 |

AI 패널은 초록 배경이 자동 선정으로 읽히지 않도록 ‘참고용 · 최종 결정은 운영자’를 항상 표시한다. 내부 점수·검토메모는 셀러 화면으로 전달하지 않는다. REVIEWER에는 결정 버튼과 증빙·다운로드를 숨긴다.

사진 추가는 실제 `<input type=file>`과 이름이 있는 버튼을 연결한다. 상태 바뀜은 aria-live로 요약하며 매 퍼센트를 낭독하지 않는다. 연결된 사진을 제거한 것은 detach 성공 후에만 화면에서 확정한다. 연결되지 않은 파일 제거와 기존 첨부 해제의 문구·동작을 구분한다.

## 4 확인과 시스템 상태

| ID / 컴포넌트 | 규칙 |
|---|---|
| C26 DecisionDialog | 480px 이하, 패딩 24px, 제목 24px. 대상·행동·영향·필수 기한/사유. 서버 성공 후 닫기 |
| C27 CancelDialog | 되돌릴 수 없음과 같은 행사 재신청 불가를 명시, 취소 사유 **textarea**. 시안의 사유 select는 구현 기준 아님 |
| C28 InlineNotice | 아이콘20px·제목·상세·회복 행동, 패딩16px, 지속 안내. 상태 코드별 문구·행동 고정 |
| C29 Toast | PC 우측 하단, 모바일 하단 행동 영역 위. 4초·hover/focus 일시정지·닫기, 최대3개, 동일 결과 중복 합치기 |
| C30 EmptyState | 작은 심볼 최대80px·제목·원인·다음 행동. 아직 없음/검색 없음/권한 없음/불러오기 실패 구분 |
| C31 Loading | 기본 스피너+문구, 기존 geometry 유지. skeleton은 이 버전 기본이 아님 |
| C32 SessionRecovery | 입력 메모리 보존·재인증·현재 권한 확인. 계정 변경 시 이전 결과 표시 금지 |
| C33 ExpiredResult | 만료 안내·현재 업무 목록 이동, 재실행 버튼 없음. 요청 키의 사용 완료 기록 유지 |
| C34 Tooltip | hover와 focus 모두 지원, 핵심 정보 전용 수단 금지. 모달 위에서도 가림 없음 |

### 중요한 확인창 문구

- 선정: ‘온유도자기를 선정할까요?’ / ‘선정 후 셀러의 참가확정이 필요합니다.’ / 필드 ‘참가확정 기한’ / CTA ‘선정 확정’.
- 취소: ‘신청을 취소할까요?’ / ‘취소 후에는 같은 행사에 다시 신청할 수 없습니다.’ / 필드 ‘취소 사유’ / CTA ‘신청 취소’.
- 발송: ‘안내를 발송할까요?’ / 수신 대상 수·내용·수신처 확인 / CTA ‘발송 요청’. 승인 버튼만으로 실행하지 않는다.
- 충돌: ‘다른 곳에서 신청이 수정됐어요.’ / 입력 유지 안내 / ‘최신 내용 보기’.
- 만료: ‘요청 결과 보관기간이 만료됐어요.’ / ‘현재 업무 상태를 확인해 주세요.’ / 신청 또는 발송 작업에 맞는 목록 링크.

## 5 시안 판독 시 주의

이미지는 컴포넌트의 시각적 예시다. 정상·실패·이전 revision 예시가 같은 보드에 있다고 실제 화면에서 동시에 같은 작업 상태로 표시하지 않는다. 기본 보드에 SUBMITTED가 생략되어 있어도 구현에서 ‘접수 완료’를 반드시 제공한다. 표의 정확한 9개 상태와 문서의 치수를 따른다. 업무 보드의 발송 단계와 피드백 보드의 만료 설명은 UX 계약의 정확한 의미로 구현한다.

UI 컨트롤은 사진에서 잘라낸 PNG로 구현하지 않는다. `tokens.css`와 실제 HTML/CSS, 접근성 primitive로 구현한다. 실제 PNG 에셋은 마켓 심볼과 참고용 시안 보드다. 사진·목록·다이얼로그의 개별 상태가 모두 구현된 컴포넌트 라이브러리라는 의미는 아니다.
