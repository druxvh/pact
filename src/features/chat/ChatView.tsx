import { MessageCircleMore, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, EmptyState } from '@/components/ui';
import { ConversationList } from '@/features/chat/ConversationList';
import { FriendsDialog } from '@/features/chat/FriendsDialog';
import { NewGroupDialog } from '@/features/chat/NewGroupDialog';
import { useChatStore } from '@/features/chat/store';
import { Thread } from '@/features/chat/Thread';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useNavStore } from '@/store/useNavStore';
import { ME_ID, useUserStore } from '@/store/useUserStore';

export function ChatView() {
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

  const pendingRequests = requests.filter((r) => r.status === 'pending' && r.toId === ME_ID).length;

  // Deep link: #/chat/<conversationId> (notifications use this).
  useEffect(() => {
    if (sub && conversations.some((c) => c.id === sub)) {
      setActive(sub);
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
    setMobileThread(true);
    go('chat', id, { replace: true });
  };

  // If the open conversation is deleted, fall back to the list.
  useEffect(() => {
    if (!active) setMobileThread(false);
  }, [active]);

  const showList = isDesktop || !mobileThread;
  const showThread = isDesktop || mobileThread;

  return (
    <div className="flex h-full min-h-0 bg-background/40">
      {showList && (
        <ConversationList
          activeId={active?.id ?? null}
          onSelect={open}
          onNewGroup={() => setGroupOpen(true)}
          onFriends={() => setFriendsOpen(true)}
          pendingRequests={pendingRequests}
        />
      )}

      {showThread &&
        (active ? (
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

// Back-compat alias (the section loader and older code referred to this name).
export const ChatroomsView = ChatView;
