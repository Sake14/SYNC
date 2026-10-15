import { z } from "zod";
export const trackSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string().min(1).max(200), artist: z.string().min(1).max(200),
  durationSeconds: z.number().positive(), cover: z.enum(["orbit", "bloom", "pulse"]).optional(),
  streamPath: z.string().regex(/^\/media\/[A-Za-z0-9_-]+\.(mp3|ogg|wav|m4a)$/),
});
export type Track = z.infer<typeof trackSchema>;
