import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { BarChart3, Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("signin");

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [session, loading, navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error("فشل تسجيل الدخول", { description: error.message });
    else { toast.success("أهلاً بك"); navigate({ to: "/dashboard" }); }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName },
      },
    });
    setBusy(false);
    if (error) toast.error("فشل إنشاء الحساب", { description: error.message });
    else {
      toast.success("تم إنشاء الحساب", { description: "تواصل مع المدير لتفعيل صلاحياتك" });
      setTab("signin");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/30 to-background p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto bg-primary/10 p-3 rounded-2xl w-fit">
            <BarChart3 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">منصة أداء المسوّقين</CardTitle>
          <CardDescription>سجّل الدخول للوصول إلى لوحة التحكم</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">تسجيل الدخول</TabsTrigger>
              <TabsTrigger value="signup">إنشاء حساب</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">البريد الإلكتروني</Label>
                  <Input id="email" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">كلمة المرور</Label>
                  <Input id="password" type="password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} dir="ltr" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                  دخول
                </Button>
                <div className="text-center">
                  <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                    نسيت كلمة المرور؟
                  </Link>
                </div>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="fname">الاسم الكامل</Label>
                  <Input id="fname" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email2">البريد الإلكتروني</Label>
                  <Input id="email2" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2">كلمة المرور (٨ أحرف على الأقل)</Label>
                  <Input id="password2" type="password" minLength={8} required value={password}
                    onChange={(e) => setPassword(e.target.value)} dir="ltr" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                  إنشاء حساب
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          <p className="text-xs text-muted-foreground text-center mt-4">
            بعد إنشاء الحساب، يقوم المدير بتحديد دورك في النظام.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
