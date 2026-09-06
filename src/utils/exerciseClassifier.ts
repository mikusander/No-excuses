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
export const cleanExerciseName = (rawName: unknown): string => {
  if (rawName == null) return '';
  const str = typeof rawName === 'string' ? rawName : String(rawName);
  if (!str.trim()) return '';
  return str
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
 * Calcola la distanza di Levenshtein tra due stringhe (numero minimo di modifiche: inserimenti, cancellazioni, sostituzioni).
 */
export const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length];
};

/**
 * Calcola il coefficiente di similarità normalizzato tra due stringhe (valore da 0.0 a 1.0).
 */
export const calculateStringSimilarity = (strA: string, strB: string): number => {
  const a = cleanExerciseName(strA);
  const b = cleanExerciseName(strB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const dist = levenshteinDistance(a, b);
  return Math.max(0, (maxLen - dist) / maxLen);
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
      'push-up',
      'push-ups',
      'piegamenti',
      'piegamenti a terra',
      'piegamenti sulle braccia',
      'flessioni',
      'diamond push up',
      'diamond push-up',
      'piegamento',
    ],
  },
  {
    id: 'chest_dip',
    displayName: 'Dip alle Parallele / Dips',
    muscleGroup: 'Petto',
    aliases: [
      'dips',
      'dip',
      'dips petto',
      'chest dips',
      'dip parallele petto',
      'dip alle parallele',
      'dip parallele',
      'parallele petto',
      'parallele',
      'bar dips',
      'parallel bar dips',
      'dip alle sbarre',
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
    id: 'muscle_up',
    displayName: 'Muscle Up',
    muscleGroup: 'Dorso',
    aliases: [
      'muscle up',
      'muscleup',
      'muscleups',
      'muscle ups',
      'muscle-up',
      'muscle-ups',
      'musckle up',
      'musckleup',
      'musle up',
      'musleup',
      'mascol ap',
      'mascolap',
      'bar muscle up',
      'bar muscleup',
      'ring muscle up',
      'ring muscleup',
      'muscle up sbarra',
      'muscle up anelli',
      'barmuscleup',
      'ringmuscleup',
    ],
  },
  {
    id: 'front_lever',
    displayName: 'Front Lever',
    muscleGroup: 'Dorso',
    aliases: [
      'front lever',
      'frontlever',
      'fl',
      'front lever hold',
      'front lever pull',
      'front lever raises',
      'tuck front lever',
      'adv tuck front lever',
      'straddle front lever',
    ],
  },
  {
    id: 'back_lever',
    displayName: 'Back Lever',
    muscleGroup: 'Dorso',
    aliases: [
      'back lever',
      'backlever',
      'bl',
      'tuck back lever',
      'straddle back lever',
    ],
  },
  {
    id: 'australian_pull_up',
    displayName: 'Australian Pull-up / Bodyweight Row',
    muscleGroup: 'Dorso',
    aliases: [
      'australian pull up',
      'australian pull-up',
      'australian pullup',
      'australian',
      'trazioni australiane',
      'trazioni orizzontali',
      'bodyweight row',
      'incline row',
      'trazioni orizzontali sbarra',
    ],
  },
  {
    id: 'pull_up',
    displayName: 'Trazioni / Pull-up',
    muscleGroup: 'Dorso',
    aliases: [
      'pull up',
      'pullup',
      'pullups',
      'pull ups',
      'pull-up',
      'pull-ups',
      'trazioni',
      'trazione',
      'trazioni alla sbarra',
      'trazioni sbarra',
      'alla sbarra',
      'chin up',
      'chinup',
      'chinups',
      'chin ups',
      'chin-up',
      'chin-ups',
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
  {
    id: 'pistol_squat',
    displayName: 'Pistol Squat (Una Gamba)',
    muscleGroup: 'Gambe',
    aliases: [
      'pistol squat',
      'pistol',
      'pistols',
      'squat a una gamba',
      'squat monopodalico',
      'single leg squat',
      'one leg squat',
      'pistol squats',
    ],
  },

  // ─── SPALLE ───────────────────────────────────────────────────────────────
  {
    id: 'planche',
    displayName: 'Planche',
    muscleGroup: 'Spalle',
    aliases: [
      'planche',
      'tuck planche',
      'adv tuck planche',
      'straddle planche',
      'full planche',
      'planche lean',
      'planche push up',
      'planche push-up',
    ],
  },
  {
    id: 'handstand_push_up',
    displayName: 'Handstand Push-up (HSPU) / Verticale',
    muscleGroup: 'Spalle',
    aliases: [
      'hspu',
      'handstand push up',
      'handstand pushup',
      'handstand push-up',
      'handstand',
      'verticale',
      'piegamenti in verticale',
      'piegamenti verticale',
      'verticale push up',
      'pike push up',
      'pike pushup',
      'pike push-up',
      'wall hspu',
    ],
  },
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
  {
    id: 'dragon_flag',
    displayName: 'Dragon Flag',
    muscleGroup: 'Addome',
    aliases: [
      'dragon flag',
      'dragonflag',
      'dragon flags',
      'dragon-flag',
    ],
  },
  {
    id: 'l_sit',
    displayName: 'L-Sit / V-Sit',
    muscleGroup: 'Addome',
    aliases: [
      'l-sit',
      'l sit',
      'lsit',
      'v-sit',
      'v sit',
      'vsit',
      'manna',
    ],
  },
  {
    id: 'human_flag',
    displayName: 'Human Flag (Bandiera)',
    muscleGroup: 'Addome',
    aliases: [
      'human flag',
      'bandiera',
      'humanflag',
      'human-flag',
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
    keywords: ['dorso', 'back', 'lat', 'pulley', 'remator', 'row', 'trazion', 'pull up', 'chin up', 'deadlift', 'stacc', 'lombari', 'hyperext', 'muscle', 'musckle', 'musle', 'front lever', 'back lever', 'australian'],
  },
  {
    group: 'Gambe',
    keywords: ['gamb', 'leg', 'squat', 'pressa', 'affond', 'polpacc', 'calf', 'femoral', 'quadricep', 'glute', 'thrust', 'cosci', 'adductor', 'abductor', 'accosciat', 'pistol'],
  },
  {
    group: 'Spalle',
    keywords: ['spall', 'shoulder', 'deltoid', 'militar', 'lento', 'alzat', 'face pull', 'shrug', 'trapez', 'planche', 'hspu', 'handstand', 'vertical'],
  },
  {
    group: 'Braccia',
    keywords: ['bicipit', 'bicep', 'tricipit', 'tricep', 'curl', 'french', 'pushdown', 'dip', 'bracc', 'skull crush', 'kickback'],
  },
  {
    group: 'Addome',
    keywords: ['addom', 'core', 'abs', 'crunch', 'plank', 'leg raise', 'situp', 'sit up', 'twist', 'roller', 'wheel', 'dragon', 'l sit', 'lsit', 'v sit', 'vsit', 'bandiera', 'flag'],
  },
];

const capitalize = (str: unknown): string => {
  if (str == null) return '';
  const s = typeof str === 'string' ? str : String(str);
  if (!s.trim()) return '';
  return s
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
 * Supporta:
 * 1. Matching esatto alias
 * 2. Contenimento di frase
 * 3. Sovrapposizione di token
 * 4. Fuzzy Matching con Distanza di Levenshtein (tolleranza refusi ortografici)
 * 5. Euristica delle parole chiave
 * 6. Euristica Contestuale della Sessione (se passato contextualMuscleGroup)
 */
export const matchExercise = (
  rawName: unknown,
  contextualMuscleGroup?: MuscleGroup
): ClassifiedExercise => {
  const cleaned = cleanExerciseName(rawName);
  if (!cleaned) {
    return {
      id: 'custom_exercise',
      displayName: 'Esercizio',
      muscleGroup: contextualMuscleGroup && contextualMuscleGroup !== 'Altro' ? contextualMuscleGroup : 'Altro',
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

  // 4. Fuzzy Matching con Distanza di Levenshtein (Tolleranza Refusi ed Errori di Battitura)
  // Gestisce casi come "musckle up" -> "muscle up", "trazini" -> "trazioni", "puch up" -> "push up"
  let bestFuzzyMatch: CanonicalExercise | null = null;
  let bestFuzzyMatchedAlias = '';
  let highestSimilarity = 0;

  for (const canonical of CANONICAL_EXERCISES) {
    for (const alias of canonical.aliases) {
      const cleanAlias = cleanExerciseName(alias);
      if (cleanAlias.length < 4) continue;

      const sim = calculateStringSimilarity(cleaned, cleanAlias);
      const dist = levenshteinDistance(cleaned, cleanAlias);

      // Criterio di tolleranza refusi per frase intera:
      // - somiglianza >= 0.82 E distanza <= 2 (o <= 1 per parole sotto 7 caratteri)
      const isFuzzyClose =
        (sim >= 0.82 && dist <= 2) ||
        (cleaned.length >= 8 && cleanAlias.length >= 8 && dist <= 2) ||
        (cleaned.length >= 5 && cleanAlias.length >= 5 && dist === 1);

      if (isFuzzyClose && sim > highestSimilarity) {
        highestSimilarity = sim;
        bestFuzzyMatch = canonical;
        bestFuzzyMatchedAlias = alias;
      }
    }
  }

  // Controlla anche n-grammi / sottofrasi se l'input contiene parole aggiuntive (es. "musckle up zavorrato")
  const inputWords = cleaned.split(' ');
  if (inputWords.length > 1) {
    for (let len = 1; len <= inputWords.length; len++) {
      for (let start = 0; start <= inputWords.length - len; start++) {
        const subPhrase = inputWords.slice(start, start + len).join(' ');
        if (subPhrase.length < 4) continue;

        for (const canonical of CANONICAL_EXERCISES) {
          for (const alias of canonical.aliases) {
            const cleanAlias = cleanExerciseName(alias);
            if (cleanAlias.length < 4) continue;

            const sim = calculateStringSimilarity(subPhrase, cleanAlias);
            const dist = levenshteinDistance(subPhrase, cleanAlias);

            if (dist <= 1 && sim >= 0.82 && sim > highestSimilarity) {
              highestSimilarity = sim;
              bestFuzzyMatch = canonical;
              bestFuzzyMatchedAlias = alias;
            }
          }
        }
      }
    }
  }

  if (bestFuzzyMatch && highestSimilarity >= 0.80) {
    return {
      id: bestFuzzyMatch.id,
      displayName: bestFuzzyMatch.displayName,
      muscleGroup: bestFuzzyMatch.muscleGroup,
      isCanonical: true,
      matchedAlias: bestFuzzyMatchedAlias,
    };
  }

  // 5. Fallback Euristico per parole chiave nel nome pulito
  let inferredGroup = inferMuscleGroupFromKeywords(cleaned);

  // 6. Euristica Contestuale della Sessione:
  // Se non troviamo parole chiave nel nome (inferredGroup è 'Altro'), ereditiamo il gruppo dominante della sessione
  if (inferredGroup === 'Altro' && contextualMuscleGroup && contextualMuscleGroup !== 'Altro') {
    inferredGroup = contextualMuscleGroup;
  }

  const safeId = `custom_${cleaned.replace(/\s+/g, '_')}`;

  return {
    id: safeId,
    displayName: capitalize(cleaned),
    muscleGroup: inferredGroup,
    isCanonical: false,
  };
};
