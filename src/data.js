// Game content: species, illnesses, supplies, upgrades, anomaly signs,
// night rules, doctor briefings and text pools.

export const SPECIES = {
  dog: {
    name: 'Dog',
    temp: [38.0, 39.2],
    hr: [70, 140],
    breeds: ['Beagle mix', 'Corgi', 'Labrador', 'Jack Russell', 'Shiba Inu', 'Mutt', 'Spaniel', 'Pug', 'Collie mix'],
    age: [1, 13],
    weight: [6, 30],
  },
  cat: {
    name: 'Cat',
    temp: [38.1, 39.2],
    hr: [140, 220],
    breeds: ['Tabby', 'Siamese', 'Domestic shorthair', 'Maine Coon', 'Tuxedo', 'Calico', 'British Blue'],
    age: [1, 16],
    weight: [3, 7],
  },
  rabbit: {
    name: 'Rabbit',
    temp: [38.5, 40.0],
    hr: [130, 300],
    breeds: ['Holland Lop', 'Netherland Dwarf', 'Rex', 'Lionhead', 'Dutch'],
    age: [1, 9],
    weight: [1, 4],
  },
  parrot: {
    name: 'Parrot',
    temp: [40.0, 42.0],
    hr: [300, 500],
    breeds: ['Cockatiel', 'Green-cheeked conure', 'Budgerigar', 'Quaker parrot', 'Lovebird'],
    age: [1, 25],
    weight: [0.1, 0.4],
  },
  guineapig: {
    name: 'Guinea pig',
    temp: [37.2, 39.5],
    hr: [230, 380],
    breeds: ['American', 'Abyssinian', 'Teddy', 'Peruvian', 'Crested'],
    age: [1, 6],
    weight: [0.7, 1.2],
  },
};

export const SPECIES_IDS = Object.keys(SPECIES);

// Supplies in the pharmacy cabinet. `shape` drives the little SVG icon.
export const SUPPLIES = {
  antibiotics: { name: 'Antibiotics', shape: 'pill', color: '#e98a8a', price: 25 },
  painkillers: { name: 'Painkillers', shape: 'pill', color: '#8fb8e8', price: 20 },
  splint: { name: 'Splint', shape: 'splint', color: '#e8c27a', price: 25 },
  bandage: { name: 'Bandage roll', shape: 'roll', color: '#f2efe6', price: 10 },
  sutures: { name: 'Suture kit', shape: 'box', color: '#9ad0b4', price: 20 },
  fluids: { name: 'IV fluids', shape: 'bag', color: '#9fd6ec', price: 25 },
  heatpack: { name: 'Heat pack', shape: 'pack', color: '#f0a070', price: 10 },
  antidote: { name: 'Antidote', shape: 'vial', color: '#b3e070', price: 35 },
  cardiac: { name: 'Cardiac meds', shape: 'vial', color: '#e07a9a', price: 35 },
  eardrops: { name: 'Ear drops', shape: 'bottle', color: '#c7a6e8', price: 15 },
  antihistamine: { name: 'Antihistamine', shape: 'pill', color: '#f0e070', price: 20 },
  anesthetic: { name: 'Anesthetic', shape: 'syringe', color: '#d8d8e8', price: 30 },
};

export const SUPPLY_IDS = Object.keys(SUPPLIES);

export const START_STOCK = {
  antibiotics: 3,
  painkillers: 3,
  splint: 2,
  bandage: 3,
  sutures: 2,
  fluids: 3,
  heatpack: 2,
  antidote: 1,
  cardiac: 1,
  eardrops: 2,
  antihistamine: 2,
  anesthetic: 2,
};

// Test result descriptors used by conditions.
// temp: 'normal' | 'high' | 'slightHigh' | 'low'
// heart: { rate: 'normal' | 'fast' | 'slow', rhythm: 'regular' | 'irregular' | 'murmur' }
// scan: 'clear' | 'fracture' | 'foreign' | 'mass' | 'heart'
export const CONDITIONS = {
  infection: {
    name: 'Bacterial infection',
    temp: 'high',
    heart: { rate: 'fast', rhythm: 'regular' },
    scan: 'clear',
    exam: 'Lymph nodes swollen. Ears and belly hot to the touch.',
    treatment: ['antibiotics'],
    surgery: false,
    visual: ['lethargic'],
    severity: 1.0,
    pay: 100,
    complaints: [
      '{name} has been hot and sleepy all day and will not eat.',
      'Off food since yesterday, feels warm, hiding under the bed.',
      'Very quiet. Nose is dry and warm. Not like {pr} at all.',
    ],
  },
  fracture: {
    name: 'Fractured leg',
    temp: 'normal',
    heart: { rate: 'fast', rhythm: 'regular' },
    scan: 'fracture',
    exam: 'Will not bear weight on one leg. Firm, painful swelling mid-limb.',
    treatment: ['splint', 'painkillers'],
    surgery: false,
    visual: ['limp'],
    severity: 0.9,
    pay: 130,
    complaints: [
      '{name} jumped off the balcony and will not put weight on the leg.',
      'Leg got caught in the car door. Yelps when anyone touches it.',
      'Fell down the stairs. Holding one leg up.',
    ],
  },
  foreign: {
    name: 'Swallowed foreign object',
    temp: 'normal',
    heart: { rate: 'normal', rhythm: 'regular' },
    scan: 'foreign',
    exam: 'Abdomen tender and tight. Retching but bringing nothing up.',
    treatment: ['anesthetic', 'sutures'],
    surgery: true,
    visual: ['drool'],
    severity: 1.15,
    pay: 210,
    complaints: [
      'I think {name} swallowed one of the kids\' toys. Keeps gagging.',
      'Vomiting since dinner. One of my earrings is missing.',
      'Chewed up a sock and now will not keep anything down.',
    ],
  },
  laceration: {
    name: 'Deep laceration',
    temp: 'normal',
    heart: { rate: 'fast', rhythm: 'regular' },
    scan: 'clear',
    exam: 'A deep, open cut along the flank. Still oozing.',
    treatment: ['sutures', 'bandage'],
    surgery: false,
    visual: ['wound'],
    severity: 1.0,
    pay: 110,
    complaints: [
      'Cut {pr} side on the fence. Bleeding through the towel.',
      'Fight with something in the garden. Deep scratch, will not stop bleeding.',
      'Caught on broken glass by the bins.',
    ],
  },
  dehydration: {
    name: 'Severe dehydration',
    temp: 'slightHigh',
    heart: { rate: 'fast', rhythm: 'regular' },
    scan: 'clear',
    exam: 'Gums dry and tacky. Skin tent stays up. Eyes slightly sunken.',
    treatment: ['fluids'],
    surgery: false,
    visual: ['lethargic'],
    severity: 0.9,
    pay: 90,
    complaints: [
      '{name} was shut in the shed all afternoon in the heat.',
      'Has not touched the water bowl in two days. Very weak.',
      'Diarrhoea since the weekend. Now barely moving.',
    ],
  },
  hypothermia: {
    name: 'Hypothermia',
    temp: 'low',
    heart: { rate: 'slow', rhythm: 'regular' },
    scan: 'clear',
    exam: 'Paws icy. Muscles stiff. Shivering in long waves.',
    treatment: ['heatpack', 'fluids'],
    surgery: false,
    visual: ['shiver'],
    severity: 1.0,
    pay: 100,
    complaints: [
      'Found {name} outside in the rain. Cold to the touch.',
      'Fell into the pond. Shaking and stiff.',
      'Was locked out overnight. Will not stop shivering.',
    ],
  },
  poisoning: {
    name: 'Poisoning',
    temp: 'normal',
    heart: { rate: 'fast', rhythm: 'irregular' },
    scan: 'clear',
    exam: 'Pupils dilated. Heavy drooling. Faint chemical smell on the breath.',
    treatment: ['antidote'],
    surgery: false,
    visual: ['drool'],
    severity: 1.25,
    pay: 120,
    complaints: [
      'Got into the garage. Might have licked antifreeze.',
      'Ate something in the park. Drooling and wobbly.',
      'Chewed the leaves of a plant I did not know was toxic.',
    ],
  },
  heart: {
    name: 'Heart disease',
    temp: 'normal',
    heart: { rate: 'normal', rhythm: 'murmur' },
    scan: 'heart',
    exam: 'Gums slightly pale. Tires quickly. Soft, wet cough.',
    treatment: ['cardiac'],
    surgery: false,
    visual: ['cough'],
    severity: 0.85,
    pay: 130,
    complaints: [
      'Coughs at night and tires after a few steps.',
      '{name} fainted twice this week.',
      'Breathing fast even when resting.',
    ],
  },
  ear: {
    name: 'Ear infection',
    temp: 'slightHigh',
    heart: { rate: 'normal', rhythm: 'regular' },
    scan: 'clear',
    exam: 'One ear canal is red, swollen and smells sour. Head held tilted.',
    treatment: ['eardrops'],
    surgery: false,
    visual: ['tilt'],
    severity: 0.7,
    pay: 80,
    complaints: [
      'Keeps shaking {pr} head and scratching one ear.',
      'Head tilted to one side since yesterday. The ear smells bad.',
      'Crying when I touch {pr} ear.',
    ],
  },
  allergy: {
    name: 'Allergic reaction',
    temp: 'normal',
    heart: { rate: 'fast', rhythm: 'regular' },
    scan: 'clear',
    exam: 'Face puffy and swollen. Raised hives around the muzzle.',
    treatment: ['antihistamine'],
    surgery: false,
    visual: ['swelling'],
    severity: 1.0,
    pay: 90,
    complaints: [
      '{name}\'s face suddenly swelled up after being in the garden.',
      'Stung by something? Puffy and scratching all over.',
      'Ate a new treat and {pr} face blew up like a balloon.',
    ],
  },
  tumor: {
    name: 'Abdominal mass',
    temp: 'normal',
    heart: { rate: 'normal', rhythm: 'regular' },
    scan: 'mass',
    exam: 'A firm, round lump deep in the belly. Noticeable weight loss.',
    treatment: ['anesthetic', 'sutures'],
    surgery: true,
    visual: ['lethargic'],
    severity: 0.8,
    pay: 220,
    complaints: [
      'Found a hard lump on {pr} belly. Losing weight.',
      'Belly looks bigger but {name} is eating less and less.',
      'Something feels wrong in {pr} stomach. Off food for a week.',
    ],
  },
};

export const CONDITION_IDS = Object.keys(CONDITIONS);

export const TEST_INFO = {
  temp: { name: 'Thermometer', time: 3.5 },
  heart: { name: 'Stethoscope', time: 4.5 },
  scan: { name: 'Scanner', time: 7.0 },
  exam: { name: 'Physical exam', time: 3.0 },
};

// Anomaly signs. `method` says which inspection reveals it.
export const SIGNS = {
  extraEyes: { method: 'direct', label: 'Extra eyes', subtle: false },
  extraEyeSmall: { method: 'direct', label: 'A small extra eye', subtle: true },
  noEyes: { method: 'direct', label: 'No eyes', subtle: false },
  noMouth: { method: 'direct', label: 'No mouth or nose', subtle: false },
  teeth: { method: 'direct', label: 'Unnatural teeth (visible when it yawns)', subtle: true },
  bigHead: { method: 'direct', label: 'Distorted proportions', subtle: false },
  longNeck: { method: 'direct', label: 'Stretched neck', subtle: false },
  mismatchedEyes: { method: 'direct', label: 'Mismatched eyes', subtle: true },
  twitch: { method: 'direct', label: 'Exactly repeating twitch', subtle: true },
  still: { method: 'direct', label: 'Never blinks or breathes', subtle: true },
  photoEars: { method: 'photo', label: 'Different ears in the photograph', subtle: false },
  photoEyes: { method: 'photo', label: 'Altered eyes in the photograph', subtle: false },
  photoStatic: { method: 'photo', label: 'Face obscured by interference in the photograph', subtle: false },
  camLimbs: { method: 'cctv', label: 'Elongated limbs on the security feed', subtle: false },
  camSilhouette: { method: 'cctv', label: 'Dark silhouette on the security feed', subtle: false },
  camFollow: { method: 'cctv', label: 'Head turns to face every camera', subtle: true },
  doppel: { method: 'record', label: 'Identical to a patient already seen tonight', subtle: true },
};

export const SIGN_IDS_BY_METHOD = {
  direct: ['extraEyes', 'extraEyeSmall', 'noEyes', 'noMouth', 'teeth', 'bigHead', 'longNeck', 'mismatchedEyes', 'twitch', 'still'],
  photo: ['photoEars', 'photoEyes', 'photoStatic'],
  cctv: ['camLimbs', 'camSilhouette', 'camFollow'],
};

export const OBVIOUS_DIRECT = ['extraEyes', 'noEyes', 'noMouth', 'bigHead', 'longNeck'];
export const SUBTLE_DIRECT = ['extraEyeSmall', 'teeth', 'mismatchedEyes', 'twitch', 'still'];

// Impossible readings an impostor produces in the exam room.
export const IMPOSSIBLE = {
  temp: ['12.4 °C', '61.0 °C', 'No reading. The probe comes out frosted.', '0.0 °C and falling'],
  heart: [
    'No heartbeat. Only a slow scraping sound.',
    'Two separate heartbeats: 28 bpm and 310 bpm.',
    'The heartbeat matches yours exactly.',
    'Knocking, in groups of three.',
  ],
  scan: ['skull', 'ribs', 'empty', 'hand'],
  exam: [
    'The fur is warm, but the skin underneath is smooth and cold, like plastic.',
    'Its teeth go further back than its skull should allow.',
    'Its gums are black and dry. It does not flinch when touched.',
    'It purrs. The sound comes from somewhere behind you.',
  ],
};

export const UPGRADES = [
  {
    id: 'cctv1',
    name: 'Camera Clarity I',
    desc: 'Replaces the old camera boards: sharper feeds with much less static.',
    price: 170,
    group: 'Cameras',
  },
  {
    id: 'cctv2',
    name: 'Camera Clarity II',
    desc: 'Adds a close-up FACE camera above the intake platform.',
    price: 300,
    requires: 'cctv1',
    group: 'Cameras',
  },
  {
    id: 'diag1',
    name: 'Faster Diagnostics I',
    desc: 'Calibrated instruments. Every test completes 35% faster.',
    price: 150,
    group: 'Diagnostics',
  },
  {
    id: 'diag2',
    name: 'Faster Diagnostics II',
    desc: 'Digital suite. Tests complete 60% faster and the scanner marks its findings.',
    price: 280,
    requires: 'diag1',
    group: 'Diagnostics',
  },
  {
    id: 'generator',
    name: 'Backup Generator',
    desc: 'Emergency lighting stays on during power failures, and breakers trip less often.',
    price: 240,
    group: 'Protection',
  },
  {
    id: 'flashlight',
    name: 'Tactical Flashlight',
    desc: 'A brighter, wider beam. Drives things back twice as fast.',
    price: 110,
    group: 'Protection',
  },
  {
    id: 'espresso',
    name: 'Espresso Machine',
    desc: 'Coffee restores more composure and is ready again sooner.',
    price: 70,
    group: 'Comfort',
  },
  {
    id: 'pole',
    name: 'Catch Pole',
    desc: 'Restrains one creature that is loose inside the clinic. Used up on success.',
    price: 85,
    consumable: true,
    max: 3,
    group: 'Protection',
  },
  {
    id: 'flare',
    name: 'Emergency Flare',
    desc: 'One use: a blinding light that banishes every presence around you.',
    price: 100,
    consumable: true,
    max: 2,
    group: 'Protection',
  },
];

export const RULES = [
  {
    id: 'screen',
    shift: 1,
    title: 'Screen every visitor',
    text: 'Real animals look the same to your own eyes, in a photograph and on the security cameras. Things that are only pretending do not. Compare all three before you open the door. (Animal eyes glow on the infrared cameras. That is normal. Notice where they are looking.)',
  },
  {
    id: 'illness',
    shift: 1,
    title: 'Sick is not wrong',
    text: 'Limping, swelling, shivering, wounds and exhaustion are illness, and they look the same through every lens. Extra or missing parts, movements that repeat exactly, and differences between views are not illness.',
  },
  {
    id: 'instruments',
    shift: 1,
    title: 'The instruments do not lie',
    text: 'If an admitted patient gives impossible readings, it is not a patient. Choose "Report anomaly" in the exam to seal the room. Never treat it, and never leave it alone for long.',
  },
  {
    id: 'breaker',
    shift: 1,
    title: 'When the lights die',
    text: 'Go to the breaker panel in the utility room at the end of the corridor and reset every tripped switch. The cameras are offline while the reception circuit is down. Do not wait in the dark.',
  },
  {
    id: 'figure',
    shift: 2,
    title: 'The tall visitor',
    text: 'If someone tall is standing in the corridor, do not look straight at them. Glimpses are fine. Keep working; they leave when they are ignored.',
  },
  {
    id: 'loose',
    shift: 2,
    title: 'If one gets loose',
    text: 'It can only move while no one is watching it. Keep your eyes, and your light, on it. With a catch pole, hold the photo button on it up close to restrain it. Without one, a steady flashlight beam drives it away for a while.',
  },
  {
    id: 'feed',
    shift: 3,
    title: 'Something on the feed',
    text: 'If a figure on a camera feed is walking toward the lens, switch to another feed immediately. Never let it reach the camera.',
  },
  {
    id: 'bed',
    shift: 3,
    title: 'Under the bed',
    text: 'If you hear scratching beneath a patient\'s bed, crouch and shine your flashlight underneath until it lets go.',
  },
  {
    id: 'twice',
    shift: 5,
    title: 'No one comes twice',
    text: 'No animal returns on the same night. If a visitor looks exactly like a patient you have already seen tonight, it is not them.',
  },
];

// Shift configuration: arrivals, impostors and incident budget.
export const SHIFTS = [
  {
    visitors: 4,
    impostors: 1,
    realMinutes: 11,
    signCount: 2,
    signMethods: ['direct', 'direct'],
    benign: 0.25,
    recordOddity: 0.6,
    incidents: { power: 1, figure: 0, feed: 0, bed: 0 },
  },
  {
    visitors: 5,
    impostors: 1,
    realMinutes: 12,
    signCount: 2,
    signMethods: ['direct', 'photo'],
    benign: 0.45,
    recordOddity: 0.4,
    incidents: { power: 1, figure: 1, feed: 0, bed: 0 },
  },
  {
    visitors: 6,
    impostors: 2,
    realMinutes: 13,
    signCount: 2,
    signMethods: ['any', 'cctv'],
    benign: 0.6,
    recordOddity: 0.25,
    incidents: { power: 1, figure: 1, feed: 1, bed: 1 },
  },
  {
    visitors: 6,
    impostors: 2,
    realMinutes: 13,
    signCount: 1,
    signMethods: ['any'],
    subtle: true,
    benign: 0.75,
    recordOddity: 0.15,
    incidents: { power: 2, figure: 2, feed: 2, bed: 1 },
  },
  {
    visitors: 7,
    impostors: 3,
    realMinutes: 14,
    signCount: 1,
    signMethods: ['any'],
    subtle: true,
    benign: 0.85,
    recordOddity: 0.1,
    doppel: true,
    incidents: { power: 2, figure: 2, feed: 2, bed: 2 },
  },
];

export const PET_NAMES = [
  'Biscuit', 'Mochi', 'Pepper', 'Luna', 'Olive', 'Waffles', 'Pickles', 'Juniper', 'Bean', 'Clover',
  'Maple', 'Noodle', 'Pudding', 'Pumpkin', 'Ziggy', 'Hazel', 'Toffee', 'Sprout', 'Marbles', 'Button',
  'Dumpling', 'Basil', 'Nugget', 'Tofu', 'Kiwi', 'Mango', 'Pip', 'Sesame', 'Truffle', 'Fig',
  'Captain', 'Bramble', 'Pebble', 'Socks', 'Wren', 'Comet', 'Gizmo', 'Peaches', 'Rolo', 'Bambi',
];

export const OWNER_NAMES = [
  'Okafor', 'Lindqvist', 'Marsh', 'Delgado', 'Whitlock', 'Abernathy', 'Novak', 'Castellano', 'Pryce',
  'Hollis', 'Tanaka', 'Moreau', 'Fenwick', 'Barros', 'Kowalski', 'Ashdown', 'Reyes', 'Thorne', 'Quill', 'Haldane',
];

export const OWNER_FIRST = ['A.', 'B.', 'C.', 'D.', 'E.', 'J.', 'K.', 'L.', 'M.', 'N.', 'R.', 'S.', 'T.'];

// Wrong details that sometimes leak into an impostor's intake record.
export const RECORD_ODDITIES = [
  { field: 'owner', value: '—' },
  { field: 'phone', value: '000 000 0000' },
  { field: 'age', value: '0 years' },
  { field: 'complaint', value: 'Please open the door. Please open the door.' },
  { field: 'complaint', value: '{name} is sick. {name} is sick. {name} is sick.' },
  { field: 'owner', value: 'The Owner' },
  { field: 'age', value: '112 years' },
  { field: 'complaint', value: 'It is cold out here. Let me in and I will be good.' },
];

export const DOCTOR = {
  name: 'Dr. Mara Adair',
  title: 'Supervising Veterinarian',
};

// Briefings before each shift. Lines may contain {placeholders} filled in by
// the briefing screen with performance-dependent remarks.
export const BRIEFINGS = [
  [
    'You must be the new night attendant. I\'m Dr. Adair. I run this clinic, though you won\'t see me after dark. Nobody does.',
    'The job is simple. Animals arrive at the intake window. You check them, let in the ones that are what they appear to be, and care for them until morning.',
    'Look at them yourself. Take a photograph with the instant camera and compare it. Check the security monitor. If all three agree, release the door.',
    'If something doesn\'t add up, like an extra eye or a face the camera can\'t see, pull the shutter. Don\'t apologise, and don\'t open it again.',
    'Sick animals can look strange. A limp, a swollen face, shivering. That\'s illness, not a threat. Learn the difference; turning away a real patient costs us dearly.',
    'Once they\'re inside: walk them to a free room, examine them, diagnose, fetch what you need from the pharmacy and treat them. They get worse the longer they wait.',
    'The wiring is old. If the lights go out, the breaker panel is in the utility room at the far end of the corridor.',
    'I\'ve written the rules on the corkboard in the staff office, and on your pager. Read them. They\'re not superstition.',
  ],
  [
    '{review}',
    'Last week\'s attendant mentioned someone standing at the end of the corridor. Tall. Too tall. If you see them, don\'t look at them. Just keep working.',
    'And if one of them ever gets past you, and it happens, remember this: they only move when no one is watching. There\'s a catch pole in the staff office locker.',
    'Tonight\'s visitors will be harder to read. Photograph everyone.',
  ],
  [
    '{review}',
    'The cameras have been acting up. Sometimes a feed shows someone walking toward the lens. Switch away. Don\'t wait to see their face.',
    'And if you hear scratching under one of the beds, get down and shine a light under it. It hates being seen.',
    'Some of them only show what they are on the security feed now. Check every angle.',
  ],
  [
    '{review}',
    'They\'re learning. Tonight they\'ll hide their signs better: one look won\'t be enough. Use every view, every time.',
    'More of our real patients will look rough tonight, too. Flu season. Don\'t let a limp or a cough scare you into the shutter.',
    'The breakers will trip more often. I\'ve asked for a new panel for years.',
  ],
  [
    '{review}',
    'Last night of your trial. I\'ll be honest with you: this is the worst night of the month.',
    'They\'ll try to come back wearing the faces of patients you\'ve already helped tonight. No animal comes twice in one night. Remember that.',
    'When the sun comes up I\'ll be here. Make sure you are too.',
  ],
];

export const REVIEWS = {
  great: [
    'Clean work last night. The owners are already talking about you.',
    'I read your log. Careful, kind, and nothing got inside. That\'s rare.',
  ],
  good: [
    'Not bad for a night shift. A few rough edges, but everyone who should have gone home did.',
    'You held it together. That\'s most of this job.',
  ],
  wrongReject: [
    'You turned away a real patient last night. Their owner called me in tears. Look harder before you pull that shutter.',
  ],
  creature: [
    'Something got in last night. I could smell it in the corridor this morning. Be more careful at the window.',
  ],
  deaths: [
    'We lost a patient last night. It happens, but it shouldn\'t happen from waiting. Keep an eye on the board.',
  ],
};

export const SUPPLY_OFFERS = [
  { label: 'Antibiotic crate', items: { antibiotics: 3, painkillers: 1 } },
  { label: 'Wound care pack', items: { bandage: 3, sutures: 2 } },
  { label: 'Fracture kit', items: { splint: 2, painkillers: 2 } },
  { label: 'Fluids & warming', items: { fluids: 3, heatpack: 2 } },
  { label: 'Toxicology box', items: { antidote: 2, antihistamine: 2 } },
  { label: 'Cardiology box', items: { cardiac: 2, eardrops: 2 } },
  { label: 'Surgical tray', items: { anesthetic: 2, sutures: 2 } },
  { label: 'A spare catch pole', upgrade: 'pole' },
  { label: 'An emergency flare', upgrade: 'flare' },
];

export const HINTS = {
  start: 'Head to the reception desk and wait for the first visitor. Tip: check your pager with [pager].',
  arrival: 'A visitor is at the intake window. Look at it closely: hold [focus] to zoom.',
  photo: 'Raise the instant camera with [camera], snap with [primary], then compare with [photos].',
  monitor: 'Use the security monitor on the desk ([interact]) to check the vestibule cameras.',
  decide: 'Green button releases the door (admit). The red lever drops the shutter (turn away).',
  escort: 'Admitted patients wait in the waiting area. Use [interact] on them to escort them to a free room.',
  place: 'Use [interact] on an empty treatment bed to settle your patient.',
  exam: 'Use [interact] on the occupied bed to examine. Run tests, then diagnose.',
  pharmacy: 'Collect the supplies the protocol lists from the pharmacy cabinet, then treat.',
  power: 'The power failed. The breaker panel is in the utility room at the end of the corridor.',
};

// Dialogue spoken by the supervisor at the end of the game.
export const ENDINGS = {
  best: {
    title: 'Head of Night Care',
    text: 'Dr. Adair is waiting in the parking lot at dawn, coffee in hand. "Five nights. Not one of them got past you, and the owners can\'t stop talking about the kind attendant on the night ward." She hands you a key with a paw-print tag. "The job is yours, if you want it. Most people don\'t want it."',
  },
  good: {
    title: 'Survived the Ward',
    text: 'The sun comes up over the clinic. Dr. Adair reads your log in silence, then nods once. "You made mistakes. Everyone does. But you kept them alive, and you kept the door shut when it mattered. Come back tonight."',
  },
  infested: {
    title: 'Something Followed You Home',
    text: 'Dr. Adair meets you at the door and doesn\'t let you back in. "Too many of them got inside this week. The building isn\'t ours anymore." On the drive home, something in your back seat breathes in time with you.',
  },
  fired: {
    title: 'Let Go',
    text: 'There is an envelope taped to the intake window. Dr. Adair\'s handwriting: "The owners stopped bringing their animals to us. I\'m sorry. Leave your pager on the desk." Through the glass, the waiting room is already full.',
  },
};
