// Netlify 쪽 CurseForge 중계 (내용은 relay/cf.mjs). 키는 Netlify 환경 변수에만 둔다
import { handleCf } from '../../relay/cf.mjs'

export default (req) => handleCf(req, process.env)

export const config = { path: '/api/cf/*' }
