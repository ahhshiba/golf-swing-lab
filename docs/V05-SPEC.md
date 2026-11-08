# Golf Swing Lab 0.5.0「室內投影模式」— 產品＋工程規格（V05-SPEC v1，2026-11-09）

> 給實作 agent 的派工規格。Repo：`/home/simon/Desktop/golf-swing-lab`（0.4.0 工作樹 `83c96d4`，Node 18、純 ES modules、無打包工具，
> 驗證入口 `bash scripts/verify.sh`）。前一版規格：`docs/V04-SPEC.md`（下稱 **V4**）、凍結介面 `docs/V04-INTERFACES.md`（**V4I**）、
> 計畫 `docs/CAFCR.md`（KD 編號沿用）。規範用語 MUST／SHOULD 同 RFC 2119。「機械判定」＝在 `bash scripts/verify.sh` 或
> `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs` 印 PASS/FAIL，不需要人判斷。「實機」＝只有 iPhone＋電視／投影機能證明，列在 §H。
> 本檔不寫任何發射監測器品牌或競品名稱（`scripts/check_brands.mjs` 掃整個 repo）；**行為以 code 為準**，本檔與 code 衝突時信 code 並回報。

## 0. 擁有者問題、回答與硬約束

### 0.1 問題與回答（11-08）

> 「可以直接在一台手機就做到模擬球場和室內練習場投影模式嗎」

**可以，條件如下**（本規格的一切設計都必須和這段一致）：

1. **一支手機**放在腳架上拍揮桿；模擬球場 0.4.0 已經有（V4 §C）。
2. **投影＝把手機畫面鏡像**到電視／投影機：AirPlay 螢幕鏡像，或 Lightning／USB‑C 轉 HDMI 轉接器。iOS Safari 裡的 PWA **不能**另外驅動一個「第二畫面」（查證見 §0.2），
   所以要做一個**專用的投影版面**：手機螢幕本身就是大字的球場／飛行／數字畫面，**同時相機繼續拍、繼續偵測揮桿**。
3. **即時模式（30–60 fps）只給大範圍速報**：球的數字只有「姿勢推估桿速 → 查表的 carry」（face_on，1σ 約 30–35%）或你自己的距離表（dtl／high_behind）；
   比較準的球數據要走 **240 fps 慢動作匯入**（每球約 45 s，KD4）。**永遠不宣稱準確率 %**，每個數字都是「估計 ± 範圍」；不出現任何發射監測器品牌或競品名稱。
4. **室內要注意**：240 fps 在一般室內燈光下拖影長（球速很可能量不到，需補光）；球打進 2–3 m 外的網子／打擊幕；手機要放在球打不到的位置。

### 0.2 第二畫面查證（2026-11-09；結論決定 §B 的做法）

| 能力 | iOS Safari（含主畫面 PWA）狀態 | 對本案的意義 | 來源 |
|---|---|---|---|
| Presentation API（`PresentationRequest`，網頁開第二畫面） | **不支援**（caniuse 列 iOS Safari 到 27.x 全部不支援；web-features 標 Safari 未實作） | 不能讓網頁在電視上開另一個頁面 | [caniuse wf-presentation-api](https://caniuse.com/wf-presentation-api)、[caniuse mdn-api_presentationconnection_url](https://caniuse.com/mdn-api_presentationconnection_url)、[web-features: presentation-api](https://web-platform-dx.github.io/web-features-explorer/features/presentation-api) |
| Window Management API（`getScreenDetails`，多螢幕視窗） | **不支援**（只有 Chromium 100+） | 同上 | [caniuse getScreenDetails](https://caniuse.com/mdn-api_window_getscreendetails)、[web.dev multiple screens](https://web.dev/articles/web-apps/multiple-screens) |
| Remote Playback API（`video.remote.prompt()`） | **有**（iOS Safari 13.4 起），但只把**一個 `<video>` 的媒體播放**交給 AirPlay，不能把任意頁面／DOM 送過去 | 不能拿來顯示球場畫面。用 canvas 錄成串流再 AirPlay：MediaStream 來源能否 AirPlay 查無文件（**UNVERIFIED**，推定不行）；MSE 類來源（ManagedMediaSource）要嘛關掉遠端播放、要嘛另給 HLS 網址，且 WebKit 有「加了 HLS 備援仍不交給 AirPlay」的 bug——都需要伺服器或網址，違反無後端 | [web-features: remote-playback](https://web-platform-dx.github.io/web-features-explorer/features/remote-playback)、[MDN RemotePlayback](https://developer.mozilla.org/docs/Web/API/RemotePlayback)、[MDN ManagedMediaSource](https://developer.mozilla.org/en-US/docs/Web/API/ManagedMediaSource)、[WebKit bug 274142](https://bugs.webkit.org/show_bug.cgi?id=274142) |
| 螢幕鏡像時 `<video>` 被自動送去 AirPlay | 2018 年 W3C 討論記錄：系統開著 AirPlay 鏡像時，Safari 會自動把 `<video>` 交給 Apple TV 播放（說明者自己請求更正，**非官方文件**） | 相機預覽 `<video>` 可能被「搶走」變成電視只播影片；**MUST** 在投影版面的預覽設 `disableRemotePlayback = true` 與 `x-webkit-airplay="deny"`，並列實機項 D3 | [W3C public-secondscreen 2018-01](https://lists.w3.org/Archives/Public/public-secondscreen/2018Jan/0030.html) |
| 原生 App 的外接螢幕（`UIScreen`／scene，外接時預設鏡像，App 可另建視窗） | 只有原生 App；網頁拿不到 | 「電視一個畫面、手機另一個畫面」只有原生 App 能做；本案不做原生 App | [Apple: Presenting Content on an External Display（archive）](https://developer.apple.com/library/ios/documentation/WindowsViews/Conceptual/WindowAndScreenGuide/UsingExternalDisplay/UsingExternalDisplay.html) |
| 偵測是否正在鏡像 | 網頁沒有 API（`webkitCurrentPlaybackTargetIsWireless` 只針對媒體元素） | 不偵測；架設流程請使用者目視確認（§A.2） | 同上兩列（推論） |
| 腳架附的藍牙快門遙控（等同音量鍵，CAFCR C2） | 這類遙控以「consumer control」裝置送音量鍵，由系統處理；**預期網頁收不到任何事件**（**UNVERIFIED**，實機 D6） | 不能靠它控制投影版面；改成「不需要碰」的自動流程（§B.5），鍵盤式藍牙簡報器／鍵盤當選配 | [Nordic DevZone：iOS shutter via BLE](https://devzone.nordicsemi.com/f/nordic-q-a/92798/trigger-ios-shutter-via-ble-on-ios-16) |
| WebRTC DataChannel（§I 第二台裝置） | 支援；WebKit 只在**已取得相機／麥克風權限**時才給 host（區網 IP）候選，否則只給反射／中繼候選（2017 文章）；之後各瀏覽器改用 mDNS `.local` 名稱代替 IP | 手機在拍攝中（有相機權限）→ 有 host 候選；離線區網沒有 STUN，接收端若無相機權限可能只有 mDNS 或沒有候選 → 接收端掃 QR 時開相機剛好解決（**UNVERIFIED**，§I spike） | [WebKit blog: A Closer Look Into WebRTC（2017-07-03）](https://webkit.org/blog/7763/a-closer-look-into-webrtc/)、[Chromium PSA：host 候選改 mDNS](https://groups.google.com/a/chromium.org/g/blink-dev/c/z5hSy6Rf_aE/m/amoojRkSAgAJ) |
| BarcodeDetector（掃 QR） | iOS Safari 預設關閉（功能旗標），且有 iOS 18 壞掉的回報 | §I 若做，QR 解碼要自帶（lazy、授權需相容） | [caniuse BarcodeDetector](https://caniuse.com/mdn-api_barcodedetector_barcodedetector)、[WebKit bug 281848](https://bugs.webkit.org/show_bug.cgi?id=281848) |

結論：**0.5.0 只做「鏡像＋專用投影版面」**；第二台裝置（WebRTC＋QR）評估為可行但未證實，列 0.5.x 先做 spike（§I）。

### 0.3 硬約束（沿用 V4 §0，加上本版）

| 來源 | 內容 |
|---|---|
| 沿用 | 單機單機位；即時 30–60 fps 只給姿勢／tempo／事件（face_on 另有桿速「低」）＋速報；球速／發射角只來自 240 fps 匯入；`measured` 永遠 false；契約不變式（非 null 必有 ci95 或 sigma、null 必有原因碼）；不對外部網域發請求；免帳號、資料只在手機 |
| 本版 | **不改 `golf-shot/2`、`golf-round/1` 契約、不加原因碼**（`check_contract` 仍印 `(47 reason codes;`）；投影版面的檢查與提示是 UI 層文字（`stage.*` i18n），不是 shot 欄位 |
| 預算 | shell **≤ 992,000 B**（目前 990,114 B，**剩 1,886 B**）；`BUDGETS` 不准改；新程式碼、新 CSS、新字串**全部 lazy**；precache ≤ 32,450,000 B（目前 32,221,253 B） |
| lint | `check_i18n --strict`、`check_tokens --strict`（新 CSS 不准 px 字級、不准 hex；動效只在 `prefers-reduced-motion: no-preference` 內）、`check_brands` |
| 語系 | zh-Hant＋en；產品內功能名：投影模式／Projector mode、室內練習場／Indoor range（不得用 check_brands `feature-names` 規則裡的詞） |

### 0.4 目標與非目標

**目標**

| # | 目標 | 可量化（驗收在 §G／§H） |
|---|---|---|
| G1 | 一支手機、腳架、鏡像到大螢幕，就能打模擬球場（1–4 人）與室內練習場 | 9 洞 2 人整輪在投影模式完成（e2e `v5-c-round`；實機 D7） |
| G2 | 每球**不碰手機**（KD7 即時模式 0 次） | e2e：整輪零 pointer 事件；實機 `live.touches_per_shot = 0` |
| G3 | 3–5 m 外看得清楚 | 參考顯示器上字高規則（§B.2）機械檢查；實機 D5 |
| G4 | 室內架設 ≤ 5 分鐘（KD3；第一次布置房間 ≤ 10 分鐘） | 實機 D7 計時（P90，n ≥ 5） |
| G5 | 誠實：每個數字有範圍與有效性；落點畫不確定範圍 | e2e `v5-c-honesty`、單元 `stage.honesty` |
| G6 | 室內光線、網距、手機安全先檢查再開打 | 單元 `stage.checks`；實機 D8／D9／D13 |

**非目標（0.5.0 不做）**：原生 App 或任何需要上架的東西；真正的第二畫面 API；任何伺服器、雲端轉送、帳號；即時 240 fps（getUserMedia 拿不到，CAFCR U01）；用相機偵測「球進網」或打擊幕上的落點；投影機梯形校正、打擊幕座標校正；
自動辨識球桿；推桿／切桿的實測（沿用自動推桿）；線上對戰；新增球場風格；改變 V4 §B.4「進行中的球只用速報、不回頭改位置」；第二台裝置顯示（§I，0.5.x）。

---

## A. 使用情境與室內旅程

### A.1 場地（第一次布置時實量，數字全是假設，覆寫進 `settings.stage`）

```
俯視（右打；+x＝目標方向；球在 (0,0)；單位 m）

   y
   ↑      球員（y≈+0.9，面向 −y）
   │        ● 球（0,0）—— 墊子 ——————————→ x   ‖ 打擊網／投影幕（x≈+2.0～+3.0）
   │
   ▣ 手機（face_on：x≈−0.3 以後、y≈−2.7；橫拍；後鏡頭朝球員 → 螢幕背對球員）
```

- **建議機位 face_on**：(1) 只有 face_on 的速報 carry 來自這一球的姿勢桿速，dtl／high_behind 只是距離表（V4 §B.1）；(2) 打擊幕在 face_on 畫面邊緣或外面，
  在 dtl／high_behind 則正好在背景（投影動畫會出現在畫面裡，§D 檢查 `screen_in_view`）；(3) 橫拍 → 鏡像到電視是橫的（直拍會變成電視中間一條，§B.1）。
- **手機螢幕背對球員**（後鏡頭拍人），所以球員本來就看不到手機——這正是要投影的理由。
- 房間寬（球員背後牆到相機側牆）約需 ≥ 4.2 m 才放得下 D = 2.7 m（**UNVERIFIED**，含球員背後揮桿空間）；不夠時沿用 CAFCR C2 窄打位規則（正面改以姿勢為主）。
- 右打與左打站在球的兩側：**同一個 face_on 機位只對一種慣用手是正面**，另一種人是背面（§C.4）。

### A.2 室內旅程（目標 ≤ 5:00，第一次布置房間 ≤ 10:00）

| 步驟 | 動作 | 時間目標 | 觸碰 | 由誰檢查 |
|---|---|---|---|---|
| 0（一次） | 配對藍牙簡報器／鍵盤（選配）；確認電視可接 AirPlay 或轉接器 | — | — | 實機 D6 |
| 1 | 架網／打擊幕、墊子、腳架到 face_on 位置，手機橫放 | 1:00 | — | — |
| 2 | 開鏡像：控制中心 → 螢幕鏡像 → 選電視；或插轉接器（建議有充電孔的） | 0:30 | 系統 UI | 使用者目視 |
| 3 | App：模擬球場 → 選回合（或「室內練習場」）→ **投影模式** | 0:20 | 2–3 次 | — |
| 4 | 既有架設流程（P3：水平、墊子校正、預設重用） | ≤ 2:00 | 既有 | 既有 KD1／KD3 |
| 5 | 投影檢查（自動跑 ≤ 15 s）：橫向、光線／幀率、閃爍條紋、螢幕在畫面內、網距、手機位置、慣用手 | 0:15 | 0（有警告時 1 次「仍要開始」） | §D |
| 6 | 電視出現第 1 洞飛越 → 開打；之後每桿 0 次觸碰 | — | 0 | §B.5 |

- 第 3 步之後手機不再需要拿起來（直到要走 240 fps 精算或結束）。
- 進入投影模式時若沒有進行中的練習，先導到 setup，完成後**回到投影模式**（`nav.go('setup', { next: { screen: 'live', params } })`，§F.5）。
- 鏡像畫面會出現手機上所有東西：iOS 預設在螢幕鏡像時不顯示通知（**UNVERIFIED**，D11）；架設說明提醒開「勿擾」。

---

## B. 投影版面

### B.1 顯示鏈與畫面幾何

- 手機螢幕＝投影畫面（鏡像）。iPhone 12 橫向 CSS 視窗 844×390（約 2.16:1），送到 16:9 電視時**上下黑邊**（畫面寬度貼滿，高度約佔 82%）；4:3 投影機黑邊更大。
- **預設 `frame: 'full'`**：版面用滿手機橫向視窗（不在手機上再畫 16:9 框，否則電視上左右也會多黑邊）。
  選項 `frame: '16:9'`：內容放在置中的 16:9 方框內，給「放大填滿」模式會裁掉左右的投影機（手機上會有左右黑邊）。
- **安全區**：所有文字與操作提示 MUST 在「標題安全框」內＝四邊各內縮 `max(5%, env(safe-area-inset-*))`（電視過掃描通常裁左右邊，iPhone 橫向瀏海也在左右）。
  只有球場地圖背景可以畫到邊。
- 直向（dtl 直拍）時：版面改上下排（地圖上、數字下），電視上變成中間一條；畫面頂端常駐提示「橫拍才會填滿電視」。直向不做字高驗收，只驗不溢出。
- 必須是**主畫面 App（standalone）**：Safari 分頁的網址列會佔掉高度；從 Safari 分頁進入時投影檢查給提示（`display-mode: standalone` 媒體查詢）。
- 投影版面**強制深色**（不跟 light／sun 主題）：投影機在有燈的房間對比會掉，深底亮字最耐看。

### B.2 3–5 m 可讀性（機械可檢；參考顯示器＝43 吋 16:9 電視）

參考：43 吋電視寬 0.952 m；844 CSS px 寬的鏡像貼滿寬度 → **1 CSS px ≈ 1.13 mm**、版面高 390 px ≈ 0.44 m。字高（數字／大寫高）取 0.72 em。

| 層級 | 規則（5 m 處） | 換算成版面高度 vh（以 390 px 為 100vh） | token（`styles/screens/stage.css`，lazy） |
|---|---|---|---|
| 主數字（carry、距 pin） | 字高 ≥ 距離 / 120 ≈ 42 mm | font-size ≥ **13vh**（≈ 51 px） | `--stage-fs-num: 14vh` |
| 英雄數字（一桿一個，最大的那個） | ≥ 距離 / 80 | ≥ **20vh** | `--stage-fs-hero: 22vh` |
| 標籤（球員名、球桿、狀態） | ≥ 距離 / 200 | ≥ **8vh** | `--stage-fs-label: 8.5vh` |
| 任何文字（含 ±、來源、提示） | ≥ 距離 / 250 ≈ 20 mm | ≥ **6.5vh**（≈ 25 px） | `--stage-fs-min: 6.5vh` |

- 字重 ≥ 600；文字對背景對比 ≥ **7:1**、非文字圖形 ≥ 3:1；顏色不是唯一載體（沿用 design-system §1）。顏色只用既有 token（`--media-bg`、`--on-media`、`--trail-*`、`--course-*`、`--viz-*`），
  `stage.css` 只定義別名（`--stage-bg: var(--media-bg)` 等），**不在 tokens.css 加新色**（省 shell）。
- 同時出現的主數字 ≤ 3 個；每個數字旁邊的 ± 或範圍不小於 `--stage-fs-min`。
- 32 吋電視等同 3.7 m 的 5 m 規則；更小的電視在 §H 實機記錄，不改規則。
- 動效：落點動畫 ≤ 1.2 s、只動 transform／canvas；`prefers-reduced-motion` → 直接到位；不閃爍（> 3 Hz 的亮度變化禁止，`screen_in_view` 檢查的閃動只在檢查階段、≤ 2 Hz、可略過）。

### B.3 版面區塊（橫向）

```
┌──────────────────────────────────────────────────────────────┐
│ 頂列：第 3 洞 · Par 4 · 第 2 桿 │ 輪到：王小明 ■ │ 狀態膠囊         │
├───────────────────────────────────────┬──────────────────────┤
│                                       │ 數字欄（≤3 個主數字）  │
│  球場（俯視地圖／飛行動畫）             │  距 pin   152 ± —     │
│  ・球、瞄準線、推薦球桿 P10–P90 帶      │  球桿     7 鐵（推薦） │
│  ・95% 落點橢圓、模擬落點、來源標示     │  carry   120–160 m ▲  │
│                         ┌────────┐    │                      │
│                         │相機小窗 │    │                      │
│                         └────────┘    │                      │
├───────────────────────────────────────┴──────────────────────┤
│ 底列：一行提示／倒數環／遙控鍵說明（有配對鍵盤時）               │
└──────────────────────────────────────────────────────────────┘
```

- 地圖 62% 寬、數字欄 38%；頂列與底列各 ≤ 14vh。
- **相機小窗**（`pip`，預設開，§K Q3）：live 預覽 `<video>` 縮成 ≥ 22% 寬放地圖左下。**預覽元素 MUST 保持可見且有尺寸**（不能 `display:none`／0 尺寸／`visibility:hidden`）：
  frame tap 用 `requestVideoFrameCallback` 讀它，隱藏的影片在 iOS 可能停止送幀（**UNVERIFIED**，e2e `v5-c-capture` 在 Chromium 驗、D1 在實機驗）。關掉小窗＝縮到 2×2 px、`opacity: 0.01`，不移出 DOM。
- 預覽 `<video>` 在投影版面 MUST 設 `disableRemotePlayback = true` 與 `x-webkit-airplay="deny"`（§0.2）。

### B.4 狀態與每個狀態畫面上有什麼

狀態由純模組 `stage/flow.js` 決定（§F.2），畫面只負責畫。`data-stage-state` 掛在根元素（e2e 用）。

| 狀態 | 進入條件 | 畫面內容 | 離開 |
|---|---|---|---|
| `check` | 進投影模式 | §D 檢查清單（大字，每項 ✓／▲／✕＋一句修法）；全綠自動進下一步，有 ▲ 等 10 s 或「確認」鍵，有 ✕ 停住 | 通過／確認 |
| `intro` | 新洞第一桿前 | 洞號、par、長度、風格；飛越（V4 `createFlyover`，reduced motion → 靜態一張） | 4 s 後自動、或確認鍵略過 |
| `handoff` | 換人（≥ 2 人） | 全螢幕大字「輪到：名字」＋玩家形狀（V4 `PLAYER_SHAPES`）＋慣用手；與上一位慣用手不同時加 §C.4 提示 | `handoffS`（預設 3 s）後自動 |
| `ready`（等待） | 輪到某人且相機就緒 | 地圖：球位、瞄準線、推薦球桿的 P10–P90 帶與下一桿 95% 橢圓（V4 `previewEllipse`）；數字欄：距 pin、球桿（「推薦」或「已選」字樣）、上一桿結果小卡；膠囊「準備好就打」；底列遙控鍵說明 | live 狀態 SWING |
| `swing`（偵測到揮桿） | live 狀態 SWING／IMPACT | 膠囊「揮桿中」；地圖凍結；數字欄不變 | 速報到達或練習揮桿（無擊球 → 回 `ready`） |
| `quick`（速報） | `quickEstimate` 結果 | 數字欄：carry（範圍或 ±，`honestDistance`）＋有效性符號 ▲＋「速報」＋來源（「姿勢推估」／「你的距離表」／「一般球員參考值」）；face_on 另顯示桿速 ±、tempo；地圖：先畫 95% 橢圓、再畫球從球位沿瞄準線飛到**模擬落點**（≤ 1.2 s），落點標「模擬」；底列**倒數環**「4 秒後計入 · 退回鍵＝重打（不算桿）」 | 倒數結束或確認鍵 → 計入（`driver.play`）；退回鍵 → `ready` |
| `refined`（精算到達） | 同一揮的完整 shot（2–8 s 後） | 只更新數字欄的桿速／tempo：「速報 41 → 精算 43」2 s 後淡出；**落點不動**（V4 §B.4）；若已進下一桿，只更新「上一桿」小卡 | — （疊加在當下狀態上） |
| `landed`（球在球場上） | 計入後 | 地圖：球停點、球位 chip（球道／長草／沙坑／果嶺／水／OB＋罰桿）、事件（打到樹／入水／出界）；數字欄：剩餘距 pin、這洞桿數；自動推桿結果一行（`AUTO_PUTT`，「模擬推桿」） | 2.5 s 後 → `handoff`／`ready`／`holedone` |
| `holedone` | 這洞所有人完成 | 各玩家本洞桿數、對 par、總計；頁尾「模擬成績由估計距離算出」（`score.disclaimer` 同義字串，stage namespace） | `holeDoneS`（6 s）→ 下一洞 `intro`；最後一洞 → `finished` |
| `import`（240 精算中） | 這一桿選了慢動作（§C.2） | 「這一桿用慢動作精算」＋步驟（到相機錄 → 回來匯入）；分析中顯示進度與 ETA（≈ 45 s）；其他人等待 | 匯入的 shot 到達 → `quick` 版面（來源「慢動作量測＋模型」，無倒數，直接計入）；取消 → `ready` |
| `paused` | 相機中斷、過熱降級、太慢（P18）、從背景回來 | 大字原因＋修法；可用確認鍵（keydown 是使用者啟用，能重開相機）或觸碰 | 恢復 |
| `finished` | 回合結束 | 記分卡摘要＋「在手機上看完整記分卡」 | 確認鍵 → 回合記分卡畫面 |

練習場模式（`mode: 'range'`）只用 `check`、`ready`、`swing`、`quick`、`refined`、`landed`、`import`、`paused`：地圖換成練習場（§C.5），數字欄加本次各球桿的速報 carry 中位數與範圍。

### B.5 不碰手機的流程（KD7）與遙控

**預設流程每桿 0 觸碰**：速報 → 倒數 `autoAcceptS`（預設 4 s，§K Q1）→ 自動計入 → 自動推桿 → 自動換人 → 自動下一洞。
球桿預設＝**推薦球桿**（`recommendClub`），畫面寫「推薦」；**實際打別支卻沒換，結果就錯**——`ready` 狀態的球桿字樣常駐，並在 `handoff` 念出（既有語音）。

遙控（選配）：iOS 上藍牙鍵盤／簡報器的按鍵會成為網頁 `keydown`；音量鍵型快門遙控預期**收不到**（§0.2，D6）。對應表（`stage/keys.js`，兩種設定檔）：

| 動作 | `presenter`（預設；簡報器常見鍵） | `keyboard` |
|---|---|---|
| `confirm`：計入／略過飛越／關閉提示 | PageDown、ArrowRight、Enter、Space | Enter、Space |
| `retake`：這一揮不算（速報倒數中）；`undo`：撤銷剛計入的一桿（下一桿開打前） | PageUp、ArrowLeft、Backspace（倒數中＝retake，計入後 10 s 內＝undo） | Backspace（retake）、U（undo） |
| `aim_left`／`aim_right`（±2°） | — | ArrowLeft／ArrowRight |
| `club_prev`／`club_next` | ArrowUp／ArrowDown（有的簡報器有） | ArrowUp／ArrowDown |
| `import`：這一桿改走 240 慢動作 | B（簡報器「黑畫面」鍵常送 B 或 `.`） | I |
| `scorecard` | — | S |

- 觸碰仍可用：投影版面上每個動作都有 ≥ 64 px 的按鈕（`--hit-live`），放在數字欄底部；觸碰照舊計入 `live.touches_per_shot`。
- 無遙控時的「打壞了」：倒數期間只能觸碰「重打」；計入後只能觸碰「撤銷」（10 s 內）。這是誠實的限制，寫在投影說明裡。
- 不用 Media Session（耳機播放鍵）：要有媒體在播放才收得到，行為未驗證，不做。

---

## C. 擊球資料怎麼進回合

### C.1 即時速報（主要路徑）

| 機位 | carry 來源（沿用 V4 §B.1） | side | 投影上的字樣 |
|---|---|---|---|
| face_on | 姿勢桿速 → 查表，與自己距離表反變異數合併；1σ 約 30–35% | 抽樣（`SIDE_SAMPLED`） | 「姿勢推估」＋▲＋範圍；側向寫「左右：抽樣」 |
| dtl／high_behind | 距離表先驗（或一般參考值） | 抽樣 | 「你的距離表（不是這一球量到的）」；不寫「這一球」 |

- 速報經 `app.sim` 以外的直接呼叫進回合：`driver.play({ kind: 'quick', result })`（§F.1），**不經 `app.sim.submit`**，避免已掛載的 `round` 畫面重複計桿（見 C.6）。
- 練習揮桿（偵測器判為 practice、無擊球）不產生速報，也不計桿。

### C.2 240 fps 慢動作（精準路徑，每桿約 45 s＋手動）

1. `ready` 時按 `import` 鍵或觸碰「這一桿用慢動作」→ `import` 狀態，`app.sim.set({ …ctx, owner: 'stage' })`。
2. 使用者到「相機」App 錄慢動作（藍牙音量鍵遙控在**相機 App**裡有效）→ 回到本 App → `nav.go('import', { sink: 'sim' })`（既有匯入＋sim 橫幅）。
   這時電視鏡像的是相機 App 的取景畫面；本 App 在背景時相機串流會停，回來要重開（可能重新詢問權限，CAFCR bug 327237；**UNVERIFIED**，D10）。
3. 分析完成 → 既有 `simImport` 呼叫 `app.sim.submit({ kind: 'shot', shot })` → 投影模式的監聽器只收 `ctx.owner === 'stage'` 的輸入 → `driver.play` → `nav.back()` 回投影模式。
4. 觸碰次數照實記錄（預估 ≥ 4 次：切 App、回來、匯入、選檔）；**不宣稱 0 觸碰**。多人時其他人等這一桿（不排隊）。
5. 落點用匯入值（carry 估、face_on 的 side 仍抽樣；high_behind 240 才有真的左右），flight 形狀用 `draw.apex_m／land_deg`（V4 整合更正）。

### C.3 精算（refined）與手動

- 精算只更新數字與 golf-shot，不改落點（V4 §B.4）。round 紀錄的 `shot_id` 在精算到達時補上（沿用 0.4.0 行為；`driver.attachShot(stroke_seq, shot_id)`，若 0.4.0 沒做則不新增，照 code）。
- 手動輸入（V4 §B.3）只在手機上的回合畫面做，投影模式不提供（需要打字）。

### C.4 多人與慣用手（由 code 判讀出的 0.4.0 既有問題，V5-C 先寫測試確認再修）

- `ui/live.js` 的 `clipOptions.handedness` 與速報輸入用的是**設定裡擁有者的慣用手**，不是輪到的玩家 → 左打訪客的速報用錯手腕。
  修：投影模式每次換人呼叫 `live.setPlayer({ handedness, kind })`（§F.4），速報與該揮分析都用該玩家的慣用手。
- 同一 face_on 機位對另一種慣用手是**背面**：該玩家的速報 MUST 不用姿勢桿速（`quickEstimate` 新選填輸入 `poseUsable: false` → `club_speed_mps` null＋`VIEW_PLANE_MISMATCH`，carry 走距離表／參考值先驗），投影顯示「這個機位看不到你的正面：距離用你的距離表」。`handoff` 狀態先講。
- `ui/live.js onShot` 會把每一揮存成**擁有者的** golf-shot → 訪客的揮桿污染擁有者的距離表與統計。修：`kind === 'guest'` 的玩家，該揮的 shot **不存**（`live.setPlayer({ kind: 'guest' })` → `onShot` 略過 `saveShot`，速報照樣進回合，round 紀錄 `shot_id: null`）。
  擁有者的揮桿照舊存。同一修正也適用 0.4.0 的非投影回合（`sink: 'sim'`），由同一 hook 完成。

### C.5 室內練習場（`mode: 'range'`）

- 地圖＝`stage/range.js rangeHole()` 產生的直線練習場（50／100／150／200／250 m 或碼的目標旗；寬 70 m），**不存檔、不是 round**。
- 每球的標示（`rangeMark`）：
  - face_on 速報：在 carry 位置畫**橫跨練習場的帶狀範圍**（carry ± 95%），**不畫左右點**（左右量不到，練習場不抽樣——抽樣會造出假的散佈）；
  - 240 匯入 high_behind：carry＋左右都有 → 畫點＋95% 橢圓；face_on 240：帶狀（carry 較窄）；
  - dtl／high_behind 速報（距離表）：**不畫落點**，只顯示揮桿數字（tempo 等）與「這個機位即時量不到距離」（§K Q2）。
- 數字欄：本次各球桿的速報 carry 中位數與 P10–P90（只在記憶體；速報不寫進 golf-shot，V4 §A.2）、球數。精算 shot 照 0.4.0 存進歷史。

### C.6 與 0.4.0 回合畫面的關係（避免雙重計桿）

- `ui/round.js` 在掛載時就註冊 `app.sim.onSubmit`，之後一直在聽。投影模式 MUST NOT 用 `app.sim.submit` 送速報；240 路徑用 `ctx.owner = 'stage'`，
  `round.js onInput` 遇到 `ctx.owner === 'stage'` 直接忽略，投影模式的監聽只收 `owner === 'stage'`。
- `round.js show()` 從投影模式回來時 MUST 比對記憶體與 IDB 的 `updated_at`，較舊就重新載入（目前「同一回合就保留記憶體狀態」會顯示舊的球位）。
- 回合邏輯（`onInput／commit／settle`）抽到 `sim/driver.js`，`round.js` 與投影模式共用；`v4-d-*` gates 不得退步。

---

## D. 室內架設檢查（`stage/checks.js`，`check` 狀態自動跑）

每項回傳 `Check = { id, status: 'ok'|'warn'|'fail'|'unknown', value, threshold, msg: i18nKey, fix: i18nKey }`。門檻集中在 `STAGE_CHECK_PARAMS`（帶 `version`），**全部 UNVERIFIED**，以實機 D8／D9／D13 校正。
`fail` 只用在會讓功能完全失效的情況；其他一律 `warn`（可「仍要開始」）。

| id | 量什麼 | 怎麼量（只用已有的輸入） | 判定（初值） | 修法字串 |
|---|---|---|---|---|
| `orientation` | 版面是否橫向、是否 standalone | `matchMedia('(orientation: landscape)')`、`(display-mode: standalone)` | 直向 → warn；Safari 分頁 → warn | 關閉直向鎖定、橫放；從主畫面圖示開 |
| `fps` | 即時幀率是否被暗光拉低 | frame tap `stats()` 的實際 fps（既有）對目標 30 | < 25 → warn；< 15 → fail（速報與事件都不可靠） | 開燈／補光 |
| `light` | 暗光代理指標 | 預覽 1 s、縮到 64×36 的亮度：平均 Y 與**時間雜訊**（靜止像素相鄰幀差的 SD；暗光時 ISO 高、雜訊大）。自動曝光會把平均亮度拉平，所以以雜訊為主 | 雜訊指數 > 門檻 → warn「240 fps 慢動作的球很可能拖影過長、量不到球速」 | 加 LED 投光燈照球與擊球區 |
| `flicker` | 燈光閃爍（台灣 60 Hz 電 → 120 Hz 閃） | 單幀逐列平均亮度的週期性條紋（滾動快門把閃爍變成橫條）；條紋振幅／平均 | > 門檻 → warn「慢動作會一幀亮一幀暗」 | 換不閃爍的燈 |
| `screen_in_view` | 投影／電視是否在相機畫面裡 | 投影版面全畫面亮暗交替 3 次（≤ 2 Hz、1.5 s），比對預覽各區塊亮度是否同步變化（沒開鏡像時永遠不會同步 → `unknown`） | 有同步區塊 → warn，並在小窗框出位置 | 移動相機或網子位置；dtl／high_behind 尤其要避開 |
| `net` | 球到網距離與畫面範圍 | 使用者輸入 `net_m`（第一次；存 `settings.stage.net_m`）；畫面沿目標線涵蓋到 `x_edge = D·(W − cx)/f`（右打，由校正 `calibration.camera.{f,W,cx}`、`calibration.pose.D_m`） | `net_m < 2.0` → warn（反彈、安全；UNVERIFIED）；`net_m < x_edge` → warn「球在畫面中只飛 net_m 就入網，慢動作追球點數變少」 | 網子往後移，或接受較寬的範圍 |
| `phone_safety` | 手機會不會被打到 | 校正解出的相機位置沿目標線的分量 `x_cam`（欄位名以 `calib/` code 為準）；face_on 時 `x_cam > −0.3 m` → warn（相機在球的目標側，偏離球的打點直接朝那邊） | 見左 | 相機往球後方移，或加側網 |
| `handedness` | 玩家慣用手與架設時的慣用手 | 回合玩家清單 vs 架設時的 `settings.handedness` | 有不同 → warn（§C.4） | 換機位，或接受「距離用距離表」 |
| `mirror` | 是否在鏡像 | **無法偵測** → 永遠 `unknown`，顯示「電視上看得到這一頁嗎？」 | — | — |

240 匯入後的回饋：匯入的 shot 若 `ball_speed_mps` 為 null，投影上顯示該 metric 的原因碼短文（既有 `reason.<CODE>.short`），並在 `light`／`flicker` 曾是 warn 時加一句「多半是光線不足」——**只是提示，不改 shot 契約**。

---

## E. 誠實規則（投影版面專用；全部有單元或 e2e 檢查）

1. 每個距離／速度數字 MUST 帶 ± 或範圍（`honestDistance`；± 超過 30% 就以範圍為主），並帶有效性符號（● ◐ ▲ —）；null 顯示「—」與原因短文。
2. 每一桿標資料來源：姿勢推估／你的距離表／一般參考值／慢動作量測＋模型／抽樣（左右）／模擬推桿。**不出現「實測」「量到的落點」「準確」字樣**（`stage` namespace 加入 `check_brands accuracy-claim` 的掃描範圍——它已掃 `app/i18n/**`）。
3. 落點：先畫 **95% 落點橢圓**（V4 `ELLIPSE_K95` 2.4477 σ），再畫抽到的模擬點（實心＋「模擬」）；練習場模式左右量不到時畫帶狀，不畫點；距離表來源時，飛行動畫標「距離表」。
4. 速報與精算差異照 V4 §A.2 顯示一次；落點不因精算移動，也不暗示「已更正」。
5. 記分卡與回合摘要頁尾固定「模擬成績由估計距離算出，不等於真實球場成績」。
6. 投影上不顯示任何秒數宣傳；速報延遲只在診斷報告（沿用 V4 §A.1）。
7. 不得出現任何發射監測器品牌或競品名稱（`check_brands` 已涵蓋全 repo 與 `dist/`）。

---

## F. 介面、設定、i18n、lazy、預算

### F.1 `sim/driver.js`（新，lazy，無 DOM；V5-B）

```
createRoundDriver({ round, rows, save: (round) => Promise<void>, seedOf? }) -> RoundDriver
RoundDriver = {
  round() -> golf-round/1,                       // 目前的回合物件（不可變；每次 play 換新）
  context() -> StrokeCtx | null,                 // null = 回合結束
  setAim(point | null), nudgeAim(deg),           // ±2° 同 ui/round.js rotateAim
  setClub(clubId | null),                        // null = 回到推薦
  play(input) -> Promise<PlayResult>,            // input 同 app.sim 的 { kind: 'quick'|'shot'|'manual', … }；= shotOutcome + playStroke + settle(autoPutt) + save
  autoChip() -> Promise<PlayResult>,
  undoLast() -> Promise<boolean>,                // 只能撤銷最後一桿，且下一桿尚未開打
  canUndo() -> boolean,
  onChange(fn(round)) -> off,
}
StrokeCtx = { round_id, hole_n, par, hole: Hole, player, stroke_n, ball: { x, y, lie, to_pin_m }, style, seed,
              recommend: recommendClub 的回傳, club, club_source: 'recommended'|'picked', aim: { x, y }, preview: { sx, sy } }
PlayResult = { stroke, outcome, landed: { lie, event, penalty, to_pin_m }, auto: [{ kind: 'auto_putt', player_id, n }],
               next: 'same_player'|'next_player'|'hole_done'|'round_done' }
```

- `ui/round.js` 改用它（`onInput／commit／settle` 搬進來）；`sim/**` 純度規則不變（不碰 `document`／`window`）。
- 決定性：同一回合＋同一輸入序列 → 與 0.4.0 `ui/round.js` 路徑產生**逐位元組相同**的 round（金檔：用 0.4.0 code 產生，V5-A 夾具）。

### F.2 `stage/**`（新目錄，全部 lazy）

| 檔案 | 擁有 | 匯出 |
|---|---|---|
| `stage/settings.js` | V5-A | `normalizeStage(x)`, `STAGE_DEFAULTS = { autoAcceptS: 4, handoffS: 3, holeDoneS: 6, landedS: 2.5, keys: 'presenter', pip: true, frame: 'full', net_m: null }`, `STAGE_MODES = ['course','range']`；`autoAcceptS ∈ {0, 2…10}`（0 = 必須按確認） |
| `stage/flow.js` | V5-C | `STAGE_STATES`（§B.4 12 個）；`createStageFlow({ mode, driver \| null, settings, clock: { now(), setTimeout, clearTimeout }, onState(state, data) }) -> { state(), data(), event(ev) }`；`ev` = `{ type: 'live', to }`、`{ type: 'quick', result }`、`{ type: 'refined', shot, quick }`、`{ type: 'import_start' }`、`{ type: 'import_shot', shot }`、`{ type: 'key', action }`、`{ type: 'error', code }`、`{ type: 'resume' }`、`{ type: 'checks', results }`。純邏輯、可用假時鐘測 |
| `stage/keys.js` | V5-C | `KEY_ACTIONS = ['confirm','retake','undo','aim_left','aim_right','club_prev','club_next','import','scorecard']`、`KEY_PROFILES`、`keyAction({ key, code, repeat }, profile, state) -> action \| null`（`repeat` 一律忽略；輸入框聚焦時不處理） |
| `stage/range.js` | V5-B | `rangeHole({ units }) -> Hole`（V4 §C.1 形狀、通過 `drawHole2d`；不經 `validateCourse`）、`rangeMark({ input, view, quick?, shot? }) -> { kind: 'band'\|'point'\|'none', carry: { value, lo, hi }, side: { value, lo, hi } \| null, source, reason }` |
| `stage/draw.js` | V5-C | `drawStage(canvas, { hole, strokes, ellipse, aim, flight: { t, from, to } \| null, band \| null, palette, units, safe }) -> { a11y, params }`（包 `course/draw2d.js drawHole2d`，加飛行進度與帶狀範圍；`params` 至少 `{ ellipse, band, source, simulated }`） |
| `stage/checks.js` | V5-D | `STAGE_CHECK_PARAMS`；`orientationCheck`、`fpsCheck`、`lightCheck({ lumaFrames, w, h })`、`flickerCheck({ rowMeans })`、`screenInViewCheck({ blocks, pattern })`、`netCheck({ net_m, calibration, handedness })`、`phoneSafetyCheck({ calibration, view })`、`handednessCheck({ players, setupHandedness })` → `Check`；`sampleLuma(video, { w: 64, h: 36 }) -> Uint8Array`（唯一碰 DOM 的函式） |
| `ui/stage.js` | V5-C | `mountStage(el, app, { mode, live }) -> { live(to), quick(r), refined(shot, { quick }), analysing(eta_s), error(code), resume(), destroy() }`；`live` = ui/live.js 給的控制物件 `{ setPlayer({ handedness, kind }), video, retake() }` |

### F.3 投影模式的進出（`nav` 參數）

- 進入：`nav.go('live', { layout: 'stage', stage: 'course', round_id })`（`ui/round.js` 新按鈕 `round-stage`；`ui/course.js` 回合列表每列的「投影」）或 `nav.go('live', { layout: 'stage', stage: 'range' })`（`ui/course.js` 新入口 `course-range`）。
- 沒有練習 session（`app.store.get().session` 為空）時：`nav.go('setup', { next: { screen: 'live', params: <同上> } })`。
- 離開：數字欄底部「結束投影」→ `nav.back()`（回到回合或球場畫面）；回合結束 → `nav.go('scorecard', { round_id })`。

### F.4 shell 內的改動（只有這些；全部計入 §F.7 預算）

| 檔案 | 改動 | 上限（B） | 包 |
|---|---|---|---|
| `ui/live.js` | `show(params)`：`params.layout === 'stage'` → `app.loadStyles('stage')`＋`import('./stage.js')`，把 hero／board 換成 stage；在既有 4 個點轉呼叫 `stage?.live(to)／quick(r)／refined(saved, { quick })／analysing(eta)`；新 `setPlayer({ handedness, kind })`（改 `clipOptions.handedness`、速報輸入、`kind === 'guest'` 時 `onShot` 不存）；投影版面預覽設 `disableRemotePlayback`＋`x-webkit-airplay=deny`；`keydown` 交給 stage | 1,100 | V5-C |
| `ui/setup.js` | 完成時 `nav.go(next.screen ?? 'live', next.params)`（`params.next` 存在時） | 120 | V5-A |
| `session/settings.js` | `FEATURE` 加 `'stage'` | 20 | V5-A |
| 合計 | | **≤ 1,240**（→ shell ≤ 991,354 B，仍留 ≥ 600 B 給 0.5.x 修正） | |

`main.js`、`state.js`、`index.html`、`tokens.css`、core i18n **不改**（stage 的 CSS 由 `ui/stage.js` 自己 `app.loadStyles('stage')`，同 V4 share 的作法）。

### F.5 設定、i18n、lazy 清單

- `settings.stage`（`session/settings.js` 原樣保存，`stage/settings.js` 正規化）；設定 sheet 在投影模式內（`ready` 狀態的「⋯」），不在設定畫面。
- 新 lazy i18n namespace `stage`（兩語系；`namespaces.json` 擁有者 `v5-c: stage`、`v5-d: stage.check`——同一檔案，V5-C 合併）；`LAZY_I18N_NAMESPACES` 加 `stage`。
- `scripts/build.mjs`：`LAZY_GLOBS` 加 `src/stage/*.js`、`src/sim/driver.js`（已被 `src/sim/*.js` 涵蓋，只加註解）、`src/ui/stage.js`；`LAZY_EXACT` 加 `styles/screens/stage.css`。`BUDGETS` 不動。
- `styles/screens/stage.css`：含探針規則 `--lazy-css: stage`（沿用 V4I §3）；只用 vh／cqh 與 `var(--…)` 字級。

### F.6 不改的東西

`golf-shot/2`、`golf-round/1`、原因碼、`store/core.js`（不升 DB 版本）、匯出格式、`viz/**`、`physics/**`、`track/**`、`metrics/**`、`calib/**`、`import/**`、`workers/**`、`course/{model,detmath,generate,styles,validate}.js`。

### F.7 預算

| 項目 | 現在 | 0.5.0 上限 |
|---|---|---|
| shell | 990,114 B | **≤ 992,000 B**（各包合計增量 ≤ 1,240 B，§F.4） |
| precache | 32,221,253 B | **≤ 32,450,000 B**（估計新增：stage 模組 45 KB、`ui/stage.js` 30 KB、`sim/driver.js` 8 KB、CSS 6 KB、i18n 兩語系 20 KB ≈ 110 KB） |
| `BUDGETS` | 1,000,000／35,000,000 | 不變（`git diff -U0 scripts/build.mjs \| grep -c 'BUDGETS = '` → `0`） |

基準檔 `tests/fixtures/v5/budget-baseline.json`（shell 990,114、precache 32,221,253、`caps`：V5-A 140、V5-B 0、V5-C 1,100、V5-D 0）；`node scripts/budget_delta.mjs --baseline tests/fixtures/v5/budget-baseline.json --max <cap>`。

---

## G. 工作包

### G.0 凍結（V5-A drop 1 先落地）

§F.1、§F.2 的簽名（stub 拋 `{ code: 'PACKAGE_PENDING' }`）、`STAGE_DEFAULTS`、`STAGE_STATES`、`KEY_ACTIONS`、§F.3 的 nav 參數、`ctx.owner = 'stage'` 約定、`live.setPlayer` 形狀、
`docs/V05-INTERFACES.md`（同 V4I 格式）、夾具、預算基準、`tests/e2e/run.mjs` 接受 `v5-<x>-*` gate。

### G.1 檔案擁有權（獨占）

| 包 | 名稱 | 可改的檔案 |
|---|---|---|
| **V5-A** | 基礎與整合 | `app/src/stage/settings.js`（新）、`app/src/session/settings.js`、`app/src/ui/setup.js`（只 `next`）、`scripts/build.mjs`、`scripts/make_v5_fixtures.mjs`（新）、`scripts/verify.sh`、`tests/e2e/{run,lib,checks,screenshot_matrix}.mjs`、`tests/e2e/gates/v5-a-*.mjs`、`tests/fixtures/v5/**`、`tests/unit/{appcore.v5,stage.settings}.test.mjs`、`app/i18n/namespaces.json`、`package.json`、`docs/{V05-INTERFACES,device-checklist,setup-guide,e2e-hooks}.md` |
| **V5-B** | 回合驅動與練習場模型 | `app/src/sim/driver.js`（新）、`app/src/ui/round.js`（改用 driver、`round-stage` 按鈕、`owner` 過濾、`updated_at` 重載）、`app/src/ui/course.js`（入口 `course-range`、列表「投影」）、`app/src/stage/range.js`（新）、i18n `sim course`、`tests/unit/{sim.driver,stage.range,ui.sim.*}.test.mjs`、`tests/e2e/gates/v4-d-*.mjs`（只准修因 driver 抽出的選擇器，不准放寬） |
| **V5-C** | 投影畫面與流程 | `app/src/ui/stage.js`（新）、`app/src/stage/{flow,keys,draw}.js`（新）、`app/src/ui/live.js`、`app/src/quick/estimate.js`（只加 `poseUsable`）、`app/styles/screens/stage.css`（新）、i18n `stage`（合併 V5-D 的 `stage.check.*`）、`tests/unit/{stage.flow,stage.keys,stage.draw,stage.honesty,quick.estimate}.test.mjs`、`tests/e2e/gates/v5-c-*.mjs` |
| **V5-D** | 室內檢查 | `app/src/stage/checks.js`（新）、`tests/unit/stage.checks.test.mjs`、`tests/fixtures/v5/checks/**`（合成亮度、條紋、校正樣本）、`docs/research/indoor-params.md`（新：門檻來源與 UNVERIFIED 清單）；`stage.check.*` 字串交 V5-C 合併 |

規則同 V4 §G.1：§F.6 列的目錄任何包都不准改；跨包只透過 §G.0 凍結的介面。

### G.2 共通驗收（每包）

`bash scripts/verify.sh` → `all stages passed`；`node scripts/check_i18n.mjs --strict --quiet`、`check_tokens --strict`、`check_brands` 退出碼 0；
`node scripts/budget_delta.mjs --baseline tests/fixtures/v5/budget-baseline.json --max <該包 cap>` → `SHELL DELTA … OK`；`node scripts/check_contract.mjs` 仍含 `(47 reason codes;`。

### G.3 各包驗收（機械判定）

**V5-A**
1. `node --test tests/unit/stage.settings.test.mjs`：缺值／壞值正規化成 `STAGE_DEFAULTS`；`autoAcceptS` 只接受 0 或 2–10。
2. `node --test tests/unit/appcore.v5.test.mjs`：§F.2 每個檔案存在、`isLazyPath` 為真、匯出名齊全；`dist/` 的 modulepreload 清單不含任何 `stage/`。
3. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only v5-a-shell` → PASS：`nav.go('setup', { next })` 完成後落在 `live` 且 params 相同；`stage.css` 探針在 `mountStage` 完成前已套用。
4. `node scripts/make_v5_fixtures.mjs --check` 退出碼 0（`tests/fixtures/v5/driver-golden.json`：用 **0.4.0 `ui/round.js` 路徑**產生的 3 個回合＋輸入序列；`stage-swings.json`：沿用 `quick-swings.json` 的 20 揮＋玩家輪替）。

**V5-B**
1. `node --test tests/unit/sim.driver.test.mjs`：`driver-golden.json` 每個回合的 canonical JSON sha256 與 0.4.0 金檔相同；`undoLast` 後與「沒打那一桿」相同；下一桿開打後 `canUndo() === false`；`club_source` 在 `setClub` 前後正確。
2. `node --test tests/unit/stage.range.test.mjs`：`rangeHole` 通過 `drawHole2d`（假 canvas）；`rangeMark` 逐列：face_on 速報 → `band`、hb 240 → `point`、dtl／hb 速報 → `none`＋原因；任何輸出不含 `valid` 有效性。
3. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only 'v4-d-*'` 全 PASS（driver 抽出不退步）。
4. `--only v5-b-owner` → PASS：回合畫面已掛載時，以 `owner: 'stage'` 送 `app.sim.submit` → `rounds` store 該回合 strokes 只多 1 筆；從投影模式回來 `round` 畫面的 `data-stroke-n` 等於 IDB 值。

**V5-C**
1. `node --test tests/unit/stage.flow.test.mjs`（假時鐘）：§B.4 每個轉移各一例；倒數 4 s 後自動計入恰 1 次；倒數中 `retake` → 不計桿回 `ready`；`autoAcceptS = 0` 時只有 `confirm` 會計入；練習揮桿不產生計桿；`refined` 不改落點；`undo` 只在下一桿前有效。
2. `node --test tests/unit/stage.keys.test.mjs`：兩個設定檔的對應表逐鍵；`repeat: true` 忽略；`B`／`.` → `import`。
3. `node --test tests/unit/stage.honesty.test.mjs`：錄製型假 canvas＋假 DOM 跑 `stage-swings.json` 全部 `quick`／`landed`／`holedone` 狀態：每個距離／速度字串旁有 `±` 或範圍、每桿有來源字樣；`stage` 兩語系 catalog 不含「實測」「measured」與 `accuracy-claim` 模式；`drawStage` 的 `params.ellipse === true`（course）、range face_on 時 `band === true` 且 `simulated` 落點數 0。
4. `node --test tests/unit/quick.estimate.test.mjs`：`poseUsable: false` → `club_speed_mps` null＋`VIEW_PLANE_MISMATCH`、carry origin 為 prior；未給時與 0.4.0 輸出相同。
5. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only v5-c-round` → PASS（沿用 `v4-b-latency` 的 stand-in 姿勢 seam 與假相機）：2 人（1 右 1 左訪客）9 洞 links #42，`autoAcceptS = 2`，**整輪零 pointer 事件**；`scorecard` 總計等於 strokes 推導；
   左打訪客的揮桿：速報輸入 `handedness === 'left'`、`shots` store 筆數只增加擁有者的揮桿數；診斷 `live.touches_per_shot === 0`。
6. `--only v5-c-keys` → PASS：以 `page.keyboard` 送 PageDown／PageUp／ArrowUp：計入、重打、換桿各生效；`retake` 後 `rounds` strokes 數不變。
7. `--only v5-c-capture` → PASS：投影版面（小窗開與關）下 frame tap 實際 fps 與一般 live 版面差 ≤ 10%；預覽 `<video>` 的 `disableRemotePlayback === true` 且有 `x-webkit-airplay="deny"`。
8. `--only v5-c-readability` → PASS（844×390、932×430、667×375，兩語系）：每個狀態所有可見文字 `font-size / stage 高度` ≥ 0.065、`[data-stage-num]` ≥ 0.13、`[data-stage-hero]` ≥ 0.20；
   文字元素的外框全在標題安全框內（四邊 `max(5%, safe-area)`）；`contrastOfRendered` 文字 ≥ 7.0；`noHScroll`；三個主題下 stage 背景色相同。
9. `node tests/e2e/screenshot_matrix.mjs --screens stage:check,stage:intro,stage:handoff,stage:ready,stage:swing,stage:quick,stage:refined,stage:landed,stage:holedone,stage:import,stage:paused,stage:finished,stage:range,stage:range-dtl,stage:portrait,stage:safe` → 0 findings
   （`stage:safe` 畫四角標記與安全框，給實機 D4 對照；`stage:portrait` 390×844）。
10. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only 'v4-b-*'` 與 `m5` 不退步（非投影 live 行為不變）。

**V5-D**
1. `node --test tests/unit/stage.checks.test.mjs`：合成夾具——亮度與雜訊（低雜訊 ok、高雜訊 warn）、逐列條紋（120 Hz 條紋 warn、無條紋 ok）、`screen_in_view`（注入同步區塊 → warn 且回傳區塊；無同步 → `unknown`）、
   `netCheck`（給定 f／W／cx／D 算 `x_edge`，邊界兩側各一例；左打鏡像）、`phoneSafetyCheck`、`handednessCheck`、`orientationCheck`；所有門檻來自 `STAGE_CHECK_PARAMS` 且有 `version`。
2. 純度：`stage/checks.js` 除 `sampleLuma` 外不碰 `document`／`window`（grep 測試）。
3. `docs/research/indoor-params.md` 列出每個門檻、來源、「UNVERIFIED → 實機 D8／D9／D13」。

### G.4 順序與整合

1. V5-A drop 1（§G.0＋stub＋夾具＋基準）。
2. 並行：V5-B（driver 先、畫面後）、V5-D（純模組）、V5-C（`flow`／`keys` 先，`ui/stage.js` 用 driver stub 與夾具）。
3. V5-A 整合 commit：移除 stub、`package.json` `0.5.0`、`LAZY_*` 最終清單、`V05-INTERFACES.md` 狀態欄。
4. **fresh-context 驗收**（實作者不自驗）：`RUN_BROWSER_E2E=1 bash scripts/verify.sh` → `all stages passed`；完整截圖矩陣（既有＋§G.3 V5-C-9）0 findings；
   `dist/precache-manifest.json` `shell_bytes ≤ 992000`、`precache_bytes ≤ 32450000`；`check_brands --root dist` 與 `--root .` 皆 0；`version` 以 `0.5.0+` 開頭。
5. 實機清單 §H 交給擁有者；**實機結果不足時不改目標，照實記錄**。

---

## H. 實機清單（只有 iPhone＋電視／投影機能證明；寫進 `docs/device-checklist.md`，編號接 U26 之後）

| # | 項目 | 怎麼做 | 通過／記錄 |
|---|---|---|---|
| D1 | AirPlay 鏡像時相機與分析照常 | 鏡像到電視打 20 球 face_on，對照不鏡像 20 球 | 診斷 fps、`live.quick.latency_ms_p50/p95` 與不鏡像差 ≤ 20%；記錄鏡像延遲（用另一支手機 240 fps 同時拍手機與電視，數幀差） |
| D2 | 轉接器（Lightning／USB‑C → HDMI）同上＋充電 | 接轉接器並充電 30 分鐘 | 同 D1；P18 過熱降級次數；電量變化 |
| D3 | 預覽 `<video>` 沒被送去 AirPlay | 開鏡像進投影模式 | 電視顯示整個投影版面（不是只有相機畫面） |
| D4 | 過掃描與安全框 | `stage:safe` 狀態（開發者頁可進），在擁有者的電視／投影機上看四角 | 四角標記都看得到；記錄裁切比例 |
| D5 | 3／5 m 可讀 | 兩種顯示器（記錄尺寸），3 m 與 5 m 讀出 10 個數字 | 全對；看不清的層級記錄下來 |
| D6 | 藍牙遙控 | 開發者頁的按鍵測試（列出收到的 `key`／`code`）：附贈的音量鍵遙控、簡報器、鍵盤 | 記錄每個裝置收到什麼（預期音量鍵遙控什麼都沒有） |
| D7 | 0 觸碰整輪＋架設時間 | 2 人 9 洞投影模式；從進房間到第一桿計時 | `touches_per_shot = 0`；架設 ≤ 5:00（n ≥ 5 的 P90）；總時長記錄 |
| D8 | 暗光 | 三種照明（一般燈、加一盞投光燈、白天窗邊），記錄照度（照度計 App，數字僅供參考）、`light`／`flicker` 檢查值；各匯入 10 支 240 fps | 球速非 null 比例、即時 fps；用來校正 `STAGE_CHECK_PARAMS` |
| D9 | 網距與反彈 | 網在 2.0／2.5／3.0 m 各 10 球 | 反彈球造成的多餘擊球偵測次數（應為 0）、`net` 檢查是否合理 |
| D10 | 240 路徑往返 | 投影模式 → 相機 App 錄 → 回來匯入 → 回投影 | 是否重問相機權限、投影是否自動恢復、觸碰次數、每桿總秒數 |
| D11 | 通知不上電視 | 鏡像中請人傳訊息 | 電視上不出現 |
| D12 | 螢幕常亮 | 鏡像＋投影 30 分鐘不碰 | 不鎖定、不變暗 |
| D13 | 手機安全位置 | face_on 依 `phone_safety` 建議擺；打 30 球含刻意打偏 | 手機未被打到；記錄最接近的一次 |
| D14 | dtl／high_behind 背景有投影 | 投影幕在畫面背景打 20 球 | 擊球誤偵測次數；`screen_in_view` 是否抓到 |

---

## I. 第二台裝置顯示（評估；0.5.0 不做，0.5.x 先 spike）

**做法**：手機照常拍；同一 Wi‑Fi 上的 iPad／筆電（筆電接投影機是最常見的家用布置）用瀏覽器開本 App 的接收頁，以 WebRTC DataChannel 收「投影狀態」，
自己用同一套 `ui/stage.js`／`stage/draw.js` 畫。只傳狀態（JSON：洞的幾何一次 ≈ 8 KB、每桿 ≤ 2 KB），**不傳影像**。

**無伺服器的信令（QR）**：
1. 手機產生 offer（精簡 SDP：ufrag、pwd、指紋、host 候選；≈ 200–300 B）→ 投影版面顯示 QR；接收端用自己的相機掃（接收頁要相機權限——這同時讓 WebKit 給出 host 候選，§0.2）。
2. 接收端產生 answer → 顯示 QR → **把 iPad／筆電拿到腳架上手機的鏡頭前**，手機用正在跑的預覽幀解碼（不用動手機）。
3. 備援：同一 Apple ID 的通用剪貼簿（手機複製 offer、Mac 貼上，反向亦同；離線是否可用 **UNVERIFIED**）。

**評估**：原理可行，好處是電視不受鏡像延遲、黑邊與過掃描影響，手機畫面可留給拍攝。未證實、必須實機證明的：

| # | 未證實項目 | spike 怎麼證 |
|---|---|---|
| S1 | iPhone 主畫面 PWA（相機開著）↔ iPad Safari／筆電 Chrome，在**沒有網際網路的路由器**上只靠 host 候選連得上 | 連線成功率 10/10、建立時間 |
| S2 | 接收端沒有相機權限時（電視瀏覽器）是否完全連不上 | 預期連不上 → 電視瀏覽器不支援，寫明 |
| S3 | 手機從預覽幀解 QR 的距離與成功率 | 30–60 cm、3 種光線 |
| S4 | 30 分鐘不斷線；手機鎖定或切 App 後重連 | 斷線次數、重連步驟 |
| S5 | Wi‑Fi 用戶端隔離（訪客網路）、iPhone 個人熱點 | 記錄 |
| S6 | QR 編解碼器的授權與大小（lazy；iOS 無 BarcodeDetector） | 選定 MIT／Apache‑2.0 實作，precache 增量；超過 §F.7 上限時另開預算決定 |

若 S1–S4 通過：0.5.x 加 `stage/link.js`（`createLink({ role: 'host'|'display' }) -> { offerQR(), acceptAnswer(text), onState, send(state) }`）與接收頁 `app/display.html`（lazy、同源、需曾在線上開過一次才能離線用）。
不通過：維持鏡像方案，把 spike 結果寫進本節。

---

## J. 風險

| 風險 | 影響 | 對策／溝通 |
|---|---|---|
| 鏡像延遲（AirPlay 可能數百 ms，**UNVERIFIED**） | 速報在電視上更晚出現 | 有線轉接器列為建議；D1／D2 實測照實寫進說明 |
| 鏡像＋相機＋姿勢推論發熱、耗電 | 降幀、P18 降級、中途沒電 | 建議可充電的轉接器；`paused` 狀態講原因；D2 |
| 相機預覽隱藏後停止送幀 | 偵測不到揮桿 | 預覽永遠保持可見尺寸（§B.3）；`v5-c-capture`；D1 |
| `<video>` 被 AirPlay 搶走 | 電視只剩相機畫面 | `disableRemotePlayback`＋`x-webkit-airplay=deny`；D3 |
| 自動計入錯誤的揮桿（例如碰到墊子） | 多一桿 | 倒數＋重打鍵；撤銷鍵；無遙控時只能觸碰（寫明） |
| 打別支球桿卻沒換 | 速報與模擬落點錯 | 球桿字樣常駐＋語音；換桿鍵；不宣稱能辨識球桿 |
| 室內暗光：240 fps 拖影、即時降幀 | 球速 null、速報變差 | `light`／`fps`／`flicker` 檢查；建議補光；不把暗光下的結果包裝成正常 |
| 左右打混組 | 背面看不到姿勢 | §C.4：該玩家改用距離表並明講；或換機位 |
| 訪客揮桿寫進擁有者紀錄（0.4.0 既有問題） | 距離表被污染 | §C.4 修正＋`v5-c-round` 檢查 |
| 投影在相機畫面裡（dtl／hb） | 誤偵測、慢動作追球干擾 | 建議 face_on；`screen_in_view`；D14 |
| 球打到手機 | 設備損壞 | `phone_safety` 檢查與說明；D13 |
| shell 只剩 1,886 B | 超預算建置失敗 | §F.4 每檔上限；邏輯全放 lazy |
| 240 路徑觸碰多、每桿 ≥ 45 s | 多人時節奏差 | 明講是「精算選項」，主要玩法是速報；不宣稱 0 觸碰 |

---

## K. 擁有者決定（每項附建議預設；未回覆即用預設開工）

| # | 問題 | 建議預設 | 理由 |
|---|---|---|---|
| Q1 | 速報出來後幾秒自動計入？ | **4 秒**（設定可改 0／2–10；0＝一定要按確認鍵） | 夠時間按「重打」，又不拖節奏；0 秒以外才做得到每桿 0 觸碰 |
| Q2 | 室內練習場在 dtl／high_behind 即時模式要不要畫落點？ | **不畫**，只顯示揮桿數字並說明 | 那兩個機位的距離只是你的距離表，畫成「這一球的落點」會誤導 |
| Q3 | 投影上要不要顯示相機小窗？ | **顯示**（可關；關閉時仍保持極小可見以維持送幀） | 球員能看到自己是否在畫面內；有旁人時可關 |
| Q4 | 要不要買藍牙簡報器／鍵盤當遙控？ | **先不買**；D6 證實腳架附的音量鍵遙控在網頁無效後再決定 | 預設流程不需要遙控；遙控只用在重打／換桿／撤銷 |
| Q5 | 第二台裝置顯示（WebRTC＋QR） | **0.5.0 不做**；0.5.0 實機清單通過後做 spike（§I S1–S6） | 未證實的部分多，且需要額外的 QR 函式庫預算 |
