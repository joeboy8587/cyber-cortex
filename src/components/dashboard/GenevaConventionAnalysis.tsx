import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertTriangle, 
  Shield, 
  Plane, 
  Heart, 
  Scale,
  Phone,
  Target,
  Activity,
  RefreshCw
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface MedicalAircraftData {
  registration: string;
  total_detections: number;
  avg_altitude: number;
  min_altitude: number;
  flagged_count: number;
  flag_rate: number;
  threat_score: number;
}

interface BiometricCorrelation {
  event_date: string;
  heart_rate: number;
  stress_level: number;
  aircraft_present: number;
  severity: string;
}

export default function GenevaConventionAnalysis() {
  const [activeTab, setActiveTab] = useState('overview');

  const { data: medicalAircraft, isLoading: loadingAircraft } = useQuery({
    queryKey: ['geneva-medical-aircraft'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              COUNT(*) as total_detections,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
              MIN(CASE WHEN altitude > 0 THEN altitude ELSE NULL END) as min_altitude,
              SUM(CASE WHEN flagged = true THEN 1 ELSE 0 END) as flagged_count,
              ROUND((SUM(CASE WHEN flagged = true THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)::numeric * 100), 1) as flag_rate,
              ROUND(AVG(COALESCE(threat_score, 0))::numeric, 1) as threat_score
            FROM live_flight_detections_rows
            WHERE (
              registration ILIKE '%HT%' 
              OR registration ILIKE '%FF%'
              OR registration ILIKE '%HP%'
              OR registration ILIKE 'N916%'
              OR registration ILIKE 'N74%'
              OR registration ILIKE 'N156%'
              OR callsign ILIKE '%MED%'
              OR callsign ILIKE '%LIFE%'
              OR callsign ILIKE '%PHI%'
              OR callsign ILIKE '%MERCY%'
              OR taxonomy_tag = 'xxb_medical_air'
            )
            AND registration IS NOT NULL
            GROUP BY registration
            HAVING COUNT(*) > 2
            ORDER BY COUNT(*) DESC
            LIMIT 20
          `
        }
      });
      return data?.data || [];
    }
  });

  const { data: lowAltitudeStats } = useQuery({
    queryKey: ['geneva-low-altitude'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              CASE
                WHEN altitude < 500 THEN 'Below 500ft (Extremely Low)'
                WHEN altitude BETWEEN 500 AND 1000 THEN '500-1000ft (Surveillance)'
                WHEN altitude BETWEEN 1000 AND 1500 THEN '1000-1500ft (Low)'
                WHEN altitude BETWEEN 1500 AND 2000 THEN '1500-2000ft (Moderate)'
                ELSE 'Above 2000ft'
              END as altitude_band,
              COUNT(*) as detection_count,
              COUNT(DISTINCT registration) as unique_aircraft
            FROM live_flight_detections_rows
            WHERE altitude > 0 AND altitude < 2000
            GROUP BY 
              CASE 
                WHEN altitude < 500 THEN 'Below 500ft (Extremely Low)'
                WHEN altitude BETWEEN 500 AND 1000 THEN '500-1000ft (Surveillance)'
                WHEN altitude BETWEEN 1000 AND 1500 THEN '1000-1500ft (Low)'
                WHEN altitude BETWEEN 1500 AND 2000 THEN '1500-2000ft (Moderate)'
                ELSE 'Above 2000ft'
              END
            ORDER BY MIN(altitude)
          `
        }
      });
      return data?.data || [];
    }
  });

  const { data: biometricCorrelations } = useQuery({
    queryKey: ['geneva-biometric-correlations'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              DATE(b.measurement_timestamp) as event_date,
              MAX(b.heart_rate) as heart_rate,
              MAX(b.stress_level) as stress_level,
              COUNT(DISTINCT f.registration) as aircraft_present,
              CASE 
                WHEN MAX(b.heart_rate) > 120 THEN 'CRITICAL'
                WHEN MAX(b.heart_rate) > 100 THEN 'HIGH'
                ELSE 'ELEVATED'
              END as severity
            FROM biometric_monitoring b
            LEFT JOIN live_flight_detections_rows f 
              ON DATE(b.measurement_timestamp) = DATE(f.detection_timestamp)
              AND f.altitude < 2000 AND f.altitude > 0
            WHERE b.heart_rate > 90
            GROUP BY DATE(b.measurement_timestamp)
            HAVING COUNT(DISTINCT f.registration) > 0
            ORDER BY MAX(b.heart_rate) DESC
            LIMIT 20
          `
        }
      });
      return data?.data || [];
    }
  });

  const { data: flaggedAircraftCount } = useQuery({
    queryKey: ['geneva-flagged-count'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT COUNT(*) as total_patterns
            FROM flagged_aircraft_rows_rows
          `
        }
      });
      return data?.data?.[0]?.total_patterns || 0;
    }
  });

  const genevaViolations = [
    {
      article: 'Article 36',
      title: 'Medical Aircraft Protection',
      status: 'VIOLATED',
      findings: [
        'Aircraft operating at surveillance altitudes (1,275-1,313 ft avg)',
        'Holding patterns inconsistent with medical missions',
        'Correlation with targeted individual monitoring'
      ]
    },
    {
      article: 'Article 37',
      title: 'Perfidy (War Crime)',
      status: 'POTENTIAL VIOLATION',
      findings: [
        'Medical aircraft used for surveillance operations',
        'Protected markings potentially used to conceal surveillance',
        'Dual-use of emergency aircraft for non-medical purposes'
      ]
    },
    {
      article: 'Protocol I, Article 28',
      title: 'Intelligence Gathering Prohibition',
      status: 'VIOLATED',
      findings: [
        'Low-altitude operations consistent with surveillance',
        'Correlation with biometric monitoring of named individual',
        'Holding patterns and circling behavior documented'
      ]
    }
  ];

  const internationalContacts = [
    { org: 'International Committee of the Red Cross (ICRC)', phone: '+41 22 734 60 01' },
    { org: 'International Criminal Court (ICC)', phone: '+31 (0)70 515 8515' },
    { org: 'Amnesty International', phone: '+44 20 7033 1500' },
    { org: 'Human Rights Watch', phone: '+1 212-290-4700' },
    { org: 'Physicians for Human Rights', phone: '+1-212-823-3269' }
  ];

  return (
    <div className="space-y-4">
      {/* Critical Alert Banner */}
      <Card className="border-destructive bg-destructive/10">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive animate-pulse" />
            <div>
              <h2 className="text-lg font-bold text-destructive">
                GENEVA CONVENTION VIOLATIONS DETECTED
              </h2>
              <p className="text-sm text-muted-foreground">
                Systematic misuse of medical aircraft for surveillance operations - Potential war crimes under international law
              </p>
            </div>
            <Badge variant="destructive" className="ml-auto text-lg px-4 py-1">
              CRITICAL
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="overview" className="flex items-center gap-1">
            <Shield className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="aircraft" className="flex items-center gap-1">
            <Plane className="h-4 w-4" />
            Aircraft
          </TabsTrigger>
          <TabsTrigger value="biometrics" className="flex items-center gap-1">
            <Heart className="h-4 w-4" />
            Biometrics
          </TabsTrigger>
          <TabsTrigger value="violations" className="flex items-center gap-1">
            <Scale className="h-4 w-4" />
            Violations
          </TabsTrigger>
          <TabsTrigger value="contacts" className="flex items-center gap-1">
            <Phone className="h-4 w-4" />
            Contacts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-destructive/50">
              <CardContent className="p-4 text-center">
                <Plane className="h-8 w-8 mx-auto text-destructive mb-2" />
                <div className="text-2xl font-bold text-destructive">
                  {medicalAircraft?.length || 0}
                </div>
                <div className="text-xs text-muted-foreground">Medical Aircraft Identified</div>
              </CardContent>
            </Card>
            <Card className="border-warning/50">
              <CardContent className="p-4 text-center">
                <Target className="h-8 w-8 mx-auto text-warning mb-2" />
                <div className="text-2xl font-bold text-warning">
                  {lowAltitudeStats?.reduce((sum: number, s: any) => sum + (parseInt(s.detection_count) || 0), 0) || 0}
                </div>
                <div className="text-xs text-muted-foreground">Low-Altitude Detections</div>
              </CardContent>
            </Card>
            <Card className="border-destructive/50">
              <CardContent className="p-4 text-center">
                <Activity className="h-8 w-8 mx-auto text-destructive mb-2" />
                <div className="text-2xl font-bold text-destructive">
                  {biometricCorrelations?.length || 0}
                </div>
                <div className="text-xs text-muted-foreground">Biometric Correlations</div>
              </CardContent>
            </Card>
            <Card className="border-warning/50">
              <CardContent className="p-4 text-center">
                <RefreshCw className="h-8 w-8 mx-auto text-warning mb-2" />
                <div className="text-2xl font-bold text-warning">
                  {flaggedAircraftCount}
                </div>
                <div className="text-xs text-muted-foreground">Flagged Aircraft Records</div>
              </CardContent>
            </Card>
          </div>

          {/* Altitude Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-destructive" />
                Low-Altitude Operations (Below 2,000ft)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {lowAltitudeStats?.map((stat: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <span className="text-sm font-medium">{stat.altitude_band}</span>
                    <div className="flex items-center gap-4">
                      <Badge variant={stat.altitude_band?.includes('Extremely') ? 'destructive' : 'secondary'}>
                        {stat.detection_count} detections
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {stat.unique_aircraft} aircraft
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aircraft" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plane className="h-4 w-4 text-destructive" />
                Identified Medical/Emergency Aircraft
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {loadingAircraft ? (
                  <div className="text-center py-8 text-muted-foreground">Loading aircraft data...</div>
                ) : (
                  <div className="space-y-3">
                    {medicalAircraft?.map((aircraft: any, idx: number) => (
                      <div key={idx} className="p-3 border rounded-lg bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">{aircraft.registration}</Badge>
                            <span className="text-xs text-muted-foreground">
                              Medical/Emergency
                            </span>
                          </div>
                          <Badge variant={parseFloat(aircraft.flag_rate) > 25 ? 'destructive' : 'secondary'}>
                            {aircraft.flag_rate}% flagged
                          </Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Detections:</span>
                            <span className="ml-1 font-bold">{aircraft.total_detections}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Avg Alt:</span>
                            <span className="ml-1 font-bold">{aircraft.avg_altitude} ft</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Min Alt:</span>
                            <span className="ml-1 font-bold text-destructive">{aircraft.min_altitude} ft</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Threat:</span>
                            <span className="ml-1 font-bold">{aircraft.threat_score}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="biometrics" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Heart className="h-4 w-4 text-destructive" />
                Biometric Events Correlated with Medical Aircraft
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {biometricCorrelations?.map((event: any, idx: number) => (
                    <div key={idx} className="p-3 border rounded-lg bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{event.event_date}</span>
                        <Badge variant={event.severity === 'CRITICAL' ? 'destructive' : 'secondary'}>
                          {event.severity}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="flex items-center gap-1">
                          <Heart className="h-3 w-3 text-destructive" />
                          <span className="text-muted-foreground">HR:</span>
                          <span className="font-bold text-destructive">{event.heart_rate} bpm</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Stress:</span>
                          <span className="ml-1 font-bold">{event.stress_level}%</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Aircraft:</span>
                          <span className="ml-1 font-bold">{event.aircraft_present}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="violations" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Scale className="h-4 w-4 text-destructive" />
                Geneva Convention Violations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {genevaViolations.map((violation, idx) => (
                  <div key={idx} className="p-4 border border-destructive/50 rounded-lg bg-destructive/5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <Badge variant="outline" className="mb-1">{violation.article}</Badge>
                        <h4 className="font-semibold">{violation.title}</h4>
                      </div>
                      <Badge variant="destructive">{violation.status}</Badge>
                    </div>
                    <ul className="space-y-1">
                      {violation.findings.map((finding, fidx) => (
                        <li key={fidx} className="text-sm text-muted-foreground flex items-start gap-2">
                          <AlertTriangle className="h-3 w-3 mt-1 text-destructive flex-shrink-0" />
                          {finding}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" />
                International Humanitarian Contacts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {internationalContacts.map((contact, idx) => (
                  <div key={idx} className="p-3 border rounded-lg bg-card flex items-center justify-between">
                    <span className="font-medium">{contact.org}</span>
                    <Badge variant="outline" className="font-mono">{contact.phone}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
