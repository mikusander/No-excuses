import fs from 'fs';

const filePath = '/Users/alessandrogautieri/Documents/GitHub/No-excuses/calibration-data/trazioni.txt';
const content = fs.readFileSync(filePath, 'utf8');

// Parse all session blocks
const blocks = [];
const regex = /Fatte:?\s*(\d+)[\s\S]*?(\[\s*\{[\s\S]*?\}\s*\])/g;

let match;
while ((match = regex.exec(content)) !== null) {
  const reps = parseInt(match[1], 10);
  try {
    const data = JSON.parse(match[2]);
    blocks.push({ reps, data });
  } catch (e) {
    console.error("Error parsing JSON block:", e.message);
  }
}

console.log(`\n📊 ANALISI PROFONDA - CALIBRAZIONE TRAZIONI`);
console.log(`==========================================`);
console.log(`Sessioni trovate: ${blocks.length}`);
const totalBursts = blocks.reduce((acc, b) => acc + b.data.length, 0);
console.log(`Burst totali: ${totalBursts}`);

// Separate by status and rep count
const validBursts = { single: [], multi: [] };
const rejectedBursts = { tooShort: [], shake: [], timeout: [] };

blocks.forEach(block => {
  block.data.forEach(burst => {
    burst._sessionReps = block.reps;
    if (burst.status === 'valid') {
      if (block.reps === 1) validBursts.single.push(burst);
      else validBursts.multi.push(burst);
    } else if (burst.status === 'rejected_too_short') rejectedBursts.tooShort.push(burst);
    else if (burst.status === 'rejected_shake') rejectedBursts.shake.push(burst);
    else if (burst.status === 'rejected_timeout') rejectedBursts.timeout.push(burst);
  });
});

function stats(arr, field, sub = null) {
  if (arr.length === 0) return { count: 0, avg: 'N/A', min: 'N/A', max: 'N/A', p10: 'N/A', p25: 'N/A', median: 'N/A', p75: 'N/A', p90: 'N/A' };
  const values = arr.map(item => sub ? Math.abs(item[field]?.[sub] ?? 0) : item[field]).filter(v => v !== undefined && v !== null && !isNaN(v)).sort((a, b) => a - b);
  const n = values.length;
  const pct = (p) => values[Math.floor(p * n / 100)];
  const avg = values.reduce((a, b) => a + b, 0) / n;
  return {
    count: n,
    avg: avg.toFixed(2),
    min: values[0].toFixed(2),
    max: values[n - 1].toFixed(2),
    p10: pct(10).toFixed(2),
    p25: pct(25).toFixed(2),
    median: pct(50).toFixed(2),
    p75: pct(75).toFixed(2),
    p90: pct(90).toFixed(2),
  };
}

function printStats(label, arr) {
  if (arr.length === 0) { console.log(`  ${label}: nessun dato`); return; }
  const s = (field, sub = null) => stats(arr, field, sub);
  console.log(`\n  ─── ${label} (n=${arr.length}) ───`);
  console.log(`  Metrica           | avg    | min    | p10    | p25    | median | p75    | p90    | max`);
  console.log(`  ─────────────────────────────────────────────────────────────────────────────────────`);
  const row = (name, field, sub = null) => {
    const r = s(field, sub);
    console.log(`  ${name.padEnd(17)} | ${r.avg.padStart(6)} | ${r.min.padStart(6)} | ${r.p10.padStart(6)} | ${r.p25.padStart(6)} | ${r.median.padStart(6)} | ${r.p75.padStart(6)} | ${r.p90.padStart(6)} | ${r.max.padStart(6)}`);
  };
  row('energy (EMA)     ', 'maxEnergy');
  row('minEnergy        ', 'minEnergy');
  row('avgEnergy        ', 'avgEnergy');
  row('maxLinAcc        ', 'maxLinAcc');
  row('maxGyro          ', 'maxGyro');
  row('burstDurationMs  ', 'burstDurationMs');
  row('energyRampMs     ', 'energyRampMs');
  row('tiltAngleDeg     ', 'tiltAngleDeg');
  row('deltaBeta        ', 'orientationDelta', 'beta');
  row('deltaGamma       ', 'orientationDelta', 'gamma');
}

// ─── VALIDI ────────────────────────────────────────────────────────────────
console.log(`\n\n🟢 BURST VALIDI (ripetizioni conteggiate)`);

// Split valid bursts by burst index
const single_b1 = validBursts.single.filter(b => b.burstIndex === 1);
const single_b2 = validBursts.single.filter(b => b.burstIndex === 2);
const multi_b1  = validBursts.multi.filter(b => b.burstIndex === 1);
const multi_b2  = validBursts.multi.filter(b => b.burstIndex === 2);
const all_valid = [...validBursts.single, ...validBursts.multi];
const all_b1 = all_valid.filter(b => b.burstIndex === 1);
const all_b2 = all_valid.filter(b => b.burstIndex === 2);

printStats('1 Rep - Burst ANDATA (index=1)', single_b1);
printStats('1 Rep - Burst RITORNO (index=2)', single_b2);
printStats('Multi Rep - Burst ANDATA (index=1)', multi_b1);
printStats('Multi Rep - Burst RITORNO (index=2)', multi_b2);
printStats('TUTTI i validi - ANDATA', all_b1);
printStats('TUTTI i validi - RITORNO', all_b2);

// ─── RIFIUTATI ─────────────────────────────────────────────────────────────
console.log(`\n\n🔴 BURST RIFIUTATI`);
console.log(`  too_short: ${rejectedBursts.tooShort.length}`);
console.log(`  shake:     ${rejectedBursts.shake.length}`);
console.log(`  timeout:   ${rejectedBursts.timeout.length}`);
printStats('Rifiutati (troppo corti)', rejectedBursts.tooShort);
printStats('Rifiutati (shake)', rejectedBursts.shake);

// ─── ANALISI CRITICA: ZONA GRIGIA ────────────────────────────────────────
console.log(`\n\n⚠️  ANALISI ZONA GRIGIA: COSA SEPARA VERO/FALSO?`);
const validEnergies = all_valid.map(b => b.maxEnergy).sort((a, b) => a - b);
const shortEnergies = rejectedBursts.tooShort.map(b => b.maxEnergy).sort((a, b) => a - b);
console.log(`\n  Energia MIN dei VALIDI:         ${validEnergies[0]?.toFixed(2)}`);
console.log(`  Energia MAX dei TOO_SHORT:      ${shortEnergies[shortEnergies.length - 1]?.toFixed(2)}`);
const validGyros = all_valid.map(b => b.maxGyro).sort((a, b) => a - b);
const shakeGyros = rejectedBursts.shake.map(b => b.maxGyro).sort((a, b) => a - b);
console.log(`\n  Gyro MIN dei VALIDI:            ${validGyros[0]?.toFixed(2)}`);
console.log(`  Gyro MIN dei SHAKE:             ${shakeGyros[0]?.toFixed(2)}`);
console.log(`  Gyro MAX dei VALIDI:            ${validGyros[validGyros.length - 1]?.toFixed(2)}`);
const validDurations = all_valid.map(b => b.burstDurationMs).sort((a, b) => a - b);
const shortDurations = rejectedBursts.tooShort.map(b => b.burstDurationMs).sort((a, b) => a - b);
console.log(`\n  Durata MIN dei VALIDI:          ${validDurations[0]} ms`);
console.log(`  Durata MAX dei TOO_SHORT:       ${shortDurations[shortDurations.length - 1]} ms`);

// ─── RACCOMANDAZIONI ──────────────────────────────────────────────────────
console.log(`\n\n💡 RACCOMANDAZIONI PER LE SOGLIE`);

// THRESH_ACTIVE: deve essere < min energy dei valid bursts
const minValidEnergy = validEnergies[0];
const p10ValidEnergy = stats(all_valid, 'maxEnergy').p10;
console.log(`\n  THRESH_ACTIVE (attivazione burst):`);
console.log(`    Energia minima osservata in un burst VALIDO: ${minValidEnergy?.toFixed(2)}`);
console.log(`    → Soglia suggerita: ${Math.round(minValidEnergy * 0.75)} (75% del minimo, margine di sicurezza)`);

// THRESH_REST: deve essere > minEnergy durante un burst (per non terminare prematuramente)
const allMinEnergies = all_valid.map(b => b.minEnergy).sort((a, b) => a - b);
const maxMinEnergy = allMinEnergies[allMinEnergies.length - 1];
const p90MinEnergy = parseFloat(stats(all_valid, 'minEnergy').p90);
console.log(`\n  THRESH_REST (fine burst):`);
console.log(`    MinEnergy p90 durante bursts validi: ${p90MinEnergy.toFixed(2)}`);
console.log(`    MinEnergy MAX durante bursts validi: ${maxMinEnergy?.toFixed(2)}`);
console.log(`    → Soglia suggerita: ${Math.round(p90MinEnergy)} (deve essere < questo valore)`);

// GYRO_SHAKE: deve essere > max gyro dei valid, < min gyro dei shake
const maxValidGyro = validGyros[validGyros.length - 1];
const minShakeGyro = shakeGyros[0];
console.log(`\n  GYRO_SHAKE_THRESHOLD (anti-shake):`);
console.log(`    Gyro MAX nei burst VALIDI: ${maxValidGyro?.toFixed(2)}`);
console.log(`    Gyro MIN nei burst SHAKE:  ${minShakeGyro?.toFixed(2)}`);
if (maxValidGyro && minShakeGyro) {
  const midpoint = Math.round((maxValidGyro + minShakeGyro) / 2);
  console.log(`    → Soglia suggerita: ${midpoint} (punto medio tra i due)`);
}

// MIN_BURST_DURATION
console.log(`\n  MIN_BURST_DURATION (filtro too_short):`);
console.log(`    Durata MIN dei VALIDI: ${validDurations[0]} ms`);
console.log(`    Durata MAX dei TOO_SHORT: ${shortDurations[shortDurations.length - 1]} ms`);
const suggestedMinDuration = Math.round((validDurations[0] + shortDurations[shortDurations.length - 1]) / 2);
console.log(`    → Soglia suggerita: ${suggestedMinDuration} ms`);

// Check if current thresholds are right
console.log(`\n\n🔍 CONFRONTO CON SOGLIE ATTUALI`);
const CURRENT_ACTIVE = 150;
const CURRENT_REST = 80;
const CURRENT_SHAKE = 700;
const CURRENT_MIN_DURATION = 200;
console.log(`\n  Attuale THRESH_ACTIVE = ${CURRENT_ACTIVE}  |  Minimo valido osservato: ${minValidEnergy?.toFixed(2)}  → ${minValidEnergy < CURRENT_ACTIVE ? '⚠️  RISCHIO FALSI NEGATIVI' : '✅ OK'}`);
const realRestThresh = parseFloat(stats(all_valid, 'minEnergy').p90);
console.log(`  Attuale THRESH_REST   = ${CURRENT_REST}  |  MinEnergy p90 validi: ${realRestThresh.toFixed(2)}  → ${CURRENT_REST > realRestThresh ? '⚠️  TROPPO ALTO, potrebbe terminare il burst prematuramente' : '✅ OK'}`);
console.log(`  Attuale GYRO_SHAKE    = ${CURRENT_SHAKE} |  Max Gyro valido: ${maxValidGyro?.toFixed(2)}  → ${maxValidGyro > CURRENT_SHAKE ? '⚠️  FALSI POSITIVI: ripetizioni vere vengono scartate come shake!' : '✅ OK'}`);
console.log(`  Attuale MIN_DURATION  = ${CURRENT_MIN_DURATION} ms |  Min durata valida: ${validDurations[0]} ms  → ${validDurations[0] < CURRENT_MIN_DURATION ? '⚠️  RISCHIO FALSI NEGATIVI: rep brevi vengono scartate' : '✅ OK'}`);
