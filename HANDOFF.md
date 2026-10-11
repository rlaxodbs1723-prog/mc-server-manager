# 인수인계 메모 (새 세션용)

- 반드시 한국어(해요체)로 답할 것. 사람을 가리킬 때는 "친구" 말고 "플레이어".
- 프로젝트: Electron + TypeScript + React(electron-vite) 마인크래프트 서버 매니저. `npm start`로 실행, `npm run typecheck`, `npm run build`.
  - 뒤쪽(src/main) 코드를 고치면 앱을 껐다 켜야 적용된다 (dev 모드가 main을 다시 읽지 않음). 사용자에게 매번 알려 줄 것. 화면만 바꿨으면 Ctrl+R.
  - 코드 모양: prettier `--no-semi --single-quote --print-width 160 --trailing-comma none` (기본 설정으로 돌리면 모양이 깨짐).
- UI: 토스 느낌 다크 테마, Pretendard, 강조색 #3182F6, frameless 타이틀바.
- 코드 수정은 Edit/Write 도구나 스크래치패드에 쓴 python 패치 파일로 (셸 인라인 스크립트는 따옴표·백슬래시가 깨짐).
- 화면 자동 클릭·스크린샷 자동화 금지. 로그·파일로만 검증. main 코드는 esbuild로 묶어 node로 직접 돌려 볼 수 있음 (electron은 가짜 모듈로).
- UI 문제를 지적받으면 같은 모양의 다른 곳도 전부 같이 고치고, 고친 곳을 알려 줄 것.
- 고친 뒤에는 보통 "내가 테스트해 볼 것"을 물어봄 → 확인 목록으로 답하기.
- git 저장소 (GitHub: rlaxodbs1723-prog/mc-server-manager, 공개). 앱 이름은 MC CubePanel.
- 배포: `npm run dist` → dist/의 exe·blockmap·latest.yml을 GitHub 릴리즈에 올리고 Publish (자동 업데이트가 latest.yml을 읽음).
- 사이트: docs/ (cubepanel.kr = Cloudflare Pages, GitHub에서 자동 배포. 예전 cubepanel.netlify.app은 1.0.7 이하 앱의 중계용으로 남겨 두고 사이트는 cubepanel.kr로 넘긴다). 방문·버튼 클릭 수는 GoatCounter(cubepanel.goatcounter.com).
- 비밀값: CurseForge 키와 버그 제보 디스코드 웹훅은 앱에 넣지 않는다. 중계 코드는 relay/에 있고, Cloudflare Pages 함수(functions/)와 Netlify 함수(netlify/functions/)가 같이 쓴다. 환경 변수 CURSEFORGE_KEY, BUG_WEBHOOK, DISCORD_BOT_TOKEN은 두 곳의 대시보드에만 둔다.
- 버그 제보 답장: 디스코드에서 제보 메시지에 "답장"하면 앱이 30분마다 /api/bug/replies로 받아 간다. Netlify 환경 변수 DISCORD_BOT_TOKEN(봇: 메시지 기록 읽기 + Message Content Intent)이 필요하다.
- 알림함(타이틀바 편지 아이콘): 디스코드 공지 채널·패치노트 채널에 쓴 글을 /api/inbox(relay/inbox.mjs)로 보여 준다. 첫 줄이 제목. Cloudflare 환경 변수 NOTICE_CHANNEL_ID, PATCH_CHANNEL_ID (봇이 그 채널을 읽을 수 있어야 함).
  .env는 절대 커밋하지 말 것. 올리기 전에 .env의 값이 HEAD에 없는지 확인.

## 완료 (사용자가 확인함)
- 서버 7종 만들기(4단계 설정 창, 싱글 월드·zip·CurseForge 맵으로 시작 가능), 설치 중단, 타이틀바 작업 목록(버전 바꾸기·모두 업데이트 등 오래 걸리는 일도 표시)
- 모드팩으로 만들기: Modrinth·CurseForge 찾아보기 + .mrpack/CurseForge zip 가져오기
- 콘솔(검색·경고만·자동완성·아래로 따라가기·맨 아래로 버튼), 관리 탭, 게임 규칙, 설정 7탭 + 버전 바꾸기(저장하면 작업 목록에서 진행), 하드코어(확인 창 없이 켜짐, 저장해야 적용)
- 모드/플러그인/데이터팩 탭: 설치·업데이트·버전 바꾸기·켜고 끄기·끌어다 놓기, 설치된 목록 검색, 기록 없는 파일은 sha1로 알아봄(사이트 오류면 30초마다 다시)
- 검색: [전체 | Modrinth | CurseForge] 선택(기억함). 전체일 때 같은 모드는 "로더 이름 뺀 이름 + 만든 사람"이 같을 때만 합침. 다른 사이트에서 받은 같은 이름이 있으면 "같은 이름 설치됨" 표시 후 설치 전에 한 번 물어봄(막지 않음)
- 서버에 맞지 않는 모드(src/main/clientjar.ts): 클라이언트 전용(jar 정보 파일 / Modrinth 서버 미지원) + 서버에서 튕기는 모드(양쪽 mixin 목록에 net.minecraft.client를 고치는 일반 mixin이 있고 required). 바로 끄지 않고 서버 화면에서 "끌지" 물어봄(OffSuggestDialog). 켜 두기로 한 것은 파일 이름·모드 ID로 기억해서 다시 안 물음
- 서버 켜기 전 점검(src/main/preflight.ts): 빠진 필수 모드, 메모리가 정말 모자랄 때, 새로 생긴 "서버에 맞지 않는 모드". 한 번 "그래도 켜기"한 내용은 바뀌기 전까지 다시 안 물음. 결과는 파일 크기·수정 시각으로 캐시
- 백업(켤 때 + 정기, 개수 설정)·복원, 튕김 감지·분석(원인만 표시)·자동 재시작
- UPnP 초대 + 접속 확인, 사용량(CPU·메모리·TPS 숫자 + 경고), 트레이, 윈도우 알림
- playit.gg 터널 (src/main/tunnel.ts): UPnP 실패 시 빨간 표시 → "터널로 열기" → 브라우저 승인(계정 필요) → 키는 userData/playit/secret.txt. 한 번 승인하면 UPnP 실패 때 자동 터널. 시험: MCSM_FAKE_INVITE=no-upnp npm run dev
- 서버 목록: 우클릭 메뉴, 끌어서 순서 바꾸기, 이름 바꾸기·복제, 두 번째 줄(켜짐: 접속 인원·켠 시간 / 꺼짐: 모드 수·마지막 백업)
- 완성도: 되돌리기 알림(모드·데이터팩 지우기는 6초 뒤 실제로 지움), 상태 기억(마지막 서버, 서버별 탭, 창 크기·위치), 작업 중 닫으면 트레이로 숨었다가 끝나면 종료,
  타이틀바 "Modrinth/CurseForge 연결 안 됨" 표시(안 되는 동안 1분마다 다시 확인), 열고 닫을 때 애니메이션(닫힐 때는 src/renderer/src/leave.ts), 움직임 줄이기 설정 존중
- Modrinth 502·503은 두 번 더 해 봄

- 1.0.9 (2026-10-11 빌드, 아직 GitHub에 안 올렸을 수 있음 → 확인할 것):
  - 채팅 탭 (src/main/chatlog.ts, ChatLogTab.tsx): 날짜별 로그(같은 날 파일 합침), 26.x의 "System chat: "·"[Not Secure] " 떼고 읽음, 사망·발전 과제는 게임 번역(en_us→ko_kr)으로, 보관 기간(서버별 logKeepDays, 기본 30일, 서버 켤 때 정리), 5초마다 새로 읽기, 맨 아래로 버튼
  - 플레이어 정보 (src/main/playerdata.ts, PlayerDialog.tsx): world/players/data/<uuid>.dat (예전 playerdata/), 접속 중이면 `data get entity 이름 필드`로 실시간(5초, 서버 로그에 남아서 필요한 필드만), 체력·배고픔 따로 회복, 아이템 주기·순간이동은 사용자가 뺌
  - 인벤토리 그림 (src/main/gameassets.ts, Inventory.tsx): Mojang 클라이언트 jar(userData/game-assets/<버전>.jar)와 mods/*.jar의 텍스처·모델을 그대로 씀. 블록은 모델 상자를 캔버스에 직접 그림(실제 화면 픽셀 크기로, 동쪽 면=왼쪽·북쪽 면=오른쪽, display.gui 각도·크기·위치, 부품 회전, 면 그림 회전, 덮인 면 생략, 줄여 그릴 때만 부드럽게). 칸은 게임 GUI 3배(54px). 개수는 게임 글꼴(ascii.png), 반짝임은 enchanted_glint_item.png
  - 특수 아이템(게임이 코드로 그림): 상자(걸쇠, 앞면 오른쪽), 몹 머리, 드래곤 머리(상자 7개, 주둥이 오른쪽), 셜커 상자, 배너·방패(앞모습 평평하게), 전달체, 장식된 항아리, 구리 골렘 조각상(근사). 풀·잎·덩굴 색, 물약 종류별 색, 염색 가죽 색
  - 들어왔던 플레이어 창(관리 탭 버튼, 사용자가 다시 원함), 초대 주소 옆 "내 접속: localhost"
  - 접속 확인(레이더)이 실패하면 빨간 표시로 바꾸고 터널 안내 창을 띄움 (playit 연결돼 있으면 바로 터널). 전에는 알림만 떠서 터널을 못 열었음
- 1.0.9 빌드 뒤 커밋(다시 빌드 필요): 아이템 그림 수정 전부, 선택 버튼 낱말 안 자르기, 배고픔 회복 버튼 줄바꿈
- 1.0.10 예정(커밋됨, 아직 빌드 안 함): 켜기 전 점검 오탐 수정(설명에 줄바꿈 든 정보 파일 읽기, Forge 서버는 mods.toml 먼저, 안에 든 jar만 모드인 jar), 켜다가 멈춘 모드 감지(서버 튕김 로그의 "이름 (모드ID) encountered an error" 다음 줄이 invalid dist DEDICATED_SERVER면 그 모드를 끌지 묻는 목록에 넣음: mods.suggestFromCrash, 이유 startFail). 한계: 라이브러리가 대신 실패하는 경우(Framework ← controllable)는 못 잡음. 후보: Missing Mods Checker 팩(선릿밸리)의 CurseForge 모드 받기 안내
- 아이템 그림 점검 방법: 스크래치패드에서 electron으로 getItemIcons를 돌려 모든 아이템(1,658개)을 표로 그려 보고, 모델 파일을 훑어 처리 안 하는 기능(회전, display 등)을 찾았다

## 사용자가 뺀 것 (다시 넣지 말 것)
자리 비움 내보내기, 접속자 목록 숨기기, 설정의 난이도/게임 모드, Spigot, 모드팩 업데이트, 플레이어 정보 창의 아이템 주기·순간이동,
튕김 창의 해결 버튼·안내·관련 모드 이름(Fabric API 같은 기본 모드만 예외), 사용량 그래프, 서버 종류 설명 문구.
CurseForge 앱 Instances 폴더에서 막힌 모드를 자동으로 복사해 오지 말 것.

## 남은 일
0. 1.0.9를 GitHub에 안 올렸으면 지금 커밋까지 넣어 다시 빌드할지 사용자에게 물을 것. 상자·드래곤 머리 방향은 사용자가 앱을 껐다 켠 뒤 확인 대기 중
1. 후보: 단축키, 디스코드 알림, 방패·배너 무늬, 플레이어 머리 실제 스킨, 알림함 30분마다·사용 통계 하루 한 번(한도 아끼기)
2. 알려진 작은 문제: 모드를 연달아 지우면 알림이 하나라서 앞의 것은 되돌리기 버튼이 사라짐 (사용자가 이번엔 안 고치기로 함)
3. 남은 허점: 모드팩 overrides가 eula.txt·server-manager.json·server.properties를 덮어쓸 수 있음, CurseForge 모드팩 파일은 받은 뒤 검증 안 함
4. 1.0.5까지의 exe와 저장소 기록(dist-next)에 예전 CurseForge 키가 들어 있음 → 1.0.6이 퍼지면 CurseForge 키를 새로 발급하고 예전 키를 정지할 것
