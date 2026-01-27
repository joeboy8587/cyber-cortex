import React from 'react';

interface StoryProgressProps {
  total: number;
  current: number;
  progress: number;
  onJumpTo: (index: number) => void;
}

export function StoryProgress({ total, current, progress, onJumpTo }: StoryProgressProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-3 flex gap-1">
      {Array.from({ length: total }).map((_, index) => (
        <button
          key={index}
          onClick={() => onJumpTo(index)}
          className="flex-1 h-1 rounded-full overflow-hidden bg-white/30 hover:bg-white/40 transition-colors"
          aria-label={`Jump to day ${index + 1}`}
        >
          <div 
            className="h-full bg-white rounded-full transition-all duration-100"
            style={{ 
              width: index < current 
                ? '100%' 
                : index === current 
                  ? `${progress}%` 
                  : '0%' 
            }}
          />
        </button>
      ))}
    </div>
  );
}
