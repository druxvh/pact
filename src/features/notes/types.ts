export type Notebook = {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
};

export type Note = {
  id: string;
  notebookId: string;
  number: number; // #1, #2
  title: string;
  body: string;
  assigneeId?: string | null;
  updatedAt: string;
  createdAt: string;
};
