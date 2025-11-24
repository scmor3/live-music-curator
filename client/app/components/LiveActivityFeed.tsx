import React, { useEffect, useRef, useState } from 'react';

type LiveActivityFeedProps = {
  status: string;
  logs: string[];
  totalCount: number;
  playlistId?: string;
  errorMessage?: string;
  onReset: () => void;
};

export default function LiveActivityFeed({ 
  status, 
  logs, 
  totalCount, 
  playlistId, 
  errorMessage, 
  onReset 
}: LiveActivityFeedProps) {
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
  
  // Queue Logic
  const queueRef = useRef<string[]>([]);
  const processedIndexRef = useRef(0);
  const [isQueueEmpty, setIsQueueEmpty] = useState(true);

  // 1. HYPE CYCLE
  const [hypeText, setHypeText] = useState('Initializing scraper...');
  useEffect(() => {
    if (visibleLogs.length > 0) return; 

    const hypeMessages = [
      'Tuning the guitars...',
      'Checking sound levels...',
      'Scouting local venues...',
      'Waking up the drummer...',
      'Finding the hidden gems...'
    ];
    let i = 0;
    const interval = setInterval(() => {
      setHypeText(hypeMessages[i % hypeMessages.length]);
      i++;
    }, 2000); 

    return () => clearInterval(interval);
  }, [visibleLogs.length]);

  // 2. INGESTION (Modified for Instant Load)
  useEffect(() => {
    // Reset Logic
    if (logs.length === 0) {
      setVisibleLogs([]);
      queueRef.current = [];
      processedIndexRef.current = 0;
      return;
    }

    // New Items Logic
    if (logs.length > processedIndexRef.current) {
      const newItems = logs.slice(processedIndexRef.current);
      
      // LOGIC BRANCH:
      // If the job is ALREADY complete (Cache Hit), show everything immediately.
      // Otherwise, add to the queue for the "drip" effect.
      if (status === 'complete') {
        setVisibleLogs((prev) => [...prev, ...newItems]);
        queueRef.current = []; // Clear queue to be safe
        setIsQueueEmpty(true);
      } else {
        queueRef.current.push(...newItems);
        setIsQueueEmpty(false);
      }
      
      processedIndexRef.current = logs.length;
    }
  }, [logs, status]);

  // 3. FLUSH ON COMPLETE (New)
  // If the job finishes while we still have items in the queue (e.g. normal run finishing),
  // dump them all instantly so the user doesn't have to wait.
  useEffect(() => {
    if (status === 'complete' && queueRef.current.length > 0) {
      setVisibleLogs((prev) => [...prev, ...queueRef.current]);
      queueRef.current = [];
      setIsQueueEmpty(true);
    }
  }, [status]);

  // 4. THE DRIP
  useEffect(() => {
    const interval = setInterval(() => {
      if (queueRef.current.length > 0) {
        const nextLog = queueRef.current.shift();
        if (nextLog) {
          setVisibleLogs((prev) => [...prev, nextLog]);
        }
      } else {
        setIsQueueEmpty(true);
      }
    }, 400); 

    return () => clearInterval(interval);
  }, []);

  // 5. SMART AUTO-SCROLL
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    if (isNearBottom) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 0);
    }
  }, [visibleLogs, isQueueEmpty]);


  // --- VISUAL CALCULATIONS ---
  const displayCount = visibleLogs.length;
  
  const percent = (status === 'complete') 
    ? 100 
    : (totalCount > 0 ? Math.round((displayCount / totalCount) * 100) : 0);
    
  const effectivePercent = totalCount === 0 ? 5 : percent;

  const isComplete = status === 'complete' && !!playlistId;
  const isFailed = status === 'failed' || !!errorMessage;

  return (
    <div className="w-full max-w-lg bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden border border-zinc-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* --- HEADER --- */}
      <div className={`p-4 sm:p-6 pb-8 text-center relative transition-colors duration-700 ${
        isComplete ? 'bg-zinc-800' : isFailed ? 'bg-red-900/20' : 'bg-night-blue'
      }`}>
        
        {isComplete ? (
          <div className="animate-in zoom-in duration-500">
            <h2 className="text-2xl font-bold text-dark-pastel-green mb-2">Playlist Ready!</h2>
            <div className="flex flex-col gap-3 mt-4">
              <a 
                href={`https://open.spotify.com/playlist/${playlistId}`}
                target="_blank" 
                rel="noopener noreferrer"
                // OLD: className="py-3 px-6 ..."
                // NEW: Added 'w-full sm:w-auto' for full width tap target on mobile
                className="py-3 px-6 w-full sm:w-auto bg-dark-pastel-green text-zinc-900 font-bold rounded-full hover:bg-green-400 transition-transform hover:scale-105 shadow-lg"
              >
                Open in Spotify
              </a>
              <button 
                onClick={onReset}
                className="text-zinc-400 text-sm hover:text-white underline decoration-zinc-600 underline-offset-4"
              >
                Make another playlist
              </button>
            </div>
          </div>
        ) : isFailed ? (
          <div className="animate-in shake">
            <h2 className="text-xl font-bold text-red-400 mb-1">Curation Failed</h2>
            <p className="text-red-200 text-sm mb-4">{errorMessage || 'Something went wrong.'}</p>
            <button onClick={onReset} className="px-4 py-2 bg-zinc-700 rounded-lg text-white hover:bg-zinc-600">
              Try Again
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-pastel-yellow mb-1 tracking-wide animate-pulse">
              {status === 'pending' ? 'Queueing...' : 'Curating...'}
            </h2>
            <p className="text-zinc-400 text-sm mb-4">
              {totalCount > 0 
                ? `Processed ${displayCount} of ${totalCount} artists` 
                : hypeText}
            </p>

            <div className="w-full max-w-[16rem] h-2 bg-zinc-700/50 rounded-full mx-auto overflow-hidden relative">
              <div 
                className="bg-dark-pastel-green h-full transition-all duration-300 ease-out rounded-full shadow-[0_0_10px_rgba(74,222,128,0.5)]"
                style={{ width: `${effectivePercent}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* --- LOG BODY --- */}
      <div 
        ref={scrollContainerRef}
        className="h-80 overflow-y-auto bg-zinc-900 p-4 scroll-smooth relative"
      >
        {visibleLogs.length === 0 && !isFailed && (
          <div className="h-full flex flex-col items-center justify-center opacity-50">
             <div className="w-8 h-8 border-4 border-zinc-700 border-t-dark-pastel-green rounded-full animate-spin mb-4"></div>
             <p className="text-zinc-500 text-sm font-mono">{hypeText}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {visibleLogs.map((log, index) => {
            const isArtist = log.startsWith('ARTIST:');
            const isSkipped = log.startsWith('SKIPPED:');

            let displayText = log;
            if (isArtist) displayText = log.replace('ARTIST:', '');
            if (isSkipped) displayText = log.replace('SKIPPED:', '');

            return (
              <div 
                key={index} 
                className={`flex items-center gap-3 p-3 rounded-lg border animate-in slide-in-from-bottom-2 duration-300 ${
                  isSkipped 
                    ? 'bg-red-900/10 border-red-900/20' 
                    : 'bg-zinc-800/50 border-zinc-700/50'
                }`}
              >
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${
                  isArtist 
                    ? 'bg-dark-pastel-green/20 border-dark-pastel-green/50 text-dark-pastel-green' 
                    : isSkipped
                      ? 'bg-red-500/20 border-red-500/50 text-red-400'
                      : 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                }`}>
                  <span className="text-xs font-bold">
                    {isArtist ? '✓' : isSkipped ? '✕' : 'i'}
                  </span>
                </div>
                
                <span className={`font-medium text-base sm:text-lg block leading-snug ${
                  isArtist 
                    ? 'text-stone-200' 
                    : isSkipped
                      ? 'text-zinc-500' 
                      : 'text-blue-200 italic'
                }`}>
                  {displayText}
                </span>
              </div>
            );
          })}

          {!isComplete && !isFailed && isQueueEmpty && visibleLogs.length > 0 && (
             <div className="flex items-center gap-3 p-3 opacity-50 animate-pulse">
                <div className="w-6 h-6 rounded-full border-2 border-zinc-600 border-t-transparent animate-spin"></div>
                <span className="text-zinc-500 italic text-sm">Scanning for next batch...</span>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}