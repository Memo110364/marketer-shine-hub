import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicyPage,
});

const LAST_UPDATED = "October 19, 2026";
const CONTACT_EMAIL = "privacy@angazny.com";

function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <header className="flex items-center gap-3">
          <div className="bg-primary/10 p-2.5 rounded-xl">
            <BarChart3 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Angazny — Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          </div>
        </header>

        <section className="space-y-4 leading-relaxed text-sm">
          <p>
            This Privacy Policy explains how Angazny ("we", "us", "our") collects, uses, stores,
            and protects information through the Angazny Marketer Performance Platform
            (the "Platform"), available at mb.angazny.com, including when you connect a Meta
            (Facebook) advertising account to the Platform.
          </p>

          <h2 className="text-lg font-semibold pt-2">1. Who we are</h2>
          <p>
            Angazny operates an internal performance-management platform used by our own staff
            (marketers, account managers, and administrators) to track order fulfillment,
            commissions, bonuses, and advertising performance. The Platform is not a public
            consumer product — access is limited to authorized members of our organization.
          </p>

          <h2 className="text-lg font-semibold pt-2">2. Information we collect via Meta</h2>
          <p>
            When a user connects a Meta advertising account through our Meta Login integration,
            we request the <code>ads_read</code> and <code>business_management</code> permissions
            only. Using these permissions, we read:
          </p>
          <ul className="list-disc pr-5 space-y-1">
            <li>Ad account identifiers, names, currency, and the associated Business Manager name.</li>
            <li>Campaign names, objectives, statuses, and budgets.</li>
            <li>Aggregated campaign performance metrics: spend, impressions, clicks, reach, and
              result counts/costs (e.g. messages started, leads, purchases).</li>
          </ul>
          <p>
            We do not request access to personal posts, messages, photos, friend lists, or any
            other personal Facebook content. We never post, publish, or modify anything on a
            connected Facebook or Meta Business account — access is read-only.
          </p>

          <h2 className="text-lg font-semibold pt-2">3. How we use this information</h2>
          <p>
            We use the data described above solely to display advertising performance inside the
            Platform to the account's own user and their authorized account manager/administrator,
            to reconcile advertising spend against internal wallet records, and to calculate
            performance-based commissions and bonuses. We do not use this data for advertising to
            third parties, and we do not sell, rent, or trade it.
          </p>

          <h2 className="text-lg font-semibold pt-2">4. How we store and protect data</h2>
          <p>
            Data is stored in a managed PostgreSQL database (Supabase) with row-level security
            policies that restrict every user to only the data they are authorized to see — a
            marketer can only ever see their own connected account and performance figures.
            Access tokens obtained via Meta Login are stored in a separate, restricted table and
            are never exposed to the browser or to any user interface. All traffic to the Platform
            is encrypted in transit (HTTPS/TLS).
          </p>

          <h2 className="text-lg font-semibold pt-2">5. Data sharing</h2>
          <p>
            We do not share data obtained from Meta with any third party, except with
            infrastructure providers strictly necessary to operate the Platform (our hosting and
            database provider), who act solely as data processors under our instructions.
          </p>

          <h2 className="text-lg font-semibold pt-2">6. Data retention and deletion</h2>
          <p>
            We retain connected-account data for as long as the Meta ad account remains linked to
            the Platform, or as required for our internal financial and operational records. A
            user may disconnect their Meta account at any time by contacting their administrator,
            or revoke the Platform's access entirely from their own Facebook
            Settings → Business Integrations. To request deletion of any data we hold about you,
            contact us at the email below.
          </p>

          <h2 className="text-lg font-semibold pt-2">7. Children's privacy</h2>
          <p>
            The Platform is an internal business tool intended for adult staff members only and is
            not directed at, or knowingly used by, children.
          </p>

          <h2 className="text-lg font-semibold pt-2">8. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The "Last updated" date above
            reflects the most recent revision.
          </p>

          <h2 className="text-lg font-semibold pt-2">9. Contact us</h2>
          <p>
            For any questions about this Privacy Policy or your data, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline" dir="ltr">
              {CONTACT_EMAIL}
            </a>.
          </p>
        </section>

        <hr className="border-border" />

        <section dir="rtl" className="space-y-4 leading-relaxed text-sm">
          <h2 className="text-lg font-bold">سياسة الخصوصية (ملخص بالعربي)</h2>
          <p>
            منصة Angazny لإدارة أداء المسوّقين (mb.angazny.com) أداة داخلية تُستخدم بواسطة فريقنا
            فقط (مسوّقون، مديرو حسابات، وأدمن). لما مستخدم يربط حسابه الإعلاني على Meta، بنقرأ بس
            بيانات الأداء (اسم الحساب، الحملات، الإنفاق، النقرات، النتائج) من غير أي وصول لمنشورات
            أو رسائل أو بيانات شخصية تانية، وده قراءة فقط — مفيش أي نشر أو تعديل على حسابكم خالص.
          </p>
          <p>
            البيانات دي بتتخزن بشكل آمن ومحمي بصلاحيات تمنع أي مستخدم من رؤية غير بياناته هو، ومش
            بنبيعها أو نشاركها مع أي جهة تالتة. تقدر تلغي ربط حسابك في أي وقت من إعدادات فيسبوك
            الخاصة بيك (Settings → Business Integrations)، أو تتواصل معانا لحذف بياناتك عبر{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline" dir="ltr">
              {CONTACT_EMAIL}
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
