import { z } from "zod";

export const credentialSchema = z.object({
  name: z.string().trim().min(1).max(120),
  username: z.string().trim().max(255),
  email: z.union([z.literal(""), z.email()]).optional(),
  website: z.union([z.literal(""), z.url()]).optional(),
  password: z.string().min(1).max(1024),
  notes: z.string().max(10_000).optional(),
  categoryId: z.string().min(1).max(128).nullable().optional(),
  favorite: z.boolean().default(false),
});
