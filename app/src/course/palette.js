// course/palette.js — the course map colours (V04-SPEC §C.4, §F.6). Lazy. Owner V4-D.
// Canvas code never names a colour: it reads the --course-* tokens (one dark map palette in every theme; sun overrides
// --course-ob, --course-pin and --course-outline) and the theme-independent overlay tokens (--trail-1…8 for players,
// --media-bg for halos) through coursePalette(el), the same way viz/palette.js vizPalette does.
//
//   coursePalette(el) -> frozen { fairway, rough, green, bunker, water, tree, ob, pin, outline, outlined, halo,
//                         players: [4], aim, ellipse (--trail-7), text, font }
//   PLAYER_TOKENS     the four player colours (trail tokens, each ≥ 4.5 on black: readable on the dark map)

export const PLAYER_TOKENS = Object.freeze(['--trail-1', '--trail-4', '--trail-3', '--trail-5']);

/** Read the map palette from the computed style of `el` (the canvas or its screen root). */
export function coursePalette(el) {
  const view = el?.ownerDocument?.defaultView ?? globalThis;
  let cs = null;
  try { cs = view.getComputedStyle ? view.getComputedStyle(el) : null; } catch (_) { cs = null; }
  const fallback = (cs && cs.color) || 'gray';
  const get = (name) => {
    const v = cs ? String(cs.getPropertyValue(name) ?? '').trim() : '';
    return v || fallback;
  };
  const outline = get('--course-outline');
  const fam = cs ? String(cs.getPropertyValue('--font') || cs.fontFamily || '').trim() : '';
  return Object.freeze({
    fairway: get('--course-fairway'),
    rough: get('--course-rough'),
    green: get('--course-green'),
    bunker: get('--course-bunker'),
    water: get('--course-water'),
    tree: get('--course-tree'),
    ob: get('--course-ob'),
    pin: get('--course-pin'),
    outline,
    // sun: a 2 px black outline replaces the fill differences (transparent elsewhere)
    outlined: outline !== 'transparent' && outline !== fallback && !/^rgba\(0, 0, 0, 0\)$/.test(outline),
    halo: get('--media-bg'),
    players: Object.freeze(PLAYER_TOKENS.map(get)),
    aim: get('--trail-6'),
    ellipse: get('--trail-7'), // not a player colour: the next shot's area is never mistaken for a ball
    text: get('--trail-6'),
    font: fam || 'system-ui, sans-serif',
  });
}
