// 앱 이름(productName)이 바뀌어도 데이터 폴더는 예전 그대로 쓴다 (%APPDATA%/mc-server-manager).
// 이름을 따라 폴더가 바뀌면 만들어 둔 서버·백업·설정이 안 보이게 된다. 다른 모듈보다 먼저 불러야 한다
import { app } from 'electron'
import path from 'path'

app.setPath('userData', path.join(app.getPath('appData'), 'mc-server-manager'))
