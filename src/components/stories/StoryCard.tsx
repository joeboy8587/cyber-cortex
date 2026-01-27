import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Plane, Heart, Activity, AlertTriangle, 
  Calendar, Eye, MessageSquare, Shield,
  Camera, Brain, Layers, TrendingUp,
  Target, Zap
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

const factorLabels = {
  1: 'Single Source',
  2: 'Two-Factor Correlation',
  3: 'Three-Factor Convergence',
  4: 'FOUR-FACTOR LOCK'
};

const factorColors = {
  1: 'bg-muted text-muted-foreground',
  2: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  3: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  4: 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
};

export function StoryCard({ story, isActive }: StoryCardProps) {
  const navigate = useNavigate();
  const factorCount = Math.min(story.factorCount, 4) as 1 | 2 | 3 | 4;

  return (
    <div 
      className={`h-full w-full bg-gradient-to-br ${stressGradients[story.stressLevel]} p-6 flex flex-col transition-opacity duration-300 ${
        isActive ? 'opacity-100' : 'opacity-50'
      }`}
    >
      {/* Date Header */}
      <div className="mb-4 pt-12">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-5 w-5 text-white/60" />
          <span className="text-white/60 text-sm">{story.dayName}</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          {story.formattedDate}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge 
            className={`${factorColors[factorCount]} border text-xs font-bold`}
          >
            <Layers className="h-3 w-3 mr-1" />
            {factorLabels[factorCount]}
          </Badge>
          {story.hasKCSO && (
            <Badge className="bg-red-600/30 text-red-300 border border-red-500/50">
              <Shield className="h-3 w-3 mr-1" />
              KCSO DETECTED
            </Badge>
          )}
        </div>
      </div>

      {/* Convergence Score Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-white/60 uppercase tracking-wider">Evidence Convergence</span>
          <span className="text-sm font-bold text-white">{story.convergenceScore}%</span>
        </div>
        <Progress value={story.convergenceScore} className="h-2 bg-black/30" />
      </div>

      {/* Stats Grid - Compact */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-black/30 rounded-xl p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-1">
            <Plane className="h-4 w-4 text-blue-400" />
            <span className="text-white/60 text-xs">Flights</span>
          </div>
          <div className="text-2xl font-bold text-white">{story.flightCount}</div>
          <div className="text-xs text-white/40">{story.uniqueAircraft} unique • {story.lowAltitudeEvents} low-alt</div>
        </div>

        <div className="bg-black/30 rounded-xl p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-1">
            <Heart className="h-4 w-4 text-red-400" />
            <span className="text-white/60 text-xs">Heart Rate</span>
          </div>
          <div className="text-2xl font-bold text-white">{story.peakHeartRate || story.avgHeartRate}</div>
          <div className="text-xs text-white/40">Peak BPM • Avg: {story.avgHeartRate}</div>
        </div>

        <div className="bg-black/30 rounded-xl p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className={`h-4 w-4 ${stressColors[story.stressLevel]}`} />
            <span className="text-white/60 text-xs">Bradford-Hill</span>
          </div>
          <div className={`text-2xl font-bold ${stressColors[story.stressLevel]}`}>
            {story.bradfordHillScore}
          </div>
          <div className="text-xs text-white/40">Causation Score</div>
        </div>

        <div className="bg-black/30 rounded-xl p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-4 w-4 text-amber-400" />
            <span className="text-white/60 text-xs">Fleet Convergence</span>
          </div>
          <div className="text-2xl font-bold text-white">{story.fleetConvergenceCount}</div>
          <div className="text-xs text-white/40">Multi-asset events</div>
        </div>
      </div>

      {/* Evidence Factor Indicators */}
      <div className="flex gap-2 mb-4">
        <div className={`flex-1 rounded-lg p-2 text-center ${story.flightCount > 0 ? 'bg-blue-500/20' : 'bg-black/20'}`}>
          <Plane className={`h-4 w-4 mx-auto mb-1 ${story.flightCount > 0 ? 'text-blue-400' : 'text-white/30'}`} />
          <div className="text-xs text-white/60">Flight</div>
        </div>
        <div className={`flex-1 rounded-lg p-2 text-center ${story.avgHeartRate > 0 ? 'bg-red-500/20' : 'bg-black/20'}`}>
          <Heart className={`h-4 w-4 mx-auto mb-1 ${story.avgHeartRate > 0 ? 'text-red-400' : 'text-white/30'}`} />
          <div className="text-xs text-white/60">Biometric</div>
        </div>
        <div className={`flex-1 rounded-lg p-2 text-center ${story.hasJosiah ? 'bg-purple-500/20' : 'bg-black/20'}`}>
          <Brain className={`h-4 w-4 mx-auto mb-1 ${story.hasJosiah ? 'text-purple-400' : 'text-white/30'}`} />
          <div className="text-xs text-white/60">Josiah</div>
        </div>
        <div className={`flex-1 rounded-lg p-2 text-center ${story.hasOCR ? 'bg-green-500/20' : 'bg-black/20'}`}>
          <Camera className={`h-4 w-4 mx-auto mb-1 ${story.hasOCR ? 'text-green-400' : 'text-white/30'}`} />
          <div className="text-xs text-white/60">OCR</div>
        </div>
      </div>

      {/* Aircraft Badges */}
      {story.topAircraft.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-white/60 mb-2 uppercase tracking-wider">Aircraft Detected</div>
          <div className="flex flex-wrap gap-1">
            {story.topAircraft.map(aircraft => (
              <Badge 
                key={aircraft} 
                variant="outline" 
                className={`text-xs font-mono ${
                  aircraft.includes('N912KC') || aircraft.includes('N913KC') 
                    ? 'bg-red-500/20 border-red-500/50 text-red-300' 
                    : 'bg-black/30 border-white/20 text-white'
                }`}
              >
                {aircraft}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Narrative */}
      <div className="flex-1 flex flex-col justify-end mb-4">
        <div className="bg-black/40 rounded-xl p-4 backdrop-blur-sm mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="h-4 w-4 text-white/60" />
            <span className="text-white/60 text-xs uppercase tracking-wider">
              Event Analysis
            </span>
            {story.factorCount >= 3 && (
              <Zap className="h-4 w-4 text-yellow-400 ml-auto" />
            )}
          </div>
          <p className="text-white/90 text-sm leading-relaxed">
            {story.narrative}
          </p>
        </div>

        {/* Josiah Reflection */}
        {story.josiahReflection && story.hasJosiah && (
          <div className="bg-purple-900/30 rounded-xl p-3 backdrop-blur-sm border border-purple-500/20">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4 text-purple-400" />
              <span className="text-white/60 text-xs uppercase tracking-wider">
                Josiah AI Witness
              </span>
            </div>
            <p className="text-white/70 text-xs italic leading-relaxed line-clamp-3">
              "{story.josiahReflection}"
            </p>
          </div>
        )}
      </div>

      {/* View Details Button */}
      <Button
        onClick={() => navigate(`/?date=${story.date}`)}
        className="w-full bg-white/20 hover:bg-white/30 text-white border-none backdrop-blur-sm"
      >
        <Activity className="h-4 w-4 mr-2" />
        Investigate Full Day
      </Button>
    </div>
  );
}
