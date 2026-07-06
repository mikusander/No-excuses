/**
 * main.tsx — Punto di ingresso dell'applicazione React.
 *
 * Monta il componente radice `App` nel nodo DOM con id "root" (definito in index.html).
 * `StrictMode` attiva controlli e avvisi aggiuntivi durante lo sviluppo.
 * `AuthProvider` è il context provider che gestisce lo stato di autenticazione globale:
 * tutti i componenti figli possono leggere session/user tramite `useAuth()`.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* AuthProvider avvolge tutta l'app per rendere il contesto di autenticazione disponibile globalmente */}
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
