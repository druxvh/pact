export type OfficeUser = {
  id: string;
  displayName: string;
  username: string;
  designation?: string;
  bio?: string;
  email?: string;
  avatarUrl?: string;
  isOnline: boolean;
};

export type ChatMessage = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
};

export type FriendRequest = {
  id: string;
  fromId: string;
  toId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
};
