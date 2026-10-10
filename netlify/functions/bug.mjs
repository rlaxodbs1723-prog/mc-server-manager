// Netlify 쪽 버그 제보 중계 (내용은 relay/bug.mjs). 웹훅·봇 토큰은 Netlify 환경 변수에만 둔다
import { handleBug } from '../../relay/bug.mjs'

export default (req) => handleBug(req, process.env)

export const config = { path: ['/api/bug', '/api/bug/replies'] }
