import React from 'react';
import { X, Pause, Play, ChevronLeft, ChevronRight } from 'lucide-react';

interface StoryNavigationProps {
  onPrev: () => void;
  onNext: () => void;
  onPause: () => void;
  onClose: () => void;
  isPaused: boolean;
  canPrev: boolean;
  canNext: boolean;
  currentDay: number;
  totalDays: number;
}

export function StoryNavigation({
  onPrev,
  onNext,
  onPause,
  onClose,
  isPaused,
  canPrev,
  canNext,
  currentDay,
  totalDays
}: StoryNavigationProps) {
  return (
    <>
      {/* Top Right Controls */}
      <div className="fixed top-8 right-4 z-50 flex items-center gap-2">
        {/* Day Counter */}
        <div className="bg-black/40 backdrop-blur-sm rounded-full px-3 py-1 text-white text-sm">
          Day {currentDay} of {totalDays}
        </div>
        
        {/* Pause/Play Button */}
        <button
          onClick={onPause}
          className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          aria-label={isPaused ? 'Play' : 'Pause'}
        >
          {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Invisible Tap Zones */}
      <div className="fixed inset-0 z-40 flex pointer-events-none">
        {/* Left Third - Previous */}
        <button
          onClick={onPrev}
          disabled={!canPrev}
          className="w-1/3 h-full pointer-events-auto cursor-pointer group"
          aria-label="Previous day"
        >
          <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <ChevronLeft className="h-6 w-6 text-white" />
            </div>
          </div>
          {/* Flash effect on tap */}
          <div className="absolute inset-0 bg-white/0 group-active:bg-white/10 transition-colors duration-75" />
        </button>

        {/* Center Third - Pause (handled by dedicated button) */}
        <div className="w-1/3 h-full pointer-events-auto" onClick={onPause} />

        {/* Right Third - Next */}
        <button
          onClick={onNext}
          disabled={!canNext}
          className="w-1/3 h-full pointer-events-auto cursor-pointer group"
          aria-label="Next day"
        >
          <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <ChevronRight className="h-6 w-6 text-white" />
            </div>
          </div>
          {/* Flash effect on tap */}
          <div className="absolute inset-0 bg-white/0 group-active:bg-white/10 transition-colors duration-75" />
        </button>
      </div>

      {/* Keyboard Hints (desktop only) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 hidden md:flex items-center gap-4 text-white/40 text-xs">
        <span>← Previous</span>
        <span>Space: Pause</span>
        <span>→ Next</span>
        <span>Esc: Close</span>
      </div>
    </>
  );
}
