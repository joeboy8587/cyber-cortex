import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface LandingPoint {
  registration: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  detection_timestamp: string;
}

interface Cluster {
  center_lat: number;
  center_lng: number;
  points: LandingPoint[];
  registrations: Set<string>;
  timestamps: Date[];
}

function clusterLandingPoints(points: LandingPoint[], radiusM = 500): Cluster[] {
  const clusters: Cluster[] = [];
  for (const pt of points) {
    let merged = false;
    for (const cluster of clusters) {
      if (haversineDistance(cluster.center_lat, cluster.center_lng, pt.latitude, pt.longitude) <= radiusM) {
        cluster.points.push(pt);
        cluster.registrations.add(pt.registration);
        cluster.timestamps.push(new Date(pt.detection_timestamp));
        const n = cluster.points.length;
        cluster.center_lat = cluster.points.reduce((s, p) => s + p.latitude, 0) / n;
        cluster.center_lng = cluster.points.reduce((s, p) => s + p.longitude, 0) / n;
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({
        center_lat: pt.latitude,
        center_lng: pt.longitude,
        points: [pt],
        registrations: new Set([pt.registration]),
        timestamps: [new Date(pt.detection_timestamp)],
      });
    }
  }
  return clusters;
}

function scoreCluster(cluster: Cluster): number {
  let score = 0;
  score += Math.min(60, cluster.points.length * 20);
  if (cluster.registrations.size > 1) score += 15;
  const sorted = cluster.timestamps.sort((a, b) => a.getTime() - b.getTime());
  if (sorted.length >= 2) {
    const spanDays = (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / (1000 * 60 * 60 * 24);
    if (spanDays >= 30) score += 10;
  }
  const nightOps = cluster.timestamps.filter(t => {
    const h = t.getUTCHours();
    return h >= 22 || h < 5;
  }).length;
  if (nightOps > 0) score += 10;
  return Math.min(100, score);
}

function connectDb(url: string) {
  const u = new URL(url);
  u.searchParams.set('sslmode', 'require');
  return postgres(u.toString(), { ssl: { rejectUnauthorized: false }, max: 2, idle_timeout: 10, connect_timeout: 15, fetch_types: false, prepare: false });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const neonUrl = Deno.env.get('NEON_DATABASE_URL');
  const supaUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!neonUrl || !supaUrl) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const neonSql = connectDb(neonUrl);
  const supaSql = connectDb(supaUrl);

  try {
    const scanId = `unmask-${Date.now()}`;
    console.log(`[unmask-hq] Starting scan ${scanId}`);

    // 1. Get target aircraft from Supabase tables
    const [flaggedAircraft, sentinelThreats] = await Promise.all([
      supaSql`SELECT DISTINCT registration FROM public.watchtower_autonomous_flags WHERE registration IS NOT NULL AND registration != '' AND (auto_resolved = false OR auto_resolved IS NULL)`,
      supaSql`SELECT DISTINCT registration FROM public.sentinel_learned_threats WHERE registration IS NOT NULL AND registration != ''`.catch(() => []),
    ]);

    const targetRegs = new Set<string>();
    for (const r of flaggedAircraft) if (r.registration) targetRegs.add(r.registration);
    for (const r of sentinelThreats) if (r.registration) targetRegs.add(r.registration);

    if (targetRegs.size === 0) {
      console.log('[unmask-hq] No target aircraft found');
      await Promise.all([neonSql.end(), supaSql.end()]);
      return new Response(JSON.stringify({ success: true, message: 'No target aircraft found', clusters: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[unmask-hq] ${targetRegs.size} target aircraft: ${[...targetRegs].slice(0, 10).join(', ')}`);

    // 2. Query landing signatures from Neon
    const regList = [...targetRegs].map(r => `'${r.replace(/'/g, '')}'`).join(',');
    const landingPoints: LandingPoint[] = await neonSql.unsafe(`
      SELECT registration, latitude, longitude, altitude, speed, detection_timestamp
      FROM live_flight_detections_rows
      WHERE registration IN (${regList})
        AND altitude < 500 AND altitude > 0
        AND speed < 60
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude != 0 AND longitude != 0
      ORDER BY registration, detection_timestamp
    `);

    console.log(`[unmask-hq] Found ${landingPoints.length} landing signature points`);

    if (landingPoints.length === 0) {
      await Promise.all([neonSql.end(), supaSql.end()]);
      return new Response(JSON.stringify({ success: true, message: 'No landing signatures detected', clusters: 0, targets: targetRegs.size }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Cluster landing points
    const clusters = clusterLandingPoints(landingPoints);
    const significantClusters = clusters.filter(c => c.points.length >= 2);

    // 4. Cross-reference with shell companies (Neon)
    let shellAddresses: any[] = [];
    try {
      shellAddresses = await neonSql`SELECT company_name, registered_address FROM shell_companies WHERE registered_address IS NOT NULL LIMIT 100`;
    } catch { /* table may not exist */ }

    // 5. Score and persist each cluster to Supabase
    const results = [];
    for (const cluster of significantClusters) {
      const confidence = scoreCluster(cluster);
      const nightOps = cluster.timestamps.filter(t => { const h = t.getUTCHours(); return h >= 22 || h < 5; }).length;
      const sortedTs = cluster.timestamps.sort((a, b) => a.getTime() - b.getTime());

      let locationType = 'unknown_facility';
      if (cluster.points.length >= 10) locationType = 'probable_base';
      else if (cluster.registrations.size > 2) locationType = 'convergence_point';
      else if (nightOps > cluster.points.length * 0.5) locationType = 'covert_facility';

      const crossRefs: any[] = [];
      for (const sc of shellAddresses) {
        crossRefs.push({ type: 'shell_company', name: sc.company_name });
        if (crossRefs.length >= 3) break;
      }

      const record = {
        cluster_center_lat: cluster.center_lat,
        cluster_center_lng: cluster.center_lng,
        visit_count: cluster.points.length,
        unique_aircraft: cluster.registrations.size,
        aircraft_list: JSON.stringify([...cluster.registrations]),
        first_visit: sortedTs[0]?.toISOString() || null,
        last_visit: sortedTs[sortedTs.length - 1]?.toISOString() || null,
        hq_confidence_score: confidence,
        location_type: locationType,
        cross_references: JSON.stringify(crossRefs),
        night_operations: nightOps,
        scan_id: scanId,
      };

      try {
        await supaSql`INSERT INTO unmasked_hq_locations ${supaSql(record as any)}`;
        results.push(record);
      } catch (e) {
        console.error('[unmask-hq] Insert error:', e);
      }
    }

    console.log(`[unmask-hq] Persisted ${results.length} HQ locations`);
    await Promise.all([neonSql.end(), supaSql.end()]);

    return new Response(JSON.stringify({
      success: true,
      scan_id: scanId,
      targets: targetRegs.size,
      landing_points: landingPoints.length,
      clusters_total: clusters.length,
      clusters_significant: significantClusters.length,
      persisted: results.length,
      top_locations: results.sort((a, b) => b.hq_confidence_score - a.hq_confidence_score).slice(0, 5),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[unmask-hq] Error:', error);
    try { await Promise.all([neonSql.end(), supaSql.end()]); } catch {}
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
