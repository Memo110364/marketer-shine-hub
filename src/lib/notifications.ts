import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type AppNotification = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link_path: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export const NOTIFICATIONS_KEY = ["notifications"] as const;

/**
 * The signed-in user's latest notifications (RLS already scopes the table to
 * them). Realtime keeps the bell honest when it is enabled on the project;
 * the polling interval is the fallback for when it is not.
 */
export function useNotifications(limit = 30) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: [...NOTIFICATIONS_KEY, userId, limit],
    enabled: !!userId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AppNotification[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
          qc.invalidateQueries({ queryKey: PENDING_SPEND_REQUESTS_KEY });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const items = query.data ?? [];
  return {
    ...query,
    items,
    unreadCount: items.filter((n) => !n.read_at).length,
  };
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export const PENDING_SPEND_REQUESTS_KEY = ["pending-spend-requests"] as const;

export type PendingSpendRequest = {
  id: string;
  transaction_id: string;
  marketer_id: string;
  action: "update" | "delete";
  reason: string | null;
  proposed_data: Record<string, unknown> | null;
  requested_by: string;
  created_at: string;
  marketers: { name: string } | null;
};

/**
 * Every ad-spend change/delete request still waiting for a decision, used for
 * the "there is an edit waiting over here" badges in the sidebar, the
 * marketers list and the ad-spend page. RLS limits this to what the viewer is
 * allowed to see (admins: all; account managers: their own marketers).
 */
export function usePendingSpendRequests() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: [...PENDING_SPEND_REQUESTS_KEY, user?.id ?? null],
    enabled: !!user?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_spend_change_requests")
        .select(
          "id, transaction_id, marketer_id, action, reason, proposed_data, requested_by, created_at, marketers(name)",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PendingSpendRequest[];
    },
  });

  const items = query.data ?? [];
  const countByMarketer: Record<string, number> = {};
  for (const r of items) {
    countByMarketer[r.marketer_id] = (countByMarketer[r.marketer_id] ?? 0) + 1;
  }
  return { ...query, items, count: items.length, countByMarketer };
}
