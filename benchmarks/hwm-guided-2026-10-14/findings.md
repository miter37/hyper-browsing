# 문법 안내 포함 시행의 발견

제품을 바꾸지 않고 테스트 근거를 누적한다. 사이트 예외를 추가하지 않는다. 앱 오류, 관찰/표현 한계, agent 판단 및 과업 수행 절차, 사이트 화면·네트워크 문제를 구분한다.

## Best Buy 진행 중

- Luna가 직접 받은 문법으로 gap4종, scan/end 구분, selected-complete, 실행completed/과업성공 구분을 정확히 설명했다. 문서 읽기 지시만 제공한 조건과 다르다.
- 저장 focus/inspect/expand를 실제 사용했다. 무효화된 참조는 stale_ref/not_started로 거부됐고 새 관찰로 복구했다. 오래된 참조가 유사 대상으로 실행되지 않았다.
- URL st와 입력/검색결과를 확인했고 Logitech facet URL/칩/checkbox 상태를 함께 읽었다. 실행completed만으로 필터 적용을 선언하지 않았다.
- list가 div.sidebar-facets를 반환했다. found=true는 반복 그룹을 찾았다는 사실이지 상품 목록 발견을 뜻하지 않는다. 실제 카드 부재와 그룹 선택 정책 문제를 아직 분리 확정하지 않는다. 여러 그룹/범위의 후보를 노출하는 공통 개선을 검토할 근거다.
- 상품 영역은 비어 있어 추가 화면/DOM 확인중. scan.complete=false만으로 정보가 반드시 보관된 접힘 안에 있다고 생각하면 안 된다. 실제 빈 화면과 수집누락을 구분해야 한다.

## Walmart

- 문법의 개념을 설명할 수 있었고 HWM 카드소속/링크 inspect와 선택상태를 실제 수행에 썼다. 그런데 eval10회/총45CLI로 완료했으므로 설명만으로 효율 문제가 해결됐다고 볼 수 없다.
- 잘못된 eval --expression, focus='n' 등의 호출 오류가 남았다. 초기 메시지에 허용된 명령/인자 사례까지 제공하는 것과 문법의 의미 교육을 구분해야 한다.
- 라디오 체크 후 View results로 적용해야 했으며 URL sort=price_low가 결과 적용 근거였다. checked 변화만으로 목록정렬 완료를 선언하지 않은 점은 목표한 사용법이다.
- human-verification 신호 뒤 정상 필터화면·적용결과가 관찰됐다. 신호시점과 현재 상태를 함께 보고하며 오탐 원인을 추정하지 않는다. 제품 CAPTCHA 규칙은 수정하지 않았다.
- 제목의 색상 Red와 선택값 Actual Color Black이 달랐다. 값 출처/조건/상품 변형 선택을 함께 보존할 필요를 보여준다. 의미를 앱이 고쳐 쓰거나 사이트별 가격규칙을 넣지 않는다.
- 상품가격은 기존 action snapshot, 배송은 screenshot으로 보완했다. HWM 후보/원문범위가 있어도 접근 비용을 줄일 필요가 남았다.

## Expedia 진행 중

- 초기 메시지의 문법 이해 확인을 받았고 정상 숙소 UI/목적지 선택을 진행했다.
- 달력의 17/19일 버튼 이름과 월/연도를 확인하기 위해 eval이 추가됐다. HWM의 정보 유무뿐 아니라 dialog/폼/실제 후보 범위를 빠르게 조회하는 경로가 필요한지 분석한다.
- 수집된 query/matches와 overview의 선택 우선순위가 연결되는지 소스 확인이 필요하다. 현재 projection.ts의 overview priority는 region/heading/dialog/실행요소/전체노드 순이고 graph.matches는 우선 배열에 직접 쓰지 않는다. 관찰상 fallback의 유일 원인이라고 단정하지 않으며, 일반 로컬 HTML로 후속 검증할 후보다.
