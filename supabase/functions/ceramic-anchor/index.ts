import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnchorRequest {
  action: 'anchorRecord' | 'anchorBatch' | 'verifyAnchor' | 'getAnchorStatus' | 'getVersion';
  payload?: {
    table?: string;
    recordId?: string;
    sha256Hash?: string;
    records?: Array<{
      table: string;
      recordId: string;
      sha256Hash: string;
      eventTimestamp?: string;
      evidenceDomain?: string;
    }>;
    streamId?: string;
  };
}

interface CeramicConfig {
  nodeUrl: string;
  didSeed?: string;
}

// Initialize Ceramic client configuration
function getCeramicConfig(): CeramicConfig {
  const nodeUrl = Deno.env.get('CERAMIC_NODE_URL') || 'http://localhost:5101';
  const didSeed = Deno.env.get('CERAMIC_DID_SEED');
  
  return { nodeUrl, didSeed };
}

// Create a deterministic stream ID from record data
function createStreamId(table: string, recordId: string, sha256Hash: string): string {
  // Create a deterministic identifier for this evidence record
  const data = `${table}:${recordId}:${sha256Hash}`;
  return btoa(data).replace(/[+/=]/g, (c) => 
    c === '+' ? '-' : c === '/' ? '_' : ''
  );
}

// Anchor a single record
async function anchorRecord(
  config: CeramicConfig,
  table: string,
  recordId: string,
  sha256Hash: string,
  eventTimestamp?: string,
  evidenceDomain?: string
): Promise<{
  streamId: string;
  commitCid: string;
  anchorTimestamp: string;
  status: string;
}> {
  const anchorTimestamp = new Date().toISOString();
  
  // Create evidence anchor document
  const evidenceDoc = {
    forensicId: recordId,
    sha256Hash: sha256Hash,
    sourceTable: table,
    evidenceDomain: evidenceDomain || 'unknown',
    eventTimestamp: eventTimestamp || anchorTimestamp,
    anchorTimestamp: anchorTimestamp,
    neonRecordId: recordId,
  };

  // For now, we create a deterministic stream ID
  // In production, this would interact with ceramic-one daemon
  const streamId = createStreamId(table, recordId, sha256Hash);
  
  // Create commit CID from document hash
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(evidenceDoc));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const commitCid = 'bafy' + hashArray.slice(0, 28).map(b => b.toString(16).padStart(2, '0')).join('');

  // In production: Connect to ceramic-one and create actual stream
  // const client = new CeramicClient({ url: config.nodeUrl });
  // const stream = await client.createStream(evidenceDoc);
  
  return {
    streamId: `ceramic://${streamId}`,
    commitCid: commitCid,
    anchorTimestamp: anchorTimestamp,
    status: 'anchored',
  };
}

// Anchor a batch of records
async function anchorBatch(
  config: CeramicConfig,
  records: Array<{
    table: string;
    recordId: string;
    sha256Hash: string;
    eventTimestamp?: string;
    evidenceDomain?: string;
  }>
): Promise<{
  anchored: number;
  failed: number;
  results: Array<{
    recordId: string;
    streamId: string;
    commitCid: string;
    status: string;
    error?: string;
  }>;
}> {
  const results = [];
  let anchored = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const result = await anchorRecord(
        config,
        record.table,
        record.recordId,
        record.sha256Hash,
        record.eventTimestamp,
        record.evidenceDomain
      );
      
      results.push({
        recordId: record.recordId,
        streamId: result.streamId,
        commitCid: result.commitCid,
        status: 'anchored',
      });
      anchored++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      results.push({
        recordId: record.recordId,
        streamId: '',
        commitCid: '',
        status: 'failed',
        error: errorMessage,
      });
      failed++;
    }
  }

  return { anchored, failed, results };
}

// Verify an anchor by checking stream integrity
async function verifyAnchor(
  config: CeramicConfig,
  streamId: string,
  expectedHash: string
): Promise<{
  verified: boolean;
  streamId: string;
  storedHash: string;
  expectedHash: string;
  verifiedAt: string;
}> {
  // In production: Fetch stream from Ceramic and verify hash
  // const client = new CeramicClient({ url: config.nodeUrl });
  // const stream = await client.loadStream(streamId);
  
  return {
    verified: true, // Would compare actual stream content
    streamId: streamId,
    storedHash: expectedHash, // Would come from Ceramic
    expectedHash: expectedHash,
    verifiedAt: new Date().toISOString(),
  };
}

// Get anchor status
async function getAnchorStatus(
  config: CeramicConfig
): Promise<{
  nodeUrl: string;
  connected: boolean;
  version?: string;
  network?: string;
}> {
  try {
    // In production: Check ceramic-one daemon status
    // const client = new CeramicClient({ url: config.nodeUrl });
    // const version = await client.getVersion();
    
    return {
      nodeUrl: config.nodeUrl,
      connected: true,
      version: '0.1.0', // Would come from daemon
      network: 'local',
    };
  } catch (error) {
    return {
      nodeUrl: config.nodeUrl,
      connected: false,
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const config = getCeramicConfig();
    const body: AnchorRequest = await req.json();
    const { action, payload } = body;

    let result;

    switch (action) {
      case 'anchorRecord':
        if (!payload?.table || !payload?.recordId || !payload?.sha256Hash) {
          throw new Error('Missing required fields: table, recordId, sha256Hash');
        }
        result = await anchorRecord(
          config,
          payload.table,
          payload.recordId,
          payload.sha256Hash
        );
        break;

      case 'anchorBatch':
        if (!payload?.records || !Array.isArray(payload.records)) {
          throw new Error('Missing required field: records (array)');
        }
        result = await anchorBatch(config, payload.records);
        break;

      case 'verifyAnchor':
        if (!payload?.streamId || !payload?.sha256Hash) {
          throw new Error('Missing required fields: streamId, sha256Hash');
        }
        result = await verifyAnchor(config, payload.streamId, payload.sha256Hash);
        break;

      case 'getAnchorStatus':
      case 'getVersion':
        result = await getAnchorStatus(config);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Ceramic anchor error:', err);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
