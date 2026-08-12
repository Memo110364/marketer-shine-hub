import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Shield,
  Loader2, Link2, Building2, Wallet, IdCard, HelpCircle,
  ArrowRight, Sparkles, AlertTriangle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invokeFn } from "@/lib/edge-functions";

type MetaAccountResult = {
  externalId: string;
  name: string;
  currency: string;
  business: string;
  accountStatus: number | null;
};

export const Route = createFileRoute("/_authenticated/ad-accounts_/connect-meta")({
  validateSearch: (s: Record<string, unknown>) => ({
    step: typeof s.step === "string" ? Number(s.step) : undefined,
    state: typeof s.state === "string" ? s.state : undefined,
    meta_error: typeof s.meta_error === "string" ? s.meta_error : undefined,
    meta_error_description:
      typeof s.meta_error_description === "string" ? s.meta_error_description : undefined,
    meta_error_reason:
      typeof s.meta_error_reason === "string" ? s.meta_error_reason : undefined,
    meta_error_code:
      typeof s.meta_error_code === "string" ? s.meta_error_code : undefined,
    meta_error_type:
      typeof s.meta_error_type === "string" ? s.meta_error_type : undefined,
    meta_error_subcode:
      typeof s.meta_error_subcode === "string" ? s.meta_error_subcode : undefined,
    meta_fbtrace_id:
      typeof s.meta_fbtrace_id === "string" ? s.meta_fbtrace_id : undefined,
  }),
  component: ConnectMetaWizard,
});

const STEPS = [
  { id: 1, label: "ابدأ الربط" },
  { id: 2, label: "اختيار الحساب" },
  { id: 3, label: "تم الربط" },
];

type MockAccount = {
  id: string;
  name: string;
  externalId: string;
  currency: string;
  business: string;
};

type MetaErrorInfo = {
  source: "callback" | "start" | "list" | "link";
  friendly: string;
  raw: string;
  description?: string;
  reason?: string;
  code?: string | number;
  subcode?: string | number;
  type?: string;
  fbtraceId?: string;
  status?: number;
};

/** Map the ?error= value returned by Meta's OAuth dialog to Arabic copy. */
function friendlyMessageFromCallback(err: string, reason?: string): string {
  const key = (reason || err || "").toLowerCase();
  if (key.includes("access_denied") || key.includes("user_denied"))
    return "تم إلغاء منح الصلاحيات من داخل نافذة Meta. يرجى المحاولة مرة أخرى ومنح الأذونات المطلوبة.";
  if (key.includes("missing_code"))
    return "لم يُرجِع Meta رمز التفويض. يرجى إعادة المحاولة.";
  if (key.includes("server_not_configured"))
    return "إعدادات الربط غير مكتملة على الخادم. تواصل مع الدعم.";
  if (key.includes("token_exchange_failed") || key.includes("invalid"))
    return "فشل تبادل رمز التفويض مع Meta. يرجى إعادة المحاولة.";
  return "حدث خطأ أثناء الرجوع من Meta. راجع التفاصيل بالأسفل وحاول مرة أخرى.";
}

/** Map a Graph API error (code/subcode) to Arabic copy. */
function friendlyMessageFromGraph(
  code?: number,
  subcode?: number,
  message?: string,
): string {
  if (code === 190) {
    if (subcode === 463)
      return "انتهت صلاحية جلسة Meta. يرجى إعادة الربط.";
    if (subcode === 460)
      return "تم تغيير كلمة السر في Meta. يرجى إعادة الربط.";
    return "رمز الوصول لم يعد صالحًا. يرجى إعادة الربط.";
  }
  if (code === 200 || code === 10)
    return "الأذونات المطلوبة (ads_read أو business_management) غير ممنوحة. يرجى إعادة الربط مع الموافقة على الصلاحيات.";
  if (code === 100)
    return "طلب غير صالح إلى Meta. تحقق من الحساب المستخدم وحاول مرة أخرى.";
  if (code === 4 || code === 17 || code === 32 || code === 613)
    return "تم تجاوز الحد المسموح به من الطلبات على Meta. حاول بعد قليل.";
  if (code === 368)
    return "الحساب مقيَّد مؤقتًا من قِبَل Meta.";
  return message || "فشل استدعاء Meta.";
}

/** Turn a thrown server-fn error (Error/string) into a MetaErrorInfo. */
function parseServerError(
  e: unknown,
  source: "start" | "list" | "link",
): MetaErrorInfo {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.kind === "graph_error") {
      return {
        source,
        friendly: friendlyMessageFromGraph(
          parsed.code,
          parsed.subcode,
          parsed.message,
        ),
        raw,
        description: parsed.message,
        code: parsed.code,
        subcode: parsed.subcode,
        type: parsed.type,
        fbtraceId: parsed.fbtrace_id,
        status: parsed.status,
      };
    }
  } catch {
    /* not JSON — fall through */
  }
  const fallback =
    source === "start"
      ? "تعذر بدء عملية الربط. يرجى المحاولة مرة أخرى."
      : source === "list"
        ? "تعذر جلب الحسابات الإعلانية من Meta."
        : "تعذر حفظ الحساب الإعلاني.";
  return { source, friendly: raw || fallback, raw };
}

function MetaErrorBanner({
  info,
  onDismiss,
  onRetry,
}: {
  info: MetaErrorInfo;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const sourceLabel =
    info.source === "callback"
      ? "أثناء العودة من Meta"
      : info.source === "start"
        ? "أثناء بدء الربط"
        : info.source === "list"
          ? "أثناء جلب الحسابات"
          : "أثناء حفظ الحساب";
  return (
    <Alert variant="destructive" className="border-destructive/40">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>تعذر إتمام ربط Meta — {sourceLabel}</span>
      </AlertTitle>
      <AlertDescription className="space-y-3 mt-1">
        <p className="leading-relaxed">{info.friendly}</p>

        <details className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <summary className="cursor-pointer text-xs font-semibold">
            تفاصيل الخطأ من Meta
          </summary>
          <div className="mt-2 grid gap-1 text-xs" dir="ltr">
            {info.description && (
              <div>
                <span className="opacity-70">message:</span> {info.description}
              </div>
            )}
            {info.code !== undefined && (
              <div>
                <span className="opacity-70">code:</span> {String(info.code)}
              </div>
            )}
            {info.subcode !== undefined && (
              <div>
                <span className="opacity-70">subcode:</span>{" "}
                {String(info.subcode)}
              </div>
            )}
            {info.type && (
              <div>
                <span className="opacity-70">type:</span> {info.type}
              </div>
            )}
            {info.reason && (
              <div>
                <span className="opacity-70">reason:</span> {info.reason}
              </div>
            )}
            {info.status !== undefined && (
              <div>
                <span className="opacity-70">http:</span> {info.status}
              </div>
            )}
            {info.fbtraceId && (
              <div>
                <span className="opacity-70">fbtrace_id:</span> {info.fbtraceId}
              </div>
            )}
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-background/50 p-2 text-[11px]">
              {info.raw}
            </pre>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="ml-1 h-3.5 w-3.5" />
            إعادة المحاولة
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            إغلاق
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}


function ConnectMetaWizard() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const oauthState = search.state ?? null;
  const [step, setStep] = useState<number>(
    oauthState ? 2 : (search.step ?? 1),
  );
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [accounts, setAccounts] = useState<MockAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [fetchedForState, setFetchedForState] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<MetaErrorInfo | null>(null);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  // Surface any error returned by the OAuth callback (?meta_error=...).
  useEffect(() => {
    if (!search.meta_error) return;
    const info: MetaErrorInfo = {
      source: "callback",
      raw: search.meta_error,
      description: search.meta_error_description,
      reason: search.meta_error_reason,
      code: search.meta_error_code,
      type: search.meta_error_type,
      subcode: search.meta_error_subcode,
      fbtraceId: search.meta_fbtrace_id,
      friendly: friendlyMessageFromCallback(
        search.meta_error,
        search.meta_error_reason,
      ),
    };
    console.error("[ConnectMeta] callback returned error", info);
    setMetaError(info);
    setStep(1);
    toast.error(info.friendly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    search.meta_error,
    search.meta_error_description,
    search.meta_error_reason,
    search.meta_error_code,
    search.meta_error_type,
    search.meta_error_subcode,
    search.meta_fbtrace_id,
  ]);

  // Returning from Meta callback → state present in the URL: fetch accounts.
  useEffect(() => {
    console.log("[ConnectMeta] account-select effect mounted", {
      oauthState,
      fetchedForState,
    });
    if (!oauthState) return;
    if (fetchedForState === oauthState) return;
    setStep(2);
    setFetchedForState(oauthState);
    void (async () => {
      setLoading(true);
      setLoadingMessage("جاري جلب الحسابات الإعلانية...");
      setMetaError(null);
      console.log("[ConnectMeta] calling listMetaAccounts with state:", oauthState);
      try {
        const res = await invokeFn<{ accounts: MetaAccountResult[] }>(
          "meta-oauth",
          { action: "list", state: oauthState },
        );
        console.log("[ConnectMeta] accounts returned count:", res.accounts.length);
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
        console.error("[ConnectMeta] listMetaAccounts failed:", e);
        const info = parseServerError(e, "list");
        setMetaError(info);
        toast.error(info.friendly);
        setStep(1);
      } finally {
        setLoading(false);
        setLoadingMessage("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthState]);

  const startConnection = async () => {
    setLoading(true);
    setLoadingMessage("جاري فتح Meta...");
    setMetaError(null);
    try {
      const { authorizeUrl } = await invokeFn<{ authorizeUrl: string }>(
        "meta-oauth",
        { action: "start" },
      );
      window.location.href = authorizeUrl;
    } catch (e) {
      const info = parseServerError(e, "start");
      setMetaError(info);
      toast.error(info.friendly);
      setLoading(false);
      setLoadingMessage("");
    }
  };

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccount || !oauthState) throw new Error("لا يوجد حساب محدد");
      console.log("[ConnectMeta] selected account:", selectedAccount);
      console.log("[ConnectMeta] calling linkMetaAccount", {
        state: oauthState,
        externalId: selectedAccount.externalId,
      });
      return invokeFn<{ adAccountId: string }>("meta-oauth", {
        action: "link",
        state: oauthState,
        externalId: selectedAccount.externalId,
        name: selectedAccount.name,
        currency: selectedAccount.currency,
        business: selectedAccount.business,
      });
    },
    onSuccess: () => {
      console.log("[ConnectMeta] link success — redirecting to /ad-accounts");
      toast.success("تم ربط حساب Meta بنجاح");
      navigate({ to: "/ad-accounts" });
    },
    onError: (e) => {
      console.error("[ConnectMeta] linkMetaAccount failed:", e);
      const info = parseServerError(e, "link");
      setMetaError(info);
      toast.error(info.friendly);
    },
  });

  return (
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
              اربط حسابك الإعلاني بضغطة واحدة وبأمان
            </p>
          </div>
        </div>

        {/* Progress */}
        <ProgressBar current={step} />

        {metaError && (
          <MetaErrorBanner
            info={metaError}
            onDismiss={() => setMetaError(null)}
            onRetry={() => {
              setMetaError(null);
              setStep(1);
            }}
          />
        )}

        {/* Steps */}
        {step === 1 && (
          <StepStart
            loading={loading}
            loadingMessage={loadingMessage}
            onStart={startConnection}
          />
        )}
        {step === 2 && (
          <StepSelectAccount
            accounts={accounts}
            loading={loading}
            confirming={confirmMutation.isPending}
            selectedId={selectedAccountId}
            onSelect={setSelectedAccountId}
            onConfirm={() => confirmMutation.mutate()}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && selectedAccount && (
          <StepSuccess account={selectedAccount} onDone={() => navigate({ to: "/ad-accounts" })} />
        )}
    </div>
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

const HOW_IT_WORKS = [
  "هتسجّل الدخول في نافذة Meta الرسمية وتختار الحساب الإعلاني",
  "النظام هياخد صلاحية قراءة الإنفاق بس — من غير أي تعديل على حملاتك",
  "هترجع تلقائيًا هنا تختار الحساب اللي عايز تربطه",
];

const READINESS = [
  { label: "حساب Facebook", hint: "الحساب الشخصي اللي تستخدمه عادي على فيسبوك" },
  { label: "Business Manager", hint: "حساب مدير الأعمال على business.facebook.com" },
  { label: "حساب إعلاني ممول", hint: "Ad Account مرتبط بمدير الأعمال وممول جاهز" },
  { label: "صلاحية Admin على الحساب الإعلاني", hint: "لازم تكون أدمن عشان تقدر تمنح صلاحية القراءة" },
];

function StepStart({
  loading, loadingMessage, onStart,
}: {
  loading: boolean; loadingMessage: string; onStart: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-6 md:p-10 space-y-6 text-center">
        <div>
          <h2 className="text-2xl font-display font-bold">اربط حساب Meta بضغطة واحدة</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            هتفتح نافذة Meta الرسمية، تسجّل دخول وتختار حسابك، وترجع تلقائيًا هنا
          </p>
        </div>

        <div className="grid gap-2 max-w-md mx-auto text-right">
          {HOW_IT_WORKS.map((p, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border bg-card p-3">
              <div className="h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                {i + 1}
              </div>
              <p className="text-sm leading-relaxed">{p}</p>
            </div>
          ))}
        </div>

        <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 grid place-items-center">
          {loading ? (
            <Loader2 className="h-9 w-9 text-primary animate-spin" />
          ) : (
            <Link2 className="h-9 w-9 text-primary" />
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

        <details className="max-w-md mx-auto text-right rounded-xl border bg-muted/30 p-4">
          <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            محتاج تتأكد من إيه قبل ما تبدأ؟
          </summary>
          <div className="grid gap-2 mt-3">
            {READINESS.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/70" />
                <span>
                  <span className="text-foreground font-medium">{item.label}</span> — {item.hint}
                </span>
              </div>
            ))}
          </div>
        </details>

        <div className="max-w-md mx-auto rounded-xl border border-success/30 bg-success/5 p-4 flex items-start gap-3 text-right">
          <Shield className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">بياناتك في أمان</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              بياناتك الإعلانية آمنة ولن يتم استخدامها إلا لعرض الإنفاق والإحصائيات داخل النظام.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Step 2 ---------------- */

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
          <Button size="lg" onClick={onConfirm} disabled={!selectedId || confirming} className="min-w-40">
            {confirming ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
            تأكيد الربط
            <ChevronLeft className="mr-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Step 3 ---------------- */

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
