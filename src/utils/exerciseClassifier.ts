/**
 * exerciseClassifier.ts — Pipeline di sanitizzazione, catalogo canonico degli esercizi
 * e classificazione automatica nei gruppi muscolari per report analitici.
 */

export type MuscleGroup = 'Petto' | 'Dorso' | 'Gambe' | 'Spalle' | 'Braccia' | 'Addome' | 'Altro';

export interface CanonicalExercise {
  id: string;
  displayName: string;
  muscleGroup: MuscleGroup;
  aliases: string[];
}

export interface ClassifiedExercise {
  id: string;
  displayName: string;
  muscleGroup: MuscleGroup;
  isCanonical: boolean;
  matchedAlias?: string;
}

/**
 * Pipeline di Sanitizzazione delle Stringhe (Requisito 1):
 * - Minuscolo e trim.
 * - Rimozione accenti e caratteri diacritici (normalize NFD).
 * - Sostituzione trattini (-) e underscore (_) con spazi singoli.
 * - Eliminazione punteggiatura e caratteri speciali.
 * - Collasso sequenze di spazi multipli in spazio singolo.
 */
export const cleanExerciseName = (rawName: string): string => {
  if (!rawName) return '';
  return rawName
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove diacritici/accenti
    .replace(/[-_]/g, ' ')           // sostituisce - e _ con spazio
    .replace(/[^\w\s]/g, ' ')        // rimuove simboli e punteggiatura
    .replace(/\s+/g, ' ')            // riduce spazi multipli a singolo
    .trim();
};

/**
 * Catalogo Canonico degli Esercizi e Dizionario degli Alias (Requisito 2).
 * Include oltre 50 movimenti fondamentali con centinaia di varianti e abbreviazioni
 * in lingua italiana e inglese.
 */
export const CANONICAL_EXERCISES: CanonicalExercise[] = [
  // ─── PETTO ────────────────────────────────────────────────────────────────
  {
    id: 'panca_piana',
    displayName: 'Panca Piana Bilanciere',
    muscleGroup: 'Petto',
    aliases: [
      'panca piana',
      'panca piana bilanciere',
      'bench press',
      'flat bench',
      'distensioni panca piana',
      'distensioni su panca',
      'bilanciere panca',
      'flat barbell bench press',
      'panca bilanciere',
    ],
  },
  {
    id: 'panca_inclinata',
    displayName: 'Panca Inclinata',
    muscleGroup: 'Petto',
    aliases: [
      'panca inclinata',
      'incline bench',
      'incline press',
      'incline dumbbell press',
      'incline barbell bench press',
      'spinte panca inclinata',
      'distensioni panca inclinata',
      'panca 30',
      'panca 45',
      'panca inclinata manubri',
      'panca inclinata bilanciere',
    ],
  },
  {
    id: 'panca_declinata',
    displayName: 'Panca Declinata',
    muscleGroup: 'Petto',
    aliases: [
      'panca declinata',
      'decline bench',
      'decline press',
      'spinte panca declinata',
      'distensioni panca declinata',
    ],
  },
  {
    id: 'spinte_manubri_petto',
    displayName: 'Spinte con Manubri (Petto)',
    muscleGroup: 'Petto',
    aliases: [
      'spinte manubri',
      'spinte con manubri',
      'dumbbell press',
      'db bench press',
      'spinte panca piana manubri',
      'distensioni manubri',
      'spinte panca',
    ],
  },
  {
    id: 'croci',
    displayName: 'Croci (Manubri / Cavi)',
    muscleGroup: 'Petto',
    aliases: [
      'croci',
      'croci manubri',
      'croci con manubri',
      'croci panca piana',
      'croci panca inclinata',
      'croci cavi',
      'croci ai cavi',
      'cable fly',
      'dumbbell fly',
      'chest fly',
      'fly manubri',
      'aperture manubri',
    ],
  },
  {
    id: 'push_up',
    displayName: 'Push-up / Piegamenti',
    muscleGroup: 'Petto',
    aliases: [
      'push up',
      'pushup',
      'pushups',
      'push ups',
      'piegamenti',
      'piegamenti a terra',
      'piegamenti sulle braccia',
      'flessioni',
      'diamond push up',
    ],
  },
  {
    id: 'chest_dip',
    displayName: 'Dip alle Parallele (Petto)',
    muscleGroup: 'Petto',
    aliases: [
      'dips petto',
      'chest dips',
      'dip parallele petto',
      'dip alle parallele',
      'parallele petto',
    ],
  },
  {
    id: 'chest_press',
    displayName: 'Chest Press / Pectoral Machine',
    muscleGroup: 'Petto',
    aliases: [
      'chest press',
      'chest press machine',
      'pectoral machine',
      'pec deck',
      'pectoral',
      'macchina petto',
    ],
  },
  {
    id: 'pullover',
    displayName: 'Pullover',
    muscleGroup: 'Petto',
    aliases: [
      'pullover',
      'pull over',
      'pullover manubrio',
      'pullover bilanciere',
      'dumbbell pullover',
    ],
  },

  // ─── DORSO ────────────────────────────────────────────────────────────────
  {
    id: 'pull_up',
    displayName: 'Trazioni / Pull-up',
    muscleGroup: 'Dorso',
    aliases: [
      'pull up',
      'pullup',
      'pullups',
      'pull ups',
      'trazioni',
      'trazione',
      'trazioni alla sbarra',
      'trazioni sbarra',
      'alla sbarra',
      'chin up',
      'chinup',
      'chinups',
      'chin ups',
      'trazioni presa prona',
      'trazioni presa supina',
      'trazioni presa neutra',
      'trazioni zavorrate',
      'weighted pull up',
    ],
  },
  {
    id: 'lat_machine',
    displayName: 'Lat Machine / Pulldown',
    muscleGroup: 'Dorso',
    aliases: [
      'lat machine',
      'latmachine',
      'lat machine avanti',
      'lat pulldown',
      'lat machine presa stretta',
      'lat machine presa inversa',
      'lat machine triangolo',
      'trazioni lat machine',
      'pulldown',
    ],
  },
  {
    id: 'rematore_bilanciere',
    displayName: 'Rematore con Bilanciere',
    muscleGroup: 'Dorso',
    aliases: [
      'rematore bilanciere',
      'rematore con bilanciere',
      'barbell row',
      'bent over row',
      'pendlay row',
      'rematore presa prona',
      'rematore presa supina',
      'rematore yates',
    ],
  },
  {
    id: 'rematore_manubrio',
    displayName: 'Rematore con Manubrio',
    muscleGroup: 'Dorso',
    aliases: [
      'rematore manubrio',
      'rematore con manubrio',
      'dumbbell row',
      'one arm dumbbell row',
      'single arm row',
      'rematore singolo',
      'rematore manubrio su panca',
    ],
  },
  {
    id: 'pulley_basso',
    displayName: 'Pulley Basso / Seated Row',
    muscleGroup: 'Dorso',
    aliases: [
      'pulley',
      'pulley basso',
      'seated cable row',
      'cable row',
      'pulley presa stretta',
      'pulley triangolo',
      'rematore al cavo',
      'rematore cavi',
    ],
  },
  {
    id: 't_bar_row',
    displayName: 'T-Bar Row',
    muscleGroup: 'Dorso',
    aliases: [
      't bar',
      't bar row',
      'rematore t bar',
      'tbar row',
      'tbar',
    ],
  },
  {
    id: 'stacco_da_terra',
    displayName: 'Stacco da Terra / Deadlift',
    muscleGroup: 'Dorso',
    aliases: [
      'stacco',
      'stacchi',
      'stacco da terra',
      'deadlift',
      'conventional deadlift',
      'sumo deadlift',
      'stacco sumo',
      'stacco regolare',
      'barbell deadlift',
    ],
  },
  {
    id: 'pulldown_braccia_tese',
    displayName: 'Pulldown a Braccia Tese',
    muscleGroup: 'Dorso',
    aliases: [
      'pulldown braccia tese',
      'straight arm pulldown',
      'pull down cavi',
      'pull down braccia tese',
    ],
  },
  {
    id: 'iperestensioni',
    displayName: 'Iperestensioni / Hyperextension',
    muscleGroup: 'Dorso',
    aliases: [
      'hyperextension',
      'iperestensioni',
      'back extension',
      'lombari',
      'estensioni lombari',
    ],
  },

  // ─── GAMBE ────────────────────────────────────────────────────────────────
  {
    id: 'squat',
    displayName: 'Squat con Bilanciere',
    muscleGroup: 'Gambe',
    aliases: [
      'squat',
      'back squat',
      'barbell squat',
      'squat bilanciere',
      'accosciata',
      'front squat',
      'squat frontale',
      'box squat',
      'squat corpo libero',
    ],
  },
  {
    id: 'leg_press',
    displayName: 'Leg Press',
    muscleGroup: 'Gambe',
    aliases: [
      'leg press',
      'pressa',
      'pressa 45',
      'pressa orizzontale',
      'pressa gambe',
      'leg press 45',
    ],
  },
  {
    id: 'stacco_rumeno',
    displayName: 'Stacco Rumeno / RDL',
    muscleGroup: 'Gambe',
    aliases: [
      'rdl',
      'romanian deadlift',
      'stacco rumeno',
      'stacchi rumeni',
      'stacco gambe tese',
      'stacco a gambe semitese',
      'stacco manubri rumeno',
    ],
  },
  {
    id: 'affondi',
    displayName: 'Affondi / Lunges',
    muscleGroup: 'Gambe',
    aliases: [
      'affondi',
      'lunges',
      'lunge',
      'affondi manubri',
      'affondi con manubri',
      'affondi bilanciere',
      'walking lunges',
      'affondi camminati',
      'affondi sul posto',
      'affondi posteriori',
    ],
  },
  {
    id: 'bulgarian_split_squat',
    displayName: 'Bulgarian Split Squat',
    muscleGroup: 'Gambe',
    aliases: [
      'bulgarian split squat',
      'squat bulgaro',
      'split squat',
      'bulgaro',
      'bulgarian squat',
    ],
  },
  {
    id: 'leg_extension',
    displayName: 'Leg Extension',
    muscleGroup: 'Gambe',
    aliases: [
      'leg extension',
      'leg ext',
      'estensioni gambe',
      'quadricipiti machine',
    ],
  },
  {
    id: 'leg_curl',
    displayName: 'Leg Curl',
    muscleGroup: 'Gambe',
    aliases: [
      'leg curl',
      'leg curls',
      'lying leg curl',
      'seated leg curl',
      'femorali',
      'femorali machine',
      'leg curl sdraiato',
      'leg curl seduto',
    ],
  },
  {
    id: 'hip_thrust',
    displayName: 'Hip Thrust',
    muscleGroup: 'Gambe',
    aliases: [
      'hip thrust',
      'hipthrust',
      'hip thrust bilanciere',
      'glute bridge',
      'ponte glutei',
      'spinte glutei',
    ],
  },
  {
    id: 'polpacci_calf',
    displayName: 'Polpacci / Calf Raise',
    muscleGroup: 'Gambe',
    aliases: [
      'calf',
      'calf raise',
      'calf raises',
      'polpacci',
      'calf in piedi',
      'calf seduto',
      'calf machine',
      'standing calf raise',
      'seated calf raise',
    ],
  },
  {
    id: 'hack_squat',
    displayName: 'Hack Squat',
    muscleGroup: 'Gambe',
    aliases: [
      'hack squat',
      'hacksquat',
      'hack squat machine',
    ],
  },
  {
    id: 'adductor_abductor',
    displayName: 'Adduttori / Abduttori',
    muscleGroup: 'Gambe',
    aliases: [
      'adductor',
      'abductor',
      'adductor machine',
      'abductor machine',
      'adduttori',
      'abduttori',
      'interno coscia',
      'esterno coscia',
    ],
  },

  // ─── SPALLE ───────────────────────────────────────────────────────────────
  {
    id: 'military_press',
    displayName: 'Military Press / Lento Avanti',
    muscleGroup: 'Spalle',
    aliases: [
      'military press',
      'lento avanti',
      'overhead press',
      'ohp',
      'lento bilanciere',
      'lento avanti bilanciere',
      'shoulder press',
      'lento',
      'military',
      'distensioni sopra la testa',
    ],
  },
  {
    id: 'spinte_manubri_spalle',
    displayName: 'Spinte Manubri Spalle',
    muscleGroup: 'Spalle',
    aliases: [
      'spinte spalle',
      'spinte spalle manubri',
      'dumbbell shoulder press',
      'lento manubri',
      'lento avanti manubri',
      'arnold press',
      'spinte arnold',
    ],
  },
  {
    id: 'alzate_laterali',
    displayName: 'Alzate Laterali',
    muscleGroup: 'Spalle',
    aliases: [
      'alzate laterali',
      'lateral raise',
      'lateral raises',
      'alzate laterali manubri',
      'alzate laterali cavi',
      'alzate laterali cavo',
      'cable lateral raise',
    ],
  },
  {
    id: 'alzate_frontali',
    displayName: 'Alzate Frontali',
    muscleGroup: 'Spalle',
    aliases: [
      'alzate frontali',
      'front raise',
      'front raises',
      'alzate frontali manubri',
      'alzate frontali bilanciere',
      'alzate frontali disco',
    ],
  },
  {
    id: 'alzate_posteriori_face_pull',
    displayName: 'Alzate Posteriori / Face Pull',
    muscleGroup: 'Spalle',
    aliases: [
      'alzate posteriori',
      'rear delt fly',
      'rear delt',
      'face pull',
      'facepull',
      'face pulls',
      'deltoidi posteriori',
      'croci inverse',
      'reverse fly',
      'rear delt raises',
    ],
  },
  {
    id: 'scrollate_shrugs',
    displayName: 'Scrollate / Shrugs (Trapezi)',
    muscleGroup: 'Spalle',
    aliases: [
      'scrollate',
      'shrugs',
      'shrug',
      'scrollate manubri',
      'scrollate bilanciere',
      'trapezi',
    ],
  },

  // ─── BRACCIA ──────────────────────────────────────────────────────────────
  {
    id: 'curl_bilanciere',
    displayName: 'Curl con Bilanciere (Bicipiti)',
    muscleGroup: 'Braccia',
    aliases: [
      'curl bilanciere',
      'barbell curl',
      'bicep curl',
      'bicipiti bilanciere',
      'curl bilanciere ez',
      'curl sagomato',
      'curl ez',
      'bicipiti',
    ],
  },
  {
    id: 'curl_manubri',
    displayName: 'Curl con Manubri',
    muscleGroup: 'Braccia',
    aliases: [
      'curl manubri',
      'dumbbell curl',
      'bicipiti manubri',
      'curl alternato',
      'curl panca inclinata',
      'curl seduto manubri',
      'curl manubrio',
    ],
  },
  {
    id: 'hammer_curl',
    displayName: 'Hammer Curl (A Martello)',
    muscleGroup: 'Braccia',
    aliases: [
      'hammer curl',
      'hammer curls',
      'curl a martello',
      'curl martello',
      'martello',
      'bicipiti martello',
    ],
  },
  {
    id: 'curl_panca_scott',
    displayName: 'Curl alla Panca Scott',
    muscleGroup: 'Braccia',
    aliases: [
      'panca scott',
      'preacher curl',
      'curl scott',
      'curl panca scott',
      'scott curl',
    ],
  },
  {
    id: 'curl_cavi',
    displayName: 'Curl ai Cavi',
    muscleGroup: 'Braccia',
    aliases: [
      'curl cavi',
      'curl ai cavi',
      'cable curl',
      'bicipiti cavo',
      'bicipiti cavi',
    ],
  },
  {
    id: 'pushdown_tricipiti',
    displayName: 'Pushdown ai Cavi (Tricipiti)',
    muscleGroup: 'Braccia',
    aliases: [
      'pushdown',
      'push down',
      'tricipiti cavi',
      'tricipiti corda',
      'pushdown corda',
      'pushdown sbarra',
      'cable triceps extension',
      'tricipiti al cavo',
      'tricipiti',
    ],
  },
  {
    id: 'french_press',
    displayName: 'French Press / Skull Crusher',
    muscleGroup: 'Braccia',
    aliases: [
      'french press',
      'skull crusher',
      'skull crushers',
      'french press bilanciere',
      'french press manubri',
      'estensioni tricipiti bilanciere',
    ],
  },
  {
    id: 'dip_tricipiti',
    displayName: 'Dip tra Panche / Tricipiti',
    muscleGroup: 'Braccia',
    aliases: [
      'dips tricipiti',
      'dip tricipiti',
      'bench dips',
      'dip tra panche',
      'dip panca',
    ],
  },
  {
    id: 'estensioni_tricipiti_manubrio',
    displayName: 'Estensioni Tricipiti con Manubrio',
    muscleGroup: 'Braccia',
    aliases: [
      'estensioni tricipiti',
      'tricep extension',
      'kickback',
      'kickback manubrio',
      'estensione manubrio sopra la testa',
      'overhead tricep extension',
    ],
  },

  // ─── ADDOME ───────────────────────────────────────────────────────────────
  {
    id: 'crunch',
    displayName: 'Crunch',
    muscleGroup: 'Addome',
    aliases: [
      'crunch',
      'crunches',
      'crunch a terra',
      'addominali',
      'addome',
      'crunch inverso',
      'reverse crunch',
    ],
  },
  {
    id: 'crunch_cavo',
    displayName: 'Crunch ai Cavi',
    muscleGroup: 'Addome',
    aliases: [
      'cable crunch',
      'crunch cavi',
      'crunch cavo',
      'crunch corda',
      'addominali cavo',
    ],
  },
  {
    id: 'plank',
    displayName: 'Plank',
    muscleGroup: 'Addome',
    aliases: [
      'plank',
      'side plank',
      'plank isometrico',
      'ponte addominale',
      'hollow body',
      'hollow position',
    ],
  },
  {
    id: 'leg_raise',
    displayName: 'Leg Raise / Sollevamento Gambe',
    muscleGroup: 'Addome',
    aliases: [
      'leg raise',
      'leg raises',
      'hanging leg raise',
      'sollevamento gambe',
      'gambe alla sbarra',
      'alzate gambe',
      'knee raise',
    ],
  },
  {
    id: 'russian_twist',
    displayName: 'Russian Twist',
    muscleGroup: 'Addome',
    aliases: [
      'russian twist',
      'twist',
      'russian twists',
    ],
  },
  {
    id: 'ab_wheel',
    displayName: 'Ab Wheel / Ruota Addominali',
    muscleGroup: 'Addome',
    aliases: [
      'ab wheel',
      'ab roller',
      'ruota addominale',
      'ruota addominali',
    ],
  },
  {
    id: 'sit_up',
    displayName: 'Sit-up',
    muscleGroup: 'Addome',
    aliases: [
      'sit up',
      'situp',
      'sit ups',
      'sit-up',
    ],
  },
];

// Matrice euristica di parole chiave per dedurre il gruppo muscolare per movimenti non catalogati
const MUSCLE_HEURISTICS: Array<{ group: MuscleGroup; keywords: string[] }> = [
  {
    group: 'Petto',
    keywords: ['petto', 'chest', 'panca', 'croci', 'pushup', 'push up', 'piegamenti', 'declinat', 'inclinat', 'pector'],
  },
  {
    group: 'Dorso',
    keywords: ['dorso', 'back', 'lat', 'pulley', 'remator', 'row', 'trazion', 'pull up', 'chin up', 'deadlift', 'stacc', 'lombari', 'hyperext'],
  },
  {
    group: 'Gambe',
    keywords: ['gamb', 'leg', 'squat', 'pressa', 'affond', 'polpacc', 'calf', 'femoral', 'quadricep', 'glute', 'thrust', 'cosci', 'adductor', 'abductor', 'accosciat'],
  },
  {
    group: 'Spalle',
    keywords: ['spall', 'shoulder', 'deltoid', 'militar', 'lento', 'alzat', 'face pull', 'shrug', 'trapez'],
  },
  {
    group: 'Braccia',
    keywords: ['bicipit', 'bicep', 'tricipit', 'tricep', 'curl', 'french', 'pushdown', 'dip', 'bracc', 'skull crush', 'kickback'],
  },
  {
    group: 'Addome',
    keywords: ['addom', 'core', 'abs', 'crunch', 'plank', 'leg raise', 'situp', 'sit up', 'twist', 'roller', 'wheel'],
  },
];

const capitalize = (str: string): string => {
  if (!str) return '';
  return str
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join(' ');
};

/**
 * Deduce il gruppo muscolare a partire dalle parole chiave contenute nel nome pulito.
 */
export const inferMuscleGroupFromKeywords = (cleanedName: string): MuscleGroup => {
  for (const { group, keywords } of MUSCLE_HEURISTICS) {
    if (keywords.some((kw) => cleanedName.includes(kw))) {
      return group;
    }
  }
  return 'Altro';
};

/**
 * Algoritmo di Classificazione e Matching Intelligente.
 * Accetta qualsiasi stringa inserita liberamente dall'utente e restituisce
 * l'entità canonica o una classificazione euristica coerente.
 */
export const matchExercise = (rawName: string): ClassifiedExercise => {
  const cleaned = cleanExerciseName(rawName);
  if (!cleaned) {
    return {
      id: 'custom_exercise',
      displayName: 'Esercizio',
      muscleGroup: 'Altro',
      isCanonical: false,
    };
  }

  // 1. Ricerca corrispondenza esatta con un alias
  for (const canonical of CANONICAL_EXERCISES) {
    for (const alias of canonical.aliases) {
      if (cleanExerciseName(alias) === cleaned) {
        return {
          id: canonical.id,
          displayName: canonical.displayName,
          muscleGroup: canonical.muscleGroup,
          isCanonical: true,
          matchedAlias: alias,
        };
      }
    }
  }

  // 2. Ricerca per contenimento completo di frase (sottostringa o superstringa)
  // Es. "panca inclinata manubri 30 gradi" contiene l'alias "panca inclinata manubri"
  let bestMatch: CanonicalExercise | null = null;
  let longestAliasLength = 0;
  let bestMatchedAlias = '';

  for (const canonical of CANONICAL_EXERCISES) {
    for (const alias of canonical.aliases) {
      const cleanAlias = cleanExerciseName(alias);
      if (cleanAlias.length >= 3 && cleaned.includes(cleanAlias)) {
        if (cleanAlias.length > longestAliasLength) {
          bestMatch = canonical;
          longestAliasLength = cleanAlias.length;
          bestMatchedAlias = alias;
        }
      }
    }
  }

  if (bestMatch) {
    return {
      id: bestMatch.id,
      displayName: bestMatch.displayName,
      muscleGroup: bestMatch.muscleGroup,
      isCanonical: true,
      matchedAlias: bestMatchedAlias,
    };
  }

  // 3. Ricerca per sovrapposizione di token significativi (parole chiave dell'alias)
  const inputTokens = new Set(cleaned.split(' '));
  for (const canonical of CANONICAL_EXERCISES) {
    for (const alias of canonical.aliases) {
      const aliasTokens = cleanExerciseName(alias).split(' ');
      if (aliasTokens.length >= 2 && aliasTokens.every((token) => inputTokens.has(token))) {
        return {
          id: canonical.id,
          displayName: canonical.displayName,
          muscleGroup: canonical.muscleGroup,
          isCanonical: true,
          matchedAlias: alias,
        };
      }
    }
  }

  // 4. Fallback Euristico per esercizi personalizzati non presenti nel catalogo
  const inferredGroup = inferMuscleGroupFromKeywords(cleaned);
  const safeId = `custom_${cleaned.replace(/\s+/g, '_')}`;

  return {
    id: safeId,
    displayName: capitalize(cleaned),
    muscleGroup: inferredGroup,
    isCanonical: false,
  };
};
