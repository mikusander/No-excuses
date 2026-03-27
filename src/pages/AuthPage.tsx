import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // Se la conferma email è disattivata in Supabase, l'utente sarà loggato.
        // Se è attiva, riceverà una mail. Nel dubbio mostriamo successo o naviga.
      }
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Errore durante l\'autenticazione');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col items-center justify-center p-6">
      <div className="bg-brand-darkGrey/40 p-8 rounded-3xl w-full max-w-sm border-2 border-brand-orange/30 shadow-2xl">
        <div className="flex justify-center mb-8">
          <img src="/images/logoApp.jpeg" alt="Logo" className="h-16 rounded-xl border border-white" />
        </div>
        
        <h2 className="text-2xl font-bold text-center mb-6">
          {isLogin ? 'Bentornato!' : 'Crea un Account'}
        </h2>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
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
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-black/50 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors"
            required
          />
          
          <button
            type="submit"
            disabled={loading}
            className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold text-lg py-3 rounded-xl mt-4 transition-colors disabled:opacity-50"
          >
            {loading ? 'Attendi...' : isLogin ? 'ACCEDI' : 'REGISTRATI'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-brand-grey">
          {isLogin ? 'Non hai un account?' : 'Hai già un account?'}
          <button 
            type="button" 
            onClick={() => setIsLogin(!isLogin)} 
            className="text-brand-orange font-bold ml-2 hover:underline"
          >
            {isLogin ? 'Registrati' : 'Accedi'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthPage;
