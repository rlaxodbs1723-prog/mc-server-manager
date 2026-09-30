; 앱을 지울 때: 설정·받아 둔 파일, 만든 서버·백업을 지울지 물어본다.
; 자동 업데이트(안에서 지우고 다시 깔기)나 조용히 지우기(/S)일 때는 묻지 않고 아무것도 지우지 않는다.
; 데이터 폴더는 앱 이름과 상관없이 %APPDATA%\mc-server-manager (src/main/datapath.ts)

!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent cp_done
    MessageBox MB_YESNO|MB_ICONQUESTION "앱 설정과 받아 둔 파일(자바 등)도 지울까요?$\r$\n$\r$\n만든 서버와 백업은 남아요. 다시 설치하면 서버를 그대로 쓸 수 있어요." IDNO cp_ask_servers
      Delete "$APPDATA\mc-server-manager\app-settings.json"
      Delete "$APPDATA\mc-server-manager\window.json"
      Delete "$APPDATA\mc-server-manager\server-order.json"
      Delete "$APPDATA\mc-server-manager\create-times.json"
      Delete "$APPDATA\mc-server-manager\curseforge-key.txt"
      Delete "$APPDATA\mc-server-manager\update-log.txt"
      RMDir /r "$APPDATA\mc-server-manager\runtime"
      RMDir /r "$APPDATA\mc-server-manager\lang"
      RMDir /r "$APPDATA\mc-server-manager\world-temp"
      RMDir /r "$APPDATA\mc-server-manager\modpack-temp"
      RMDir /r "$APPDATA\mc-server-manager\Cache"
      RMDir /r "$APPDATA\mc-server-manager\Code Cache"
      RMDir /r "$APPDATA\mc-server-manager\GPUCache"
      RMDir /r "$LOCALAPPDATA\mc-server-manager-updater"
    cp_ask_servers:
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "만든 서버와 백업도 모두 지울까요?$\r$\n$\r$\n월드·모드·설정이 전부 사라지고 되돌릴 수 없어요. 서버를 남기려면 '아니요'를 누르세요." IDNO cp_done
      RMDir /r "$APPDATA\mc-server-manager"
      RMDir /r "$LOCALAPPDATA\mc-server-manager-updater"
    cp_done:
  ${endIf}
!macroend
