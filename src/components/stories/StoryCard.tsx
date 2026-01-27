import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Plane, Heart, Activity, AlertTriangle, 
  Calendar, Eye, MessageSquare
} from 'lucide-react';
import type { DailyStory } from '@/pages/Stories';

interface StoryCardProps {
  story: DailyStory;
  isActive: boolean;
}

const stressGradients = {
  low: 'from-green-900 via-green-800 to-emerald-900',
  moderate: 'from-yellow-900 via-amber-800 to-orange-900',
  high: 'from-orange-900 via-red-800 to-rose-900',
  critical: 'from-red-900 via-purple-900 to-violet-900'
};

const stressColors = {
  low: 'text-green-400',
  moderate: 'text-yellow-400',
  high: 'text-orange-400',
  critical: 'text-red-400'
};

export function StoryCard({ story, isActive }: StoryCardProps) {
  const navigate = useNavigate();

  return (
    <div 
      className={`h-full w-full bg-gradient-to-br ${stressGradients[story.stressLevel]} p-6 flex flex-col transition-opacity duration-300 ${
        isActive ? 'opacity-100' : 'opacity-50'
      }`}
    >
      {/* Date Header */}
      <div className="mb-8 pt-12">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-5 w-5 text-white/60" />
          <span className="text-white/60 text-sm">{story.dayName}</span>
        </div>
        <h1 className="text-4xl font-bold text-white mb-2">
          {story.formattedDate}
        </h1>
        <Badge 
          className={`${stressColors[story.stressLevel]} bg-black/30 border-none text-sm`}
        >
          {story.stressLevel.toUpperCase()} STRESS DAY
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-black/30 rounded-xl p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Plane className="h-5 w-5 text-blue-400" />
            <span className="text-white/60 text-sm">Flights</span>
          </div>
          <div className="text-3xl font-bold text-white">{story.flightCount}</div>
          <div className="text-xs text-white/40">{story.uniqueAircraft} unique aircraft</div>
        </div>

        <div className="bg-black/30 rounded-xl p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="h-5 w-5 text-red-400" />
            <span className="text-white/60 text-sm">Avg Heart Rate</span>
          </div>
          <div className="text-3xl font-bold text-white">{story.avgHeartRate}</div>
          <div className="text-xs text-white/40">BPM</div>
        </div>

        <div className="bg-black/30 rounded-xl p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Activity className={`h-5 w-5 ${stressColors[story.stressLevel]}`} />
            <span className="text-white/60 text-sm">Stress Level</span>
          </div>
          <div className={`text-3xl font-bold ${stressColors[story.stressLevel]}`}>
            {story.avgStress}
          </div>
          <div className="text-xs text-white/40">out of 10</div>
        </div>

        <div className="bg-black/30 rounded-xl p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <span className="text-white/60 text-sm">Alerts</span>
          </div>
          <div className="text-3xl font-bold text-white">{story.alertCount}</div>
          <div className="text-xs text-white/40">triggered</div>
        </div>
      </div>

      {/* Aircraft Badges */}
      {story.topAircraft.length > 0 && (
        <div className="mb-6">
          <div className="text-sm text-white/60 mb-2">Aircraft Detected</div>
          <div className="flex flex-wrap gap-2">
            {story.topAircraft.map(aircraft => (
              <Badge 
                key={aircraft} 
                variant="outline" 
                className="bg-black/30 border-white/20 text-white font-mono"
              >
                {aircraft}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Narrative */}
      <div className="flex-1 flex flex-col justify-end mb-6">
        <div className="bg-black/40 rounded-xl p-4 backdrop-blur-sm mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="h-4 w-4 text-white/60" />
            <span className="text-white/60 text-xs uppercase tracking-wider">
              Daily Summary
            </span>
          </div>
          <p className="text-white/90 text-sm leading-relaxed">
            {story.narrative}
          </p>
        </div>

        {/* Josiah Reflection */}
        {story.josiahReflection && (
          <div className="bg-black/30 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4 text-purple-400" />
              <span className="text-white/60 text-xs uppercase tracking-wider">
                Josiah AI Reflection
              </span>
            </div>
            <p className="text-white/70 text-xs italic leading-relaxed">
              "{story.josiahReflection}..."
            </p>
          </div>
        )}
      </div>

      {/* View Details Button */}
      <Button
        onClick={() => navigate(`/?date=${story.date}`)}
        className="w-full bg-white/20 hover:bg-white/30 text-white border-none backdrop-blur-sm"
      >
        View Full Day Details
      </Button>
    </div>
  );
}
