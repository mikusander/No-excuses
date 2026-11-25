/**
 * main.tsx — Punto di ingresso dell'applicazione React.
 *
 * Monta il componente radice `App` nel nodo DOM con id "root" (definito in index.html).
 * `StrictMode` attiva controlli e avvisi aggiuntivi durante lo sviluppo.
 * `AuthProvider` è il context provider che gestisce lo stato di autenticazione globale:
 * tutti i componenti figli possono leggere session/user tramite `useAuth()`.
 *
 * Registra il Service Worker tramite vite-plugin-pwa per:
 * - Precaching degli asset per funzionamento offline
 * - Gestione notifiche di background per il timer di recupero
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'

// Registra il Service Worker solo su Web/PWA (mai dentro Capacitor nativo)
// immediate: false → non forza il reload, l'aggiornamento avviene al prossimo caricamento
if (!Capacitor.isNativePlatform()) {
  registerSW({
    immediate: false,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        console.debug('[PWA] Service Worker registrato con successo')
      }
    },
    onOfflineReady() {
      console.debug('[PWA] App pronta per l\'uso offline')
    },
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* AuthProvider avvolge tutta l'app per rendere il contesto di autenticazione disponibile globalmente */}
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
