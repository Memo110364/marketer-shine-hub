import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type OwnMarketer = { id: string; name: string; marketer_code: string };

/** The marketer record linked to the currently logged-in user, for marketer-role pages. */
export function useOwnMarketer() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-marketer", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketers")
        .select("id, name, marketer_code")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as OwnMarketer | null;
    },
  });
}
