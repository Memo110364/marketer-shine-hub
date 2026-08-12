import { supabase } from "@/integrations/supabase/client";

/**
 * Calls a Supabase Edge Function and throws on error, mirroring the
 * throw-on-failure contract the UI already expects from TanStack Start
 * server functions (see parseServerError in connect-meta.tsx).
 */
export async function invokeFn<T>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const errBody = await context.json();
        if (errBody?.error) message = errBody.error;
      } catch {
        /* response body wasn't JSON — keep the original message */
      }
    }
    throw new Error(message);
  }
  return data as T;
}
