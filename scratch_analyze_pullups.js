import fs from 'fs';

const filePath = '/Users/alessandrogautieri/Documents/GitHub/No-excuses/calibration-data/trazioni.txt';
const content = fs.readFileSync(filePath, 'utf8');

// The file format seems to be: "Fatte: <N>" followed by a JSON array "[...]"
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

console.log(`Found ${blocks.length} blocks.`);

const metrics = {
  singleRep: { index1: [], index2: [] },
  multiRep: { index1: [], index2: [] }
};

blocks.forEach(block => {
  const category = block.reps === 1 ? metrics.singleRep : metrics.multiRep;
  block.data.forEach(burst => {
    if (burst.status === 'valid') {
      const idx = burst.burstIndex === 1 ? category.index1 : category.index2;
      idx.push(burst);
    }
  });
});

function computeStats(arr, field, isNested = null) {
  if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
  const values = arr.map(item => {
    if (isNested) return Math.abs(item[field][isNested]);
    return item[field];
  });
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { avg: avg.toFixed(2), min: min.toFixed(2), max: max.toFixed(2) };
}

function printCategoryStats(name, category) {
  console.log(`\n=== ${name} ===`);
  [1, 2].forEach(idx => {
    const data = idx === 1 ? category.index1 : category.index2;
    console.log(`\nBurst Index ${idx} (Count: ${data.length})`);
    if (data.length === 0) {
       console.log("  No valid bursts found.");
       return;
    }
    console.log(`  maxEnergy:      `, computeStats(data, 'maxEnergy'));
    console.log(`  minEnergy:      `, computeStats(data, 'minEnergy'));
    console.log(`  burstDuration:  `, computeStats(data, 'burstDurationMs'));
    console.log(`  maxLinAcc:      `, computeStats(data, 'maxLinAcc'));
    console.log(`  maxGyro:        `, computeStats(data, 'maxGyro'));
    console.log(`  tiltAngleDeg:   `, computeStats(data, 'tiltAngleDeg'));
    console.log(`  deltaBeta:      `, computeStats(data, 'orientationDelta', 'beta'));
    console.log(`  deltaGamma:     `, computeStats(data, 'orientationDelta', 'gamma'));
  });
}

printCategoryStats("Serie da 1 Ripetizione", metrics.singleRep);
printCategoryStats("Serie Multiple (>1 Ripetizioni)", metrics.multiRep);
