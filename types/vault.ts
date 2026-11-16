export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
  /** Older category records omit this field and are treated as unpinned. */
  pinned?: boolean;
  updatedAt: string;
  _count: { credentials: number };
};
export type Credential = {
  id: string;
  name: string;
  username: string;
  email?: string | null;
  website?: string | null;
  /** Present only in unlocked, decrypted client memory. Never serialized by a server credential API. */
  password: string;
  notes?: string | null;
  categoryId?: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string;
  lastViewed?: string | null;
  category?: Pick<Category, "id" | "name" | "color" | "icon"> | null;
};
export type Activity = {
  id: string;
  timestamp: string;
  device: string;
  browser: string;
  os: string;
  ip: string;
  action: string;
  description: string;
};
