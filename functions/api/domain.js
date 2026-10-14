// Cloudflare Pages 쪽 이름 주소 (내용은 relay/domain.mjs)
import { handleDomain } from '../../relay/domain.mjs'

export const onRequest = ({ request, env }) => handleDomain(request, env)
