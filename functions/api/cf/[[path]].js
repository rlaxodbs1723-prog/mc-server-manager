// Cloudflare Pages 쪽 CurseForge 중계 (내용은 relay/cf.mjs). 키는 Pages 환경 변수(비밀)에만 둔다
import { handleCf } from '../../../relay/cf.mjs'

export const onRequest = ({ request, env }) => handleCf(request, env)
