// ui/about.js — licences, data attribution and the honest-data statement.

import { h, clear, card, screenHeader } from './dom.js';

export function mountAbout(root, app) {
  return {
    show() {
      clear(root,
        screenHeader('關於', () => app.nav.back()),
        card('揮桿實驗室',
          h('p', `版本 ${app.version()}`),
          h('p', '離線的高爾夫揮桿與球飛行分析，個人練習用。所有資料只存在這支手機上，沒有帳號、沒有伺服器。')),
        card('誠實數據聲明',
          h('p', '每一個數字都附 95% 信賴區間或標準差與可信度標記；量不到的數字會顯示空值並說明原因，不會用猜的補上。'),
          h('p', 'carry（飛行距離）一律是估計值：旋轉量沒有量測，用球桿的典型值估計，也沒有考慮風。'),
          h('p', '跨不同機位預設的比較一定會標示「不同機位預設」。')),
        card('授權與出處',
          h('ul', {},
            h('li', {}, h('strong', 'MediaPipe Tasks Vision 1.2.2'), ' — Apache License 2.0（Google LLC）。姿勢偵測模型 pose_landmarker lite／full／heavy。全文：vendor/mediapipe/LICENSE'),
            h('li', {}, h('strong', 'mp4box.js'), ' — BSD 3-Clause License（GPAC / Telecom Paris）。全文：vendor/mp4box/LICENSE'),
            h('li', {}, h('strong', 'GolfDB'), ' — McNally et al., “GolfDB: A Video Database for Golf Swing Sequencing”（CVPR Workshops 2019）。程式碼 CC BY-NC 4.0；揮桿事件模型以 GolfDB 訓練，僅供個人、非商業用途。')),
          h('p.hint', '本 App 不使用 OpenCV.js 與 Ultralytics。')));
    },
    hide() {},
  };
}
