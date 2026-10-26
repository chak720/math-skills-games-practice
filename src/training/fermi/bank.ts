/**
 * Fermi questions.
 *
 * Bank questions have a reference value from widely published figures, with a
 * note on where the figure comes from and how uncertain it is. Scoring is in
 * log space, so a reference that is itself ±20% barely moves a score.
 *
 * Parameterised questions compute their answer exactly from stated reference
 * constants, so every variant has a reproducible truth.
 */
import type { Rng } from '@/shared/random/prng';

export interface Factor {
  label: string;
  value: number;
  /** How this factor combines with the running product. */
  op: '×' | '÷';
}

export interface FermiQuestion {
  id: string;
  prompt: string;
  unit: string;
  truth: number;
  /** Where the reference value comes from. */
  source: string;
  /** A reasonable breakdown an interviewer would accept. */
  breakdown: Factor[];
  topic: Topic;
}

export type Topic = 'people' | 'business' | 'physical' | 'nature' | 'tech' | 'computed';

export const TOPIC_LABEL: Record<Topic, string> = { people: 'People & society', business: 'Business', physical: 'Physical world', nature: 'Nature & space', tech: 'Technology', computed: 'Computed' };

const B = (label: string, value: number, op: '×' | '÷' = '×'): Factor => ({ label, value, op });

/** Reference figures; rounded, approximately current, and labelled with their uncertainty. */
export const BANK: FermiQuestion[] = [
  { id: 'us-births', topic: 'people', prompt: 'How many babies are born in the United States each year?', unit: 'births', truth: 3.6e6, source: 'CDC birth data, early 2020s: about 3.6 million a year.', breakdown: [B('US population', 335e6), B('Birth rate (per person per year)', 0.011)] },
  { id: 'world-births', topic: 'people', prompt: 'How many babies are born worldwide each year?', unit: 'births', truth: 1.3e8, source: 'UN World Population Prospects: roughly 130–135 million a year.', breakdown: [B('World population', 8e9), B('Births per person per year', 0.017)] },
  { id: 'uk-births', topic: 'people', prompt: 'How many babies are born in the United Kingdom each year?', unit: 'births', truth: 6.8e5, source: 'ONS/NRS/NISRA, early 2020s: about 670–700 thousand.', breakdown: [B('UK population', 68e6), B('Births per person per year', 0.01)] },
  { id: 'heart-beats', topic: 'people', prompt: 'How many times does a human heart beat in an 80-year life?', unit: 'beats', truth: 3e9, source: '70 beats/min × 60 × 24 × 365 × 80 ≈ 2.9 billion.', breakdown: [B('Beats per minute', 70), B('Minutes per year', 525600), B('Years', 80)] },
  { id: 'hairs', topic: 'people', prompt: 'How many hairs are on a typical human head?', unit: 'hairs', truth: 1e5, source: 'Dermatology texts: about 100,000 (blondes more, redheads fewer).', breakdown: [B('Scalp area (cm²)', 600), B('Hairs per cm²', 170)] },
  { id: 'words-day', topic: 'people', prompt: 'How many words does an average adult speak in a day?', unit: 'words', truth: 1.6e4, source: 'Mehl et al. (2007, Science): about 16,000 a day for both sexes, with huge spread.', breakdown: [B('Hours of conversation a day', 3.5), B('Fraction of that time you are talking', 0.5), B('Words per minute', 150), B('Minutes per hour', 60)] },
  { id: 'dentists-us', topic: 'people', prompt: 'How many dentists work in the United States?', unit: 'dentists', truth: 2e5, source: 'American Dental Association: just over 200,000.', breakdown: [B('US population', 335e6), B('Dental visits per person per year', 1.5), B('Visits a dentist handles a year', 2500, '÷')] },
  { id: 'uk-doctors', topic: 'people', prompt: 'How many doctors are licensed to practise in the UK?', unit: 'doctors', truth: 3.2e5, source: 'GMC register, 2023: about 300–340 thousand licensed doctors.', breakdown: [B('UK population', 68e6), B('Doctors per 1,000 people', 4.5), B('Per 1,000', 1000, '÷')] },
  { id: 'nyc-cabs', topic: 'business', prompt: 'How many yellow taxi medallions are there in New York City?', unit: 'medallions', truth: 13587, source: 'NYC Taxi & Limousine Commission: the medallion count is capped at 13,587.', breakdown: [B('Taxi trips a day in Manhattan', 3e5), B('Trips per cab per day (two shifts)', 25, '÷')] },
  { id: 'mcdonalds', topic: 'business', prompt: "How many McDonald's restaurants are there worldwide?", unit: 'restaurants', truth: 4.1e4, source: "McDonald's annual report, 2023: about 41,800.", breakdown: [B('US restaurants', 13500), B('Multiplier for the rest of the world', 3)] },
  { id: 'starbucks', topic: 'business', prompt: 'How many Starbucks stores are there worldwide?', unit: 'stores', truth: 3.8e4, source: 'Starbucks fiscal 2023: about 38,000.', breakdown: [B('US stores', 16000), B('Multiplier for the rest of the world', 2.4)] },
  { id: 'flights-day', topic: 'business', prompt: 'How many commercial passenger flights take off worldwide on an average day?', unit: 'flights', truth: 1e5, source: 'IATA/flight trackers: roughly 100,000 commercial flights a day.', breakdown: [B('Airliners in service', 25000), B('Flights per aircraft per day', 4)] },
  { id: 'airliners', topic: 'business', prompt: 'How many commercial airliners are in service worldwide?', unit: 'aircraft', truth: 2.7e4, source: 'Fleet surveys (Cirium/Oliver Wyman), 2023–24: about 26,000–29,000.', breakdown: [B('Passengers a year', 4.5e9), B('Average seats per flight × load factor', 150, '÷'), B('Flights per aircraft per year', 1200, '÷')] },
  { id: 'air-passengers', topic: 'business', prompt: 'How many airline passenger journeys are flown worldwide in a year?', unit: 'passengers', truth: 4.5e9, source: 'IATA: about 4.5 billion passengers in 2019 and again in 2024.', breakdown: [B('Flights per day', 1e5), B('Passengers per flight', 125), B('Days', 365)] },
  { id: 'us-gasoline', topic: 'business', prompt: 'How many gallons of gasoline does the United States use per day?', unit: 'gallons', truth: 3.7e8, source: 'US EIA: about 8.9 million barrels (370 million gallons) a day.', breakdown: [B('Cars on the road', 280e6), B('Miles per car per day', 35), B('Miles per gallon', 26, '÷')] },
  { id: 'oil-day', topic: 'business', prompt: 'How many barrels of oil does the world consume per day?', unit: 'barrels', truth: 1e8, source: 'IEA: about 100–103 million barrels a day.', breakdown: [B('World population', 8e9), B('Litres per person per day', 2), B('Litres per barrel', 159, '÷')] },
  { id: 'us-gdp', topic: 'business', prompt: 'What is the annual GDP of the United States, in US dollars?', unit: 'USD', truth: 2.7e13, source: 'BEA, 2023: about $27 trillion.', breakdown: [B('Population', 335e6), B('GDP per person', 80000)] },
  { id: 'world-gdp', topic: 'business', prompt: 'What is the annual GDP of the whole world, in US dollars?', unit: 'USD', truth: 1.05e14, source: 'IMF/World Bank, 2023: about $105 trillion at market exchange rates.', breakdown: [B('World population', 8e9), B('Average GDP per person', 13000)] },
  { id: 'wimbledon-balls', topic: 'business', prompt: 'How many tennis balls are used during the Wimbledon Championships?', unit: 'balls', truth: 5.5e4, source: 'The All England Club cites about 55,000 balls per Championships.', breakdown: [B('Matches (all events, qualifying included)', 650), B('Match balls per match (≈4 changes of 6)', 24), B('Multiplier for practice and warm-up balls', 3.5)] },
  { id: 'emails-day', topic: 'tech', prompt: 'How many emails are sent worldwide per day?', unit: 'emails', truth: 3.5e11, source: 'Radicati Group, 2023: about 350 billion a day (spam included).', breakdown: [B('Email users', 4.3e9), B('Emails sent per user per day', 80)] },
  { id: 'searches-day', topic: 'tech', prompt: 'How many Google searches happen per day?', unit: 'searches', truth: 8.5e9, source: 'Commonly cited estimates: about 8.5 billion a day (Google does not publish exact figures).', breakdown: [B('Internet users', 5.3e9), B('Share who use Google daily', 0.5), B('Searches per daily user', 3.2)] },
  { id: 'people-in-air', topic: 'business', prompt: 'At a typical moment, how many people are in the air on commercial flights?', unit: 'people', truth: 1e6, source: 'Derived from ~4.5 billion passengers a year and an average flight time of about 2 hours: around 1 million.', breakdown: [B('Passengers a year', 4.5e9), B('Hours in the air per passenger', 2), B('Hours in a year', 8760, '÷')] },
  { id: 'trees', topic: 'nature', prompt: 'How many trees are there on Earth?', unit: 'trees', truth: 3e12, source: 'Crowther et al. (2015, Nature): about 3 trillion.', breakdown: [B('Land area (km²)', 1.5e8), B('Fraction forested', 0.3), B('Trees per km² of forest', 6e4)] },
  { id: 'ants', topic: 'nature', prompt: 'How many ants are alive on Earth?', unit: 'ants', truth: 2e16, source: 'Schultheiss et al. (2022, PNAS): about 20 quadrillion.', breakdown: [B('Land area (m²)', 1.5e14), B('Ants per m² (averaged over all land)', 130)] },
  { id: 'stars-mw', topic: 'nature', prompt: 'How many stars are in the Milky Way?', unit: 'stars', truth: 2e11, source: 'Astronomical estimates range from about 100 to 400 billion.', breakdown: [B('Mass of the galaxy in stars (solar masses)', 6e10), B('Average star mass (solar masses)', 0.3, '÷')] },
  { id: 'cells', topic: 'nature', prompt: 'How many human cells are in an adult body?', unit: 'cells', truth: 3e13, source: 'Sender, Fuchs & Milo (2016): about 30 trillion; most are red blood cells.', breakdown: [B('Blood volume (litres)', 5), B('Red cells per litre', 5e12), B('Factor for all other cells', 1.2)] },
  { id: 'atmosphere-mass', topic: 'physical', prompt: 'What is the mass of Earth’s atmosphere, in kilograms?', unit: 'kg', truth: 5.1e18, source: 'Surface pressure × Earth’s area / g ≈ 101,000 Pa × 5.1×10¹⁴ m² / 9.8 ≈ 5.3×10¹⁸ kg; accepted 5.1×10¹⁸.', breakdown: [B('Surface pressure (Pa = N/m²)', 1.01e5), B('Earth surface area (m²)', 5.1e14), B('g (m/s²)', 9.8, '÷')] },
  { id: 'earth-moon', topic: 'physical', prompt: 'How far is the Moon from the Earth, in kilometres?', unit: 'km', truth: 3.844e5, source: 'Mean distance 384,400 km.', breakdown: [B('Earth diameters between them', 30), B('Earth diameter (km)', 12742)] },
  { id: 'circumference', topic: 'physical', prompt: 'What is the circumference of the Earth at the equator, in kilometres?', unit: 'km', truth: 40075, source: 'WGS84: 40,075 km.', breakdown: [B('Time zones', 24), B('Width of a time zone at the equator (km)', 1670)] },
  { id: 'us-roads', topic: 'physical', prompt: 'What is the total length of public roads in the United States, in kilometres?', unit: 'km', truth: 6.6e6, source: 'FHWA: about 4.1 million miles (6.6 million km).', breakdown: [B('Land area (km²)', 9.1e6), B('Road density (km of road per km²)', 0.7)] },
  { id: 'olympic-pool', topic: 'physical', prompt: 'How many litres of water does an Olympic swimming pool hold?', unit: 'litres', truth: 2.5e6, source: '50 m × 25 m × 2 m minimum depth = 2,500 m³ = 2.5 million litres.', breakdown: [B('Length (m)', 50), B('Width (m)', 25), B('Depth (m)', 2), B('Litres per m³', 1000)] },
  { id: 'hp-words', topic: 'people', prompt: 'How many words are in the seven Harry Potter books combined?', unit: 'words', truth: 1.08e6, source: 'Word counts by book sum to about 1,084,000.', breakdown: [B('Books', 7), B('Pages per book', 500), B('Words per page', 300)] },
  { id: 'london-cabs', topic: 'business', prompt: 'How many licensed black cabs are there in London?', unit: 'cabs', truth: 1.5e4, source: 'Transport for London licensing statistics, 2023: about 14,700.', breakdown: [B('Cab trips a day', 3e5), B('Trips per cab per day', 20, '÷')] },
  { id: 'year-seconds', topic: 'physical', prompt: 'How many seconds are there in a year?', unit: 's', truth: 31536000, source: '365 × 24 × 3600 = 31,536,000 (≈ π × 10⁷).', breakdown: [B('Days', 365), B('Hours per day', 24), B('Seconds per hour', 3600)] },
];

// ------------------------------------------------------------------ parameterised

interface Template {
  id: string;
  make(r: Rng): FermiQuestion;
}

const fmt = (x: number): string => (Number.isInteger(x) ? x.toLocaleString('en-GB') : String(x));

const TEMPLATES: Template[] = [
  {
    id: 'balls-room',
    make(r) {
      const ball = r.pick([
        { name: 'golf balls', d: 4.27 },
        { name: 'table-tennis balls', d: 4.0 },
        { name: 'tennis balls', d: 6.7 },
        { name: 'marbles', d: 1.6 },
      ]);
      const L = r.pick([3, 4, 5, 6]), W = r.pick([3, 3.5, 4]), H = r.pick([2.4, 2.5, 2.7]);
      const vBall = (Math.PI / 6) * (ball.d / 100) ** 3;
      const truth = (0.64 * L * W * H) / vBall;
      return {
        id: `balls-room:${ball.name}:${L}:${W}:${H}`,
        topic: 'computed',
        prompt: `How many ${ball.name} (${ball.d} cm across) would fill an empty room ${L} m × ${W} m × ${H} m? Assume random packing.`,
        unit: 'balls',
        truth,
        source: `Room volume × random-packing fraction 0.64 ÷ volume of one ball (π/6 × ${ball.d}³ cm³).`,
        breakdown: [B('Room volume (m³)', L * W * H), B('Packing fraction', 0.64), B('Ball volume (m³)', vBall, '÷')],
      };
    },
  },
  {
    id: 'water-molecules',
    make(r) {
      const ml = r.pick([30, 250, 330, 500, 1000, 2000]);
      return {
        id: `water-molecules:${ml}`,
        topic: 'computed',
        prompt: `How many water molecules are in ${fmt(ml)} ml of water?`,
        unit: 'molecules',
        truth: (ml / 18.015) * 6.022e23,
        source: `${ml} g of water ÷ 18 g/mol × 6.02×10²³ per mole.`,
        breakdown: [B('Grams of water', ml), B('Grams per mole', 18, '÷'), B('Molecules per mole', 6.022e23)],
      };
    },
  },
  {
    id: 'wheel-turns',
    make(r) {
      const km = r.pick([10, 50, 120, 400, 650]), d = r.pick([0.62, 0.65, 0.7]);
      return {
        id: `wheel-turns:${km}:${d}`,
        topic: 'computed',
        prompt: `A car's wheels are ${d * 100} cm in diameter. How many times does each wheel turn on a ${km} km drive?`,
        unit: 'turns',
        truth: (km * 1000) / (Math.PI * d),
        source: 'Distance ÷ circumference (π × diameter).',
        breakdown: [B('Distance (m)', km * 1000), B('Circumference (m)', Math.PI * d, '÷')],
      };
    },
  },
  {
    id: 'paper-stack',
    make(r) {
      const target = r.pick([
        { name: 'the height of a standard door (2 m)', m: 2 },
        { name: 'the Eiffel Tower (330 m)', m: 330 },
        { name: 'Mount Everest (8,849 m)', m: 8849 },
        { name: 'the cruising altitude of an airliner (11 km)', m: 11000 },
      ]);
      return {
        id: `paper-stack:${target.m}`,
        topic: 'computed',
        prompt: `How many sheets of ordinary printer paper (0.1 mm thick) would you stack to reach ${target.name}?`,
        unit: 'sheets',
        truth: target.m / 1e-4,
        source: 'Height ÷ 0.1 mm per sheet (a 500-sheet ream is about 5 cm).',
        breakdown: [B('Height (m)', target.m), B('Sheet thickness (m)', 1e-4, '÷')],
      };
    },
  },
  {
    id: 'video-data',
    make(r) {
      const q = r.pick([
        { name: 'HD (1080p) at 5 Mbit/s', mbps: 5 },
        { name: '4K at 16 Mbit/s', mbps: 16 },
        { name: 'standard definition at 1.5 Mbit/s', mbps: 1.5 },
      ]);
      const hours = r.pick([1, 2, 10, 24, 100]);
      return {
        id: `video-data:${q.mbps}:${hours}`,
        topic: 'computed',
        prompt: `How many gigabytes does it take to stream ${hours} hour${hours > 1 ? 's' : ''} of video in ${q.name}?`,
        unit: 'GB',
        truth: (q.mbps * 3600 * hours) / 8 / 1000,
        source: 'Bit rate × seconds ÷ 8 bits per byte ÷ 1,000 MB per GB.',
        breakdown: [B('Megabits per second', q.mbps), B('Seconds', 3600 * hours), B('Bits per byte', 8, '÷'), B('MB per GB', 1000, '÷')],
      };
    },
  },
  {
    id: 'light-travel',
    make(r) {
      const t = r.pick([
        { name: 'one nanosecond', s: 1e-9, unit: 'cm', scale: 100 },
        { name: 'one millisecond', s: 1e-3, unit: 'km', scale: 1e-3 },
        { name: 'the 2.6-hour flight from London to Rome', s: 2.6 * 3600, unit: 'km', scale: 1e-3 },
        { name: 'one day', s: 86400, unit: 'km', scale: 1e-3 },
      ]);
      return {
        id: `light-travel:${t.s}`,
        topic: 'computed',
        prompt: `How far does light travel in a vacuum during ${t.name}, in ${t.unit}?`,
        unit: t.unit,
        truth: 299792458 * t.s * t.scale,
        source: 'c = 299,792,458 m/s.',
        breakdown: [B('Speed of light (m/s)', 2.998e8), B('Seconds', t.s), B(`${t.unit} per metre`, t.scale)],
      };
    },
  },
  {
    id: 'count-to',
    make(r) {
      const n = r.pick([1e5, 1e6, 1e7, 1e9]);
      return {
        id: `count-to:${n}`,
        topic: 'computed',
        prompt: `Counting aloud nonstop at one number per second, how many days would it take to count to ${fmt(n)}?`,
        unit: 'days',
        truth: n / 86400,
        source: 'Numbers ÷ 86,400 seconds per day (ignoring that big numbers take longer to say).',
        breakdown: [B('Numbers', n), B('Seconds per day', 86400, '÷')],
      };
    },
  },
  {
    id: 'pool-fill',
    make(r) {
      const L = r.pick([8, 10, 12, 25]), W = r.pick([4, 5, 6, 10]), D = r.pick([1.2, 1.5, 1.8]), lpm = r.pick([15, 20, 30]);
      return {
        id: `pool-fill:${L}:${W}:${D}:${lpm}`,
        topic: 'computed',
        prompt: `How many hours does it take to fill a ${L} m × ${W} m pool to an average depth of ${D} m with a garden hose delivering ${lpm} litres per minute?`,
        unit: 'hours',
        truth: (L * W * D * 1000) / lpm / 60,
        source: 'Volume in litres ÷ flow per minute ÷ 60.',
        breakdown: [B('Volume (m³)', L * W * D), B('Litres per m³', 1000), B('Litres per minute', lpm, '÷'), B('Minutes per hour', 60, '÷')],
      };
    },
  },
];

export const TEMPLATE_COUNT = TEMPLATES.length;

/** Next question: an unseen bank question if one is left in this rotation, alternating with fresh variants. */
export function nextQuestion(r: Rng, seen: Set<string>, preferBank: boolean): FermiQuestion {
  const unseenBank = BANK.filter((q) => !seen.has(q.id));
  if (preferBank && unseenBank.length) return r.pick(unseenBank);
  for (let i = 0; i < 100; i++) {
    const q = r.pick(TEMPLATES).make(r);
    if (!seen.has(q.id)) return q;
  }
  // Every variant seen (unlikely): fall back to the least recently seen bank question.
  return unseenBank.length ? r.pick(unseenBank) : r.pick(BANK);
}

export function breakdownValue(fs: Factor[]): number {
  return fs.reduce((acc, f) => (f.op === '×' ? acc * f.value : acc / f.value), 1);
}
