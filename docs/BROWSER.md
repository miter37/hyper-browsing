# 브라우저와 사용자 개입

## 7. Browser and profile

### Headless by default — reveal it when a human needs to see it

The browser runs **headless (no visible window) by default.** A browser launch failure,
navigation failure, a confirmed blocked page, or persistent loading automatically attempts headed mode
once. Read commands and explicitly requested navigation retry once there. Writes, saved
actions, batches and old element references require fresh observation instead of replay.
Ambiguous/invalid/stale targets and confirmation refusals do not trigger a restart.
Use the visible window when a person needs to interact with the page:

```bash
webctl browser reveal   # open a real, visible Chrome window
# ... tell the user what you need from them, and wait for them to act ...
webctl browser hide     # optional: back to headless when done
```

Reveal for: a login wall, a CAPTCHA, 2FA, or a failure you cannot explain after checking
the execution and recovery guidance and a screenshot. Session IDs, last observed URLs, explicit viewport/locale and profile cookies are restored across reveal/hide. Existing unrelated tabs are never repurposed by their array index. When no unambiguous original tab exists, a new session tab is opened; unrelated tabs are left intact.
Chrome relaunches: live element references, unsaved form values and transient page state are not preserved. Take a fresh snapshot and verify the result before continuing. `webctl browser status` reports
the current state as `"headless": true/false`. `hide` is optional, not mandatory — leave it
revealed if you expect to need the user again soon.

By default the agent drives **the first Chrome profile on the machine**, auto-detected. You do
not configure anything. `webctl browser status` reports which profile is active and why:

```bash
webctl browser status
# "displayName": "dy1"
# "managed": true
# "reason": "Chrome 153 ignores remote debugging on the real profile directory,
#            so the agent uses its own profile directory mirroring the first Chrome profile."
```

`managed: true` means Chrome runs on an agent-owned copy of the profile directory. This is
normal on Chrome 136 and newer, which refuses remote debugging on the real profile directory.
It is still a real Chrome profile: cookies and login state persist across tasks the same as any
Chrome profile does. The window itself is headless by default (see above) — `browser reveal`
it when the user needs to sign in there.

The agent never closes the user's own Chrome. If your Chrome window is holding the real profile,
the agent quietly uses its own directory instead.

To use a different profile:

```bash
webctl browser profiles                    # see what exists
webctl browser use --profile "Profile 2"   # pin it
webctl browser use --auto                  # back to the first profile
```

### Troubleshooting

| Symptom | Do this |
| --- | --- |
| Any browser failure: startup, daemon unreachable, unauthorized, Chrome not answering, the same error again | `browser_doctor` with `fix: true` (CLI `hyper-browsing doctor --fix`) once, then continue the task |
| The doctor cannot fix it | Report what it said to the user. Do not kill processes, set ports or touch profile folders |
| `Unknown session` | The tab is gone (closed, or swept after hours idle). Open a new session; nothing to repair |
| Need the daemon log | `<runtime>/browserd.log`; the runtime is in `~/.hyper-browsing/runtime-home.json` |
| Site logged out, or any login/CAPTCHA/2FA wall | `webctl browser reveal`, ask the user to sign in there, then retry |

### What keeps it running

| Hazard | Built-in answer |
| --- | --- |
| Several installs (skill folder, npx, another agent) | One runtime per machine: the first daemon records it in `~/.hyper-browsing/runtime-home.json`, every entry point uses it. One daemon, one Chrome, one signed-in profile. `WEBAGENT_RUNTIME_DIR` set by hand stays private. |
| Two starts at once | Daemon start and Chrome start each take a lock. Late callers wait and then use the instance the first one started. |
| A port is taken or reserved by Windows | The daemon never kills a process it does not own. It skips to the next free port. Chrome is started with `--remote-debugging-port=0`, picks a free port itself and announces it in `DevToolsActivePort`. |
| `chrome-state.json` lost or stale, daemon restarted | Chrome is found by the port it announced, and the daemon reattaches. Nothing is restarted. |
| Daemon restart while other agents work | Session ids are bound to Chrome tab ids (`sessions/tabs.json`), so every agent's session id stays valid after a restart. |
| Tabs left by finished or crashed tasks | Tabs idle for 6 h are closed at start and every 10 min. Above 20 tabs, the least recently used ones idle for 15 min are closed too. One tab always stays. Tune with `WEBAGENT_TAB_IDLE_HOURS` and `WEBAGENT_MAX_TABS`, or turn off with `WEBAGENT_TAB_SWEEP=0`. |
| Signed-out or deleted profile | Before Chrome starts, the login files are backed up at most once a day (3 kept, `<runtime>/profile-backups`). They are restored automatically when the cookies are gone. The profile folder carries a do-not-delete note. |
| `npm run clean` | Never closes Chrome unless asked (`--stop-chrome`). It skips the profile trim while Chrome runs. |
| Several agents at once | Session commands run side by side: one queue per session, so another agent never waits for a slow page. Chrome-wide commands (repair, profile switch, reveal/hide, close all, doctor fix, a headed fallback) wait until running session work ends, then run alone. Each session opens in its own background window. Chrome runs with background-throttling and window-occlusion off, so no agent's page stalls because another one's is in front. Set `WEBAGENT_WINDOW_PER_SESSION=0` for tabs instead of windows. |
| Work that needs its own browser | `session_open` with `isolated: true` (CLI `--isolated`). A second Chrome, at most one, starts on a throwaway profile with the main Chrome's cookies copied over CDP. Sign-ins made there are not kept, and some sites end the other login when one account is used in two browsers. It closes, and its folder is deleted, after 10 min without isolated sessions (`WEBAGENT_ISOLATED_IDLE_MIN`). |

Starting or repairing the browser is setup work. It is **not** completing the user's task.



명령 전송 후 응답을 놓친 경우 browser repair나 같은 명령 재전송으로 해결하지 않는다. 먼저 request status와 실제 페이지에서 결과를 확인한다.

자동 전환 결과는 응답의 headedFallback으로 확인한다. retried는 원래 요청의 안전한 재시도 여부이며 observationRequired이면 새 화면을 읽고 에이전트가 작업을 이어간다. 전환 실패는 error, 재시도 실패는 retryError로 보고하며 무한 반복하지 않는다. 전환 후 headed 설정은 유지되며 browser hide로 다시 headless를 선택할 수 있다. CAPTCHA·로그인·2FA를 자동 우회하지 않는다.

Missing targets and hidden controls alone do not establish a headless failure. Inspect pageState and observe the current target. Popup sessions inherit the parent preparation immediately; the already-started first request may precede locale setup and is never reloaded automatically.

### 응답이 늦는 복구 작업

RPC 응답 대기 35초를 넘겨도 원래 명령을 다시 전송하지 않는다. 클라이언트는 같은 원래 requestId의 request.status만 최대60초 추가 조회해 이미 진행 중인 작업의 완료 결과를 받는다. 이는 클릭·입력 재실행이 아니다. 상태 조회는 브라우저 실행 대기열을 건드리지 않으며 브라우저를 재시작하지 않는다.

완료 결과는 원래 requestId와 transportRecovery(kind=request_status, checks, waitedMs)를 포함한다. 새 탭, headedFallback, observationRequired, 실패/차단 정보와 전체 스냅샷을 보존한다. 조회 중 요청이 실패하면 실패 결과를 반환한다. 기록이 사라졌거나 상태 조회가 실패하거나 한도를 넘으면 outcome_unknown을 유지하고 수동 상태 조회 또는 현재 화면 확인으로 이어간다. 이 경우 launcher 재실행도 허용하지 않는다.

request.status 자체의 응답을 놓친 경우에는 상태 조회를 재귀적으로 이어가지 않는다. 이 흐름은 학습이나 자산 저장을 실행하지 않는다.
