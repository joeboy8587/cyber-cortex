import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { hasCurrentKcsoOwnership, fleetOwnershipStatus, type FleetIdentity } from '../../../supabase/functions/_shared/kcsoOwnershipRules';

const auditRegistrations = ['N912KC', 'N528AM', 'N788FA', 'N140UD'];
export function FleetIdentityReview({ registrations, onIdentities }: {
  registrations: string[]; onIdentities: (rows: FleetIdentity[]) => void;
}) {
  const [rows, setRows] = useState<FleetIdentity[]>([]);
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setIssue(null);
    const requested = [...new Set([...auditRegistrations, ...registrations])].slice(0, 200);
    try {
      const { data, error } = await supabase.functions.invoke('kcso-fleet-identity', { body: { registrations: requested } });
      if (error || data?.complete !== true || !Array.isArray(data?.identities)) throw new Error('Current FAA ownership check did not finish; saved fleet tags are not current confirmation.');
      setRows(data.identities);
      onIdentities(data.identities);
    } catch (error) {
      setRows([]);
      onIdentities([]);
      setIssue(error instanceof Error ? error.message : 'Current identity unavailable');
    } finally {
      setLoading(false);
    }
  }, [registrations, onIdentities]);
  useEffect(() => { void refresh(); }, [refresh]);
  const review = rows.filter(row => auditRegistrations.includes(row.registration) ||
    (row.listed_in_fleet && !hasCurrentKcsoOwnership(row)));
  return <section aria-label="Fleet ownership review" className="space-y-2 border-y border-border py-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Fleet ownership — current FAA check</h3>
      <Button variant="ghost" size="icon" onClick={refresh} disabled={loading} aria-label="Refresh fleet ownership" title="Refresh fleet ownership">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </Button>
    </div>
    {loading && <p role="status" className="text-xs text-muted-foreground">Checking current registrants…</p>}
    {issue && <p role="alert" className="text-xs text-destructive">{issue}</p>}
    {review.map(row => <div key={row.registration} className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2 text-xs">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{row.registration} · {row.registrant_name ?? 'Current public identity unavailable'}</p>
        <p className="text-muted-foreground">FAA release {row.registry_release_date} · {row.faa_hex ?? 'Hex unavailable'}</p>
      </div>
      <Badge variant={hasCurrentKcsoOwnership(row) ? 'secondary' : fleetOwnershipStatus(row) === 'FLEET_LIST_IDENTITY_CONFLICT' ? 'destructive' : 'outline'} className="whitespace-normal">
        {hasCurrentKcsoOwnership(row) ? 'KCSO registrant confirmed' : row.registry_record_scope !== 'CURRENT_RELEASE'
          ? 'Ownership unknown' : fleetOwnershipStatus(row) === 'KERN_COUNTY_REGISTRANT_OPERATOR_CHECK'
          ? 'Kern County registrant · operator check' : row.listed_in_fleet ? 'Fleet tag conflicts with FAA' : 'Other FAA registrant'}
      </Badge>
    </div>)}
    {rows.length > 0 && <p className="text-xs text-muted-foreground">Historical flags and flight patterns retained. Current registration and operational coordination are separate checks.</p>}
  </section>;
}