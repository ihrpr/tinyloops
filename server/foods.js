/**
 * The solids food catalog and the chip list for the quick-log picker.
 *
 * Presets cover the common first-weaning foods in a rough introduction
 * order (veg → fruit → grains → protein → dairy → common allergens). The
 * picker is chips-first, typing-last: foods the baby has already tried come
 * first (most recently eaten first), then untried presets. Selected chips
 * are stored as the same comma-separated text in the notes column that a
 * typed entry produces — the sheet format doesn't know chips exist.
 */

export const PRESET_FOODS = [
  ['carrot', '🥕'], ['sweet potato', '🍠'], ['broccoli', '🥦'],
  ['avocado', '🥑'], ['pumpkin', '🎃'], ['courgette', '🥒'],
  ['peas', '🫛'], ['cauliflower', '🥬'], ['potato', '🥔'],
  ['spinach', '🥬'], ['tomato', '🍅'], ['sweetcorn', '🌽'],
  ['banana', '🍌'], ['apple', '🍎'], ['pear', '🍐'],
  ['mango', '🥭'], ['peach', '🍑'], ['strawberry', '🍓'],
  ['blueberry', '🫐'], ['melon', '🍈'], ['orange', '🍊'],
  ['kiwi', '🥝'], ['plum', '🍑'],
  ['baby rice', '🍚'], ['porridge', '🥣'], ['toast', '🍞'],
  ['pasta', '🍝'], ['rice', '🍚'], ['oats', '🌾'],
  ['egg', '🥚'], ['chicken', '🍗'], ['beef', '🥩'],
  ['salmon', '🐟'], ['white fish', '🐟'], ['lentils', '🫘'],
  ['beans', '🫘'], ['tofu', '🧊'], ['hummus', '🧆'],
  ['yoghurt', '🥛'], ['cheese', '🧀'],
  ['peanut butter', '🥜'], ['almond butter', '🥜'], ['tahini', '🧆'],
];

const EMOJI = new Map(PRESET_FOODS.map(([name, emoji]) => [name, emoji]));
const FALLBACK_EMOJI = '🍽️';

/** Food tokens of a solid event: the notes field, comma-separated. */
export const foodTokens = (e) => String(e.notes || '').split(',')
  .map((s) => s.trim()).filter(Boolean);

/**
 * Chip list for the picker: the baby's own foods first (most recently
 * eaten first — the next meal is usually a repeat), then untried presets.
 * Custom foods keep the name the parent typed, with a generic emoji.
 */
export function foodChips(events) {
  const chips = [];
  const seen = new Set();
  const push = (name, tried) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    chips.push({ name, emoji: EMOJI.get(key) || FALLBACK_EMOJI, tried });
  };
  for (const e of events) { // newest first
    if (e.type !== 'solid') continue;
    for (const t of foodTokens(e)) push(t.slice(0, 40), true);
    if (chips.length >= 16) break; // enough recents; presets cover the rest
  }
  for (const [name] of PRESET_FOODS) push(name, false);
  return chips;
}
