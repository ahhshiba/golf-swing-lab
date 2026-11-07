// ui/round.js — one round: fly-over, top-down map, whose turn, distance, club suggestion, aim (drag + ±2° buttons),
// swing / import / type in, landing with the 95 % ellipse and the source chip (V04-SPEC §C.4). Lazy screen 'round'.
// STUB screen created by V4-A drop 1 (header + empty state); owner V4-D replaces the whole file (keep mountRound).
import { clear } from './dom.js';
import * as C from './components.js';
import { t } from '../i18n/index.js';

export function mountRound(root, app) {
  return {
    show() {
      clear(root, C.screenHeader({ title: app.screenTitle('round'), back: true, onBack: () => app.nav.back() }),
        C.emptyState({ icon: 'flag', title: t('sim.none.title'), body: t('sim.none.body'), testid: 'round-empty' }));
    },
  };
}
