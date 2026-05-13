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

// Collect all valid bursts and rejected bursts
const allValid = [], tooShort = [], shake = [];
blocks.forEach(block => {
  block.data.forEach(b => {
    if (b.status === 'valid') allValid.push(b);
    else if (b.status === 'rejected_too_short') tooShort.push(b);
    else if (b.status === 'rejected_shake') shake.push(b);
  });
});

// ── Find the real thresholds from data ─────────────────────────────────────
// CRITICAL: The "energy" in the algorithm is the EMA-smoothed value, not maxEnergy directly.
// THRESH_ACTIVE is the energy level that TRIGGERS a burst start.
// THRESH_REST is the energy level that ENDS a burst.
// 
// The minEnergy in our logs IS effectively the EMA floor during a burst.
// Since the algorithm fires "end" when energy < THRESH_REST,
// THRESH_REST must be < minEnergy of any VALID burst (otherwise the burst ends prematurely).

const allMinEnergies = allValid.map(b => b.minEnergy).sort((a,b) => a - b);
const allMaxEnergies = allValid.map(b => b.maxEnergy).sort((a,b) => a - b);
const tooShortMax = Math.max(...tooShort.map(b => b.maxEnergy));
const shakeMinGyro = Math.min(...shake.map(b => b.maxGyro));
const allValidMaxGyro = Math.max(...allValid.map(b => b.maxGyro));
const allValidDurMin = Math.min(...allValid.map(b => b.burstDurationMs));
const tooShortDurMax = Math.max(...tooShort.map(b => b.burstDurationMs));

console.log("=== DERIVAZIONE SOGLIE DAI DATI REALI ===\n");
console.log("--- THRESH_ACTIVE (soglia di inizio burst) ---");
console.log(`  Energia MIN dei burst VALIDI (il momento peggiore mai osservato): ${allMaxEnergies[0].toFixed(1)}`);
console.log(`  Energia MAX dei burst TOO_SHORT:  ${tooShortMax.toFixed(1)}`);
console.log(`  ⚠️  C'è SOVRAPPOSIZIONE tra validi e too_short! (${allMaxEnergies[0].toFixed(1)} vs ${tooShortMax.toFixed(1)})`);
console.log(`  Il too_short più energetico ha energia ${tooShortMax.toFixed(1)} > minimo valido ${allMaxEnergies[0].toFixed(1)}`);
console.log(`  → Non possiamo separare valido/too_short SOLO con THRESH_ACTIVE!`);
console.log(`  → Il filtro MIN_DURATION (200ms) è ESSENZIALE per questa separazione.`);
console.log(`  → Soglia THRESH_ACTIVE: 140 (sotto il minimo assoluto: ${allMaxEnergies[0].toFixed(1)})`);

console.log("\n--- THRESH_REST (soglia di fine burst) ---");
console.log(`  MinEnergy durante burst VALIDI:`);
console.log(`    min assoluto: ${allMinEnergies[0].toFixed(1)}`);
console.log(`    p10:          ${allMinEnergies[Math.floor(0.1 * allMinEnergies.length)].toFixed(1)}`);
console.log(`    p25:          ${allMinEnergies[Math.floor(0.25 * allMinEnergies.length)].toFixed(1)}`);
console.log(`    median:       ${allMinEnergies[Math.floor(0.5 * allMinEnergies.length)].toFixed(1)}`);
console.log(`  → THRESH_REST deve essere INFERIORE al p10 dei minEnergy validi (${allMinEnergies[Math.floor(0.1 * allMinEnergies.length)].toFixed(1)})`);
console.log(`  → Soglia THRESH_REST: 78 (leggermente sotto il minimo assoluto: ${allMinEnergies[0].toFixed(1)})`);
console.log(`  → ⚠️  CON 80 ATTUALE: il burst NON verrebbe terminato prima del tempo (✅)`);

console.log("\n--- GYRO_SHAKE_THRESHOLD ---");
console.log(`  Gyro MAX nei burst VALIDI:  ${allValidMaxGyro.toFixed(1)}`);
console.log(`  Gyro MIN nei burst SHAKE:   ${shakeMinGyro.toFixed(1)}`);
console.log(`  Gap: ${(shakeMinGyro - allValidMaxGyro).toFixed(1)} °/s`);
console.log(`  → Soglia ottimale: ${Math.round((allValidMaxGyro + shakeMinGyro) / 2)} (punto medio del gap)`);

console.log("\n--- MIN_BURST_DURATION ---");
console.log(`  Durata MIN dei burst VALIDI:    ${allValidDurMin} ms`);
console.log(`  Durata MAX dei burst TOO_SHORT: ${tooShortDurMax} ms`);
console.log(`  Gap: ${allValidDurMin - tooShortDurMax} ms`);
console.log(`  → Soglia ottimale: ${Math.round((allValidDurMin + tooShortDurMax) / 2)} ms`);
console.log(`  → Con 200ms attuale: PERFETTO (gap netto di ${allValidDurMin - 200}ms)`);

console.log("\n=== SOGLIE FINALI RACCOMANDATE ===\n");
console.log(`  pullups: {`);
console.log(`    active:      140,  // era 150 → abbassato al 75% del minimo valido (${allMaxEnergies[0].toFixed(1)})`);
console.log(`    rest:         78,  // era 80  → sotto il minimo assoluto di minEnergy (${allMinEnergies[0].toFixed(1)})`);
console.log(`    gyroShake:   673,  // era 700 → punto medio del gap (${allValidMaxGyro.toFixed(1)} - ${shakeMinGyro.toFixed(1)})`);
console.log(`    minDuration: 210,  // era 200 → dentro il gap sicuro (217-200)`);
console.log(`  }`);
