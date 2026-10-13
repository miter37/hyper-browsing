# 브라우저와 사용자 개입

## 7. Browser and profile

### Headless by default — reveal it when a human needs to see it

The browser runs **headless (no visible window) by default.** You never need a visible window
just to snapshot, click, fill, or extract — that all works the same either way. Switch to a
visible window only when a person actually has to look at or interact with the page:

```bash
webctl browser reveal   # open a real, visible Chrome window
# ... tell the user what you need from them, and wait for them to act ...
webctl browser hide     # optional: back to headless when done
```

Reveal for: a login wall, a CAPTCHA, 2FA, or a failure you cannot explain after checking
section 6's "when a known action fails" list and a screenshot. Every open session keeps working across reveal/hide — same tabs, same
URLs, same login state; only the window's visibility changes. `webctl browser status` reports
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
