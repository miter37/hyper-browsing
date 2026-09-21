# Threads (threads.com / threads.net) Automation Knowledge

## 1. 개요 및 세션
- **호스트**: `www.threads.com` (또는 `www.threads.net` 접속 시 리다이렉트)
- **인증**: Meta 통합 쿠키 기반. 인스타그램 계정에 로그인되어 있으면 Threads 접속 시 추가 로그인 없이 즉시 인증됨.

## 2. 주요 UI 패턴 및 셀렉터

### 1) 글 작성 (Create Post)
- 작성 창 열기: `span` (내용: `'새로운 스레드'`) 또는 상단 바의 글쓰기 아이콘
- 본문 입력: `div[role="textbox"][contenteditable="true"]` (CDP `Input.insertText` 사용)
- 발행: `div[role="button"], button` 중 텍스트가 `'게시'`인 버튼

### 2) 글 수정 (Edit Post)
- 게시물 메뉴 열기: 해당 포스트 카드 내부의 `svg[title="더 보기"]` (또는 `svg[aria-label="더 보기"]`)
  * 주의: 화면 좌측 상단 메뉴에도 `svg[aria-label="더 보기"]`가 있으므로, 반드시 해당 글 컨테이너 내부로 scope를 한정하여 타겟팅해야 함.
- 메뉴 선택: `'수정'` 텍스트를 가진 요소 클릭
- 수정 내용 반영: 텍스트 추가/수정 후 모달 하단의 `'게시'` 버튼 클릭

### 3) 글 삭제 (Delete Post)
- 포스트 카드 내 더 보기 클릭
- 메뉴 항목 중 `'삭제'` 클릭
- 확인 팝업(`role="dialog"`) 내 최종 `'삭제'` 확인 버튼 클릭
- 검증: 프로필 페이지에서 해당 글 텍스트가 완전히 사라졌는지 확인

### 4) 소셜 인터랙션 (Like, Reply, Follow)
- **좋아요**: `svg[title="좋아요"]` 클릭
- **답글 달기**:
  - 버튼: `svg[title="답글"]` 클릭
  - 입력창: 열린 인라인 에디터 `div[role="textbox"]`에 텍스트 입력
  - 등록: 하단 전송 아이콘인 `svg[aria-label="답글"]`의 부모 버튼 클릭
- **팔로우**: 피드 또는 추천 영역의 `svg[aria-label="팔로우"]` 부모 버튼 클릭
- **답글 확인**: 본인 프로필(`/@username`)의 `'답글'` 탭에서 등록된 답글 확인 가능
