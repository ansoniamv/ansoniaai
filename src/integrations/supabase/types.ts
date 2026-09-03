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
      ai_model_pricing: {
        Row: {
          billing_type: string
          cached_input_per_mtok: number
          currency: string
          input_per_mtok: number
          model: string
          notes: string | null
          output_per_mtok: number
          per_call_usd: number | null
          provider: string
          unit_label: string | null
          updated_at: string
        }
        Insert: {
          billing_type?: string
          cached_input_per_mtok?: number
          currency?: string
          input_per_mtok?: number
          model: string
          notes?: string | null
          output_per_mtok?: number
          per_call_usd?: number | null
          provider: string
          unit_label?: string | null
          updated_at?: string
        }
        Update: {
          billing_type?: string
          cached_input_per_mtok?: number
          currency?: string
          input_per_mtok?: number
          model?: string
          notes?: string | null
          output_per_mtok?: number
          per_call_usd?: number | null
          provider?: string
          unit_label?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          billing_type: string
          cached_tokens: number | null
          cost_usd: number | null
          created_at: string
          deal_id: string | null
          function_name: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          partner_id: string | null
          provider: string | null
          service: string | null
          success: boolean
          units: number
        }
        Insert: {
          billing_type?: string
          cached_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          deal_id?: string | null
          function_name: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          partner_id?: string | null
          provider?: string | null
          service?: string | null
          success?: boolean
          units?: number
        }
        Update: {
          billing_type?: string
          cached_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          deal_id?: string | null
          function_name?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          partner_id?: string | null
          provider?: string | null
          service?: string | null
          success?: boolean
          units?: number
        }
        Relationships: []
      }
      buy_box_pillars: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          key: string
          name: string
          sort_order: number
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key: string
          name: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      buy_box_signals: {
        Row: {
          created_at: string
          description: string | null
          field_source: string
          id: string
          is_active: boolean
          max_value: number | null
          min_value: number | null
          name: string
          optimal_max: number | null
          optimal_min: number | null
          pillar_id: string
          scoring_method: string
          sort_order: number
          updated_at: string
          weight_within_pillar: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          field_source: string
          id?: string
          is_active?: boolean
          max_value?: number | null
          min_value?: number | null
          name: string
          optimal_max?: number | null
          optimal_min?: number | null
          pillar_id: string
          scoring_method?: string
          sort_order?: number
          updated_at?: string
          weight_within_pillar?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          field_source?: string
          id?: string
          is_active?: boolean
          max_value?: number | null
          min_value?: number | null
          name?: string
          optimal_max?: number | null
          optimal_min?: number | null
          pillar_id?: string
          scoring_method?: string
          sort_order?: number
          updated_at?: string
          weight_within_pillar?: number
        }
        Relationships: [
          {
            foreignKeyName: "buy_box_signals_pillar_id_fkey"
            columns: ["pillar_id"]
            isOneToOne: false
            referencedRelation: "buy_box_pillars"
            referencedColumns: ["id"]
          },
        ]
      }
      buy_box_thesis: {
        Row: {
          content: string
          created_at: string
          id: string
          last_updated_by: string | null
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          last_updated_by?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          last_updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      capital_partner_feedback: {
        Row: {
          category: string | null
          created_at: string
          deal_id: string | null
          engagement_id: string | null
          id: string
          partner_id: string | null
          price_surmountable: boolean | null
          reason_text: string | null
          snapshot: Json | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          deal_id?: string | null
          engagement_id?: string | null
          id?: string
          partner_id?: string | null
          price_surmountable?: boolean | null
          reason_text?: string | null
          snapshot?: Json | null
        }
        Update: {
          category?: string | null
          created_at?: string
          deal_id?: string | null
          engagement_id?: string | null
          id?: string
          partner_id?: string | null
          price_surmountable?: boolean | null
          reason_text?: string | null
          snapshot?: Json | null
        }
        Relationships: []
      }
      capital_raise_engagements: {
        Row: {
          committed_amount: number | null
          created_at: string
          deal_id: string
          discussion_scheduled_date: string | null
          id: string
          indicated_amount: number | null
          initial_reachout_date: string | null
          last_contact_date: string | null
          materials_shared_date: string | null
          materials_shared_items: string | null
          next_action: string | null
          next_action_date: string | null
          notes: string | null
          owner: string | null
          partner_id: string
          pass_category: string | null
          pass_feedback: string | null
          pass_price_surmountable: boolean | null
          passed: boolean
          removed_at: string | null
          serious_interest: boolean
          stage: Database["public"]["Enums"]["raise_engagement_stage"]
          stage_last_auto_at: string | null
          stage_last_auto_reason: string | null
          stage_locked_at: string | null
          stage_locked_manual: boolean
          updated_at: string
        }
        Insert: {
          committed_amount?: number | null
          created_at?: string
          deal_id: string
          discussion_scheduled_date?: string | null
          id?: string
          indicated_amount?: number | null
          initial_reachout_date?: string | null
          last_contact_date?: string | null
          materials_shared_date?: string | null
          materials_shared_items?: string | null
          next_action?: string | null
          next_action_date?: string | null
          notes?: string | null
          owner?: string | null
          partner_id: string
          pass_category?: string | null
          pass_feedback?: string | null
          pass_price_surmountable?: boolean | null
          passed?: boolean
          removed_at?: string | null
          serious_interest?: boolean
          stage?: Database["public"]["Enums"]["raise_engagement_stage"]
          stage_last_auto_at?: string | null
          stage_last_auto_reason?: string | null
          stage_locked_at?: string | null
          stage_locked_manual?: boolean
          updated_at?: string
        }
        Update: {
          committed_amount?: number | null
          created_at?: string
          deal_id?: string
          discussion_scheduled_date?: string | null
          id?: string
          indicated_amount?: number | null
          initial_reachout_date?: string | null
          last_contact_date?: string | null
          materials_shared_date?: string | null
          materials_shared_items?: string | null
          next_action?: string | null
          next_action_date?: string | null
          notes?: string | null
          owner?: string | null
          partner_id?: string
          pass_category?: string | null
          pass_feedback?: string | null
          pass_price_surmountable?: boolean | null
          passed?: boolean
          removed_at?: string | null
          serious_interest?: boolean
          stage?: Database["public"]["Enums"]["raise_engagement_stage"]
          stage_last_auto_at?: string | null
          stage_last_auto_reason?: string | null
          stage_locked_at?: string | null
          stage_locked_manual?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_raise_engagements_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_raise_engagements_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_raise_entries: {
        Row: {
          assigned_poc: string | null
          created_at: string
          deal_id: string
          equity_amount: number | null
          id: string
          last_activity_date: string | null
          notes: string | null
          partner_id: string
          stage: string
          updated_at: string
        }
        Insert: {
          assigned_poc?: string | null
          created_at?: string
          deal_id: string
          equity_amount?: number | null
          id?: string
          last_activity_date?: string | null
          notes?: string | null
          partner_id: string
          stage?: string
          updated_at?: string
        }
        Update: {
          assigned_poc?: string | null
          created_at?: string
          deal_id?: string
          equity_amount?: number | null
          id?: string
          last_activity_date?: string | null
          notes?: string | null
          partner_id?: string
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_raise_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_raise_entries_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          message: Json
          role: string
          thread_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: Json
          role: string
          thread_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: Json
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      connectors: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          key: string
          name: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          name: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_digests: {
        Row: {
          created_at: string
          deal_count: number
          digest_date: string
          generated_at: string
          id: string
          maybe_count: number
          medium_count: number
          skip_count: number
          strong_count: number
        }
        Insert: {
          created_at?: string
          deal_count?: number
          digest_date: string
          generated_at?: string
          id?: string
          maybe_count?: number
          medium_count?: number
          skip_count?: number
          strong_count?: number
        }
        Update: {
          created_at?: string
          deal_count?: number
          digest_date?: string
          generated_at?: string
          id?: string
          maybe_count?: number
          medium_count?: number
          skip_count?: number
          strong_count?: number
        }
        Relationships: []
      }
      deal_emails: {
        Row: {
          body: string | null
          created_at: string
          deal_id: string
          email_message_id: string
          extracted_fields: Json | null
          id: string
          received_at: string | null
          sender_email: string | null
          subject: string | null
          summary: string | null
          vision_checked: boolean
        }
        Insert: {
          body?: string | null
          created_at?: string
          deal_id: string
          email_message_id: string
          extracted_fields?: Json | null
          id?: string
          received_at?: string | null
          sender_email?: string | null
          subject?: string | null
          summary?: string | null
          vision_checked?: boolean
        }
        Update: {
          body?: string | null
          created_at?: string
          deal_id?: string
          email_message_id?: string
          extracted_fields?: Json | null
          id?: string
          received_at?: string | null
          sender_email?: string | null
          subject?: string | null
          summary?: string | null
          vision_checked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "deal_emails_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "inbox_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_enrichment: {
        Row: {
          address_used: string | null
          created_at: string
          deal_id: string
          id: string
          lat: number | null
          lon: number | null
          matched_address: string | null
          raw_response: Json | null
          rings: Json | null
          schools: Json | null
          source: string
          updated_at: string
        }
        Insert: {
          address_used?: string | null
          created_at?: string
          deal_id: string
          id?: string
          lat?: number | null
          lon?: number | null
          matched_address?: string | null
          raw_response?: Json | null
          rings?: Json | null
          schools?: Json | null
          source?: string
          updated_at?: string
        }
        Update: {
          address_used?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          lat?: number | null
          lon?: number | null
          matched_address?: string | null
          raw_response?: Json | null
          rings?: Json | null
          schools?: Json | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      deal_feedback: {
        Row: {
          action: string
          category: string | null
          created_at: string
          created_by: string | null
          deal_snapshot: Json | null
          id: string
          inbox_deal_id: string | null
          reason_text: string | null
        }
        Insert: {
          action: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          deal_snapshot?: Json | null
          id?: string
          inbox_deal_id?: string | null
          reason_text?: string | null
        }
        Update: {
          action?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          deal_snapshot?: Json | null
          id?: string
          inbox_deal_id?: string | null
          reason_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_feedback_inbox_deal_id_fkey"
            columns: ["inbox_deal_id"]
            isOneToOne: false
            referencedRelation: "inbox_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_field_events: {
        Row: {
          changed_by: string | null
          created_at: string
          deal_id: string
          field: string
          from_value: string | null
          id: string
          reason: string | null
          source: string
          to_value: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          deal_id: string
          field: string
          from_value?: string | null
          id?: string
          reason?: string | null
          source?: string
          to_value?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          deal_id?: string
          field?: string
          from_value?: string | null
          id?: string
          reason?: string | null
          source?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_field_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_pillar_scores: {
        Row: {
          created_at: string
          deal_id: string
          id: string
          pillar_contribution: number | null
          pillar_key: string
          pillar_name: string
          pillar_subscore: number | null
          pillar_weight: number
          signals: Json | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          id?: string
          pillar_contribution?: number | null
          pillar_key: string
          pillar_name: string
          pillar_subscore?: number | null
          pillar_weight: number
          signals?: Json | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          id?: string
          pillar_contribution?: number | null
          pillar_key?: string
          pillar_name?: string
          pillar_subscore?: number | null
          pillar_weight?: number
          signals?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_pillar_scores_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "inbox_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          active_concessions_summary: string | null
          address: string | null
          affordable: boolean | null
          ai_score: number | null
          ai_score_summary: string | null
          ami_limits: Json | null
          analyst_grade: string | null
          annual_population_growth: string | null
          area_median_income: string | null
          area_median_income_1mi: number | null
          asking_price: number | null
          assigned_to: string | null
          avg_posting_duration: number | null
          avg_price_change: number | null
          avg_time_on_market: number | null
          bachelors_pct_tract: number | null
          broker: string | null
          building_quality_score: number | null
          cfo_date: string | null
          city: string | null
          classic_units_remaining: number | null
          concessions_history: Json | null
          created_at: string
          deal_tier: string | null
          denial_overview: string | null
          denial_overview_at: string | null
          denial_themes: Json | null
          denial_themes_at: string | null
          documents: Json | null
          dscr: number | null
          enriched_at: string | null
          equity_multiple: number | null
          estimated_equity: number | null
          exit_cap: number | null
          expense_ratio: number | null
          factor_scores: Json | null
          floor_plans: Json | null
          grm: number | null
          gross_scheduled_rent: number | null
          hard_filter_failures: Json | null
          hellodata_error: string | null
          hellodata_id: string | null
          hellodata_last_synced_at: string | null
          hellodata_payload: Json | null
          hellodata_raw: Json | null
          hellodata_status: string | null
          hold_period_years: number | null
          id: string
          in_place_avg_rent: number | null
          in_place_cap_rate: number | null
          inbox_deal_id: string | null
          interest_level: Database["public"]["Enums"]["interest_level"]
          interest_rate: number | null
          is_lease_up: boolean | null
          job_growth_pct: number | null
          last_scored_at: string | null
          latitude: number | null
          loan_term_years: number | null
          longitude: number | null
          ltv: number | null
          management_company: string | null
          market_cap_rate: number | null
          marketed: boolean | null
          median_age_tract: number | null
          median_income_tract: number | null
          median_rent_tract: number | null
          msa: string | null
          nearest_employment_node_min: number | null
          new_supply_pct_of_stock: number | null
          notes: string | null
          occupancy_pct: number | null
          owner_occupied_pct_tract: number | null
          passes_hard_filters: boolean | null
          photo_urls: Json | null
          photos: string[] | null
          pillar_scores: Json | null
          pipeline_stage: string | null
          population_density_tract: number | null
          population_growth_pct: number | null
          price_per_sqft: number | null
          projected_irr: number | null
          property_address: string | null
          property_name: string
          property_phone: string | null
          property_website: string | null
          race_breakdown_tract: Json | null
          raise_archive_note: string | null
          raise_archived_at: string | null
          raise_archived_by: string | null
          raise_status: Database["public"]["Enums"]["deal_raise_status"]
          regulatory_risk: string | null
          renovation_budget_per_unit: number | null
          rent_comps: Json | null
          review_avg_rating: number | null
          review_count: number | null
          review_negative_count: number | null
          review_positive_count: number | null
          sales_comps: Json | null
          school_rating: number | null
          score_confidence: string | null
          score_coverage: Json | null
          score_thesis_adjustment: number | null
          scored_at: string | null
          source: string
          stabilized_cap_rate: number | null
          stabilized_noi: number | null
          stabilized_rent: number | null
          state: string | null
          status: Database["public"]["Enums"]["deal_status"]
          t12_noi: number | null
          t12_opex: number | null
          target_raise: number | null
          total_capex: number | null
          total_committed: number
          total_renovated_units: number | null
          total_score: number | null
          total_sqft: number | null
          unit_count: number | null
          updated_at: string
          uses_rev_management: boolean | null
          vacancy_rate_tract: number | null
          value_add_potential:
            | Database["public"]["Enums"]["value_add_level"]
            | null
          value_add_upside: number | null
          vintage_year: number | null
          year1_coc: number | null
          zip: string | null
        }
        Insert: {
          active_concessions_summary?: string | null
          address?: string | null
          affordable?: boolean | null
          ai_score?: number | null
          ai_score_summary?: string | null
          ami_limits?: Json | null
          analyst_grade?: string | null
          annual_population_growth?: string | null
          area_median_income?: string | null
          area_median_income_1mi?: number | null
          asking_price?: number | null
          assigned_to?: string | null
          avg_posting_duration?: number | null
          avg_price_change?: number | null
          avg_time_on_market?: number | null
          bachelors_pct_tract?: number | null
          broker?: string | null
          building_quality_score?: number | null
          cfo_date?: string | null
          city?: string | null
          classic_units_remaining?: number | null
          concessions_history?: Json | null
          created_at?: string
          deal_tier?: string | null
          denial_overview?: string | null
          denial_overview_at?: string | null
          denial_themes?: Json | null
          denial_themes_at?: string | null
          documents?: Json | null
          dscr?: number | null
          enriched_at?: string | null
          equity_multiple?: number | null
          estimated_equity?: number | null
          exit_cap?: number | null
          expense_ratio?: number | null
          factor_scores?: Json | null
          floor_plans?: Json | null
          grm?: number | null
          gross_scheduled_rent?: number | null
          hard_filter_failures?: Json | null
          hellodata_error?: string | null
          hellodata_id?: string | null
          hellodata_last_synced_at?: string | null
          hellodata_payload?: Json | null
          hellodata_raw?: Json | null
          hellodata_status?: string | null
          hold_period_years?: number | null
          id?: string
          in_place_avg_rent?: number | null
          in_place_cap_rate?: number | null
          inbox_deal_id?: string | null
          interest_level?: Database["public"]["Enums"]["interest_level"]
          interest_rate?: number | null
          is_lease_up?: boolean | null
          job_growth_pct?: number | null
          last_scored_at?: string | null
          latitude?: number | null
          loan_term_years?: number | null
          longitude?: number | null
          ltv?: number | null
          management_company?: string | null
          market_cap_rate?: number | null
          marketed?: boolean | null
          median_age_tract?: number | null
          median_income_tract?: number | null
          median_rent_tract?: number | null
          msa?: string | null
          nearest_employment_node_min?: number | null
          new_supply_pct_of_stock?: number | null
          notes?: string | null
          occupancy_pct?: number | null
          owner_occupied_pct_tract?: number | null
          passes_hard_filters?: boolean | null
          photo_urls?: Json | null
          photos?: string[] | null
          pillar_scores?: Json | null
          pipeline_stage?: string | null
          population_density_tract?: number | null
          population_growth_pct?: number | null
          price_per_sqft?: number | null
          projected_irr?: number | null
          property_address?: string | null
          property_name: string
          property_phone?: string | null
          property_website?: string | null
          race_breakdown_tract?: Json | null
          raise_archive_note?: string | null
          raise_archived_at?: string | null
          raise_archived_by?: string | null
          raise_status?: Database["public"]["Enums"]["deal_raise_status"]
          regulatory_risk?: string | null
          renovation_budget_per_unit?: number | null
          rent_comps?: Json | null
          review_avg_rating?: number | null
          review_count?: number | null
          review_negative_count?: number | null
          review_positive_count?: number | null
          sales_comps?: Json | null
          school_rating?: number | null
          score_confidence?: string | null
          score_coverage?: Json | null
          score_thesis_adjustment?: number | null
          scored_at?: string | null
          source?: string
          stabilized_cap_rate?: number | null
          stabilized_noi?: number | null
          stabilized_rent?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          t12_noi?: number | null
          t12_opex?: number | null
          target_raise?: number | null
          total_capex?: number | null
          total_committed?: number
          total_renovated_units?: number | null
          total_score?: number | null
          total_sqft?: number | null
          unit_count?: number | null
          updated_at?: string
          uses_rev_management?: boolean | null
          vacancy_rate_tract?: number | null
          value_add_potential?:
            | Database["public"]["Enums"]["value_add_level"]
            | null
          value_add_upside?: number | null
          vintage_year?: number | null
          year1_coc?: number | null
          zip?: string | null
        }
        Update: {
          active_concessions_summary?: string | null
          address?: string | null
          affordable?: boolean | null
          ai_score?: number | null
          ai_score_summary?: string | null
          ami_limits?: Json | null
          analyst_grade?: string | null
          annual_population_growth?: string | null
          area_median_income?: string | null
          area_median_income_1mi?: number | null
          asking_price?: number | null
          assigned_to?: string | null
          avg_posting_duration?: number | null
          avg_price_change?: number | null
          avg_time_on_market?: number | null
          bachelors_pct_tract?: number | null
          broker?: string | null
          building_quality_score?: number | null
          cfo_date?: string | null
          city?: string | null
          classic_units_remaining?: number | null
          concessions_history?: Json | null
          created_at?: string
          deal_tier?: string | null
          denial_overview?: string | null
          denial_overview_at?: string | null
          denial_themes?: Json | null
          denial_themes_at?: string | null
          documents?: Json | null
          dscr?: number | null
          enriched_at?: string | null
          equity_multiple?: number | null
          estimated_equity?: number | null
          exit_cap?: number | null
          expense_ratio?: number | null
          factor_scores?: Json | null
          floor_plans?: Json | null
          grm?: number | null
          gross_scheduled_rent?: number | null
          hard_filter_failures?: Json | null
          hellodata_error?: string | null
          hellodata_id?: string | null
          hellodata_last_synced_at?: string | null
          hellodata_payload?: Json | null
          hellodata_raw?: Json | null
          hellodata_status?: string | null
          hold_period_years?: number | null
          id?: string
          in_place_avg_rent?: number | null
          in_place_cap_rate?: number | null
          inbox_deal_id?: string | null
          interest_level?: Database["public"]["Enums"]["interest_level"]
          interest_rate?: number | null
          is_lease_up?: boolean | null
          job_growth_pct?: number | null
          last_scored_at?: string | null
          latitude?: number | null
          loan_term_years?: number | null
          longitude?: number | null
          ltv?: number | null
          management_company?: string | null
          market_cap_rate?: number | null
          marketed?: boolean | null
          median_age_tract?: number | null
          median_income_tract?: number | null
          median_rent_tract?: number | null
          msa?: string | null
          nearest_employment_node_min?: number | null
          new_supply_pct_of_stock?: number | null
          notes?: string | null
          occupancy_pct?: number | null
          owner_occupied_pct_tract?: number | null
          passes_hard_filters?: boolean | null
          photo_urls?: Json | null
          photos?: string[] | null
          pillar_scores?: Json | null
          pipeline_stage?: string | null
          population_density_tract?: number | null
          population_growth_pct?: number | null
          price_per_sqft?: number | null
          projected_irr?: number | null
          property_address?: string | null
          property_name?: string
          property_phone?: string | null
          property_website?: string | null
          race_breakdown_tract?: Json | null
          raise_archive_note?: string | null
          raise_archived_at?: string | null
          raise_archived_by?: string | null
          raise_status?: Database["public"]["Enums"]["deal_raise_status"]
          regulatory_risk?: string | null
          renovation_budget_per_unit?: number | null
          rent_comps?: Json | null
          review_avg_rating?: number | null
          review_count?: number | null
          review_negative_count?: number | null
          review_positive_count?: number | null
          sales_comps?: Json | null
          school_rating?: number | null
          score_confidence?: string | null
          score_coverage?: Json | null
          score_thesis_adjustment?: number | null
          scored_at?: string | null
          source?: string
          stabilized_cap_rate?: number | null
          stabilized_noi?: number | null
          stabilized_rent?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          t12_noi?: number | null
          t12_opex?: number | null
          target_raise?: number | null
          total_capex?: number | null
          total_committed?: number
          total_renovated_units?: number | null
          total_score?: number | null
          total_sqft?: number | null
          unit_count?: number | null
          updated_at?: string
          uses_rev_management?: boolean | null
          vacancy_rate_tract?: number | null
          value_add_potential?:
            | Database["public"]["Enums"]["value_add_level"]
            | null
          value_add_upside?: number | null
          vintage_year?: number | null
          year1_coc?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_inbox_deal_id_fkey"
            columns: ["inbox_deal_id"]
            isOneToOne: false
            referencedRelation: "inbox_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals_status_backup_20260818: {
        Row: {
          id: string | null
          old_pipeline_stage: string | null
          old_status: string | null
        }
        Insert: {
          id?: string | null
          old_pipeline_stage?: string | null
          old_status?: string | null
        }
        Update: {
          id?: string | null
          old_pipeline_stage?: string | null
          old_status?: string | null
        }
        Relationships: []
      }
      entity_tags: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          tag_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_deals: {
        Row: {
          accepted_deal_id: string | null
          address: string | null
          asking_price: string | null
          asset_class: string | null
          assigned_to: string | null
          avg_sf: number | null
          broker_contact_email: string | null
          broker_contact_name: string | null
          broker_firm: string | null
          created_at: string
          denial_category: string | null
          denial_reason: string | null
          denied: boolean
          denied_at: string | null
          denied_by: string | null
          email_body: string | null
          email_count: number
          email_message_id: string | null
          email_received_at: string | null
          email_subject: string | null
          email_thread_summary: string | null
          fit_rationale: string | null
          fit_score: number | null
          fit_tier: string | null
          gate_checked_at: string | null
          gate_content_hash: string | null
          gate_reason: string | null
          gate_status: string
          id: string
          location_city: string | null
          location_state: string | null
          msa: string | null
          occupancy_pct: number | null
          offers_due: string | null
          other_details: string | null
          property_name: string | null
          reviewed: boolean
          reviewed_at: string | null
          source: string | null
          strategy: string | null
          units: number | null
          updated_at: string
          year_built: number | null
        }
        Insert: {
          accepted_deal_id?: string | null
          address?: string | null
          asking_price?: string | null
          asset_class?: string | null
          assigned_to?: string | null
          avg_sf?: number | null
          broker_contact_email?: string | null
          broker_contact_name?: string | null
          broker_firm?: string | null
          created_at?: string
          denial_category?: string | null
          denial_reason?: string | null
          denied?: boolean
          denied_at?: string | null
          denied_by?: string | null
          email_body?: string | null
          email_count?: number
          email_message_id?: string | null
          email_received_at?: string | null
          email_subject?: string | null
          email_thread_summary?: string | null
          fit_rationale?: string | null
          fit_score?: number | null
          fit_tier?: string | null
          gate_checked_at?: string | null
          gate_content_hash?: string | null
          gate_reason?: string | null
          gate_status?: string
          id?: string
          location_city?: string | null
          location_state?: string | null
          msa?: string | null
          occupancy_pct?: number | null
          offers_due?: string | null
          other_details?: string | null
          property_name?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          source?: string | null
          strategy?: string | null
          units?: number | null
          updated_at?: string
          year_built?: number | null
        }
        Update: {
          accepted_deal_id?: string | null
          address?: string | null
          asking_price?: string | null
          asset_class?: string | null
          assigned_to?: string | null
          avg_sf?: number | null
          broker_contact_email?: string | null
          broker_contact_name?: string | null
          broker_firm?: string | null
          created_at?: string
          denial_category?: string | null
          denial_reason?: string | null
          denied?: boolean
          denied_at?: string | null
          denied_by?: string | null
          email_body?: string | null
          email_count?: number
          email_message_id?: string | null
          email_received_at?: string | null
          email_subject?: string | null
          email_thread_summary?: string | null
          fit_rationale?: string | null
          fit_score?: number | null
          fit_tier?: string | null
          gate_checked_at?: string | null
          gate_content_hash?: string | null
          gate_reason?: string | null
          gate_status?: string
          id?: string
          location_city?: string | null
          location_state?: string | null
          msa?: string | null
          occupancy_pct?: number | null
          offers_due?: string | null
          other_details?: string | null
          property_name?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          source?: string | null
          strategy?: string | null
          units?: number | null
          updated_at?: string
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inbox_deals_accepted_deal_id_fkey"
            columns: ["accepted_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_deals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      learned_partner_strategy: {
        Row: {
          content: string
          example_count: number
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string
          example_count?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          example_count?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      learned_strategy: {
        Row: {
          content: string
          example_count: number
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string
          example_count?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          example_count?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      note_links: {
        Row: {
          created_at: string
          id: string
          linked_id: string
          linked_type: string
          note_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          linked_id: string
          linked_type: string
          note_id: string
        }
        Update: {
          created_at?: string
          id?: string
          linked_id?: string
          linked_type?: string
          note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_links_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          author: string | null
          classification: string
          classification_summary: string | null
          classified_at: string | null
          classified_content_hash: string | null
          contact_id: string | null
          content: string
          content_format: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          is_pinned: boolean
          team_member_id: string | null
          updated_at: string
        }
        Insert: {
          author?: string | null
          classification?: string
          classification_summary?: string | null
          classified_at?: string | null
          classified_content_hash?: string | null
          contact_id?: string | null
          content: string
          content_format?: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          is_pinned?: boolean
          team_member_id?: string | null
          updated_at?: string
        }
        Update: {
          author?: string | null
          classification?: string
          classification_summary?: string | null
          classified_at?: string | null
          classified_content_hash?: string | null
          contact_id?: string | null
          content?: string
          content_format?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          is_pinned?: boolean
          team_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "partner_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      outlook_message_deals: {
        Row: {
          created_at: string
          deal_id: string
          message_id: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          message_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlook_message_deals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_message_deals_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "outlook_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      outlook_messages: {
        Row: {
          analyzed_at: string | null
          body_html: string | null
          body_text: string | null
          cc_recipients: Json | null
          conversation_id: string | null
          created_at: string
          deal_id: string | null
          folder: string | null
          from_email: string | null
          from_name: string | null
          has_attachments: boolean | null
          id: string
          importance: string | null
          is_read: boolean | null
          mailbox: string
          message_id: string
          partner_contact_id: string | null
          partner_id: string | null
          preview: string | null
          raw: Json | null
          received_at: string | null
          sent_at: string | null
          source: string
          subject: string | null
          synced_at: string
          to_recipients: Json | null
          updated_at: string
          web_link: string | null
        }
        Insert: {
          analyzed_at?: string | null
          body_html?: string | null
          body_text?: string | null
          cc_recipients?: Json | null
          conversation_id?: string | null
          created_at?: string
          deal_id?: string | null
          folder?: string | null
          from_email?: string | null
          from_name?: string | null
          has_attachments?: boolean | null
          id?: string
          importance?: string | null
          is_read?: boolean | null
          mailbox?: string
          message_id: string
          partner_contact_id?: string | null
          partner_id?: string | null
          preview?: string | null
          raw?: Json | null
          received_at?: string | null
          sent_at?: string | null
          source?: string
          subject?: string | null
          synced_at?: string
          to_recipients?: Json | null
          updated_at?: string
          web_link?: string | null
        }
        Update: {
          analyzed_at?: string | null
          body_html?: string | null
          body_text?: string | null
          cc_recipients?: Json | null
          conversation_id?: string | null
          created_at?: string
          deal_id?: string | null
          folder?: string | null
          from_email?: string | null
          from_name?: string | null
          has_attachments?: boolean | null
          id?: string
          importance?: string | null
          is_read?: boolean | null
          mailbox?: string
          message_id?: string
          partner_contact_id?: string | null
          partner_id?: string | null
          preview?: string | null
          raw?: Json | null
          received_at?: string | null
          sent_at?: string | null
          source?: string
          subject?: string | null
          synced_at?: string
          to_recipients?: Json | null
          updated_at?: string
          web_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outlook_messages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_messages_partner_contact_id_fkey"
            columns: ["partner_contact_id"]
            isOneToOne: false
            referencedRelation: "partner_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_messages_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_attachments: {
        Row: {
          content_type: string | null
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          label: string | null
          partner_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          label?: string | null
          partner_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          label?: string | null
          partner_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_attachments_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_contacts: {
        Row: {
          ansonia_poc: string | null
          created_at: string
          email: string | null
          firm_location: string | null
          id: string
          linkedin_url: string | null
          name: string
          partner_id: string
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          ansonia_poc?: string | null
          created_at?: string
          email?: string | null
          firm_location?: string | null
          id?: string
          linkedin_url?: string | null
          name: string
          partner_id: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          ansonia_poc?: string | null
          created_at?: string
          email?: string | null
          firm_location?: string | null
          id?: string
          linkedin_url?: string | null
          name?: string
          partner_id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_contacts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_interactions: {
        Row: {
          author: string | null
          contact_id: string | null
          content: string
          created_at: string
          fact_category: string | null
          id: string
          interaction_date: string
          interaction_type: string
          partner_id: string
          source: string | null
          source_message_ids: string[] | null
        }
        Insert: {
          author?: string | null
          contact_id?: string | null
          content: string
          created_at?: string
          fact_category?: string | null
          id?: string
          interaction_date?: string
          interaction_type?: string
          partner_id: string
          source?: string | null
          source_message_ids?: string[] | null
        }
        Update: {
          author?: string | null
          contact_id?: string | null
          content?: string
          created_at?: string
          fact_category?: string | null
          id?: string
          interaction_date?: string
          interaction_type?: string
          partner_id?: string
          source?: string | null
          source_message_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "partner_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_interactions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_pipeline_exports: {
        Row: {
          deal_count: number
          deal_ids: string[]
          exported_at: string
          exported_by: string | null
          format: string
          id: string
          included_outside: boolean
          included_score: boolean
          partner_id: string
        }
        Insert: {
          deal_count?: number
          deal_ids?: string[]
          exported_at?: string
          exported_by?: string | null
          format?: string
          id?: string
          included_outside?: boolean
          included_score?: boolean
          partner_id: string
        }
        Update: {
          deal_count?: number
          deal_ids?: string[]
          exported_at?: string
          exported_by?: string | null
          format?: string
          id?: string
          included_outside?: boolean
          included_score?: boolean
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_pipeline_exports_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_suggestions: {
        Row: {
          applied_at: string | null
          confidence: number | null
          created_at: string
          current_value: Json | null
          deal_confidence: number | null
          deal_id: string | null
          engagement_id: string | null
          evidence: Json | null
          field: string | null
          id: string
          partner_id: string | null
          proposed_value: Json
          rationale: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          signals: Json | null
          status: string
          summary: string
          superseded_by: string | null
          type: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          current_value?: Json | null
          deal_confidence?: number | null
          deal_id?: string | null
          engagement_id?: string | null
          evidence?: Json | null
          field?: string | null
          id?: string
          partner_id?: string | null
          proposed_value: Json
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signals?: Json | null
          status?: string
          summary: string
          superseded_by?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          current_value?: Json | null
          deal_confidence?: number | null
          deal_id?: string | null
          engagement_id?: string | null
          evidence?: Json | null
          field?: string | null
          id?: string
          partner_id?: string | null
          proposed_value?: Json
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signals?: Json | null
          status?: string
          summary?: string
          superseded_by?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_suggestions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "partner_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_tasks: {
        Row: {
          assignee: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          partner_id: string
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          partner_id: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          partner_id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "partner_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_tasks_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_warmth_signals: {
        Row: {
          avg_response_hours: number | null
          computed_at: string
          computed_level: string | null
          deals_engaged: number
          inbound_90d: number
          last_inbound_at: string | null
          last_outbound_at: string | null
          meetings_scheduled: number
          outbound_90d: number
          partner_id: string
        }
        Insert: {
          avg_response_hours?: number | null
          computed_at?: string
          computed_level?: string | null
          deals_engaged?: number
          inbound_90d?: number
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          meetings_scheduled?: number
          outbound_90d?: number
          partner_id: string
        }
        Update: {
          avg_response_hours?: number | null
          computed_at?: string
          computed_level?: string | null
          deals_engaged?: number
          inbound_90d?: number
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          meetings_scheduled?: number
          outbound_90d?: number
          partner_id?: string
        }
        Relationships: []
      }
      partners: {
        Row: {
          additional_notes: string | null
          ansonia_poc: string | null
          archived_at: string | null
          capital_available_from: string | null
          capital_status: string | null
          capital_status_as_of: string | null
          capital_status_detail: string | null
          created_at: string
          data_source: string | null
          enriched_at: string | null
          enriched_fields: Json
          enrichment_notes_hash: string | null
          firm_type: string | null
          geography: string[] | null
          geography_avoid: string[]
          headquarters: string | null
          hold_period: string[] | null
          id: string
          investor_type: string[] | null
          last_edited_at: string
          manual_fields: string[]
          max_equity_m: number | null
          min_equity_m: number | null
          name: string
          organized_notes: string | null
          product_types: string[] | null
          profile_summary: string | null
          profile_summary_hash: string | null
          profile_summary_updated_at: string | null
          relationship_strength: string | null
          status: string | null
          strategy_affordable: boolean | null
          strategy_core_plus: boolean | null
          strategy_value_add: boolean | null
          strategy_workforce: boolean | null
          suburban: boolean | null
          updated_at: string
          urban_infill: boolean | null
          website: string | null
        }
        Insert: {
          additional_notes?: string | null
          ansonia_poc?: string | null
          archived_at?: string | null
          capital_available_from?: string | null
          capital_status?: string | null
          capital_status_as_of?: string | null
          capital_status_detail?: string | null
          created_at?: string
          data_source?: string | null
          enriched_at?: string | null
          enriched_fields?: Json
          enrichment_notes_hash?: string | null
          firm_type?: string | null
          geography?: string[] | null
          geography_avoid?: string[]
          headquarters?: string | null
          hold_period?: string[] | null
          id?: string
          investor_type?: string[] | null
          last_edited_at?: string
          manual_fields?: string[]
          max_equity_m?: number | null
          min_equity_m?: number | null
          name: string
          organized_notes?: string | null
          product_types?: string[] | null
          profile_summary?: string | null
          profile_summary_hash?: string | null
          profile_summary_updated_at?: string | null
          relationship_strength?: string | null
          status?: string | null
          strategy_affordable?: boolean | null
          strategy_core_plus?: boolean | null
          strategy_value_add?: boolean | null
          strategy_workforce?: boolean | null
          suburban?: boolean | null
          updated_at?: string
          urban_infill?: boolean | null
          website?: string | null
        }
        Update: {
          additional_notes?: string | null
          ansonia_poc?: string | null
          archived_at?: string | null
          capital_available_from?: string | null
          capital_status?: string | null
          capital_status_as_of?: string | null
          capital_status_detail?: string | null
          created_at?: string
          data_source?: string | null
          enriched_at?: string | null
          enriched_fields?: Json
          enrichment_notes_hash?: string | null
          firm_type?: string | null
          geography?: string[] | null
          geography_avoid?: string[]
          headquarters?: string | null
          hold_period?: string[] | null
          id?: string
          investor_type?: string[] | null
          last_edited_at?: string
          manual_fields?: string[]
          max_equity_m?: number | null
          min_equity_m?: number | null
          name?: string
          organized_notes?: string | null
          product_types?: string[] | null
          profile_summary?: string | null
          profile_summary_hash?: string | null
          profile_summary_updated_at?: string | null
          relationship_strength?: string | null
          status?: string | null
          strategy_affordable?: boolean | null
          strategy_core_plus?: boolean | null
          strategy_value_add?: boolean | null
          strategy_workforce?: boolean | null
          suburban?: boolean | null
          updated_at?: string
          urban_infill?: boolean | null
          website?: string | null
        }
        Relationships: []
      }
      permits_data: {
        Row: {
          cbsa_code: string
          cbsa_name: string | null
          created_at: string
          id: string
          month: number | null
          multifamily_permits: number | null
          raw: Json | null
          total_units: number | null
          year: number
        }
        Insert: {
          cbsa_code: string
          cbsa_name?: string | null
          created_at?: string
          id?: string
          month?: number | null
          multifamily_permits?: number | null
          raw?: Json | null
          total_units?: number | null
          year: number
        }
        Update: {
          cbsa_code?: string
          cbsa_name?: string | null
          created_at?: string
          id?: string
          month?: number | null
          multifamily_permits?: number | null
          raw?: Json | null
          total_units?: number | null
          year?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_events: {
        Row: {
          actor: string | null
          created_at: string
          detail: string | null
          event_type: string
          from_status: string | null
          id: string
          item_id: string | null
          to_status: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          detail?: string | null
          event_type: string
          from_status?: string | null
          id?: string
          item_id?: string | null
          to_status?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          detail?: string | null
          event_type?: string
          from_status?: string | null
          id?: string
          item_id?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "roadmap_items"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_items: {
        Row: {
          auto_completed: boolean
          completed_at: string | null
          completion_rule: Json | null
          created_at: string
          description: string | null
          id: string
          phase: string
          priority: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          auto_completed?: boolean
          completed_at?: string | null
          completion_rule?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          phase: string
          priority?: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          auto_completed?: boolean
          completed_at?: string | null
          completion_rule?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          phase?: string
          priority?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      stage_change_events: {
        Row: {
          context: Json | null
          created_at: string
          deal_id: string | null
          engagement_id: string
          from_stage: string | null
          id: string
          partner_id: string | null
          reason: string
          to_stage: string
          triggered_by: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          deal_id?: string | null
          engagement_id: string
          from_stage?: string | null
          id?: string
          partner_id?: string | null
          reason: string
          to_stage: string
          triggered_by?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          deal_id?: string | null
          engagement_id?: string
          from_stage?: string | null
          id?: string
          partner_id?: string | null
          reason?: string
          to_stage?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_change_events_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "capital_raise_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          role: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          role?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          role?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          key: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          user_id: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          user_id?: string
          value?: Json
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
      warmth_import_log: {
        Row: {
          applied_at: string
          applied_by: string | null
          batch_id: string
          id: string
          matched_by: string | null
          new_warmth: string | null
          old_warmth: string | null
          partner_id: string | null
          partner_name: string | null
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          batch_id: string
          id?: string
          matched_by?: string | null
          new_warmth?: string | null
          old_warmth?: string | null
          partner_id?: string | null
          partner_name?: string | null
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          batch_id?: string
          id?: string
          matched_by?: string | null
          new_warmth?: string | null
          old_warmth?: string | null
          partner_id?: string | null
          partner_name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ai_usage_daily: {
        Row: {
          billing_type: string | null
          cached_tokens: number | null
          calls: number | null
          cost_usd: number | null
          day: string | null
          function_name: string | null
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          service: string | null
          units: number | null
        }
        Relationships: []
      }
      deal_enrichment_summary: {
        Row: {
          deal_id: string | null
          medhinc_1mi: number | null
          medhinc_3mi: number | null
          medhinc_5mi: number | null
          pop_cy_1mi: number | null
          pop_cy_3mi: number | null
          pop_cy_5mi: number | null
          pop_fy_1mi: number | null
          pop_fy_3mi: number | null
          pop_fy_5mi: number | null
        }
        Insert: {
          deal_id?: string | null
          medhinc_1mi?: never
          medhinc_3mi?: never
          medhinc_5mi?: never
          pop_cy_1mi?: never
          pop_cy_3mi?: never
          pop_cy_5mi?: never
          pop_fy_1mi?: never
          pop_fy_3mi?: never
          pop_fy_5mi?: never
        }
        Update: {
          deal_id?: string | null
          medhinc_1mi?: never
          medhinc_3mi?: never
          medhinc_5mi?: never
          pop_cy_1mi?: never
          pop_cy_3mi?: never
          pop_cy_5mi?: never
          pop_fy_1mi?: never
          pop_fy_3mi?: never
          pop_fy_5mi?: never
        }
        Relationships: []
      }
    }
    Functions: {
      accept_inbox_deal: { Args: { _inbox_deal_id: string }; Returns: string }
      bump_partner_last_edited: {
        Args: { _partner_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      merge_partners: {
        Args: { _duplicate_id: string; _primary_id: string }
        Returns: {
          additional_notes: string | null
          ansonia_poc: string | null
          archived_at: string | null
          capital_available_from: string | null
          capital_status: string | null
          capital_status_as_of: string | null
          capital_status_detail: string | null
          created_at: string
          data_source: string | null
          enriched_at: string | null
          enriched_fields: Json
          enrichment_notes_hash: string | null
          firm_type: string | null
          geography: string[] | null
          geography_avoid: string[]
          headquarters: string | null
          hold_period: string[] | null
          id: string
          investor_type: string[] | null
          last_edited_at: string
          manual_fields: string[]
          max_equity_m: number | null
          min_equity_m: number | null
          name: string
          organized_notes: string | null
          product_types: string[] | null
          profile_summary: string | null
          profile_summary_hash: string | null
          profile_summary_updated_at: string | null
          relationship_strength: string | null
          status: string | null
          strategy_affordable: boolean | null
          strategy_core_plus: boolean | null
          strategy_value_add: boolean | null
          strategy_workforce: boolean | null
          suburban: boolean | null
          updated_at: string
          urban_infill: boolean | null
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "partners"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recompute_deal_total_committed: {
        Args: { _deal_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      deal_raise_status:
        | "not_started"
        | "raising"
        | "fully_committed"
        | "closed"
      deal_status:
        | "New"
        | "Screening"
        | "On Hold/Tracking"
        | "Underwriting"
        | "B&F"
        | "Under Contract"
        | "Pass"
      interest_level: "High" | "Med" | "Low" | "TBD"
      profile_status: "pending" | "approved" | "rejected"
      raise_engagement_stage:
        | "added_to_pipeline"
        | "initial_reachout"
        | "materials_shared"
        | "in_discussion"
        | "serious_interest"
        | "committed"
        | "passed"
      value_add_level: "High" | "Medium" | "Low"
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
      app_role: ["admin", "user"],
      deal_raise_status: [
        "not_started",
        "raising",
        "fully_committed",
        "closed",
      ],
      deal_status: [
        "New",
        "Screening",
        "On Hold/Tracking",
        "Underwriting",
        "B&F",
        "Under Contract",
        "Pass",
      ],
      interest_level: ["High", "Med", "Low", "TBD"],
      profile_status: ["pending", "approved", "rejected"],
      raise_engagement_stage: [
        "added_to_pipeline",
        "initial_reachout",
        "materials_shared",
        "in_discussion",
        "serious_interest",
        "committed",
        "passed",
      ],
      value_add_level: ["High", "Medium", "Low"],
    },
  },
} as const
