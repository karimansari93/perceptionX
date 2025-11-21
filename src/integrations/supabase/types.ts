export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      confirmed_prompts: {
        Row: {
          id: string
          created_at: string
          onboarding_id: string | null
          user_id: string | null
          company_id: string | null
          created_by: string | null
          prompt_text: string
          prompt_category: string
          prompt_type: Database["public"]["Enums"]["prompt_type"] | null
          talentx_attribute_id: string | null
          is_active: boolean
          is_pro_prompt: boolean | null
          industry_context: string | null
          job_function_context: string | null
          location_context: string | null
          prompt_theme: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          onboarding_id?: string | null
          user_id?: string | null
          company_id?: string | null
          created_by?: string | null
          prompt_text: string
          prompt_category: string
          prompt_type?: Database["public"]["Enums"]["prompt_type"] | null
          talentx_attribute_id?: string | null
          is_active?: boolean
          is_pro_prompt?: boolean | null
          industry_context?: string | null
          job_function_context?: string | null
          location_context?: string | null
          prompt_theme?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          onboarding_id?: string | null
          user_id?: string | null
          company_id?: string | null
          created_by?: string | null
          prompt_text?: string
          prompt_category?: string
          prompt_type?: Database["public"]["Enums"]["prompt_type"] | null
          talentx_attribute_id?: string | null
          is_active?: boolean
          is_pro_prompt?: boolean | null
          industry_context?: string | null
          job_function_context?: string | null
          location_context?: string | null
          prompt_theme?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confirmed_prompts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmed_prompts_onboarding_id_fkey"
            columns: ["onboarding_id"]
            isOneToOne: false
            referencedRelation: "user_onboarding"
            referencedColumns: ["id"]
          },
        ]
      }
      company_industries: {
        Row: {
          id: string
          company_id: string
          industry: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          company_id: string
          industry: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          industry?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_industries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_industries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          id: string
          name: string
          industry: string
          company_size: string | null
          competitors: string[] | null
          settings: Json | null
          created_at: string
          updated_at: string
          created_by: string | null
          website: string | null
        }
        Insert: {
          id?: string
          name: string
          industry: string
          company_size?: string | null
          competitors?: string[] | null
          settings?: Json | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          website?: string | null
        }
        Update: {
          id?: string
          name?: string
          industry?: string
          company_size?: string | null
          competitors?: string[] | null
          settings?: Json | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          email: string
          id: string
          updated_at: string
          subscription_type: Database["public"]["Enums"]["subscription_type"]
          subscription_start_date: string | null
          prompts_used: number
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email: string
          id: string
          updated_at?: string
          subscription_type?: Database["public"]["Enums"]["subscription_type"]
          subscription_start_date?: string | null
          prompts_used?: number
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string
          id?: string
          updated_at?: string
          subscription_type?: Database["public"]["Enums"]["subscription_type"]
          subscription_start_date?: string | null
          prompts_used?: number
        }
        Relationships: []
      }
      prompt_responses: {
        Row: {
          ai_model: string
          citations: Json | null
          company_mentioned: boolean | null
          detected_competitors: string | null
          confirmed_prompt_id: string
          created_at: string
          id: string
          mention_ranking: number | null
          response_text: string
          sentiment_label: string | null
          sentiment_score: number | null
          tested_at: string
        }
        Insert: {
          ai_model: string
          citations?: Json | null
          company_mentioned?: boolean | null
          detected_competitors?: string | null
          confirmed_prompt_id: string
          created_at?: string
          id?: string
          mention_ranking?: number | null
          response_text: string
          sentiment_label?: string | null
          sentiment_score?: number | null
          tested_at?: string
        }
        Update: {
          ai_model?: string
          citations?: Json | null
          company_mentioned?: boolean | null
          detected_competitors?: string | null
          confirmed_prompt_id?: string
          created_at?: string
          id?: string
          mention_ranking?: number | null
          response_text?: string
          sentiment_label?: string | null
          sentiment_score?: number | null
          tested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_responses_confirmed_prompt_id_fkey"
            columns: ["confirmed_prompt_id"]
            isOneToOne: false
            referencedRelation: "confirmed_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_tests: {
        Row: {
          claude_response: string | null
          created_at: string
          id: string
          onboarding_id: string
          openai_response: string | null
          prompt_category: string
          prompt_text: string
          tested_at: string | null
        }
        Insert: {
          claude_response?: string | null
          created_at?: string
          id?: string
          onboarding_id: string
          openai_response?: string | null
          prompt_category: string
          prompt_text: string
          tested_at?: string | null
        }
        Update: {
          claude_response?: string | null
          created_at?: string
          id?: string
          onboarding_id?: string
          openai_response?: string | null
          prompt_category?: string
          prompt_text?: string
          tested_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_tests_onboarding_id_fkey"
            columns: ["onboarding_id"]
            isOneToOne: false
            referencedRelation: "user_onboarding"
            referencedColumns: ["id"]
          },
        ]
      }
      user_onboarding: {
        Row: {
          id: string
          user_id: string | null
          company_name: string
          industry: string
          job_function: string | null
          country: string | null
          session_id: string
          created_at: string
          competitors: string[]
          subscription_type: Database["public"]["Enums"]["subscription_type"]
          subscription_start_date: string | null
          prompts_used: number
          last_report_date: string | null
          next_call_date: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          company_name: string
          industry: string
          job_function?: string | null
          country?: string | null
          session_id: string
          created_at?: string
          competitors?: string[]
          subscription_type?: Database["public"]["Enums"]["subscription_type"]
          subscription_start_date?: string | null
          prompts_used?: number
          last_report_date?: string | null
          next_call_date?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          company_name?: string
          industry?: string
          job_function?: string | null
          country?: string | null
          session_id?: string
          created_at?: string
          competitors?: string[]
          subscription_type?: Database["public"]["Enums"]["subscription_type"]
          subscription_start_date?: string | null
          prompts_used?: number
          last_report_date?: string | null
          next_call_date?: string | null
        }
      }
      subscription_features: {
        Row: {
          id: string
          user_id: string
          feature_name: string
          feature_value: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          feature_name: string
          feature_value?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          feature_name?: string
          feature_value?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_features_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_company: {
        Args: {
          p_company_id: string
          p_organization_id: string
        }
        Returns: {
          company_id: string
          organization_id: string
          company_name: string
          deleted_counts: Json
        }[]
      }
    }
    Enums: {
      prompt_type: "sentiment" | "visibility" | "competitive"
      subscription_type: "free" | "pro"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      prompt_type: ["sentiment", "visibility", "competitive", "talentx_sentiment", "talentx_competitive", "talentx_visibility"],
    },
  },
} as const
