import { useChatStore } from '@/features/chat/store';
import { isUserId } from '@/features/nowplaying/api';
import { sendMessage } from '@/store/demoServer';
import { contextLine, snippet, threadLink } from './describe';
import { useActivityStore } from './hooks';
import type { MessageContext } from './types';

export type ReplyResult = { where: 'activity' | 'chat'; sub: string };

/**
 * Send a private reply about a note or a song. A real person gets a real activity message (it lands in their bell and in the thread
 * with you under Direct messages). A simulated friend gets it in your simulated chat with them, quoting what you replied to, and
 * answers the way the simulated friends do.
 */
export async function sendPrivateReply(to: string, text: string, context: MessageContext | null): Promise<ReplyResult> {
  if (!isUserId(to)) {
    const conversationId = useChatStore.getState().ensureDm(to);
    const about = contextLine(context);
    sendMessage({ conversationId, body: about ? `Re: “${snippet(about, 60)}” — ${text}` : text });
    return { where: 'chat', sub: conversationId };
  }
  await useActivityStore.getState().sendReply(to, text, context);
  return { where: 'activity', sub: threadLink(to) };
}
