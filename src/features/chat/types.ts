export type ChatAttachment = {
  id: string;
  type: 'image' | 'gif' | 'video';
  url: string;
  name?: string;
  size?: number;
};

export type ChatMsg = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  replyTo?: string;
};

export type Conversation = {
  id: string;
  participantIds: string[];
  isSpace?: boolean;
  spaceName?: string;
  lastMessageAt: string;
};
