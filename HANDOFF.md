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
- 1.0.10 (배포함): 켜기 전 점검 오탐 수정(설명에 줄바꿈 든 정보 파일 읽기, Forge 서버는 mods.toml 먼저, 안에 든 jar만 모드인 jar), 켜다가 멈춘 모드 감지(서버 튕김 로그의 "이름 (모드ID) encountered an error" 다음 줄이 invalid dist DEDICATED_SERVER면 그 모드를 끌지 묻는 목록에 넣음: mods.suggestFromCrash, 이유 startFail). 한계: 라이브러리가 대신 실패하는 경우(Framework ← controllable)는 못 잡음. 후보: Missing Mods Checker 팩(선릿밸리)의 CurseForge 모드 받기 안내
- 1.0.11 (배포함): Connector(connectormod) 있는 서버의 켜기 전 점검 오탐 수정, mods.toml 주석 무시, 켜다가 멈춘 클라이언트 모드 감지 강화, 버그 제보에 @관리자 호출(BUG_PING_ROLE)
- 1.0.12 (배포함): 모드팩 고르기 진행 표시·정렬 수정, 콘솔 ERROR 노란색·같은 줄 x2 묶기, localhost:포트 안내(i), 만들다 끊긴 서버 정리 알림, 서버 포트 칸(꺼졌을 때 주소 자리, 켜면 주소로), 설정의 포트 항목 삭제, CurseForge 모드가 든 서버의 .mrpack 내보내기 수정, 작업 번호 겹침 수정, 빠진 영어·중국어 번역 보충. 한계: 강제 종료 시 Java 설치 프로세스가 남을 수 있음
- 1.0.13 (배포함): 윗줄에 디스코드 서버 입장 버튼(초대 링크 https://discord.gg/Z6EdhRP9Ep 하나만 openExternal 허용). 알림함 채널은 Cloudflare 변수 NOTICE_CHANNEL_ID·PATCH_CHANNEL_ID로 읽음(채널을 새로 만들면 변수 바꾸고 재배포)
- 1.0.14 (배포함): 새 서버 만들기 화면 맨 위에 "초기 버전" 안내 상자(디스코드 서버 가입·버그 제보하기 버튼, 제보 창은 window 이벤트 open-bug-report로 엶), 버그 제보 창에 디스코드 가입 안내. 디스코드 로고는 DiscordLogo.tsx
- 1.0.15 (배포함): 터널 키가 playit에서 무효(InvalidAgentKey)면 저장된 키를 지우고 승인부터 다시 받음(tunnel.ts openTunnel, invite.ts useTunnel). 터널 안내 창은 열릴 때 승인 코드를 미리 만들어(prepareClaim) 링크를 바로 보여 줌. 시험용 환경 변수: MCSM_FAKE_INVITE=double-nat(공유기 실패 흉내), MCSM_FAKE_LINK=1(playit 연결 안 된 척, 승인 대기 화면)
- 이름 주소(1.0.16 예정, 아직 배포 전): 앱에서 이름을 정하면 이름.cubepanel.kr 이 사용자 공인 IP로 연결됨. 중계 relay/domain.mjs(+functions/api/domain.js)가 Cloudflare DNS에 A(+포트가 25565가 아니면 SRV) 기록을 만듦. 필요한 Cloudflare Pages 환경 변수(비밀): CF_DNS_TOKEN(DNS 편집 권한만), CF_ZONE_ID, 선택 DOMAIN_BASE(기본 cubepanel.kr). 주인 확인은 기록 메모(comment)에 열쇠 해시(cp:...)로. 우리가 만든 기록만 건드림, 같은 IP는 이름 10개, 기록 900개 넘으면 새 이름 막음. 앱: src/main/domain.ts, 서버·모드팩 만들기 창의 AddressMemory.tsx(주소 이름 입력 + 만들기 전에 중계 check로 확인 + 메모리 슬라이더). 서버를 다 만든 뒤 index.ts createServer 핸들러가 claimDomain, 서버 삭제 때 releaseDomain. 포트 칸은 없앴고 포트는 서버를 만들 때 freePort()가 자동으로(25565부터 겹치지 않게). 만든 뒤 이름을 바꾸는 화면은 없음. 시험용 MCSM_DOMAIN_RELAY. 한계: 공유기 포트가 열린 서버만(터널 주소는 못 바꿈), IPv4만, 주소에 IP가 노출됨
- 기존 서버 가져오기(미배포): 새 서버 만들기 화면의 "가져오기 > 기존 서버" 타일 → 폴더 고르기(pickServerFolder) → src/main/importserver.ts detectServer가 종류·버전 추정(Forge/NeoForge libraries 폴더, Fabric/Quilt 런처·로더 폴더, purpur/paper jar 이름·paper.yml·version_history.json, 바닐라 server.jar 안 version.json, 로그의 Starting minecraft server version) → ImportServerDialog에서 고치고 → createServer(options.importFrom)가 servers.ts importExisting으로 복사(logs·crash-reports·session.lock 제외, 원본은 그대로)하고 prepareImportedLaunch로 server.jar/로더 실행 파일이 없으면 채움(없으면 받기). 서버 정보 defaultsVersion을 최신으로 두어 앱 기본 설정이 덮어쓰지 않음. 원래 포트가 다른 서버와 겹치면 freePort로 바꿈. 한계: Spigot/Bukkit/CraftBukkit 자동 인식 없음(종류를 직접 고름), 실제 서버로 켜 보는 시험은 못 함
- 이름 주소 규모 대응(미배포): Cloudflare 무료 DNS 기록 한도가 영역당 200개라 3일 만에 가득 참(오류 81045 Record quota exceeded). relay/domain.mjs를 "이름 예약은 D1(binding 이름 DB), DNS 기록은 서버가 켜진 동안만" 구조로 바꿈. 동작: claim(예약 + DNS 기록 만들기/갱신, 앱이 서버를 켤 때와 켜 둔 동안 20분마다), offline(DNS 기록만 지움, 서버를 끌 때·앱을 닫을 때 앱이 부름), release(예약·기록 모두 지움), check. 예약은 30일 안 쓰면 풀림(건드릴 때 지연 삭제 + 새 이름 만들 때 청소). 기록이 한도(DNS_LIMIT, 기본 200)에 닿으면 켜졌다고 돼 있는데 STALE_ONLINE_HOURS(기본 12시간) 넘게 소식이 없는 기록을 치우고(예약은 유지), D1이 없던 때 만든 옛 기록은 같은 기준으로 치우면서 예약을 D1로 옮김. 켜 둔 서버·사이트 기록은 안 건드림. D1이 연결돼 있지 않으면 예전 방식(DNS 메모로만 주인 판단)으로 동작하고 offline은 아무것도 안 함(예약할 곳이 없어서). D1 만들기: 대시보드 Workers & Pages → D1 → 새 데이터베이스, Pages 프로젝트 Settings → Bindings → D1 database → 변수 이름 DB로 연결 후 재배포 (테이블은 중계 서버가 알아서 만듦). 앱: domain.ts setDomainOffline, invite.ts 하트비트·종료 때 정리, 이름을 만들 때 실패하면 domainWish로 기억했다가 서버를 켤 때 재시도. 시험: 가짜 Cloudflare+메모리 저장소+node:sqlite로 실제 SQL. 한계: 옛 앱(1.0.16)은 offline·하트비트를 안 보내서 켜 둔 채 12시간 넘으면 한도 압박 때 기록이 치워질 수 있음(서버를 다시 켜면 되살아남)
- 배드락 접속 수정·탭 개편(미배포): (1) BDS 1.26 기본 transport=nethernet은 TCP 인사 + 임의 UDP 포트라 UDP 하나만 여는 앱과 맞지 않아 server.properties를 transport=raknet, server-portv6=server-port로 만들고 켤 때마다 고쳐 둠(servers.ts startServerAt). (2) 스토어(UWP) 마인크래프트는 같은 PC 서버에 접속 불가(루프백 차단) → main/bedrockloopback.ts 상태 읽기 + 버튼으로 관리자 확인 창을 띄워 CheckNetIsolation LoopbackExempt 등록(BedrockLoopbackNotice.tsx, 서버 화면·접속 안내). 같은 PC 주소는 127.0.0.1(이 PC 게임은 localhost 이름을 못 받아들임). (3) 배드락 탭: 콘솔·관리·애드온·리소스 팩·스크립트·맵·백업·설정 파일(AddonsTab에 kind를 주어 탭마다 같은 컴포넌트, 맵 탭은 지금 월드+.mcworld 가져오기+CurseForge 맵). 스크립트 팩은 manifest 모듈 type script로 구분(InstalledAddon.script). (4) 켜기 전 점검: bedrock.ts checkAddons(필요한 팩 없음·꺼져 있음·중복·월드에 켜 둔 팩이 지워짐) → preflight.ts, PreflightDialog는 result.kind가 있으면 애드온 문구. (5) 자바 월드 탭(MapTab.tsx, 관리 탭 바로 옆, 배드락도 같은 위치·이름): 지금 월드·하드코어·월드 리셋(WorldResetDialog 안에 새 월드/내 월드·zip/맵 받기가 이미 있어서 탭에는 따로 안 둠)·게임 규칙(GameRulesDialog, 관리 탭에서 옮김)·월드 설정(SettingsDialog.tsx WORLD_FIELDS: PvP·명령 블록·동물/주민/몬스터 생성·네더·보이는/움직이는 거리·스폰 보호·월드 크기·건축 높이). 서버 설정 창에서는 월드 탭·월드 리셋·하드코어를 뺌. 배드락 맵 탭에도 월드 리셋·게임 규칙을 두고 배드락 설정 창에서는 뺌
- 터널 이름 주소(미배포): 공유기로 못 열어 playit 터널로 열린 서버도 이름.cubepanel.kr 이 터널로 연결됨. 앱이 터널 주소(xxx.joinmc.link 또는 xxx.ply.gg:포트)에서 호스트·포트를 알아내(domain.ts tunnelTarget, 포트 없으면 SRV 조회) 릴레이에 target으로 보내면 SRV만 만듦(relay TUNNEL_HOST_RE로 joinmc.link·ply.gg·playit.gg·playit.cloud만 허용). 실제 playit 터널에서는 아직 못 시험함
- 배드락 서버(BDS, 미배포): 만들기 화면의 "배드락 서버" 타일. src/main/bedrock.ts(공식 다운로드 API net-secondary.web.minecraft-services.net 로 최신 윈도우용만 받음, minecraft.net은 앱 User-Agent를 막아서 download.ts headers 옵션으로 브라우저 UA 사용) · 서버는 bedrock_server.exe 직접 실행(runner.ts bedrock 옵션: 시작 "Server started.", 접속자 "Player connected/disconnected", UDP 포트 확인) · 포트 19132부터(freePort(true), IPv6용 +1도 비워 둠) · 기본 allow-list=true라 만들 때 false로 · 접속은 UDP: upnp.ts openPort/closePort protocol, tunnel.ts udp(minecraft-bedrock) · 이름 주소는 SRV를 못 읽는 배드락 특성상 A 기록만(릴레이 bedrock:true), 포트가 19132가 아니면 접속할 때 포트를 따로 입력, 터널로 열린 배드락은 이름 주소 불가 · 월드는 worlds/<level-name> (backup.ts·servers.ts worldFolders), 켠 채 백업은 save hold/query/resume · 애드온: AddonsTab.tsx, bedrock.ts addAddonFile(.mcaddon/.mcpack/.zip → behavior_packs/resource_packs + worlds/<level>/world_*_packs.json 등록), 기본 팩은 만들 때 .server-manager-bedrock.json에 적어 두고 목록에서 뺌 · 설정 창은 BedrockSettingsDialog.tsx(자바용 SettingsDialog와 별개) · 서버 화면 탭은 콘솔·애드온·백업·설정 파일만. 추가분: 관리 탭 BedrockManageTab.tsx + main/bedrockmanage.ts(허용 목록은 켜진 서버면 allowlist 명령, 꺼진 서버면 allowlist.json 직접 수정 / 관리자·내보내기·공지·시간·날씨·난이도·게임 모드, 게임 규칙은 "gamerule" 한 줄 출력 파싱해 기존 GameRulesDialog 재사용, 관리자 여부는 permissions.json의 xuid와 로그에서 읽은 xuid로 판별) · 자동 동작(자동 켜기·매일 재시작·빈 서버 끄기·환영 메시지(tellraw rawtext))은 BedrockSettingsDialog에 있음 · 서버 업데이트 main/bedrockops.ts updateBedrock(월드 백업 후 server.properties·allowlist·permissions·worlds·config 기존 파일은 두고 나머지만 교체, 서버 화면에 새 버전 알약) · 월드 가져오기 importBedrockWorld(.mcworld/.zip/폴더, level.dat+db 필요, 켜 둔 애드온 등록 이어받기, 서버 만들기 창과 설정 창에서) · CurseForge(게임 78022: 애드온 4984, 리소스 팩 6929, 스크립트 6940, 맵 6913, 중계 서버가 gameId를 막지 않아 그대로 됨) 검색·설치는 curseforge.ts searchBedrockStore/downloadBedrockHit + AddonsTab · 접속 안내 BedrockJoinHelp.tsx(콘솔은 서버 추가 메뉴가 없다고 안내). 한계: 하드코어·월드 종류(BDS server.properties에 없음)·옛 버전·스크립트 API 베타 설정 없음, 화면은 눈으로 확인 못 함, 폰·콘솔 실접속과 playit UDP 터널은 시험 못 함. 시험: npm run test:full -- --only=bedrock (실제 서버 받아 켜 봄)
- 1.0.16 (배포함): 서버 주소 이름(이름.cubepanel.kr, Cloudflare 함수 /api/domain, 서버 만들 때 필수·기존 서버는 켤 때 정함), 기존 서버 폴더 가져오기, 서버 만들기 창을 가로 2열 한 화면으로 개편(프로필·이름·설명·버전·주소·최대 인원 / 월드·정품 인증·메모리), 서버 포트 칸 삭제(포트는 만들 때 자동), 게임 모드 서바이벌 고정
- 1.1.0 (배포함, 처음 1.0.17로 냈다가 올림): 배드락 서버(공식 BDS: 만들기·월드 가져오기·애드온/리소스팩/스크립트/맵 탭·CurseForge 검색·업데이트·허용 목록·게임 규칙·접속 안내·UWP 루프백 허용·UDP 포트 열기/터널), 월드 탭(자바·배드락 공통, 관리 탭 옆; 게임 규칙·월드 설정·빠른 스위치 "몹 생성" 등), 이름 주소: 터널 사용자용 SRV·배드락(A만)·IPv6(AAAA)·IPv4 우선 요청·D1 예약+켜진 동안만 DNS·30일 정리·20분 하트비트, 배드락 설정 창을 자바식 탭으로, 새 서버 만들기 화면 한 화면 배치(바닐라 옆 배드락, 모드팩 옆 가져오기), 월드 폴더를 서버로 가져오려 할 때 안내 문구
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
