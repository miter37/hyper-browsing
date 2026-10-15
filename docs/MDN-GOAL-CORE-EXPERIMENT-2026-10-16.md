# MDN: 보완 후 목표 코어 실험

2026-10-16 08:18 KST · GPT-6 Codex · b48af36

## 과업과 실행 환경

프로젝트 SKILL.md와 scripts/launcher.mjs를 사용해 루트가 직접 수행했다. dy1 headed Chrome의 빈 탭 restored_2b182792를 재사용했다. 설치된 별도 스킬·바닐라·외부 검색·eval·학습은 사용하지 않았다. 실험 중 제품 코드 수정 없음.

과업: MDN 홈에서 검색 UI를 열고 Array.prototype.map을 입력한 직후 상태와 자동완성을 확인한다. 정확한 Array 문서를 선택하고, 기본 사용법과 원본 배열 변경에 관한 근거를 필요한 구역만 읽는다.

## 과정

1. goto 홈, find Search로 Skip to search 링크와 검색 버튼 둘을 받았다. Search the site라는 관찰된 버튼을 선택했다. 임의의 첫 후보 선택은 하지 않았다.
2. 클릭에 introduced의 역할 집합 combobox/searchbox/textbox와 동일 follow를 붙였다. 새 dialog 안 combobox 한 개를 한 응답으로 받았다. 역할 기반 조회와 조건부 후속 조회가 작동했다.
3. fill에 value 확인 + introduced Array.prototype.map 후보 등장 확인 + follow를 붙였다. expanded false→true, 값 변경, Search results listbox의 후보가 함께 나왔다. option과 그 안 link, TypedArray 대안, 전체 사이트 검색 등이 중복으로 잡혔다. 총6건/표시5건이었다. 복수 후보여도 검증 confirmed였다.
4. 이름과 href의 Array/TypedArray 차이를 보고 정확한 Array/map 링크를 선택했다. 기대 pathname 확인과 heading 후속 조회가 같은 응답에 나왔다. heading 두 개여도 동작은 completed로 유지됐다. 초기 이동부터 문서 이동까지 5호출(goto/find/click/fill/click)이었다.
5. 내용 검색에서 roles=[paragraph]를 추측해 지정했더니 0건이었다. 실제 현재 수집 결과의 p는 role을 제공하지 않는다. 역할 제한을 제거해 소개/반환 설명 문단을 얻었다. 모델 운영 오류와 관찰기 역할 어휘 차이를 구별한다.
6. 코드와 부작용 설명은 지도→document 패널 outline→해당 section의 content로 조회했다. 지도 첫8개에는 본문 main 패널이 없어서 나머지2개를 추가 조회했으나 역시 없었다. document 패널 개요로 필요한 제목 범위를 찾았다. 전체 문서 innerText로 우회하지 않았다.
7. 제곱근 예제 S8은 39개 출력 항목이었다. limit30에 코드가 중간에서 잘려 nextRead로 나머지9개를 읽었다. 부작용 S12는 145개 항목 중30개를 읽고, 첫 문장의 callback can have side effects를 확인했다. 과업에 필요하지 않은 나머지는 읽지 않았다.

## 페이지 근거와 답

대상 문서: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map

소개와 반환값 문단은 각 원소의 callback 반환값을 담은 새 배열을 만든다고 설명했다. 예제는 `const numbers = [1, 4, 9]; const roots = numbers.map((num) => Math.sqrt(num));`이며 roots=[1,2,3], numbers는 여전히 [1,4,9]라는 주석을 확인했다. 별도 Side-effectful mapping 섹션은 callback의 부작용이 가능하다고 설명한다. 따라서 예제의 원본 유지와 임의 callback의 무부작용 보장은 구별한다.

## 측정

14 CLI: goto1/find4/click2/fill1/snapshot2/read4. 실제 조작은 검색창 열기/입력/문서 선택3건이며 goto1을 별도 집계한다. CLI 시간 합10.925초, 벽시계56.526초, stdout26,091B. 준비용 session list/browser status와 보고서 작성은 제외했다. 토큰 수는 측정하지 않았다. raw: .runtime/mdn-goal-core-commands.jsonl.

Booking 실험40호출/584.674초/100,169B보다 작지만 과업과 사이트가 다르므로 수정의 전체 성능 개선율로 해석하지 않는다.

## 다음 보완 근거

- 검색 UI와 자동완성: 조건부 동반 조회가 실제로 추가 snapshot 없이 작동했다. 복수 내용 존재 검증과 단일 실행 대상 선택의 분리가 유효했다.
- 코드 읽기: syntax highlighting span과 구두점이 독립 text 항목으로 출력된다. pre/code의 언어·원문·줄바꿈·소속을 보존한 코드 블록 투영이 필요하다. 부분 코드로 충분한 것처럼 보이지 않게 잘림도 유지해야 한다. MDN 선택자나 도메인 규칙을 제품에 넣을 이유는 없다.
- 지도 순서: 중요 본문을 찾으려고 첫8개 이후 추가 지도 조회가 발생했다. 패널 샘플의 문서 순서와 본문 우선 제공 간 비용을 검토할 근거다. 없는 main을 만들어내서는 안 된다.
- 후보 중복: option과 내부 link가 함께 나와 6건 중5건만 표시됐다. 자동 병합 대신 포함 관계를 짧게 표시하거나 질의에 관찰한 역할을 쓰는 방식이 적합하다.

이번에는 경험을 기록하고 종료했다. 위 추가 개선은 아직 구현하지 않았다.
