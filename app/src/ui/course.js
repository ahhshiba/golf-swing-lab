// ui/course.js — virtual course: the round list (in progress / finished) and the new-round sheet (V04-SPEC §C.4).
// Lazy screen 'course' (Practice tab; styles/screens/sim.css via app.loadStyles before mount).
// STUB screen created by V4-A drop 1 (header + empty state); owner V4-D replaces the whole file (keep mountCourse).
import { clear } from './dom.js';
import * as C from './components.js';
import { t } from '../i18n/index.js';

export function mountCourse(root, app) {
  return {
    show() {
      clear(root, C.screenHeader({ title: app.screenTitle('course'), back: true, onBack: () => app.nav.back() }),
        C.emptyState({ icon: 'flag', title: t('course.empty.title'), body: t('course.empty.body'), testid: 'course-empty' }));
    },
  };
}
