import React, { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import confetti from 'canvas-confetti';
import { 
  CheckCircleIcon, 
  ExclamationCircleIcon,
  MusicalNoteIcon,
  InformationCircleIcon,
  ChevronRightIcon,
  BookmarkIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase Environment Variables! Please check .env.local'
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type LiveActivityFeedProps = {
  status: string;
  logs: string[];
  totalCount: number;
  playlistId?: string;
  errorMessage?: string;
  events?: any[];
  cityName?: string;
  dateStr?: string;
  onReset: () => void;
  jobId: string;
  isAnonymous?: boolean;
  onAuthTrigger?: () => void;
  queuePosition?: number | null;
};

export default function LiveActivityFeed({ 
  status, 
  logs, 
  totalCount, 
  playlistId, 
  errorMessage,
  events = [],
  cityName = 'Unknown City',
  dateStr = 'Unknown Date',
  onReset,
  jobId,
  isAnonymous,
  onAuthTrigger,
  queuePosition = null
}: LiveActivityFeedProps) {
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
  
  // Queue Logic
  const queueRef = useRef<string[]>([]);
  const processedIndexRef = useRef(0);
  const [isQueueEmpty, setIsQueueEmpty] = useState(true);

  // HYPE CYCLE
  const [hypeText, setHypeText] = useState('Initializing scraper...');

  // State for save button
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Save Handler
  const handleSaveToLibrary = async () => {
    if (!jobId) return;

    // --- Intercept Anonymous Users ---
    if (isAnonymous && onAuthTrigger) {
      onAuthTrigger(); // Open the modal
      return;          // Stop execution (don't save yet)
    }
    // --------------------------------------------

    setSaveStatus('saving');

    try {
      // Get the current user's token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) throw new Error('No active session');

      const response = await fetch(`${API_URL}/api/save-playlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ jobId })
      });

      if (!response.ok) throw new Error('Failed to save');

      setSaveStatus('saved');
      
      // Optional: Reset "saved" status after 3 seconds so they can save again if needed? 
      // Or keep it 'saved' to show permanent success. Keeping it 'saved' is better UX.

    } catch (err) {
      console.error('Error saving playlist:', err);
      setSaveStatus('error');
      // Reset error after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  useEffect(() => {
    if (visibleLogs.length > 0) return; 

    // Different messages based on status
    const hypeMessages = status === 'pending' 
      ? [
          'Joining the queue...',
          'Waiting for other playlists to finish...',
          'Respecting Spotify rate limits...',
          'Almost there...',
          'Getting ready to curate...'
        ]
      : [
          'Tuning the guitars...',
          'Checking sound levels...',
          'Scouting local venues...',
          'Waking up the drummer...',
          'Finding the hidden gems...',
          'Restringing the bass...',
          'Soundchecking the mic...',
          'Polishing the cymbals...',
          'Loading the tour bus...',
          'Setting the setlist...',
          'Untangling the cables...',
          'Finding the guitar pick...'
        ];
    let i = 0;
    const interval = setInterval(() => {
      setHypeText(hypeMessages[i % hypeMessages.length]);
      i++;
    }, 2000); 

    return () => clearInterval(interval);
  }, [visibleLogs.length, status]);

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

  // 6. SMART FINISH SCROLL
  // When status becomes 'complete', ensure we see the final message,
  // BUT ONLY if the user hasn't scrolled up to read history.
  useEffect(() => {
    if (status === 'complete' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      
      // Calculate if user is near bottom (within 200px buffer)
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;

      if (isNearBottom) {
        // Only force scroll if they were following the feed
        setTimeout(() => {
          container.scrollTop = container.scrollHeight;
        }, 100);
      }
    }
  }, [status]);

  // --- VISUAL CALCULATIONS ---
  const displayCount = visibleLogs.length;
  
  const percent = (status === 'complete') 
    ? 100 
    : (totalCount > 0 ? Math.round((displayCount / totalCount) * 100) : 0);
    
  const effectivePercent = totalCount === 0 ? 5 : percent;

  const isComplete = status === 'complete' && !!playlistId;
  const isFailed = status === 'failed' || !!errorMessage;
  
  // Check if there are any warnings in the logs
  const hasWarnings = logs.some(log => log.startsWith('WARNING:'));

  useEffect(() => {
    if (isComplete) {
      // Fire confetti!
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }, // Start slightly below center
        zIndex: 9999,      // Ensure it pops over everything
        colors: ['#4ade80', '#fbbf24', '#ffffff'] // Optional: Green/Gold/White theme
      });
    }
  }, [isComplete]);

  // Helper to find event by artist name (with fuzzy fallback)
  const getEventForLog = (artistName: string) => {
    if (!events || events.length === 0) return null;
    const cleanName = artistName.toLowerCase().trim();
    
    // 1. Try Exact Match
    const exact = events.find((e: any) => e.name.toLowerCase().trim() === cleanName);
    if (exact) return exact;

    // 2. Try Fuzzy Match (Contains)
    // This catches "Rick Trevino" matching "Rick Trevino (Official)"
    const fuzzy = events.find((e: any) => {
      const eventName = e.name.toLowerCase().trim();
      return eventName.includes(cleanName) || cleanName.includes(eventName);
    });
    
    return fuzzy;
  };

  // --- HELPER: Format Time ---
  const formatTime = (isoDate: string) => {
    try {
      if (!isoDate) return '';
      const date = new Date(isoDate);
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="w-full max-w-lg bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden border border-zinc-800 animate-in fade-in slide-in-from-bottom-4 duration-500 h-[75vh] flex flex-col">
      
      {/* --- HEADER --- */}
      <div className={`p-3 border-b border-zinc-800 transition-colors duration-700 ${
        isComplete ? 'bg-zinc-800' : isFailed ? 'bg-red-900/20' : 'bg-night-blue'
      }`}>
        
        {/* Warning Banner - Show if there are batch failures */}
        {hasWarnings && isComplete && (
          <div className="mb-3 p-2 bg-yellow-900/20 border border-yellow-600/50 rounded-lg">
            <div className="flex items-center gap-2 text-yellow-200 text-xs">
              <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
              <span>Some tracks may be missing from the playlist due to errors. Check the feed for details.</span>
            </div>
          </div>
        )}
        
        {isComplete ? (
          /* 3. CLEAN SINGLE ROW LAYOUT (No Text) */
          <div className="animate-in zoom-in duration-500 flex items-center gap-2 w-full">
              
              {/* PRIMARY ACTION: Open in Spotify */}
              <a 
                href={`https://open.spotify.com/playlist/${playlistId}`}
                target="_blank" 
                rel="noopener noreferrer"
                className="flex-grow bg-dark-pastel-green text-zinc-900 font-bold text-xs sm:text-sm py-2 px-3 rounded-lg hover:bg-green-400 transition-all shadow-md flex items-center justify-center whitespace-nowrap"
              >
                <span>Open in Spotify</span>
              </a>

              {/* SECONDARY ACTION: Save to Library */}
              <button
                onClick={handleSaveToLibrary}
                disabled={saveStatus === 'saving' || saveStatus === 'saved'}
                className={`
                  font-semibold text-xs sm:text-sm py-2 px-3 sm:px-5 rounded-lg transition-all border
                  flex items-center justify-center whitespace-nowrap
                  ${saveStatus === 'saved' 
                    ? 'bg-zinc-700 text-green-400 border-zinc-600 cursor-default'
                    : saveStatus === 'error'
                    ? 'bg-red-900/30 text-red-400 border-red-800'
                    : 'bg-transparent text-stone-100 border-zinc-600 hover:bg-zinc-700 hover:border-zinc-500'
                  }
                `}
              >
                {saveStatus === 'idle' && <span>Save Playlist</span>}
                {saveStatus === 'saving' && <span>Saving...</span>}
                {saveStatus === 'saved' && (
                  <>
                    <CheckCircleIcon className="w-4 h-4 mr-1" />
                    <span>Saved</span>
                  </>
                )}
                {saveStatus === 'error' && <span>Error</span>}
              </button>

              {/* CLOSE ACTION: X Icon */}
              <button 
                onClick={onReset}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-transparent text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors"
                title="Close and start over"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>

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
            <div className="flex items-center justify-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-pastel-yellow tracking-wide animate-pulse">
                {status === 'pending' ? 'Queueing...' : 'Curating...'}
              </h2>
              {status === 'pending' && (
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              )}
            </div>
            
            {/* Queue Position Display */}
            {status === 'pending' && queuePosition !== null && queuePosition >= 0 && (
              <div className="mb-3 p-3 bg-amber-900/20 border border-amber-600/50 rounded-lg">
                <div className="flex items-center gap-2 text-amber-200 text-xs">
                  <InformationCircleIcon className="w-4 h-4 flex-shrink-0" />
                  <span>You're #{Number(queuePosition) + 1} in queue. We're processing other playlists to avoid overloading Spotify.</span>
                </div>
              </div>
            )}

            <p className="text-zinc-400 text-sm mb-4">
              {totalCount > 0 
                ? `Processed ${displayCount} of ${totalCount} artists` 
                : hypeText}
            </p>

            <div className="w-full max-w-[16rem] h-2 bg-zinc-700/50 rounded-full mx-auto overflow-hidden relative">
              {status === 'pending' ? (
                <div className="bg-amber-500 h-full rounded-full animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.5)]" style={{ width: '30%' }} />
              ) : (
                <div 
                  className="bg-dark-pastel-green h-full transition-all duration-300 ease-out rounded-full shadow-[0_0_10px_rgba(74,222,128,0.5)]"
                  style={{ width: `${effectivePercent}%` }}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* --- LOG BODY --- */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto bg-zinc-900 p-4 scroll-smooth relative"
      >
        {visibleLogs.length === 0 && !isFailed && (
          <div className="h-full flex flex-col items-center justify-center opacity-50 relative overflow-hidden">
            {status === 'pending' ? (
              <>
                {/* Floating music notes animation */}
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute opacity-20 animate-bounce"
                      style={{
                        left: `${20 + i * 30}%`,
                        top: `${30 + i * 20}%`,
                        animationDuration: `${2 + i * 0.5}s`,
                        animationDelay: `${i * 0.3}s`
                      }}
                    >
                      <MusicalNoteIcon className="w-4 h-4 text-amber-500" />
                    </div>
                  ))}
                </div>
                <div className="relative mb-6 z-10">
                  <div className="w-16 h-16 border-4 border-amber-600/30 border-t-amber-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <MusicalNoteIcon className="w-6 h-6 text-amber-500 animate-pulse" />
                  </div>
                </div>
                <p className="text-amber-400 text-sm font-mono mb-2 z-10">{hypeText}</p>
                {queuePosition !== null && queuePosition >= 0 && (
                  <p className="text-zinc-600 text-xs z-10">Position in queue: #{Number(queuePosition) + 1}</p>
                )}
              </>
            ) : (
              <>
                <div className="relative mb-6">
                  <div className="w-16 h-16 border-4 border-zinc-700 border-t-dark-pastel-green rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <MusicalNoteIcon className="w-6 h-6 text-dark-pastel-green animate-pulse" />
                  </div>
                </div>
                <p className="text-zinc-500 text-sm font-mono">{hypeText}</p>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {visibleLogs.map((log, index) => {
            let type = 'info';
            let text = log;
            let subText = '';
            let artistName = '';

            // PARSE LOG TYPE
            if (log.startsWith('ARTIST:')) {
              type = 'success';
              artistName = log.replace('ARTIST:', '').trim();
              text = artistName;
            } else if (log.startsWith('SKIPPED:')) {
              type = 'skipped';
              const parts = log.replace('SKIPPED:', '').split('(');
              artistName = parts[0].trim();
              text = artistName;
              subText = 'Tracks not found';
            } else if (log.startsWith('WARNING:')) {
              type = 'warning';
              text = log.replace('WARNING:', '').trim();
              // Warnings don't have artist names, so skip event matching
            }

            // FIND RICH DATA (Image & Link)
            const eventData = artistName ? getEventForLog(artistName) : null;
            const hasLink = !!(eventData && eventData.url);

            // Special rendering for warnings (full-width banner style)
            if (type === 'warning') {
              return (
                <div 
                  key={index}
                  className="flex items-start gap-3 p-3 bg-yellow-900/20 border border-yellow-600/50 rounded-lg animate-in slide-in-from-bottom-2 duration-300"
                >
                  <ExclamationCircleIcon className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <span className="text-yellow-200 text-sm leading-relaxed flex-1">{text}</span>
                </div>
              );
            }

            return (
              <div 
                key={index} 
                className={`
                  flex items-center gap-2 p-2 rounded-lg border transition-all duration-200
                  ${hasLink ? 'hover:bg-zinc-800 active:bg-zinc-800 active:scale-[0.98] cursor-pointer group border-transparent' : 'border-zinc-800/50 bg-zinc-900/50'}
                  animate-in slide-in-from-bottom-2 duration-300
                `}
                onClick={() => {
                  if (hasLink) window.open(eventData.url, '_blank');
                }}
                role={hasLink ? "button" : undefined}
              >
                {/* --- AVATAR / ICON COLUMN --- */}
                {type !== 'info' && (
                  <div className="flex-shrink-0 relative w-10 h-10">
                    {eventData && eventData.image ? (
                      <img 
                        src={eventData.image} 
                        alt={text}
                        className={`w-full h-full rounded-full object-cover border border-zinc-700 transition-colors ${
                          hasLink ? 'group-hover:border-amber-500' : ''
                        } ${type === 'skipped' ? 'grayscale opacity-70' : ''}`}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : type === 'success' ? (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-800 rounded-full border border-zinc-700">
                        <MusicalNoteIcon className="w-5 h-5 text-green-400" />
                      </div>
                    ) : type === 'skipped' ? (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-800/50 rounded-full border border-zinc-700/50">
                        <span className="text-sm font-bold text-zinc-600">?</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <InformationCircleIcon className="w-5 h-5 text-zinc-500" />
                      </div>
                    )}
                    
                    {/* Fallback Icon (Hidden by default) */}
                    <div className="hidden absolute inset-0 bg-zinc-800 rounded-full flex items-center justify-center border border-zinc-700">
                      <MusicalNoteIcon className="w-5 h-5 text-zinc-500" />
                    </div>
                  </div>
                )}

                {/* --- TEXT COLUMN --- */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <span className={`
                    font-bold text-lg leading-snug w-full
                    ${type === 'info' ? 'text-blue-200 whitespace-normal italic text-sm' : 'truncate'}
                    ${type === 'success' ? 'text-stone-100' : ''}
                    ${type === 'skipped' ? 'text-zinc-400' : ''}
                    ${type === 'warning' ? 'text-yellow-200' : ''}
                  `}>
                    {text}
                  </span>
                  
                  {/* Subtext Logic */}
                  {eventData && (
                    <div className="flex flex-col items-center w-full mt-1">
                      {/* Venue & Time Line (Centered) */}
                      <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 w-full truncate">
                        {eventData.date && (
                          <span className="text-amber-600 font-mono tracking-tighter">
                            {formatTime(eventData.date)}
                          </span>
                        )}
                        {eventData.venue && (
                          <span className="truncate max-w-[150px]">
                            @ {eventData.venue}
                          </span>
                        )}
                      </div>
                      
                      {/* Explicit "Not Found" label for skipped items */}
                      {type === 'skipped' && (
                        <span className="text-[10px] uppercase font-bold tracking-wider text-red-400/80 mt-1">
                          Tracks Not Found
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* --- CHEVRON (Mobile Affordance) --- */}
                {hasLink && (
                  <div className="flex-shrink-0 pl-1">
                    <ChevronRightIcon className="w-5 h-5 text-zinc-600 group-hover:text-amber-500 transition-colors" />
                  </div>
                )}
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