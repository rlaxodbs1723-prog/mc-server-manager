// 메인 프로세스에서 직접 보여 주는 글(트레이 메뉴, 윈도우 알림, 파일 고르기 창)을 앱 언어로 바꾼다.
// 화면(렌더러)에 보내는 글은 화면 쪽에서 바꾸므로 여기서 바꾸지 않는다.
import { translator } from '../i18n'
import { getAppSettings } from './appsettings'

export const tr = (s: string): string => translator(getAppSettings().language)(s)
