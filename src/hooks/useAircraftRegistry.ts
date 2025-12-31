import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FAARegistryRecord } from '@/lib/parsers/faaParser';
import { toast } from 'sonner';

export interface AircraftRegistryEntry {
  id: string;
  n_number: string;
  serial_number?: string;
  aircraft_manufacturer?: string;
  aircraft_model?: string;
  engine_manufacturer?: string;
  engine_model?: string;
  year_manufactured?: number;
  registrant_type?: string;
  registrant_name?: string;
  registrant_street?: string;
  registrant_city?: string;
  registrant_state?: string;
  registrant_zip?: string;
  registrant_country?: string;
  certificate_issue_date?: string;
  airworthiness_date?: string;
  expiration_date?: string;
  last_action_date?: string;
  status?: string;
  mode_s_code?: string;
  mode_s_hex?: string;
  fractional_owner?: boolean;
  raw_data?: any;
  scraped_at: string;
  created_at: string;
  updated_at: string;
}

export function useAircraftRegistry() {
  const [isSaving, setIsSaving] = useState(false);

  const saveRecord = async (record: FAARegistryRecord, rawData?: any): Promise<boolean> => {
    setIsSaving(true);
    try {
      const dbRecord = {
        n_number: record.nNumber,
        serial_number: record.serialNumber || null,
        aircraft_manufacturer: record.aircraftManufacturer || null,
        aircraft_model: record.aircraftModel || null,
        engine_manufacturer: record.engineManufacturer || null,
        engine_model: record.engineModel || null,
        year_manufactured: record.yearManufactured || null,
        registrant_type: record.registrantType || null,
        registrant_name: record.registrantName || null,
        registrant_street: record.registrantStreet || null,
        registrant_city: record.registrantCity || null,
        registrant_state: record.registrantState || null,
        registrant_zip: record.registrantZip || null,
        registrant_country: record.registrantCountry || null,
        certificate_issue_date: parseDate(record.certificateIssueDate),
        airworthiness_date: parseDate(record.airworthinessDate),
        expiration_date: parseDate(record.expirationDate),
        last_action_date: parseDate(record.lastActionDate),
        status: record.status || null,
        mode_s_code: record.modeSCode || null,
        mode_s_hex: record.modeSHex || null,
        fractional_owner: record.fractionalOwner || false,
        raw_data: rawData || null,
        scraped_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('aircraft_registry')
        .upsert(dbRecord, { 
          onConflict: 'n_number,serial_number',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('Error saving aircraft record:', error);
        toast.error(`Failed to save: ${error.message}`);
        return false;
      }

      toast.success(`Saved ${record.nNumber} to database`);
      return true;
    } catch (error) {
      console.error('Error saving aircraft record:', error);
      toast.error('Failed to save record');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveMultipleRecords = async (records: FAARegistryRecord[], rawData?: any): Promise<number> => {
    setIsSaving(true);
    let savedCount = 0;

    try {
      for (const record of records) {
        const success = await saveRecord(record, rawData);
        if (success) savedCount++;
      }

      if (savedCount > 0) {
        toast.success(`Saved ${savedCount} of ${records.length} records to database`);
      }
    } finally {
      setIsSaving(false);
    }

    return savedCount;
  };

  const getRecordByNNumber = async (nNumber: string): Promise<AircraftRegistryEntry | null> => {
    const cleanNNumber = nNumber.toUpperCase().startsWith('N') ? nNumber.toUpperCase() : `N${nNumber.toUpperCase()}`;
    
    const { data, error } = await supabase
      .from('aircraft_registry')
      .select('*')
      .eq('n_number', cleanNNumber)
      .order('scraped_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') { // Not found is okay
        console.error('Error fetching aircraft:', error);
      }
      return null;
    }

    return data as AircraftRegistryEntry;
  };

  const searchRegistry = async (query: string, limit = 50): Promise<AircraftRegistryEntry[]> => {
    const { data, error } = await supabase
      .from('aircraft_registry')
      .select('*')
      .or(`n_number.ilike.%${query}%,registrant_name.ilike.%${query}%,aircraft_manufacturer.ilike.%${query}%`)
      .order('scraped_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error searching registry:', error);
      return [];
    }

    return (data || []) as AircraftRegistryEntry[];
  };

  const getRecentRecords = async (limit = 20): Promise<AircraftRegistryEntry[]> => {
    const { data, error } = await supabase
      .from('aircraft_registry')
      .select('*')
      .order('scraped_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching recent records:', error);
      return [];
    }

    return (data || []) as AircraftRegistryEntry[];
  };

  return {
    isSaving,
    saveRecord,
    saveMultipleRecords,
    getRecordByNNumber,
    searchRegistry,
    getRecentRecords
  };
}

function parseDate(dateStr?: string): string | null {
  if (!dateStr) return null;
  
  // Try various date formats
  const formats = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/, // Month DD, YYYY
  ];
  
  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      } catch {
        continue;
      }
    }
  }
  
  return null;
}
