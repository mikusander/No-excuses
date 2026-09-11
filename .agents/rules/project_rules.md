# Regole di Progetto — No-Excuses

Questo documento stabilisce le regole operative, le convenzioni architetturali e i vincoli vincolanti per qualsiasi agente AI che operi in questa codebase.

---

## 1. Stack Tecnologico

- **Runtime & Modulo**: Node.js, ECMAScript Modules nativo (`"type": "module"` in `package.json`).
- **Build Tool & Dev Server**: Vite 8 (`vite@^8.0.1`), `@vitejs/plugin-react@^6.0.1`.
- **Linguaggio**: TypeScript 5.9 (`typescript@~5.9.3`), Target `ES2023`, Libs `["ES2023", "DOM", "DOM.Iterable"]`.
  - **Vincolo TypeScript**: Attivo `"verbatimModuleSyntax": true` (obbligatorio usare `import type`).
  - **Vincolo Sintassi**: Attivo `"erasableSyntaxOnly": true` (vietati `enum`, `namespace`, costrutti non cancellabili nativamente).
- **Framework UI**: React 19 (`react@^19.2.4`, `react-dom@^19.2.4`).
- **Routing**: React Router DOM v7 (`react-router-dom@^7.13.2`), configurazione SPA dichiarativa in `src/App.tsx`.
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite@^4.2.2`, `tailwindcss@^4.2.2`). Tema custom dichiarato tramite `@theme` in `src/index.css`.
- **Database & Auth**: Supabase JS Client v2 (`@supabase/supabase-js@^2.100.1`), singleton in `src/lib/supabase.ts`.
- **PWA & Offline**: `vite-plugin-pwa@^1.3.0` con strategia `injectManifest`, custom service worker in `src/sw.ts`, Workbox v7.
- **Sensori, Computer Vision & Audio**:
  - Google MediaPipe Pose (`@mediapipe/tasks-vision@^0.10.34`) via WebAssembly su client.
  - OCR locale: `tesseract.js@^7.0.0`.
  - Sensori browser: Web APIs native (`DeviceMotionEvent`, `DeviceOrientationEvent`, `WakeLock`, `DocumentPictureInPicture`, `AudioContext`, `SpeechSynthesis`, `webkitSpeechRecognition`).
- **Notifiche Push & Serverless**:
  - `web-push@^3.6.7` con protocollo VAPID.
  - Serverless functions Node/TS in `api/schedule-push.ts` e `api/cancel-push.ts` (Vercel runtime + dev server middleware in `vite.config.ts`).
- **Linter**: ESLint 9 (`eslint.config.js`) con `@typescript-eslint/recommended`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`.
- **Test Runner**: Nessun framework di test unitario/e2e installato (no Jest/Vitest/Cypress).

---

## 2. Architettura e Struttura

La collocazione dei file segue rigorosamente la separazione per responsabilità:

```text
src/
├── components/   # Componenti React riutilizzabili, toolbar, card, modali UI (PascalCase.tsx)
├── context/      # Context provider React globali (es. AuthContext.tsx)
├── hooks/        # Custom hook React (camelCase con prefisso use: useXxx.ts)
├── lib/          # Integrazioni esterne, client DB, storage locale e adapter di schema (camelCase.ts)
├── logic/        # Logica di dominio ed elaborazione algoritmi pura (es. exerciseTracker.ts)
├── pages/        # Componenti pagina associati alle rotte in App.tsx (PascalCase terminanti in Page.tsx)
├── utils/        # Funzioni pure di utilità, tokenizer, parser, media/audio manager (camelCase.ts)
├── types.ts      # Definizioni TypeScript globali condivise
├── sw.ts         # Service Worker PWA custom
├── index.css     # Entry point Tailwind v4, direttiva @theme e safe-area CSS
├── main.tsx      # Entry point React e registrazione PWA Service Worker
└── App.tsx       # Albero di routing e ProtectedRoute
api/              # Endpoint Serverless per Vercel (kebab-case.ts)
public/           # Asset statici (modelli MediaPipe, audio wav/mp3, icone PWA, manifest)
```

### Regole di Naming e Collocazione
- **Pagine (`src/pages/`)**: Solo componenti con suffisso `Page` (es. `HomePage.tsx`, `GymCardPage.tsx`, `NewTrainPage.tsx`).
- **Componenti (`src/components/`)**: Componenti UI puri o con logica locale. PascalCase (es. `WorkoutCard.tsx`, `WorkoutExerciseRow.tsx`).
- **Hook (`src/hooks/`)**: Prefisso `use` obbligatorio, file `.ts` (o `.tsx` solo se restituiscono JSX).
- **Logica di Business & Algoritmi (`src/logic/` e `src/utils/`)**: Separare la logica computazionale (rilevamento ripetizioni, parser testo, tokenizer schede) dai componenti React.
- **Modelli & Schemi (`src/lib/` o `src/types.ts`)**: I tipi per la conversione DB-to-UI vanno collocati in `src/lib/workoutSchemaAdapter.ts`; i tipi generici condivisi vanno in `src/types.ts`.
- **Test**: Non creare file o cartelle `__tests__` o `*.test.ts` a meno che non sia stato esplicitamente concordato e installato un test runner.

---

## 3. Convenzioni di Codice

- **Typing Stretto & Import di Tipi**:
  - `verbatimModuleSyntax` è attivo: gli import di tipi **devono** usare la sintassi esplicita `import type { Foo } from '...'` o `import { type Foo, bar } from '...'`. L'omissione di `type` causa fallimento della compilazione.
  - Vietati gli `enum` TypeScript (incompatibili con `erasableSyntaxOnly`): utilizzare union type di stringhe (es. `type ExerciseType = 'reps' | 'isometry' | 'superset' | 'circuit' | 'emom' | 'pyramid';`) o costanti congelate (`const Options = { ... } as const`).
  - Evitare `any`. Usare tipi definiti, union o `unknown` con guardie di tipo (`typeof`, `Number.isFinite`).
- **Immutabilità dello Stato React**:
  - Non mutare mai oggetti o array direttamente nello state o nei ref. Usare sempre shallow/deep copy (`[...prev, newItem]`, `{ ...prev, key: value }`).
- **Resilienza e Conversione Dati Supabase / Storage**:
  - I dati provenienti dal DB o da `localStorage` non sono garantiti: usare sempre helper sicuri di casting con fallback numerico (es. `toSafeInt`, `toSafeDecimal` in `workoutSchemaAdapter.ts`).
  - Proteggere ogni lettura/scrittura su `localStorage` e `sessionStorage` con blocchi `try/catch` (evita crash su browser con storage bloccato o quote esaurite).
- **Gestione Lifecycle e Risorse Hardware**:
  - Ogni `useEffect` che registra listener (`addEventListener`), timer (`setTimeout`, `setInterval`), stream video webcam (`MediaStream`), context audio (`AudioContext`) o sensori (`devicemotion`) **deve** implementare la relativa funzione di cleanup.
- **Stile e Palette Grafica**:
  - Utilizzare esclusivamente le variabili cromatiche definite nel design system in `src/index.css`:
    - Sfondo primario: `bg-brand-dark` (`#000000`)
    - Accento primario: `bg-brand-orange` / `text-brand-orange` (`#B34800`)
    - Accento secondario/hover: `bg-brand-lightorange` (`#C45A00`)
    - Testo/Bordi chiari: `text-brand-grey` / `border-brand-grey` (`#D9D9D9`)
    - Sfondi card/pannelli: `bg-brand-darkgrey` (`#4A4A4A`)
  - Layout mobile-first: rispettare sempre le safe area iOS (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`).

---

## 4. Vincoli Operativi per l'Agente (Cosa NON fare)

- **Divieto di Installare Dipendenze**: NON eseguire `npm i`, `npm install`, `yarn add`, `pnpm add` o modificare i blocchi `dependencies` / `devDependencies` in `package.json` senza previa richiesta esplicita dell'utente.
- **Divieto di Manipolare File Sensibili ed Environment**:
  - NON leggere, modificare, creare o cancellare file `.env`, `.env.*`, certificati nella cartella `.cert` o credenziali/chiavi VAPID e Supabase.
- **Divieto di Modificare la Configurazione di Build e PWA**:
  - NON alterare `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js` o `src/sw.ts` a meno che il prompt non richieda esplicitamente modifiche di configurazione.
- **Nessun File Residuo**: NON creare script temporanei, scratchpad o file di dump all'interno dell'albero `src/` o nella root del repository.

### ⚠️ Divieto Assoluto di Modifiche Extra e Non Richieste (REGOLA FONDAMENTALE)

1. **Principio "Se non è richiesto, NON esiste":**
   - Modifica **esclusivamente** il file, la funzione o il blocco di codice esplicitamente indicato nella richiesta dell'utente.
   - È **severamente vietato** toccare, modificare, "migliorare", ripulire o rifattorizzare parti di codice adiacenti o altri file, anche se noti codice legacy, inefficiente, ridondante o migliorabile. Se funziona e non è nell'ordine di lavoro esplicito, **NON TOCCARLO**.

2. **Divieto di Modifiche Proattive o "Già che ci siamo":**
   - Non aggiungere mai controlli extra, parametri facoltativi, refactoring estetici, riscritture di import o nuove utility se non sono l'oggetto centrale della richiesta.
   - Non riscrivere o sostituire intere funzioni se il cambio richiede solo 1 o 2 righe (preferire sempre e categoricamente la modifica chirurgica / diff minimale).

3. **Integrità del Comportamento Esistente:**
   - Preserva sempre al 100% tutte le funzioni, variabili, commenti e interfacce esistenti non correlate alla richiesta.
   - Non eliminare o riscrivere logiche funzionanti già validate dall'utente per "adeguarle" a nuovi pattern o gusti stilistici.

4. **Regola di Verifica del Diff (`git diff` check):**
   - Prima di considerare conclusa qualsiasi modifica, l'agente deve controllare che il diff contenga **unicamente** le righe strettamente indispensabili per soddisfare il prompt. Se nel diff compaiono modifiche collaterali o file non richiesti, l'agente deve annullarle immediatamente.

5. **In caso di ambiguità o dipendenze:**
   - Se per risolvere un problema ritieni necessario toccare anche altre parti di codice non menzionate, **fermati e chiedi prima conferma esplicita all'utente** spiegando il motivo, SENZA procedere autonomamente.

---

## 5. Comandi di Verifica

Eseguire questi comandi nell'ordine indicato per validare qualsiasi modifica apportata al codice:

1. **Validazione Tipi TypeScript**:
   ```bash
   npx tsc -b
   ```
   *Verifica sia `tsconfig.app.json` che `tsconfig.node.json`. Deve terminare con exit code 0 e senza errori.*

2. **Validazione Build di Produzione e PWA**:
   ```bash
   npm run build
   ```
   *Esegue `tsc -b && vite build`, verificando la corretta generazione del bundle Vite e la compilazione del Service Worker (`injectManifest`). Deve completarsi senza errori.*

3. **Controllo Linter sui File Modificati**:
   ```bash
   npx eslint <percorso-file-modificato>
   ```
   *Assicurarsi che il file modificato non introduca nuovi errori di linter o violazioni TypeScript.*

4. **Avvio Server di Sviluppo (Verifica Manuale)**:
   ```bash
   npm run dev
   ```
   *Avvia il dev server Vite locale con supporto HTTPS (se configurato) e proxy middleware per le notifiche push.*
