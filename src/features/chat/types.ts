export type AttachmentKind = 'image' | 'video';

/** Metadata only — the bytes live in IndexedDB (see idb.ts), so localStorage stays small. */
export type Attachment = {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  mime: string;
  /** Images only — lets the thread reserve space so loading doesn't shift the layout. */
  width?: number;
  height?: number;
};

export type Reaction = { emoji: string; by: string[] };

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  attachments?: Attachment[];
  replyTo?: string;
  reactions?: Reaction[];
  /** Soft-deleted: kept as a tombstone so replies to it still make sense. */
  deleted?: boolean;
};

export type Conversation = {
  id: string;
  kind: 'dm' | 'group';
  /** Groups only. */
  name?: string;
  participantIds: string[];
  createdAt: string;
  lastMessageAt: string;
  /** Messages from others created after this are "unread". */
  lastReadAt: string;
};

/** Hard limit for a single attachment (matches the Image tool's "fit under 5 MB"). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 4000;
