import { supabase } from '@/integrations/supabase/client';

type FirecrawlResponse<T = any> = {
  success: boolean;
  error?: string;
  data?: T;
};

type ScrapeOptions = {
  formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
  onlyMainContent?: boolean;
  waitFor?: number;
};

type SearchOptions = {
  limit?: number;
  lang?: string;
  country?: string;
  tbs?: string;
  scrapeOptions?: { formats?: ('markdown' | 'html')[] };
};

export const firecrawlApi = {
  // Scrape a single URL
  async scrape(url: string, options?: ScrapeOptions): Promise<FirecrawlResponse> {
    const { data, error } = await supabase.functions.invoke('firecrawl-scrape', {
      body: { url, options },
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return data;
  },

  // Search the web and optionally scrape results
  async search(query: string, options?: SearchOptions): Promise<FirecrawlResponse> {
    const { data, error } = await supabase.functions.invoke('firecrawl-search', {
      body: { query, options },
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return data;
  },

  // FAA Registry lookup
  async lookupFaaRegistry(nNumber: string): Promise<FirecrawlResponse> {
    const url = `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${nNumber}`;
    return this.scrape(url, { formats: ['markdown'], onlyMainContent: true });
  },

  // FlightAware lookup
  async lookupFlightAware(registration: string): Promise<FirecrawlResponse> {
    const url = `https://flightaware.com/live/flight/${registration}`;
    return this.scrape(url, { formats: ['markdown', 'links'], onlyMainContent: true, waitFor: 3000 });
  },

  // Search for operator information
  async searchOperator(operatorName: string): Promise<FirecrawlResponse> {
    return this.search(`"${operatorName}" aircraft operator aviation`, {
      limit: 5,
      scrapeOptions: { formats: ['markdown'] }
    });
  },

  // Search for shell company information
  async searchShellCompany(companyName: string): Promise<FirecrawlResponse> {
    return this.search(`"${companyName}" LLC aircraft registration Delaware Wyoming`, {
      limit: 10,
      scrapeOptions: { formats: ['markdown'] }
    });
  },

  // ADS-B Exchange historical lookup
  async lookupAdsbExchange(icaoHex: string): Promise<FirecrawlResponse> {
    const url = `https://globe.adsbexchange.com/?icao=${icaoHex}`;
    return this.scrape(url, { formats: ['markdown'], waitFor: 5000 });
  }
};
