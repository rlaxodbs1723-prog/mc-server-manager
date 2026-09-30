; 앱을 지울 때: 같이 지울 것을 체크박스로 고르는 화면을 보여 준다 (기본은 아무것도 안 지움).
; 자동 업데이트(안에서 지우고 다시 깔기)나 조용히 지우기(/S)일 때는 화면 없이 아무것도 지우지 않는다.
; 자바(runtime 폴더)는 어느 경우에도 지우지 않는다 (크고, 다시 설치하면 또 받아야 해서).
; 데이터 폴더는 앱 이름과 상관없이 %APPDATA%\mc-server-manager (src/main/datapath.ts)

!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  Var CpChkSettings
  Var CpChkServers
  Var CpDelSettings
  Var CpDelServers

  ; 자동 업데이트는 조용히(/S) 지우고 다시 깔아서 이 화면이 뜨지 않는다
  Function un.CpPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 20u "같이 지울 것을 골라 주세요. 아무것도 체크하지 않으면 앱만 지워요."
    Pop $0
    ${NSD_CreateCheckbox} 0 26u 100% 12u "앱 설정과 임시 파일"
    Pop $CpChkSettings
    ${NSD_CreateLabel} 13u 40u 100% 12u "서버·백업·자바는 남아요. 다시 설치하면 그대로 쓸 수 있어요."
    Pop $0
    ${NSD_CreateCheckbox} 0 62u 100% 12u "만든 서버와 백업 전부"
    Pop $CpChkServers
    ${NSD_CreateLabel} 13u 76u 100% 20u "월드·모드·설정이 모두 사라지고 되돌릴 수 없어요. 자바는 남아요."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function un.CpPageLeave
    ${NSD_GetState} $CpChkSettings $CpDelSettings
    ${NSD_GetState} $CpChkServers $CpDelServers
  FunctionEnd
!endif

!macro customUnWelcomePage
  UninstPage custom un.CpPageCreate un.CpPageLeave
!macroend

!macro cpDeleteSettings
  Delete "$APPDATA\mc-server-manager\app-settings.json"
  Delete "$APPDATA\mc-server-manager\window.json"
  Delete "$APPDATA\mc-server-manager\server-order.json"
  Delete "$APPDATA\mc-server-manager\create-times.json"
  Delete "$APPDATA\mc-server-manager\curseforge-key.txt"
  Delete "$APPDATA\mc-server-manager\update-log.txt"
  RMDir /r "$APPDATA\mc-server-manager\lang"
  RMDir /r "$APPDATA\mc-server-manager\world-temp"
  RMDir /r "$APPDATA\mc-server-manager\modpack-temp"
  RMDir /r "$APPDATA\mc-server-manager\Cache"
  RMDir /r "$APPDATA\mc-server-manager\Code Cache"
  RMDir /r "$APPDATA\mc-server-manager\GPUCache"
  RMDir /r "$LOCALAPPDATA\mc-server-manager-updater"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${if} $CpDelServers == ${BST_CHECKED}
      RMDir /r "$APPDATA\mc-server-manager\servers"
      RMDir /r "$APPDATA\mc-server-manager\backups"
      !insertmacro cpDeleteSettings
    ${elseif} $CpDelSettings == ${BST_CHECKED}
      !insertmacro cpDeleteSettings
    ${endIf}
  ${endIf}
!macroend
