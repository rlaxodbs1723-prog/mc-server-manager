// Cloudflare Pages 쪽 알림함 (내용은 relay/inbox.mjs)
import { handleInbox } from '../../relay/inbox.mjs'

export const onRequest = ({ request, env }) => handleInbox(request, env)
