import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { logoBase64 } from '../assets/logoBase64';

type AuthMode = 'login' | 'signup' | 'forgot';

const AuthPage: React.FC = () => {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (authMode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/auth',
        });
        if (error) throw error;
        setMessage('Check your email for the password reset link!');
      } else if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate('/');
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        navigate('/');
      }
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Error during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col items-center justify-center p-6">
      <div className="bg-brand-darkGrey/40 p-8 rounded-3xl w-full max-w-sm border-2 border-brand-orange/30 shadow-2xl">
        <div className="flex justify-center mb-8">
          <img src={logoBase64} alt="Logo" className="h-16 rounded-xl border border-white" />
        </div>
        
        <h2 className="text-2xl font-bold text-center mb-6">
          {authMode === 'login' ? 'Welcome back!' : authMode === 'signup' ? 'Create an Account' : 'Reset Password'}
        </h2>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
          </div>
        )}

        {message && (
          <div className="bg-green-500/20 border border-green-500 text-green-100 p-3 rounded-lg mb-4 text-sm text-center">
            {message}
          </div>
        )}

        <form onSubmit={handleAuth} className="flex flex-col space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-black/50 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors"
            required
          />
          {authMode !== 'forgot' && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-black/50 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors"
              required
            />
          )}
          
          {authMode === 'login' && (
            <div className="text-right">
              <button 
                type="button" 
                onClick={() => { setAuthMode('forgot'); setError(null); setMessage(null); }}
                className="text-xs text-brand-grey hover:text-brand-orange transition-colors"
              >
                Forgot your password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold text-lg py-3 rounded-xl mt-4 transition-colors disabled:opacity-50"
          >
            {loading ? 'Please wait...' : authMode === 'login' ? 'LOG IN' : authMode === 'signup' ? 'SIGN UP' : 'SEND RESET LINK'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-brand-grey flex flex-col space-y-3">
          {authMode !== 'login' && (
            <div>
              <span>Already have an account?</span>
              <button 
                type="button" 
                onClick={() => { setAuthMode('login'); setError(null); setMessage(null); }} 
                className="text-brand-orange font-bold ml-2 hover:underline"
              >
                Log in
              </button>
            </div>
          )}
          {authMode !== 'signup' && (
            <div>
              <span>Don't have an account?</span>
              <button 
                type="button" 
                onClick={() => { setAuthMode('signup'); setError(null); setMessage(null); }} 
                className="text-brand-orange font-bold ml-2 hover:underline"
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
