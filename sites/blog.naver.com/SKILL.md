# 네이버 블로그 (SmartEditor ONE)

## Write a post in one go
Prepare the whole post as one HTML fragment, then paste it. Never type a post key by key.
- Saved actions: `write_post` {title, html} → review → `publish_post` {category, visibility}.
  They are code actions: the daemon runs them only with `WEBAGENT_ALLOW_CODE_ACTIONS=1`.
- Without code actions, the same thing from a shell (finds the agent's Chrome through chrome-state.json):
  `node sites/blog.naver.com/post.mjs --title "제목" --html post.html --category 매일매일 --visibility 비공개 [--publish]`
  Without `--publish` it stops with the post written in a new tab. `--list-categories` lists the blog's categories.
- Publishing is an external write: only when the user asked for it. Default visibility is 비공개.

## HTML that pastes well (all checked live)
| Want | Write | Becomes |
|---|---|---|
| Section heading | `<p><span style="font-size:24px"><b>…</b></span></p>` | 24 bold |
| Sub-heading | `<p><span style="font-size:19px"><b>…</b></span></p>` | 19 bold |
| Body | `<p>…</p>` (15 is the editor default) | text |
| Blank line | `<p><br></p>` | empty line |
| Emphasis / colour | `<b>`, `<span style="color:#00a84e">`, grey `#888888` | kept |
| List | `<ul><li>…</li></ul>` | bullet list |
| Table | `<table><tr><th>…</th></tr><tr><td>…</td></tr></table>` | table component |
| Quote / key line | `<blockquote><p>…</p></blockquote>` | centred quote |
| Divider | `<hr>` | full-width line |
`<h2>/<h3>` also paste, but come out barely larger than body text; the font-size spans give a clear hierarchy.

## How the editor works (if the scripts break)
- `GoBlogWrite.naver` redirects to `/{blogId}?Redirect=Write`, which frames the editor in `mainFrame`. Open
  `PostWriteForm.naver?blogId={blogId}` directly: the editor is then the top-level page.
- Clicking the title or body moves focus into a hidden same-origin iframe whose `<body>` is contenteditable
  (its URL reads `about:blank` in a fresh tab, so find it by `document.body.isContentEditable`, not by address).
  Typed keys and pastes go there, so `fill` on `.se-*` elements fails ("not contenteditable").
- Empty title/body show placeholder spans (`.se-placeholder`: "제목", "글감과 함께…"); don't count them as content.
- The paste is a `ClipboardEvent("paste")` with a `DataTransfer` dispatched on that iframe's body (see `editor.mjs`).
  The system clipboard is never used. Going through the OS clipboard instead had two failures:
  Windows `Set-Clipboard -AsHtml` garbled Korean, and the user copying something meanwhile replaced the post.
- Publish layer: header `button[class*=publish_btn]` opens it. Category radios have ids like `32_매일매일`
  (click `label[for=id]`). Visibility radios: `open_public`, `open_neighbor`, `open_both_neighbor`, `open_private`.
  Final button: `[data-testid=seOnePublishBtn]`. Success redirects to `PostView.naver?blogId=…&logNo=…`.
- A private category forces 비공개 (the other visibility radios are disabled).
- The editor scrolls inside its own container: `scroll` does not move it. Read text instead of screenshotting long posts.
- Leaving an editor tab keeps an autosaved draft (임시저장). Opening the editor again offers to continue it; the
  scripts decline (`.se-popup-button-cancel`), and the draft stays in 임시저장 until deleted.
