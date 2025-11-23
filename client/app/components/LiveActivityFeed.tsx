import React, { useEffect, useRef } from 'react';

type LiveActivityFeedProps = {
  status: string;
  logs: string[];
  currentCount: number;
  totalCount: number;
};

export default function LiveActivityFeed({ status, logs, currentCount, totalCount }: LiveActivityFeedProps) {
  // Auto-scroll logic: Keep the view glued to the bottom log
  const bottomRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Calculate percentage safely
  const percent = totalCount > 0 ? Math.round((currentCount / totalCount) * 100) : 0;
  // If we are scraping (total is 0), show an "indeterminate" loading state or just 5%
  const effectivePercent = totalCount === 0 ? 5 : percent;

  return (
    <div className="w-full max-w-lg bg-zinc-800 rounded-lg shadow-xl overflow-hidden border border-zinc-700 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* --- Header: Progress Bar & Status --- */}
      <div className="bg-zinc-900 p-4 border-b border-zinc-700">
        <div className="flex justify-between items-end mb-2">
          <span className="text-stone-100 font-mono text-sm font-bold animate-pulse">
            {'>'} {status}
          </span>
          <span className="text-dark-pastel-green font-mono text-xs">
            {totalCount > 0 ? `${percent}%` : 'initializing...'}
          </span>
        </div>
        
        {/* The Progress Bar Track */}
        <div className="w-full bg-zinc-700 h-2 rounded-full overflow-hidden">
          {/* The Progress Bar Fill */}
          <div 
            className="bg-dark-pastel-green h-full transition-all duration-500 ease-out"
            style={{ width: `${effectivePercent}%` }}
          />
        </div>
      </div>

      {/* --- Body: The Scrolling Logs --- */}
      <div className="p-4 h-64 overflow-y-auto font-mono text-xs space-y-2 bg-zinc-800/50">
        {logs.length === 0 && (
          <p className="text-zinc-500 italic">Waiting for worker...</p>
        )}
        
        {logs.map((log, index) => (
          <div key={index} className="text-stone-300 border-l-2 border-zinc-600 pl-2">
            <span className="text-zinc-500 mr-2">[{index + 1}]</span>
            {log}
          </div>
        ))}
        {/* Invisible element to anchor the scroll */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}