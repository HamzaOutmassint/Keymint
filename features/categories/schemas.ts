import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().max(40).default("folder"),
});
