export type Notebook = {
  id: string;
  name: string;
  memberIds: string[];
  /** Next `#number` to hand out — a counter so numbers are never reused after deletes. */
  nextNumber: number;
  createdAt: string;
};

export type Note = {
  id: string;
  notebookId: string;
  /** Per-notebook `#1`, `#2`… reference. */
  number: number;
  title: string;
  body: string;
  pinned: boolean;
  assigneeId: string | null;
  updatedAt: string;
  createdAt: string;
};
