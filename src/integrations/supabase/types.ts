export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_account_secrets: {
        Row: {
          access_token: string
          ad_account_id: string
          created_at: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          ad_account_id: string
          created_at?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          ad_account_id?: string
          created_at?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_secrets_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: true
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_accounts: {
        Row: {
          access_status: string | null
          account_name: string | null
          ad_account_id: string | null
          business_name: string | null
          connection_status: string
          created_at: string
          currency: string | null
          external_account_id: string | null
          id: string
          last_sync_at: string | null
          marketer_id: string | null
          platform: Database["public"]["Enums"]["ad_platform"]
          updated_at: string
        }
        Insert: {
          access_status?: string | null
          account_name?: string | null
          ad_account_id?: string | null
          business_name?: string | null
          connection_status?: string
          created_at?: string
          currency?: string | null
          external_account_id?: string | null
          id?: string
          last_sync_at?: string | null
          marketer_id?: string | null
          platform?: Database["public"]["Enums"]["ad_platform"]
          updated_at?: string
        }
        Update: {
          access_status?: string | null
          account_name?: string | null
          ad_account_id?: string | null
          business_name?: string | null
          connection_status?: string
          created_at?: string
          currency?: string | null
          external_account_id?: string | null
          id?: string
          last_sync_at?: string | null
          marketer_id?: string | null
          platform?: Database["public"]["Enums"]["ad_platform"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_marketer_id_fkey"
            columns: ["marketer_id"]
            isOneToOne: false
            referencedRelation: "marketers"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_spend_change_requests: {
        Row: {
          action: string
          created_at: string
          id: string
          marketer_id: string
          proposed_data: Json | null
          reason: string | null
          requested_by: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          marketer_id: string
          proposed_data?: Json | null
          reason?: string | null
          requested_by: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          marketer_id?: string
          proposed_data?: Json | null
          reason?: string | null
          requested_by?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_change_requests_marketer_id_fkey"
            columns: ["marketer_id"]
            isOneToOne: false
            referencedRelation: "marketers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_change_requests_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "ad_spend_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_spend_daily: {
        Row: {
          ad_account_id: string | null
          created_at: string
          currency: string
          id: string
          marketer_id: string
          platform: Database["public"]["Enums"]["ad_platform"]
          source: string
          spend_amount: number
          spend_date: string
          sync_status: string
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          marketer_id: string
          platform?: Database["public"]["Enums"]["ad_platform"]
          source?: string
          spend_amount?: number
          spend_date: string
          sync_status?: string
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          marketer_id?: string
          platform?: Database["public"]["Enums"]["ad_platform"]
          source?: string
          spend_amount?: number
          spend_date?: string
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_daily_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_spend_transactions: {
        Row: {
          ad_account_id: string | null
          amount: number
          created_at: string
          created_by: string | null
          fawry_code: string | null
          id: string
          marketer_id: string
          notes: string | null
          spend_type: Database["public"]["Enums"]["ad_spend_type"]
          transaction_date: string
        }
        Insert: {
          ad_account_id?: string | null
          amount: number
          created_at?: string
          created_by?: string | null
          fawry_code?: string | null
          id?: string
          marketer_id: string
          notes?: string | null
          spend_type?: Database["public"]["Enums"]["ad_spend_type"]
          transaction_date?: string
        }
        Update: {
          ad_account_id?: string | null
          amount?: number
          created_at?: string
          created_by?: string | null
          fawry_code?: string | null
          id?: string
          marketer_id?: string
          notes?: string | null
          spend_type?: Database["public"]["Enums"]["ad_spend_type"]
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_transactions_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_transactions_marketer_id_fkey"
            columns: ["marketer_id"]
            isOneToOne: false
            referencedRelation: "marketers"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_audit_logs: {
        Row: {
          action_type: string
          field_name: string | null
          id: string
          marketer_id: string
          monthly_bonus_id: string
          new_value: Json | null
          old_value: Json | null
          performed_at: string
          performed_by: string
          reason: string | null
        }
        Insert: {
          action_type: string
          field_name?: string | null
          id?: string
          marketer_id: string
          monthly_bonus_id: string
          new_value?: Json | null
          old_value?: Json | null
          performed_at?: string
          performed_by: string
          reason?: string | null
        }
        Update: {
          action_type?: string
          field_name?: string | null
          id?: string
          marketer_id?: string
          monthly_bonus_id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_at?: string
          performed_by?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bonus_audit_logs_marketer_id_fkey"
            columns: ["marketer_id"]
            isOneToOne: false
            referencedRelation: "marketers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_audit_logs_monthly_bonus_id_fkey"
            columns: ["monthly_bonus_id"]
            isOneToOne: false
            referencedRelation: "monthly_marketer_bonuses"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          marketer_id: string
          monthly_bonus_id: string
          notes: string | null
          payment_date: string
          payment_method: string
          proof_url: string | null
          reference_code: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          marketer_id: string
          monthly_bonus_id: string
          notes?: string | null
          payment_date: string
          payment_method: string
          proof_url?: string | null
          reference_code?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          marketer_id?: string
          monthly_bonus_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          proof_url?: string | null
          reference_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_payments_marketer_id_fkey"
            columns: ["marketer_id"]
            isOneToOne: false
            referencedRelation: "marketers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_payments_monthly_bonus_id_fkey"
            columns: ["monthly_bonus_id"]
            isOneToOne: false
            referencedRelation: "monthly_marketer_bonuses"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_tiers: {
        Row: {
          base_salary: number
          bonus_percentage: number
          color_hex: string | null
          created_at: string
          extra_delivered_order_amount: number
          id: string
          is_active: boolean
          min_shipped_orders: number
          minimum_delivery_rate: number
          tier_code: string
          tier_name_ar: string
          tier_name_en: string | null
          tier_order: number
          updated_at: string
        }
        Insert: {
          base_salary?: number
          bonus_percentage?: number
          color_hex?: string | null
          created_at?: string
          extra_delivered_order_amount?: number
          id?: string
          is_active?: boolean
          min_shipped_orders: number
          minimum_delivery_rate?: number
          tier_code: string
          tier_name_ar: string
          tier_name_en?: string | null
          tier_order: number
          updated_at?: string
        }
        Update: {
          base_salary?: number
          bonus_percentage?: number
          color_hex?: string | null
          created_at?: string
          extra_delivered_order_amount?: number
          id?: string
          is_active?: boolean
          min_shipped_orders?: number
          minimum_delivery_rate?: number
          tier_code?: string
          tier_name_ar?: string
          tier_name_en?: string | null
          tier_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      column_mappings: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean | null
          mapping: Json
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean | null
          mapping: Json
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean | null
          mapping?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          error_count: number
          errors: Json | null
          filename: string
          id: string
          mapping_used: Json | null
          row_count: number
          status: string
          success_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json | null
          filename: string
          id?: string
          mapping_used?: Json | null
          row_count?: number
          status?: string
          success_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json | null
          filename?: string
          id?: string
          mapping_used?: Json | null
          row_count?: number
          status?: string
          success_count?: number
        }
        Relationships: []
      }
      integration_sync_logs: {
        Row: {
          ad_account_id: string | null
          created_at: string
          error_message: string | null
          id: string
          marketer_id: string | null
          platform: Database["public"]["Enums"]["ad_platform"]
          records_created: number
          records_updated: number
          status: string
          sync_finished_at: string | null
          sync_started_at: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          marketer_id?: string | null
          platform: Database["public"]["Enums"]["ad_platform"]
          records_created?: number
          records_updated?: number
          status?: string
          sync_finished_at?: string | null
          sync_started_at?: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          marketer_id?: string | null
          platform?: Database["public"]["Enums"]["ad_platform"]
          records_created?: number
          records_updated?: number
          status?: string
          sync_finished_at?: string | null
          sync_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_logs_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      marketers: {
        Row: {
          account_manager_id: string | null
          created_at: string
          email: string | null
          facebook_profile: string | null
          id: string
          marketer_code: string
          name: string
          notes: string | null
          phone: string | null
          status: Database["public"]["Enums"]["marketer_status"]
          tiktok_profile: string | null
          updated_at: string
          user_id: string | null
          whatsapp: string | null
        }
        Insert: {
          account_manager_id?: string | null
          created_at?: string
          email?: string | null
          facebook_profile?: string | null
          id?: string
          marketer_code: string
          name: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["marketer_status"]
          tiktok_profile?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          account_manager_id?: string | null
          created_at?: string
          email?: string | null
          facebook_profile?: string | null
          id?: string
          marketer_code?: string
          name?: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["marketer_status"]
          tiktok_profile?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      meta_oauth_sessions: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string | null
          state: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at?: string | null
          state: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      monthly_marketer_bonuses: {
        Row: {
          ad_spend: number
          adjustment_proposed_at: string | null
          adjustment_proposed_by: string | null
          approved_at: string | null
          approved_by: string | null
          bonus_month: number
          bonus_year: number
          calculated_at: string | null
          calculated_extra_orders_bonus: number
          calculated_profit_bonus: number
          calculated_salary: number
          created_at: string
          delivered_orders_count: number
          delivery_rate: number
          earned_tier_id: string | null
          earned_tier_name_snapshot: string | null
          earned_tier_order_snapshot: number | null
          extra_delivered_orders: number
          final_approved_amount: number
          id: string
          is_locked: boolean
          locked_at: string | null
          locked_by: string | null
          manual_adjustment_amount: number
          manual_adjustment_reason: string | null
          marketer_id: string
          minimum_delivered_orders: number
          net_profit_before_bonus: number
          other_expenses: number
          payment_status: string
          period_end: string
          period_start: string
          realized_commission: number
          recalculated_at: string | null
          remaining_amount: number
          required_delivery_rate: number
          reviewed_at: string | null
          reviewed_by: string | null
          shipped_orders_count: number
          status: string
          system_calculated_total: number
          tier_change_reason: string | null
          total_paid_amount: number
          updated_at: string
          volume_tier_id: string | null
          volume_tier_name_snapshot: string | null
          volume_tier_order_snapshot: number | null
          workflow_status: string
        }
        Insert: {
          ad_spend?: number
          adjustment_proposed_at?: string | null
          adjustment_proposed_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          bonus_month: number
          bonus_year: number
          calculated_at?: string | null
          calculated_extra_orders_bonus?: number
          calculated_profit_bonus?: number
          calculated_salary?: number
          created_at?: string
          delivered_orders_count?: number
          delivery_rate?: number
          earned_tier_id?: string | null
          earned_tier_name_snapshot?: string | null
          earned_tier_order_snapshot?: number | null
          extra_delivered_orders?: number
          final_approved_amount?: number
          id?: string
          is_locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          manual_adjustment_amount?: number
          manual_adjustment_reason?: string | null
          marketer_id: string
          minimum_delivered_orders?: number
          net_profit_before_bonus?: number
          other_expenses?: number
          payment_status?: string
          period_end: string
          period_start: string
          realized_commission?: number
          recalculated_at?: string | null
          remaining_amount?: number
          required_delivery_rate?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipped_orders_count?: number
          status?: string
          system_calculated_total?: number
          tier_change_reason?: string | null
          total_paid_amount?: number
          updated_at?: string
          volume_tier_id?: string | null
          volume_tier_name_snapshot?: string | null
          volume_tier_order_snapshot?: number | null
          workflow_status?: string
        }
        Update: {
          ad_spend?: number
          adjustment_proposed_at?: string | null
          adjustment_proposed_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          bonus_month?: number
          bonus_year?: number
          calculated_at?: string | null
          calculated_extra_orders_bonus?: number
          calculated_profit_bonus?: number
          calculated_salary?: number
          created_at?: string
          delivered_orders_count?: number
          delivery_rate?: number
          earned_tier_id?: string | null
          earned_tier_name_snapshot?: string | null
          earned_tier_order_snapshot?: number | null
          extra_delivered_orders?: number
          final_approved_amount?: number
          id?: string
          is_locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          manual_adjustment_amount?: number
          manual_adjustment_reason?: string | null
          marketer_id?: string
          minimum_delivered_orders?: number
          net_profit_before_bonus?: number
          other_expenses?: number
          payment_status?: string
          period_end?: string
          period_start?: string
          realized_commission?: number
          recalculated_at?: string | null
          remaining_amount?: number
          required_delivery_rate?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipped_orders_count?: number
          status?: string
          system_calculated_total?: number
          tier_change_reason?: string | null
          total_paid_amount?: number
          updated_at?: string
          volume_tier_id?: string | null
          volume_tier_name_snapshot?: string | null
          volume_tier_order_snapshot?: number | null
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_marketer_bonuses_earned_tier_id_fkey"
            columns: ["earned_tier_id"]
            isOneToOne: false
            referencedRelation: "bonus_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_marketer_bonuses_marketer_id_fkey"
            columns: ["marketer_id"]
            isOneToOne: false
            referencedRelation: "marketers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_marketer_bonuses_volume_tier_id_fkey"
            columns: ["volume_tier_id"]
            isOneToOne: false
            referencedRelation: "bonus_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          base_product_name: string
          color: string | null
          commission_share: number
          created_at: string
          id: string
          marketer_code: string | null
          marketer_id: string | null
          order_id: string
          order_number: string | null
          order_status: Database["public"]["Enums"]["order_status"]
          product_option: string | null
          quantity: number
          raw_product_text: string | null
          shipping_company: string | null
          size: string | null
          updated_at: string
        }
        Insert: {
          base_product_name: string
          color?: string | null
          commission_share?: number
          created_at?: string
          id?: string
          marketer_code?: string | null
          marketer_id?: string | null
          order_id: string
          order_number?: string | null
          order_status?: Database["public"]["Enums"]["order_status"]
          product_option?: string | null
          quantity?: number
          raw_product_text?: string | null
          shipping_company?: string | null
          size?: string | null
          updated_at?: string
        }
        Update: {
          base_product_name?: string
          color?: string | null
          commission_share?: number
          created_at?: string
          id?: string
          marketer_code?: string | null
          marketer_id?: string | null
          order_id?: string
          order_number?: string | null
          order_status?: Database["public"]["Enums"]["order_status"]
          product_option?: string | null
          quantity?: number
          raw_product_text?: string | null
          shipping_company?: string | null
          size?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          import_batch_id: string | null
          new_status: Database["public"]["Enums"]["order_status"]
          old_status: Database["public"]["Enums"]["order_status"] | null
          order_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          import_batch_id?: string | null
          new_status: Database["public"]["Enums"]["order_status"]
          old_status?: Database["public"]["Enums"]["order_status"] | null
          order_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          import_batch_id?: string | null
          new_status?: Database["public"]["Enums"]["order_status"]
          old_status?: Database["public"]["Enums"]["order_status"] | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          commission: number | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          delivered_date: string | null
          external_order_id: string | null
          governorate: string | null
          id: string
          import_batch_id: string | null
          marketer_id: string | null
          order_date: string | null
          price: number | null
          product_id: string | null
          quantity: number | null
          raw_data: Json | null
          return_reason: string | null
          shipping_company_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          commission?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivered_date?: string | null
          external_order_id?: string | null
          governorate?: string | null
          id?: string
          import_batch_id?: string | null
          marketer_id?: string | null
          order_date?: string | null
          price?: number | null
          product_id?: string | null
          quantity?: number | null
          raw_data?: Json | null
          return_reason?: string | null
          shipping_company_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          commission?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivered_date?: string | null
          external_order_id?: string | null
          governorate?: string | null
          id?: string
          import_batch_id?: string | null
          marketer_id?: string | null
          order_date?: string | null
          price?: number | null
          product_id?: string | null
          quantity?: number | null
          raw_data?: Json | null
          return_reason?: string | null
          shipping_company_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_marketer_id_fkey"
            columns: ["marketer_id"]
            isOneToOne: false
            referencedRelation: "marketers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shipping_company_id_fkey"
            columns: ["shipping_company_id"]
            isOneToOne: false
            referencedRelation: "shipping_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          cost: number | null
          created_at: string
          id: string
          name: string
          notes: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      shipping_companies: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_marketer_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_my_marketer: { Args: { _marketer_id: string }; Returns: boolean }
    }
    Enums: {
      ad_platform: "meta" | "tiktok" | "manual"
      ad_spend_type:
        | "meta_ads"
        | "tiktok_ads"
        | "easy_order"
        | "salary"
        | "other"
      app_role: "admin" | "account_manager" | "marketer"
      marketer_status: "active" | "paused" | "inactive"
      order_status:
        | "pending"
        | "in_delivery"
        | "delivered"
        | "done"
        | "refunded"
        | "refund_request"
        | "cancelled"
      user_status: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ad_platform: ["meta", "tiktok", "manual"],
      ad_spend_type: [
        "meta_ads",
        "tiktok_ads",
        "easy_order",
        "salary",
        "other",
      ],
      app_role: ["admin", "account_manager", "marketer"],
      marketer_status: ["active", "paused", "inactive"],
      order_status: [
        "pending",
        "in_delivery",
        "delivered",
        "done",
        "refunded",
        "refund_request",
        "cancelled",
      ],
      user_status: ["pending", "approved", "rejected"],
    },
  },
} as const
