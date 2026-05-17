import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      toast.error("فشل الإرسال", { description: error.message });
    } else {
      setSent(true);
      toast.success("تم إرسال الرابط", { description: "تفقد بريدك الإلكتروني" });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/30 to-background p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto bg-primary/10 p-3 rounded-2xl w-fit">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">نسيت كلمة المرور</CardTitle>
          <CardDescription>
            أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                تم إرسال رابط إعادة التعيين إلى <strong dir="ltr">{email}</strong>.
                إذا لم يصلك خلال دقائق، تحقق من مجلد الرسائل غير المرغوب فيها.
              </p>
              <Link to="/login" className="text-sm text-primary hover:underline">
                العودة إلى تسجيل الدخول
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input
                  id="email" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} dir="ltr"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                إرسال رابط إعادة التعيين
              </Button>
              <div className="text-center">
                <Link to="/login" className="text-sm text-muted-foreground hover:underline">
                  العودة إلى تسجيل الدخول
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
