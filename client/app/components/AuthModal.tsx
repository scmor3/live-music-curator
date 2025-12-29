import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { XMarkIcon } from '@heroicons/react/24/outline';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables in AuthModal');
}

// Initialize the client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type AuthModalProps = {
  isOpen: boolean;       // controlled by parent
  onClose: () => void;   // function to close the modal
  onSuccess: () => void; // function to run after successful signup
};

export default function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
    const [view, setView] = useState<'signup' | 'login'>('signup');
    
    // Input State
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');

    // UI State
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // 1. If not open, render nothing. This keeps the DOM clean.
    if (!isOpen) return null;

    // 2. The Submit Handler
    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
        if (view === 'signup') {
            // --- SIGN UP (UPGRADE) ---
            const { data, error } = await supabase.auth.updateUser({
            email: email,
            password: password,
            data: {
                first_name: firstName,
                last_name: lastName
              }
            });
            if (error) throw error;
            
            if (data.user?.identities && data.user.identities.length > 0) {
            onSuccess();
            onClose();
            } else {
            setError('Please check your email to confirm your account.');
            }

        } else {
            // --- LOG IN ---
            const { error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
            });
            if (error) throw error;
            
            onSuccess();
            onClose();
        }
    } catch (err: any) {
    setError(err.message || 'Authentication failed');
    } finally {
    setLoading(false);
    }
    };

  return (
    // The Backdrop: Covers the screen with a dark, blurred overlay
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* The Modal Window */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
        
        {/* Close Button (X icon) */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
          type="button"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>

        <h2 className="text-2xl font-bold text-white mb-2">
          {view === 'signup' ? 'Save your Playlists' : 'Welcome Back'}
        </h2>
        <p className="text-zinc-400 text-sm mb-6">
          {view === 'signup' 
            ? 'Create an account to save your history and access your curated playlists anytime.'
            : 'Log in to access your saved playlists.'}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          
          {/* Name Fields - Only show for Signup */}
          {view === 'signup' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">First Name</label>
                <input 
                  type="text" 
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-dark-pastel-green focus:outline-none placeholder-zinc-600"
                  placeholder="John"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Last Name</label>
                <input 
                  type="text" 
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-dark-pastel-green focus:outline-none placeholder-zinc-600"
                  placeholder="Doe"
                />
              </div>
            </div>
          )}

          {/* Email Field */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-dark-pastel-green focus:outline-none placeholder-zinc-600"
              placeholder="you@example.com"
            />
          </div>

          {/* Password Field */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-dark-pastel-green focus:outline-none placeholder-zinc-600"
              placeholder="••••••••"
            />
          </div>

          {/* Error Message Box */}
          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 p-2 rounded border border-red-900/50">
              {error}
            </p>
          )}

          {/* Submit Button */}
          <button 
            type="submit" 
            disabled={loading}
            className="mt-2 w-full bg-dark-pastel-green text-zinc-900 font-bold py-3 rounded-lg hover:bg-green-400 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : (view === 'signup' ? 'Create Account' : 'Log In')}
          </button>
        </form>

        {/* Toggle Mode Link */}
        <div className="mt-4 text-center text-sm text-zinc-400">
          {view === 'signup' ? (
            <>
              Already have an account?{' '}
              <button 
                onClick={() => { setView('login'); setError(''); }} 
                className="text-dark-pastel-green hover:underline font-semibold"
              >
                Log In
              </button>
            </>
          ) : (
            <>
              Don't have an account?{' '}
              <button 
                onClick={() => { setView('signup'); setError(''); }} 
                className="text-dark-pastel-green hover:underline font-semibold"
              >
                Sign Up
              </button>
            </>
          )}
        </div>
        
      </div>
    </div>
  );
}