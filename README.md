# OpenPencil

디자인 파일(`.fig`, `.pen`)을 열고 편집할 수 있는 오픈소스 디자인 에디터. 내장 AI 채팅으로 디자인을 생성/수정할 수 있고, 헤드리스 CLI, MCP 서버, Vue SDK 등 프로그래머블 툴킷으로도 쓸 수 있음.

이 프로젝트는 데스크톱 앱(Tauri) 배포 없이 **브라우저 dev server**로만 사용함.

## 설치 및 실행

### 요구 사항

- Node.js **22+** (18에서는 빌드 도구가 깨짐 — `nvm use 22` 등으로 전환)
- [Bun](https://bun.sh)

### 셋업

```sh
bun install
bun run build:packages   # 워크스페이스 패키지(core, scene-graph, pen, fig ...) 빌드
```

`@open-pencil/core` 같은 워크스페이스 패키지는 `dist/`를 통해서만 import되도록 되어 있어서(`package.json`의 `exports` 필드), `build:packages`를 먼저 돌리지 않으면 `bun run dev` 실행 시 `Cannot find module '@open-pencil/core/...'` 에러가 남. `core` 쪽 소스를 수정했을 때도 재실행 필요.

### 로컬 실행

```sh
bun run dev   # http://localhost:1420
```

### AI 채팅 사용하려면

앱 실행 후 AI 패널에서 Provider(Anthropic/OpenAI/Google/OpenRouter 등)와 API 키를 직접 입력. 키는 서버로 전송되지 않고 브라우저 `localStorage`에만 저장됨.

- Anthropic 계열 provider는 브라우저에서 직접 API를 호출하기 때문에 CORS 우회 헤더(`anthropic-dangerous-direct-browser-access`)가 코드에 이미 반영되어 있음 ([model.ts](src/app/ai/chat/model.ts))

## 에이전트 작동 방식

내장 AI는 [ai-sdk](https://ai-sdk.dev/) 기반 tool-loop 에이전트(`ToolLoopAgent`)로, 최대 50스텝까지 tool을 반복 호출하며 디자인을 만듦.

- **화면을 이미지로 보지 않음** — 씬 상태를 전부 구조화된 JSON/텍스트로만 주고받음. `export_image`는 시스템 프롬프트에서 명시적으로 금지되어 있고, 대신 `describe`가 노드의 크기/위치/정렬 문제를 텍스트로 요약해줌.
- **생성은 JSX 문자열로** — `render` tool에 `<Frame w={320} flex="col" gap={16}>...</Frame>` 같은 JSX를 문자열로 넘기면 `sucrase`로 파싱해서 Figma 노드 트리로 렌더링. React JSX와 비슷하지만 태그(`Frame`, `Text`, `Rectangle`...)와 props(`w`, `h`, `flex`, `gap`, `p`, `bg`, `rounded`...)는 디자인 전용 shorthand.
- **읽기는 별도 tool로** — 앱이 씬 정보를 미리 프롬프트에 넣어주지 않음. 모델이 스스로 `get_selection`/`get_node`/`describe` 같은 read tool을 호출해서 현재 상태를 파악한 뒤 다음 행동을 결정함 (시스템 프롬프트가 "만들고 나면 바로 describe로 검증" 같은 워크플로우를 강제).
- **Tool 세트는 2단계** — 기본으로는 `CORE_TOOLS`(~21개, 세션의 90%를 커버)만 로드하고, 필요할 때 `EXTENDED_TOOLS`(변수, 벡터 불리언 연산, 분석/코드젠 등 ~70개)까지 확장 ([packages/core/src/tools/registry-core.ts](packages/core/src/tools/registry-core.ts), [registry-extended.ts](packages/core/src/tools/registry-extended.ts)).
- **Provider는 [ai-sdk](https://ai-sdk.dev/)로 통일** — Anthropic/OpenAI/Google/DeepSeek/OpenRouter/자체 호환 엔드포인트를 동일한 `LanguageModel` 인터페이스로 교체 가능 ([model.ts](src/app/ai/chat/model.ts)). Claude Code/Codex/Gemini CLI 같은 로컬 CLI 에이전트는 API 대신 ACP(Agent Client Protocol)로 별도 연결.
