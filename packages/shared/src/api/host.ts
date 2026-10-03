import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH } from "../constants.ts";

export const Host = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
});
export type Host = z.infer<typeof Host>;
