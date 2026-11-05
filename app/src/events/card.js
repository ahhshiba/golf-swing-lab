// Model-card gate of an owner-trained event model (PRODUCT-SPEC §7.1, §7.4). Pure.
//
//   ownerGatePassed(card) -> boolean     card field golfdb: false and the owner-set holdout gate (§7.3) recorded as passed
//   cardViews(card) -> string[]          views the owner holdout covered (default face_on, dtl; high_behind only
//                                        when the card lists it)
//   tcnRejection(meta, view, { research }) -> null | reason   why pipeline/clip.js keeps the rules for this model

export const DEFAULT_CARD_VIEWS = Object.freeze(['face_on', 'dtl']);

export function ownerGatePassed(card) {
  return Boolean(card && card.golfdb === false && card.owner_holdout && card.owner_holdout.gate && card.owner_holdout.gate.passed === true);
}

export function cardViews(card) {
  const v = Array.isArray(card?.views) && card.views.length ? card.views : DEFAULT_CARD_VIEWS;
  return v.filter((x) => ['face_on', 'dtl', 'high_behind'].includes(x));
}

export function tcnRejection(meta, view, { research = false } = {}) {
  if (research) return DEFAULT_CARD_VIEWS.includes(view) ? null : 'tcn_view';
  const card = meta?.card ?? null;
  if (!card) return 'tcn_no_card';
  if (card.golfdb !== false) return 'tcn_card_third_party';
  if (!ownerGatePassed(card)) return 'tcn_owner_gate';
  if (!cardViews(card).includes(view)) return 'tcn_view';
  return null;
}
