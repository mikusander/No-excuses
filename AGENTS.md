# AGENTS.md — Memoria e Configurazione del Progetto No-Excuses

Questo file funge da riferimento principale per qualsiasi agente AI e sviluppatore che lavori su questo repository.

---

## Indice Rapido

1. [Visione e Stack](#1-visione-e-stack)
2. [Ambiente di Lavoro & Pipeline iOS](#2-ambiente-di-lavoro--pipeline-ios)
3. [Design System Apple Dark Mode](#3-design-system-apple-dark-mode)
4. [Architettura Dati & Modello Supabase](#4-architettura-dati--modello-supabase)
5. [Meccaniche di Allenamento & Sfinimento (MAX)](#5-meccaniche-di-allenamento--sfinimento-max)
6. [Regole Operative e Comandi di Validazione](#6-regole-operative-e-comandi-di-validazione)

---

## 1. Visione e Stack

- **Progetto**: No-Excuses (Workout Tracker Multimodale senza smartwatch).
- **Strategia**: **Singola Codebase condivisa al 100%** tra Web App / PWA e App Nativa per iPhone (Capacitor). Non esistono due progetti separati.
- **Frontend**: React 19 (`react@^19.2.4`), Vite 8, React Router v7.
- **Linguaggio**: TypeScript 5.9 con `verbatimModuleSyntax: true` (usare sempre `import type`) e `erasableSyntaxOnly: true` (no enum).
- **Stile**: Tailwind CSS v4 (`@tailwindcss/vite`), token `@theme` in `src/index.css`.
- **Backend & Database**: Supabase JS Client v2 (PostgreSQL + Auth + RLS).
- **Mobile Container**: Capacitor iOS v8 (`@capacitor/core`, `@capacitor/ios`, `@capacitor/haptics`, `@capacitor/local-notifications`).

---

## 2. Ambiente di Lavoro & Pipeline iOS

- **Sistema Operativo**: **Windows**.
- **Dev Server**: `npm run dev` su `http://localhost:5173`.
- **Pipeline di Compilazione iOS**:
  - Compilazione automatica tramite **GitHub Actions** (`.github/workflows/build-ios.yml`) su macchine Mac remote (`macos-15`).
  - Genera ad ogni push su `main` l'archivio IPA di produzione `NoExcuses.ipa` e di sviluppo `NoExcuses-Dev.ipa`.
- **Distribuzione su iPhone tramite AltServer**:
  - L'utente usa **AltServer su Windows** per installare l'app su iPhone con Apple ID gratuito.
  - **Scadenza 7 giorni (Apple Free Account)**:
    - Se AltStore si apre: tocca *"Refresh All"* nella scheda *My Apps* su iPhone (con PC acceso sotto lo stesso Wi-Fi).
    - Se AltStore è scaduto: ricollega iPhone via USB al PC, clicca su AltServer nella barra applicazioni > *"Install AltStore"*.
    - Per aggiornare l'app: scarica `NoExcuses.ipa` dagli artifacts di GitHub Actions e aprilo con il tasto `+` in AltStore.

---

## 3. Design System Apple Dark Mode

- **Colori**:
  - Sfondo: OLED Black puro `#000000` (`--color-brand-dark`)
  - Card: `#1C1C1E` (`--color-brand-card` / `--color-brand-darkgrey`) con bordo `border-white/10` e raggio `rounded-3xl`
  - Superfici secondarie: `#2C2C2E`
  - Accento arancione atletico: `#FF5E00` (`--color-brand-orange`) e light `#FF7724`
- **Safe Areas Dinamiche**:
  - Header: `pt-[env(safe-area-inset-top)]` con background satinato che scorre sotto la Dynamic Island.
  - Bottom Bar: `bottom: max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))` per galleggiare sopra l'home bar.
  - Buffer scroll: classe utility `.safe-pb-nav` su tutte le schermate a scorrimento.
- **Componenti Condivisi**:
  - `src/components/AppHeader.tsx`: Intestazione standard stile iOS con tasto Back e azioni.
  - `src/components/BottomNavigation.tsx`: Tab bar Liquid Glass con feedback aptico.
  - `src/utils/haptics.ts`: Feedback aptico nativo (`hapticLight`, `hapticMedium`, `hapticHeavy`, `hapticSuccess`).

---

## 4. Architettura Dati & Modello Supabase

- **Tabelle Principali**:
  - `schede`: schede create dall'utente.
  - `esercizi`: esercizi appartenenti alla scheda.
  - `workout_run`: sessioni eseguite, con snapshot immutabile `exercises_snapshot`.
  - `note_workout`: note sessione con riepilogo automatico delle prestazioni.
  - `profili`: preferenze utente (username, voice_assistant).
- **Cartelle Schede (`src/utils/folderManager.ts`)**:
  - Gestione cartelle offline-first in `localStorage` (`workout_folders_v1:${userId}` e `workout_folder_assignments_v1:${userId}`).
  - Aggiornamento reattivo senza modifiche al database Supabase.
- **Ripresa Workout (`src/lib/workoutProgressStorage.ts`)**:
  - Salvataggio checkpoint in tempo reale per prevenire perdite di sessione.

---

## 5. Meccaniche di Allenamento & Sfinimento (MAX)

- **Tipologie**: standard reps, isometrie, superset, circuiti, EMOM, piramidali.
- **Parametro MAX (Cedimento / Sfinimento)**:
  - `reps === 0`: ripetizioni a sfinimento.
  - `duration_seconds === 0` (isometrie): tenuta isometrica a sfinimento.
  - Tracciamento per singolo set memorizzato in `completed_sets_records`.
  - Cronometro counting up (00:00 -> ...) per isometrie MAX.
  - Set History Bar interattiva con pillole dei set modificabili al volo.
  - Storico dettagliato in `WorkoutHistoryDetailPage.tsx` con badge e fiamma.
  - Calcolo volumi e TUT accurati in `src/utils/periodicReportEngine.ts`.
- **Sveglia di Recupero Hardware**:
  - Gestita nativamente da `@capacitor/local-notifications`, suona anche a schermo bloccato e offline.

---

## 6. Regole Operative e Comandi di Validazione

1. **Modifiche Chirurgiche**: Non modificare file non richiesti né effettuare refactoring proattivi.
2. **Nessuna dipendenza extra**: Non installare pacchetti senza esplicita autorizzazione.
3. **Validazione obbligatoria**:
   ```bash
   npx tsc -b
   npm run build
   ```
4. **Git**:
   - Committare con messaggio descrittivo e fare sempre `git push` sul branch attivo.

Per le regole operative dettagliate, consultare anche [.agents/rules/project_rules.md](file:///.agents/rules/project_rules.md) e [.agents/rules/project_context.md](file:///.agents/rules/project_context.md).
