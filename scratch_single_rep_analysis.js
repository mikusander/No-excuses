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

// ─── Analisi delle sessioni da 1 rep con falsi positivi ─────────────────
console.log("=== SESSIONI DA 1 REP: struttura burst ===\n");

const singleRepBlocks = blocks.filter(b => b.reps === 1);
singleRepBlocks.forEach((block, i) => {
  const validBursts = block.data.filter(b =>
    b.burstDurationMs > cfg.minDuration &&
    b.maxGyro <= cfg.gyroShake &&
    b.maxEnergy >= cfg.active
  );
  
  console.log(`  Sessione (1 rep) → ${validBursts.length} burst validi:`);
  validBursts.forEach((b, j) => {
    const dt = j === 0 ? 0 : b.timestamp - validBursts[j-1].timestamp;
    console.log(`    B${j+1}: index=${b.burstIndex} energy=${b.maxEnergy.toFixed(0)} dur=${b.burstDurationMs}ms gyro=${b.maxGyro.toFixed(0)} Δt=${dt}ms`);
  });
  console.log();
});

// ─── Analisi delle distanze temporali tra burst nelle sessioni da 1 rep ───
console.log("\n=== PATTERN TEMPORALE: sessioni 1 rep con burst multipli ===\n");
console.log("In una sessione da 1 rep, i burst extra sono spesso il B1+B2 della stessa rep");
console.log("(il B2 è la fase di discesa che viene registrata come burst separato)\n");

const allSingleRepBursts = singleRepBlocks.flatMap(b => b.data.filter(bb =>
  bb.burstDurationMs > cfg.minDuration &&
  bb.maxGyro <= cfg.gyroShake &&
  bb.maxEnergy >= cfg.active
));

console.log(`  Burst validi totali nelle sessioni da 1 rep: ${allSingleRepBursts.length}`);
console.log(`  Sessioni da 1 rep totali: ${singleRepBlocks.length}`);
console.log(`  Media burst per sessione: ${(allSingleRepBursts.length/singleRepBlocks.length).toFixed(1)}`);

// ─── Quanto dura l'intera sessione (dal primo all'ultimo burst)? ───────
const sessionDurations = singleRepBlocks.map(block => {
  const v = block.data.filter(b => b.burstDurationMs > cfg.minDuration && b.maxEnergy >= cfg.active);
  if (v.length < 2) return 0;
  return v[v.length-1].timestamp - v[0].timestamp;
}).filter(d => d > 0);

if (sessionDurations.length > 0) {
  const avg = sessionDurations.reduce((a,b) => a+b, 0) / sessionDurations.length;
  console.log(`\n  Durata media sessione 1-rep (dal primo all'ultimo burst): ${avg.toFixed(0)}ms`);
  sessionDurations.forEach((d, i) => console.log(`    Sessione ${i+1}: ${d}ms`));
}

// ─── Distanze tra burst consecutivi validi in sessioni da 1 rep ───────
console.log("\n\n=== DISTANZE TRA BURST VALIDI CONSECUTIVI ===\n");

const allDeltaTs = [];
singleRepBlocks.forEach((block) => {
  const valid = block.data.filter(b =>
    b.burstDurationMs > cfg.minDuration &&
    b.maxGyro <= cfg.gyroShake &&
    b.maxEnergy >= cfg.active
  );
  for (let j = 1; j < valid.length; j++) {
    allDeltaTs.push(valid[j].timestamp - valid[j-1].timestamp);
  }
});

if (allDeltaTs.length > 0) {
  allDeltaTs.sort((a,b) => a-b);
  const avg = allDeltaTs.reduce((a,b) => a+b, 0) / allDeltaTs.length;
  console.log(`  Distanze tra burst consecutivi nelle sessioni da 1 rep:`);
  console.log(`  min: ${allDeltaTs[0]}ms, avg: ${avg.toFixed(0)}ms, max: ${allDeltaTs[allDeltaTs.length-1]}ms`);
  allDeltaTs.forEach(d => console.log(`    ${d}ms`));
}

// ─── Analisi burstIndex nei burst delle sessioni 1-rep ───────────────
console.log("\n\n=== BURSTINDEX nelle sessioni da 1 rep ===");
console.log("Se la sessione è da 1 rep, ci aspettiamo esattamente 1xB1 + 1xB2");
console.log("I burst in eccesso sono movimento spurio post-trazione\n");

singleRepBlocks.forEach((block, si) => {
  const valid = block.data.filter(b =>
    b.burstDurationMs > cfg.minDuration &&
    b.maxGyro <= cfg.gyroShake &&
    b.maxEnergy >= cfg.active
  );
  if (valid.length > 2) {
    console.log(`  Sessione ${si+1} (${valid.length} burst validi):`);
    valid.forEach(b => console.log(`    index=${b.burstIndex} energy=${b.maxEnergy.toFixed(0)} dur=${b.burstDurationMs}ms status=${b.status}`));
  }
});

// ─── Chiave: energy dei burst "extra" nelle sessioni da 1 rep ─────────
console.log("\n\n=== ENERGIA DEI BURST 'EXTRA' (≥3° burst in sessioni 1-rep) ===\n");
const extraBursts = [];
singleRepBlocks.forEach(block => {
  const valid = block.data.filter(b =>
    b.burstDurationMs > cfg.minDuration &&
    b.maxGyro <= cfg.gyroShake &&
    b.maxEnergy >= cfg.active
  );
  // I primi 2 sono la trazione (B1+B2), quelli extra sono spurii
  valid.slice(2).forEach(b => extraBursts.push(b));
});

if (extraBursts.length > 0) {
  console.log(`  Burst extra totali: ${extraBursts.length}`);
  const energies = extraBursts.map(b => b.maxEnergy).sort((a,b) => a-b);
  const avg = energies.reduce((a,b) => a+b, 0) / energies.length;
  console.log(`  Energia: min=${energies[0].toFixed(0)}, avg=${avg.toFixed(0)}, max=${energies[energies.length-1].toFixed(0)}`);
  console.log(`  Dettaglio:`);
  extraBursts.forEach(b => console.log(`    energy=${b.maxEnergy.toFixed(0)} dur=${b.burstDurationMs}ms gyro=${b.maxGyro.toFixed(0)} index=${b.burstIndex}`));
} else {
  console.log("  Nessun burst extra nelle sessioni da 1 rep! ✅");
}

// ─── Se i burst extra sono B2 (ritorni), possono essere esclusi? ─────
console.log("\n\n=== SOLUZIONE HYBRID: contiamo solo i B1 (ignoriamo i B2) ===\n");
console.log("Il B2 è il ritorno/discesa — se contiamo solo i burst di salita (B1)");
console.log("eliminiamo automaticamente i falsi positivi del ritorno.\n");
console.log("Ma attenzione: alcuni B1 orfani possono essere rumore\n");

// Test: contiamo solo i burst con burstIndex === 1
function simulateSingleBurstB1Only(bursts, cooldownMs, maxDurMs = 8000) {
  let count = 0;
  let lastCountedTime = -Infinity;

  for (const b of bursts) {
    if (b.burstIndex !== 1) continue;  // ignora i B2
    if (b.burstDurationMs <= cfg.minDuration) continue;
    if (b.burstDurationMs > maxDurMs) continue;
    if (b.maxGyro > cfg.gyroShake) continue;
    if (b.maxEnergy < cfg.active) continue;

    const dt = b.timestamp - lastCountedTime;
    if (dt < cooldownMs) continue;

    count++;
    lastCountedTime = b.timestamp;
  }
  return count;
}

const totalReal = blocks.reduce((a, b) => a + b.reps, 0);

// Test varie combinazioni con B1-only
const cooldowns = [500, 800, 1000, 1200, 1500];
const maxDurations = [3000, 4000, 5000, 8000];

let bestScore = -Infinity, bestP = null;
console.log("cooldown | maxDur | sessioni_ok | rep_pred | diff   | accuracy");
console.log("─".repeat(65));
cooldowns.forEach(cd => {
  maxDurations.forEach(md => {
    let perfect = 0, totalPred = 0;
    blocks.forEach(block => {
      const pred = simulateSingleBurstB1Only(block.data, cd, md);
      totalPred += pred;
      if (pred === block.reps) perfect++;
    });
    const diff = totalPred - totalReal;
    const accuracy = (100 - Math.abs(diff) / totalReal * 100).toFixed(1);
    const score = perfect * 100 - Math.abs(diff);
    const marker = score > bestScore ? ' ← BEST' : '';
    if (score > bestScore) { bestScore = score; bestP = { cd, md, perfect, totalPred, diff, accuracy }; }
    console.log(`  ${String(cd).padStart(6)}ms | ${String(md).padStart(6)}ms | ${String(perfect).padStart(11)} | ${String(totalPred).padStart(8)} | ${String(diff >= 0 ? '+'+diff : diff).padStart(6)} | ${accuracy}%${marker}`);
  });
});

console.log(`\n🏆 BEST B1-only: cd=${bestP.cd}ms, max=${bestP.md}ms`);
console.log(`   Sessioni esatte: ${bestP.perfect}/32 (${(bestP.perfect/32*100).toFixed(1)}%)`);
console.log(`   Rep: ${bestP.totalPred}/${totalReal} (${bestP.accuracy}%)`);
