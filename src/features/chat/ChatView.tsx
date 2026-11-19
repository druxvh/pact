import { MessageCircleMore, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState } from '@/components/ui';
import { ActivityThread } from '@/features/activity/ActivityThreads';
import { threadFromSub, threadLink } from '@/features/activity/describe';
import { useUnreadActivity } from '@/features/activity/hooks';
import { ConversationList } from '@/features/chat/ConversationList';
import { FriendsDialog } from '@/features/chat/FriendsDialog';
import { NewGroupDialog } from '@/features/chat/NewGroupDialog';
import { selectTotalUnread, useChatStore } from '@/features/chat/store';
import { Thread } from '@/features/chat/Thread';
import { CommunitiesView, inviteCodeFromSub } from '@/features/community/CommunitiesView';
import { communityLinkFromSub } from '@/features/community/notifications';
import { useCommunityUnreadTotal } from '@/features/community/useCommunityStore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useNavStore } from '@/store/useNavStore';
import { ME_ID, useUserStore } from '@/store/useUserStore';

/** The direct-message experience (friends and group chats), unchanged. */
function DirectMessages() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const sub = useNavStore((s) => s.sub);
  const go = useNavStore((s) => s.go);
  const requests = useUserStore((s) => s.friendRequests);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [friendsOpen, setFriendsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);
  /** A real person's note / song activity thread, when one is open (instead of a simulated chat). */
  const [threadId, setThreadId] = useState<string | null>(null);

  const pendingRequests = requests.filter((r) => r.status === 'pending' && r.toId === ME_ID).length;

  // Deep link: #/chat/<conversationId> (notifications use this), or #/chat/a:<personId> for a note / song activity thread.
  useEffect(() => {
    if (sub && conversations.some((c) => c.id === sub)) {
      setActive(sub);
      setThreadId(null);
      setMobileThread(true);
    }
    const person = threadFromSub(sub);
    if (person) {
      setThreadId(person);
      setMobileThread(true);
    }
  }, [sub, conversations, setActive]);

  // On desktop show the last open conversation, or the most recent one.
  useEffect(() => {
    if (!isDesktop || activeId || conversations.length === 0) return;
    const latest = [...conversations].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0];
    if (latest) setActive(latest.id);
  }, [isDesktop, activeId, conversations, setActive]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const open = (id: string) => {
    setActive(id);
    setThreadId(null);
    setMobileThread(true);
    go('chat', id, { replace: true });
  };

  const openThread = (personId: string) => {
    setThreadId(personId);
    setMobileThread(true);
    go('chat', threadLink(personId), { replace: true });
  };

  // If the open conversation is deleted, fall back to the list.
  useEffect(() => {
    if (!active && !threadId) setMobileThread(false);
  }, [active, threadId]);

  const showList = isDesktop || !mobileThread;
  const showThread = isDesktop || mobileThread;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-background/40">
      {showList && (
        <ConversationList
          activeId={threadId ? null : (active?.id ?? null)}
          activeThreadId={threadId}
          onSelectThread={openThread}
          onSelect={open}
          onNewGroup={() => setGroupOpen(true)}
          onFriends={() => setFriendsOpen(true)}
          pendingRequests={pendingRequests}
        />
      )}

      {showThread &&
        (threadId ? (
          <ActivityThread key={threadId} personId={threadId} onBack={() => setMobileThread(false)} />
        ) : active ? (
          <Thread key={active.id} conversation={active} onBack={() => setMobileThread(false)} />
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <EmptyState
              icon={MessageCircleMore}
              title={conversations.length ? 'Pick a conversation' : 'No conversations yet'}
              description={conversations.length ? 'Choose a chat on the left to read it.' : 'Add a friend by username and say hi.'}
              action={
                <Button variant="primary" onClick={() => setFriendsOpen(true)}>
                  <UserPlus /> Add a friend
                </Button>
              }
              className="max-w-sm border-0"
            />
          </div>
        ))}

      <FriendsDialog open={friendsOpen} onOpenChange={setFriendsOpen} onOpenChat={open} />
      <NewGroupDialog open={groupOpen} onOpenChange={setGroupOpen} onCreated={open} />
    </div>
  );
}

type Tab = 'communities' | 'dms';
const TAB_KEY = 'pact-chat-tab';

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'dms' ? 'dms' : 'communities';
  } catch {
    return 'communities';
  }
}

/** Two tabs: Communities (invite-only groups, first) and Direct messages (friends and small groups). */
export function ChatView() {
  const [tab, setTab] = useState<Tab>(readTab);
  const sub = useNavStore((s) => s.sub);
  const conversations = useChatStore((s) => s.conversations);
  const unread = useChatStore(selectTotalUnread) + useUnreadActivity();
  const communityUnread = useCommunityUnreadTotal();

  // Notification and invite links choose their own tab.
  useEffect(() => {
    if (inviteCodeFromSub(sub) || communityLinkFromSub(sub)) setTab('communities');
    else if ((sub && conversations.some((c) => c.id === sub)) || threadFromSub(sub)) setTab('dms');
  }, [sub, conversations]);

  const choose = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/40">
      <div role="tablist" aria-label="Chat" className="flex h-11 shrink-0 items-end gap-1 border-b px-3">
        {(
          [
            { id: 'communities', label: 'Communities', icon: <Users className="size-4" aria-hidden="true" /> },
            { id: 'dms', label: 'Direct messages', icon: <MessageCircleMore className="size-4" aria-hidden="true" /> },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`chat-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="chat-panel"
            onClick={() => choose(t.id)}
            className={`-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${tab === t.id ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.icon}
            {t.label}
            {t.id === 'dms' && unread > 0 && <Badge tone="brand">{unread}</Badge>}
            {t.id === 'communities' && communityUnread > 0 && <Badge tone="brand">{communityUnread > 99 ? '99+' : communityUnread}</Badge>}
          </button>
        ))}
      </div>
      <div id="chat-panel" role="tabpanel" aria-labelledby={`chat-tab-${tab}`} className="flex min-h-0 min-w-0 flex-1">
        {tab === 'communities' ? <CommunitiesView /> : <DirectMessages />}
      </div>
    </div>
  );
}

// Back-compat alias (the section loader and older code referred to this name).
export const ChatroomsView = ChatView;
