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
      agent_case_files: {
        Row: {
          agent: string
          content: string
          created_at: string
          document_type: string
          id: string
          session_id: string | null
          sha256_hash: string | null
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          agent: string
          content: string
          created_at?: string
          document_type?: string
          id?: string
          session_id?: string | null
          sha256_hash?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          agent?: string
          content?: string
          created_at?: string
          document_type?: string
          id?: string
          session_id?: string | null
          sha256_hash?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_case_files_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          agent: string
          content: string
          created_at: string
          id: string
          message_type: string
          session_id: string
          target_agent: string | null
        }
        Insert: {
          agent: string
          content?: string
          created_at?: string
          id?: string
          message_type?: string
          session_id: string
          target_agent?: string | null
        }
        Update: {
          agent?: string
          content?: string
          created_at?: string
          id?: string
          message_type?: string
          session_id?: string
          target_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          active_agent: string
          created_at: string
          id: string
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_agent?: string
          created_at?: string
          id?: string
          summary?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_agent?: string
          created_at?: string
          id?: string
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      cases: {
        Row: {
          case_code: string
          case_id: string
          case_name: string
          created_at: string | null
          description: string | null
          legal_theory: string
          priority: number | null
          status: string | null
          statute_cited: string | null
          updated_at: string | null
        }
        Insert: {
          case_code: string
          case_id?: string
          case_name: string
          created_at?: string | null
          description?: string | null
          legal_theory: string
          priority?: number | null
          status?: string | null
          statute_cited?: string | null
          updated_at?: string | null
        }
        Update: {
          case_code?: string
          case_id?: string
          case_name?: string
          created_at?: string | null
          description?: string | null
          legal_theory?: string
          priority?: number | null
          status?: string | null
          statute_cited?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      corporate_transit_corridors: {
        Row: {
          acreage: number | null
          bbox_max_lat: number | null
          bbox_max_lng: number | null
          bbox_min_lat: number | null
          bbox_min_lng: number | null
          controlling_family: string | null
          corporate_owner: string
          corridor_name: string
          created_at: string
          detection_count: number | null
          function_role: string | null
          id: string
          legal_significance: string | null
          notes: string | null
          parent_entity: string | null
          political_nexus: Json | null
          sha256_hash: string | null
          source_citations: Json | null
          top_operators: Json | null
          unique_aircraft: number | null
          updated_at: string
        }
        Insert: {
          acreage?: number | null
          bbox_max_lat?: number | null
          bbox_max_lng?: number | null
          bbox_min_lat?: number | null
          bbox_min_lng?: number | null
          controlling_family?: string | null
          corporate_owner: string
          corridor_name: string
          created_at?: string
          detection_count?: number | null
          function_role?: string | null
          id?: string
          legal_significance?: string | null
          notes?: string | null
          parent_entity?: string | null
          political_nexus?: Json | null
          sha256_hash?: string | null
          source_citations?: Json | null
          top_operators?: Json | null
          unique_aircraft?: number | null
          updated_at?: string
        }
        Update: {
          acreage?: number | null
          bbox_max_lat?: number | null
          bbox_max_lng?: number | null
          bbox_min_lat?: number | null
          bbox_min_lng?: number | null
          controlling_family?: string | null
          corporate_owner?: string
          corridor_name?: string
          created_at?: string
          detection_count?: number | null
          function_role?: string | null
          id?: string
          legal_significance?: string | null
          notes?: string | null
          parent_entity?: string | null
          political_nexus?: Json | null
          sha256_hash?: string | null
          source_citations?: Json | null
          top_operators?: Json | null
          unique_aircraft?: number | null
          updated_at?: string
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
      discovered_evidence_sources: {
        Row: {
          added_to_investigation: boolean
          column_summary: Json
          created_at: string
          forensic_score: number
          id: string
          join_keys: string[]
          last_crawled: string
          row_estimate: number
          schema_name: string
          table_name: string
        }
        Insert: {
          added_to_investigation?: boolean
          column_summary?: Json
          created_at?: string
          forensic_score?: number
          id?: string
          join_keys?: string[]
          last_crawled?: string
          row_estimate?: number
          schema_name: string
          table_name: string
        }
        Update: {
          added_to_investigation?: boolean
          column_summary?: Json
          created_at?: string
          forensic_score?: number
          id?: string
          join_keys?: string[]
          last_crawled?: string
          row_estimate?: number
          schema_name?: string
          table_name?: string
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
      evidence_merkle_ledger: {
        Row: {
          anchored_at: string
          batch_id: string | null
          chain_hash: string
          id: string
          previous_chain_hash: string
          record_hash: string
          sequence_number: number
          source_id: string
          source_table: string
        }
        Insert: {
          anchored_at?: string
          batch_id?: string | null
          chain_hash: string
          id?: string
          previous_chain_hash: string
          record_hash: string
          sequence_number?: number
          source_id: string
          source_table: string
        }
        Update: {
          anchored_at?: string
          batch_id?: string | null
          chain_hash?: string
          id?: string
          previous_chain_hash?: string
          record_hash?: string
          sequence_number?: number
          source_id?: string
          source_table?: string
        }
        Relationships: []
      }
      exhibit_audit_trail: {
        Row: {
          action: string
          audit_id: string
          case_id: string | null
          exhibit_id: string | null
          metadata: Json | null
          performed_at: string | null
          performed_by: string | null
          records_evaluated: number | null
          records_promoted: number | null
          result_hash: string | null
          rule_applied: string | null
          source_hash: string | null
        }
        Insert: {
          action: string
          audit_id?: string
          case_id?: string | null
          exhibit_id?: string | null
          metadata?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          records_evaluated?: number | null
          records_promoted?: number | null
          result_hash?: string | null
          rule_applied?: string | null
          source_hash?: string | null
        }
        Update: {
          action?: string
          audit_id?: string
          case_id?: string | null
          exhibit_id?: string | null
          metadata?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          records_evaluated?: number | null
          records_promoted?: number | null
          result_hash?: string | null
          rule_applied?: string | null
          source_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exhibit_audit_trail_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "exhibit_audit_trail_exhibit_id_fkey"
            columns: ["exhibit_id"]
            isOneToOne: false
            referencedRelation: "exhibits"
            referencedColumns: ["exhibit_id"]
          },
        ]
      }
      exhibits: {
        Row: {
          case_id: string
          chain_of_custody: Json | null
          created_at: string | null
          description: string | null
          evidence_type: string | null
          exhibit_code: string
          exhibit_id: string
          exhibit_name: string
          file_count: number | null
          legal_significance: string | null
          promotion_rule: string | null
          sha256_hash: string | null
          status: string | null
          tier: number
          updated_at: string | null
        }
        Insert: {
          case_id: string
          chain_of_custody?: Json | null
          created_at?: string | null
          description?: string | null
          evidence_type?: string | null
          exhibit_code: string
          exhibit_id?: string
          exhibit_name: string
          file_count?: number | null
          legal_significance?: string | null
          promotion_rule?: string | null
          sha256_hash?: string | null
          status?: string | null
          tier: number
          updated_at?: string | null
        }
        Update: {
          case_id?: string
          chain_of_custody?: Json | null
          created_at?: string | null
          description?: string | null
          evidence_type?: string | null
          exhibit_code?: string
          exhibit_id?: string
          exhibit_name?: string
          file_count?: number | null
          legal_significance?: string | null
          promotion_rule?: string | null
          sha256_hash?: string | null
          status?: string | null
          tier?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exhibits_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["case_id"]
          },
        ]
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
      manual_flight_logs: {
        Row: {
          aircraft_type: string | null
          altitude_ft: number | null
          behavior: string | null
          callsign: string | null
          created_at: string
          decibel_avg: number | null
          decibel_peak: number | null
          ground_speed_kts: number | null
          hr_bpm: number | null
          hrv_ms: number | null
          icao24: string | null
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          observed_at: string
          provenance: string
          registration: string | null
          route: string | null
          sha256_hash: string | null
          source_pdf: string | null
          stress_pct: number | null
          track_deg: number | null
        }
        Insert: {
          aircraft_type?: string | null
          altitude_ft?: number | null
          behavior?: string | null
          callsign?: string | null
          created_at?: string
          decibel_avg?: number | null
          decibel_peak?: number | null
          ground_speed_kts?: number | null
          hr_bpm?: number | null
          hrv_ms?: number | null
          icao24?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          observed_at: string
          provenance?: string
          registration?: string | null
          route?: string | null
          sha256_hash?: string | null
          source_pdf?: string | null
          stress_pct?: number | null
          track_deg?: number | null
        }
        Update: {
          aircraft_type?: string | null
          altitude_ft?: number | null
          behavior?: string | null
          callsign?: string | null
          created_at?: string
          decibel_avg?: number | null
          decibel_peak?: number | null
          ground_speed_kts?: number | null
          hr_bpm?: number | null
          hrv_ms?: number | null
          icao24?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          observed_at?: string
          provenance?: string
          registration?: string | null
          route?: string | null
          sha256_hash?: string | null
          source_pdf?: string | null
          stress_pct?: number | null
          track_deg?: number | null
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
      operator_profile_conflicts: {
        Row: {
          detected_at: string
          field: string
          id: string
          registration: string
          resolved: boolean
          resolved_by: string | null
          resolved_value: string | null
          source_a: string | null
          source_b: string | null
          value_a: string | null
          value_b: string | null
        }
        Insert: {
          detected_at?: string
          field: string
          id?: string
          registration: string
          resolved?: boolean
          resolved_by?: string | null
          resolved_value?: string | null
          source_a?: string | null
          source_b?: string | null
          value_a?: string | null
          value_b?: string | null
        }
        Update: {
          detected_at?: string
          field?: string
          id?: string
          registration?: string
          resolved?: boolean
          resolved_by?: string | null
          resolved_value?: string | null
          source_a?: string | null
          source_b?: string | null
          value_a?: string | null
          value_b?: string | null
        }
        Relationships: []
      }
      policy_violations: {
        Row: {
          altitude_ft: number | null
          callsign: string | null
          citation: string | null
          created_at: string
          detected_at: string
          evidence: Json
          far_text: string | null
          icao: string
          id: string
          lat: number | null
          lon: number | null
          manual_section: string | null
          promoted_exhibit_id: string | null
          rule_code: string
          rule_source: string | null
          rule_title: string
          severity: string
          sha256: string | null
          source_table: string | null
        }
        Insert: {
          altitude_ft?: number | null
          callsign?: string | null
          citation?: string | null
          created_at?: string
          detected_at: string
          evidence?: Json
          far_text?: string | null
          icao: string
          id?: string
          lat?: number | null
          lon?: number | null
          manual_section?: string | null
          promoted_exhibit_id?: string | null
          rule_code: string
          rule_source?: string | null
          rule_title: string
          severity: string
          sha256?: string | null
          source_table?: string | null
        }
        Update: {
          altitude_ft?: number | null
          callsign?: string | null
          citation?: string | null
          created_at?: string
          detected_at?: string
          evidence?: Json
          far_text?: string | null
          icao?: string
          id?: string
          lat?: number | null
          lon?: number | null
          manual_section?: string | null
          promoted_exhibit_id?: string | null
          rule_code?: string
          rule_source?: string | null
          rule_title?: string
          severity?: string
          sha256?: string | null
          source_table?: string | null
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
      promotion_rules: {
        Row: {
          case_id: string | null
          created_at: string | null
          description: string | null
          is_active: boolean | null
          priority: number | null
          rule_category: string
          rule_id: string
          rule_name: string
          sql_condition: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          priority?: number | null
          rule_category: string
          rule_id?: string
          rule_name: string
          sql_condition: string
        }
        Update: {
          case_id?: string | null
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          priority?: number | null
          rule_category?: string
          rule_id?: string
          rule_name?: string
          sql_condition?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_rules_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["case_id"]
          },
        ]
      }
      rag_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          token_estimate: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          token_estimate?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          token_estimate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "rag_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      rag_documents: {
        Row: {
          chunk_count: number | null
          created_at: string
          document_type: string | null
          extraction_summary: Json | null
          file_size: number | null
          filename: string
          id: string
          mime_type: string | null
          raw_text_preview: string | null
          sha256_hash: string | null
          status: string
          status_message: string | null
          storage_path: string
          tags: string[] | null
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          chunk_count?: number | null
          created_at?: string
          document_type?: string | null
          extraction_summary?: Json | null
          file_size?: number | null
          filename: string
          id?: string
          mime_type?: string | null
          raw_text_preview?: string | null
          sha256_hash?: string | null
          status?: string
          status_message?: string | null
          storage_path: string
          tags?: string[] | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          chunk_count?: number | null
          created_at?: string
          document_type?: string | null
          extraction_summary?: Json | null
          file_size?: number | null
          filename?: string
          id?: string
          mime_type?: string | null
          raw_text_preview?: string | null
          sha256_hash?: string | null
          status?: string
          status_message?: string | null
          storage_path?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      rag_extractions: {
        Row: {
          confidence: number
          context: string | null
          created_at: string
          document_id: string
          extraction_type: string
          id: string
          label: string
          promoted_at: string | null
          promoted_to: string | null
          status: string
          value: string | null
        }
        Insert: {
          confidence?: number
          context?: string | null
          created_at?: string
          document_id: string
          extraction_type: string
          id?: string
          label: string
          promoted_at?: string | null
          promoted_to?: string | null
          status?: string
          value?: string | null
        }
        Update: {
          confidence?: number
          context?: string | null
          created_at?: string
          document_id?: string
          extraction_type?: string
          id?: string
          label?: string
          promoted_at?: string | null
          promoted_to?: string | null
          status?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "rag_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      reasoning_outputs: {
        Row: {
          bayes_factor: number | null
          bradford_score: number | null
          content_hash: string
          created_at: string
          detection_ref: string
          id: string
          module: string
          payload: Json
        }
        Insert: {
          bayes_factor?: number | null
          bradford_score?: number | null
          content_hash: string
          created_at?: string
          detection_ref: string
          id?: string
          module: string
          payload: Json
        }
        Update: {
          bayes_factor?: number | null
          bradford_score?: number | null
          content_hash?: string
          created_at?: string
          detection_ref?: string
          id?: string
          module?: string
          payload?: Json
        }
        Relationships: []
      }
      schema_wiring_report: {
        Row: {
          column_ref: string | null
          created_at: string
          id: string
          scanned_at: string
          severity: string
          source_path: string
          source_type: string
          status: string
          suggested_fix: string | null
          table_name: string
        }
        Insert: {
          column_ref?: string | null
          created_at?: string
          id?: string
          scanned_at?: string
          severity?: string
          source_path: string
          source_type: string
          status: string
          suggested_fix?: string | null
          table_name: string
        }
        Update: {
          column_ref?: string | null
          created_at?: string
          id?: string
          scanned_at?: string
          severity?: string
          source_path?: string
          source_type?: string
          status?: string
          suggested_fix?: string | null
          table_name?: string
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
          score_breakdown: Json | null
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
          score_breakdown?: Json | null
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
          score_breakdown?: Json | null
          threat_type?: string
          total_violations?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      unmasked_hq_locations: {
        Row: {
          ai_assessment: string | null
          aircraft_list: Json
          cluster_center_lat: number
          cluster_center_lng: number
          created_at: string
          cross_references: Json
          first_visit: string | null
          hq_confidence_score: number
          id: string
          last_visit: string | null
          location_type: string
          night_operations: number
          scan_id: string | null
          unique_aircraft: number
          updated_at: string
          visit_count: number
        }
        Insert: {
          ai_assessment?: string | null
          aircraft_list?: Json
          cluster_center_lat: number
          cluster_center_lng: number
          created_at?: string
          cross_references?: Json
          first_visit?: string | null
          hq_confidence_score?: number
          id?: string
          last_visit?: string | null
          location_type?: string
          night_operations?: number
          scan_id?: string | null
          unique_aircraft?: number
          updated_at?: string
          visit_count?: number
        }
        Update: {
          ai_assessment?: string | null
          aircraft_list?: Json
          cluster_center_lat?: number
          cluster_center_lng?: number
          created_at?: string
          cross_references?: Json
          first_visit?: string | null
          hq_confidence_score?: number
          id?: string
          last_visit?: string | null
          location_type?: string
          night_operations?: number
          scan_id?: string | null
          unique_aircraft?: number
          updated_at?: string
          visit_count?: number
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
          first_seen: string | null
          flag_type: string
          id: string
          last_seen: string | null
          learning_context: Json | null
          occurrence_count: number
          registration: string | null
          resolved_reason: string | null
          severity: string
          signature: string | null
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
          first_seen?: string | null
          flag_type: string
          id?: string
          last_seen?: string | null
          learning_context?: Json | null
          occurrence_count?: number
          registration?: string | null
          resolved_reason?: string | null
          severity?: string
          signature?: string | null
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
          first_seen?: string | null
          flag_type?: string
          id?: string
          last_seen?: string | null
          learning_context?: Json | null
          occurrence_count?: number
          registration?: string | null
          resolved_reason?: string | null
          severity?: string
          signature?: string | null
          source_scan_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      watchtower_daily_reports: {
        Row: {
          active_aircraft: Json
          active_aircraft_count: number
          ai_synthesis: string | null
          confirmed_threats: number
          created_at: string
          id: string
          monitored_count: number
          pattern_summary: Json
          report_date: string
          report_html: string | null
          report_id_code: string
          sha256_hash: string | null
          suspicious_count: number
          threat_database: Json
          threat_level: string
          updated_at: string
          violations: Json
        }
        Insert: {
          active_aircraft?: Json
          active_aircraft_count?: number
          ai_synthesis?: string | null
          confirmed_threats?: number
          created_at?: string
          id?: string
          monitored_count?: number
          pattern_summary?: Json
          report_date: string
          report_html?: string | null
          report_id_code: string
          sha256_hash?: string | null
          suspicious_count?: number
          threat_database?: Json
          threat_level?: string
          updated_at?: string
          violations?: Json
        }
        Update: {
          active_aircraft?: Json
          active_aircraft_count?: number
          ai_synthesis?: string | null
          confirmed_threats?: number
          created_at?: string
          id?: string
          monitored_count?: number
          pattern_summary?: Json
          report_date?: string
          report_html?: string | null
          report_id_code?: string
          sha256_hash?: string | null
          suspicious_count?: number
          threat_database?: Json
          threat_level?: string
          updated_at?: string
          violations?: Json
        }
        Relationships: []
      }
    }
    Views: {
      v_pipeline_freshness: {
        Row: {
          latest: string | null
          row_count: number | null
          stage: string | null
        }
        Relationships: []
      }
      v_watchtower_flag_groups: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          cross_references: Json | null
          description: string | null
          effective_severity: string | null
          evidence_summary: Json | null
          first_seen: string | null
          flag_type: string | null
          id: string | null
          last_seen: string | null
          occurrence_count: number | null
          raw_severity: string | null
          registration: string | null
          signature: string | null
          source_scan_id: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          cross_references?: Json | null
          description?: string | null
          effective_severity?: never
          evidence_summary?: Json | null
          first_seen?: never
          flag_type?: string | null
          id?: string | null
          last_seen?: never
          occurrence_count?: number | null
          raw_severity?: string | null
          registration?: string | null
          signature?: string | null
          source_scan_id?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          cross_references?: Json | null
          description?: string | null
          effective_severity?: never
          evidence_summary?: Json | null
          first_seen?: never
          flag_type?: string | null
          id?: string | null
          last_seen?: never
          occurrence_count?: number | null
          raw_severity?: string | null
          registration?: string | null
          signature?: string | null
          source_scan_id?: string | null
        }
        Relationships: []
      }
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
      match_rag_chunks: {
        Args: {
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          content: string
          document_id: string
          document_title: string
          document_type: string
          similarity: number
          tags: string[]
        }[]
      }
      wt_effective_severity: {
        Args: { _flag_type: string; _severity: string }
        Returns: string
      }
      wt_flag_signature: {
        Args: {
          _description: string
          _flag_type: string
          _registration: string
        }
        Returns: string
      }
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
