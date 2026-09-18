export type OfficeUser = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
};

export type ChatMessage = {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
};
