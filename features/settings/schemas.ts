import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  image: z.union([z.literal(""), z.url()]).optional(),
}).strict();

export const emailChangeRequestSchema = z.object({
  newEmail: z.string().trim().email().max(254).toLowerCase(),
  password: z.string().min(1).max(128),
}).strict();

export const emailChangeTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();
