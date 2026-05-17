import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, Loader2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase auto-handles the recovery token from the URL hash and emits a PASSWORD_RECOVERY event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // Also check current session in case event already fired
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين");
      return;
    }
    if (password.length < 8) {
      toast.error("كلمة المرور قصيرة", { description: "٨ أحرف على الأقل" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error("فشل التحديث", { description: error.message });
    } else {
      toast.success("تم تحديث كلمة المرور");
      await supabase.auth.signOut();
      navigate({ to: "/login" });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/30 to-background p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto bg-primary/10 p-3 rounded-2xl w-fit">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">تعيين كلمة مرور جديدة</CardTitle>
          <CardDescription>
            {ready ? "أدخل كلمة المرور الجديدة" : "جارٍ التحقق من رابط إعادة التعيين..."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور الجديدة</Label>
              <Input
                id="password" type="password" minLength={8} required
                value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr"
                disabled={!ready}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">تأكيد كلمة المرور</Label>
              <Input
                id="confirm" type="password" minLength={8} required
                value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr"
                disabled={!ready}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || !ready}>
              {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              تحديث كلمة المرور
            </Button>
            <div className="text-center">
              <Link to="/login" className="text-sm text-muted-foreground hover:underline">
                العودة إلى تسجيل الدخول
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
