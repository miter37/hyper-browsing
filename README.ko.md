# Hyper-Browsing

<p align="right">
  <a href="./README.md">English</a> · <strong>한국어</strong>
</p>

<p>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT 라이선스"></a>
  <a href="https://github.com/miter37/hyper-browsing/actions"><img src="https://img.shields.io/github/actions/workflow/status/miter37/hyper-browsing/ci.yml?branch=main&label=CI" alt="GitHub Actions CI"></a>
</p>

> **내 크롬을, AI 에이전트의 브라우저로.**
>
> **네이티브 MCP + CLI + 재사용 가능한 사이트 지식**을 하나의 로컬 브라우저 런타임으로 제공합니다. 별도 호스팅 브라우저 구독, Docker, 외부 자격증명 저장소 없이 AI 에이전트가 실제 Chrome을 관찰하고 조작할 수 있습니다.

**Hyper-Browsing**은 Playwright와 로컬 인증 데몬을 기반으로 동작하는 AI 브라우징 도구입니다. 거대한 DOM을 통째로 전달하는 대신 필요한 화면 정보를 구조화하고, 클릭 결과를 재검증하며, 확인된 사이트 작업을 재사용 가능한 자산으로 보존합니다.

## Hyper-Browsing이 다른 점

| 핵심 기능 | 사용자가 얻는 가치 |
|---|---|
| **네이티브 MCP 서버** | 세션, DOM 스냅샷, 폼, 가상 목록 누적, 조작·검증·저장 액션을 23개 도구로 제공 |
| **하나의 실행 엔진** | MCP와 CLI가 동일한 요소 확인·승인·요청 추적 로직 사용 |
| **내 PC의 Chrome** | 조건에 맞으면 실제 또는 에이전트 관리 프로필의 로그인 상태 활용 |
| **반복 작업 가속** | 구조화된 관찰과 검증된 사이트 지식으로 불필요한 재탐색 감소 |
| **로컬 우선 보안** | 쿠키·프로필·실행 데이터는 로컬에 유지. AI 모델에 전달한 웹페이지 내용은 해당 제공자 정책을 따름 |
| **쉬운 설치** | Windows / macOS / Linux, Node.js 20+ 지원, npm 배포 준비 및 지속성 있는 작업공간 |

**캡차 자동 우회나 모든 사이트의 성공을 보장하지 않습니다.** 로그인·2FA는 사용자 개입이 필요할 수 있고, 결제·게시·삭제 등 외부에 영향을 주는 작업은 별도 승인을 받아야 합니다. 검증하지 않은 속도 향상률을 제품 성능으로 주장하지 않습니다.

## 빠른 시작 — 지금은 GitHub 소스로 사용

**준비물:** Node.js 20 이상, Google Chrome. 최초 브라우징 시 관리 Chrome 프로필을 사용할 수 있으며, 로그인이 필요하면 `browser reveal`로 화면을 표시합니다.

```bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs init
node bin/hyper-browsing.mjs doctor
```

**MCP 서버 실행:**

```bash
node bin/hyper-browsing.mjs mcp
```

**CLI로 바로 작업:**

```bash
node bin/hyper-browsing.mjs webctl session open --url https://example.com
node bin/hyper-browsing.mjs webctl session list
```

MCP는 표준 JSON-RPC **stdio** 연결입니다. 일반적으로 Claude Desktop, Cursor, Hermes 등 MCP 클라이언트가 위 프로그램을 직접 실행하므로 사용자가 도구 호출 JSON을 셸에 입력할 필요는 없습니다. 자세한 설정은 [MCP 설치·보안 안내](docs/MCP.md)를 참고하세요.

### npx 한 줄 설치 경험 (npm 공개 배포 후)

`package.json`의 실행 명령과 배포 파일 구성을 준비했지만, **이번 변경은 npm에 패키지를 실제 게시하지 않습니다.** 저장소 소유자가 검증한 릴리스를 등록한 뒤 아래 명령을 사용할 수 있도록 설계했습니다.

```bash
npx -y hyper-browsing@0.4.0 init
npx -y hyper-browsing@0.4.0 doctor
npx -y hyper-browsing@0.4.0 mcp
```

npm CLI로 실행한 세션·학습 자산은 임시 npx 캐시가 아니라 기본 `~/.hyper-browsing/`에 저장됩니다. 기존에 수정한 사이트 자산은 초기화 과정에서 덮어쓰지 않습니다. `WEBAGENT_WORKSPACE_DIR`로 저장 위치를 변경할 수 있습니다.

### Claude Desktop · Cursor · Hermes 등 MCP 클라이언트 연결

앱의 MCP 설정에 현재 체크아웃의 절대 경로를 등록하세요.

```json
{
  "mcpServers": {
    "hyper-browsing": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/hyper-browsing/bin/hyper-browsing.mjs", "mcp"]
    }
  }
}
```

npm 배포 후에는 명령을 `npx`로, 인수를 `["-y", "hyper-browsing@0.4.0", "mcp"]`로 교체하면 됩니다. 각 클라이언트의 설정 위치는 다를 수 있습니다.

**에이전트 작업 흐름:** `hb_session_open` → `hb_snapshot` / `hb_forms` → `hb_click` / `hb_fill` → `hb_verify`. 가상 리스트는 `hb_smart_scroll`, 검증된 사이트 작업은 `hb_action_list` · `hb_action_run`으로 처리합니다. 위험한 쓰기에는 `confirmationRequired`를 반환하고, 통신이 불명확하면 `hb_request_status`로 확인하지 같은 작업을 무작정 재실행하지 않습니다.

---

### 🎬 데모 (Demo)

#### 1) 기방문 사이트: 기구축된 전용 스크립트(Ready-made)를 활용한 초고속 실행 (`Airbnb`)
- **시나리오**: 이미 방문하여 전용 러너가 자산화되어 있는 사이트
- **동작 방식**: 불필요한 DOM 재분석이나 선택자 탐색 과정 없이, 사전 생성된 `airbnb_runner.mjs`를 즉시 호출하여 수초 만에 데이터를 빠르고 안정적으로 추출합니다.

<table align="center">
  <tr>
    <td>
      <img src="https://raw.githubusercontent.com/miter37/hyper-browsing/main/assets/rec_airbnb.gif" width="800" alt="Airbnb 전용 스크립트 실행 데모">
    </td>
  </tr>
</table>

#### 2) 신규 사이트: 기본 내장 도구만으로 자율 브라우징 (`Investing.com`)
- **시나리오**: 사전 구축된 스크립트가 없는 새로운 사이트 첫 방문
- **동작 방식**: 기본 내장된 분석 및 상호작용 도구(`forms`, `smart-scroll`, `diff` 등)만을 활용하여 요소를 즉시 파악하고 자율적으로 브라우징을 완수합니다.

<table align="center">
  <tr>
    <td>
      <img src="https://raw.githubusercontent.com/miter37/hyper-browsing/main/assets/rec_investing.gif" width="800" alt="Investing.com 기본 도구 탐색 데모">
    </td>
  </tr>
</table>

---

### ⚡ 핵심 특장점 & 차별화 뱃지

| 핵심 가치 | 주요 특징 |
| :--- | :--- |
| ⚡ **Super Fast** | 검증된 사이트는 DOM 재분석을 줄이고 전용 러너로 빠르게 실행 |
| 🪙 **Token-Light** | 무거운 DOM을 로컬 Node.js에서 정제하여 에이전트에 전달되는 컨텍스트를 줄임 |
| 🔑 **Login-Ready** | 가능한 경우 크롬 인증 상태를 재사용하여 반복 로그인을 줄임 |
| 🧠 **Self-Evolving** | 사이트 개편으로 기존 경로가 깨지면 탐색 모드로 폴백하여 스크립트 갱신을 지원 |
| 🛠️ **Self-Customizing** | 탐색 성공 경험을 내 PC에 재사용 가능한 전용 러너(`.mjs`)로 자산화 |
| 🔒 **Local-First** | 브라우저 제어와 세션 데이터는 로컬에 유지하며 별도 호스팅 브라우저나 원격 자격증명 저장소가 필요 없음 |

---

### 1. 이 스킬이 지향하는 핵심 가치 (3단계 진화 사이클)

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 1단계: 낯선 사이트 즉시 파악 및 상호작용 (Fast Zero-Shot Interaction)    │
│  - 어떤 사이트든 DOM 요소/구조를 빠르게 스캔하여 Playwright 조작 지원      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2단계: 풍부한 기본 도구 셋을 통한 심층 분석 (Standard Tooling Suite)     │
│  - 가상 스크롤, 실시간 소켓 스니핑, 상호작용 디퍼, 사용자 개입 도구 활용   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3단계: 성공 경험의 재사용 자산화 및 가속화 (Knowledge & Script Assets)  │
│  - 성공한 경로를 <site>_runner.mjs 및 사이트 전용 문서(SKILL.md)로 저장 │
│  - 다음 요청 시 처음부터 분석하지 않고 즉시 검증된 전용 스크립트로 쾌속 실행│
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2. 핵심 동작 원리

#### 1) 어느 사이트든 즉각적인 요소 파악 및 Playwright 연결
- 낯선 페이지를 열었을 때 거대한 DOM 전체를 읽느라 토큰을 낭비하거나 멈추지 않습니다.
- 상호작용 가능한 요소(버튼, 입력 필드, 주요 카드 등)를 최적화된 형태로 빠르게 파악하여, AI 에이전트가 Playwright를 통해 즉시 클릭하고 입력할 수 있도록 돕습니다.
- 사용자의 실제 크롬 프로필 세션을 공유하므로, 사용자가 이미 로그인해 둔 상태를 그대로 활용합니다.

#### 2) 분석을 빠르게 끝내주는 핵심 기본 도구 6선
복잡한 최신 웹(SPA, 가상 돔, 방해 모달, 실시간 데이터 등)을 만났을 때 에이전트가 맨땅에서 헤매지 않도록 돕는 가장 강력한 6가지 핵심 도구입니다:

1. **`dismiss-annoyances` (방해 요소 자동 청소기)**:
   - 쿠키·개인정보 동의 배너와 이벤트 팝업을 근거가 있을 때만 닫음(동의 문구가 있는 오버레이의 동의 버튼, 팝업 안의 닫기 버튼). 그 밖의 오버레이는 숨기지 않고 목록으로 보고하며, `--force-hide`로 강제로 숨길 수 있음
2. **`forms` (입력 폼 구조 자동 파악기)**:
   - 로그인, 검색, 필터링 등 입력 영역의 각 필드(이름, 레이블, 플레이스홀더, 필수 여부)와 전송 버튼을 한 번에 스캔하여 에이전트가 채워야 할 구조를 즉각 파악
3. **`smart-scroll` (가상 돔 관통 누적 스크롤러)**:
   - 피드나 목록 탐색 시 화면 밖으로 밀려나 DOM에서 사라지는 가상 돔(Virtual DOM) 노드들을 유실 없이 메모리에 누적 수집
4. **`diff` (동작 전후 상태 변화 검증기)**:
   - 버튼 클릭이나 폼 제출 전후의 스냅샷을 비교하여 새로 뜬 모달, 페이지 이동, 혹은 시스템 오류(`role="alert"`, 실패 메시지)를 즉시 감지
5. **`api-sniff` / `sniff-ws` (네트워크 및 소켓 데이터 스니퍼)**:
   - 복잡한 화면 렌더링을 일일이 파싱할 필요 없이, 브라우저 백그라운드에서 오가는 REST JSON 응답과 실시간 웹소켓(WebSocket) 스트림 패킷을 다이렉트로 가로채어 분석
6. **`user-intervene` (인간 협업 개입 도구 - Human-in-the-Loop)**:
   - 2단계 인증, 복잡한 캡차, 최종 결제 등 사람의 직접 확인이 필요한 순간에 브라우저 창을 띄워 사용자에게 처리를 요청하고 안전하게 복귀

#### 3) 방문 빈도와 재사용 가치에 따른 단계별 자산화
- 확인한 유용한 사실은 짧게 기억하고, 실제 재방문이 확인되면 필요한 능력만 실행 자산으로 저장합니다. 일회성 작업은 정식 자산 없이 종료할 수 있습니다.
- 해당 사이트 폴더(`sites/<domain>/`) 아래에:
  1. **사이트 전용 지식 문서 (`SKILL.md`)**: 사이트의 레이아웃 특징, 동적 렌더링 특이사항, 안정적인 셀렉터 규칙 기록
  2. **범용 전용 러너 (`<site>_runner.mjs`)**: 검색, 조회, 추출을 명령행 옵션 한 줄로 재현할 수 있는 표준 스크립트 구축
- **재방문 시 초고속 실행 (Fast-Path)**:  
  다음에 사용자가 동일한 사이트의 작업을 요청하면, 번거로운 화면 재분석 없이 **이미 완성된 전용 러너를 곧바로 호출**하여 몇 초 만에 결과를 전달합니다.

---

### 3. 요청 시 뒷단에서는 어떻게 동작하는가? (구체적 흐름)

#### [처음 방문하는 사이트인 경우: 탐색 → 분석 → 자산화]
- **사용자 요청**: *"새로운 쇼핑몰 X에서 특정 상품 재고 좀 확인해줘"*
- **뒷단 동작**:
  1. **초기 진입 & 요소 파악**: 스킬이 사용자의 크롬으로 사이트에 접속하여 클릭 가능한 버튼과 검색창 요소를 빠르게 식별합니다.
  2. **기본 도구 가동**: 필요시 `smart-scroll`을 돌려 상품 목록을 누적하고, 데이터를 정확히 추출해 냅니다.
  3. **결과 보고 & 최소 학습**: 먼저 재고 결과를 보고합니다. 유용한 노하우는 짧게 저장하고, 30일 내 독립 작업 2회부터 관찰한 액션을 스크립트화합니다. 7회부터 기존 액션을 살리는 탐색 러너를 추가할 수 있습니다.

#### [이미 한 번 방문하여 자산화된 사이트인 경우: 초고속 직행]
- **사용자 요청**: *"내 스레드 최신 피드 3개만 읽어서 요약해줘"*
- **뒷단 동작**:
  1. **전용 자산 확인**: 에이전트가 이미 구축된 `sites/threads/`와 `threads_runner.mjs`를 즉시 발견합니다.
  2. **쾌속 실행**: DOM을 헤매며 셀렉터를 찾는 과정 없이, `node sites/threads/scripts/threads_runner.mjs feed --limit 3`를 다이렉트로 실행합니다.
  3. **초고속 응답**: 사용자의 로그인 세션으로 피드를 즉시 긁어와 요약 결과를 사용자에게 수 초 만에 반환합니다.

---

### 4. 이미 자산화된 주요 사이트 러너 목록

다음은 기존 업무용 스크립트 목록입니다. 파일을 보존하며 현재 실행이 확인되지 않은 러너는 기본 실행 경로로 선택하지 않습니다. 새 탐색 러너는 `<site>_overview.mjs`로 구분합니다:
- **소셜/커뮤니티**: LinkedIn (`linkedin_runner.mjs`), X/Twitter (`x_runner.mjs`), Threads (`threads_runner.mjs`), Instagram (`instagram_runner.mjs`)
- **이커머스/예매/여행**: KREAM (`kream_runner.mjs`), Airbnb (`airbnb_runner.mjs`), Ticketmaster (`ticketmaster_runner.mjs`), Skyscanner (`skyscanner_runner.mjs`)
- **금융/학술/데이터**: Coinbase (`coinbase_runner.mjs`), Hyperliquid (`hyperliquid_runner.mjs`), TradingView (`tradingview_runner.mjs`), arXiv (`arxiv_runner.mjs`), Google Trends (`googletrends_runner.mjs`), 네이버 부동산 (`naverland_runner.mjs`)

---

### 5. 사이트가 개편되어 기존 자산이 작동하지 않을 때 (자가 치유: Self-Healing)

웹사이트의 UI나 셀렉터가 변경되면 엔진은 실패·검증·버전 상태를 에이전트에게 전달합니다. 복구는 다음 순서로 진행합니다:

1. **초고속 실패 감지 (Fail-Fast)**: 30초 대기 없이 3~5초 타임아웃으로 실패를 즉시 감지하고 중단합니다.
2. **기본 도구 자동 폴백 (Fallback to Discovery)**: 에이전트가 즉시 1단계 탐색 모드로 전환하여 `dismiss-annoyances`(새 방해 배너 제거), `diff`(바뀐 DOM 비교), `forms`(새 폼 구조 파악)로 우회 경로를 찾고 사용자 요청을 끝까지 완수합니다.
3. **기존 자산의 최소 수정과 재검증**: 에이전트가 성공 경험으로 기존 자산의 실패 부분을 수정합니다. 바뀐 버전은 이전 성공 횟수를 물려받지 않습니다. 로그인·네트워크 오류만으로 코드를 수정하지 않으며, 쓰기 작업을 검증 목적으로 다시 실행하지 않습니다. 복구 실패도 사용자 작업 결과와 별도로 보고합니다.

---

### 6. 저장공간 및 세션 관리

웹페이지 탐색 과정에서 크롬이 생성하는 대용량 셰이더/모델 캐시는 사전에 차단되어 있습니다.  
작업 후 디스크를 다이어트하고 싶을 때도 **사용자의 로그인 세션(쿠키)은 안전하게 보존**한 채 찌꺼기만 원클릭으로 정리됩니다:

```bash
npm run clean
```

---

### 7. 설치, MCP, npx

기존 소스 체크아웃과 새 패키지형 CLI를 모두 지원합니다. 네이티브 MCP stdio 서버는 **기존 데몬을 재사용하는 어댑터**이며 Chrome 제어 엔진을 별도로 복제하지 않습니다.

**지금 바로 사용할 수 있는 소스 방식:**

```bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs init
node bin/hyper-browsing.mjs mcp
```

**기존 스킬 명령도 그대로 유지합니다:** macOS/Linux `./bin/webctl health`, Windows `bin\webctl.cmd health`. 에이전트 스킬 디렉터리에 Git 저장소를 복제해 사용하는 방식도 가능합니다. 새 패키지형 CLI는 기본 `~/.hyper-browsing/`에 상태를 저장하고 기존 저장소 런처는 체크아웃별 기본 경로를 유지합니다.

**npx는 npm 공개 배포 이후:** `npx -y hyper-browsing@0.4.0 mcp`. 이 PR은 npm 게시를 수행하지 않습니다. 릴리스 전에 패키지명 권한, 배포 아카이브와 플랫폼 호환성을 확인해야 합니다.

설정 예시와 도구 목록, 승인 규칙 및 장애 해결은 [docs/MCP.md](docs/MCP.md), Chrome 동작은 [docs/BROWSER.md](docs/BROWSER.md)를 확인하세요.

---

### 8. 에이전트 대화창에서 시키는 방법 (실전 프롬프트 예시 3선)

복잡한 명령어 대신, 에이전트 대화창에서 평소 말하듯 자연어로 요청하면 에이전트가 스스로 스킬을 판단하여 처리합니다:

#### 예시 1) 이미 로그인된 소셜/계정 기반 작업 요청
> 💬 *"내 스레드(Threads)에 들어가서 최신 피드 상위 5개 글 읽고, 주요 트렌드랑 핵심 내용 3줄로 요약해줘."*
- **기대하는 에이전트 반응**: 보존된 로그인 세션으로 스레드에 접근하여 전용 러너(`threads_runner.mjs`)를 통해 피드를 안전하게 읽어와 브리핑합니다.

#### 예시 2) 복잡한 실시간 탐색 및 맞춤 조건 조사
> 💬 *"hyper-browsing 스킬 사용해서, 티켓XX 사이트에 접속해 10월 8일 서울에서 20대 딸과 함께 볼 공연을 조사해줘."*
- **기대하는 에이전트 반응**: 브라우저를 띄워 티켓 예매 사이트의 날짜/지역/카테고리 필터를 매끄럽게 조작하고, 추천 공연 목록과 예매 가능 여부를 정리하여 추천합니다.

#### 예시 3) 처음 방문하는 새로운 웹사이트 분석 및 데이터 수집
> 💬 *"https://news.ycombinator.com 에 접속해서 오늘 1등부터 10등까지 게시글 제목이랑 링크, 추천수 뽑아줘. 성공하면 앞으로도 빠르게 쓸 수 있게 스크립트로 자산화해 놔."*  
> *(※ 이렇게 직접적으로 자산화하라고 하지 않아도 스스로 생성하곤 하지만, 이렇게 직접 요청 시 확실하게 생성함)*
- **기대하는 에이전트 반응**: 1단계 빠른 요소 파악으로 페이지 구조를 분석해 데이터를 추출한 뒤, `sites/news_ycombinator_com/` 아래에 전용 러너와 지식 문서를 스스로 생성하여 저장합니다.

---

### 9. 로컬 우선(Local-First) 브라우저 제어를 택한 이유

Hyper-Browsing은 로컬 브라우저 제어와 재사용 가능한 로컬 자동화를 중심으로 설계했습니다:

- 🔒 **로컬 자격증명 관리**: 크롬 프로필, 쿠키, 세션 상태는 로컬 `.runtime/` 디렉터리에 보관되며 Hyper-Browsing의 원격 서비스로 업로드되지 않습니다. 다만 AI 에이전트에 전달된 페이지 정보는 사용자가 연결한 모델/에이전트 제공자의 처리 정책을 따를 수 있습니다.
- ⚡ **컨텍스트 효율적인 탐색**: 페이지 구조를 로컬 Node.js에서 정제하고, 일반적인 탐색에서는 전체 raw DOM 대신 압축된 구조화 결과를 에이전트에 전달합니다.
- 🧠 **재사용 가능한 로컬 자동화**: 성공한 워크플로를 사이트별 전용 러너(`.mjs`)와 지식 문서로 로컬에 저장할 수 있어, 반복 작업에서는 상당 부분의 재탐색 과정을 건너뛸 수 있습니다.
- 💸 **별도 브라우저 서비스 구독 불필요**: Hyper-Browsing 자체는 호스팅 브라우저, 유료 프록시, CAPTCHA 대행 서비스나 Docker를 요구하지 않습니다. 사용자가 선택한 외부 사이트나 서비스에는 별도 비용이 발생할 수 있습니다.

---

### 10. 개인정보 및 보안 정책

- 본 저장소의 모든 사이트 지식 문서와 러너 스크립트에는 **사용자의 개인정보, 로그인 쿠키, 비밀번호가 일절 포함되지 않습니다.**
- 사용자의 브라우징 인증 세션은 로컬 머신의 `.runtime/` 폴더에 보관되며 Git 추적에서 제외됩니다. AI 에이전트에 전달되는 데이터의 처리는 연결한 에이전트/모델 제공자의 개인정보 처리 방식에 따를 수 있습니다.


### 고급 실행의 보안 설정

원시 JavaScript 평가(`webctl eval`)는 기본적으로 비활성화되어 있습니다. 신뢰할 수 있는 환경에서만 `WEBAGENT_ALLOW_UNSAFE_EVAL=1`을 설정하고 `--confirm`을 사용하세요. 저장된 `actions.ts` 코드 액션도 기본적으로 비활성화되며, 신뢰한 코드에 한해서 `WEBAGENT_ALLOW_CODE_ACTIONS=1`로 활성화할 수 있습니다. 정규식 코드 검사는 샌드박스가 아닙니다. 직접 `node sites/<site>/scripts/*.mjs`로 실행하는 기존 러너 역시 별도 신뢰가 필요한 로컬 프로그램입니다.

선언형 액션 템플릿은 `{{variable}}`을 사용합니다. URL에 삽입되는 변수는 컴포넌트 단위로 인코딩하며, CSS 문법 자체에는 변수를 넣지 않습니다. 동적 요소 텍스트는 `css`와 `hasText: "{{variable}}"` 조합을 사용합니다.
