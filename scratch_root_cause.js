import fs from 'fs';

const filePath = '/Users/alessandrogautieri/Documents/GitHub/No-excuses/calibration-data/trazioni.txt';
const content = fs.readFileSync(filePath, 'utf8');

const blocks = [];
const regex = /Fatte:?\s*(\d+)[\s\S]*?(\[\s*\{[\s\S]*?\}\s*\])/g;
let match;
while ((match = regex.exec(content)) !== null) {
  const reps = parseInt(match[1], 10);
  try { blocks.push({ reps, data: JSON.parse(match[2]) }); } catch (e) {}
}

// ─── CAPIRE PERCHÉ L'ALGORITMO 2-BURST NON FUNZIONA ─────────────────────────────
// Analisi della struttura burst per sessione

console.log("=== ANALISI STRUTTURA BURST PER SESSIONE ===\n");
console.log("Il problema centrale: l'algoritmo conta 2 burst (andata+ritorno) = 1 rep");
console.log("Ma nei log vediamo moltissimi burst VALIDI con burstIndex=1 senza successivo index=2\n");

let totalValidB1 = 0, totalValidB2 = 0, totalUnmatchedB1 = 0;
let multiRepSessions = blocks.filter(b => b.reps > 1);

multiRepSessions.forEach((block, i) => {
  const valid = block.data.filter(b => b.status === 'valid');
  const b1 = valid.filter(b => b.burstIndex === 1);
  const b2 = valid.filter(b => b.burstIndex === 2);
  // Pairs contati = numero di B2 (ogni B2 corrisponde a 1 rep contata)
  const countedReps = b2.length;
  const diff = countedReps - block.reps;

  totalValidB1 += b1.length;
  totalValidB2 += b2.length;
  // B1 non abbinati = B1 totali senza la loro B2
  const unmatched = b1.length - b2.length;
  if (unmatched > 0) totalUnmatchedB1 += unmatched;

  if (diff !== 0) {
    const icon = diff > 0 ? '⚠️ FP' : '❌ FN';
    console.log(`  Sessione ${String(i+1).padStart(2)} [${block.reps} reps] → B1:${b1.length} B2:${b2.length} contate:${countedReps} ${icon}(${diff > 0 ? '+' : ''}${diff})`);
    if (b1.length > b2.length) {
      // Stampa i B1 "orfani" (senza B2 successivo)
      const orfani = b1.slice(b2.length);
      orfani.forEach(b => console.log(`    → B1 orfano: energy=${b.maxEnergy.toFixed(0)}, dur=${b.burstDurationMs}ms`));
    }
  }
});

console.log(`\n  Totale B1 validi nelle sessioni multi-rep: ${totalValidB1}`);
console.log(`  Totale B2 validi nelle sessioni multi-rep: ${totalValidB2}`);
console.log(`  B1 orfani (senza B2 corrispondente):       ${totalUnmatchedB1}`);

// ─── CAPIRE COSA SONO I BURST CON DURATA ~8000ms (TIMEOUT) ──────────────────
console.log("\n\n=== BURST CON DURATA VICINA AL TIMEOUT (>6000ms, status=valid) ===");
const allBursts = blocks.flatMap(b => b.data);
const longValid = allBursts.filter(b => b.status === 'valid' && b.burstDurationMs > 6000);
console.log(`  Trovati ${longValid.length} burst validi con durata > 6000ms`);
longValid.forEach(b => {
  console.log(`  → B${b.burstIndex} dur=${b.burstDurationMs}ms, energy=${b.maxEnergy.toFixed(0)}, gyro=${b.maxGyro.toFixed(0)}`);
});

// ─── LA VERA DOMANDA: QUANTE REP SI PERDONO PERCHÉ IL B1 NON TROVA IL B2? ───
console.log("\n\n=== ROOT CAUSE ANALYSIS ===");
console.log("La logica attuale: idle→B1(active)→B2(active dopo rest)→rep++");
console.log("Il problema: quando una trazione è lenta/pesante, il telefono resta");
console.log("in movimento abbastanza a lungo da far sì che l'energia non scenda");
console.log("sotto THRESH_REST=78 tra andata e ritorno.");
console.log("Risultato: l'intero up+down diventa UN SINGOLO B1 lungo, poi si aspetta");
console.log("un B2 che non arriva mai (o arriva come il prossimo movimento).\n");

// Verifica: quante rep da sessioni multi-rep hanno totalRepDurationMs registrato?
const b2WithTotalRep = allBursts.filter(b => b.status === 'valid' && b.burstIndex === 2 && b.totalRepDurationMs > 0);
const totalRepDurations = b2WithTotalRep.map(b => b.totalRepDurationMs).sort((a,b) => a-b);
console.log(`  Rep complete (con B2) analizzate: ${b2WithTotalRep.length}`);
if (totalRepDurations.length > 0) {
  const avg = totalRepDurations.reduce((a,b) => a+b, 0) / totalRepDurations.length;
  const p50 = totalRepDurations[Math.floor(totalRepDurations.length/2)];
  const p90 = totalRepDurations[Math.floor(totalRepDurations.length*0.9)];
  console.log(`  totalRepDuration: avg=${avg.toFixed(0)}ms, p50=${p50}ms, p90=${p90}ms, max=${totalRepDurations[totalRepDurations.length-1]}ms`);
}

// ─── PROPOSTA: SOGLIA THRESH_REST È IL PROBLEMA CENTRALE? ────────────────────
console.log("\n\n=== TEST: cosa succede se alziamo THRESH_REST? ===");
console.log("Con THRESH_REST più alto, il burst termina prima (scende più facilmente sotto soglia)");
console.log("Questo permetterebbe di separare ANDATA e RITORNO come 2 burst distinti\n");

const restValues = [78, 85, 90, 95, 98];
restValues.forEach(rest => {
  let predicted = 0;
  let perfect = 0;
  blocks.forEach(block => {
    let count = 0;
    let bc = 0;
    block.data.forEach(b => {
      if (b.status === 'valid') {
        if (b.minEnergy > rest) {
          // Con questa soglia rest più alta, il burst NON si sarebbe terminato
          // (minEnergy > rest significa che energia non è scesa sotto rest)
          // → rimane un burst lungo = problema
        }
        // Usiamo burstIndex come proxy: se burstIndex=2 la rep è contata
        if (b.burstIndex === 2) count++;
      }
    });
    predicted += count;
    if (count === block.reps) perfect++;
  });
  // Questo non è un test vero perché non possiamo ri-simulare la state machine senza i sample grezzi
  // Ma possiamo guardare quanti burst validi hanno minEnergy > rest (non sarebbero terminati)
  const validBursts = blocks.flatMap(b => b.data).filter(b => b.status === 'valid');
  const wouldNotEnd = validBursts.filter(b => b.minEnergy > rest).length;
  const wouldEnd = validBursts.filter(b => b.minEnergy <= rest).length;
  console.log(`  THRESH_REST=${rest}: ${wouldEnd}/${validBursts.length} burst scenderebbero sotto soglia (terminerebbero)`);
});

// ─── VERA SOLUZIONE: ANALISI DELLA STRUTTURA DELLA TRAZIONE ──────────────────
console.log("\n\n=== STRUTTURA DEL PROBLEMA & SOLUZIONE PROPOSTA ===");
console.log("");
console.log("PROBLEMA FONDAMENTALE:");
console.log("La logica 2-burst assume che ogni trazione generi ESATTAMENTE 2 burst separati.");
console.log("Ma dalla struttura delle sessioni vediamo che spesso si generano solo burst B1.");
console.log("");
console.log("PERCHÉ?");
console.log("La fase di salita (tirata) è esplosiva → genera un burst chiaro.");
console.log("La fase di discesa (lowering) può essere lenta/controllata →");
console.log("  a) se l'energia scende sotto THRESH_REST=78 → genera un B2 → REP CONTATA ✅");
console.log("  b) se NON scende abbastanza (trazione lenta) → nessun B2 → REP NON CONTATA ❌");
console.log("");
console.log("SOLUZIONE ALTERNATIVA: Contare ogni B1 come 1 rep (non 2 burst)");
console.log("Equivale a dire: 1 burst valido = 1 ripetizione");
console.log("");

// Testa logica 1-burst
let total1burst_predicted = 0, perfect1burst = 0;
let b1Only_errors = [];
blocks.forEach((block, i) => {
  const cfg = { active: 140, rest: 78, gyroShake: 673, minDuration: 210 };
  let count = 0;
  block.data.forEach(b => {
    if (b.status === 'valid' && b.burstIndex === 1) {
      // Riapplica filtri
      if (b.burstDurationMs > cfg.minDuration && b.maxGyro <= cfg.gyroShake) {
        count++;
      }
    }
  });
  total1burst_predicted += count;
  if (count === block.reps) perfect1burst++;
  else b1Only_errors.push({ session: i+1, real: block.reps, predicted: count });
});

console.log(`Logica 1-burst (ogni B1 = 1 rep):`);
console.log(`  Sessioni esatte: ${perfect1burst}/32 (${(perfect1burst/32*100).toFixed(1)}%)`);
console.log(`  Rep totali: reali=${blocks.reduce((a,b)=>a+b.reps,0)}, predette=${total1burst_predicted}`);
console.log(`  Diff: ${total1burst_predicted - blocks.reduce((a,b)=>a+b.reps,0)}`);
if (b1Only_errors.length > 0) {
  console.log(`  Errori:`);
  b1Only_errors.forEach(e => console.log(`    Sessione ${e.session}: reali=${e.real}, predette=${e.predicted} (${e.predicted-e.real > 0 ? '+' : ''}${e.predicted-e.real})`));
}
