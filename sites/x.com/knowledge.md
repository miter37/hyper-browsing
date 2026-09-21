# X (구 트위터 - x.com) 웹 자동화 가이드

## 1. 포스팅 및 삭제 메커니즘
- **포스팅 작성**:
  - 홈 타임라인 상단의 `[data-testid="tweetTextarea_0"]`에 `Input.insertText`로 텍스트 입력.
  - `[data-testid="tweetButtonInline"]` 클릭하여 게시.
- **포스팅 삭제**:
  - 작성된 트윗 우측 상단의 `[data-testid="caret"]` 클릭.
  - 메뉴에서 `[role="menuitem"]` 중 'Delete' 항목 클릭.
  - 삭제 확인 팝업의 `[data-testid="confirmationSheetConfirm"]` 클릭하여 완전 삭제.

## 2. 팔로워 및 맞팔로우 (Follow Back)
- **팔로워 목록 경로**: `https://x.com/{handle}/followers`
- **맞팔로우**:
  - `[data-testid="UserCell"]` 내부에서 버튼 텍스트가 'Follow back'인 요소를 찾아 클릭.

## 3. 답글 및 댓글 달기 (Reply)
- 가상 스크롤 렌더링 특성상 타겟 트윗이 뷰포트 밖에 있으면 클릭이 씹힐 수 있음.
- **반드시 타겟 트윗을 `scrollIntoView({ block: 'center' })`로 스크롤한 뒤** `[data-testid="reply"]` 아이콘을 클릭하여 답글 모달을 오픈.
- 텍스트 입력 후 `[data-testid="tweetButton"]` 클릭으로 답글 전송.
