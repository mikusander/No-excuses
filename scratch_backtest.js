import fs from 'fs';

const filePath = '/Users/alessandrogautieri/Documents/GitHub/No-excuses/calibration-data/trazioni.txt';
const content = fs.readFileSync(filePath, 'utf8');

// ─── CONFIGURAZIONE ALGORITMO (identica a useAccelerometerRepCounter.ts) ─────
const EXERCISE_CONFIG = {
  pullups: { active: 140, rest: 78, gyroShake: 673, minDuration: 210 },
  default: { active: 180, rest: 100, gyroShake: 700, minDuration: 200 },
};
const MAX_REP_DURATION_MS = 8000;
const cfg = EXERCISE_CONFIG.pullups;

// ─── PARSING SESSIONI ─────────────────────────────────────────────────────────
// Ogni blocco: "Prima/Seconda/.../Fatte: N" + JSON
const sessionRegex = /(?:Prima|Seconda|Terza|Quarta|Quinta|Sesta|Settima|Ottava|Nona|Decima|Undicesima|Dodicesima|\w+):?\s*\nFatte:\s*(\d+)\s*\n([\s\S]*?)(?=\n(?:Prima|Seconda|Terza|Quarta|Quinta|Sesta|Settima|Ottava|Nona|Decima|Undicesima|Dodicesima|\w+):?\s*\nFatte:|$)/g;

const blocks = [];
const regex = /Fatte:?\s*(\d+)[\s\S]*?(\[\s*\{[\s\S]*?\}\s*\])/g;
let match;
while ((match = regex.exec(content)) !== null) {
  const reps = parseInt(match[1], 10);
  try { blocks.push({ reps, data: JSON.parse(match[2]) }); } catch (e) {}
}

// ─── SIMULAZIONE ALGORITMO SUI DATI LOG ───────────────────────────────────────
// Nota importante: i dati di log contengono già la classificazione originale
// dell'algoritmo (status, burstIndex). Quello che facciamo è RIAPPLICARE
// i filtri con le NUOVE soglie per vedere se:
// a) Un burst valido sarebbe ancora valido
// b) Un burst rifiutato sarebbe ancora rifiutato
// c) Ci sono casi che cambiano classificazione

function classifyBurst(burst) {
  // Applica le stesse regole della macchina a stati
  if (burst.burstDurationMs <= cfg.minDuration) return 'rejected_too_short';
  if (burst.maxGyro > cfg.gyroShake) return 'rejected_shake';
  // Se supera entrambi i filtri, è valido (maxEnergy > cfg.active è già garantito
  // dal fatto che il burst è stato registrato — la soglia active determina SE il
  // burst viene avviato, non possiamo riapplicarla sui dati aggregati post-hoc).
  return 'valid';
}

// ─── CONTEGGIO REP PER SESSIONE ───────────────────────────────────────────────
// La logica: burst index 1 + burst index 2 successivi = 1 rep
// Ma con i nuovi filtri, alcuni burst cambiano status.
function simulateSession(bursts) {
  let burstCount = 0;
  let repCount = 0;
  const events = [];

  for (const burst of bursts) {
    const newStatus = classifyBurst(burst);
    const changed = newStatus !== burst.status;

    if (newStatus === 'rejected_too_short') {
      events.push({ type: 'too_short', changed, dur: burst.burstDurationMs, energy: burst.maxEnergy.toFixed(0) });
      continue;
    }
    if (newStatus === 'rejected_shake') {
      events.push({ type: 'shake', changed, gyro: burst.maxGyro.toFixed(0) });
      burstCount = 0;
      continue;
    }

    // valid
    burstCount++;
    if (burstCount === 1) {
      events.push({ type: 'b1_valid', changed, energy: burst.maxEnergy.toFixed(0), dur: burst.burstDurationMs });
    } else if (burstCount === 2) {
      repCount++;
      events.push({ type: 'REP_COUNTED', repCount, changed, energy: burst.maxEnergy.toFixed(0), dur: burst.burstDurationMs });
      burstCount = 0;
    }
  }
  return { repCount, events };
}

// ─── REPORT COMPLETO ──────────────────────────────────────────────────────────
console.log(`\n🔁 BACKTEST COMPLETO - NUOVE SOGLIE vs SESSIONI REALI`);
console.log(`Soglie attive: active=${cfg.active}, rest=${cfg.rest}, gyroShake=${cfg.gyroShake}, minDuration=${cfg.minDuration}ms`);
console.log(`==========================================================\n`);

let totalReal = 0, totalPredicted = 0, totalSessions = 0;
let perfectSessions = 0, errorSessions = [];

blocks.forEach((block, i) => {
  const { repCount, events } = simulateSession(block.data);
  const real = block.reps;
  const correct = repCount === real;
  totalReal += real;
  totalPredicted += repCount;
  totalSessions++;
  if (correct) perfectSessions++;
  else errorSessions.push({ session: i + 1, real, predicted: repCount, diff: repCount - real });

  const icon = correct ? '✅' : (repCount > real ? '⚠️ FALSO+' : '❌ FALSO-');
  console.log(`  Sessione ${String(i+1).padStart(2)} | Reali: ${String(real).padStart(2)} | App: ${String(repCount).padStart(2)} | ${icon}`);
  
  if (!correct) {
    // Mostra eventi per capire cosa è successo
    events.forEach(ev => {
      if (ev.type === 'REP_COUNTED') console.log(`    → [REP ${ev.repCount}] energy=${ev.energy}, dur=${ev.dur}ms${ev.changed ? ' 🔄CHANGED' : ''}`);
      else if (ev.type === 'b1_valid') console.log(`    → [B1]  energy=${ev.energy}, dur=${ev.dur}ms${ev.changed ? ' 🔄CHANGED' : ''}`);
      else if (ev.type === 'too_short') console.log(`    → [X]  troppo corto: ${ev.dur}ms, energy=${ev.energy}${ev.changed ? ' 🔄CHANGED' : ''}`);
      else if (ev.type === 'shake') console.log(`    → [~]  shake: gyro=${ev.gyro}${ev.changed ? ' 🔄CHANGED' : ''}`);
    });
  }
});

// ─── RIEPILOGO ────────────────────────────────────────────────────────────────
const accuracy = (perfectSessions / totalSessions * 100).toFixed(1);
const repAccuracy = totalReal > 0 ? (100 - Math.abs(totalReal - totalPredicted) / totalReal * 100).toFixed(1) : 0;

console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 RIEPILOGO BACKTEST`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Sessioni totali:       ${totalSessions}`);
console.log(`  Sessioni esatte:       ${perfectSessions} / ${totalSessions} (${accuracy}%)`);
console.log(`  Ripetizioni reali:     ${totalReal}`);
console.log(`  Ripetizioni predette:  ${totalPredicted}`);
console.log(`  Differenza totale:     ${totalPredicted - totalReal > 0 ? '+' : ''}${totalPredicted - totalReal} (${repAccuracy}% accuratezza)`);

if (errorSessions.length > 0) {
  console.log(`\n  ❌ Sessioni con errori:`);
  errorSessions.forEach(e => {
    const type = e.diff > 0 ? `+${e.diff} falsi positivi` : `${e.diff} falsi negativi`;
    console.log(`    Sessione ${e.session}: reali=${e.real}, predette=${e.predicted} → ${type}`);
  });
}

// ─── ANALISI CASI LIMITE ──────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`🔬 ANALISI CASI LIMITE`);
console.log(`${'═'.repeat(60)}`);

const allBursts = blocks.flatMap(b => b.data);
const validBursts = allBursts.filter(b => b.status === 'valid');
const tooShort = allBursts.filter(b => b.status === 'rejected_too_short');
const shakes = allBursts.filter(b => b.status === 'rejected_shake');

// Con le nuove soglie, quanti burst validi sarebbero stati scartati?
const validNowRejected = validBursts.filter(b => classifyBurst(b) !== 'valid');
const shortNowValid = tooShort.filter(b => classifyBurst(b) === 'valid');
const shakeNowValid = shakes.filter(b => classifyBurst(b) === 'valid');

console.log(`\n  Burst VALIDI ora rifiutati con nuove soglie: ${validNowRejected.length}`);
if (validNowRejected.length > 0) {
  validNowRejected.forEach(b => console.log(`    → dur=${b.burstDurationMs}ms, gyro=${b.maxGyro.toFixed(0)}, energy=${b.maxEnergy.toFixed(0)} → ${classifyBurst(b)}`));
}

console.log(`  Burst TOO_SHORT ora accettati:               ${shortNowValid.length}`);
if (shortNowValid.length > 0) {
  shortNowValid.forEach(b => console.log(`    → dur=${b.burstDurationMs}ms, energy=${b.maxEnergy.toFixed(0)}`));
}

console.log(`  Burst SHAKE ora accettati:                   ${shakeNowValid.length}`);
if (shakeNowValid.length > 0) {
  shakeNowValid.forEach(b => console.log(`    → gyro=${b.maxGyro.toFixed(0)}, energy=${b.maxEnergy.toFixed(0)}`));
}

// ─── MARGINI DI SICUREZZA ─────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`🛡️  MARGINI DI SICUREZZA DELLE SOGLIE`);
console.log(`${'═'.repeat(60)}`);

const minValidDur = Math.min(...validBursts.map(b => b.burstDurationMs));
const maxShortDur = Math.max(...tooShort.map(b => b.burstDurationMs));
const maxValidGyro = Math.max(...validBursts.map(b => b.maxGyro));
const minShakeGyro = Math.min(...shakes.map(b => b.maxGyro));
const minValidEnergy = Math.min(...validBursts.map(b => b.maxEnergy));

console.log(`\n  minDuration: ${cfg.minDuration}ms`);
console.log(`    Gap reale: [max_too_short=${maxShortDur}ms] ---[${cfg.minDuration}ms]--- [min_valid=${minValidDur}ms]`);
console.log(`    Margine inferiore: ${cfg.minDuration - maxShortDur}ms | Margine superiore: ${minValidDur - cfg.minDuration}ms`);

console.log(`\n  gyroShake: ${cfg.gyroShake}`);
console.log(`    Gap reale: [max_valid_gyro=${maxValidGyro.toFixed(0)}] ---[${cfg.gyroShake}]--- [min_shake_gyro=${minShakeGyro.toFixed(0)}]`);
console.log(`    Margine inferiore: ${(cfg.gyroShake - maxValidGyro).toFixed(0)} | Margine superiore: ${(minShakeGyro - cfg.gyroShake).toFixed(0)}`);

console.log(`\n  active: ${cfg.active}`);
console.log(`    Minimo valido osservato: ${minValidEnergy.toFixed(0)} (margine: ${(minValidEnergy - cfg.active).toFixed(0)} punti)`);
