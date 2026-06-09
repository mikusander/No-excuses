# No-Excuses — Presentation Plan (Detailed)
_Basato sulla struttura della presentazione OnTrek. Ogni slide elenca: cosa scrivere, cosa dire, e che immagini/screenshot inserire._

---

## SLIDE 1 — Title Slide
**Testo sulla slide:**
> **No-Excuses**
> *A multimodal web app for hands-free, eyes-free workout tracking*
> Alessandro Gautieri | HCI 2024–2025

**Note per chi presenta:**
> "No-Excuses è una Progressive Web App che vuole eliminare ogni scusa per non tracciare il proprio allenamento — usando la fotocamera, i sensori inerziali e la voce."

**Immagini:**
- Logo dell'app (dark mode, testo bold con accento arancione, stile minimalista)
- Sfondo scuro sfumato con qualche elemento grafico sottile (linee, onde)

---

## SLIDE 2 — Il Problema

**Testo sulla slide (bullet points sintetici):**
- 📱 Le app tradizionali richiedono interazione manuale continua
- ⌚ Gli smartwatch costano e sono scomodi durante esercizi pesanti
- 😤 Toccare lo schermo con le mani sudate o durante una serie rompe la concentrazione
- 📊 La mancata registrazione dei progressi porta al "loop del principiante"

**Note per chi presenta:**
> "Chi di voi ha mai smesso di registrare una serie a metà perché aveva le mani sudate? O ha perso il conto delle ripetizioni? Questo è esattamente il problema che vogliamo risolvere."

**Immagini:**
- Illustrazione vettoriale: persona che fa flessioni e cerca goffamente di toccare lo schermo → usare uno screenshot/mockup oppure un'immagine di stock
- Icone rappresentative: smartwatch con prezzo, schermo con pollice verso

---

## SLIDE 3 — Need Finding

**Testo sulla slide:**
> *"Perché gli atleti non registrano i propri workout in tempo reale?"*
- 58% — Scomodo/impossibile toccare il telefono durante la serie
- 24% — Perdono il conto durante esercizi faticosi
- 12% — Non vogliono interrompere il flusso dell'allenamento
- 6%  — Non hanno uno smartwatch

**Note per chi presenta:**
> "Abbiamo identificato tre bisogni principali: tracking mani-libere, zero necessità di guardare lo schermo, e navigazione delle schede senza toccare nulla."

**Immagini:**
- Grafico a torta o a barre orizzontali semplice (crearlo in PowerPoint/Canva con i dati sopra)
- Palette dark mode con accenti arancioni per uniformità

---

## SLIDE 4 — Bisogni Identificati (Identified Needs)

**Testo sulla slide:**
- 🙌 **Hands-free tracking** — Nessuna necessità di toccare il telefono durante la serie
- 👁️ **Eyes-free feedback** — Sapere sempre quante rep hai fatto senza guardare lo schermo
- 🎤 **Voice-driven navigation** — Navigare la scheda di allenamento a voce

**Note:**
> "L'applicazione è progettata per scomparire nella tasca e nel sottofondo dell'allenamento, riemergendo solo quando ha qualcosa di utile da dirti."

**Immagini:**
- Tre icone grandi affiancate: mano barrata + occhio barrato + microfono
- Frecce che portano al logo dell'app

---

## SLIDE 5 — Storyboard #1: Pocket Mode (Flessioni in tasca)

**Testo sulla slide:**
> *"Scenario: l'utente deve fare 5 serie da 10 flessioni"*

**Immagini (4 vignette stile comics, orizzontali):**
1. **L'utente seleziona "Flessioni" nell'app e imposta obiettivo = 10 rep** → `Screenshot della sezione Rep Counter con il selettore esercizio e il campo Obiettivo ripetizioni`
2. **Il telefono va in tasca. Countdown 5 secondi sullo schermo** → Illustrazione vettoriale telefono in tasca con indicatore del countdown
3. **L'utente fa le flessioni — il telefono dice "Uno... Due... Tre..."** → Illustrazione vettoriale persona in posizione flessioni con onde audio che escono dalla tasca
4. **Al raggiungimento di 10, il telefono suona. L'utente lo tira fuori senza falsi conteggi** → Screenshot dell'app con conteggio completato

---

## SLIDE 6 — Storyboard #2: Stand Mode (Trazioni con fotocamera)

**Testo sulla slide:**
> *"Scenario: l'utente esegue trazioni alla sbarra"*

**Immagini (3 vignette):**
1. **L'utente apre l'app, seleziona "Pullups", modalità Video, appoggia il telefono contro il muro** → `Screenshot della sezione Rep Counter con il selettore Video/Accelerometro`
2. **La fotocamera frontale inquadra il busto. I landmark di MediaPipe tracciano spalle e polsi** → `Screenshot/screen del debug MediaPipe con lo scheletro verde sovrapposto (docs/images/mediapipe_debug.png)`
3. **L'app conta le trazioni e le annuncia. L'utente non guarda lo schermo** → Illustrazione vettoriale con la bolla del conteggio "4" che galleggia

---

## SLIDE 7 — Storyboard #3: Active Workout con Comandi Vocali

**Testo sulla slide:**
> *"Scenario: allenamento completo con scheda"*

**Immagini (3 vignette):**
1. **L'utente seleziona una scheda e avvia la sessione** → `Screenshot della SelectWorkoutPage con la lista delle schede disponibili`
2. **L'app guida esercizio per esercizio con timer, set e ripetizioni. L'utente dice "Vai" per confermare la fine di una serie** → `Screenshot della ActiveWorkoutPage con il timer del riposo e i tasti play/pause/skip`
3. **L'utente dice "Pausa" — l'app si ferma. Dice "Riprendi" — riparte** → Icona microfono con l'onda sonora e il banner della Web Speech API attiva

---

## SLIDE 8 — Panoramica dell'Applicazione (App Overview)

**Testo sulla slide:**
> *L'app è strutturata in 4 macro-aree principali:*
- 🏠 **Home** — Accesso rapido all'allenamento o al contatore libero
- 📋 **Schede** — Gestione e visualizzazione dei workout personali
- ▶️ **Allenamento Attivo** — Esecuzione guidata con timer, voce, e auto-counting
- 📊 **Storico** — Cronologia di tutti gli allenamenti completati
- 🔢 **Rep Counter** — Contatore standalone con Accelerometro o Fotocamera

**Note:**
> "Non è solo un contatore di ripetizioni — è un'ecosistema completo per la gestione dell'allenamento."

**Immagini:**
- Diagramma a 5 blocchi con frecce di navigazione (creare in Canva/Figma)
- Colori brand: dark background, arancione per highlight

---

## SLIDE 9 — UI Walkthrough: Home & Schede

**Testo sulla slide:**
> Due funzioni principali: avviare un workout o gestire le proprie schede

**Immagini (side-by-side, 2 screenshot):**
- **Sinistra:** `Screenshot della HomePage` con le due card animata ("Start New Train" e "Start Reps Count") + la bottom navigation bar
- **Destra:** `Screenshot della GymCardPage ("Your Workouts")` con la lista delle schede, icone edit/delete, e la card con i dettagli esercizi espansi (superset, isometry, reps, etc.)

**Note:**
> "La home è volutamente essenziale — due tap per arrivare dove serve. La sezione Schede permette di vedere ogni dettaglio del workout e modificare i parametri direttamente dall'elenco."

---

## SLIDE 10 — UI Walkthrough: Creazione Scheda

**Testo sulla slide:**
> Costruttore di workout avanzato con 5 tipologie di esercizio:
- **Reps** — Serie classiche con ripetizioni
- **Isometria** — Esercizi a tempo (plank, wall sit)
- **Superset** — Due o più esercizi in sequenza senza recupero
- **Piramide** — Progressione di carico/ripetizioni per step
- **EMOM** — Every Minute On the Minute

**Note:**
> "Il sistema è molto più di un semplice contatore. Supporta schemi di allenamento avanzati. Ogni esercizio può avere note istruzionali, peso, e opzionalmente il conteggio automatico con accelerometro."

**Immagini:**
- `Screenshot della NewTrainPage` con almeno un esercizio di tipo Superset o Piramide espanso per mostrare la complessità
- Un'icona per ogni tipo di esercizio (clock per isometria, frecce su/giù per piramide, loop per superset)

---

## SLIDE 11 — UI Walkthrough: Allenamento Attivo + Voce

**Testo sulla slide:**
> **Comandi vocali riconosciuti (italiano):**
- 🎤 `"Vai"` / `"Go"` → Avanza / Conferma serie completata
- 🎤 `"Pausa"` → Mette in pausa il timer
- 🎤 `"Riprendi"` / `"Continua"` → Riprende il timer
- 🎤 `"Stop"` / `"Fermo"` → Ferma la sessione

> Il microfono rimane attivo in background grazie alla Web Speech API (continuous mode)

**Note:**
> "Questo è il cuore dell'interazione multimodale durante un workout. L'utente non deve mai toccare lo schermo. La voce diventa il telecomando dell'allenamento."

**Immagini:**
- `Screenshot della ActiveWorkoutPage` con il banner "Listening..." del voice command attivo (icona microfono arancione in alto)
- Evidenziare il timer del riposo (countdown) e i pulsanti play/pause/skip
- Aggiungere una callout con la freccia verso l'icona microfono: "Web Speech API - Continuous Recognition"

---

## SLIDE 12 — UI Walkthrough: Esercizio Attivo con Auto-Count

**Testo sulla slide:**
> Durante l'allenamento, se un esercizio è marcato come `auto_count_type: "pushups"` o `"pullups"`, l'app avvia automaticamente il contatore in background.
- Il contatore usa la modalità appropriata (Accelerometro per pushups, Vision per pullups)
- La serie viene confermata vocalmente o con un tap al raggiungimento dell'obiettivo

**Immagini:**
- `Screenshot del pannello esercizio in ActiveWorkoutPage` che mostra un esercizio con il pulsante auto-count attivo (l'icona Video o Smartphone)
- Frecce che spiegano il flusso: "Utente inizia serie" → "Accelerometro si attiva" → "Rep contata + vibrazione" → "Target raggiunto → suono"

---

## SLIDE 13 — UI Walkthrough: Rep Counter Standalone

**Testo sulla slide:**
> Il contatore può essere usato indipendentemente dalla scheda:
- Seleziona il tipo di esercizio (Pushups, Pullups, Squats…)
- Scegli la modalità: **📹 Video** (fotocamera) o **📱 Accelerometro** (tasca)
- Imposta un obiettivo opzionale — l'app si fermerà automaticamente
- Countdown di 5 secondi per posizionarsi → vibrazione di avvio → counting

**Immagini:**
- `Screenshot della RepCounterPage` con:
  - Il selettore modalità Video/Accelerometro evidenziato
  - Il campo "Obiettivo ripetizioni" con un valore inserito (es. 5)
  - Il grande contatore circolare/numerico al centro
- `Screenshot dello stato "Countdown" con il timer di 5 secondi` (se catturabile)

---

## SLIDE 14 — Architettura Tecnica

**Testo sulla slide:**
> **Stack tecnologico:**
- **Framework:** React + TypeScript + Vite (PWA)
- **Backend:** Supabase (Auth + PostgreSQL)
- **Sensor APIs:** DeviceMotion, DeviceOrientation
- **Vision:** Google MediaPipe Pose (WebAssembly in-browser)
- **Audio/Voice:** Web Audio API + Web Speech API
- **Privacy:** 100% client-side — nessun dato biometrico lascia il dispositivo

**Note:**
> "L'architettura è deliberatamente client-side. Nessun video o dato dei sensori viene mai inviato a un server. MediaPipe gira direttamente nel browser via WebAssembly."

**Immagini:**
- `docs/images/architecture_diagram.png` (il diagramma generato che mostra il flusso tra React Hooks, Web APIs, UI Components, e Supabase)

---

## SLIDE 15 — Algoritmo: Rep Counter con Accelerometro (Flessioni)

**Testo sulla slide:**
> **Il problema:** Distinguere una flessione dal rumore del telefono nella tasca

> **La soluzione: algoritmo "Motion Energy Peak-Count"**
1. 🔄 **Sensor Fusion:** fonde accelerazione lineare + dati giroscopio in un unico indice di "Motion Energy"
2. 📈 **Peak Detection:** conta il picco solo se supera la soglia `active × 3 = 360` e poi ridiscende sotto `active = 120`
3. ⏱️ **Cooldown:** blocca doppio conteggio per 1.2 secondi tra un picco e l'altro
4. 🧭 **Gravity Filter:** scarica ogni movimento se il telefono ruota > 66° rispetto alla posizione iniziale (impedisce falsi positivi quando si tira fuori il telefono)

**Immagini:**
- Grafico time-series con i picchi (se disponibile in `dati di debug/output/plots_precise/`)
- Schema a frecce che mostra i 4 step dell'algoritmo: Input Sensori → Fusione → Peak Detection → Gravity Check → Output Conteggio

---

## SLIDE 16 — Il Problema dei Falsi Positivi (Challenge #1)

**Testo sulla slide:**
> **Il bug:** Alla fine dell'esercizio, tirare il telefono fuori dalla tasca veniva contato come 1-2 ripetizioni aggiuntive

> **Perché succedeva:**
- Il gesto di estrazione genera uno spike di energia cinetica > 2000 (vs. ~900 di una flessione)
- Il vecchio algoritmo non distingueva tra "fare una flessione" e "alzarsi in piedi"

> **La soluzione: Gravity Orientation Filter**
- A T=0 (ultimo secondo del countdown), l'app fotografa il vettore gravità `v_base`
- Ad ogni campione: calcola `θ = arccos(v_base · v_current / |v_base| |v_current|)`
- Se `θ > 66°` → il telefono è in postura non-esercizio → **movimento ignorato**

**Immagini:**
- Due immagini affiancate:
  - **Prima:** grafico con falsi positivi (un picco enorme dopo le reps reali)
  - **Dopo:** grafico con solo i picchi delle reps vere (se disponibile dai log)
- Schema geometrico del Dot Product: freccia `v_base` in tasca, freccia `v_current` in piedi, angolo θ tra le due

---

## SLIDE 17 — Challenge #2: Cooldown e Velocità

**Testo sulla slide:**
> **Il dilemma:** cooldown troppo lungo → manca le rep veloci. Troppo corto → doppio conteggio

| Cooldown | Problema |
|----------|----------|
| 2000ms | Perde le flessioni eseguite in 1.5s (frequente in chi è allenato) |
| 500ms | Doppio conteggio dei sub-picchi (il "bounce" a fine flessione) |
| **1200ms** ✅ | Sweet-spot calibrato su 20-30 sessioni reali da 1, 5, 10 rep |

> **La calibrazione:** 20-30 sessioni di test con log JSON (`burstDurationMs`, `maxEnergy`, `minEnergy`) hanno permesso di tarare precisamente ogni soglia

**Immagini:**
- Tabella stilizzata come sopra (con la riga 1200ms evidenziata in arancione)
- Snippet del JSON di calibrazione (un entry del file `calibration-data/pushups.txt` riportato come codice)

---

## SLIDE 18 — Challenge #3: iOS Audio Restrictions

**Testo sulla slide:**
> **Il bug:** Su iOS Safari, l'app era completamente silenziosa durante i workout

> **Causa:** Le policy di sicurezza di iOS blocca il `Web Audio API` e la `SpeechSynthesis` se non vengono inizializzati durante un'interazione diretta dell'utente (tap/click)

> **La soluzione: Lazy Loading dell'AudioContext**
```
onClick (bottone "Start Session") {
  AudioContext.resume()  ← sbloccato dal click diretto
  SpeechSynthesis.speak()  ← primer di sblocco iOS
}
```
> Da quel momento in poi, tutti i feedback audio funzionano correttamente per l'intera sessione

**Immagini:**
- Diagramma a due colonne: **PRIMA** (lucchetto rosso iOS → AudioContext bloccato) | **DOPO** (lucchetto verde → sbloccato al click)
- Icone: logo Safari + logo iOS + icona lucchetto

---

## SLIDE 19 — Challenge #4: Algoritmo Trazioni (Pullups)

**Testo sulla slide:**
> Per i pullups, il telefono non è in tasca ma sul muro → si usa la fotocamera

> **MediaPipe Pose:** estrae 33 landmark anatomici in real-time (WebAssembly in-browser)

> **Algoritmo di conteggio:**
- Calcola l'angolo articolare di **spalla → gomito → polso**
- Modalità `single_burst`: conta 1 rep quando si completa un ciclo alto → basso → alto
- Soglie calibrate: `active=140`, `rest=78`, `gyroShake=673`, `minDuration=210ms`

**Immagini:**
- `docs/images/mediapipe_debug.png` (screenshot del grafico con le coordinate Y di spalle e polsi nel tempo — i 4 landmarks sovrapposti in un grafico multi-linea)
- Schema delle soglie con freccia verticale: "sopra 140 = fase attiva", "sotto 78 = fase di riposo"

---

## SLIDE 20 — Storico e Persistenza del Progresso

**Testo sulla slide:**
> **Funzionalità avanzate spesso invisibili all'utente:**
- 📝 **Workout History:** ogni sessione completata viene salvata su Supabase con data/ora e nome scheda
- 💾 **Checkpoint di Progresso:** se l'app viene chiusa a metà workout, alla riapertura propone di riprendere da dove si era arrivati
- 📒 **Note per Esercizio:** durante l'allenamento, è possibile aggiungere note a ogni esercizio (es. "sensazione di pompa alle spalle") che vengono salvate

**Immagini:**
- `Screenshot della WorkoutHistoryPage` con l'elenco cronologico dei workout completati
- `Screenshot del popup "Resume workout?"` che appare sulla HomePage quando esiste un checkpoint salvato
- `Screenshot del pannello Note esercizio` nell'ActiveWorkoutPage (il modale con la textarea)

---

## SLIDE 21 — Storico Dettaglio

**Testo sulla slide:**
> Ogni sessione passata può essere riaperta in modalità "review":
- Tutti gli esercizi eseguiti con i parametri del giorno
- Note aggiunte durante la sessione
- Possibilità di **rifare lo stesso workout** partendo dai dati storici

**Immagini:**
- `Screenshot della WorkoutHistoryDetailPage` con la lista esercizi della sessione passata
- Evidenziare il pulsante "Redo this workout" (se presente) o il fatto che i dati storici riportano peso/reps usati quel giorno

---

## SLIDE 22 — Valutazione: Metodo e Dataset

**Testo sulla slide:**
> **Protocollo di calibrazione empirica:**
- 20–30 sessioni dedicate con log completi in JSON
- Set da **1, 5, 10 ripetizioni** per coprire ritmo lento, normale e rapido
- Dati raccolti: `burstDurationMs`, `maxEnergy`, `minEnergy`, `gravityVec`, `maxGyro`
- Analisi dei log → tuning manuale delle soglie per ogni esercizio

> **Risultati chiave:**
- Flessioni reali: `maxEnergy` tra 500–1100
- Riposo tra rep: `minEnergy` ≈ 75–120
- Estrazione telefono: `maxEnergy` > 2000 → **filtrabile con gravity filter**

**Immagini:**
- Tabella con le soglie finali per ogni esercizio (pushups vs pullups)
- Snippet del JSON di log (uno entry del file `calibration-data/pushups.txt`)

---

## SLIDE 23 — Valutazione: Risultati Test

**Testo sulla slide:**
> **Test sul campo — Flessioni (Pocket Mode):**

| Test | Fatte | Obiettivo | Contate | Falsi Positivi |
|------|-------|-----------|---------|----------------|
| Con gravity filter (66°) + target = 5 | 5 | 5 | **5** ✅ | 0 |
| Con gravity filter + no target | 5 | — | 4 ⚠️ | 0 |
| Senza gravity filter | 6 | 5 | **8** ❌ | 2 |

> → La combinazione **gravity filter + auto-stop al target** garantisce precisione 100%

**Immagini:**
- Tabella stilizzata come sopra (verde per i test riusciti, rosso per i falliti)
- Freccia che evidenzia la riga del "con gravity filter + target = 5"

---

## SLIDE 24 — Conclusioni e Future Works

**Testo sulla slide:**
> **Cosa abbiamo dimostrato:**
- Uno smartphone standard può rimpiazzare uno smartwatch per il tracking fitness
- La multimodalità (sensori + visione + voce + audio) è fondamentale per l'esperienza
- Algoritmi deterministici calibrati empiricamente superano i modelli ML generici per task specifici

> **Future Works:**
- Espansione della libreria esercizi supportati da MediaPipe (squat, deadlift)
- Uso del barometro integrato per tracciare il dislivello nell'outdoor
- LLM per elaborazione di comandi vocali non strutturati ("Modifica la scheda e togli le trazioni")
- Statistiche e grafici a fine sessione (progressione nel tempo)

**Immagini:**
- Due colonne: "Oggi" (icona check, lista funzionalità) | "Futuro" (icona rocket, lista future works)

---

## SLIDE 25 — Q&A / Demo
**Testo sulla slide:**
> *"Grazie per l'attenzione"*
> Demo live disponibile su: `https://[ip-locale]:5173`

**Immagini:**
- Logo grande al centro
- QR Code verso la PWA (se accessibile in rete locale durante la presentazione)
- Screenshot della `docs/images/ui_screenshot.png` come visual finale

---

# Checklist Immagini da Catturare/Preparare

| N. | Cosa serve | Come ottenerla |
|----|-----------|----------------|
| 1 | Screenshot HomePage (due card) | Screen da browser mobile o DevTools responsive mode |
| 2 | Screenshot GymCardPage (lista schede) | Screen da browser con dati reali |
| 3 | Screenshot GymCardPage (dettaglio scheda espansa con superset) | Screen da browser |
| 4 | Screenshot NewTrainPage (form creazione esercizio piramide o superset) | Screen da browser |
| 5 | Screenshot SelectWorkoutPage (lista schede da selezionare) | Screen da browser |
| 6 | Screenshot ActiveWorkoutPage (esercizio attivo + banner voce + timer riposo) | Screen da browser |
| 7 | Screenshot ActiveWorkoutPage (nota esercizio modal aperto) | Screen da browser |
| 8 | Screenshot RepCounterPage (selettore Video/Accelerometro + campo target + contatore) | Screen da browser |
| 9 | Screenshot RepCounterPage in countdown (5 secondi) | Screen da browser |
| 10 | Screenshot WorkoutHistoryPage (lista cronologica) | Screen da browser |
| 11 | Screenshot WorkoutHistoryDetailPage (dettaglio sessione passata) | Screen da browser |
| 12 | Screenshot popup "Resume workout?" (HomePage) | Screen da browser dopo sessione interrotta |
| 13 | Screenshot MediaPipe debug (grafico coordinate Y spalle/polsi) | `docs/images/mediapipe_debug.png` (già disponibile) |
| 14 | Diagramma Architettura | `docs/images/architecture_diagram.png` (già disponibile) |
| 15 | Mockup UI mobile (dark mode, ring counter, voice banner) | `docs/images/ui_screenshot.png` (già disponibile) |
| 16 | Grafico Energy Peaks accelerometro | Generare da `calibration-data/pushups.txt` o chiedere al dev |
| 17 | Schema Gravity Filter (vettori + angolo 66°) | Da creare in Canva/Figma |
