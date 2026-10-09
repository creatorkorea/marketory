# 마켓토리 디자인 에셋 v1.0

사용자가 선택한 차양 컨셉과 Pretendard를 기준으로 만든 디자인 패키지입니다. 2026-10-08 작성.

## 바로 보기

- [기본 컴포넌트 시안](assets/boards/01-foundations.png)
- [업무 컴포넌트 시안](assets/boards/02-domain-components.png)
- [피드백·확인 시안](assets/boards/03-feedback.png)
- [투명 배경 마켓 심볼](assets/brand/marketory-stall.png)
- [실제 Pretendard 정적 견본](preview.html)
- [디자인 규칙](../DESIGN.md) · [UI 동작 계약](../UX-CONTRACT.md) · [컴포넌트 상세](COMPONENTS.md)

## 파일 용도

| 경로 | 용도 | 적용 방식 |
|---|---|---|
| assets/boards/*.png | 컴포넌트·상태의 시각적 참고 | 검토용. 버튼이나 글자를 잘라 사용하지 않음 |
| assets/brand/marketory-stall.png | 브랜드 심볼 | 투명 PNG, 로고의 한글은 실제 Pretendard 텍스트로 조합 |
| assets/fonts/PretendardVariable.woff2 | 공식 로컬 웹폰트 | font-face 또는 프레임워크 로컬 폰트 |
| assets/fonts/OFL.txt | 폰트 라이선스 | 폰트 재배포 시 함께 유지 |
| assets/fonts/source.json | 버전·고정 커밋 출처 | 재현과 업데이트 확인 |
| tokens.css / tokens.json | 디자인 수치의 파생 에셋 | DESIGN.md에서 생성, 직접 수정 금지 |
| foundation.css | 글꼴·차양·포커스·기본 견본 스타일 | 적용 범위를 확인하고 제품 공통 스타일로 통합 |
| preview.html | 실제 글꼴·색·상태의 정적 견본 | 앱/API가 아닌 디자인 표본 |
| asset-manifest.json | 파일 크기·해시·종류·출처 | 전달물 무결성과 용도 확인 |
| generation-briefs.md | 이미지 제작 사양 요약 | 수정 시 참고. 원문 프롬프트의 축약본 |
| verification.json | 구조·대비·에셋 검증 결과 | 실제 앱 테스트 결과와 구분 |
| browser-qa.json / design-lint.json | 정적 견본 표시·문서 형식 검사 | 모바일 390px와 PC 1440px의 확인 범위 기록 |

## 재생성

Python 환경에 PyYAML과 Pillow가 필요합니다. 현재 작업은 Codex 번들 Python으로 수행했습니다.

```powershell
python design-system/tools/build_tokens.py
python design-system/tools/build_tokens.py --check
python design-system/tools/verify_assets.py
```

`DESIGN.md`가 단일 수치 원본입니다. 토큰 생성은 CSS의 `--color-*`, `--space-*`, `--radius-*`, `--font-sans`, `--component-*-*`로 연결합니다. `foundation.css`의 레이아웃은 문서의 견본이며 제품 프레임워크를 선택하거나 런타임 컴포넌트를 생성하지 않습니다.

문서 형식 검사는 `npx --yes --package @google/design.md designmd lint DESIGN.md`로 실행했습니다. 오류는 0건이며, 남은 색상 참조 경고 25건은 검사기가 CSS 소비처를 읽지 않아서 발생합니다. 별도 검증 스크립트에서 29개 색상 모두 `foundation.css`의 사용처를 확인합니다. 경고를 실제 누락과 구분하기 위해 원본 결과를 저장했습니다.

## 범위와 한계

시안 3장은 내장 Image Gen으로 제작했습니다. 글꼴 및 작은 텍스트는 근사 표현이므로 정확한 값은 문서와 실제 폰트 견본을 따릅니다. 심볼은 PNG이며 벡터 로고·상표 등록 파일·소형 파비콘 마스터가 아닙니다. 상품 사진은 합성 예시입니다. 실제 사용자 제출 자료로 사용할 수 없습니다. 동작 구현·키보드 접근성·반응형 앱·백엔드·발송 연동 검증은 이번 산출물에 포함되지 않습니다.

공식 폰트 출처: [Pretendard](https://github.com/orioncactus/pretendard). v1.3.9를 고정하여 함께 보관했고 실제 커밋은 source.json에 기록했습니다. 기능 아이콘 패밀리는 Lucide를 제안했으나 라이브러리 자체는 아직 포함하지 않았습니다.
