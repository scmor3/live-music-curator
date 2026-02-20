import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  XMarkIcon,
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

type FeedbackModalProps = {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string; // Pre-fill if user is logged in
};

const FEEDBACK_TYPES = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'design', label: 'Design Suggestion' },
  { value: 'general', label: 'General Feedback' }
];

const MAX_CHARACTERS = 1000;

export default function FeedbackModal({
  isOpen,
  onClose,
  userEmail: initialUserEmail
}: FeedbackModalProps) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [feedbackType, setFeedbackType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
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
      setLoading(false);
      setMessage('');
      setFeedbackType('');
      if (userEmail) {
        setEmail(userEmail);
      } else {
        setEmail('');
      }
    } else {
      // Reset when closing
      setMessage('');
      setEmail('');
      setFeedbackType('');
      setError('');
      setSuccess(false);
    }
  }, [isOpen, userEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    // Validate message
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError('Please enter your feedback.');
      setLoading(false);
      return;
    }

    if (trimmedMessage.length > MAX_CHARACTERS) {
      setError(`Message must be ${MAX_CHARACTERS} characters or less.`);
      setLoading(false);
      return;
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        setError('Please enter a valid email address.');
        setLoading(false);
        return;
      }
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

      const response = await fetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify({
          message: trimmedMessage,
          feedbackType: feedbackType || null,
          email: email || null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit feedback');
      }

      setSuccess(true);

    } catch (err: any) {
      console.error('Error submitting feedback:', err);
      setError(
        err.message || 
        'Failed to submit feedback. Please try again or contact us at livemusiccurator@gmail.com'
      );
    } finally {
      setLoading(false);
    }
  };

  const characterCount = message.length;
  const remainingChars = MAX_CHARACTERS - characterCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 w-full max-w-md mx-4 animate-in zoom-in duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 flex-shrink-0">
          <h2 className="text-xl font-bold text-stone-100">Send Feedback</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
            disabled={loading}
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {success ? (
            <div className="text-center py-4">
              <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-stone-100 mb-2">Thank you!</h3>
              <p className="text-zinc-400 text-sm mb-4">
                Your feedback has been received. We appreciate you taking the time to help us improve!
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-dark-pastel-green text-zinc-900 font-semibold rounded-lg hover:bg-green-400 transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Feedback Type (Optional) */}
              <div>
                <label htmlFor="feedback-type" className="block text-sm font-medium text-zinc-300 mb-2">
                  Type (Optional)
                </label>
                <select
                  id="feedback-type"
                  value={feedbackType}
                  onChange={(e) => setFeedbackType(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-dark-pastel-green focus:border-transparent"
                  disabled={loading}
                >
                  <option value="">Select a type...</option>
                  {FEEDBACK_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div>
                <label htmlFor="message" className="block text-sm font-medium text-zinc-300 mb-2">
                  Your Feedback <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's on your mind..."
                  rows={6}
                  maxLength={MAX_CHARACTERS}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-stone-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-dark-pastel-green focus:border-transparent resize-none"
                  required
                  disabled={loading}
                  autoFocus
                />
                <div className="flex justify-between items-center mt-1">
                  <span className={`text-xs ${remainingChars < 50 ? 'text-red-400' : 'text-zinc-500'}`}>
                    {characterCount} / {MAX_CHARACTERS} characters
                  </span>
                </div>
              </div>

              {/* Email (Optional) */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-2">
                  Email (Optional - for follow-up)
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-stone-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-dark-pastel-green focus:border-transparent"
                  disabled={loading}
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
                  disabled={loading || !message.trim()}
                >
                  {loading ? 'Sending...' : 'Send Feedback'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
