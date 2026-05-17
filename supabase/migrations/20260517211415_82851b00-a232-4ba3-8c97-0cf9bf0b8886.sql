
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'account_manager', 'marketer');
CREATE TYPE public.order_status AS ENUM ('pending', 'in_delivery', 'delivered', 'done', 'refunded', 'refund_request');
CREATE TYPE public.marketer_status AS ENUM ('active', 'paused', 'inactive');
CREATE TYPE public.ad_platform AS ENUM ('meta', 'tiktok', 'manual');

-- ============ UPDATED_AT TRIGGER FN ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============ SECURITY DEFINER: has_role ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ MARKETERS ============
CREATE TABLE public.marketers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  facebook_profile TEXT,
  tiktok_profile TEXT,
  status public.marketer_status NOT NULL DEFAULT 'active',
  account_manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.marketers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_marketers_user_id ON public.marketers(user_id);
CREATE INDEX idx_marketers_code ON public.marketers(marketer_code);
CREATE TRIGGER marketers_updated_at BEFORE UPDATE ON public.marketers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ SECURITY DEFINER: current_marketer_id ============
CREATE OR REPLACE FUNCTION public.current_marketer_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.marketers WHERE user_id = auth.uid() LIMIT 1
$$;

-- ============ PRODUCTS ============
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  cost NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ SHIPPING COMPANIES ============
CREATE TABLE public.shipping_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shipping_companies ENABLE ROW LEVEL SECURITY;

-- ============ IMPORT BATCHES ============
CREATE TABLE public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  row_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  mapping_used JSONB,
  status TEXT NOT NULL DEFAULT 'completed',
  errors JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

-- ============ ORDERS ============
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_id TEXT,
  marketer_id UUID REFERENCES public.marketers(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  shipping_company_id UUID REFERENCES public.shipping_companies(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  governorate TEXT,
  quantity INT DEFAULT 1,
  price NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  status public.order_status NOT NULL DEFAULT 'pending',
  order_date DATE,
  delivered_date DATE,
  import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_orders_marketer ON public.orders(marketer_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_date ON public.orders(order_date);
CREATE INDEX idx_orders_product ON public.orders(product_id);
CREATE INDEX idx_orders_shipping ON public.orders(shipping_company_id);
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ AD ACCOUNTS ============
CREATE TABLE public.ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id UUID REFERENCES public.marketers(id) ON DELETE CASCADE,
  platform public.ad_platform NOT NULL DEFAULT 'manual',
  ad_account_id TEXT,
  account_name TEXT,
  access_status TEXT DEFAULT 'pending',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ad_accounts_marketer ON public.ad_accounts(marketer_id);

-- ============ AD SPEND TRANSACTIONS ============
CREATE TABLE public.ad_spend_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id UUID NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  fawry_code TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_spend_transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ad_spend_marketer ON public.ad_spend_transactions(marketer_id);
CREATE INDEX idx_ad_spend_date ON public.ad_spend_transactions(transaction_date);

-- ============ COLUMN MAPPINGS ============
CREATE TABLE public.column_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mapping JSONB NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.column_mappings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER column_mappings_updated_at BEFORE UPDATE ON public.column_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ RLS POLICIES ============

-- profiles
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());
CREATE POLICY "Admins manage profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- user_roles
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- marketers
CREATE POLICY "Admin/AM view all marketers" ON public.marketers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager') OR user_id = auth.uid());
CREATE POLICY "Admin/AM insert marketers" ON public.marketers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Admin/AM update marketers" ON public.marketers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Admin delete marketers" ON public.marketers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- products
CREATE POLICY "All auth read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/AM write products" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));

-- shipping_companies
CREATE POLICY "All auth read shipping" ON public.shipping_companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/AM write shipping" ON public.shipping_companies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));

-- orders
CREATE POLICY "Orders read" ON public.orders FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'account_manager')
    OR marketer_id = public.current_marketer_id()
  );
CREATE POLICY "Orders insert AM" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Orders update AM" ON public.orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Orders delete admin" ON public.orders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ad_accounts
CREATE POLICY "Ad accounts read" ON public.ad_accounts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager') OR marketer_id = public.current_marketer_id());
CREATE POLICY "Ad accounts write AM" ON public.ad_accounts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));

-- ad_spend_transactions
CREATE POLICY "Ad spend read" ON public.ad_spend_transactions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager') OR marketer_id = public.current_marketer_id());
CREATE POLICY "Ad spend insert AM" ON public.ad_spend_transactions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Ad spend update AM" ON public.ad_spend_transactions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Ad spend delete admin" ON public.ad_spend_transactions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- import_batches
CREATE POLICY "Batches read AM" ON public.import_batches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Batches write AM" ON public.import_batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));

-- column_mappings
CREATE POLICY "Mappings read AM" ON public.column_mappings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));
CREATE POLICY "Mappings write AM" ON public.column_mappings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'account_manager'));

-- ============ AUTO-CREATE PROFILE TRIGGER ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
