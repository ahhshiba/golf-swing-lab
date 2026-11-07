// ui/scorecard.js — the scorecard derived from strokes (sim/round.js scorecard), per-cell stroke sources, share, and the
// fixed footer score.disclaimer (V04-SPEC §C.4). Lazy screen 'scorecard'.
// STUB screen created by V4-A drop 1 (header + empty state + disclaimer); owner V4-D replaces the whole file
// (keep mountScorecard and the disclaimer).
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t } from '../i18n/index.js';

export function mountScorecard(root, app) {
  return {
    show() {
      clear(root, C.screenHeader({ title: app.screenTitle('scorecard'), back: true, onBack: () => app.nav.back() }),
        C.emptyState({ icon: 'flag', title: t('score.none.title'), body: t('score.none.body'), testid: 'scorecard-empty' }),
        h('p.hint', { 'data-testid': 'score-disclaimer', 'data-i18n-key': 'score.disclaimer' }, t('score.disclaimer')));
    },
  };
}
