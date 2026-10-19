import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft, Copy, Check, ExternalLink, Shield, Sparkles, Link2, Loader2,
} from "lucide-react";
import { invokeFn } from "@/lib/edge-functions";

export const Route = createFileRoute("/_authenticated/ad-accounts_/connect-meta")({
  component: ConnectMetaPage,
});

// Our Business Portfolio ID on Meta — the marketer pastes this into their
// own "Assign Partner" dialog on facebook.com. Not a secret: it's the same
// ID Meta already shows publicly to anyone who shares an asset with us.
const META_BUSINESS_ID = "2233922704106237";

function ConnectMetaPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isMarketer = role === "marketer";
  const backTo = isMarketer ? ("/my-ad-performance" as const) : ("/ad-accounts" as const);
  const backLabel = isMarketer ? "أداء إعلاناتي" : "حسابات الإعلانات";

  const [copied, setCopied] = useState(false);
  const [adAccountId, setAdAccountId] = useState("");

  const copyBusinessId = async () => {
    try {
      await navigator.clipboard.writeText(META_BUSINESS_ID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذر النسخ — انسخ الرقم يدويًا");
    }
  };

  const connect = useMutation({
    mutationFn: async () => {
      const link = await invokeFn<{ adAccountId: string; accountName: string }>("meta-oauth", {
        action: "verify_and_link",
        ad_account_id: adAccountId,
      });
      // Pull the first batch of performance data right away — best-effort,
      // a sync hiccup here must never undo a successful link.
      try {
        await invokeFn("meta-insights-sync", { ad_account_id: link.adAccountId, days: 30 });
      } catch (syncError) {
        console.error("[ConnectMeta] initial sync failed (non-fatal):", syncError);
      }
      return link;
    },
    onSuccess: (link) => {
      toast.success(`تم ربط "${link.accountName}" بنجاح وجاري سحب بيانات الأداء`);
      navigate({ to: backTo });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "تعذر ربط الحساب");
    },
  });

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-12" dir="rtl">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link to={backTo} className="hover:text-foreground">{backLabel}</Link>
          <ChevronLeft className="h-3 w-3" />
          <span>ربط حساب Meta</span>
        </div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          ربط حساب Meta الإعلاني
        </h1>
        <p className="text-sm text-muted-foreground mt-1">خطوتين على فيسبوك، وخطوة هنا — وخلاص</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          <Step number={1} title="شارك حسابك مع صفحتنا على فيسبوك">
            <p className="text-sm text-muted-foreground leading-relaxed">
              افتح إعدادات حساباتك الإعلانية على فيسبوك، اختار حسابك، وادخل على{" "}
              <b className="text-foreground">"Assign Partner"</b> (أو{" "}
              <b className="text-foreground">"شركاء"</b>).
            </p>
            <a
              href="https://business.facebook.com/settings/ad-accounts"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              افتح إعدادات الحسابات الإعلانية <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Step>

          <Step number={2} title="الصق الكود ده في خانة Business ID">
            <p className="text-sm text-muted-foreground leading-relaxed">
              واختار صلاحية <b className="text-foreground">"View Performance"</b> (قراءة فقط — مش هنقدر نعدّل أو نحذف أي حاجة في حسابك).
            </p>
            <div className="flex items-center gap-2">
              <Input value={META_BUSINESS_ID} readOnly dir="ltr" className="font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={copyBusinessId} title="نسخ">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </Step>

          <Step number={3} title="الصق رقم حسابك الإعلاني هنا ودوس ربط">
            <p className="text-sm text-muted-foreground leading-relaxed">
              رقم الحساب (Ad Account ID) هتلاقيه في نفس صفحة إعدادات الحسابات الإعلانية.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
                placeholder="مثال: 123456789012345"
                dir="ltr"
              />
              <Button
                onClick={() => connect.mutate()}
                disabled={!adAccountId.trim() || connect.isPending}
                className="shrink-0 min-w-32"
              >
                {connect.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Link2 className="h-4 w-4 ml-1" />}
                ربط الحساب
              </Button>
            </div>
          </Step>

          <div className="rounded-xl border border-success/30 bg-success/5 p-3 flex items-start gap-2.5">
            <Shield className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              مش هنقدر ننشئ أو نعدّل أو نحذف أي إعلان — الصلاحية دي قراءة بيانات الأداء والإنفاق بس.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({
  number, title, children,
}: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="h-7 w-7 shrink-0 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-bold">
        {number}
      </div>
      <div className="flex-1 space-y-2 pt-0.5">
        <Label className="text-sm font-semibold">{title}</Label>
        {children}
      </div>
    </div>
  );
}
