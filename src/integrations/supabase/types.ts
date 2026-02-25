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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      aircraft_registry: {
        Row: {
          aircraft_manufacturer: string | null
          aircraft_model: string | null
          airworthiness_date: string | null
          certificate_issue_date: string | null
          created_at: string
          engine_manufacturer: string | null
          engine_model: string | null
          expiration_date: string | null
          fractional_owner: boolean | null
          id: string
          last_action_date: string | null
          mode_s_code: string | null
          mode_s_hex: string | null
          n_number: string
          raw_data: Json | null
          registrant_city: string | null
          registrant_country: string | null
          registrant_name: string | null
          registrant_state: string | null
          registrant_street: string | null
          registrant_type: string | null
          registrant_zip: string | null
          scraped_at: string
          serial_number: string | null
          status: string | null
          updated_at: string
          year_manufactured: number | null
        }
        Insert: {
          aircraft_manufacturer?: string | null
          aircraft_model?: string | null
          airworthiness_date?: string | null
          certificate_issue_date?: string | null
          created_at?: string
          engine_manufacturer?: string | null
          engine_model?: string | null
          expiration_date?: string | null
          fractional_owner?: boolean | null
          id?: string
          last_action_date?: string | null
          mode_s_code?: string | null
          mode_s_hex?: string | null
          n_number: string
          raw_data?: Json | null
          registrant_city?: string | null
          registrant_country?: string | null
          registrant_name?: string | null
          registrant_state?: string | null
          registrant_street?: string | null
          registrant_type?: string | null
          registrant_zip?: string | null
          scraped_at?: string
          serial_number?: string | null
          status?: string | null
          updated_at?: string
          year_manufactured?: number | null
        }
        Update: {
          aircraft_manufacturer?: string | null
          aircraft_model?: string | null
          airworthiness_date?: string | null
          certificate_issue_date?: string | null
          created_at?: string
          engine_manufacturer?: string | null
          engine_model?: string | null
          expiration_date?: string | null
          fractional_owner?: boolean | null
          id?: string
          last_action_date?: string | null
          mode_s_code?: string | null
          mode_s_hex?: string | null
          n_number?: string
          raw_data?: Json | null
          registrant_city?: string | null
          registrant_country?: string | null
          registrant_name?: string | null
          registrant_state?: string | null
          registrant_street?: string | null
          registrant_type?: string | null
          registrant_zip?: string | null
          scraped_at?: string
          serial_number?: string | null
          status?: string | null
          updated_at?: string
          year_manufactured?: number | null
        }
        Relationships: []
      }
      correlation_job_status: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          job_id: string
          job_type: string
          last_cursor: string | null
          linked_records: number | null
          processed_records: number | null
          started_at: string | null
          status: string | null
          target_table: string | null
          total_records: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          job_id?: string
          job_type: string
          last_cursor?: string | null
          linked_records?: number | null
          processed_records?: number | null
          started_at?: string | null
          status?: string | null
          target_table?: string | null
          total_records?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          job_id?: string
          job_type?: string
          last_cursor?: string | null
          linked_records?: number | null
          processed_records?: number | null
          started_at?: string | null
          status?: string | null
          target_table?: string | null
          total_records?: number | null
        }
        Relationships: []
      }
      entity_registry: {
        Row: {
          aliases: string[] | null
          canonical_identifier: string
          created_at: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          first_seen: string | null
          last_seen: string | null
          linked_forensic_events: string[] | null
          metadata: Json | null
          source_tables: Json | null
          threat_classification: string | null
          updated_at: string | null
        }
        Insert: {
          aliases?: string[] | null
          canonical_identifier: string
          created_at?: string | null
          entity_id?: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          first_seen?: string | null
          last_seen?: string | null
          linked_forensic_events?: string[] | null
          metadata?: Json | null
          source_tables?: Json | null
          threat_classification?: string | null
          updated_at?: string | null
        }
        Update: {
          aliases?: string[] | null
          canonical_identifier?: string
          created_at?: string | null
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["entity_type"]
          first_seen?: string | null
          last_seen?: string | null
          linked_forensic_events?: string[] | null
          metadata?: Json | null
          source_tables?: Json | null
          threat_classification?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      evidence_chain_links: {
        Row: {
          forensic_event_id: string | null
          link_confidence: number | null
          link_hash: string | null
          link_id: string
          link_type: Database["public"]["Enums"]["link_type"]
          linked_at: string | null
          linked_by: string | null
          source_id: string
          source_table: string
        }
        Insert: {
          forensic_event_id?: string | null
          link_confidence?: number | null
          link_hash?: string | null
          link_id?: string
          link_type: Database["public"]["Enums"]["link_type"]
          linked_at?: string | null
          linked_by?: string | null
          source_id: string
          source_table: string
        }
        Update: {
          forensic_event_id?: string | null
          link_confidence?: number | null
          link_hash?: string | null
          link_id?: string
          link_type?: Database["public"]["Enums"]["link_type"]
          linked_at?: string | null
          linked_by?: string | null
          source_id?: string
          source_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_chain_links_forensic_event_id_fkey"
            columns: ["forensic_event_id"]
            isOneToOne: false
            referencedRelation: "master_forensic_events"
            referencedColumns: ["forensic_event_id"]
          },
        ]
      }
      evidence_documents: {
        Row: {
          content: string
          document_type: string | null
          file_size: number | null
          filename: string
          id: string
          sha256_hash: string | null
          tags: string[] | null
          title: string
          updated_at: string
          uploaded_at: string
        }
        Insert: {
          content: string
          document_type?: string | null
          file_size?: number | null
          filename: string
          id?: string
          sha256_hash?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          uploaded_at?: string
        }
        Update: {
          content?: string
          document_type?: string | null
          file_size?: number | null
          filename?: string
          id?: string
          sha256_hash?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      kcso_fleet: {
        Row: {
          created_at: string
          frequent_oildale_operation: boolean | null
          id: string
          model: string
          model_citation: string | null
          oildale_citation: string | null
          surveillance_capabilities: string | null
          surveillance_citation: string | null
          tail_number: string
          tail_number_citation: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          frequent_oildale_operation?: boolean | null
          id?: string
          model: string
          model_citation?: string | null
          oildale_citation?: string | null
          surveillance_capabilities?: string | null
          surveillance_citation?: string | null
          tail_number: string
          tail_number_citation?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          frequent_oildale_operation?: boolean | null
          id?: string
          model?: string
          model_citation?: string | null
          oildale_citation?: string | null
          surveillance_capabilities?: string | null
          surveillance_citation?: string | null
          tail_number?: string
          tail_number_citation?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      master_forensic_events: {
        Row: {
          bradford_hill_score: number | null
          chain_of_custody_hash: string | null
          confidence_score: number | null
          created_at: string | null
          event_timestamp: string
          event_type: Database["public"]["Enums"]["forensic_event_type"]
          factor_count: number | null
          forensic_event_id: string
          geo_lat: number | null
          geo_lng: number | null
          is_physical_verified: boolean | null
          linked_records: Json | null
          primary_entity_id: string | null
          primary_entity_type: Database["public"]["Enums"]["entity_type"] | null
          summary: string | null
          temporal_cluster_id: string | null
          updated_at: string | null
        }
        Insert: {
          bradford_hill_score?: number | null
          chain_of_custody_hash?: string | null
          confidence_score?: number | null
          created_at?: string | null
          event_timestamp: string
          event_type: Database["public"]["Enums"]["forensic_event_type"]
          factor_count?: number | null
          forensic_event_id?: string
          geo_lat?: number | null
          geo_lng?: number | null
          is_physical_verified?: boolean | null
          linked_records?: Json | null
          primary_entity_id?: string | null
          primary_entity_type?:
            | Database["public"]["Enums"]["entity_type"]
            | null
          summary?: string | null
          temporal_cluster_id?: string | null
          updated_at?: string | null
        }
        Update: {
          bradford_hill_score?: number | null
          chain_of_custody_hash?: string | null
          confidence_score?: number | null
          created_at?: string | null
          event_timestamp?: string
          event_type?: Database["public"]["Enums"]["forensic_event_type"]
          factor_count?: number | null
          forensic_event_id?: string
          geo_lat?: number | null
          geo_lng?: number | null
          is_physical_verified?: boolean | null
          linked_records?: Json | null
          primary_entity_id?: string | null
          primary_entity_type?:
            | Database["public"]["Enums"]["entity_type"]
            | null
          summary?: string | null
          temporal_cluster_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          department: string | null
          display_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          display_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          display_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sentinel_learned_threats: {
        Row: {
          ai_threat_profile: string | null
          avg_altitude: number | null
          countermeasure_actions: Json | null
          countermeasure_status: string | null
          escalation_level: number | null
          first_seen: string | null
          id: string
          last_seen: string | null
          registration: string
          threat_type: string
          total_violations: number | null
          updated_at: string | null
        }
        Insert: {
          ai_threat_profile?: string | null
          avg_altitude?: number | null
          countermeasure_actions?: Json | null
          countermeasure_status?: string | null
          escalation_level?: number | null
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          registration: string
          threat_type: string
          total_violations?: number | null
          updated_at?: string | null
        }
        Update: {
          ai_threat_profile?: string | null
          avg_altitude?: number | null
          countermeasure_actions?: Json | null
          countermeasure_status?: string | null
          escalation_level?: number | null
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          registration?: string
          threat_type?: string
          total_violations?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      watchtower_autonomous_flags: {
        Row: {
          auto_resolved: boolean | null
          confidence_score: number | null
          created_at: string
          cross_references: Json | null
          description: string
          evidence_summary: Json | null
          flag_type: string
          id: string
          learning_context: Json | null
          registration: string | null
          resolved_reason: string | null
          severity: string
          source_scan_id: string | null
          updated_at: string
        }
        Insert: {
          auto_resolved?: boolean | null
          confidence_score?: number | null
          created_at?: string
          cross_references?: Json | null
          description: string
          evidence_summary?: Json | null
          flag_type: string
          id?: string
          learning_context?: Json | null
          registration?: string | null
          resolved_reason?: string | null
          severity?: string
          source_scan_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_resolved?: boolean | null
          confidence_score?: number | null
          created_at?: string
          cross_references?: Json | null
          description?: string
          evidence_summary?: Json | null
          flag_type?: string
          id?: string
          learning_context?: Json | null
          registration?: string | null
          resolved_reason?: string | null
          severity?: string
          source_scan_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_investigator_or_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "investigator"
      entity_type:
        | "aircraft"
        | "operator"
        | "agency"
        | "shell_company"
        | "contractor"
        | "individual"
      forensic_event_type:
        | "flight"
        | "biometric"
        | "witness"
        | "ocr"
        | "legal"
        | "alert"
        | "multi_factor"
      link_type:
        | "temporal"
        | "causal"
        | "witness"
        | "documentary"
        | "biometric"
        | "spatial"
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
      app_role: ["admin", "investigator"],
      entity_type: [
        "aircraft",
        "operator",
        "agency",
        "shell_company",
        "contractor",
        "individual",
      ],
      forensic_event_type: [
        "flight",
        "biometric",
        "witness",
        "ocr",
        "legal",
        "alert",
        "multi_factor",
      ],
      link_type: [
        "temporal",
        "causal",
        "witness",
        "documentary",
        "biometric",
        "spatial",
      ],
    },
  },
} as const
