import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  XMarkIcon,
  MusicalNoteIcon,
  CalendarIcon,
  MapPinIcon,
  TrashIcon,
  ArrowPathIcon
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

type SavedPlaylist = {
  id: string;
  name: string;
  city_name: string;
  playlist_date: string; // ISO string 'YYYY-MM-DD'
  spotify_playlist_id: string;
  events_snapshot: any[];
  created_at: string;
  min_start_time: number;
  max_start_time: number;
  excluded_genres: string[] | null;
};

type PlaylistSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectPlaylist: (playlist: SavedPlaylist) => void;
};

export default function PlaylistSidebar({ isOpen, onClose, onSelectPlaylist }: PlaylistSidebarProps) {
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Refresh Handler
  const handleRefresh = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (refreshingId) return; // Prevent double clicks

    setRefreshingId(id);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const response = await fetch(`${API_URL}/api/my-playlists/${id}/refresh`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Refresh failed');
      
      const result = await response.json();

      // Update the local state with the new data
      setPlaylists(prev => prev.map(p => {
        if (p.id === id) {
          return {
            ...p,
            spotify_playlist_id: result.playlistId,
            events_snapshot: result.events,
            // Optional: update 'updated_at' if you track it
          };
        }
        return p;
      }));
      
    } catch (err) {
      console.error('Failed to refresh', err);
      alert('Could not refresh playlist. Please try again.');
    } finally {
      setRefreshingId(null);
    }
  };

  // Delete Handler
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevent clicking the row behind the button
    
    if (!confirm('Are you sure you want to remove this playlist from your library?')) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const response = await fetch(`${API_URL}/api/my-playlists/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        // Remove from local state immediately
        setPlaylists(prev => prev.filter(p => p.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete', err);
    }
  };

  // Fetch data whenever the sidebar opens
  useEffect(() => {
    if (isOpen) {
      fetchLibrary();
    }
  }, [isOpen]);

  const fetchLibrary = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        // If not logged in, we can't fetch. 
        // (The parent component should probably prevent opening this if anon, 
        // but we'll handle it gracefully here too).
        setPlaylists([]);
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/my-playlists`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch library');
      
      const data = await response.json();
      setPlaylists(data);

    } catch (err) {
      console.error(err);
      setError('Could not load playlists.');
    } finally {
      setLoading(false);
    }
  };

  // Prevent scrolling the body when sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  // Format date helper (e.g. "2025-12-31" -> "Dec 31, 2025")
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    // Create date and adjust for timezone offset to prevent "day before" bug
    const date = new Date(dateStr);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(adjustedDate);
  };

  return (
    <>
      {/* 1. Backdrop (Click to close) */}
      <div 
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* 2. Sidebar Drawer */}
      <div className={`fixed top-0 left-0 h-full w-80 bg-zinc-900 border-r border-zinc-800 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex justify-between items-center bg-zinc-900">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-dark-pastel-green">library</span>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Content Area */}
        <div className="overflow-y-auto h-[calc(100%-64px)] p-4">
          
          {loading && (
            <div className="text-center py-10 text-zinc-500 animate-pulse">
              Loading library...
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-10 text-red-400 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && playlists.length === 0 && (
            <div className="text-center py-10 text-zinc-500">
              <MusicalNoteIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No saved playlists yet.</p>
              <p className="text-xs mt-2 text-zinc-600">Create one to see it here!</p>
            </div>
          )}

          {/* Playlist List */}
          <div className="space-y-3">
            {playlists.map((playlist) => (
              <div 
                key={playlist.id}
                onClick={() => onSelectPlaylist(playlist)}
                className="group p-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800 hover:border-dark-pastel-green/50 cursor-pointer transition-all active:scale-[0.98] relative pr-20"
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-stone-100 group-hover:text-dark-pastel-green transition-colors truncate">
                    {playlist.city_name}
                  </h3>
                </div>
                
                <div className="flex items-center gap-3 text-xs text-zinc-400">
                  <div className="flex items-center gap-1">
                    <CalendarIcon className="w-3 h-3" />
                    <span>{formatDate(playlist.playlist_date)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MusicalNoteIcon className="w-3 h-3" />
                    <span>{playlist.events_snapshot?.length || 0} artists</span>
                  </div>
                </div>

                {/* ACTION BUTTONS CONTAINER */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  
                  {/* REFRESH BUTTON */}
                  <button 
                    onClick={(e) => handleRefresh(e, playlist.id)}
                    disabled={!!refreshingId}
                    className={`p-2 rounded-full transition-colors ${
                      refreshingId === playlist.id 
                        ? 'text-dark-pastel-green animate-spin cursor-not-allowed' 
                        : 'text-zinc-600 hover:text-dark-pastel-green hover:bg-zinc-700'
                    }`}
                    title="Update with latest shows"
                  >
                    <ArrowPathIcon className="w-5 h-5" />
                  </button>

                  {/* DELETE BUTTON */}
                  <button 
                    onClick={(e) => handleDelete(e, playlist.id)}
                    className="p-2 text-zinc-600 hover:text-red-400 hover:bg-zinc-700 rounded-full transition-colors"
                    title="Remove from library"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </div>

              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}