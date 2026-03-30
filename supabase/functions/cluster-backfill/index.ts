import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Notion Database IDs ──────────────────────────────────────────────
const NOTION_DBS = {
  detections: '33333a7b-866a-81fc-be66-000bbcf9cedd',
  aircraftEvents: 'ccbe5121-6049-451b-b153-915c68ae4742',
  physioEvents: '913aba27-7cac-4bd4-b15c-6beda75f25b7',
};

// ── Hardcoded physio events with known Notion page IDs ──────────────
// 9 of 11 provided; 2 missing (HRV 18ms 2025-10-06, HRV 22ms 2025-10-07)
const PHYSIO_EVENTS = [
  { label: 'HRV 1ms — 2025-07-18 21:20 UTC (WHOOP)',              ts: '2025-07-18T21:20:00.000Z', pageId: 'e2f37996-1618-4093-a458-9b725477f335' },
  { label: 'HRV 1ms — 2025-07-21 14:10 UTC (WHOOP)',              ts: '2025-07-21T14:10:00.000Z', pageId: 'd5180c4a-65cb-468d-a4ba-d9bb17bad7a5' },
  { label: 'HRV 4ms — 2025-07-21 18:44 UTC (WHOOP)',              ts: '2025-07-21T18:44:00.000Z', pageId: 'b3b93195-fc84-4b46-bf0c-f646cbbcb07d' },
  { label: 'HRV 4ms — 2025-07-23 23:10 UTC (WHOOP)',              ts: '2025-07-23T23:10:00.000Z', pageId: 'e69666c6-ffca-4092-8013-570b1c774b61' },
  { label: 'HRV 1ms — 2025-07-30 02:41 UTC (WHOOP)',              ts: '2025-07-30T02:41:00.000Z', pageId: 'bfbaf355-10db-448d-bf9b-42077266a037' },
  { label: 'HRV 4ms — 2025-07-30 02:41 UTC (WHOOP)',              ts: '2025-07-30T02:41:00.000Z', pageId: '5ea522d9-826b-4686-a02b-b2e91185c664' },
  { label: 'HRV 1ms — 2025-08-01 01:43 UTC (WHOOP)',              ts: '2025-08-01T01:43:00.000Z', pageId: 'e0cc465a-caaa-41af-833c-deca649f9bc6' },
  { label: 'HRV 1ms — 2025-08-01 14:18 UTC (WHOOP)',              ts: '2025-08-01T14:18:00.000Z', pageId: 'ee36cad1-7a95-46e3-8c5a-84b72475b869' },
  { label: 'HRV 22ms — 2025-09-30 17:00 UTC (WHOOP) — Recovery',  ts: '2025-09-30T17:00:00.000Z', pageId: '95ce6be8-19db-4639-8f9e-c4ab567b88ba' },
];

// ── Helpers ──────────────────────────────────────────────────────────

async function notionRequest(path: string, method: string, body?: any): Promise<any> {
  const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
  if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not configured');

  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`https://api.notion.com/v1${path}`, opts);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Notion API ${res.status}: ${errText}`);
  }
  return res.json();
}

async function queryDatabase(dbId: string, filter: any, startCursor?: string, pageSize = 100): Promise<any> {
  const body: any = { filter, page_size: pageSize };
  if (startCursor) body.start_cursor = startCursor;
  return notionRequest(`/databases/${dbId}/query`, 'POST', body);
}

function windowBounds(centerIso: string, windowMinutes: number): { start: string; end: string } {
  const center = new Date(centerIso);
  const ms = windowMinutes * 60 * 1000;
  return {
    start: new Date(center.getTime() - ms).toISOString(),
    end: new Date(center.getTime() + ms).toISOString(),
  };
}

// ── Pass 1: Create cluster events + link to physio ───────────────────

interface ClusterResult {
  physioLabel: string;
  physioTs: string;
  physioPageId: string;
  clusterPageId: string | null;
  clusterUrl: string | null;
  detectionsInWindow: number;
  error?: string;
}

async function createClusterEvents(
  windowMinutes: number,
  dryRun: boolean,
): Promise<ClusterResult[]> {
  const results: ClusterResult[] = [];

  for (const physio of PHYSIO_EVENTS) {
    try {
      const { start, end } = windowBounds(physio.ts, windowMinutes);

      // Count detections in this window using detection_timestamp property
      let detectionCount = 0;
      try {
        const detResult = await queryDatabase(NOTION_DBS.detections, {
          and: [
            { property: 'detection_timestamp', date: { on_or_after: start } },
            { property: 'detection_timestamp', date: { on_or_before: end } },
          ]
        }, undefined, 1);
        detectionCount = detResult.results.length + (detResult.has_more ? 999 : 0);
      } catch (e) {
        console.warn(`Could not count detections for ${physio.label}:`, (e as Error).message);
      }

      if (dryRun) {
        results.push({
          physioLabel: physio.label,
          physioTs: physio.ts,
          physioPageId: physio.pageId,
          clusterPageId: null,
          clusterUrl: null,
          detectionsInWindow: detectionCount,
        });
        continue;
      }

      // Build the cluster event
      const startDt = new Date(start);
      const endDt = new Date(end);
      const clusterTitle = `Cluster: ${startDt.toISOString().slice(0, 16)}–${endDt.toISOString().slice(11, 16)} (${physio.label})`;

      const properties: any = {
        // Title = "Event"
        'Event': {
          title: [{ text: { content: clusterTitle } }]
        },
        // Date = "Datetime (UTC)" with expanded keys
        'Datetime (UTC)': {
          date: {
            start: start,
            end: end,
          }
        },
        // Also set "When" for the local-time display
        'When': {
          date: {
            start: start,
            end: end,
          }
        },
        // Window size for auditability
        'Window ± (minutes)': {
          number: windowMinutes
        },
        // Source
        'Source': {
          select: { name: 'ADS-B' }
        },
        // Description
        'Description': {
          rich_text: [{ text: { content: `Auto-generated cluster event. ±${windowMinutes} min window around physio event ${physio.label}. Detections in window: ${detectionCount}.` } }]
        },
        // Link to physio event
        'Related Physio Events': {
          relation: [{ id: physio.pageId }]
        },
      };

      const newPage = await notionRequest('/pages', 'POST', {
        parent: { database_id: NOTION_DBS.aircraftEvents },
        properties,
      });

      results.push({
        physioLabel: physio.label,
        physioTs: physio.ts,
        physioPageId: physio.pageId,
        clusterPageId: newPage.id,
        clusterUrl: newPage.url,
        detectionsInWindow: detectionCount,
      });

      console.log(`✅ Created cluster: ${clusterTitle} → ${newPage.id}`);
    } catch (e) {
      console.error(`❌ Failed for ${physio.label}:`, (e as Error).message);
      results.push({
        physioLabel: physio.label,
        physioTs: physio.ts,
        physioPageId: physio.pageId,
        clusterPageId: null,
        clusterUrl: null,
        detectionsInWindow: 0,
        error: (e as Error).message,
      });
    }
  }

  return results;
}

// ── Pass 2: Attach detection page IDs to cluster events ──────────────

interface AttachResult {
  clusterPageId: string;
  physioTs: string;
  detectionsFound: number;
  detectionsAttached: number;
  error?: string;
}

async function attachDetections(
  clusters: ClusterResult[],
  windowMinutes: number,
  maxDetectionsPerCluster: number,
): Promise<AttachResult[]> {
  const results: AttachResult[] = [];

  for (const cluster of clusters) {
    if (!cluster.clusterPageId) continue;

    try {
      const { start, end } = windowBounds(cluster.physioTs, windowMinutes);

      // Query detections in this window using detection_timestamp
      const detectionPageIds: string[] = [];
      let cursor: string | undefined;
      let pages = 0;

      do {
        const res = await queryDatabase(NOTION_DBS.detections, {
          and: [
            { property: 'detection_timestamp', date: { on_or_after: start } },
            { property: 'detection_timestamp', date: { on_or_before: end } },
          ]
        }, cursor, 100);

        for (const page of res.results) {
          detectionPageIds.push(page.id);
        }
        cursor = res.has_more ? res.next_cursor : undefined;
        pages++;
      } while (cursor && detectionPageIds.length < maxDetectionsPerCluster && pages < 10);

      const toAttach = detectionPageIds.slice(0, maxDetectionsPerCluster);

      if (toAttach.length > 0) {
        await notionRequest(`/pages/${cluster.clusterPageId}`, 'PATCH', {
          properties: {
            'Raw Detection (unfiltered)': {
              relation: toAttach.map(id => ({ id }))
            }
          }
        });
      }

      results.push({
        clusterPageId: cluster.clusterPageId,
        physioTs: cluster.physioTs,
        detectionsFound: detectionPageIds.length,
        detectionsAttached: toAttach.length,
      });

      console.log(`🔗 Attached ${toAttach.length} detections to cluster ${cluster.clusterPageId}`);
    } catch (e) {
      results.push({
        clusterPageId: cluster.clusterPageId,
        physioTs: cluster.physioTs,
        detectionsFound: 0,
        detectionsAttached: 0,
        error: (e as Error).message,
      });
    }
  }

  return results;
}

// ── Main handler ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      windowMinutes = 30,
      maxDetectionsPerCluster = 200,
      dryRun = false,
      clusterResults, // Pass 2 needs Pass 1 results
    } = body;

    switch (action) {
      // Dry-run scan: check what would be created
      case 'scan': {
        const clusters = await createClusterEvents(windowMinutes, true);
        return new Response(JSON.stringify({
          success: true,
          action: 'scan',
          windowMinutes,
          physioEvents: PHYSIO_EVENTS.length,
          clusters,
          totalDetectionsEstimate: clusters.reduce((s, c) => s + c.detectionsInWindow, 0),
          note: '2 physio events missing URLs (HRV 18ms 2025-10-06, HRV 22ms 2025-10-07)',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Pass 1: Create cluster events + link to physio
      case 'createClusters': {
        const clusters = await createClusterEvents(windowMinutes, dryRun);
        return new Response(JSON.stringify({
          success: true,
          action: 'createClusters',
          dryRun,
          windowMinutes,
          clusters,
          created: clusters.filter(c => c.clusterPageId).length,
          errors: clusters.filter(c => c.error).length,
          message: dryRun
            ? `DRY RUN: Would create ${clusters.length} cluster events`
            : `Created ${clusters.filter(c => c.clusterPageId).length} cluster events`,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Pass 2: Attach detections to existing clusters
      case 'attachDetections': {
        if (!clusterResults || !Array.isArray(clusterResults)) {
          return new Response(JSON.stringify({
            error: 'Pass "clusterResults" array from createClusters output'
          }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const attachResults = await attachDetections(clusterResults, windowMinutes, maxDetectionsPerCluster);
        return new Response(JSON.stringify({
          success: true,
          action: 'attachDetections',
          windowMinutes,
          maxDetectionsPerCluster,
          results: attachResults,
          totalAttached: attachResults.reduce((s, r) => s + r.detectionsAttached, 0),
          errors: attachResults.filter(r => r.error).length,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({
          error: `Unknown action: ${action}. Use: scan, createClusters, attachDetections`
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: unknown) {
    console.error('Cluster backfill error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
