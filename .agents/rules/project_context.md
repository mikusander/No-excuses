# Contesto Architetturale e Configurazione di Progetto — No-Excuses

Questo documento raccoglie la configurazione completa, la memoria di sviluppo e le decisioni architetturali del progetto **No-Excuses**, affinché qualsiasi sessione dell'agente AI abbia sempre il quadro completo dell'applicazione.

---

## 1. Visione del Progetto e Filosofia

- **Nome dell'Applicazione**: No-Excuses (Workout Tracker Multimodale).
- **Obiettivo**: Tracciamento dell'allenamento "hands-free" e "eyes-free", senza necessità di smartwatch, sfruttando sensori del telefono (accelerometro/giroscopio in tasca), computer vision locale (MediaPipe per trazioni/piegamenti), sintesi vocale e gestione timer.
- **Piattaforme Target**:
  - **iPhone (App Nativa via Capacitor)**: L'ambiente primario utilizzato dall'utente finale durante gli allenamenti in palestra.
  - **Web App / PWA**: PWA installabile e accessibile via browser.
- **Strategia a Singola Codebase**:
  - **Unica base di codice condivisa** (React + TypeScript + Tailwind CSS). Non esistono due progetti separati: la stessa applicazione viene compilata per il web e impacchettata nel contenitore iOS tramite Capacitor.

---

## 2. Setup di Sviluppo & Ambiente Utente

- **Sistema Operativo dell'Utente**: **Windows**.
- **Dev Server Locale**: Vite in esecuzione su `http://localhost:5173` (e accessibile in LAN all'indirizzo configurato in `capacitor.config.ts`, es. `http://10.10.111.194:5173` per live-reload su dispositivo).
- **Branch Git Attivi**:
  - `main`: Ramo di produzione stabile, collegato a GitHub Actions.
  - `restyling`: Ramo corrente dedicato al restyling Apple HIG e rifinitura UI.
- **Regola Git**: Ogni commit deve avere un messaggio descrittivo ed essere **immediatamente inviato con `git push`** sul branch attivo.

---

## 3. Pipeline di Compilazione iOS & Deployment (Windows + AltServer)

Dato che l'utente sviluppa su Windows (dove non è possibile eseguire Xcode nativamente):

### A. Compilazione Automatica su GitHub Actions (`.github/workflows/build-ios.yml`)
- A ogni push su `main` (o trigger manuale `workflow_dispatch`), un runner Mac (`macos-15`) compila:
  1. La build web (`npm run build`).
  2. La sincronizzazione Capacitor (`npx cap sync ios`).
  3. L'archivio Xcode per iOS (`xcodebuild archive`).
  4. La creazione del pacchetto IPA non firmato:
     - **`NoExcuses.ipa`** (versione di produzione standalone offline).
     - **`NoExcuses-Dev.ipa`** (versione di sviluppo con live-reload dall'IP locale del PC).
  5. Il caricamento dei file `.ipa` come **GitHub Artifacts** scaricabili.

### B. Installazione e Sideloading tramite AltServer / AltStore
- L'utente installa l'app sul proprio iPhone tramite **AltServer per Windows**.
- **Limite dei 7 giorni di Apple (Free Developer Account)**:
  - Apple impone la scadenza del certificato gratuito dopo 7 giorni.
  - **Se AltStore si apre ancora**: Si preme *"Refresh All"* nella scheda *My Apps* di AltStore su iPhone (con AltServer aperto su PC e connessi alla stessa rete Wi-Fi).
  - **Se i 7 giorni sono scaduti e l'app non si apre più**: Si collega l'iPhone via USB al PC Windows, si clicca sull'icona di AltServer nella barra delle applicazioni -> *"Install AltStore"* -> si inserisce l'Apple ID. Poi si riapre AltStore su iPhone per rinnovare *No Excuses*.
  - **Installazione nuova versione**: Si scarica `NoExcuses.ipa` dagli artifacts di GitHub Actions direttamente su iPhone e si tocca il pulsante `+` in AltStore.

---

## 4. Design System & Stile iOS Nativo (Apple Human Interface Guidelines)

L'interfaccia adotta i principi visivi di Apple iOS Dark Mode:

### A. Palette Colori & Token (`src/index.css`)
- **Sfondo Principale**: OLED Black `#000000` (`--color-brand-dark`).
- **Superficie Card Primaria**: `#1C1C1E` (*Apple System Background Secondary* / `--color-brand-card` e `--color-brand-darkgrey`) con bordi sottilissimi semitrasparenti `border-white/10` e raggio `rounded-3xl` (stile *Inset Grouped*).
- **Superficie Secondaria / Chip**: `#2C2C2E` (`--color-brand-surface`).
- **Accento Dinamico**: Arancione atletico vibrante `#FF5E00` (`--color-brand-orange`, con variante light `#FF7724`), brillante ed energico per bottoni di azione e focus.

### B. Safe Area Dinamica & Navigazione
- **Top Safe Area**: Gestita in `AppHeader.tsx` e `HeaderLogo.tsx` con `pt-[env(safe-area-inset-top,0px)]`, consentendo al vetro satinato (`backdrop-blur-2xl bg-black/75`) di estendersi dietro la Dynamic Island o il Notch.
- **Bottom Tab Bar (`BottomNavigation.tsx`)**:
  - Posizionamento dinamico sopra la barra gesture di iOS: `bottom: max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))`.
  - Stile *Liquid Glass*: `bg-[#1C1C1E]/85 backdrop-blur-[32px] saturate-[1.8] border border-white/10`.
  - Buffer inferiore sui container di scroll: classe utility `.safe-pb-nav` (`padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 6.5rem)`), per evitare che l'ultimo contenuto venga coperto dalla barra flottante.

### C. Motore Aptico Nativo (`src/utils/haptics.ts`)
- Basato su `@capacitor/haptics` con gestione sicura degli errori (nessun crash su desktop/browser):
  - `hapticLight()`: cambio scheda, selezione pillole/filtri.
  - `hapticMedium()`: salvataggi, stepper `+1/-1`, bottoni principali.
  - `hapticHeavy()`: eliminazione elementi, reset, logout.
  - `hapticSuccess()`: completamento allenamento, timer recupero concluso.

### D. Componente Header Unificato (`src/components/AppHeader.tsx`)
- Intestazione standard per tutte le schermate, con supporto per tasto Indietro nativo (chevron iOS e aptica), titolo, sottotitoli e pulsanti azione a destra.

---

## 5. Architettura Dati & Persistenza (Supabase + Offline-First)

### A. Tabelle Database (Supabase)
- **`schede`**: Schede di allenamento dell'utente (`id`, `id_utente`, `nome`, `created_at`, ecc.).
- **`esercizi`**: Esercizi collegati alla scheda (`id_scheda`, `nome`, `tipo`, `serie`, `ripetizioni`, `recupero_secondi`, `tempo_recupero`, `note`, `ordine`).
- **`workout_run`**: Sessioni di allenamento completate (`id`, `id_scheda`, `id_utente`, `workout_name_snapshot`, `exercises_snapshot`, `created_at`).
- **`note_workout`**: Note e promemoria associati alla sessione (`id_workout_run`, `id_utente`, `note`).
- **`profili`**: Profilo utente (`id_utente`, `username`, `voice_assistant`, `updated_at`).

### B. Resilienza & Snapshot Immutabile (`src/lib/workoutSchemaAdapter.ts`)
- Quando un allenamento viene completato, l'intero stato degli esercizi (inclusi i singoli set registrati) viene serializzato in `exercises_snapshot` come JSON immutabile.
- Le funzioni `toSafeInt` e `toSafeDecimal` garantiscono la conversione sicura dei dati senza eccezioni.

### C. Checkpoint Sessione e Ripresa Automatica (`src/lib/workoutProgressStorage.ts`)
- Durante l'allenamento attivo, ogni progresso viene salvato su `localStorage` in tempo reale.
- Se l'utente ricarica la pagina o riapre l'app, la Home propone un modal di ripresa immediata senza perdita di set o timer.

### D. Organizzazione Schede in Cartelle e Sincronizzazione Cloud (`src/utils/folderManager.ts`)
- Sistema di cartelle personalizzate per organizzare le schede (`workout_folders_v1:${userId}` e `workout_folder_assignments_v1:${userId}`).
- **Architettura Offline-First con Cloud Sync su Supabase**:
  - Le cartelle e le relative assegnazioni vengono salvate localmente in `localStorage` per zero latenza e supporto offline.
  - A ogni modifica locale (o all'avvio sessione in `AuthContext`, `GymCardPage`, `SelectWorkoutPage`), una sincronizzazione bidirezionale (`pushFoldersToCloud` con debounce e `syncFoldersWithCloud`) salva e preleva i dati da `user_metadata` dell'utente autenticato su Supabase (`supabase.auth.updateUser`).
  - Questo garantisce che le cartelle create su PC o browser appaiano automaticamente sull'iPhone (e viceversa), senza necessitare di migrazioni SQL DDL o tabelle aggiuntive.

---

## 6. Meccaniche di Allenamento Avanzate

### A. Tipologie di Esercizio Supportate
1. **Reps standard**: Serie con numero prefissato di ripetizioni.
2. **Isometrie**: Esecuzioni a tempo (secondi di tenuta, es. Plank).
3. **Superset**: Due o più esercizi eseguiti in successione con recupero intermedio o finale.
4. **Circuiti**: Sequenze di stazioni con giri multipli e recupero di transizione/giro.
5. **EMOM (Every Minute On the Minute)**: Serie da completare allo scoccare di ogni minuto.
6. **Piramidali**: Carichi crescenti/decrescenti con ripetizioni scalari.

### B. Tracciamento a Sfinimento (MAX Reps / MAX Isometria)
- Riconosciuto per ogni esercizio o sotto-esercizio con:
  - **Ripetizioni MAX**: `reps === 0`.
  - **Isometria MAX**: tipo `isometry` con `duration_seconds === 0`.
- **Durante il workout (`ActiveWorkoutPage.tsx`)**:
  - Stepper rapido touch (`-5`, `-1`, input diretto, `+1`, `+5`).
  - **Cronometro in avanti per isometrie MAX**: parte da 00:00 e salva i secondi esatti resistiti nel set corrente al tocco di pausa.
  - **Set History Bar Interattiva (Pillole)**: mostra lo stato di ogni singolo set (`Set 1: 15 reps`, `Set 2: 12 reps`...), con pulsante matita per modificare qualsiasi set precedente al volo.
  - Card di riepilogo set appena completato durante la schermata di recupero.
- **Salvataggio & Storico**:
  - I record per set sono salvati nell'array `completed_sets_records: (number | null)[]` sia nello snapshot che nelle note automatiche.
  - Visualizzati nello storico dettagliato ([WorkoutHistoryDetailPage.tsx](file:///c:/Users/MICHELANGELO/No-excuses/src/pages/WorkoutHistoryDetailPage.tsx)) con badge dedicati e icona fiamma.
  - Integrati nell'unpacker di [periodicReportEngine.ts](file:///c:/Users/MICHELANGELO/No-excuses/src/utils/periodicReportEngine.ts) per il calcolo preciso del volume totale di lavoro e TUT.

### C. Sveglia Hardware di Recupero per iOS (`src/utils/workoutNotifications.ts`)
- Su iPhone, il recupero programma una sveglia locale tramite `@capacitor/local-notifications`.
- La sveglia è gestita dal chip del telefono in background: **suona e vibra puntuale anche se lo schermo è bloccato o se si esce dall'app**, senza dipendere da internet o push esterni.

### D. Parser Schede & Apprendimento Correzioni
- Import rapido di testo o foto schede tramite OCR locale ([tesseract.js](file:///c:/Users/MICHELANGELO/No-excuses/src/hooks/useLocalOcr.ts)) e tokenizer intelligente ([src/utils/parseWorkoutInput.ts](file:///c:/Users/MICHELANGELO/No-excuses/src/utils/parseWorkoutInput.ts)).
- Memoria correzioni utente ([src/utils/userCorrectionsManager.ts](file:///c:/Users/MICHELANGELO/No-excuses/src/utils/userCorrectionsManager.ts)): memorizza come l'utente corregge i nomi o i formati degli esercizi e li applica automaticamente alle scansioni future.

---

## 7. Vincoli di Sviluppo Vincolanti per l'Agente AI

1. **`verbatimModuleSyntax` e `erasableSyntaxOnly`**:
   - Obbligatorio usare `import type` per tutti i tipi.
   - Vietati gli `enum` TypeScript (usare union types di stringhe).
2. **Nessuna Nuova Dipendenza**:
   - Non installare pacchetti npm extra senza permesso esplicito dell'utente.
3. **Integrità `.env` e Credenziali**:
   - Non modificare né creare file di ambiente o chiavi segrete.
4. **Approccio Chirurgico**:
   - Modificare esclusivamente i file e le funzioni richieste. Non effettuare mai refactoring collaterali o pulizie non sollecitate.
5. **Comandi di Validazione Obbligatori**:
   - Prima di considerare un lavoro completato, eseguire sempre:
     ```bash
     npx tsc -b
     npm run build
     ```
   - Entrambi devono concludersi con **0 errori** (exit code 0).
6. **Commit & Push Automatico**:
   - Eseguire sempre `git add`, `git commit` e `git push` sul branch attivo al termine di ogni task.
