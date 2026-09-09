import { z } from "zod";

// Storage accepts future bundled theme IDs. Renderers choose a local fallback
// for versions they do not support; they must not overwrite the saved choice.
export const accountPreferencesSchema = z.object({
  theme: z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    version: z.int().min(1).max(2147483647),
  }),
  revision: z.int().nonnegative(),
});

export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
