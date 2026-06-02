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

const totalReal = blocks.reduce((a, b) => a + b.reps, 0);

// ─── PUNTO CRITICO: I dati sono stati raccolti con THRESH_ACTIVE=180 ─────────
// Le rep che avrebbero prodotto energia tra 140-180 NON SONO NEI LOG.
// Il nostro backtest con active=140 è PESSIMISTICO.
// In real-world, l'algoritmo con active=140 rileverà burst aggiuntivi.
console.log("=== ANALISI BIAS NEL BACKTEST ===\n");
console.log("⚠️  SCOPERTA IMPORTANTE:");
console.log("I dati di calibrazione sono stati registrati con il VECCHIO algoritmo (THRESH_ACTIVE=180).");
console.log("Bursts con energia 140-180 NON sono mai stati registrati → non appaiono nei log.");
console.log("Quindi il backtest è SOTTOSTIMA dell'accuratezza reale.\n");

// Quanti burst validi hanno maxEnergy 140-200? (zona che il nuovo algo vedrebbe ma il vecchio no)
const allBursts = blocks.flatMap(b => b.data);
const validBursts = allBursts.filter(b => b.status === 'valid');
const inZone = validBursts.filter(b => b.maxEnergy >= 140 && b.maxEnergy < 200);
console.log(`Burst validi con maxEnergy 140-200 (zona "nuova"): ${inZone.length}/${validBursts.length}`);
console.log(`Percentuale: ${(inZone.length/validBursts.length*100).toFixed(1)}%\n`);

// Mostra la distribuzione dell'energia nei validi
const energyBuckets = {};
[0,100,140,180,200,300,400,500,600,800,1000,Infinity].forEach((b,i,arr) => {
  if (i < arr.length-1) {
    const count = validBursts.filter(b2 => b2.maxEnergy >= b && b2.maxEnergy < arr[i+1]).length;
    energyBuckets[`${b}-${arr[i+1]}`] = count;
  }
});
console.log("Distribuzione energia dei burst validi:");
Object.entries(energyBuckets).forEach(([k,v]) => {
  const bar = '█'.repeat(Math.round(v * 40 / validBursts.length));
  console.log(`  ${k.padStart(12)}: ${String(v).padStart(3)} ${bar}`);
});

// ─── ANALISI DEI BURST RIFIUTATI "BORDERLINE" ─────────────────────────────────
console.log("\n\n=== BURST RIFIUTATI MA IN ZONA GRIGIA ===\n");
const tooShort = allBursts.filter(b => b.status === 'rejected_too_short');
const shake = allBursts.filter(b => b.status === 'rejected_shake');

// Burst too_short con energia alta (forse rep veloci legittimate?)
const highEnergyShort = tooShort.filter(b => b.maxEnergy > 180);
console.log(`Burst too_short con energia > 180 (possibili rep veloci): ${highEnergyShort.length}`);
if (highEnergyShort.length > 0) {
  highEnergyShort.forEach(b => console.log(`  energy=${b.maxEnergy.toFixed(0)} dur=${b.burstDurationMs}ms gyro=${b.maxGyro.toFixed(0)}`));
}

// ─── ANALISI TILTANGLE per filtraggio posizione ─────────────────────────────
console.log("\n\n=== FILTRAGGIO PER POSIZIONE (tiltAngleDeg) ===\n");
console.log("Le trazioni avvengono in posizione verticale (tiltAngle alto = vicino a 90°)");
console.log("Se tiltAngle < 60, probabilmente è un movimento a terra/panca → falso positivo\n");

const highTilt = validBursts.filter(b => b.tiltAngleDeg >= 60);
const lowTilt = validBursts.filter(b => b.tiltAngleDeg < 60);
console.log(`Valid bursts con tiltAngle >= 60°: ${highTilt.length} (${(highTilt.length/validBursts.length*100).toFixed(0)}%)`);
console.log(`Valid bursts con tiltAngle < 60°:  ${lowTilt.length} (${(lowTilt.length/validBursts.length*100).toFixed(0)}%)`);

if (lowTilt.length > 0) {
  console.log(`\nBurst con tiltAngle basso (possibili falsi positivi da includere/escludere):`);
  lowTilt.forEach(b => console.log(`  energy=${b.maxEnergy.toFixed(0)} tilt=${b.tiltAngleDeg}° status=${b.status}`));
}

// ─── QUAL È L'IMPATTO DEL TILT FILTER? ─────────────────────────────────────
console.log("\n\n=== TEST: filtro tiltAngle minimo ===\n");
const cfg = { active: 140, rest: 78, gyroShake: 673, minDuration: 210, repCooldownMs: 500 };

function simulate(bursts, minTilt = 0) {
  let count = 0;
  let lastCountedTime = -Infinity;
  for (const b of bursts) {
    if (b.burstDurationMs <= cfg.minDuration) continue;
    if (b.maxGyro > cfg.gyroShake) continue;
    if (b.maxEnergy < cfg.active) continue;
    if (b.tiltAngleDeg < minTilt) continue;  // filtro posizione
    const dt = b.timestamp - lastCountedTime;
    if (dt < cfg.repCooldownMs) continue;
    count++;
    lastCountedTime = b.timestamp;
  }
  return count;
}

[0, 30, 45, 60, 65, 70].forEach(minTilt => {
  let perfect = 0, totalPred = 0;
  blocks.forEach(block => {
    const pred = simulate(block.data, minTilt);
    totalPred += pred;
    if (pred === block.reps) perfect++;
  });
  const diff = totalPred - totalReal;
  const acc = (100 - Math.abs(diff) / totalReal * 100).toFixed(1);
  const marker = minTilt === 0 ? ' ← attuale' : '';
  console.log(`  minTilt=${String(minTilt).padStart(2)}°: ok=${perfect}/32, pred=${totalPred}/${totalReal} (${acc}%)${marker}`);
});

// ─── ANALISI DEI MISSED REPS RIMANENTI ────────────────────────────────────
console.log("\n\n=== ANALISI SESSIONI CON PIÙ FALSI NEGATIVI ===\n");
console.log("Sessioni con ≥3 rep perse:\n");
blocks.forEach((block, i) => {
  const pred = simulate(block.data, 0);
  const diff = pred - block.reps;
  if (diff <= -3) {
    const validInSession = block.data.filter(b =>
      b.status === 'valid' &&
      b.burstDurationMs > cfg.minDuration &&
      b.maxGyro <= cfg.gyroShake &&
      b.maxEnergy >= cfg.active
    );
    const tooShortInSession = block.data.filter(b => b.status === 'rejected_too_short');
    const timeoutInSession = block.data.filter(b => b.status === 'rejected_timeout');
    console.log(`  Sessione ${i+1}: reali=${block.reps}, pred=${pred} (diff=${diff})`);
    console.log(`    Burst validi nel JSON: ${validInSession.length}`);
    console.log(`    Burst too_short: ${tooShortInSession.length} (energia: ${tooShortInSession.map(b=>b.maxEnergy.toFixed(0)).join(', ')})`);
    console.log(`    Burst timeout: ${timeoutInSession.length}`);
    if (validInSession.length < block.reps) {
      console.log(`    → ❌ MANCANO ${block.reps - validInSession.length} rep nei log! (energia mai registrata dall'algoritmo precedente)`);
    }
  }
});

// ─── CONCLUSIONE ─────────────────────────────────────────────────────────────
console.log("\n\n=== RIEPILOGO MIGLIORAMENTI POSSIBILI ===\n");
console.log("1. THRESH_ACTIVE=140 catturerà burst che prima (a 180) erano invisibili → GRATUITO");
console.log("   Stima: le rep perse per mancanza di burst nei log saranno recuperate in uso reale");
console.log("");
console.log("2. Filtro tiltAngle (se efficace): riduce falsi positivi da movimenti a terra/panca");
console.log("   → Da valutare dopo primo test reale con nuova versione");
console.log("");
console.log("3. EMA alpha tuning: l'EMA attuale (α=0.6) è veloce. Un α più basso (es 0.7-0.8)");
console.log("   filtra meglio il rumore ma perde burst brevi. Con single_burst mode questo è meno critico.");
console.log("");
console.log("4. Raccolta più dati: le sessioni da 1 rep con falsi positivi sono dovute al");
console.log("   telefono che 'rimbalza' dopo la trazione. Un filtro post-rep (es. 1.5s cooldown)");
console.log("   potrebbe ridurli ma abbasserebbe la rilevazione delle rep rapide.");
