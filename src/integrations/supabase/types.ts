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
          created_at: string
          id: string
          is_active: boolean
          onboarding_id: string
          prompt_category: string
          prompt_text: string
          prompt_type: Database["public"]["Enums"]["prompt_type"] | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          onboarding_id: string
          prompt_category: string
          prompt_text: string
          prompt_type?: Database["public"]["Enums"]["prompt_type"] | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          onboarding_id?: string
          prompt_category?: string
          prompt_text?: string
          prompt_type?: Database["public"]["Enums"]["prompt_type"] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confirmed_prompts_onboarding_id_fkey"
            columns: ["onboarding_id"]
            isOneToOne: false
            referencedRelation: "user_onboarding"
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
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompt_responses: {
        Row: {
          ai_model: string
          citations: Json | null
          company_mentioned: boolean | null
          competitor_mentions: Json | null
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
          competitor_mentions?: Json | null
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
          competitor_mentions?: Json | null
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
          session_id: string
          created_at: string
          competitors: string[]
        }
        Insert: {
          id?: string
          user_id?: string | null
          company_name: string
          industry: string
          session_id: string
          created_at?: string
          competitors?: string[]
        }
        Update: {
          id?: string
          user_id?: string | null
          company_name?: string
          industry?: string
          session_id?: string
          created_at?: string
          competitors?: string[]
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      prompt_type: "sentiment" | "visibility" | "competitive"
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
      prompt_type: ["sentiment", "visibility", "competitive"],
    },
  },
} as const
