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
the execution and recovery guidance and a screenshot. Session IDs, current URLs, explicit viewport/locale and profile cookies are restored across reveal/hide.
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
| Any browser command fails, Chrome vanished | `webctl browser repair`, then continue the task |
| Startup or profile problem you cannot diagnose | `webctl browser status` and report its `reason` field |
| Need the daemon log | `.runtime/browserd.log` (last 100 lines) |
| Port already in use | The agent picks a free port automatically; if it still fails, set `WEBAGENT_PORT` |
| Site logged out, or any login/CAPTCHA/2FA wall | `webctl browser reveal`, ask the user to sign in there, then retry |

Starting or repairing the browser is setup work. It is **not** completing the user's task.



명령 전송 후 응답을 놓친 경우 browser repair나 같은 명령 재전송으로 해결하지 않는다. 먼저 request status와 실제 페이지에서 결과를 확인한다.

자동 전환 결과는 응답의 headedFallback으로 확인한다. retried는 원래 요청의 안전한 재시도 여부이며 observationRequired이면 새 화면을 읽고 에이전트가 작업을 이어간다. 전환 실패는 error, 재시도 실패는 retryError로 보고하며 무한 반복하지 않는다. 전환 후 headed 설정은 유지되며 browser hide로 다시 headless를 선택할 수 있다. CAPTCHA·로그인·2FA를 자동 우회하지 않는다.

Missing targets and hidden controls alone do not establish a headless failure. Inspect pageState and observe the current target. Popup sessions inherit the parent preparation immediately; the already-started first request may precede locale setup and is never reloaded automatically.

### 응답이 늦는 복구 작업

RPC 응답 대기 35초를 넘겨도 원래 명령을 다시 전송하지 않는다. 클라이언트는 같은 원래 requestId의 request.status만 최대60초 추가 조회해 이미 진행 중인 작업의 완료 결과를 받는다. 이는 클릭·입력 재실행이 아니다. 상태 조회는 브라우저 실행 대기열을 건드리지 않으며 브라우저를 재시작하지 않는다.

완료 결과는 원래 requestId와 transportRecovery(kind=request_status, checks, waitedMs)를 포함한다. 새 탭, headedFallback, observationRequired, 실패/차단 정보와 전체 스냅샷을 보존한다. 조회 중 요청이 실패하면 실패 결과를 반환한다. 기록이 사라졌거나 상태 조회가 실패하거나 한도를 넘으면 outcome_unknown을 유지하고 수동 상태 조회 또는 현재 화면 확인으로 이어간다. 이 경우 launcher 재실행도 허용하지 않는다.

request.status 자체의 응답을 놓친 경우에는 상태 조회를 재귀적으로 이어가지 않는다. 이 흐름은 학습이나 자산 저장을 실행하지 않는다.
