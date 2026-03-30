import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Notion Data Source IDs (collection:// format → UUID for API) ──────
const NOTION_DBS = {
  // unfilterd_detections (9) — raw detections to query
  detections: '33333a7b-866a-81fc-be66-000bbcf9cedd',
  // ✈️ Aircraft Events Log — where we CREATE cluster events
  aircraftEvents: 'ccbe5121-6049-451b-b153-915c68ae4742',
  // 🫀 Physio Events — existing physio events to link
  physioEvents: '913aba27-7cac-4bd4-b15c-6beda75f25b7',
};

// ── Physio events with known timestamps ──────────────────────────────
const PHYSIO_TIMESTAMPS = [
  { label: 'HRV 1ms — 2025-07-18 21:20 UTC (WHOOP)', ts: '2025-07-18T21:20:00.000Z' },
  { label: 'HRV 1ms — 2025-07-21 14:10 UTC (WHOOP)', ts: '2025-07-21T14:10:00.000Z' },
  { label: 'HRV 4ms — 2025-07-21 18:44 UTC (WHOOP)', ts: '2025-07-21T18:44:00.000Z' },
  { label: 'HRV 4ms — 2025-07-23 23:10 UTC (WHOOP)', ts: '2025-07-23T23:10:00.000Z' },
  { label: 'HRV 1ms — 2025-07-30 02:41 UTC (WHOOP)', ts: '2025-07-30T02:41:00.000Z' },
  { label: 'HRV 4ms — 2025-07-30 02:41 UTC (WHOOP)', ts: '2025-07-30T02:41:00.000Z' },
  { label: 'HRV 1ms — 2025-08-01 01:43 UTC (WHOOP)', ts: '2025-08-01T01:43:00.000Z' },
  { label: 'HRV 1ms — 2025-08-01 14:18 UTC (WHOOP)', ts: '2025-08-01T14:18:00.000Z' },
  { label: 'HRV 22ms — 2025-09-30 17:00 UTC (WHOOP) — Recovery', ts: '2025-09-30T17:00:00.000Z' },
  { label: 'HRV 18ms — 2025-10-06 07:17 UTC (WHOOP) — Recovery', ts: '2025-10-06T07:17:00.000Z' },
  { label: 'HRV 22ms — 2025-10-07 08:31 UTC (WHOOP) — Recovery', ts: '2025-10-07T08:31:00.000Z' },
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

function getProp(page: any, name: string): any {
  const prop = page.properties?.[name];
  if (!prop) return null;
  switch (prop.type) {
    case 'title': return prop.title?.map((t: any) => t.plain_text).join('') || null;
    case 'rich_text': return prop.rich_text?.map((t: any) => t.plain_text).join('') || null;
    case 'number': return prop.number;
    case 'select': return prop.select?.name || null;
    case 'date': return prop.date?.start || null;
    case 'url': return prop.url;
    case 'relation': return prop.relation?.map((r: any) => r.id) || [];
    default: return null;
  }
}

function windowBounds(centerIso: string, windowMinutes: number): { start: string; end: string } {
  const center = new Date(centerIso);
  const ms = windowMinutes * 60 * 1000;
  return {
    start: new Date(center.getTime() - ms).toISOString(),
    end: new Date(center.getTime() + ms).toISOString(),
  };
}

// ── Pass 0: Resolve physio event page IDs from timestamps ────────────

async function resolvePhysioPages(): Promise<{ label: string; ts: string; pageId: string | null; pageUrl: string | null }[]> {
  const results: { label: string; ts: string; pageId: string | null; pageUrl: string | null }[] = [];

  for (const physio of PHYSIO_TIMESTAMPS) {
    try {
      // Query physio events DB for pages near this timestamp
      // Use a tight window (±5 min) to find the exact physio event
      const { start, end } = windowBounds(physio.ts, 5);

      const queryResult = await queryDatabase(NOTION_DBS.physioEvents, {
        and: [
          { timestamp: 'created_time', created_time: { on_or_after: start } },
          { timestamp: 'created_time', created_time: { on_or_before: end } },
        ]
      }, undefined, 5);

      if (queryResult.results.length > 0) {
        const page = queryResult.results[0];
        results.push({
          label: physio.label,
          ts: physio.ts,
          pageId: page.id,
          pageUrl: page.url,
        });
      } else {
        // Try with last_edited_time as fallback
        const queryResult2 = await queryDatabase(NOTION_DBS.physioEvents, {
          and: [
            { timestamp: 'last_edited_time', last_edited_time: { on_or_after: start } },
            { timestamp: 'last_edited_time', last_edited_time: { on_or_before: end } },
          ]
        }, undefined, 5).catch(() => ({ results: [] }));

        if (queryResult2.results.length > 0) {
          const page = queryResult2.results[0];
          results.push({ label: physio.label, ts: physio.ts, pageId: page.id, pageUrl: page.url });
        } else {
          results.push({ label: physio.label, ts: physio.ts, pageId: null, pageUrl: null });
        }
      }
    } catch (e) {
      console.error(`Failed to resolve physio: ${physio.label}`, (e as Error).message);
      results.push({ label: physio.label, ts: physio.ts, pageId: null, pageUrl: null });
    }
  }

  return results;
}

// ── Pass 1: Create cluster events + link to physio ───────────────────

interface ClusterResult {
  physioLabel: string;
  physioTs: string;
  physioPageId: string | null;
  clusterPageId: string | null;
  clusterUrl: string | null;
  detectionsInWindow: number;
  error?: string;
}

async function createClusterEvents(
  physioPages: { label: string; ts: string; pageId: string | null }[],
  windowMinutes: number,
  dryRun: boolean,
): Promise<ClusterResult[]> {
  const results: ClusterResult[] = [];

  for (const physio of physioPages) {
    try {
      const { start, end } = windowBounds(physio.ts, windowMinutes);

      // Count detections in this window
      let detectionCount = 0;
      try {
        const detResult = await queryDatabase(NOTION_DBS.detections, {
          and: [
            { timestamp: 'created_time', created_time: { on_or_after: start } },
            { timestamp: 'created_time', created_time: { on_or_before: end } },
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

      // Build the cluster event page payload
      const startTime = new Date(start);
      const endTime = new Date(end);
      const clusterTitle = `Cluster: ${startTime.toISOString().slice(0, 16)}–${endTime.toISOString().slice(11, 16)} (${physio.label})`;

      const properties: any = {
        // Title property — adjust name if different in your DB
        'Name': {
          title: [{ text: { content: clusterTitle } }]
        },
        // Date property "When" — using proper Notion API format
        'When': {
          date: {
            start: start,
            end: end,
          }
        },
      };

      // Link to physio event via relation (if physio page was found)
      if (physio.pageId) {
        properties['Related Physio Events'] = {
          relation: [{ id: physio.pageId }]
        };
      }

      // Create the page in Aircraft Events Log
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

      console.log(`Created cluster: ${clusterTitle} → ${newPage.id}`);
    } catch (e) {
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

      // Query all detections in this window (paginate)
      const detectionPageIds: string[] = [];
      let cursor: string | undefined;
      let pages = 0;

      do {
        const res = await queryDatabase(NOTION_DBS.detections, {
          and: [
            { timestamp: 'created_time', created_time: { on_or_after: start } },
            { timestamp: 'created_time', created_time: { on_or_before: end } },
          ]
        }, cursor, 100);

        for (const page of res.results) {
          detectionPageIds.push(page.id);
        }
        cursor = res.has_more ? res.next_cursor : undefined;
        pages++;
      } while (cursor && detectionPageIds.length < maxDetectionsPerCluster && pages < 5);

      // Truncate to max
      const toAttach = detectionPageIds.slice(0, maxDetectionsPerCluster);

      if (toAttach.length > 0) {
        // Update the cluster event page with detection relations
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

      console.log(`Attached ${toAttach.length} detections to cluster ${cluster.clusterPageId}`);
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
      // Step 0: Resolve physio event page IDs
      case 'resolvePhysio': {
        const physioPages = await resolvePhysioPages();
        return new Response(JSON.stringify({
          success: true,
          action: 'resolvePhysio',
          physioPages,
          resolved: physioPages.filter(p => p.pageId).length,
          unresolved: physioPages.filter(p => !p.pageId).length,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Step 1: Create cluster events (Pass 1)
      case 'createClusters': {
        // First resolve physio pages
        const physioPages = await resolvePhysioPages();
        const resolved = physioPages.filter(p => p.pageId);

        console.log(`Resolved ${resolved.length}/${physioPages.length} physio events`);

        // Create cluster events
        const clusters = await createClusterEvents(
          physioPages.map(p => ({ label: p.label, ts: p.ts, pageId: p.pageId })),
          windowMinutes,
          dryRun,
        );

        return new Response(JSON.stringify({
          success: true,
          action: 'createClusters',
          dryRun,
          windowMinutes,
          physioResolved: resolved.length,
          physioUnresolved: physioPages.length - resolved.length,
          clusters,
          created: clusters.filter(c => c.clusterPageId).length,
          errors: clusters.filter(c => c.error).length,
          message: dryRun
            ? `DRY RUN: Would create ${clusters.length} cluster events`
            : `Created ${clusters.filter(c => c.clusterPageId).length} cluster events`,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Step 2: Attach detections to existing clusters (Pass 2)
      case 'attachDetections': {
        if (!clusterResults || !Array.isArray(clusterResults)) {
          return new Response(JSON.stringify({
            error: 'Pass "clusterResults" array from createClusters output'
          }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const attachResults = await attachDetections(
          clusterResults,
          windowMinutes,
          maxDetectionsPerCluster,
        );

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

      // Scan: just check what we'd find
      case 'scan': {
        const physioPages = await resolvePhysioPages();
        const scanResults: any[] = [];

        for (const physio of physioPages) {
          const { start, end } = windowBounds(physio.ts, windowMinutes);
          let detCount = 0;
          try {
            const res = await queryDatabase(NOTION_DBS.detections, {
              and: [
                { timestamp: 'created_time', created_time: { on_or_after: start } },
                { timestamp: 'created_time', created_time: { on_or_before: end } },
              ]
            }, undefined, 1);
            detCount = res.results.length + (res.has_more ? 999 : 0);
          } catch { /* skip */ }

          scanResults.push({
            label: physio.label,
            ts: physio.ts,
            physioPageId: physio.pageId,
            windowStart: start,
            windowEnd: end,
            detectionsEstimate: detCount,
          });
        }

        return new Response(JSON.stringify({
          success: true,
          action: 'scan',
          windowMinutes,
          physioResolved: physioPages.filter(p => p.pageId).length,
          events: scanResults,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({
          error: `Unknown action: ${action}. Use: resolvePhysio, scan, createClusters, attachDetections`
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
