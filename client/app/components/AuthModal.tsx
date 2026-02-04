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
    const [view, setView] = useState<'signup' | 'login' | 'success'>('signup');
    
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
            // --- SIGN UP ---

            // 1. Get the current URL (e.g., 'http://localhost:3001' or 'https://livemusiccurator.com')
            const currentUrl = window.location.origin;
            
            // STEP A: Try to UPGRADE the current anonymous user
            let { data, error } : { data: any; error: any } = await supabase.auth.updateUser(
                { 
                    email, 
                    password,
                    data: { first_name: firstName, last_name: lastName }
                }, 
                { emailRedirectTo: currentUrl }
            );

            // STEP B: Handle "User Not Found" (The Stale Session Issue)
            // If the anon user was deleted from DB, we must clear the browser session and sign up fresh.
            if (error && error.message.includes("User from sub claim in JWT does not exist")) {
                console.warn("Anonymous user invalid. Clearing session and creating new account.");
                
                // 1. Nuke the stale session
                await supabase.auth.signOut();

                // 2. Create a brand new account
                // (Note: The playlist is technically lost here because the owner is gone, 
                // but at least the user gets a working account)
                const signUpResult = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { first_name: firstName, last_name: lastName },
                        emailRedirectTo: currentUrl
                    }
                });
                
                data = signUpResult.data as any;
                error = signUpResult.error;
            }

            if (error) throw error;
            
            // STEP C: Determine if we are done or need verification
            // If we have a user but NO session, it means Email Verification is required.
            if (data.user && !data.session) {
                setView('success');
            } else {
                // We are fully logged in (verification likely disabled or auto-confirmed)
                onSuccess();
                onClose();
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

        {view === 'success' ? (
          /* 1. SUCCESS VIEW */
          <div className="text-center py-8 animate-in zoom-in-95 duration-200">
             <div className="mx-auto w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mb-4">
               <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
               </svg>
             </div>
             <h2 className="text-2xl font-bold text-white mb-2">Check your inbox!</h2>
             <p className="text-zinc-400 mb-6">
               We've sent a confirmation link to <span className="text-white font-medium">{email}</span>.
             </p>
             <button 
               onClick={onClose}
               className="bg-zinc-800 text-white px-6 py-2 rounded-full font-semibold hover:bg-zinc-700 transition"
             >
               Close
             </button>
          </div>
        ) : (
          <>
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
        </>
        )}
      </div>
    </div>
  );
}