// ui/lab.js — swing lab for one shot (params.shot_id): alignment lines over the replay, 8 phase cards, fault chips,
// frame / fault stepping, practice cards (V04-SPEC §E). Without a shot_id (home entry) it asks to pick a swing.
// Lazy screen 'lab' (styles/screens/lab.css). STUB screen created by V4-A drop 1; owner V4-F replaces the whole file
// (keep mountLab).
import { clear } from './dom.js';
import * as C from './components.js';
import { t } from '../i18n/index.js';

export function mountLab(root, app) {
  return {
    show() {
      clear(root, C.screenHeader({ title: app.screenTitle('lab'), back: true, onBack: () => app.nav.back() }),
        C.emptyState({ icon: 'level', title: t('lab.pick.title'), body: t('lab.pick.body'), action: { label: t('lab.pick.patterns'), onClick: () => app.nav.go('patterns'), testid: 'lab-to-patterns' }, testid: 'lab-empty' }));
    },
  };
}
