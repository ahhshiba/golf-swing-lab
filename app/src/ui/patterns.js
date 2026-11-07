// ui/patterns.js — fault trends (V04-SPEC §E.4): period × view filter, one row per fault with per-session shares and
// Wilson intervals, the 3 most common faults. Lazy screen 'patterns' (History tab; styles/screens/lab.css).
// STUB screen created by V4-A drop 1; owner V4-F replaces the whole file (keep mountPatterns).
import { clear } from './dom.js';
import * as C from './components.js';
import { t } from '../i18n/index.js';

export function mountPatterns(root, app) {
  return {
    show() {
      clear(root, C.screenHeader({ title: app.screenTitle('patterns'), back: true, onBack: () => app.nav.back() }),
        C.emptyState({ icon: 'history', title: t('patterns.empty.title'), body: t('patterns.empty.body'), testid: 'patterns-empty' }));
    },
  };
}
