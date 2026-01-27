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
  avgStress: number;
  stressLevel: 'low' | 'moderate' | 'high' | 'critical';
  narrative: string;
  josiahReflection: string;
  alertCount: number;
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

  // Fetch daily stories from NeonDB
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
                ARRAY_AGG(DISTINCT registration ORDER BY registration) as aircraft_list
              FROM live_flight_detections_rows
              WHERE detection_timestamp > NOW() - INTERVAL '60 days'
              GROUP BY DATE(detection_timestamp)
            ),
            daily_biometrics AS (
              SELECT 
                DATE(measurement_timestamp) as date,
                AVG(heart_rate) as avg_hr,
                AVG(stress_level) as avg_stress
              FROM biometric_monitoring
              WHERE measurement_timestamp > NOW() - INTERVAL '60 days'
              GROUP BY DATE(measurement_timestamp)
            ),
            daily_josiah AS (
              SELECT 
                DATE(created_at) as date,
                STRING_AGG(reflection_content, ' | ' ORDER BY created_at DESC) as reflections
              FROM josiah_reflections_rows
              WHERE created_at > NOW() - INTERVAL '60 days'
              GROUP BY DATE(created_at)
            )
            SELECT 
              COALESCE(f.date, b.date) as date,
              COALESCE(f.flight_count, 0) as flight_count,
              COALESCE(f.unique_aircraft, 0) as unique_aircraft,
              COALESCE(f.aircraft_list, ARRAY[]::text[]) as aircraft_list,
              COALESCE(b.avg_hr, 0) as avg_hr,
              COALESCE(b.avg_stress, 0) as avg_stress,
              j.reflections
            FROM daily_flights f
            FULL OUTER JOIN daily_biometrics b ON f.date = b.date
            LEFT JOIN daily_josiah j ON COALESCE(f.date, b.date) = j.date
            WHERE COALESCE(f.date, b.date) IS NOT NULL
            ORDER BY COALESCE(f.date, b.date) DESC
            LIMIT 30
          `
        }
      });

      if (error) throw error;

      const formattedStories: DailyStory[] = (data?.rows || []).map((row: any) => {
        const stressValue = parseFloat(row.avg_stress) || 0;
        let stressLevel: DailyStory['stressLevel'] = 'low';
        if (stressValue >= 7) stressLevel = 'critical';
        else if (stressValue >= 5) stressLevel = 'high';
        else if (stressValue >= 3) stressLevel = 'moderate';

        const dateObj = new Date(row.date);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        const formattedDate = dateObj.toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
        });

        return {
          date: row.date,
          formattedDate,
          dayName,
          flightCount: parseInt(row.flight_count) || 0,
          uniqueAircraft: parseInt(row.unique_aircraft) || 0,
          topAircraft: (row.aircraft_list || []).slice(0, 5),
          avgHeartRate: Math.round(parseFloat(row.avg_hr) || 0),
          avgStress: Math.round((parseFloat(row.avg_stress) || 0) * 10) / 10,
          stressLevel,
          narrative: generateNarrative(row),
          josiahReflection: (row.reflections || 'No Josiah reflection for this day.').substring(0, 200),
          alertCount: Math.floor(Math.random() * 5) // Placeholder - would come from alerts table
        };
      });

      setStories(formattedStories);
    } catch (error) {
      console.error('Error fetching stories:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateNarrative = (row: any): string => {
    const flights = parseInt(row.flight_count) || 0;
    const stress = parseFloat(row.avg_stress) || 0;
    const hr = parseFloat(row.avg_hr) || 0;

    if (flights === 0) {
      return 'A relatively quiet day with minimal aerial activity detected in the monitored airspace.';
    }

    if (stress >= 7) {
      return `Critical stress day. ${flights} aircraft detections correlated with elevated biometric readings (HR: ${Math.round(hr)} BPM). Pattern suggests coordinated surveillance activity.`;
    }

    if (stress >= 5) {
      return `High activity day with ${flights} flight detections. Biometric indicators show elevated stress response. Multiple aircraft patterns observed.`;
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
