// FAA Registry Data Parser
// Extracts structured data from FAA N-Number lookup responses

export interface FAARegistryRecord {
  nNumber: string;
  serialNumber?: string;
  aircraftManufacturer?: string;
  aircraftModel?: string;
  engineManufacturer?: string;
  engineModel?: string;
  yearManufactured?: number;
  registrantType?: string;
  registrantName?: string;
  registrantStreet?: string;
  registrantCity?: string;
  registrantState?: string;
  registrantZip?: string;
  registrantCountry?: string;
  certificateIssueDate?: string;
  airworthinessDate?: string;
  expirationDate?: string;
  lastActionDate?: string;
  status?: string;
  modeSCode?: string;
  modeSHex?: string;
  fractionalOwner?: boolean;
  aircraftType?: string;
  engineType?: string;
  categoryCode?: string;
}

export function parseFAAMarkdown(markdown: string, nNumber: string): FAARegistryRecord[] {
  const records: FAARegistryRecord[] = [];
  
  // Check for multiple records indicator
  const hasMultiple = markdown.toLowerCase().includes('multiple records') || 
                     markdown.toLowerCase().includes('assigned/multiple');
  
  // Split by common record separators
  const sections = markdown.split(/---+|\*\*\*+|={3,}/).filter(s => s.trim());
  
  // If no clear sections, treat as single record
  const recordSections = sections.length > 1 ? sections : [markdown];
  
  for (const section of recordSections) {
    const record = extractRecordFromSection(section, nNumber);
    if (record && (record.serialNumber || record.registrantName || record.aircraftManufacturer)) {
      records.push(record);
    }
  }
  
  // If we didn't find structured records, try parsing as a single record
  if (records.length === 0) {
    const singleRecord = extractRecordFromSection(markdown, nNumber);
    if (singleRecord) {
      records.push(singleRecord);
    }
  }
  
  return records;
}

function extractRecordFromSection(section: string, nNumber: string): FAARegistryRecord {
  const record: FAARegistryRecord = {
    nNumber: nNumber.toUpperCase().replace(/^N/, 'N')
  };
  
  const lines = section.split('\n');
  
  for (const line of lines) {
    const cleanLine = line.trim();
    
    // Serial Number patterns
    if (/serial\s*(number|#|no\.?)?[\s:]+/i.test(cleanLine)) {
      record.serialNumber = extractValue(cleanLine, /serial\s*(number|#|no\.?)?[\s:]+(.+)/i, 2);
    }
    
    // Aircraft Manufacturer
    if (/manufacturer[\s:]+/i.test(cleanLine) && !record.aircraftManufacturer) {
      record.aircraftManufacturer = extractValue(cleanLine, /manufacturer[\s:]+(.+)/i);
    }
    if (/mfr[\s:]+/i.test(cleanLine) && !record.aircraftManufacturer) {
      record.aircraftManufacturer = extractValue(cleanLine, /mfr[\s:]+(.+)/i);
    }
    
    // Aircraft Model
    if (/model[\s:]+/i.test(cleanLine) && !record.aircraftModel) {
      record.aircraftModel = extractValue(cleanLine, /model[\s:]+(.+)/i);
    }
    
    // Year Manufactured
    if (/year\s*(mfr|manufactured)?[\s:]+/i.test(cleanLine)) {
      const yearStr = extractValue(cleanLine, /year\s*(mfr|manufactured)?[\s:]+(\d{4})/i, 2);
      if (yearStr) {
        record.yearManufactured = parseInt(yearStr, 10);
      }
    }
    
    // Engine info
    if (/engine\s*mfr[\s:]+/i.test(cleanLine)) {
      record.engineManufacturer = extractValue(cleanLine, /engine\s*mfr[\s:]+(.+)/i);
    }
    if (/engine\s*model[\s:]+/i.test(cleanLine)) {
      record.engineModel = extractValue(cleanLine, /engine\s*model[\s:]+(.+)/i);
    }
    
    // Registrant info
    if (/registrant[\s:]+/i.test(cleanLine) || /owner[\s:]+/i.test(cleanLine)) {
      const name = extractValue(cleanLine, /(registrant|owner)[\s:]+(.+)/i, 2);
      if (name && !record.registrantName) {
        record.registrantName = name;
      }
    }
    if (/name[\s:]+/i.test(cleanLine) && !record.registrantName) {
      record.registrantName = extractValue(cleanLine, /name[\s:]+(.+)/i);
    }
    
    // Address components
    if (/street[\s:]+/i.test(cleanLine)) {
      record.registrantStreet = extractValue(cleanLine, /street[\s:]+(.+)/i);
    }
    if (/city[\s:]+/i.test(cleanLine)) {
      record.registrantCity = extractValue(cleanLine, /city[\s:]+(.+)/i);
    }
    if (/state[\s:]+/i.test(cleanLine)) {
      record.registrantState = extractValue(cleanLine, /state[\s:]+(.+)/i);
    }
    if (/zip[\s:]*code?[\s:]+/i.test(cleanLine)) {
      record.registrantZip = extractValue(cleanLine, /zip[\s:]*code?[\s:]+(.+)/i);
    }
    
    // Dates
    if (/certificate\s*(issue\s*)?date[\s:]+/i.test(cleanLine)) {
      record.certificateIssueDate = extractValue(cleanLine, /certificate\s*(issue\s*)?date[\s:]+(.+)/i, 2);
    }
    if (/airworthiness\s*date[\s:]+/i.test(cleanLine)) {
      record.airworthinessDate = extractValue(cleanLine, /airworthiness\s*date[\s:]+(.+)/i);
    }
    if (/expiration\s*date[\s:]+/i.test(cleanLine)) {
      record.expirationDate = extractValue(cleanLine, /expiration\s*date[\s:]+(.+)/i);
    }
    if (/last\s*action\s*date[\s:]+/i.test(cleanLine)) {
      record.lastActionDate = extractValue(cleanLine, /last\s*action\s*date[\s:]+(.+)/i);
    }
    
    // Status
    if (/status[\s:]+/i.test(cleanLine)) {
      record.status = extractValue(cleanLine, /status[\s:]+(.+)/i);
    }
    
    // Mode S
    if (/mode\s*s\s*(code)?[\s:]+/i.test(cleanLine)) {
      const modeS = extractValue(cleanLine, /mode\s*s\s*(code)?[\s:]+(.+)/i, 2);
      if (modeS) {
        record.modeSCode = modeS;
        // Convert to hex if numeric
        if (/^\d+$/.test(modeS)) {
          record.modeSHex = parseInt(modeS, 8).toString(16).toUpperCase();
        }
      }
    }
    
    // Type
    if (/type[\s:]+/i.test(cleanLine) && !record.aircraftType) {
      record.aircraftType = extractValue(cleanLine, /type[\s:]+(.+)/i);
    }
    
    // Registrant type
    if (/type\s*registrant[\s:]+/i.test(cleanLine) || /registrant\s*type[\s:]+/i.test(cleanLine)) {
      record.registrantType = extractValue(cleanLine, /(type\s*registrant|registrant\s*type)[\s:]+(.+)/i, 2);
    }
  }
  
  // Try to parse table-format data (common in FAA responses)
  const tableMatches = section.match(/\|[^|]+\|[^|]+\|/g);
  if (tableMatches) {
    for (const row of tableMatches) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        const [key, value] = cells;
        assignTableValue(record, key, value);
      }
    }
  }
  
  return record;
}

function extractValue(line: string, pattern: RegExp, groupIndex: number = 1): string | undefined {
  const match = line.match(pattern);
  if (match && match[groupIndex]) {
    return match[groupIndex].trim().replace(/\*+/g, '').trim();
  }
  return undefined;
}

function assignTableValue(record: FAARegistryRecord, key: string, value: string) {
  const lowerKey = key.toLowerCase();
  const cleanValue = value.trim();
  
  if (!cleanValue || cleanValue === '-' || cleanValue === 'N/A') return;
  
  if (lowerKey.includes('serial')) record.serialNumber = cleanValue;
  if (lowerKey.includes('manufacturer') && !lowerKey.includes('engine')) record.aircraftManufacturer = cleanValue;
  if (lowerKey.includes('model') && !lowerKey.includes('engine')) record.aircraftModel = cleanValue;
  if (lowerKey.includes('engine') && lowerKey.includes('mfr')) record.engineManufacturer = cleanValue;
  if (lowerKey.includes('engine') && lowerKey.includes('model')) record.engineModel = cleanValue;
  if (lowerKey.includes('year')) record.yearManufactured = parseInt(cleanValue, 10) || undefined;
  if (lowerKey.includes('name') || lowerKey.includes('registrant')) record.registrantName = cleanValue;
  if (lowerKey.includes('city')) record.registrantCity = cleanValue;
  if (lowerKey.includes('state')) record.registrantState = cleanValue;
  if (lowerKey.includes('status')) record.status = cleanValue;
}

export function formatRecordForDisplay(record: FAARegistryRecord): string {
  const parts: string[] = [];
  
  if (record.aircraftManufacturer || record.aircraftModel) {
    parts.push(`Aircraft: ${[record.aircraftManufacturer, record.aircraftModel].filter(Boolean).join(' ')}`);
  }
  if (record.serialNumber) {
    parts.push(`S/N: ${record.serialNumber}`);
  }
  if (record.registrantName) {
    parts.push(`Owner: ${record.registrantName}`);
  }
  if (record.registrantCity && record.registrantState) {
    parts.push(`Location: ${record.registrantCity}, ${record.registrantState}`);
  }
  if (record.status) {
    parts.push(`Status: ${record.status}`);
  }
  if (record.yearManufactured) {
    parts.push(`Year: ${record.yearManufactured}`);
  }
  
  return parts.join(' | ');
}
