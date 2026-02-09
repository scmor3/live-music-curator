import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  XMarkIcon,
  EnvelopeIcon,
  CheckCircleIcon,
  ExclamationCircleIcon
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

type EmailModalProps = {
  isOpen: boolean;
  onClose: () => void;
  playlistId?: string;
  jobId?: number;
  userEmail?: string; // Pre-fill if user is logged in
};

export default function EmailModal({
  isOpen,
  onClose,
  playlistId,
  jobId,
  userEmail: initialUserEmail
}: EmailModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(initialUserEmail || null);

  // Fetch user email if not provided and user is logged in
  useEffect(() => {
    if (!isOpen || initialUserEmail) return;

    const fetchUserEmail = async () => {
      try {
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
        
        if (session?.user?.email) {
          setUserEmail(session.user.email);
          setEmail(session.user.email);
        }
      } catch (err) {
        // Continue without pre-filling email if Supabase is unreachable
        console.debug('Could not fetch user email:', err);
      }
    };

    fetchUserEmail();
  }, [isOpen, initialUserEmail]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setError('');
      setSuccess(false);
      setIsPending(false);
      setLoading(false);
      if (userEmail) {
        setEmail(userEmail);
      }
    } else {
      // Reset when closing
      setEmail('');
      setError('');
      setSuccess(false);
      setIsPending(false);
    }
  }, [isOpen, userEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);
    setIsPending(false);

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      setLoading(false);
      return;
    }

    // Validate jobId exists (required for deferred sending when playlist isn't ready)
    if (!jobId && !playlistId) {
      setError('Playlist information is missing. Please try again.');
      setLoading(false);
      return;
    }

    try {
      // Get auth token if available
      let token = null;
      try {
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
        token = session?.access_token || null;
      } catch (err) {
        // Continue without token if auth is unavailable
      }

      const response = await fetch(`${API_URL}/api/email-playlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify({
          playlistId: playlistId || null, // Send null if not ready (API will use jobId)
          email: email,
          jobId: jobId || null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      // Check if email was sent immediately or saved as pending
      if (data.message && data.message.includes('saved')) {
        setIsPending(true);
      } else {
        setSuccess(true);
      }

    } catch (err: any) {
      console.error('Error sending email:', err);
      setError(
        err.message || 
        'Failed to send email. Please try again or contact us at livemusiccurator@gmail.com'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 w-full max-w-md mx-4 animate-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-xl font-bold text-stone-100">Email Playlist Link</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
            disabled={loading}
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {success ? (
            <div className="text-center py-4">
              <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-stone-100 mb-2">Email Sent!</h3>
              <p className="text-zinc-400 text-sm">
                Check your inbox at <span className="text-stone-100 font-medium">{email}</span>
              </p>
            </div>
          ) : isPending ? (
            <div className="text-center py-4">
              <EnvelopeIcon className="w-16 h-16 text-amber-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-stone-100 mb-2">Email Request Saved</h3>
              <p className="text-zinc-400 text-sm">
                We'll send the playlist link to <span className="text-stone-100 font-medium">{email}</span> when it's ready.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-stone-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-dark-pastel-green focus:border-transparent"
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800 rounded-lg">
                  <ExclamationCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-200 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 transition-colors"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-dark-pastel-green text-zinc-900 font-semibold rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading}
                >
                  {loading ? 'Sending...' : 'Send Email'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
