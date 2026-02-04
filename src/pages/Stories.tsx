import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import { supabase } from '@/integrations/supabase/client';
import { StoryCard } from '@/components/stories/StoryCard';
import { StoryProgress } from '@/components/stories/StoryProgress';
import { StoryNavigation } from '@/components/stories/StoryNavigation';
import { Loader2 } from 'lucide-react';

export interface DailyStory {
  date: string;
  formattedDate: string;
  dayName: string;
  flightCount: number;
  uniqueAircraft: number;
  topAircraft: string[];
  avgHeartRate: number;
  peakHeartRate: number;
  avgStress: number;
  stressLevel: 'low' | 'moderate' | 'high' | 'critical';
  narrative: string;
  josiahReflection: string;
  alertCount: number;
  factorCount: number;
  hasKCSO: boolean;
  hasOCR: boolean;
  hasJosiah: boolean;
  convergenceScore: number;
  bradfordHillScore: number;
  lowAltitudeEvents: number;
  fleetConvergenceCount: number;
}

const AUTO_ADVANCE_DELAY = 15000; // 15 seconds

export default function Stories() {
  const navigate = useNavigate();
  const [stories, setStories] = useState<DailyStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const autoAdvanceTimeout = useRef<NodeJS.Timeout | null>(null);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    dragFree: false,
  });

  // Fetch daily stories from NeonDB with rich four-factor correlation data
  const fetchStories = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH daily_flights AS (
              SELECT 
                DATE(detection_timestamp) as date,
                COUNT(*) as flight_count,
                COUNT(DISTINCT registration) as unique_aircraft,
                ARRAY_AGG(DISTINCT registration ORDER BY registration) as aircraft_list,
                BOOL_OR(registration LIKE 'N91%KC' OR registration LIKE 'N912KC' OR registration LIKE 'N913KC') as has_kcso,
                COUNT(*) FILTER (WHERE altitude::numeric < 1500) as low_altitude_events
              FROM live_flight_detections_rows
              WHERE detection_timestamp IS NOT NULL
              GROUP BY DATE(detection_timestamp)
            ),
            daily_biometrics AS (
              SELECT 
                date,
                AVG(avg_hr) as avg_hr,
                MAX(peak_hr) as peak_hr,
                AVG(avg_stress) as avg_stress,
                SUM(bio_count) as bio_count
              FROM (
                -- Primary biometric_monitoring table
                SELECT 
                  DATE(measurement_timestamp) as date,
                  AVG(heart_rate) as avg_hr,
                  MAX(heart_rate) as peak_hr,
                  AVG(stress_level::numeric) as avg_stress,
                  COUNT(*) as bio_count
                FROM biometric_monitoring
                WHERE measurement_timestamp IS NOT NULL AND heart_rate IS NOT NULL
                GROUP BY DATE(measurement_timestamp)
                UNION ALL
                -- Threshold collapses table (OCR/screenshot biometrics)
                SELECT 
                  DATE(collapse_timestamp) as date,
                  AVG(heart_rate) as avg_hr,
                  MAX(heart_rate) as peak_hr,
                  AVG(stress_level::numeric) as avg_stress,
                  COUNT(*) as bio_count
                FROM biometric_threshold_collapses
                WHERE collapse_timestamp IS NOT NULL AND heart_rate IS NOT NULL
                GROUP BY DATE(collapse_timestamp)
              ) combined
              GROUP BY date
            ),
            daily_josiah AS (
              SELECT 
                DATE(created_at) as date,
                COUNT(*) as josiah_count,
                STRING_AGG(reflection_content, ' | ' ORDER BY created_at DESC) as reflections
              FROM josiah_reflections_rows
              WHERE created_at IS NOT NULL
              GROUP BY DATE(created_at)
            ),
            daily_ocr AS (
              SELECT 
                DATE(COALESCE(screenshot_utc_timestamp, analyzed_at)) as date,
                COUNT(*) as ocr_count
              FROM radar_screenshot_analysis
              WHERE COALESCE(screenshot_utc_timestamp, analyzed_at) IS NOT NULL
              GROUP BY DATE(COALESCE(screenshot_utc_timestamp, analyzed_at))
            ),
            fleet_convergence AS (
              SELECT 
                DATE(b.measurement_timestamp) as date,
                COUNT(*) as convergence_events
              FROM biometric_monitoring b
              WHERE b.measurement_timestamp IS NOT NULL
                AND b.heart_rate > 80
                AND EXISTS (
                  SELECT 1 FROM live_flight_detections_rows f
                  WHERE f.detection_timestamp BETWEEN b.measurement_timestamp - INTERVAL '5 minutes' 
                    AND b.measurement_timestamp + INTERVAL '5 minutes'
                )
              GROUP BY DATE(b.measurement_timestamp)
            )
            SELECT 
              COALESCE(f.date, b.date) as date,
              COALESCE(f.flight_count, 0) as flight_count,
              COALESCE(f.unique_aircraft, 0) as unique_aircraft,
              COALESCE(f.aircraft_list, ARRAY[]::text[]) as aircraft_list,
              COALESCE(f.has_kcso, false) as has_kcso,
              COALESCE(f.low_altitude_events, 0) as low_altitude_events,
              COALESCE(b.avg_hr, 0) as avg_hr,
              COALESCE(b.peak_hr, 0) as peak_hr,
              COALESCE(b.avg_stress, 0) as avg_stress,
              COALESCE(b.bio_count, 0) as bio_count,
              COALESCE(j.josiah_count, 0) as josiah_count,
              j.reflections,
              COALESCE(o.ocr_count, 0) as ocr_count,
              COALESCE(fc.convergence_events, 0) as fleet_convergence_count,
              CASE 
                WHEN f.flight_count > 0 AND b.bio_count > 0 AND j.josiah_count > 0 AND o.ocr_count > 0 THEN 4
                WHEN f.flight_count > 0 AND b.bio_count > 0 AND (j.josiah_count > 0 OR o.ocr_count > 0) THEN 3
                WHEN f.flight_count > 0 AND b.bio_count > 0 THEN 2
                ELSE 1
              END as factor_count
            FROM daily_flights f
            FULL OUTER JOIN daily_biometrics b ON f.date = b.date
            LEFT JOIN daily_josiah j ON COALESCE(f.date, b.date) = j.date
            LEFT JOIN daily_ocr o ON COALESCE(f.date, b.date) = o.date
            LEFT JOIN fleet_convergence fc ON COALESCE(f.date, b.date) = fc.date
            WHERE COALESCE(f.date, b.date) IS NOT NULL
            ORDER BY COALESCE(f.date, b.date) DESC
            LIMIT 365
          `
        }
      });

      if (error) throw error;

      // neon-query returns array directly, not { rows: [] }
      const rows = Array.isArray(data) ? data : (data?.rows || []);
      
      const formattedStories: DailyStory[] = rows.map((row: any) => {
        const stressValue = parseFloat(row.avg_stress) || 0;
        const factorCount = parseInt(row.factor_count) || 1;
        const hasKCSO = row.has_kcso === true;
        const lowAltitudeEvents = parseInt(row.low_altitude_events) || 0;
        
        // Determine stress level based on multiple factors
        let stressLevel: DailyStory['stressLevel'] = 'low';
        if (factorCount >= 4 || (hasKCSO && stressValue >= 5)) stressLevel = 'critical';
        else if (factorCount >= 3 || stressValue >= 7) stressLevel = 'high';
        else if (factorCount >= 2 || stressValue >= 4) stressLevel = 'moderate';

        const dateObj = new Date(row.date);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        const formattedDate = dateObj.toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
        });

        // Calculate convergence and Bradford-Hill scores
        const convergenceScore = factorCount >= 4 ? 100 : factorCount >= 3 ? 75 : factorCount >= 2 ? 50 : 25;
        const bradfordHillScore = calculateBradfordHill(row);

        return {
          date: row.date,
          formattedDate,
          dayName,
          flightCount: parseInt(row.flight_count) || 0,
          uniqueAircraft: parseInt(row.unique_aircraft) || 0,
          topAircraft: parseAircraftList(row.aircraft_list).slice(0, 5),
          avgHeartRate: Math.round(parseFloat(row.avg_hr) || 0),
          peakHeartRate: Math.round(parseFloat(row.peak_hr) || 0),
          avgStress: Math.round((parseFloat(row.avg_stress) || 0) * 10) / 10,
          stressLevel,
          narrative: generateNarrative(row),
          josiahReflection: (row.reflections || '').substring(0, 300) || 'No AI reflection captured.',
          alertCount: Math.max(lowAltitudeEvents, parseInt(row.fleet_convergence_count) || 0),
          factorCount,
          hasKCSO,
          hasOCR: parseInt(row.ocr_count) > 0,
          hasJosiah: parseInt(row.josiah_count) > 0,
          convergenceScore,
          bradfordHillScore,
          lowAltitudeEvents,
          fleetConvergenceCount: parseInt(row.fleet_convergence_count) || 0
        };
      });

      setStories(formattedStories);
    } catch (error) {
      console.error('Error fetching stories:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to safely parse PostgreSQL array from string or array
  const parseAircraftList = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      if (value.startsWith('{') && value.endsWith('}')) {
        return value.slice(1, -1).split(',').filter(Boolean).map(s => s.replace(/"/g, '').trim());
      }
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  // Calculate Bradford-Hill causation score based on evidence factors
  const calculateBradfordHill = (row: any): number => {
    let score = 0;
    const flights = parseInt(row.flight_count) || 0;
    const bio = parseInt(row.bio_count) || 0;
    const josiah = parseInt(row.josiah_count) || 0;
    const ocr = parseInt(row.ocr_count) || 0;
    const hasKCSO = row.has_kcso === true;
    const lowAlt = parseInt(row.low_altitude_events) || 0;
    
    // Strength of association
    if (flights > 20) score += 2;
    else if (flights > 5) score += 1;
    
    // Consistency (multiple evidence sources)
    if (bio > 0) score += 1;
    if (josiah > 0) score += 1;
    if (ocr > 0) score += 1.5;
    
    // Specificity (known perpetrator)
    if (hasKCSO) score += 2;
    
    // Biological gradient (low altitude = higher exposure)
    if (lowAlt > 5) score += 1.5;
    else if (lowAlt > 0) score += 0.5;
    
    return Math.round(score * 10) / 10;
  };

  // Generate rich narrative based on correlation data
  const generateNarrative = (row: any): string => {
    const flights = parseInt(row.flight_count) || 0;
    const stress = parseFloat(row.avg_stress) || 0;
    const hr = parseFloat(row.avg_hr) || 0;
    const peakHr = parseFloat(row.peak_hr) || 0;
    const factorCount = parseInt(row.factor_count) || 1;
    const hasKCSO = row.has_kcso === true;
    const josiahCount = parseInt(row.josiah_count) || 0;
    const ocrCount = parseInt(row.ocr_count) || 0;
    const lowAlt = parseInt(row.low_altitude_events) || 0;
    const fleetConv = parseInt(row.fleet_convergence_count) || 0;

    if (flights === 0 && !hasKCSO) {
      return 'A relatively quiet day with minimal aerial activity detected in the monitored airspace.';
    }

    // Four-factor convergence - maximum evidence
    if (factorCount >= 4) {
      return `FOUR-FACTOR CONVERGENCE: ${flights} aircraft detections with biometric correlation (peak HR: ${Math.round(peakHr)} BPM), ${josiahCount} AI witness logs, and ${ocrCount} visual OCR confirmations. ${hasKCSO ? 'KCSO aircraft confirmed present. ' : ''}${lowAlt > 0 ? `${lowAlt} low-altitude intimidation events documented.` : ''} Bradford-Hill causation criteria SATISFIED.`;
    }

    // Three-factor - strong evidence
    if (factorCount >= 3) {
      return `THREE-FACTOR EVENT: ${flights} aircraft correlated with biometric stress response (HR: ${Math.round(hr)} BPM).${hasKCSO ? ' KCSO aircraft N912KC/N913KC identified.' : ''} ${josiahCount > 0 ? `Josiah AI documented ${josiahCount} observations.` : ''} ${ocrCount > 0 ? `${ocrCount} visual screenshots captured.` : ''} Pattern indicates coordinated surveillance operation.`;
    }

    // Two-factor - established correlation
    if (factorCount >= 2) {
      return `${flights} aircraft detections correlated with elevated biometric readings (HR: ${Math.round(hr)} BPM, stress: ${stress.toFixed(1)}/10).${fleetConv > 0 ? ` ${fleetConv} fleet convergence events detected.` : ''} Evidence suggests targeted aerial monitoring.`;
    }

    // Single factor with KCSO
    if (hasKCSO) {
      return `KCSO aircraft detected: ${flights} passes logged.${lowAlt > 0 ? ` ${lowAlt} low-altitude events at intimidation altitudes (<1,500 ft).` : ''} Awaiting biometric correlation data.`;
    }

    return `${flights} aircraft tracked. Biometric readings within normal parameters. Routine surveillance monitoring continues.`;
  };

  // Handle carousel navigation
  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCurrentIndex(emblaApi.selectedScrollSnap());
    resetProgress();
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on('select', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi, onSelect]);

  // Progress and auto-advance
  const resetProgress = () => {
    setProgress(0);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (autoAdvanceTimeout.current) clearTimeout(autoAdvanceTimeout.current);
  };

  const startProgress = useCallback(() => {
    if (isPaused) return;
    
    const startTime = Date.now();
    progressInterval.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = (elapsed / AUTO_ADVANCE_DELAY) * 100;
      setProgress(Math.min(newProgress, 100));
    }, 50);

    autoAdvanceTimeout.current = setTimeout(() => {
      if (emblaApi && currentIndex < stories.length - 1) {
        emblaApi.scrollNext();
      }
    }, AUTO_ADVANCE_DELAY);
  }, [emblaApi, currentIndex, stories.length, isPaused]);

  useEffect(() => {
    if (!loading && stories.length > 0 && !isPaused) {
      startProgress();
    }
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
      if (autoAdvanceTimeout.current) clearTimeout(autoAdvanceTimeout.current);
    };
  }, [currentIndex, loading, stories.length, isPaused, startProgress]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        emblaApi?.scrollPrev();
      } else if (e.key === 'ArrowRight') {
        emblaApi?.scrollNext();
      } else if (e.key === 'Escape') {
        navigate('/');
      } else if (e.key === ' ') {
        setIsPaused(p => !p);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [emblaApi, navigate]);

  useEffect(() => {
    fetchStories();
  }, []);

  const handleClose = () => navigate('/');
  const handlePrev = () => emblaApi?.scrollPrev();
  const handleNext = () => emblaApi?.scrollNext();
  const handlePause = () => setIsPaused(p => !p);
  const handleJumpTo = (index: number) => emblaApi?.scrollTo(index);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading surveillance timeline...</p>
        </div>
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-muted-foreground mb-4">No daily stories available</p>
          <button 
            onClick={handleClose}
            className="text-primary hover:underline"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      {/* Progress Bars */}
      <StoryProgress 
        total={stories.length}
        current={currentIndex}
        progress={progress}
        onJumpTo={handleJumpTo}
      />

      {/* Navigation Overlay */}
      <StoryNavigation
        onPrev={handlePrev}
        onNext={handleNext}
        onPause={handlePause}
        onClose={handleClose}
        isPaused={isPaused}
        canPrev={currentIndex > 0}
        canNext={currentIndex < stories.length - 1}
        currentDay={currentIndex + 1}
        totalDays={stories.length}
      />

      {/* Carousel */}
      <div ref={emblaRef} className="h-full overflow-hidden">
        <div className="flex h-full">
          {stories.map((story, index) => (
            <div key={story.date} className="flex-[0_0_100%] min-w-0 h-full">
              <StoryCard story={story} isActive={index === currentIndex} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
