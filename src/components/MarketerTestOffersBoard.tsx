import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtCurrency, fmtDate, fmtNumber } from "@/lib/format";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

type OfferRow = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  daily_test_budget: number;
  duration_days: number;
  max_marketers: number;
  status: "open" | "closed";
  products?: { name: string } | null;
};

type ClaimRow = {
  id: string;
  offer_id: string;
  marketer_id: string;
  accepted_at: string;
};

export function MarketerTestOffersBoard({ marketerId }: { marketerId: string }) {
  const qc = useQueryClient();

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ["marketer-test-offers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_product_offers")
        .select("*, products(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as OfferRow[]).filter((o) => o.status === "open");
    },
  });

  const { data: allClaims = [] } = useQuery({
    queryKey: ["marketer-test-offer-claims"],
    queryFn: async () => {
      const { data, error } = await supabase.from("test_product_offer_claims").select("*");
      if (error) throw error;
      return data as ClaimRow[];
    },
  });

  const accept = useMutation({
    mutationFn: async (offerId: string) => {
      const { error } = await supabase
        .from("test_product_offer_claims")
        .insert({ offer_id: offerId, marketer_id: marketerId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل قبولك للتيست");
      qc.invalidateQueries({ queryKey: ["marketer-test-offer-claims"] });
    },
    onError: (e: any) => toast.error(e.message ?? "فشل التسجيل"),
  });

  const withdraw = useMutation({
    mutationFn: async (claimId: string) => {
      const { error } = await supabase.from("test_product_offer_claims").delete().eq("id", claimId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إلغاء قبولك");
      qc.invalidateQueries({ queryKey: ["marketer-test-offer-claims"] });
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الإلغاء"),
  });

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  if (offers.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          لا توجد منتجات متاحة للتيست حاليًا
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {offers.map((o) => {
        const offerClaims = allClaims.filter((c) => c.offer_id === o.id);
        const myClaim = offerClaims.find((c) => c.marketer_id === marketerId);
        const full = offerClaims.length >= o.max_marketers;
        return (
          <Card key={o.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-sm">{o.products?.name ?? o.product_name ?? "—"}</span>
                <FlaskConical className="h-4 w-4 text-[var(--info)] shrink-0" />
              </div>
              <div className="text-xs text-muted-foreground">
                البادجيت المسموح: <b className="text-foreground">{fmtCurrency(o.daily_test_budget)}</b> / يوم
              </div>
              <div className="text-xs text-muted-foreground">
                مدة التيست: <b className="text-foreground">{fmtNumber(o.duration_days)}</b> يوم
              </div>
              <div className="text-xs text-muted-foreground">
                الأماكن: {fmtNumber(offerClaims.length)} / {fmtNumber(o.max_marketers)}
              </div>

              {myClaim ? (
                <div className="space-y-1.5 pt-1">
                  <Badge variant="outline" className="text-[11px]">
                    تم القبول في {fmtDate(myClaim.accepted_at)}
                  </Badge>
                  <Button
                    size="sm" variant="outline" className="w-full text-destructive"
                    onClick={() => withdraw.mutate(myClaim.id)}
                    disabled={withdraw.isPending}
                  >
                    إلغاء القبول
                  </Button>
                </div>
              ) : full ? (
                <Button size="sm" className="w-full" disabled>الأماكن اكتملت</Button>
              ) : (
                <Button
                  size="sm" className="w-full"
                  onClick={() => accept.mutate(o.id)}
                  disabled={accept.isPending}
                >
                  Accept
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
