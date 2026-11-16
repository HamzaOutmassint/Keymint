import { z } from "zod";

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(10),
  rememberMe: z.boolean().default(false),
});
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  password: z.string().min(12).max(128),
});
