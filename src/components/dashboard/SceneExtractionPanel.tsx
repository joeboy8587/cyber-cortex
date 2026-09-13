import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { formatPacific, formatUtc } from '@/lib/timezone';
import {
  arbitrateTimestamp,
  candidate,
  fromTakeoutSidecar,
  pngTextCandidate,
  readPngTextChunks,
  screenClockCandidate,
  type ArbitrationResult,
} from '@/lib/timestampArbitration';
import { Eye, Upload, Loader2, ShieldAlert, Clock, Plane, Activity, EyeOff, Database, Archive, AlertCircle as AlertCircleIcon } from 'lucide-react';

interface SceneRow {
  id: string;
  filename: string;
  arbitration: ArbitrationResult;
  scene: any | null;
  provider?: string;
  model?: string;
  error?: string;
  saved?: boolean;
}

const BATCH = 4;

/** Stable identity for a file so the same screenshot is never read twice. */
const fingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/** Read EXIF DateTimeOriginal without pulling a heavy parser for non-JPEGs. */
async function readExifOriginal(file: File): Promise<string | null> {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
  try {
    const mod: any = await import('exif-js');
    const EXIF = mod.default || mod;
    const buf = await file.arrayBuffer();
    const tags = EXIF.readFromBinaryFile(buf);
    return tags?.DateTimeOriginal || tags?.DateTimeDigitized || null;
  } catch {
    return null;
  }
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const SceneExtractionPanel: React.FC = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<SceneRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [skipProcessed, setSkipProcessed] = useState(true);
  const [archive, setArchive] = useState({ total: 0, masked: 0, review: 0, dated: 0, failed: 0 });

  const loadArchive = useCallback(async () => {
    // Successful extractions only (error IS NULL) count toward the archive totals;
    // failed rows are surfaced separately so they don't inflate "scenes read".
    const [{ count: total }, { count: masked }, { count: review }, { count: dated }, { count: failed }] =
      await Promise.all([
        supabase.from('vlm_scene_extractions').select('*', { count: 'exact', head: true }).is('error', null),
        supabase
          .from('vlm_scene_extractions')
          .select('*', { count: 'exact', head: true })
          .is('error', null)
          .eq('masked_contact', true),
        supabase
          .from('vlm_scene_extractions')
          .select('*', { count: 'exact', head: true })
          .is('error', null)
          .eq('needs_review', true),
        supabase
          .from('vlm_scene_extractions')
          .select('*', { count: 'exact', head: true })
          .is('error', null)
          .not('captured_at_utc', 'is', null),
        supabase.from('vlm_scene_extractions').select('*', { count: 'exact', head: true }).not('error', 'is', null),
      ]);
    setArchive({ total: total ?? 0, masked: masked ?? 0, review: review ?? 0, dated: dated ?? 0, failed: failed ?? 0 });
  }, []);

  useEffect(() => {
    loadArchive();
  }, [loadArchive]);

  const stats = useMemo(() => {
    const masked = rows.filter((r) => r.scene?.fr24_selected?.masked).length;
    const review = rows.filter((r) => r.arbitration.needsReview).length;
    const failed = rows.filter((r) => r.error).length;
    return { masked, review, failed, total: rows.length };
  }, [rows]);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const all = Array.from(fileList);
      let images = all.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|heic)$/i.test(f.name));
      const sidecars = new Map<string, File>();
      all
        .filter((f) => /\.json$/i.test(f.name))
        .forEach((f) => sidecars.set(f.name.replace(/\.(supplemental-metadata|json)/gi, '').toLowerCase(), f));

      if (images.length === 0) {
        toast({ title: 'No images found', description: 'Select the screenshot folder (images + any JSON sidecars).', variant: 'destructive' });
        return;
      }

      setBusy(true);
      setProgress(0);
      const collected: SceneRow[] = [];

      try {
        // Resume: drop anything already read into the archive.
        if (skipProcessed) {
          const prints = images.map(fingerprint);
          const seen = new Set<string>();
          for (let i = 0; i < prints.length; i += 200) {
            const { data } = await supabase
              .from('vlm_scene_extractions')
              .select('file_fingerprint, error')
              .in('file_fingerprint', prints.slice(i, i + 200));
            // Only skip fingerprints that succeeded (error IS NULL) so failed
            // extractions are retried instead of being excluded forever.
            (data ?? []).forEach((d: any) => {
              if (d.error == null) seen.add(d.file_fingerprint);
            });
          }
          const before = images.length;
          images = images.filter((f) => !seen.has(fingerprint(f)));
          if (before !== images.length) {
            toast({ title: 'Resuming backfill', description: `${before - images.length} already read, ${images.length} left to do.` });
          }
          if (images.length === 0) {
            setBusy(false);
            return;
          }
        }

        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id ?? null;

        for (let i = 0; i < images.length; i += BATCH) {
          const slice = images.slice(i, i + BATCH);

          const prepared = await Promise.all(
            slice.map(async (file) => {
              // Signal 2: Google Photos takeout sidecar
              const base = file.name.replace(/\.[^.]+$/, '').toLowerCase();
              const sidecarFile =
                sidecars.get(file.name.toLowerCase()) ||
                sidecars.get(base) ||
                sidecars.get(`${file.name.toLowerCase()}.`) ||
                null;
              let sidecar = null;
              if (sidecarFile) {
                try {
                  sidecar = fromTakeoutSidecar(JSON.parse(await sidecarFile.text()));
                } catch {
                  sidecar = null;
                }
              }

              const exifRaw = await readExifOriginal(file);
              const png = pngTextCandidate(await readPngTextChunks(file));

              return {
                file,
                dataUrl: await fileToDataUrl(file),
                candidates: [
                  sidecar,
                  candidate('EXIF_DATETIME_ORIGINAL', exifRaw),
                  png,
                  candidate('FILE_MTIME', new Date(file.lastModified).toISOString()),
                ],
              };
            }),
          );

          const { data, error } = await supabase.functions.invoke('vlm-scene-extract', {
            body: {
              images: prepared.map((p, idx) => ({
                id: `${i + idx}`,
                filename: p.file.name,
                data_url: p.dataUrl,
                mime_type: p.file.type,
              })),
            },
          });
          if (error) throw error;

          const results: any[] = data?.results ?? [];
          const toPersist: any[] = [];

          prepared.forEach((p, idx) => {
            const res = results.find((r) => r.id === `${i + idx}`) ?? {};
            const scene = res.scene ?? null;

            // First arbitration on dated signals only, then fold the screen clock in.
            const provisional = arbitrateTimestamp(p.candidates);
            const withClock = arbitrateTimestamp([
              ...p.candidates,
              screenClockCandidate(scene?.status_bar_time, provisional.capturedAtUtc),
            ]);

            collected.push({
              id: `${i + idx}`,
              filename: p.file.name,
              arbitration: withClock,
              scene,
              provider: res.provider,
              model: res.model,
              error: res.error,
            });

            const sel = scene?.fr24_selected ?? null;
            toPersist.push({
              uploaded_by: uid,
              filename: p.file.name,
              file_size: p.file.size,
              file_fingerprint: fingerprint(p.file),
              shot_type: scene?.shot_type ?? null,
              captured_at_utc: withClock.capturedAtUtc ?? null,
              timestamp_source: withClock.chosen ?? null,
              timestamp_confidence: withClock.confidence ?? null,
              agreement_count: withClock.agreementCount ?? 0,
              needs_review: !!withClock.needsReview,
              disagreements: withClock.disagreements ?? [],
              selected_reg: sel?.reg ?? null,
              selected_callsign: sel?.callsign ?? null,
              selected_hex: sel?.hex ?? null,
              masked_contact: !!sel?.masked,
              contact_count: scene?.contact_count ?? null,
              track_geometry: scene?.track_geometry ?? null,
              area_hint: scene?.area_hint ?? null,
              map_labels: scene?.fr24_map_labels ?? [],
              biometrics: scene?.biometrics ?? null,
              scene: scene ?? {},
              provider: res.provider ?? null,
              model: res.model ?? null,
              error: res.error ?? null,
            });
          });

          const { error: saveErr } = await supabase
            .from('vlm_scene_extractions')
            .upsert(toPersist, { onConflict: 'file_fingerprint' });
          if (saveErr) console.error('scene persist failed', saveErr);

          setRows([...collected]);
          setProgress(Math.round(((i + slice.length) / images.length) * 100));
        }

        await loadArchive();
        toast({
          title: 'Scene extraction complete',
          description: `${collected.length} screenshots read as scenes and filed into the archive.`,
        });
      } catch (e: any) {
        toast({ title: 'Extraction failed', description: e.message?.slice(0, 200), variant: 'destructive' });
      } finally {
        setBusy(false);
      }
    },
    [toast, skipProcessed, loadArchive],
  );

  return (
    <CyberPanel title="VLM SCENE EXTRACTION + TIMESTAMP ARBITRATION" icon={<Eye className="h-4 w-4" />}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Screenshots are structured scenes, not text blobs. A vision model returns a typed scene graph where
          <span className="text-destructive font-semibold"> REG: N/A means MASKED</span>, never absent. Capture time is
          arbitrated across four signals (takeout sidecar → EXIF/PNG tEXt → file time → status-bar clock); disagreements
          are flagged for review, never silently resolved. Every read is filed permanently, so a large folder can be
          backfilled in sittings — already-read files are skipped automatically.
        </p>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <ArchiveStat icon={Archive} label="Scenes in archive" value={archive.total} />
          <ArchiveStat icon={EyeOff} label="Masked contacts" value={archive.masked} tone />
          <ArchiveStat icon={Clock} label="Defensible capture time" value={archive.dated} />
          <ArchiveStat icon={ShieldAlert} label="Need time review" value={archive.review} tone />
          <ArchiveStat icon={AlertCircleIcon} label="Failed, will retry" value={archive.failed} tone />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label>
            <input
              type="file"
              multiple
              accept="image/*,.json"
              className="hidden"
              disabled={busy}
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button asChild disabled={busy} variant="outline">
              <span className="cursor-pointer">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Select screenshots (+ JSON sidecars)
              </span>
            </Button>
          </label>

          <div className="flex items-center gap-2">
            <Switch id="skip-processed" checked={skipProcessed} onCheckedChange={setSkipProcessed} disabled={busy} />
            <Label htmlFor="skip-processed" className="text-xs text-muted-foreground">
              Skip files already read
            </Label>
          </div>

          <Button size="sm" variant="ghost" onClick={loadArchive} disabled={busy}>
            <Database className="w-4 h-4 mr-2" /> Refresh archive totals
          </Button>

          {stats.total > 0 && (
            <>
              <Badge variant="outline">{stats.total} this session</Badge>
              <Badge variant="destructive">{stats.masked} masked</Badge>
              <Badge variant="secondary">{stats.review} need review</Badge>
              {stats.failed > 0 && <Badge variant="outline">{stats.failed} failed</Badge>}
            </>
          )}
        </div>

        {busy && <Progress value={progress} className="h-1" />}

        <ScrollArea className="h-[520px] pr-3">
          <div className="space-y-3">
            {rows.map((row) => {
              const s = row.scene;
              const masked = s?.fr24_selected?.masked;
              return (
                <div key={row.id} className="rounded border border-border/60 p-3 space-y-2 bg-card/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs truncate">{row.filename}</span>
                    <div className="flex items-center gap-1">
                      {s?.shot_type && <Badge variant="outline">{s.shot_type}</Badge>}
                      {masked && (
                        <Badge variant="destructive" className="gap-1">
                          <EyeOff className="w-3 h-3" /> MASKED CONTACT
                        </Badge>
                      )}
                      {row.error && <Badge variant="outline" className="text-destructive">{row.error}</Badge>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <span className="font-mono">
                      {row.arbitration.capturedAtUtc
                        ? `${formatPacific(row.arbitration.capturedAtUtc)} · ${formatUtc(row.arbitration.capturedAtUtc)}`
                        : 'no defensible capture time'}
                    </span>
                    <Badge variant={row.arbitration.needsReview ? 'destructive' : 'secondary'}>
                      {row.arbitration.chosen ?? 'NONE'} · {row.arbitration.confidence}
                    </Badge>
                    <Badge variant="outline">{row.arbitration.agreementCount} signals agree</Badge>
                  </div>

                  {row.arbitration.needsReview && (
                    <div className="text-[11px] text-destructive flex items-start gap-1">
                      <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{row.arbitration.disagreements.join(' · ') || 'Flagged for review'}</span>
                    </div>
                  )}

                  {s?.fr24_selected && (
                    <div className="text-xs flex flex-wrap gap-x-4 gap-y-1">
                      <span className="flex items-center gap-1">
                        <Plane className="w-3 h-3" />
                        {s.fr24_selected.reg ?? 'REG MASKED'} {s.fr24_selected.type ? `· ${s.fr24_selected.type}` : ''}
                      </span>
                      {s.fr24_selected.alt_ft != null && <span>{s.fr24_selected.alt_ft} ft</span>}
                      {s.fr24_selected.gs_kt != null && <span>{s.fr24_selected.gs_kt} kt</span>}
                      {s.track_geometry && s.track_geometry !== 'unknown' && (
                        <Badge variant="outline">{s.track_geometry}</Badge>
                      )}
                      {s.status_bar_time && <span className="text-muted-foreground">clock {s.status_bar_time}</span>}
                    </div>
                  )}

                  {!!s?.fr24_map_labels?.length && (
                    <div className="flex flex-wrap gap-1">
                      {s.fr24_map_labels.map((l: string, i: number) => (
                        <Badge key={i} variant={/no call/i.test(l) ? 'destructive' : 'outline'} className="text-[10px]">
                          {l}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {s?.biometrics && (
                    <div className="text-xs flex flex-wrap gap-3 text-chart-2">
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        {s.biometrics.hr_bpm != null && `HR ${s.biometrics.hr_bpm}`}
                      </span>
                      {s.biometrics.hrv_ms != null && <span>HRV {s.biometrics.hrv_ms} ms</span>}
                      {s.biometrics.sdnn != null && <span>SDNN {s.biometrics.sdnn}</span>}
                      {s.biometrics.coherence_pct != null && <span>Coherence {s.biometrics.coherence_pct}%</span>}
                    </div>
                  )}

                  {(row.provider || row.model) && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {row.provider} · {row.model}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </CyberPanel>
  );
};

function ArchiveStat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: boolean }) {
  return (
    <div className="rounded border border-border/60 bg-card/40 p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone ? 'text-destructive' : ''}`} />
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl ${tone ? 'text-destructive' : 'text-primary'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

export default SceneExtractionPanel;
