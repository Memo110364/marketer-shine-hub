import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Shield, Image as ImageIcon,
  PlayCircle, Loader2, Link2, Building2, Wallet, IdCard, HelpCircle,
  ArrowRight, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  startMetaOAuth,
  listMetaAccounts,
  linkMetaAccount,
} from "@/lib/meta-oauth.functions";

export const Route = createFileRoute("/_authenticated/ad-accounts_/connect-meta")({
  validateSearch: (s: Record<string, unknown>) => ({
    step: typeof s.step === "string" ? Number(s.step) : undefined,
    state: typeof s.state === "string" ? s.state : undefined,
  }),
  component: ConnectMetaWizard,
});

const STEPS = [
  { id: 1, label: "فحص الجاهزية" },
  { id: 2, label: "كيف يعمل الربط" },
  { id: 3, label: "تعليمات بالصور" },
  { id: 4, label: "بدء الربط" },
  { id: 5, label: "اختيار الحساب" },
  { id: 6, label: "تم الربط" },
];

type MockAccount = {
  id: string;
  name: string;
  externalId: string;
  currency: string;
  business: string;
};

const MOCK_ACCOUNTS: MockAccount[] = [
  { id: "1", name: "Marsilia Brand - Main", externalId: "act_103928374562", currency: "EGP", business: "Marsilia Trading" },
  { id: "2", name: "American Eagle EG", externalId: "act_948372615028", currency: "EGP", business: "AE Egypt BM" },
  { id: "3", name: "Soft Wear - Performance", externalId: "act_558392017463", currency: "USD", business: "Soft Wear Ltd" },
];

function ConnectMetaWizard() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [step, setStep] = useState<number>(search.step ?? 1);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [accounts, setAccounts] = useState<MockAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const oauthState = search.state ?? null;

  const startFn = useServerFn(startMetaOAuth);
  const listFn = useServerFn(listMetaAccounts);
  const linkFn = useServerFn(linkMetaAccount);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  const goNext = () => setStep((s) => Math.min(6, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // Returning from Meta callback → step=5 + state in the URL: fetch accounts.
  useEffect(() => {
    if (search.step === 5 && oauthState && accounts.length === 0 && !loading) {
      void (async () => {
        setLoading(true);
        setLoadingMessage("جلب الحسابات الإعلانية من Meta...");
        try {
          const res = await listFn({ data: { state: oauthState } });
          setAccounts(
            res.accounts.map((a, i) => ({
              id: String(i),
              name: a.name,
              externalId: a.externalId,
              currency: a.currency,
              business: a.business,
            })),
          );
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "تعذر جلب الحسابات");
          setStep(4);
        } finally {
          setLoading(false);
          setLoadingMessage("");
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.step, oauthState]);

  const startConnection = async () => {
    setLoading(true);
    setLoadingMessage("جاري فتح Meta...");
    try {
      const { authorizeUrl } = await startFn();
      window.location.href = authorizeUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر بدء الربط");
      setLoading(false);
      setLoadingMessage("");
    }
  };

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccount || !oauthState) throw new Error("لا يوجد حساب محدد");
      return linkFn({
        data: {
          state: oauthState,
          externalId: selectedAccount.externalId,
          name: selectedAccount.name,
          currency: selectedAccount.currency,
          business: selectedAccount.business,
        },
      });
    },
    onSuccess: () => {
      toast.success("تم ربط الحساب بنجاح");
      setStep(6);
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "تعذر حفظ الحساب"),
  });

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6 max-w-4xl mx-auto pb-12">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Link to="/ad-accounts" className="hover:text-foreground">حسابات الإعلانات</Link>
              <ChevronLeft className="h-3 w-3" />
              <span>مساعد ربط Meta</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              مساعد ربط حساب Meta
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              نخليك تربط حسابك الإعلاني في خطوات بسيطة وآمنة
            </p>
          </div>
        </div>

        {/* Progress */}
        <ProgressBar current={step} />

        {/* Steps */}
        {step === 1 && <StepReadiness onNext={goNext} />}
        {step === 2 && <StepExplain onNext={goNext} onBack={goBack} />}
        {step === 3 && <StepTutorial onNext={goNext} onBack={goBack} />}
        {step === 4 && (
          <StepStart
            loading={loading}
            loadingMessage={loadingMessage}
            onStart={startConnection}
            onBack={goBack}
          />
        )}
        {step === 5 && (
          <StepSelectAccount
            accounts={accounts}
            loading={loading}
            confirming={confirmMutation.isPending}
            selectedId={selectedAccountId}
            onSelect={setSelectedAccountId}
            onConfirm={() => confirmMutation.mutate()}
            onBack={() => setStep(4)}
          />
        )}
        {step === 6 && selectedAccount && (
          <StepSuccess account={selectedAccount} onDone={() => navigate({ to: "/ad-accounts" })} />
        )}
      </div>
    </TooltipProvider>
  );
}

/* ---------------- Progress ---------------- */

function ProgressBar({ current }: { current: number }) {
  const pct = ((current - 1) / (STEPS.length - 1)) * 100;
  return (
    <div className="rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
        <span>الخطوة {current} من {STEPS.length}</span>
        <span className="font-medium text-foreground">{STEPS[current - 1].label}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 right-0 bg-gradient-to-l from-primary to-primary/70 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="hidden md:flex items-center justify-between mt-3">
        {STEPS.map((s) => (
          <div
            key={s.id}
            className={cn(
              "flex flex-col items-center gap-1 text-[11px] flex-1",
              s.id <= current ? "text-foreground" : "text-muted-foreground/60"
            )}
          >
            <div
              className={cn(
                "h-6 w-6 rounded-full grid place-items-center text-[10px] font-bold border",
                s.id < current && "bg-primary text-primary-foreground border-primary",
                s.id === current && "bg-primary/15 text-primary border-primary",
                s.id > current && "bg-muted border-border"
              )}
            >
              {s.id < current ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.id}
            </div>
            <span className="text-center">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Step 1 ---------------- */

const READINESS = [
  { label: "لديك حساب Facebook", hint: "الحساب الشخصي اللي تستخدمه عادي على فيسبوك" },
  { label: "لديك Business Manager", hint: "حساب مدير الأعمال على business.facebook.com" },
  { label: "لديك حساب إعلاني", hint: "Ad Account مرتبط بمدير الأعمال وممول جاهز" },
  { label: "لديك صلاحية Admin على الحساب الإعلاني", hint: "لازم تكون أدمن عشان تقدر تمنح صلاحية القراءة" },
];

function StepReadiness({ onNext }: { onNext: () => void }) {
  const [checks, setChecks] = useState<boolean[]>(READINESS.map(() => false));
  const allChecked = checks.every(Boolean);
  return (
    <Card>
      <CardContent className="p-6 md:p-8 space-y-6">
        <div>
          <h2 className="text-xl font-display font-bold">فحص الجاهزية</h2>
          <p className="text-sm text-muted-foreground mt-1">
            تأكد من توفر كل النقاط التالية قبل البدء
          </p>
        </div>

        <div className="grid gap-3">
          {READINESS.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() =>
                setChecks((c) => c.map((v, idx) => (idx === i ? !v : v)))
              }
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4 text-right transition",
                checks[i]
                  ? "border-success/40 bg-success/5"
                  : "border-border hover:bg-muted/50"
              )}
            >
              <div
                className={cn(
                  "h-6 w-6 rounded-full border-2 grid place-items-center shrink-0",
                  checks[i] ? "bg-success border-success text-white" : "border-border"
                )}
              >
                {checks[i] && <CheckCircle2 className="h-4 w-4" />}
              </div>
              <span className="flex-1 font-medium">{item.label}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground hover:text-foreground">
                    <HelpCircle className="h-4 w-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs">{item.hint}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    إذا لم تكن متأكدًا، شاهد الشرح بالأسفل
                  </p>
                </TooltipContent>
              </Tooltip>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button size="lg" onClick={onNext} disabled={!allChecked} className="min-w-32">
            التالي
            <ChevronLeft className="mr-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Step 2 ---------------- */

function StepExplain({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const points = [
    "سيتم فتح نافذة Meta الرسمية",
    "قم بتسجيل الدخول بحسابك",
    "اختر الحساب الإعلاني الذي تريد ربطه",
    "النظام سيستخدم صلاحية قراءة الإنفاق فقط",
    "النظام لن ينشئ أو يعدل أو يحذف أي حملات",
  ];
  return (
    <Card>
      <CardContent className="p-6 md:p-8 space-y-6">
        <div>
          <h2 className="text-xl font-display font-bold">إزاي بيشتغل الربط؟</h2>
          <p className="text-sm text-muted-foreground mt-1">
            شرح بسيط لكل ما يحدث خلال عملية الربط
          </p>
        </div>

        <div className="grid gap-3">
          {points.map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl border bg-card p-4"
            >
              <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary grid place-items-center font-bold">
                {i + 1}
              </div>
              <p className="text-sm leading-relaxed pt-1">{p}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-success/30 bg-success/5 p-4 flex items-start gap-3">
          <Shield className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">بياناتك في أمان</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              بياناتك الإعلانية آمنة ولن يتم استخدامها إلا لعرض الإنفاق والإحصائيات داخل النظام.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="lg" onClick={onBack}>
            <ChevronRight className="ml-1 h-4 w-4" />
            العودة
          </Button>
          <Button size="lg" onClick={onNext} className="min-w-32">
            التالي
            <ChevronLeft className="mr-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Step 3 ---------------- */

const TUTORIAL = [
  { title: "تسجيل الدخول", text: "افتح نافذة Meta وسجّل الدخول بحسابك العادي." },
  { title: "اختيار الحساب", text: "اختر الحساب الإعلاني المراد ربطه من القائمة." },
  { title: "منح الصلاحية", text: "وافق على صلاحية قراءة بيانات الإعلانات فقط." },
  { title: "تأكيد الربط", text: "ستعود تلقائيًا للنظام بعد إتمام الربط بنجاح." },
];

function StepTutorial({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <Card>
      <CardContent className="p-6 md:p-8 space-y-6">
        <div>
          <h2 className="text-xl font-display font-bold">تعليمات بالصور</h2>
          <p className="text-sm text-muted-foreground mt-1">
            دليل مرئي يوضح خطوات الربط داخل Meta
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TUTORIAL.map((t, i) => (
            <div key={i} className="rounded-xl border overflow-hidden bg-card">
              <div className="aspect-video bg-gradient-to-br from-muted to-muted/40 grid place-items-center border-b">
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="h-10 w-10 mx-auto opacity-40" />
                  <p className="text-xs mt-2">صورة توضيحية ({i + 1})</p>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-[10px]">خطوة {i + 1}</Badge>
                  <p className="font-semibold text-sm">{t.title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center">
          <PlayCircle className="h-10 w-10 mx-auto text-primary/70" />
          <p className="font-semibold mt-2">شاهد فيديو الشرح</p>
          <p className="text-xs text-muted-foreground mt-1">سيتوفر قريبًا فيديو يشرح كل الخطوات</p>
          <Button variant="outline" size="sm" className="mt-3" disabled>
            تشغيل الفيديو
            <Badge variant="secondary" className="mr-2 text-[10px]">قريبًا</Badge>
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="lg" onClick={onBack}>
            <ChevronRight className="ml-1 h-4 w-4" />
            العودة
          </Button>
          <Button size="lg" onClick={onNext} className="min-w-32">
            التالي
            <ChevronLeft className="mr-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Step 4 ---------------- */

function StepStart({
  loading, loadingMessage, onStart, onBack,
}: {
  loading: boolean; loadingMessage: string; onStart: () => void; onBack: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-6 md:p-10 space-y-8 text-center">
        <div>
          <h2 className="text-2xl font-display font-bold">جاهز لبدء الربط</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            اضغط على الزر بالأسفل لفتح نافذة Meta وإتمام عملية الربط بأمان
          </p>
        </div>

        <div className="mx-auto w-24 h-24 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 grid place-items-center">
          {loading ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : (
            <Link2 className="h-10 w-10 text-primary" />
          )}
        </div>

        {loading && (
          <p className="text-sm font-medium text-primary">{loadingMessage}</p>
        )}

        <Button
          size="lg"
          onClick={onStart}
          disabled={loading}
          className="h-14 px-10 text-base min-w-64"
        >
          {loading ? (
            <><Loader2 className="ml-2 h-5 w-5 animate-spin" /> جاري الربط...</>
          ) : (
            <><Link2 className="ml-2 h-5 w-5" /> ربط حساب Meta</>
          )}
        </Button>

        {!loading && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={onBack}>
              <ChevronRight className="ml-1 h-4 w-4" />
              العودة
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Step 5 ---------------- */

function StepSelectAccount({
  accounts, selectedId, onSelect, onConfirm, onBack, loading, confirming,
}: {
  accounts: MockAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  loading?: boolean;
  confirming?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-6 md:p-8 space-y-6">
        <div>
          <h2 className="text-xl font-display font-bold">اختر الحساب الإعلاني</h2>
          <p className="text-sm text-muted-foreground mt-1">
            هذه الحسابات الإعلانية المتاحة للربط من حساب Meta الخاص بك
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جاري التحميل...
          </div>
        )}
        {!loading && accounts.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            لا توجد حسابات إعلانية متاحة على هذا الحساب
          </div>
        )}

        <div className="grid gap-3">
          {accounts.map((a) => {
            const active = a.id === selectedId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                className={cn(
                  "flex items-center gap-4 rounded-xl border p-4 text-right transition",
                  active
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "hover:bg-muted/40"
                )}
              >
                <div className={cn(
                  "h-12 w-12 rounded-xl grid place-items-center shrink-0",
                  active ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.business}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <IdCard className="h-3 w-3" />
                      <span dir="ltr">{a.externalId}</span>
                    </Badge>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Wallet className="h-3 w-3" />
                      {a.currency}
                    </Badge>
                  </div>
                </div>
                <div className={cn(
                  "h-6 w-6 rounded-full border-2 grid place-items-center shrink-0",
                  active ? "bg-primary border-primary text-primary-foreground" : "border-border"
                )}>
                  {active && <CheckCircle2 className="h-4 w-4" />}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="lg" onClick={onBack}>
            <ChevronRight className="ml-1 h-4 w-4" />
            العودة
          </Button>
          <Button size="lg" onClick={onConfirm} disabled={!selectedId} className="min-w-40">
            تأكيد الربط
            <ChevronLeft className="mr-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Step 6 ---------------- */

function StepSuccess({ account, onDone }: { account: MockAccount; onDone: () => void }) {
  return (
    <Card>
      <CardContent className="p-6 md:p-10 space-y-6 text-center">
        <div className="mx-auto w-20 h-20 rounded-full bg-success/15 grid place-items-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
        </div>
        <div>
          <h2 className="text-2xl font-display font-bold">تم ربط الحساب بنجاح</h2>
          <p className="text-sm text-muted-foreground mt-2">
            سيبدأ النظام بمزامنة بيانات الإنفاق تلقائيًا
          </p>
        </div>

        <div className="max-w-md mx-auto rounded-xl border bg-card divide-y text-right">
          <Row label="اسم الحساب" value={account.name} />
          <Row label="رقم الحساب" value={account.externalId} ltr />
          <Row label="العملة" value={account.currency} />
          <Row
            label="حالة الاتصال"
            value={
              <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15">
                متصل عبر Meta
              </Badge>
            }
          />
        </div>

        <div className="flex justify-center pt-2">
          <Button size="lg" onClick={onDone} className="min-w-64 h-12">
            العودة إلى حسابات الإعلانات
            <ArrowRight className="mr-2 h-4 w-4 rotate-180" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", ltr && "font-mono")} dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}
