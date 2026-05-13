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

const cfg = { active: 140, rest: 78, gyroShake: 673, minDuration: 210 };

// ─── Simulazione single_burst con cooldown ─────────────────────────────────
// Il cooldown previene di contare burst successivi troppo vicini (falsi positivi
// tra due movimenti nella stessa ripetizione)
function simulateSingleBurst(bursts, cooldownMs, maxDurMs = 8000) {
  let count = 0;
  let lastCountedTime = -Infinity;

  for (const b of bursts) {
    // Applica filtri
    if (b.burstDurationMs <= cfg.minDuration) continue;
    if (b.burstDurationMs > maxDurMs) continue;   // scarta burst troppo lunghi
    if (b.maxGyro > cfg.gyroShake) continue;
    if (b.maxEnergy < cfg.active) continue;

    // In single_burst, contiamo ogni burst valido (non solo B1)
    // ma rispettiamo il cooldown per evitare doppio conteggio
    const dt = b.timestamp - lastCountedTime;
    if (dt < cooldownMs) continue; // troppo vicino all'ultima rep contata

    count++;
    lastCountedTime = b.timestamp;
  }
  return count;
}

// ─── Grid search su cooldown e maxDuration ────────────────────────────────
const cooldowns = [500, 800, 1000, 1200, 1500, 1800, 2000, 2500, 3000];
const maxDurations = [3000, 4000, 5000, 6000, 8000];

const totalReal = blocks.reduce((a, b) => a + b.reps, 0);

console.log("=== GRID SEARCH: cooldown × maxDuration → accuratezza ===\n");
console.log("Metrica: sessioni esatte / 32 totali + differenza totale rep\n");
console.log("cooldown(ms) | maxDur(ms) | sessioni_ok | rep_predette | diff_totale | accuracy");
console.log("─".repeat(85));

let bestScore = -Infinity;
let bestParams = null;

for (const cd of cooldowns) {
  for (const md of maxDurations) {
    let perfect = 0;
    let totalPredicted = 0;
    blocks.forEach(block => {
      const pred = simulateSingleBurst(block.data, cd, md);
      totalPredicted += pred;
      if (pred === block.reps) perfect++;
    });
    const diff = totalPredicted - totalReal;
    const accuracy = (100 - Math.abs(diff) / totalReal * 100).toFixed(1);
    const score = perfect * 100 - Math.abs(diff); // massimizza sessioni esatte, minimizza errore totale
    
    const marker = score > bestScore ? ' ← BEST' : '';
    if (score > bestScore) {
      bestScore = score;
      bestParams = { cd, md, perfect, totalPredicted, diff, accuracy };
    }
    console.log(`  ${String(cd).padStart(8)}ms | ${String(md).padStart(7)}ms | ${String(perfect).padStart(11)} | ${String(totalPredicted).padStart(12)} | ${String(diff >= 0 ? '+' + diff : diff).padStart(11)} | ${accuracy}%${marker}`);
  }
}

console.log(`\n${'═'.repeat(85)}`);
console.log(`\n🏆 PARAMETRI OTTIMALI:`);
console.log(`  cooldown:    ${bestParams.cd}ms`);
console.log(`  maxDuration: ${bestParams.md}ms`);
console.log(`  Sessioni esatte: ${bestParams.perfect}/32 (${(bestParams.perfect/32*100).toFixed(1)}%)`);
console.log(`  Rep predette: ${bestParams.totalPredicted} vs ${totalReal} reali (diff: ${bestParams.diff >= 0 ? '+' : ''}${bestParams.diff})`);
console.log(`  Accuratezza sulle rep: ${bestParams.accuracy}%`);

// ─── Verifica dettagliata con best params ─────────────────────────────────
console.log(`\n\n=== DETTAGLIO CON PARAMETRI OTTIMALI (cd=${bestParams.cd}ms, max=${bestParams.md}ms) ===\n`);
let errSessions = [];
blocks.forEach((block, i) => {
  const pred = simulateSingleBurst(block.data, bestParams.cd, bestParams.md);
  const ok = pred === block.reps;
  const icon = ok ? '✅' : (pred > block.reps ? '⚠️ FP' : '❌ FN');
  console.log(`  Sessione ${String(i+1).padStart(2)} | reali: ${String(block.reps).padStart(2)} | pred: ${String(pred).padStart(2)} | ${icon}`);
  if (!ok) errSessions.push({ i: i+1, real: block.reps, pred, diff: pred - block.reps });
});

console.log(`\n  Sessioni con errori:`);
errSessions.forEach(e => console.log(`    Sessione ${e.i}: diff ${e.diff > 0 ? '+' : ''}${e.diff}`));

// ─── Confronto finale vs algoritmo precedente ─────────────────────────────
const prevPredicted = 72; // dal backtest precedente con 2-burst logic
const newPredicted = bestParams.totalPredicted;
console.log(`\n${'═'.repeat(60)}`);
console.log(`\n📈 CONFRONTO VECCHIO vs NUOVO:`);
console.log(`  Algoritmo 2-burst (precedente):`);
console.log(`    Sessioni esatte: 5/32 (15.6%)`);
console.log(`    Rep predette: ${prevPredicted}/${totalReal} (accuratezza: ${(100 - Math.abs(prevPredicted - totalReal) / totalReal * 100).toFixed(1)}%)`);
console.log(`  Algoritmo single-burst (nuovo):`);
console.log(`    Sessioni esatte: ${bestParams.perfect}/32 (${(bestParams.perfect/32*100).toFixed(1)}%)`);
console.log(`    Rep predette: ${newPredicted}/${totalReal} (accuratezza: ${bestParams.accuracy}%)`);
console.log(`  Miglioramento sessioni esatte: ${bestParams.perfect - 5} (+${((bestParams.perfect - 5) / 5 * 100).toFixed(0)}%)`);
console.log(`  Miglioramento accuratezza rep: +${(parseFloat(bestParams.accuracy) - (100 - Math.abs(prevPredicted - totalReal) / totalReal * 100)).toFixed(1)}pp`);
