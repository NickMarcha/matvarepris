// Heuristic Norwegian ingredient-list parser. Extracts dietary signals
// (currently: meat, gelatin, honey — anything already covered by the legal
// allergen categories, e.g. fish/shellfish/dairy/egg, is intentionally NOT
// duplicated here) so products can be filtered by diet without relying on
// category names, which are too coarse (a "Middag" category can contain
// both a beef and a vegetable version of the same dish).
//
// This is deliberately a best-effort classifier, not an authoritative one —
// see README for the accuracy caveat. The dictionaries below are meant to
// grow over time: reclassifyDiet.ts reports the most frequent tokens that
// matched nothing, which is the actual worklist for expanding them.

export type DietFlag = "kjott" | "gelatin" | "honning";

export interface DietClassification {
  flags: DietFlag[];
  unmatchedTokens: string[];
  parseStatus: "ok" | "no_ingredients";
}

// Substring-matched against each normalized token. Deliberately broad stems
// ("kjøtt", "svin", "kylling") so compounds match for free (kjøttdeig,
// svinekjøtt, kyllingfilet, kyllingkraft, storfekjøtt, ...) — the tradeoff is
// handled by the negation guard below (kjøttfri, plantebasert, ...).
const MEAT_TERMS = [
  "kjøtt",
  "svin",
  "gris",
  "bacon",
  "skinke",
  "pølse",
  "servelat",
  "salami",
  "chorizo",
  "pepperoni",
  "kalkun",
  "kylling",
  "kalv",
  // NOTE: bare "and" (duck) was removed — a 3-letter substring is too risky
  // in Norwegian (matches inside "behandling", "landbruk", "kandidat", ...).
  // Caught via a real false positive: "melbehandlingsmiddel" (processing
  // agent) on a bread product got flagged as meat. Use specific compounds
  // instead if duck coverage is ever needed (andebryst, andefett, andelår).
  "biff",
  "entrecôte",
  "entrecote",
  "mørbrad",
  "indrefilet",
  "ytrefilet",
  "roastbeef",
  // Bare "lam" (lamb) removed — by far the worst offender found while
  // spot-checking: collides with "kobalamin"/"cyanokobalamin" (vitamin B12,
  // extremely common additive), "olamine" (cosmetic surfactant suffix),
  // "cyklamat"/"natriumcyklamat" (a common sweetener), and even the
  // "Kalamata" olive variety name. Specific compounds instead.
  "lammekjøtt",
  "lammefilet",
  "lammekotelett",
  "lammedeig",
  "lammelår",
  "lammestek",
  "lammeknoke",
  "lammefarse",
  "elg",
  "reinsdyr",
  // Bare "hjort" (deer) removed too — collides with "hjortronsalt"
  // (cloudberry-named leavening agent) and "hjortetakksalt" (baker's
  // ammonia, also deer-named for historical reasons but synthetic).
  "hjortekjøtt",
  "hjortefilet",
  "hjortestek",
  "vilt",
  // "okse" (ox/beef) removed — collides with "boks"/"bokser" (box/can), an
  // extremely common Norwegian packaging word (found via spot-check: canned
  // sodas were coming back flagged as meat). Specific compounds instead —
  // "storfe" below already covers most real beef products anyway.
  "oksekjøtt",
  "oksefilet",
  "oksehale",
  "oksebog",
  "oksestek",
  "storfe",
  "leverpostei",
  "lever",
  "talg",
  // "ister" (lard) removed too — same short-substring risk (collides with
  // "register" and similar). "smult" below is the more common modern term
  // anyway and doesn't have this problem.
  "smult",
  "kebab",
  "döner",
  "doner",
  "prosciutto",
  "bresaola",
  "spekemat",
];

const GELATIN_TERMS = ["gelatin"];
const HONEY_TERMS = ["honning"];

const DIET_TERM_GROUPS: { flag: DietFlag; terms: string[] }[] = [
  { flag: "kjott", terms: MEAT_TERMS },
  { flag: "gelatin", terms: GELATIN_TERMS },
  { flag: "honning", terms: HONEY_TERMS },
];

// If any of these appear anywhere in a token, we do NOT flag that token as
// animal-derived even if it also contains a matched stem — covers the
// classic false-positive traps ("vegetarisk løpe" containing "løpe" isn't
// what we're after; "kjøttfri" containing "kjøtt" means the opposite of what
// a substring match would suggest).
const NEGATION_MARKERS = [
  "vegetarisk",
  "vegansk",
  "vegetabilsk",
  "plantebasert",
  "uten ",
  // Specific known false-positive collisions, found via spot-checking real
  // products — substring-checked (not exact-match like SAFE_IGNORE) because
  // these can appear merged into a longer sentence-like token when the
  // source text has no comma to split on (e.g. an entire juice ingredient
  // line with no commas at all).
  "risvin", // rice wine contains "svin" (pork) — salmon sushi false positive
  "fruktkjøtt", // "fruit flesh/pulp" — genuine Norwegian polysemy for
  // "kjøtt" (meat vs. botanical flesh) — juice false positive
  // Narrowly scoped to the specific compound, not bare "ristet"/"ristede"
  // (roasted) — that's too broad and would wrongly suppress a genuine
  // "ristet bacon" match. "honningristet(e)" (honey-roasted, common on
  // roasted nuts) contains "gris" (pig) exactly at the honning+ristede
  // compound boundary — nut mix false positive.
  "honningristet",
  "honningristede",
];

// Norwegian "-fri"/"-frie" ("-free") fuses directly onto the preceding word
// with no space ("kjøttfri", "svinefri", "glutenfri") so a plain \bfri\b
// word-boundary check misses it — the boundary we actually want is "fri(e)
// as a suffix", i.e. followed by whitespace or end-of-string, regardless of
// what precedes it. Deliberately not anchored on the left so "kjøttfri" (no
// trailing word) and "kjøttfri farse" (trailing word) both match, while
// unrelated words like "frityr"/"frisk" don't (nothing after "fri" is a
// space or end-of-string there).
function tokenEndsWithFri(token: string): boolean {
  return /fri(e)?(\s|$)/.test(token);
}

// Common, definitely-non-animal ingredient words. Not required for
// correctness (only meat/gelatin/honey terms matter for classification) —
// purely to keep the unmatched-token diagnostic report focused on genuinely
// uncategorized words instead of "vann", "salt", "sukker" noise.
const SAFE_IGNORE = new Set([
  "vann",
  "salt",
  "sukker",
  "druesukker",
  "glukosesirup",
  "fruktose",
  "mel",
  "hvetemel",
  "rugmel",
  "havremel",
  "maismel",
  "maisstivelse",
  "potetstivelse",
  "potetmel",
  "stivelse",
  "olje",
  "rapsolje",
  "solsikkeolje",
  "palmeolje",
  "olivenolje",
  "syre",
  "sitronsyre",
  "eddiksyre",
  "melkesyre",
  "melkesyrekultur",
  "askorbinsyre",
  "konserveringsmiddel",
  "antioksidant",
  "emulgator",
  "stabilisator",
  "fortykningsmiddel",
  "surhetsregulerende middel",
  "aroma",
  "naturlig aroma",
  "krydder",
  "pepper",
  "paprika",
  "løk",
  "hvitløk",
  "tomat",
  "gjær",
  "bakepulver",
  "natron",
  "kakao",
  "vanilje",
  "sitronsaft",
  "fiber",
  "inulin",
  "lecitin",
  "soyalecitin",
  "farge",
  "fargestoff",
  "betakaroten",
  "surdeig",
  "gluten",
  "kli",
  "malt",
  "maltekstrakt",
  // Round 2 — added from the top of the unmatched-token frequency report
  // (GET /api/diet-classification/report) after the first backfill over
  // ~2500 already-crawled products. This is the intended workflow: rerun
  // `npm run reclassify-diet`, re-check the report, keep expanding.
  "aromaer",
  "naturlige aromaer",
  "dekstrose",
  "kaliumsorbat",
  "eddik",
  "acesulfam k",
  "kullsyreholdig vann",
  "modifisert stivelse",
  "gjærekstrakt",
  "søtstoff",
  "søtstoffer",
  "kokosolje",
  "kakaomasse",
  "kakaosmør",
  "natriumbenzoat",
  "aspartam",
  "sukralose",
  "guarkjernemel",
  "maltodekstrin",
  "glukose",
  "sennepsfrø",
  "syrekultur",
  "xantangummi",
  "raps",
  "chili",
  "koffein",
  "natriumsitrater",
  "niacin",
  "mais",
  // Dairy/egg words: already reliably flagged via the legal allergen list
  // (contains_allergens 'melk'/'egg') — ignored here purely to keep this
  // report focused on gaps the allergen system doesn't already cover.
  "melk",
  "skummetmelk",
  "skummetmelkpulver",
  "lettmelk",
  "pasteurisert melk",
  "fløte",
  "kremfløte",
  "mysepulver",
  "eggeplomme",
  // Unambiguous E-numbers (acids/preservatives/gums/minerals — no animal
  // source in practice). Deliberately NOT exhaustive: E471 (mono-/
  // diglycerides), E120 (carmine), E542, E901, E904 etc. are genuinely
  // animal-or-plant ambiguous and are left unmatched on purpose rather than
  // guessed at — see README.
  "e300", // askorbinsyre / vitamin C
  "e330", // sitronsyre
  "e202", // kaliumsorbat
  "e250", // natriumnitritt
  "e412", // guarkjernemel
  "e415", // xantangummi
  "e450",
  "e451",
  "e452", // fosfater
  "e160a", // betakaroten
  "e500", // natriumbikarbonat
  "e211", // natriumbenzoat
  // Round 3
  "hvetegluten",
  "rismel",
  "hvete",
  "poteter",
  "persille",
  "hevemiddel",
  "vitaminer",
  "krydderekstrakt",
  // More dairy/egg words — same reasoning as round 2, already covered by
  // contains_allergens.
  "helmelkpulver",
  "melkeproteiner",
  "yoghurtkultur",
  "smør",
  "egg",
  // Found via spot-checking a random sample of flagged products (exactly
  // the iterate-from-real-data workflow this is designed around): both are
  // short-substring collisions like "and"/"ister" above, not flagged as
  // meat despite containing a meat-term substring.
  "kobalamin", // vitamin B12 names ("cyanokobalamin" etc.) contain "lam"
  "cyanokobalamin",
  "hydroksokobalamin",
  "hjortetakksalt", // baker's ammonia/leavening agent — contains "hjort"
  // (deer) in its name for historical reasons but is synthetic/mineral,
  // not animal-derived, in modern food production.
  "hjortronsalt", // Swedish "cloudberry salt" (hjortron = cloudberry) — same
  // leavening agent, unrelated "hjort" collision, seen on a Swedish import.
]);

// Known boilerplate that shows up appended to ingredient text (not itself an
// ingredient) — stripped before tokenizing so it doesn't pollute the
// unmatched-token log.
const BOILERPLATE_PATTERNS = [
  /pakket i beskyttende atmosfære/gi,
  /kan inneholde spor av[^.]*\.?/gi,
  /oppbevares? kjølig[^.]*\.?/gi,
  /best før[^.]*\.?/gi,
];

function splitTopLevel(s: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === delimiter && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function extractParenContent(s: string): { head: string; parenGroups: string[] } {
  let depth = 0;
  const headParts: string[] = [];
  const parenGroups: string[] = [];
  let curStart = 0;
  let parenStart = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      if (depth === 0) {
        headParts.push(s.slice(curStart, i));
        parenStart = i + 1;
      }
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        parenGroups.push(s.slice(parenStart, i));
        curStart = i + 1;
      }
    }
  }
  headParts.push(s.slice(curStart));
  return { head: headParts.join(" ").trim(), parenGroups };
}

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*\d+([.,]\d+)?\s*%$/, "") // trailing "45%" / "5,5 %"
    .replace(/^(min\.?|ca\.?)\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.;:]+$/, ""); // trailing "." / " . ." left over from boilerplate stripping
}

function tokenize(raw: string): string[] {
  // Some product pages bold-highlight the legally-required allergen word
  // inline in the ingredient list (e.g. "<b>hvetemel</b>") — strip markup
  // before anything else so it doesn't corrupt tokens.
  let cleaned = raw.replace(/<[^>]+>/g, "");
  // Some ingredient lists use square brackets for sub-ingredient groups
  // instead of parens (e.g. "hvetesurdeig 19% [hvetemel, vann]") — normalize
  // to parens so splitTopLevel/extractParenContent (which only track "(")")
  // handle both the same way.
  cleaned = cleaned.replace(/\[/g, "(").replace(/\]/g, ")");
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  const tokens: string[] = [];
  function walk(segment: string) {
    for (const part of splitTopLevel(segment, ",")) {
      const { head, parenGroups } = extractParenContent(part);
      const normalized = normalizeToken(head);
      if (normalized) tokens.push(normalized);
      for (const group of parenGroups) walk(group);
    }
  }
  walk(cleaned);
  return tokens;
}

function matchesAnimalTerm(token: string, terms: string[]): boolean {
  for (const marker of NEGATION_MARKERS) {
    if (token.includes(marker)) return false;
  }
  if (tokenEndsWithFri(token)) return false;
  return terms.some((term) => token.includes(term));
}

export function classifyDiet(ingredients: string | null | undefined): DietClassification {
  if (!ingredients || !ingredients.trim()) {
    return { flags: [], unmatchedTokens: [], parseStatus: "no_ingredients" };
  }

  const tokens = tokenize(ingredients);
  const flags = new Set<DietFlag>();
  const unmatched: string[] = [];

  for (const token of tokens) {
    if (!token || SAFE_IGNORE.has(token)) continue;

    let matched = false;
    for (const group of DIET_TERM_GROUPS) {
      if (matchesAnimalTerm(token, group.terms)) {
        flags.add(group.flag);
        matched = true;
      }
    }

    if (!matched) unmatched.push(token);
  }

  return { flags: Array.from(flags), unmatchedTokens: unmatched, parseStatus: "ok" };
}
