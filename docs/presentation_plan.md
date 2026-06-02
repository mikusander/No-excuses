# No-Excuses: Presentation Plan

Questa guida illustra la struttura slide-by-slide per la presentazione del progetto "No-Excuses", basata sull'ottimo flow narrativo visto nella presentazione di "OnTrek".

---

## Slide 1: Title Slide
- **Testo:** 
  - Titolo: **No-Excuses**
  - Sottotitolo: *A multimodal web application for hands-free, eyes-free workout tracking*
  - Informazioni accademico/personali (es. nome, corso, anno).
- **Immagini/Visuals:** Logo dell'app minimalista o un'icona vettoriale legata al fitness (es. un bilanciere e un telefono).

## Slide 2: Problem Statement
- **Testo:** 
  - **Interruzioni del Workout:** Le app tradizionali richiedono interazioni manuali continue, spezzando il focus e falsando i tempi di recupero.
  - **Limitazioni Hardware:** Gli smartwatch costano, sono scomodi durante i sollevamenti pesanti (es. kettlebell, trazioni) e non tutti li vogliono indossare in palestra.
- **Immagini/Visuals:** Illustrazione vettoriale di un utente frustrato che cerca di tappare lo schermo del telefono con le mani sudate.

## Slide 3: Need Finding (Analisi dei bisogni)
- **Testo:** Risultati di ipotetiche survey o osservazioni sul campo.
  - "Perché gli atleti non tracciano le serie?" -> 60% Troppo scomodo interagire col telefono, 30% Dimenticano di segnare le reps, 10% Non usano smartwatch.
- **Immagini/Visuals:** Grafici a torta o a barre semplici ed eleganti.

## Slide 4: Identified Needs
- **Testo:** 
  - Tracking a mani libere (Hands-free)
  - Zero necessità di guardare lo schermo (Eyes-free)
  - Controllo vocale per gestire le schede
- **Immagini/Visuals:** Un'icona di "Checklist" con i tre punti evidenziati.

## Slide 5: Storyboard - Pocket Mode (Inertial)
- **Testo:** Titolo: *Storyboard - Allenamento in Tasca*
- **Immagini/Visuals:** 3 vignette (disegnate a mano o vettoriali):
  1. L'utente mette il telefono in tasca e avvia la sessione con la voce.
  2. L'utente fa le flessioni e il telefono (dalla tasca) dice ad alta voce "One... Two...".
  3. Al raggiungimento del target, il telefono suona e l'utente lo estrae senza registrare falsi positivi.

## Slide 6: Storyboard - Stand Mode (Computer Vision)
- **Testo:** Titolo: *Storyboard - Allenamento a Corpo Libero*
- **Immagini/Visuals:** 3 vignette:
  1. L'utente appoggia il telefono contro il muro.
  2. Si allontana e inizia a fare le trazioni (pullups).
  3. La fotocamera traccia il movimento e conta le ripetizioni.

## Slide 7: UI Prototypes
- **Testo:** Mostrare come l'interfaccia sia disegnata per limitare al minimo il disordine visivo.
- **Immagini/Visuals:** 
  - **`docs/images/ui_screenshot.png`** (il mockup generato con l'anello circolare, il banner vocale e il dark mode).

## Slide 8: Architecture Overview
- **Testo:** Spiegare che l'app è una PWA (Progressive Web App) Client-Side. Nessun server backend pesante! Tutto gira in locale per massimizzare la privacy.
- **Immagini/Visuals:** 
  - **`docs/images/architecture_diagram.png`** (il diagramma di flusso tra React Hooks, Web APIs e UI).

## Slide 9: Technology Stack
- **Testo:** 
  - **Frontend:** React, TypeScript, Vite.
  - **Sensor APIs:** DeviceMotion, DeviceOrientation, MediaDevices.
  - **Audio/Voice:** Web Speech API, Web Audio API.
  - **Machine Learning:** Google MediaPipe Pose (WebAssembly).
- **Immagini/Visuals:** Loghi delle tecnologie affiancati ai nomi.

## Slide 10: Multimodal Interactions
- **Testo:** Il cuore dell'app: come interagisce con l'utente.
  - **Voice Control:** Navigare le "schede" dicendo "Start" o "Skip".
  - **Digital Spotter (Audio/Haptic):** Feedback vocale ("Tre, Quattro") e vibrazione ad ogni rep.
  - **Inertial & Vision:** Due approcci diversi in base all'esercizio.
- **Immagini/Visuals:** Icone rappresentative (Microfono, Altoparlante, Telefono in tasca, Telefono con fotocamera accesa).

## Slide 11: Main Challenge 1 - Sensor Noise & Cooldown
- **Testo:** 
  - *Problema:* Il semplice accelerometro non basta; un cooldown troppo lungo (2s) perdeva le rep veloci.
  - *Soluzione:* **Sensor Fusion** (Accelerazione Lineare + Giroscopio) per calcolare la "Motion Energy". Riduzione del cooldown a 1.2s per matchare perfettamente il ritmo umano.
- **Immagini/Visuals:** Il grafico dei picchi di energia. Se generato, metti `docs/images/energy_peaks_graph.png`.

## Slide 12: Main Challenge 2 - Extraction False Positives
- **Testo:** 
  - *Problema:* Tirare fuori il telefono dalla tasca a fine serie contava come una flessione aggiuntiva a causa del picco cinetico.
  - *Soluzione:* **Gravity Orientation Filter**. 
- **Immagini/Visuals:** Un diagramma vettoriale o il grafico `docs/images/gravity_vector_graph.png` che mostra il Dot Product (angolo $> 66^\circ$) quando l'utente si alza in piedi.

## Slide 13: Main Challenge 3 - Mobile Audio Restrictions
- **Testo:** 
  - *Problema:* iOS Safari blocca l'audio autoplay. I workout iniziavano completamente muti.
  - *Soluzione:* **Lazy Loading**. L'AudioContext e lo SpeechSynthesis vengono "sbloccati" forzatamente e agganciati al primo touch dell'utente sul bottone "Start Session".
- **Immagini/Visuals:** Icona di un lucchetto di sicurezza Apple/iOS che si sblocca cliccando un bottone.

## Slide 14: Evaluation & Calibration (Lab Tests)
- **Testo:** 
  - *Lab Tests (Calibrazione empirica):* 20-30 sessioni dedicate, raccogliendo set da 1, 5, 10 ripetizioni.
  - L'analisi del JSON raw (`burstDurationMs`, `maxEnergy`) ci ha permesso di calibrare perfettamente le soglie (active threshold = 120, baseline = 75).
- **Immagini/Visuals:** Un frammento (snippet) di codice o del file JSON log prodotto dall'app.

## Slide 15: Evaluation (Field Tests)
- **Testo:** 
  - Test sul campo con tasche larghe e tasche strette.
  - Risultato: Il filtro di gravità a 66 gradi blocca il 100% dei falsi positivi quando ci si alza in piedi, tollerando comunque il naturale rimbalzo in tasche larghe.
- **Immagini/Visuals:** Utente in palestra (vettoriale o foto stock) che prova l'app.

## Slide 16: User Feedback
- **Testo:** 
  - *Cosa è piaciuto:* L'esperienza totalmente "Eyes-free", non dover toccare lo schermo, affidabilità del tracking.
  - *Cosa migliorare:* Aggiungere più esercizi supportati dalla Computer Vision, grafici statistici a fine workout.
- **Immagini/Visuals:** Feedback a stelle (stile rating) con icone di "Like" e "Dislike".

## Slide 17: Computer Vision Debug (Extra Slide)
- **Testo:** Breve accenno a MediaPipe. Mostra come vengono estratte 33 landmarks anatomiche in tempo reale.
- **Immagini/Visuals:** **`docs/images/mediapipe_debug.png`** (lo screenshot con lo scheletro verde/blu).

## Slide 18: Future Improvements
- **Testo:** 
  - Espansione della libreria MediaPipe per esercizi complessi.
  - Uso del Barometro integrato nei telefoni per tracciare il dislivello nei calisthenics all'aperto.
  - Integrazione LLM (Large Language Models) per l'elaborazione di comandi vocali non strutturati ("Modifica la scheda e togli le trazioni").
- **Immagini/Visuals:** Icone stilizzate per AI, Barometro e librerie esercizi.

## Slide 19: Conclusion & Q&A
- **Testo:** 
  - No-Excuses dimostra che lo smartphone può sostituire gli smartwatch costosi agendo come "Digital Spotter" multimodale.
  - *Thank you for your attention!*
- **Immagini/Visuals:** Logo dell'app grande al centro. QR Code (ipotetico) per provare la PWA live.
