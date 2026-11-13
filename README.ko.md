# Hyper-Browsing

**내 크롬을 그대로. AI 에이전트는 더 쉽게. 웹 자동화는 반복 없이.**

[![CI](https://github.com/miter37/hyper-browsing/actions/workflows/ci.yml/badge.svg)](https://github.com/miter37/hyper-browsing/actions/workflows/ci.yml)
![MIT 라이선스](https://img.shields.io/badge/license-MIT-blue)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-green)
![MCP 지원](https://img.shields.io/badge/MCP-native%20stdio-purple)

[English](README.md) · **한국어**

> **Hyper-Browsing은 내 컴퓨터의 Chrome을 AI 에이전트용 로컬 브라우징 런타임으로 바꿉니다.**
> 빠르고 간결한 화면 탐색, Playwright 기반 조작, Chrome 로그인 세션 활용, 사이트별 재사용 지식을 **네이티브 MCP 서버**와 기존 CLI·에이전트 스킬로 제공합니다.

유료 클라우드 브라우저 구독이 필수는 아닙니다. 브라우저와 세션은 로컬에서 관리합니다. 다만 AI 모델에 전달한 페이지 데이터는 사용한 에이전트/모델 제공자의 개인정보 처리 정책을 따를 수 있습니다.

## 빠른 시작

| 연결 방식 | 추천 대상 |
| --- | --- |
| **네이티브 MCP** | Claude Desktop, Claude Code, Cursor, Hermes 등 MCP 지원 에이전트 |
| **CLI / SKILL.md** | 코딩 에이전트, 터미널 자동화, 사이트별 러너 |
| **npm / npx** | **npm 공개 배포 이후** 간편 실행 |

### 지금 바로 사용: GitHub 소스 설치

```bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs doctor
```

MCP 클라이언트에 아래 설정을 등록합니다. 경로는 실제 설치 경로로 바꾸세요.

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

npm 패키지가 실제 배포된 뒤에는 `npx --yes hyper-browsing mcp`로 연결할 수 있습니다. **GitHub의 소스·브랜치에 실행 파일을 추가한 것만으로 npm 배포가 완료된 것은 아닙니다.** [설치 안내](docs/INSTALL.md) · [MCP 연결 가이드](docs/MCP.md)

### 에이전트에게 이렇게 요청해 보세요

- “이미 로그인한 사이트를 열어서 최신 결과를 읽고 정리해 줘.”
- “에어비앤비에서 조건에 맞는 숙소를 찾고 날짜·필터가 실제 적용됐는지 확인해 줘.”
- “처음 가는 사이트에서 목록을 스크롤하며 수집하고, 검증된 조회 경로는 다음에도 재사용할 수 있게 해 줘.”
- “저장된 액션을 먼저 확인하고 화면이 바뀌었다면 무작정 재실행하지 말고 현재 화면에서 복구해 줘.”

## Hyper-Browsing의 차별점

| 핵심 기능 | 실제 이점 |
| --- | --- |
| **네이티브 MCP** | 에이전트가 명령어 조합 없이 구조화된 브라우저 도구를 직접 사용 |
| **실제 로컬 Chrome** | CDP 연결과 로컬 프로필을 통한 세션 유지 |
| **간결한 관찰** | 필요한 요소·폼·목록만 추출, 표·그리드는 한 번에 통째로 읽기 |
| **사이트 메모** | 아는 사이트에 도착하면 바로 브리핑, 검증된 작업은 호출 한 번으로 실행·자동 수리 |
| **안전한 실행** | 모호한 대상 거절, 참조 유효성 검사, 동작 검증, 쓰기 승인 |
| **크로스 플랫폼** | Node.js 20+ 기반 Windows/macOS/Linux |
| **로컬 우선 구조** | 필수 원격 브라우저 인프라 없이 실행 |

### 사용하면서 똑똑해지는 3단계

```text
처음 방문·구조 파악  →  조작·결과 검증  →  성공 경로 재사용
      snapshot             click/fill          사이트 액션
      forms / list         diff/verify         지식 문서
      smart-scroll         위험도 확인          UI 변경 시 재탐색
```

한 번의 작업으로 무조건 스크립트를 만들지는 않습니다. 반복 사용 가치가 확인된 지식만 제한적으로 저장하고, 바뀐 사이트는 새 관찰을 통해 검증합니다. [학습·복구 원칙](docs/LEARNING.md).

## 네이티브 MCP 서버

Hyper-Browsing은 자체 **MCP 서버**(stdio)를 제공합니다. Claude Code, Claude Desktop, Cursor, Hermes 같은 MCP 클라이언트가 브라우저를 명령어 조합 없이 구조화된 도구로 바로 사용합니다. `node bin/hyper-browsing.mjs mcp`로 실행하며, 설정은 [빠른 시작](#빠른-시작)을 참고하세요.

```text
Claude / Cursor / Hermes     코딩 에이전트 / 쉘
          |                         |
     MCP (stdio)                 CLI / SKILL
          +------------+------------+
                       |
              로컬 인증 RPC
                       |
                BrowserDaemon
              Playwright + Chrome CDP
                       |
               사용자 로컬 Chrome
```

MCP는 별도의 브라우저 엔진이 아니라 **CLI와 같은 데몬에 연결하는 인터페이스**입니다. 어떤 클라이언트를 쓰든 대상 선택, 위험도 분류, 요청 ID, 결과 검증이 같은 계층에서 처리됩니다.

### 도구

| 분류 | 도구 |
| --- | --- |
| 브라우저·세션 | `browser_status` · `browser_doctor` · `session_open` · `session_list` · `session_close` · `navigate` · `back` |
| 페이지 관찰 | `snapshot` · `forms` · `list_items` · `smart_scroll` · `scroll` · `screenshot` · `wait_for` · `dismiss_annoyances` |
| **대량 읽기** | `read_table` · `page_data` · `run_script` · `read_text` |
| 조작·검증 | `click` · `fill` · `select` · `press` · `hover` · `verify` · `request_status` |
| **사이트 메모** | `site_identify` · `action_list` · `run_saved_action` · `learning_notes` · `site_knowledge_save` · `site_repair` · `site_memory_draft` · `site_memory_save` |

### MCP 서버가 해 주는 것

- **적은 호출로 대량 읽기**
  - `read_table`은 표나 그리드 전체를 간결한 TSV 행으로 돌려줍니다. `where` 조건(`Value >= 700000`, `Market Cap >= 10B`)은 페이지 안에서 먼저 걸러지고, 긴 표는 `offset`/`nextOffset`으로 이어 읽습니다. 캔버스로 그리거나 가상화한 그리드도 읽습니다. 이런 그리드는 칸 크기가 0이라 일반 요소 읽기로는 보이지 않습니다.
  - `page_data`는 페이지가 같은 사이트에서 받아 온 JSON과 HTML 안에 들어 있는 JSON을 읽습니다.
  - `run_script`는 **읽기 전용** 페이지 스크립트로 여러 값을 한 번에 모읍니다. 클릭, 입력, 이벤트, DOM 변경, POST, 저장소, 페이지 이동, `eval`처럼 페이지나 사이트를 바꿀 수 있는 코드는 실행 전에 거부됩니다.
- **여러 에이전트 동시 사용**
  - 로그인된 Chrome 하나를 함께 쓰고, 세션마다 별도 창이 뒤에서 열립니다.
  - 서로 다른 에이전트의 세션은 동시에 실행되고, Chrome 전체에 걸리는 작업은 기다렸다가 단독으로 실행됩니다.
  - `session_open {isolated: true}`를 주면 로그인을 복사한 두 번째 Chrome이 열립니다(최대 1개).
- **스스로 복구하는 브라우저:** `browser_doctor {fix: true}`가 안전하게 진단하고 고칩니다.
  - 실행 중인 Chrome에 다시 연결하고, 죽은 Chrome만 재시작하고, 남은 잠금을 정리합니다.
  - 로그인이 사라졌으면 백업에서 복원합니다.

  관계없는 프로세스를 종료하거나 프로필을 지우지 않습니다.
- **작고 정직한 결과:** 광고 프레임은 개수만 알려 줍니다. 결과가 불확실하면 불확실하다고 보고하고, 같은 요청을 무작정 다시 보내지 않습니다.

외부 상태를 바꾸는 동작에는 개별 사용자 승인이 필요하며, `confirmed: true`는 포괄 승인이 아닙니다. 제한 없는 JavaScript 실행이나 Node 코드 실행은 MCP에 공개하지 않습니다. `run_script`는 읽기 전용 스크립트만 받습니다. [MCP 안내·안전 계약](docs/MCP.md).

## 사이트 메모: 한 번 익힌 사이트는 계속 재사용

처음 가는 사이트는 탐색해야 하지만, 두 번째부터는 그럴 필요가 없어야 합니다. Hyper-Browsing은 사이트마다 **메모**(짧은 가이드와 바로 실행할 수 있는 액션)를 `sites/<사이트>/`에 두고, **에이전트에게 자동으로 전달**합니다.

| | 동작 |
| --- | --- |
| **도착하면 바로 브리핑** | 아는 사이트를 열면 첫 결과에 가이드와 저장된 액션이 함께 옵니다. 그래서 이미 성공한 방법부터 시작합니다. 40개 이상의 사이트 메모가 기본 포함되어 있습니다(Amazon, Airbnb, Booking, LinkedIn, Zillow, finviz, 네이버, Wikipedia, YouTube 등). |
| **호출 한 번으로 실행** | `run_saved_action`은 검증된 작업을 같은 위험도·검증 엔진으로 재실행합니다. 액션은 **페이지 스크립트**(`op: script`)로도 만들 수 있습니다. 권한이 큰 코드 액션을 켜지 않아도 돌고, 같은 사이트 GET 요청으로 여러 페이지를 한 번에 읽습니다. |
| **성공한 방법 저장** | 손으로 작업을 끝낸 뒤 `site_knowledge_save` 한 번으로 가이드와 액션을 저장합니다. 새 사이트면 만들어 줍니다. 주소와 셀렉터는 템플릿과 요소로 정리되고, 읽기 액션은 시험 실행을 통과해야 저장되며, 다른 사이트 주소는 거부됩니다. 수동 단계가 많았던 세션을 닫으면 저장을 제안합니다. |
| **다시 배우지 않고 수리** | 사이트가 바뀌면 `site_repair`가 깨진 요소나 주소 템플릿을 방금 성공한 것으로 바꿉니다. 이후 실행은 수정본을 쓰고, 실패한 액션은 추적해 다시 검증합니다. |
| **작은 사실도 기억** | `learning_notes`, `site_memory_draft`, `site_memory_save`가 짧고 검증된 사실을 남깁니다. 어떤 필터가 어떤 URL 파라미터를 바꾸는지, 컨트롤이 어디 있는지 같은 것들입니다. |

예: finviz 내부자 매수. 메모가 없으면 에이전트가 내부자 페이지와 종목 페이지를 하나씩 열어야 합니다. 메모가 있으면 호출 한 번이면 됩니다.

```text
run_saved_action insider_trades {"minValue": 700000, "minMarketCap": "10B"}
→ 70만 달러 이상 대형주 내부자 매수와 각 회사 시총, 약 5초
```

사이트 메모에는 사용자가 입력한 텍스트나 개인정보를 저장하지 않습니다. [학습·복구 원칙](docs/LEARNING.md).

## 데모

**방문했던 사이트: 준비된 Airbnb 러너로 재사용**

![Airbnb 자동화 데모](https://raw.githubusercontent.com/miter37/hyper-browsing/main/assets/rec_airbnb.gif)

**새 사이트: Investing.com에서 기본 도구로 탐색**

![Investing.com 최초 방문 데모](https://raw.githubusercontent.com/miter37/hyper-browsing/main/assets/rec_investing.gif)

위 영상은 기존 CLI·스킬 흐름의 예시입니다. 실제 사이트 응답시간과 로그인·접근 가능 여부는 환경에 따라 다르며, 모든 과업의 속도 향상을 보장하지 않습니다.

## CLI 빠른 사용법

```bash
node bin/hyper-browsing.mjs doctor
node bin/hyper-browsing.mjs browser start
node bin/hyper-browsing.mjs session open --url https://example.com
node bin/hyper-browsing.mjs session list
node bin/hyper-browsing.mjs mcp
```

패키지로 설치하면 런타임 정보는 `~/.hyper-browsing`에, 소스 체크아웃·스킬 폴더에서 실행하면 그 폴더의 `.runtime`에 저장되어 MCP와 `bin/webctl`이 같은 데몬·프로필을 씁니다. `WEBAGENT_RUNTIME_DIR`로 변경할 수 있습니다. 기존 `./bin/webctl`, Windows `bin\\webctl.cmd`도 지원합니다. [전체 명령](docs/COMMANDS.md).

## 개인정보·보안 원칙

- 로컬 BrowserDaemon은 localhost와 토큰 인증을 사용하며 MCP는 로컬 stdio로 연결됩니다.
- 쿠키·Chrome 프로필은 로컬에 보관합니다. **에이전트로 전달되는 웹페이지 정보는 연결한 모델 제공자가 처리할 수 있습니다.**
- 모호한 요소는 자동 선택하지 않고, 실행 결과를 모르면 같은 쓰기 요청을 무작정 반복하지 않습니다.
- `webctl eval`과 Node 코드 액션은 기본적으로 차단돼 있습니다. 신뢰하는 환경에서만 별도로 허용하며 코드 정규식 검사는 샌드박스가 아닙니다.
- Chrome 설치가 필요하고, 로그인·CAPTCHA·2단계 인증은 사람이 직접 수행해야 할 수 있습니다.

## 개발·기여

```bash
npm ci
npm run typecheck
npm run test:mcp
npm test
npm pack --dry-run --json
```

GitHub Actions로 Linux/Windows 검증을 수행합니다. 기능 제안, 오류 재현, 기여를 환영합니다.

**[MCP 연결](docs/MCP.md) · [설치·배포](docs/INSTALL.md) · [아키텍처](docs/ARCHITECTURE.md) · [전체 CLI](docs/COMMANDS.md) · [English](README.md)**

MIT 라이선스. 독립 오픈소스 프로젝트입니다.
