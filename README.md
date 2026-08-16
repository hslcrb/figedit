# FigEdit — Figma 파일 에디터

Figma 프로젝트 파일(`.fig`)을 브라우저에서 열고 편집할 수 있는 로컬 웹 에디터입니다.

`.fig` 파일은 내부에 `.fig.json` 문서를 담은 ZIP 아카이브 구조입니다. FigEdit은 이 구조를 그대로 읽고 씁니다.

## 기능

- `.fig` 파일 열기 (파일 선택 또는 드래그 앤 드롭)
- 캔버스 렌더링: 프레임/사각형/타원/선/다각형/별/벡터/텍스트, SOLID 및 선형 그라데이션, 드롭 섀도, 회전, opacity
- 레이어 패널: 트리 탐색, 선택, 자식 추가, 복제, 삭제, 순서 변경
- 인스펙터 패널: 이름 / 위치(X·Y) / 크기(W·H) / 회전 / 불투명도 / 표시 여부 / 채우기 색 / 모서리 반경 / 텍스트 속성 편집
- 캔버스: 드래그 이동, 휠 확대·축소, 더블 클릭 확대, 클릭 선택, 드래그 이동
- 실행 취소 / 다시 실행 (Ctrl+Z / Ctrl+Shift+Z), 복제 (Ctrl+D), 삭제 (Delete), 방향키 1px 이동 (Shift 10px)
- 저장: 원본 `.fig`의 추가 파일(이미지 등)을 보존한 채 `.fig`로 내보내기

## 시작하기

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`으로 접속합니다.

## 데스크톱 앱 (Windows)

Electron으로 감싼 데스크톱 앱입니다. [Releases](https://github.com/hslcrb/figedit/releases)에서
`FigEdit-<버전>-win.zip`을 받아 압축을 풀고 `FigEdit.exe`를 실행하면 됩니다 (별도 설치 불필요).

로컬에서 Windows용 빌드:

```bash
npm install
npm run dist:win     # release/FigEdit-<버전>-win.zip 생성
```

Electron 개발 실행:

```bash
npm run dev          # 터미널 1: Vite dev server
npm run electron:dev # 터미널 2: Electron으로 dev 서버 로드
```

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 타입 체크 + 프로덕션 빌드 |
| `npm run lint` | oxlint 실행 |
| `npm test` | vitest 테스트 실행 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run dist:win` | Windows용 Electron 앱 패키징 (zip) |
| `npm run electron:dev` | Electron + Vite dev 서버 실행 |

## 기술 스택

- React 19 + TypeScript + Vite
- [fflate](https://github.com/101arrowz/fflate) — `.fig` ZIP 파싱/직렬화
- [zustand](https://github.com/pmndrs/zustand) — 상태 관리
- HTML5 Canvas — 문서 렌더링
- [vitest](https://vitest.dev) — 유닛 테스트
- [Electron](https://www.electronjs.org) + electron-builder — 데스크톱 패키징

## 구조

```
src/
├── components/        # Toolbar / LayersPanel / CanvasView / Inspector
├── lib/
│   ├── figma.ts       # 문서 트리 유틸 (탐색·CRUD·노드 팩토리)
│   ├── matrix.ts      # 2D 아핀 변환
│   ├── render.ts      # 캔버스 렌더러
│   └── zip.ts         # .fig ZIP 읽기/쓰기
├── store/editor.ts    # zustand 스토어 (히스토리 포함)
└── types/figma.ts     # Figma 문서 타입 정의
electron/
└── main.mjs           # Electron 메인 프로세스
```
