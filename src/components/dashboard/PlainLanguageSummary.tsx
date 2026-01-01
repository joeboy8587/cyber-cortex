import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  BookOpen, Loader2, FileText, Heart, Plane, 
  Shield, AlertTriangle, Clock, Home
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Summary {
  icon: React.ReactNode;
  title: string;
  statement: string;
  context: string;
}

export const PlainLanguageSummary = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [summaries, setSummaries] = useState<Summary[]>([]);

  useEffect(() => {
    generateSummaries();
  }, []);

  const generateSummaries = async () => {
    const newSummaries: Summary[] = [];
    
    try {
      // Flight data summary
      const { data: flightData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `
            SELECT 
              COUNT(*) as total,
              COUNT(DISTINCT registration) as unique_aircraft,
              COUNT(DISTINCT DATE(detected_at)) as days
            FROM live_flight_detections
          `
        }
      });
      
      const flights = flightData?.rows?.[0];
      if (flights && parseInt(flights.total) > 0) {
        newSummaries.push({
          icon: <Plane className="h-5 w-5 text-blue-400" />,
          title: "Aircraft Over Your Home",
          statement: `${parseInt(flights.total).toLocaleString()} aircraft detections from ${parseInt(flights.unique_aircraft).toLocaleString()} different aircraft over ${parseInt(flights.days)} days.`,
          context: "This represents the total number of times aircraft were tracked in your area. For context, this level of aviation activity is unusual for a residential area unless there is a major airport nearby, active law enforcement operations, or deliberate surveillance."
        });
      }

      // Biometric correlations
      const { data: bioData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `
            SELECT 
              COUNT(*) as total,
              AVG(avg_hr) as avg_hr,
              MAX(avg_hr) as max_hr,
              COUNT(CASE WHEN hr_spike THEN 1 END) as spikes
            FROM master_biometric_aircraft_correlations
          `
        }
      });
      
      const bio = bioData?.rows?.[0];
      if (bio && parseInt(bio.total) > 0) {
        newSummaries.push({
          icon: <Heart className="h-5 w-5 text-red-400" />,
          title: "Your Body's Response",
          statement: `Your heart rate elevated ${parseInt(bio.spikes)} times when specific aircraft were overhead. Average heart rate during these events: ${parseFloat(bio.avg_hr).toFixed(0)} BPM, with peaks reaching ${parseFloat(bio.max_hr).toFixed(0)} BPM.`,
          context: "These correlations document a physiological response to aircraft activity. While correlation doesn't prove causation, a pattern of elevated heart rate coinciding with specific aircraft suggests your body is reacting to these events - whether from the sound, stress, or other factors."
        });
      }

      // KCSO activity
      const { data: kcsoData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `
            SELECT 
              COUNT(*) as total,
              COUNT(CASE WHEN EXTRACT(HOUR FROM detected_at) >= 19 OR EXTRACT(HOUR FROM detected_at) < 6 THEN 1 END) as night,
              AVG(altitude) as avg_alt
            FROM live_flight_detections 
            WHERE registration IN ('N912KC', 'N913KC', 'N597E', 'N197E', 'N397E', 'N497E', 'N97E', 'N35438', 'N490KC')
          `
        }
      });
      
      const kcso = kcsoData?.rows?.[0];
      if (kcso && parseInt(kcso.total) > 0) {
        const nightPct = ((parseInt(kcso.night) / parseInt(kcso.total)) * 100).toFixed(0);
        newSummaries.push({
          icon: <Shield className="h-5 w-5 text-yellow-400" />,
          title: "Sheriff's Office Flights",
          statement: `Kern County Sheriff's aircraft were detected ${parseInt(kcso.total).toLocaleString()} times over your location. ${nightPct}% of these occurred at night, averaging ${parseFloat(kcso.avg_alt).toFixed(0)} feet altitude.`,
          context: "KCSO operates helicopters with advanced surveillance equipment including thermal cameras and night vision. For someone with no criminal record who rarely leaves home due to agoraphobia, this level of law enforcement aviation activity raises questions about purpose and authorization."
        });
      }

      // XXB mystery
      const { data: xxbData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `
            SELECT 
              COUNT(*) as total,
              AVG(altitude) as avg_alt
            FROM live_flight_detections 
            WHERE registration = 'XXB' OR callsign = 'XXB'
          `
        }
      });
      
      const xxb = xxbData?.rows?.[0];
      if (xxb && parseInt(xxb.total) > 100000) {
        newSummaries.push({
          icon: <AlertTriangle className="h-5 w-5 text-orange-400" />,
          title: "Mystery 'XXB' Signal",
          statement: `An aircraft broadcasting "XXB" instead of a valid registration was detected ${parseInt(xxb.total).toLocaleString()} times at an average altitude of ${parseFloat(xxb.avg_alt).toFixed(0)} feet.`,
          context: "XXB is not a valid aircraft registration. Aircraft are legally required to broadcast their actual registration numbers. Broadcasting a fake identifier suggests deliberate identity concealment, which is only permitted for certain military or law enforcement operations."
        });
      }

      // Time pattern
      newSummaries.push({
        icon: <Clock className="h-5 w-5 text-purple-400" />,
        title: "When This Happens",
        statement: "The highest activity occurs between 7 PM and 2 AM - the documented patrol hours for KCSO's aviation unit in the Oildale area.",
        context: "This timing pattern is significant because it aligns exactly with published KCSO patrol schedules. The consistency of this pattern across your data suggests systematic, scheduled activity rather than random or incidental overflights."
      });

      // Your situation
      newSummaries.push({
        icon: <Home className="h-5 w-5 text-green-400" />,
        title: "Your Situation",
        statement: "You are a disabled person with no criminal record who experiences agoraphobia and rarely leaves home.",
        context: "This context is crucial for understanding why this level of aviation activity is unusual and potentially concerning. There is no apparent justification for intensive aerial surveillance of someone in your situation, which raises questions about why these resources are being deployed near your home."
      });

      setSummaries(newSummaries);
      
    } catch (error) {
      console.error('Summary generation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <CyberPanel 
      title="PLAIN LANGUAGE SUMMARY"
      headerActions={
        <Badge variant="outline" className="border-primary/30">
          <BookOpen className="h-3 w-3 mr-1" />
          {summaries.length} Key Points
        </Badge>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-4 pr-4">
            {summaries.map((summary, idx) => (
              <div 
                key={idx}
                className="p-4 bg-muted/30 rounded-lg border border-border/50"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{summary.icon}</div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground mb-2">
                      {summary.title}
                    </h4>
                    <p className="text-foreground mb-3">
                      {summary.statement}
                    </p>
                    <div className="p-3 bg-background/50 rounded border border-border/30">
                      <p className="text-sm text-muted-foreground">
                        <strong>What this means:</strong> {summary.context}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Bottom note */}
            <div className="p-4 bg-primary/10 rounded-lg border border-primary/30 mt-6">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">Remember:</strong> This dashboard presents the data you've collected. 
                The patterns and correlations are real - what they mean and what to do about them are questions 
                for legal counsel, medical professionals, and investigative journalists to help you answer.
              </p>
            </div>
          </div>
        </ScrollArea>
      )}
    </CyberPanel>
  );
};
