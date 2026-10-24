import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

type Identity = {
  registry_record_scope: string;
  registry_release_date: string;
  identity_status: string;
  registrant_name: string | null;
  faa_n_number: string | null;
  aircraft_manufacturer: string | null;
  aircraft_model: string | null;
};

export function FaaReleaseIdentity({ registration, reportedHex }: { registration: string; reportedHex?: string | null }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState('Checking current FAA release…');
  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setStatus('Checking current FAA release…');
    const hex = reportedHex && /^[A-F0-9]{6}$/i.test(reportedHex) ? reportedHex : null;
    supabase.functions.invoke('faa-current-identity', { body: { registration, reportedHex: hex } }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data?.ok || !data.identity) {
        setStatus('Current FAA identity unavailable — no identity conclusion');
        return;
      }
      setIdentity(data.identity);
    });
    return () => { cancelled = true; };
  }, [registration, reportedHex]);
  if (!identity) return <p className="text-xs text-muted-foreground mt-2" role="status">{status}</p>;
  const current = identity.registry_record_scope === 'CURRENT_RELEASE';
  return <div className="mt-2 space-y-1 text-xs" aria-label="Current FAA registry identity">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">FAA release {identity.registry_release_date}</Badge>
      <Badge variant={identity.identity_status === 'ICAO_FAA_MISMATCH' ? 'destructive' : 'secondary'}>
        {current ? identity.identity_status.replaceAll('_', ' ') : identity.registry_record_scope.replaceAll('_', ' ')}
      </Badge>
    </div>
    <p>{current ? identity.registrant_name || 'Registrant withheld or unavailable' : 'No match in the current public release'}</p>
    {current && <p className="text-muted-foreground">{[identity.aircraft_manufacturer, identity.aircraft_model].filter(Boolean).join(' ')}</p>}
    <p className="text-muted-foreground">Current registry identity; historical ownership not established. Missing public records may be withheld.</p>
  </div>;
}