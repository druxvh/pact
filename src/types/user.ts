export type Person = {
  id: string;
  displayName: string;
  username: string;
  designation?: string;
  bio?: string;
  email?: string;
  avatarUrl?: string;
  isOnline: boolean;
};

export type FriendRequest = {
  id: string;
  fromId: string;
  toId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
};
