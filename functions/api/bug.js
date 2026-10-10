// Cloudflare Pages 쪽 버그 제보 중계 (내용은 relay/bug.mjs)
import { handleBug } from '../../relay/bug.mjs'

export const onRequest = ({ request, env }) => handleBug(request, env)
