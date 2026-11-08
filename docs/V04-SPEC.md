# Golf Swing Lab 0.4.0 — 產品＋工程規格（V04-SPEC v1，2026-11-07）

> 給實作 agent 的派工規格。Repo：`/home/simon/Desktop/golf-swing-lab`（0.3.0 工作樹，Node 18、純 ES modules、無打包工具，
> 驗證入口 `bash scripts/verify.sh`）。前一版規格：`docs/LAUNCH-MONITOR-SPEC.md`（下稱 **LMS**）、凍結介面 `docs/LM-INTERFACES.md`（**LMI**）。
> 規範用語 MUST／SHOULD 同 RFC 2119。「機械判定」＝在 `bash scripts/verify.sh` 或 `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs` 印 PASS/FAIL，不需要人判斷。
> **本檔一律稱對手為「競品」，任何檔案（含本檔）不得寫出其名稱或其功能名**（§I 的機械檢查只用字元類寫法 `golf[r]`）。

## 0. 擁有者裁示與硬約束

| 來源 | 內容 |
|---|---|
| 11-07 裁示 1 | 四項全做：**模擬球場**、**軌跡影片分享**、**揮桿實驗室**、**秒出數據** |
| 11-07 裁示 2 | 球場只用**原創**：少數手工設計的洞型風格＋程序產生器（有種子、可重現）；不做任何真實或授權球場 |
| 11-07 裁示 3 | 沒有真的發射監測器：維持「估計 ± 誤差」標示；**產品內不得出現任何「準確率 xx%」行銷說法** |
| 沿用 LMS §0 | 單機單機位（face_on／dtl／high_behind）；即時 30–60 fps 只給姿勢／tempo／事件（face_on 另有桿速「低」）；球速／發射角只來自匯入的 240 fps；`measured` 永遠 false；契約不變式（非 null 必有 ci95 或 sigma、null 必有原因碼、每碼有 zh-Hant＋en 說明） |
| 法務 | 不加 AGPL、Ultralytics、OpenCV.js；GolfDB 衍生物不進產品；不對外部網域發請求；不抄競品功能名、吉祥物、配色或版面 |
| 預算 | shell ≤ 1,000,000 B（目前 974,810 B，**剩約 25 KB**）；precache ≤ 35,000,000 B（目前 31,876,741 B）。**不准提高 `BUDGETS`**；新程式碼與新畫面 CSS 一律 lazy |
| lint | `check_i18n --strict`（app/src 0 個 CJK 字面值）、`check_tokens --strict`（JS hex 禁用）、新增 `check_brands`（§I） |
| 語系／主題 | zh-Hant＋en；dark（預設）／light／sun 三主題全部要過對比與截圖矩陣 |

### 0.1 對競品的勝出策略（產品定位，一頁說完）

| 競品宣稱 | 我們的做法 | 勝出點（必須做到） |
|---|---|---|
| 虛擬球場、1–4 人、洞前飛越、記分卡 | §C：3 種原創風格＋種子產生器、9／18 洞、1–4 人輪流、飛越、記分卡、依自己距離表推薦球桿 | 落點畫**不確定範圍橢圓**；每一桿標資料來源（量到／推估／抽樣／手動）；完全離線、免帳號 |
| 每球發射數據、最遠距離、方向散佈、分享卡 | 既有 36 項＋§D 分享卡 | 分享卡的每個數字都帶 ±；散佈分「量得到的」與「量不到的」；散佈小於量測誤差時明講 |
| 軌跡精華影片、自訂顏色、一鍵分享 | §D：合成影片（原片＋球軌跡＋桿頭／手部軌跡＋數據卡），色盤選擇 | 偵測段實線、模擬延伸點線（不冒充）；色盤通過對比檢查；可選臉部馬賽克；無浮水印 |
| 揮桿分析：6 條對齊線、分段、逐幀找問題、趨勢、修正影片 | §E：每機位 ≥6 條對齊線、8 事件分段、11 個問題規則、趨勢、站內練習卡 | 每條線、每個問題都依 F2 機位表判定「看得到才講」；給信心與原因碼；不連外部影片 |
| 「揮完 0.2 秒出數據」 | §A：兩段式（速報 → 精算），實測延遲寫進診斷 | 不喊未量測的數字；速報值清楚標「速報」並附範圍，精算後顯示差異 |
| 「九成發射監測器準確度」（未經查證） | 不做任何準確率宣稱 | §I 機械檢查：i18n 不得出現「準確＋百分比」字串 |

保留的優勢（每個工作包都不得破壞）：更多指標＋誠實誤差、Android＋iOS（PWA）、全離線、免帳號、資料只在手機。

---

## A. 秒出數據（兩段式結果）

### A.1 延遲的真實下限（iPhone 12、Safari PWA；數字全部 UNVERIFIED，轉實測見 A.5）

現行流程（CAFCR P4、`pipeline/live.js`）在 FINISH（擊球後手腕靜止 ≥ 0.7 s）才切段、補跑全幀率分析，KD4 為 P95 ≤ 8 s。
速報改成在**偵測到擊球（IMPACT）當下**就用已經跑過的 30 Hz 手腕樣本算，不等 FINISH、不重新解碼。

| 環節 | 估計耗時 | 說明 |
|---|---|---|
| 擊球聲 → AudioWorklet onset | 5–25 ms | 128 樣本量子 2.7 ms＋音訊管線 |
| 撞擊後所需最後一幀（`POSE_CLUB_WINDOW_S` 到 +0.02 s）到達 JS | 50–100 ms | 幀間隔 17–33 ms＋相機到 `requestVideoFrameCallback` 的管線延遲 |
| 該幀 lite 姿勢推論 | 20–45 ms | worker 內；佇列無積壓的前提 |
| 速報計算（tempo、桿速、carry 查表） | ≤ 5 ms | carry 用預算表內插（A.3），不在現場跑 RK4／MC |
| DOM 更新＋下一次繪製 | 16–33 ms | 一個 rAF |
| **合計** | **≈ 0.1–0.2 s（最佳）／0.3–0.6 s（一般）** | 佇列積壓、降溫降級（P18）時更久 |

**「0.2 s」需要什麼**：音訊確認擊球（不是等手腕峰值）＋撞擊前後所有影格的姿勢在 0.1 s 內已算完（無積壓）＋零重算＋立即繪製。
在 web 上，相機到 JS 的幀延遲與 WebKit 排程我們控制不了，**0.2 s 只在最佳情況、只對 tempo 與桿速可能成立，不能當成 P95 承諾**。
決定：**目標 P50 ≤ 0.5 s、P95 ≤ 1.0 s（實機）**；產品裡不寫任何秒數宣傳，只在診斷報告與「關於」顯示**本機實測**的 P50／P95。

### A.2 兩段式內容

| 階段 | 時間 | 內容 | 標示 |
|---|---|---|---|
| 速報 `provisional` | IMPACT 後 ≤ 1 s | `backswing_s`、`downswing_s`、`tempo_ratio`（30 Hz 手腕樣本的事件時間）；`club_speed_mps`（face_on，`clubSpeedFromPose`，±25% 以上）；`carry_m`（face_on：桿速 × smash 先驗 × 發射角先驗 → 查表，再與自己距離表合併；dtl／hb：只有距離表先驗，見 §B） | 每磚加「速報」字樣（`quick.provisional`）＋ ± 範圍；validity 最高 `low_confidence`；原因碼含 `PROVISIONAL` |
| 精算 `refined` | 現行（KD4 P95 ≤ 8 s） | 現行完整 shot（全幀率姿勢、事件規則、registry 全部格子） | 速報卡原地轉成精算；有變動的數字顯示「速報 41 → 精算 43」一次（2 s 後淡出；reduced-motion 直接換） |

- 速報值**不寫進 golf-shot**（不污染統計）；只寫進診斷 `live.quick_log` 與（模擬球場中）該桿的 round 紀錄（§B）。
- 若精算值落在速報 ci95 外 → 診斷 `quick.miss += 1`（用來監控速報是否過度自信）。
- 設定 `settings.quick.enabled`（預設開）；關掉時行為與 0.3.0 完全相同。

### A.3 模組與介面（V4-B 擁有）

- `events/live.js`：在進入 IMPACT 時多發一個事件 `{ type: 'impact', t_impact, impact_source, t_address, t_swing, t_top, peak_mps, conf, reason_codes }`；
  **既有 `shot` 事件的時間與語意不變**（m5 gate 不得退步）。`t_top` = SWING 期間手腕高度最大的樣本時間。
- `pipeline/live.js`：新增選項 `onProvisional(r)`、`quick`（lazy 模組物件）；收到 `impact` 後等到第一個 t ≥ t_impact + 0.02 s 的手腕樣本，呼叫
  `quick.quickEstimate(...)`；在 `live.quick_log` 記 `{ t_impact, t_ready_media, t_paint_perf, latency_ms }`。
- `app/src/quick/estimate.js`（新，lazy）：
  `quickEstimate({ samples, impact, view, fps, club, handedness, calibration, gappingRow|null, settings }) -> QuickResult`
  `QuickResult = { stage: 'provisional', t_impact, metrics: { <id>: Metric }, carry_source: 'pose'|'gapping'|'reference'|null, timings_ms }`
  （Metric 形狀同契約；validity 只會是 `low_confidence` 或 null）。
- `app/src/quick/carry-table.js`（新，lazy，產生的資料）：每支 `BALL_CLUB_IDS` 球桿 × 球速 20–80 m/s（每 2 m/s）× 發射角先驗的 carry 中心值與 1σ，
  由 `scripts/make_carry_table.mjs`（V4-B 擁有）用 `physics/lm/flight.js fly` 以 `LM_PARAMS` 產生；`--check` 模式比對誤差 ≤ max(1.0 m, 1%)。
  表頭記 `LM_PARAMS.version`，版本不符時 `--check` 失敗（模型改了必須重產）。
- `app/src/ui/quickcard.js`（新，lazy；live 畫面在開始練習時預先 `import()`，不在 boot graph）：`mountQuickCard(el, app) -> { provisional(r), refined(shot), clear() }`。

### A.4 誠實要求

- 速報 carry 在 face_on 的 1σ 約 30–35%（桿速 ±25% 傳過去再加 smash／發射角先驗），UI MUST 畫出範圍；dtl／hb 速報 carry 是「你的距離表」，
  磚上寫「距離表」而不是「量到」。
- 不顯示速報的球速、發射角、spin（即時模式量不到，維持 null）。

### A.5 驗收（實機部分寫進 `docs/device-checklist.md`）

實機（擁有者 iPhone 12，20 球 face_on）：診斷報告 `live.quick.latency_ms_p50 ≤ 500`、`_p95 ≤ 1000`；達不到時**不改目標、照實記錄**並開問題單。

---

## B. 模擬用的擊球資料來源（決定）

### B.1 來源優先序與標示

每一桿在模擬中需要 carry 與 side（相對瞄準線，+＝遠離球員，同 LMI §1 符號）。`sim/source.js` 依下表**逐維度**決定，兩個維度可以來自不同來源：

| 來源 | carry | side | validity | 原因碼（至少） |
|---|---|---|---|---|
| 匯入 240 fps face_on | `carry_m`（估） | 量不到 → 抽樣（B.2） | carry 估；side 低 | side：`LAUNCH_DIR_UNOBSERVABLE`＋`SIDE_SAMPLED` |
| 匯入 240 fps high_behind | `carry_m`（低） | `carry_side_m`（低） | 低 | 沿用該 metric 的碼 |
| 即時 face_on（速報） | 姿勢桿速 → 查表 carry，與自己距離表**反變異數合併** | 抽樣 | 低 | `PROVISIONAL`、`SMASH_ASSUMED`、`LAUNCH_V_ASSUMED`、`FLIGHT_MODELLED`、`GAPPING_PRIOR`（有合併時） |
| 即時 dtl／high_behind | 距離表先驗（該球桿中位數、P10–P90） | 抽樣 | 低 | `GAPPING_PRIOR` 或 `REFERENCE_PRIOR`；`SIDE_SAMPLED` |
| 手動輸入 | 使用者輸入 | 使用者輸入（可空 → 抽樣） | `estimated`，ci95 可為 null | `MANUAL_ENTRY` |
| 自動推桿／自動切桿 | 模型 | 模型 | `estimated` | `AUTO_PUTT`／`AUTO_CHIP` |

- **距離表先驗**＝`store/stats.js gapping()` 的該球桿列（n ≥ 5；預設只用 face_on，與 Gapping 畫面同設定）。n < 5 或訪客 → `REFERENCE_PRIOR`：
  `practice/drills.js REFERENCE_CARRY_M` 依該玩家輸入的 driver carry 等比縮放，1σ = 12% carry（UNVERIFIED，參數在 `sim/params.js`）。
- **合併**（face_on 即時）：`c = (c_pose/σp² + c_gap/σg²)/(1/σp² + 1/σg²)`，σ 同理；詳情 sheet 列出兩個輸入與權重。
- validity 永遠不會是 `valid`；`measured` 不適用（round 紀錄沒有這個欄位，但 UI 不得用「實測」字樣描述任何模擬落點）。

### B.2 量不到的 side：抽樣，不是假裝直球

- 預設 `settings.sim.unobservedSide = 'sample'`：從 N(μ, σ) 抽一次，μ、σ 來自自己 high_behind 該球桿紀錄（n ≥ 10 時用 `summarize()` 的 mean 與 `sd_est`，`indistinguishable` 時退回參考值），
  否則參考值 σ_side = 0.06 × carry（driver 0.08；UNVERIFIED）。用回合種子＋桿序的 `mulberry32`，可重現。
- 選項 `'center'`：side = μ（練習用；記分卡標「直球模式」）。
- 地圖上永遠畫 **95% 落點橢圓**（carry σ × side σ，依球位放大），抽到的落點畫成實心點並標「模擬」。

### B.3 手動輸入（決定：做，只用在模擬球場）

理由：(1) 有其他量測來源（練習場螢幕、別人的設備）的使用者可以直接打模擬；(2) 相機不可用時（沒腳架、光線差）模擬仍能進行；(3) e2e 需要確定性輸入。
限制：手動數字**只存在 round 紀錄**，不產生 golf-shot，不進統計／距離表／趨勢；每桿標「手動」。手動修正也用在「這球打壞了」（自動估計明顯不符時，使用者改成實際看到的結果）。

### B.4 進行中的球：只用速報、不回頭改位置

模擬一律用**速報**（或匯入／手動的最終值）決定落點，精算結果只更新該 golf-shot 與統計。理由：精算在 2–8 s 後才到，若改動球位，
輪流打的下一位玩家可能已經在打，位置跳動會讓記分不可重現。round 紀錄同時存 `shot_id`（精算後的 golf-shot）以便事後對照。

---

## C. 模擬球場

### C.1 洞的模型（`golf-round/1` 內的 `Hole`，座標單位 m，平面座標 x 東 y 北，z 上）

```
Hole = { n, par: 3|4|5, style, template: string|null, length_m, tees: { forward:[x,y,z], middle:[x,y,z], back:[x,y,z] },
         pin: [x,y], green: { poly, z, slope_pct },            // slope 只影響自動推桿難度係數，不做地形
         fairway: [poly…], bunkers: [poly…], water: [poly…], trees: [[x,y,r,h]…], bounds: poly,  // bounds 外 = OB
         centerline: [[x,y]…],                                  // 推薦瞄準點用
         elevation: { tee_z, green_z } }                        // 決定：只做「整洞一個斜面」，不做起伏地形
poly = [[x,y]…]（≤ 24 點，0.1 m 量化）；每洞多邊形 ≤ 30、樹 ≤ 60。粗草 = bounds 內不屬於其他區域的部分。
```

球位判定順序：OB（bounds 外）→ 水 → 沙坑 → 果嶺 → 球道 → 粗草。

### C.2 產生器與風格（決定）

- 3 種原創風格：`parkland`（林間：樹列夾道、少水）、`links`（海風：開闊、多沙坑、無樹、球道起伏寬）、`desert`（荒漠：島狀球道、大片荒地＝粗草加重懲罰）。
  每種風格**手工設計 7 個洞型模板**（par3 ×2、par4 ×3、par5 ×2），模板是資料（控制點、危險區相對位置、參數範圍），存 `app/src/course/styles.js`。
- 產生器 `generateCourse({ seed, style: 'parkland'|'links'|'desert'|'mixed', holes: 9|18, tees }) -> Course`：
  依種子挑模板並在參數範圍內變形（狗腿角、長度、沙坑位置）。18 洞 par 組合固定 4×par3＋10×par4＋4×par5（par 72）；9 洞 2／5／2。
- **跨引擎可重現**：JS `Math.sin/cos` 在 V8 與 JavaScriptCore 不保證逐位相同，所以 `course/**` MUST 只用 `+ − × ÷ sqrt` 與自寫的多項式 `sin/cos`（`course/detmath.js`），
  輸出量化到 0.1 m。產生器版本 `COURSE_GENERATOR = 'course-1'`；**round 存整份幾何快照**，所以日後改產生器不會改壞舊回合。
- `validateCourse(course) -> { ok, problems[] }` 規則：par 長度（middle tees）par3 90–200 m、par4 250–420 m、par5 420–530 m；果嶺不碰水；
  pin 距果嶺邊 ≥ 3 m；從 tee 到 pin 沿 centerline 存在至少一個 ≥ 25 m 寬的球道落點區（給 `REFERENCE_CARRY_M.driver`）；危險區不覆蓋 centerline 的 > 35%；多邊形不自交。
- tees：forward／middle／back 長度係數 0.85／1.0／1.12。

### C.3 規則與擊球結果（`sim/engine.js`、`sim/lies.js`、`sim/rules.js`，參數集中在 `sim/params.js` 並帶 `version`）

| 項目 | 決定（UNVERIFIED 經驗值，皆可調） |
|---|---|
| 球位對下一桿 | 球道／tee ×1.00；粗草 carry ×0.90、σ ×1.3（木桿 ×0.85）；球道沙坑 ×0.85（木桿 ×0.70，推薦不給 driver）；果嶺旁沙坑（距 pin ≤ 30 m）照常揮桿或自動切桿 |
| 高低差 | 落點 = 飛行軌跡與斜面的交點：有 `flight.samples`（匯入球）用樣本線段求交；否則用 `Δcarry = −Δz / tan(落地角先驗)`。**更正（整合）**：樣本本身不存進 round，存的是它的形狀 `draw.apex_m`／`draw.land_deg`（`flightShape`，schema 選填欄位），斜面、樹高、滾動都用它，重演可重現 |
| 滾動 | `physics/lm/roll.js rollFrac(落地角, ground)`；粗草 ×0.35、沙坑／水 0、果嶺用 `soft` |
| 樹 | 飛行路徑任一點落在樹圓內且 z < h → 球停在該點正下方（不滾），標「打到樹」 |
| 水 | +1 桿，從入水點沿來球線退回最近的非水區 2 m 處 |
| OB | 預設 `drop_2`：+2 桿，從出界點最近的球道邊打（簡化版，等同現行規則的當地規則選項精神）；選項 `stroke_distance`（+1，回原位重打）。**更正（整合）**：拋球點（球道內 1 m）若落在果嶺上就換下一個候選點；都不行時用出界點本身（若是粗草），否則回原位 |
| 每洞上限 | 預設 2×par（達到即撿起）；可關 |
| 推桿（決定：距離模型自動推桿，不做點擊小遊戲） | 上果嶺後依距離 d 與「推桿程度」（`0／10／20／30` 差點帶）抽樣：一推進洞機率 `p(d) = clamp(exp(−(max(0, d − 0.45)/(d50 − 0.45))^1.3·ln2), 0.02, 0.995)`（**更正（整合）**：加了 0.45 m 的 tap-in 距離 `tap_in_m`，讓 0.5 m 一推率 ≥ 0.95 的驗收在各程度成立；UNVERIFIED），d50 依程度 2.4／1.8／1.4／1.1 m；未進則剩餘距離 \|N(0, 0.08 d + 0.25)\|；每洞最多 4 推（UNVERIFIED，`sim/putting.js`）。理由：鏡頭量不到推桿；點擊小遊戲量的是手指不是推桿，又要多 10+ KB UI。另提供「手動輸入推桿數」覆寫（標 `MANUAL_ENTRY`） |
| 切桿 | 預設每桿都要揮；`settings.sim.autoChipM`（預設 0＝關，可設 10–40 m）以內可按「自動切上果嶺」：落點距 pin \|N(0, 0.12 d)\|＋程度修正，標 `AUTO_CHIP` |
| 風 | 不做（沿用 `WIND_IGNORED`） |
| 球桿推薦 | `recommendClub({ distance_m, lie, dz_m, player }) -> { club, carry: { median, p10, p90 }, alts: [2], source: 'gapping'|'reference', flags: ['small_sample'?] }`；plays-like = (距離 + dz × 1.0) / 球位係數；選中位數最接近者，P10–P90 帶一起畫在地圖上 |

### C.4 回合流程與畫面（全部 lazy；V4-D 擁有）

| screen id | 模組 | 分頁 | 內容 |
|---|---|---|---|
| `course` | `ui/course.js mountCourse` | 練習 | 回合列表（進行中／已完成）、新回合 sheet：風格、9／18、種子（顯示 6 位數，可輸入以重玩同一球場）、tees、1–4 位玩家（名稱、慣用手、owner／訪客＋driver carry、推桿程度）、規則選項 |
| `round` | `ui/round.js mountRound` | 練習 | 洞前飛越 → 俯視地圖（主角）＋本桿面板：輪到誰、距 pin、推薦球桿、瞄準（地圖拖曳＋左右 2° 按鈕，44 px，**不可只靠拖曳**）、「揮桿」（進 live）、「匯入慢動作」（進 import）、「手動輸入」；落點動畫（reduced-motion 直接到位）、95% 橢圓、資料來源 chip |
| `scorecard` | `ui/scorecard.js mountScorecard` | 練習 | 每洞桿數／推桿／罰桿、前九／後九／總計、對 par；每格點開看各桿來源；分享（§D 回合卡）；頁尾固定一行「模擬成績由估計距離算出，不等於真實球場成績」 |

- **輪流（pass-and-play）**：tee 上依前一洞成績（榮譽）、其他位置依離 pin 最遠者先打；畫面上方大字顯示「輪到：名字」，換人時全螢幕插頁（避免拿錯）。
- **揮桿流程**：`round` 按「揮桿」→ `nav.go('live', { sink: 'sim' })`；live 畫面（V4-B 擁有）偵測 `params.sink === 'sim'` 時 `import('./sim-banner.js')`（V4-D 擁有）顯示「第 3 洞・第 2 桿・7 鐵・王小明」橫幅；
  速報出現後橫幅給「用這球／重打這球（不算桿）」兩鈕 → `app.sim.submit({ kind: 'quick', result })` → 回 `round`。
  匯入路徑：`nav.go('import', { sink: 'sim' })`，分析完 `app.sim.submit({ kind: 'shot', shot })`。
- **洞前飛越**：4 s 相機路徑 tee → 落點區 → 果嶺，可略過（按鈕與點擊任意處）；`prefers-reduced-motion` 或 `settings.sim.flyover=false` → 靜態斜視總覽一張。
- **繪製**（決定：Canvas 2D，不加 WebGL 函式庫）：`course/draw2d.js`（俯視圖：多邊形填色＋**紋理**——沙坑點狀、水波紋、樹圓＋符號、OB 斜線，顏色不是唯一載體）；
  `course/draw3d.js`（斜視／飛越：import `viz/traj3d.js` 的 `project3`，自寫 look-at 相機；地面多邊形依深度畫家演算法、樹畫成廣告板圓錐、球軌跡用 `flight.samples` 或依 carry／落地角合成的拋物線）。
  理由：每洞 ≤ 30 多邊形 × 24 點＋60 樹，每幀 < 2,500 個投影點，Canvas 2D 足夠；three.js 等 600 KB 級（LMS §3.6）不值得。`viz/**` 不改（保住 LMS LM-C 的 60,000 B gate）。
- 取色：新 token（§F.6）只經 `course/palette.js`（讀 `--course-*`，同 `vizPalette` 作法）。
- 效能目標（iPhone 12）：飛越 ≥ 50 fps、換洞到可操作 ≤ 1.0 s、產生 18 洞 ≤ 150 ms（實機清單）；機械判定見 §G V4-C／V4-D。
- 儲存：每一桿完成即 `repo.rounds.put(round)`（單筆、短交易）；reload 後回到同一洞同一桿。

---

## D. 軌跡影片與分享卡

### D.1 影片合成（`share/compose.js`，V4-E 擁有）

`composeShotVideo({ shot, clipBlob, poseSeq|null, opts: { ballColour, clubColour, layout: 'portrait'|'landscape', card: true, lines: false, faceMask: false, appMark: false }, onProgress, signal }) -> Promise<{ blob, mime, duration_s, bytes, width, height }>`

| 段 | 輸出時長 | 內容 |
|---|---|---|
| 揮桿 | ≤ 4.0 s | 原片 address − 0.3 s … impact + 0.1 s；240 fps 原片以 1/4 速（每 2 幀取 1）、60 fps 原片 1/2 速；超過 4 s 自動加速 |
| 球飛行 | ≤ 3.0 s | 停在撞擊後一幀，球軌跡依 `flight.samples` 時間長出：偵測段（`tracks.ball_px`）實線、模擬延伸（`projectFlight`）點線，圖例「偵測／模擬」 |
| 數據卡 | 2.5 s | carry ±、總距離 ±、球速 ±、桿速 ±、發射角 ±（依機位有值者，最多 6 項）＋ validity 字樣；null 不顯示 |
| 合計 | **≤ 12 s** | 30 fps |

- 桿頭軌跡：`tracks.club_px`（新，§F.1，240 fps 匯入才有）實線；沒有時用 `poseSeq` 的前手手腕軌跡，圖例改「手部軌跡」；都沒有就不畫。兩條軌跡**線型不同**（球＝實線＋點、桿頭＝較細虛線），顏色不是唯一區別。
- 原片解碼：用 `import/decode.js decodeFile`（逐幀精確；不靠 `<video>` 播放時鐘）；畫到 `OffscreenCanvas` 不可用時用一般 canvas。
- 編碼：`canvas.captureStream(30)` ＋ `MediaRecorder`，mime 用 `capture/recorder.js pickMimeType`（iOS Safari → `video/mp4`、Chromium／Android → `video/webm`）；
  `videoBitsPerSecond` 4,000,000；**不含聲音**（避免錄到旁人說話，也省掉音訊同步）。即時繪製，合成時間 ≈ 影片長度＋解碼。
- 尺寸：直式 720×1280、橫式 1280×720；位元組 > 15 MB 時以 2 Mbps 重做一次，仍超過就失敗並顯示原因。
- 臉部馬賽克（SHOULD）：用 `poseSeq` 頭部關鍵點框，縮小再放大做馬賽克（不用 `ctx.filter`，iOS 支援不確定）；預設關。
- App 標記：`opts.appMark` 預設**關**；開時右下角小字 app 名稱＋圖示（不是浮水印式覆蓋）。
- 全部離線；不寫入 IDB（產物只在記憶體，分享或下載後釋放）。

### D.2 分享流程（`ui/share.js` sheet，lazy）

1. 使用者在 sheet 選色盤（球、桿頭各一，不可相同）、直／橫、是否加數據卡、對齊線、馬賽克 → 按「製作影片」，進度條＋取消。
2. 完成後顯示預覽（`<video>` 播放）與「分享」按鈕。**分享一定是第二次點擊**：`navigator.share` 需要使用者啟用（transient activation），合成要數秒，第一次點擊早已過期。
3. `navigator.canShare({ files })` 為真 → `navigator.share({ files: [File], title })`；否則 fallback 到 `ui/history.js shareOrDownload`（下載連結 `data-testid=share-download`）。
4. 檔名 `golf-swing-lab-tracer-<stamp>.mp4|webm`、`golf-swing-lab-card-<stamp>.png`（不使用競品詞彙，§I）。
5. 不支援 `MediaRecorder` 或 `captureStream` → 影片選項 disabled 並說明原因（`share.unsupported_video`），仍可做靜態卡。

### D.3 靜態分享卡（`share/card.js`）

- `drawShotCard(canvas, { shot, units, palette, locale })`：單球（1080×1350 PNG）。
- `drawSessionCard(canvas, { shots, filter, units, palette })`：一次練習——球數、最遠 carry（值 ± ci95＋validity 字樣）、各球桿 carry 中位數與 P10–P90、
  face_on 球速中位數 ±、high_behind 左右散佈（`sd_est`；`indistinguishable` 時寫「散佈小於量測誤差」而不是給數字）、日期、機位。
- `drawRoundCard(canvas, { round, playerId })`：回合記分卡（桿數、對 par、每洞小格）＋「模擬」字樣。
- **規則**：卡上任何距離／速度數字旁邊 MUST 有 ± 或範圍；面向公開分享的卡**不寫「實測」**。

### D.4 軌跡色盤（token，對比檢查）

`tokens.css` 新增**與主題無關**的 `--trail-1 … --trail-8`（畫在影片上，同 `--viz-tracer` 慣例；只在 `:root` 定義一次，省 shell 位元組）。
每色對 `--viz-tracer-halo`（畫在 4 px 深色描邊上）對比 ≥ 4.5，兩兩之間 CIEDE2000 ≥ 20（單元測試計算）。
預設：球 `--trail-1`（亮黃）、桿頭 `--trail-4`（亮青）。sun 主題不另設（影片上用描邊保證可讀）。設定存 `settings.share`。

---

## E. 揮桿實驗室

### E.1 對齊線（`lab/lines.js` 計算、`lab/overlay.js` 繪製；F2 機位紀律）

線以 **address 幀**為參考（靜態），疊在 replay 的每一幀上；可切換是否同時畫「當下幀」的對應線（動態）。
✓＝可畫；✓c＝需要校正資料（無則 null＋`NO_CALIBRATION`）；✗＝不畫，原因碼如表。

| id | 名稱 | face_on | dtl | high_behind | 來源 |
|---|---|---|---|---|---|
| `head_box` | 頭部框 | ✓ | ✓ | ✓（低） | 耳鼻關鍵點外框 +15% |
| `spine` | 脊椎角線 | ✓（側傾） | ✓（前傾） | ✗ `VIEW_PLANE_MISMATCH` | 髖中點 → 肩中點 |
| `shoulders` | 肩線 | ✓ | ✗ `VIEW_DEPTH_AXIS` | ✗ `VIEW_DEPTH_AXIS` | 左右肩 |
| `hip_walls` | 髖部垂直線（前後兩條） | ✓ | ✗ `VIEW_DEPTH_AXIS` | ✗ `VIEW_DEPTH_AXIS` | address 時左右髖外緣 |
| `butt_line` | 臀線 | ✗ `VIEW_DEPTH_AXIS` | ✓ | ✗ `VIEW_PLANE_MISMATCH` | address 時後側臀部垂直線 |
| `stance` | 站姿寬度（兩踝垂直線＋肩寬標記） | ✓ | ✗ `VIEW_DEPTH_AXIS` | ✗ `VIEW_DEPTH_AXIS` | 腳踝、肩 |
| `ball_hand_plane` | 球—手平面（近似桿身平面） | ✗ `VIEW_PLANE_MISMATCH` | ✓c | ✗ `VIEW_PLANE_MISMATCH` | 球位（`calib/ballspot`）→ 手腕中點，延長 |
| `ball_shoulder_plane` | 球—肩平面 | ✗ `VIEW_PLANE_MISMATCH` | ✓c | ✗ `VIEW_PLANE_MISMATCH` | 球位 → 後肩 |
| `target_line` | 目標線 | ✓c（地面水平線） | ✓c | ✓c | 墊子校正（PnP）投影 |

每機位可畫：face_on 6 條（head_box、spine、shoulders、hip_walls、stance、target_line）；dtl 6 條（head_box、spine、butt_line、ball_hand_plane、ball_shoulder_plane、target_line）；
high_behind 2 條（head_box、target_line）——hb 畫面上明講「這個機位看不到身體線，請改用正面或後方」。
介面：`computeLines({ view, poseSeq, events, calibration, handedness }) -> { [id]: { pts: [[u,v]…], kind: 'ref'|'live', validity, reason_codes } | null }`；
`drawLines(ctx, lines, { frame, palette, enabled: id[] })`，顏色用既有影片層 token `--overlay-select`（參考線）與 `--overlay-caution`（偏離時），配 `--media-bg` 描邊。

### E.2 分段（8 事件）

`EVENTS` 8 個事件各一張卡：事件幀縮圖（從 clip 解碼該幀）、該階段相關指標（磚，沿用 `dataTile`）、該階段被判定的問題 chip。點卡 → replay 跳到該幀；replay 時間軸上以 ▲ 標問題發生幀，
有「上一幀／下一幀」與「上一個問題／下一個問題」按鈕（44 px）。

### E.3 問題規則（`lab/faults.js`，參數 `lab/params.js` 帶 `version`；全部門檻 UNVERIFIED 教學經驗值）

判定：取得量值 v 與 σ（契約 metric 用其 ci95／sigma；lab 自算的量用 `metrics/pose.js` 的 `displacement`／`spineTilt` 同一套 σ 傳遞）。
- `fault`：95% 區間整段落在門檻外；`possible`：點估計在門檻外但區間跨門檻（加 `FAULT_INCONCLUSIVE`）；`ok`：點估計在門檻內；
- `unknown`：機位不在下表允許欄、fps 不足、或量值為 null → 帶原因碼（`VIEW_*`、`FPS_TOO_LOW`、或沿用量值的碼）。**`unknown` 永遠不顯示成問題**。
- 信心以文字呈現（很可能／可能／看不出來），不顯示百分比。

| id | 名稱 | 機位（其餘 = unknown） | 量值 | 門檻（`standard`） | 階段 |
|---|---|---|---|---|---|
| `early_extension` | 提早伸展 | dtl | `early_extension_m`（髖往球移動，address→impact） | > 0.05 m | impact |
| `loss_of_posture` | 失去前傾 | dtl | lab：脊椎前傾角 address→impact 變化 | < −8° | impact |
| `over_the_top` | 由外而內（下桿過陡） | dtl；hb（240 fps） | dtl：lab 在 mid_downswing 的手部平面偏差（同 `handPlaneDev` 方法）；hb：`club_path_deg` | dtl > +0.08 m（手在 address 平面之上）；hb < −4° | mid_downswing／impact |
| `sway` | 上桿側移 | face_on | lab：髖中點 address→top 往目標反方向位移；輔以 `head_sway_x_m` | > 0.06 m | top |
| `slide` | 下桿滑動 | face_on | lab：髖中點 impact 時越過 address 前踝垂直線的距離 | > 0.03 m | impact |
| `reverse_spine` | 反轉脊椎 | face_on | lab：top 時脊椎側傾朝目標 | < −5° | top |
| `head_dip` | 頭部下沉 | face_on、dtl | `head_lift_z_m` | < −0.05 m | impact |
| `early_rise` | 提早起身 | face_on、dtl | `head_lift_z_m` | > +0.06 m | impact |
| `weight_back` | 重心留在後腳 | face_on | `weight_shift_pct` | < 50% | impact |
| `overswing` | 上桿過頭 | dtl（≥ 120 fps） | `top_shaft_angle_deg` | > +10°（過水平） | top |

> **更正（2026-11-07 整合）**：`top_shaft_angle_deg` 在契約裡是頂點時桿身相對目標線的角度（across-the-line／laid-off，dtl 後方看到的水平方向偏差），
> **不是**「過水平幾度」，用它判上桿過頭是錯的；上桿頂點附近也常沒有桿頭追蹤。`overswing` 規則因此停用：`lab/params.js` 標 `disabled: NOT_IMPLEMENTED`，
> 結果一律 `unknown`＋`NOT_IMPLEMENTED`，練習卡隱藏。要做得等有「桿身過水平」的量值（0.4.x 之後）。
| `tempo_off` | 節奏偏離 | 全部 | `tempo_ratio` | < 2.4 或 > 3.6 | 全程 |

`settings.lab.sensitivity`：`standard`／`relaxed`（門檻 ×1.5）。**不做**：casting／提早釋放、擊球時手部前傾、桿面相關問題——
即時 30–60 fps 看不到桿身，240 fps 的桿頭追蹤只在撞擊附近 1–2 點（LMS §1.2 #22–26 同理），做了只會是猜。

### E.4 趨勢追蹤（`lab/trends.js` + 紀錄頁分段 `patterns`）

- 每球的 lab 結果存 `lab` store（§F.2，衍生資料，演算法版本改了就重算）。
- `patterns` 畫面：期間（7／30／全部）× 機位篩選；每個問題一列：近 10 次練習每次的「fault＋possible 比例」長條（`viz/charts.js drawBars`，Wilson 95% 區間當 whisker）、
  n、最近變化（只有區間不重疊才寫「變少了／變多了」）；**不同機位不合併**（每個問題只在其允許機位的球上計算）。最上方「最常見的 3 個問題」。

### E.5 練習建議（決定：站內練習卡，不連外部影片）

`lab/drills.js`：每個問題 1–2 張練習卡（共約 14 張）：目的、步驟（3–5 步文字）、要看的指標、成功條件（例：「10 球中 ≥ 8 球 `early_extension_m` < 0.05 m」）。
卡上「開始練習」→ live 畫面，hero 指標設成該量值、該機位提示（`nav.go('live', { focus: metricId, view })`）。
**不放外部影片連結**：離線時壞掉、內容無法審核、且違反「不對外部網域發請求」精神；內容全部在 i18n `lab` namespace。

---

## F. 資料契約、遷移、i18n、lazy 計畫、測試

### F.1 `golf-shot/2` 加性修訂（schema id 不變，`$comment` 記 rev 2）

- `tracks.club_px`（選填）：`[[frame, u, v]…]`（≤ 40，frame 遞增），由 `pipeline/assemble.js` 從 `track/club.js` 的桿頭觀測寫入（240 fps 匯入）。
  驗證器新規則 `tracks_club_frame_increasing`。
- **相容性**：0.3.0 的驗證器（tracks `additionalProperties:false`）**會拒絕**帶 `club_px` 的 shot；與 LMS D6 一樣接受「舊版讀不到新備份」，匯出畫面一行說明。
- 其他 shot 欄位不變；速報值、模擬結果、lab 結果都**不**寫進 shot。

### F.2 新 schema 與 IDB

`schema/round-v1.schema.json`（新）`golf-round/1`：

```
{ schema: 'golf-round/1', round_id, created_at, updated_at, app_version, status: 'active'|'finished'|'abandoned',
  course: { generator: 'course-1', style, seed: uint32, holes_n: 9|18, tees, holes: [Hole …] },     // 幾何快照
  rules: { unobservedSide, putting: 'auto'|'manual', ob: 'drop_2'|'stroke_distance', maxScore: 'double_par'|'none', autoChipM, params_version },
  players: [{ player_id, name, handedness, kind: 'owner'|'guest', driver_carry_m|null, putt_skill: 0|10|20|30 }],   // 1–4
  strokes: [{ seq, player_id, hole, n, from: { x, y, lie }, aim: { x, y }, club,
              source: 'quick'|'shot'|'manual'|'auto_putt'|'auto_chip'|'penalty'|'pickup', shot_id|null,
              carry: { value, ci95|null, sigma|null, validity, origin, reason_codes },
              side:  { value, ci95|null, sigma|null, validity, origin, reason_codes },
              draw: { seed, carry_m, side_m }, landing: { x, y, z }, rest: { x, y, lie }, penalty: 0|1|2, event: null|'tree'|'water'|'ob'|'holed' }],
  current: { hole, player_id } | null }
```
記分卡**不存**，一律由 `sim/round.js scorecard(round)` 從 strokes 推導（不會不一致）。驗證器 `contract/round.js validateRound`（lazy）規則：players 1–4、
holes.length = holes_n、每位玩家每洞 n 從 1 連續遞增、`origin==='manual'` ⇒ 含 `MANUAL_ENTRY`、其他非 null 值 ⇒ 有 ci95 或 sigma、validity ≠ `valid`、
`replayRound(round)`（用 draw 與規則重演）得到的每個 rest 與存檔相差 ≤ 0.05 m。單筆上限 256 KB（18 洞幾何約 150 KB）。

`golf-lab/1`（`lab` store，衍生、可重算，不匯出）：`{ shot_id, view, algo: { version, sha256 }, faults: [{ id, status, value, sigma, threshold, event, reason_codes }], computed_at }`。

`store/core.js`：`SCHEMA_VERSION = 5`，新 store `rounds`（keyPath `round_id`，index `created_at`、`status`）、`lab`（keyPath `shot_id`，index `computed_at`、`view`）；純加性、不改既有資料。
`repo.rounds.{get,put,list,delete}`、`repo.lab.{get,put,list,deleteStale(version)}`。

匯出：格式維持 `golf-swing-lab-export/1`，新增選填陣列 `rounds[]`（預設包含）；0.3.0 匯入時忽略未知陣列（現行 `checkEnvelope` 不拒絕未知鍵——V4-A 用單元測試鎖住此行為）。CSV 不變。

### F.3 新原因碼（只增不改；每碼 zh-Hant／en 的 `.short/.long/.fix`）

| 碼 | 意思（`.long` 草稿） | 用在 |
|---|---|---|
| `PROVISIONAL` | 揮桿後立即算出的速報值，完整分析後可能改變 | A |
| `GAPPING_PRIOR` ★ | 這個數字來自你自己距離表中該球桿的典型值，不是這一球量到的 | B |
| `REFERENCE_PRIOR` ★ | 這個數字來自一般球員的典型值（你的紀錄不足） | B |
| `SIDE_SAMPLED` | 這一球的左右量不到，模擬時依你的散佈隨機抽樣 | B |
| `MANUAL_ENTRY` | 手動輸入的數字，未經本 app 量測 | B |
| `LIE_ADJUSTED` | 依球位（長草、沙坑）調整了距離與散佈 | C |
| `AUTO_PUTT` ★ | 推桿結果由距離模型模擬 | C |
| `AUTO_CHIP` ★ | 切桿結果由模型模擬 | C |
| `FAULT_INCONCLUSIVE` | 量值的誤差範圍跨過判定門檻，無法確定 | E |

★ 加入 `MODEL_CODES`。`check_contract` 輸出 `(47 reason codes;`（38＋9）。

### F.4 設定（`session/settings.js` 只做「子物件原樣保存」；正規化在各 lazy 模組）

`settings.quick = { enabled: true }`（`quick/settings.js normalizeQuick`）；`settings.sim = { unobservedSide: 'sample', putting: 'auto', puttSkill: 20, ob: 'drop_2', maxScore: 'double_par', autoChipM: 0, flyover: true, tees: 'middle' }`（`sim/settings.js`）；
`settings.share = { ballColour: 'trail-1', clubColour: 'trail-4', layout: 'portrait', card: true, lines: false, faceMask: false, appMark: false }`（`share/settings.js`）；
`settings.lab = { lines: [...預設全開], dynamic: false, sensitivity: 'standard' }`（`lab/settings.js`）。設定畫面只加 `settings-quick` 一個開關，其餘在各功能畫面內的 sheet。

### F.5 i18n

新 lazy namespace（列入 `LAZY_I18N_NAMESPACES`）：`quick`、`sim`、`course`、`score`、`share`、`lab`、`fault`、`patterns`。
core（shell）只加：`screen.{course,round,scorecard,lab,patterns}.title`、`home` 兩張入口卡、`settings.quick`。
功能名（產品內）：模擬球場／Virtual Course、軌跡影片／Tracer Clip、揮桿實驗室／Swing Lab、速報／Quick Read。風格名：林間／Parkland、海風／Links、荒漠／Desert。

### F.6 tokens（`tokens.css`）

- `--trail-1…8`（§D.4，只在 `:root`）。
- `--course-fairway`、`--course-rough`、`--course-green`、`--course-bunker`、`--course-water`、`--course-tree`、`--course-ob`、`--course-pin`：在 `:root` 定義一次（地圖本身是「資料畫面」，auto 時深色），
  sun 只覆寫 `--course-ob`、`--course-pin` 與一個 `--course-outline`（2 px 黑框取代填色差異）。對比：相鄰區域（球道／粗草、果嶺／球道、水／粗草、沙坑／球道）≥ 1.5 **且**各有不同紋理；`--course-pin` 對 green ≥ 3.0。
- 對齊線沿用 `--overlay-select／-caution`＋`--media-bg`，不加新色。
- 新畫面 CSS（`styles/screens/{sim,lab,share}.css`）**lazy**：不由 `index.html` 連結；`app.loadStyles(name)`（V4-A，main.js）在掛載畫面前插入 `<link>` 並等 `load`。`check_tokens` 規則照樣掃這些檔。

### F.7 lazy 計畫與位元組預算

`scripts/build.mjs` `LAZY_GLOBS` 新增：`src/quick/*.js`、`src/course/*.js`、`src/sim/*.js`、`src/share/*.js`、`src/lab/*.js`、`src/contract/round.js`、
`src/ui/{course,round,scorecard,sim-banner,quickcard,share,lab,patterns}.js`；`LAZY_EXACT` 新增 `styles/screens/{sim,lab,share}.css`。

| 位置 | shell 增量上限（B） | 主要內容 |
|---|---|---|
| V4-A | 11,000 | main.js（5 screens、`app.sim`、`app.loadStyles`）、state.js、index.html（5 個 section）、tokens.css（trail＋course ≈ 1.4 KB）、store/core.js v5、store/export.js、session/settings.js、contract enums／RC、ui/settings.js、ui/home.js、core i18n |
| V4-B | 3,500 | events/live.js（impact 事件）、pipeline/live.js（onProvisional）、ui/live.js（預載 quickcard、sim sink） |
| V4-E | 600 | pipeline/assemble.js（club_px） |
| V4-F | 2,000 | ui/shot.js、ui/replay.js、ui/history.js 的入口與掛勾 |
| V4-C、V4-D | 0 | 全 lazy |
| **整合上限** | **shell ≤ 992,000 B**（保留 ≥ 8 KB 給 0.4.x 修正） | |

> **實測（2026-11-07 整合）**：shell 990,381 B（比基準 +13,642 B，在各包上限加總 17,100 B 之內；距整合上限只剩 1,619 B，
> 對 `BUDGETS.shell_bytes` 1,000,000 的 8 KB 保留仍在）、precache 32,209,815 B（+329,213 B，≤ 32,500,000）。
> 0.4.x 的修正若要加 shell，先把程式搬到 lazy 模組，**不放寬上限**。
> **設計修正 fix1（2026-11-07）**：速報卡 CSS 搬到 lazy `styles/screens/quick.css`（main.js `SCREEN_STYLES.live` 在 live 首次掛載前載入），
> 換來 app.css 的 ◐ 半圓繪製；shell 990,114 B（−267 B）。

precache 估計新增（lazy，原始碼大小）：quick 20 KB、course 45 KB（含 draw2d／draw3d）、sim 45 KB、share 35 KB、lab 40 KB（含 overlay）、新 ui 95 KB、lazy CSS 9 KB、
新 i18n 兩語系 60 KB、round schema／驗證 8 KB → **≈ 360 KB**；整合上限 **precache ≤ 32,500,000 B**。基準值在 V4-A drop 1 時寫入 `tests/fixtures/v4/budget-baseline.json`（當下 manifest 的 shell／precache）。

### F.8 測試總表（新增）

單元：`v4.contract.*`、`v4.brands`、`quick.*`、`events.live`（擴充）、`course.*`、`sim.*`、`share.*`、`lab.*`、`store.core`（v5 案例）、`store.export`（rounds 往返、未知陣列容忍）。
e2e gates：`tests/e2e/gates/v4-<a…f>-<name>.mjs`（V4-A 擴充 `run.mjs` 的自動發現 pattern 以接受 `v4-<x>-`）。
截圖矩陣新增 state：`live:provisional`、`live:refined`、`course`、`course:new`、`round`、`round:flyover`（reduced-motion 靜態）、`round:aim`、`round:green`、`round:recommend`、`round:manual`、
`scorecard`、`lab`、`lab:lines`、`lab:phase`、`lab:fault`、`patterns`、`share`（sheet）、`share:ready`。夾具：`scripts/make_v4_fixtures.mjs`（V4-A）產生
`tests/fixtures/rounds/{valid_9_links_2p, valid_18_parkland_1p_finished, valid_manual_only, bad_<rule>…}.json`、`tests/fixtures/v4/quick-swings.json`（合成手腕樣本＋真值）、
`tests/fixtures/v4/lab-sessions.json`（帶 poses 的 face_on／dtl 球，含注入的問題）。

---

## G. 工作包

### G.0 共用介面凍結（V4-A drop 1 先落地；其他包從第一天照此寫，drop 1 前用夾具與注入的假實作）

1. 契約：§F.1–F.3 全部（`tracks.club_px`、`golf-round/1`、`golf-lab/1` 形狀、9 個 RC 與說明、`MODEL_CODES` 擴充）。
2. Repo：`SCHEMA_VERSION 5`、`repo.rounds`、`repo.lab`；匯出 `rounds[]`。
3. App：`app.sim = { active() -> { round_id, hole, player_id, stroke_n, club }|null, set(ctx|null), submit(input) , onSubmit(fn) -> off }`（input = `{ kind: 'quick', result } | { kind: 'shot', shot } | { kind: 'manual', carry_m, side_m|null }`）；
   `app.loadStyles(name) -> Promise`；SCREEN_MODULES 加 `course round scorecard lab patterns`（stub 畫面）；`state.js` SUB_SCREENS／DATA_SCREENS（`round`、`scorecard`、`lab`、`patterns` 為資料畫面）。
4. 介面簽名（stub 拋 `{ code: 'PACKAGE_PENDING' }`）：
   - V4-B：`quickEstimate`（§A.3）、`mountQuickCard`。
   - V4-C：`generateCourse`、`validateCourse`、`shotOutcome({ input, view, club, player, rows: { gap, side }, rules, rng }) -> Outcome`、`playStroke(round, outcome, aim) -> { round, stroke }`、
     `autoPutt(round, player)`、`recommendClub`、`scorecard(round)`、`replayRound(round)`、`lieAt(hole, x, y)`。
   - V4-D：`drawHole2d(canvas, { hole, strokes, ellipse, aim, palette, units }) -> { a11y, params }`、`createFlyover(canvas, { hole, palette, reducedMotion, onDone }) -> { start(), skip(), destroy() }`、`mountSimBanner(el, app, ctx)`。
   - V4-E：`composeShotVideo`、`drawShotCard`、`drawSessionCard`、`drawRoundCard`、`openShareSheet(app, { kind: 'shot'|'session'|'round', ...})`、`TRAIL_TOKENS`。
   - V4-F：`computeLines`、`drawLines`、`evaluateFaults({ shot, poseSeq, view, fps, settings }) -> golf-lab/1`、`faultTrends(labRecords, filter)`、`LAB_DRILLS`。
5. i18n stub catalogs、`namespaces.json` 擁有者、`LAZY_*` 清單、lazy CSS 空檔、夾具、`docs/V04-INTERFACES.md`（索引，同 LMI 格式）。

### G.1 檔案擁有權（獨占；每列恰好一包）

| 包 | 名稱 | 可改的檔案／目錄 |
|---|---|---|
| **V4-A** | 基礎、契約、整合 | `schema/round-v1.schema.json`（新）、`schema/shot-v2.schema.json`、`app/src/contract/**`（含新 `round.js`）、`app/src/store/core.js`、`app/src/store/export.js`、`app/src/session/settings.js`、`app/src/state.js`、`app/src/main.js`、`app/index.html`、`app/styles/tokens.css`、`app/styles/app.css`、`app/src/ui/settings.js`、`app/src/ui/home.js`、`app/src/ui/components.js`、`app/src/ui/icons.js`、`app/i18n/namespaces.json`、core i18n（`common nav screen home settings metric reason unit validity`）、`app/styles/screens/{sim,lab,share}.css`（只建空檔，之後交給 D／F／E——見下）、`scripts/build.mjs`、`scripts/check_*.mjs`（含新 `check_brands.mjs`）、`scripts/verify.sh`、`scripts/make_v4_fixtures.mjs`（新）、`tests/e2e/{run,lib,checks,screenshot_matrix}.mjs`、`tests/e2e/gates/v4-a-*.mjs`、`tests/fixtures/{rounds,v4}/**`、`tests/unit/{v4.contract.*,v4.brands,store.core,store.export,tokens.*,appcore.*,i18n.*}.test.mjs`、`package.json`、`docs/{V04-INTERFACES,contract,interfaces,design-system,i18n,e2e-hooks,device-checklist}.md` |
| **V4-B** | 秒出數據 | `app/src/events/live.js`、`app/src/pipeline/live.js`、`app/src/quick/**`（新）、`app/src/ui/live.js`、`app/src/ui/quickcard.js`（新）、`app/styles/screens/practice.css`、i18n `quick live`、`scripts/make_carry_table.mjs`（新）、`tests/unit/{quick.*,events.live,media.live}.test.mjs`、`tests/e2e/m5.mjs`、`tests/e2e/gates/v4-b-*.mjs` |
| **V4-C** | 球場與模擬引擎（純模組） | `app/src/course/{model,detmath,generate,styles,validate}.js`（新）、`app/src/sim/**`（新：`engine lies rules putting recommend source round params settings`）、`tests/unit/{course.*,sim.*}.test.mjs`、`docs/research/sim-params.md`（新，經驗值出處與 UNVERIFIED 清單） |
| **V4-D** | 模擬球場畫面 | `app/src/course/{draw2d,draw3d,palette}.js`（新）、`app/src/ui/{course,round,scorecard,sim-banner}.js`（新）、`app/src/ui/import.js`（只加 sim sink）、`app/styles/screens/sim.css`、i18n `sim course score import`、`tests/unit/ui.sim.*.test.mjs`、`tests/e2e/gates/v4-d-*.mjs` |
| **V4-E** | 軌跡影片與分享卡 | `app/src/share/**`（新：`compose timeline card trails settings`）、`app/src/ui/share.js`（新）、`app/src/pipeline/assemble.js`、`app/styles/screens/share.css`、i18n `share`、`tests/unit/{share.*,pipeline.assemble}.test.mjs`、`tests/e2e/gates/v4-e-*.mjs` |
| **V4-F** | 揮桿實驗室＋入口 | `app/src/lab/**`（新：`lines overlay faults phases trends drills params settings`）、`app/src/ui/{lab,patterns}.js`（新）、`app/src/ui/shot.js`、`app/src/ui/replay.js`、`app/src/ui/history.js`、`app/src/ui/stats.js`、`app/styles/screens/{lab.css,results.css,stats.css}`、i18n `lab fault patterns shot replay history stats`、`tests/unit/{lab.*,ui.timeline}.test.mjs`、`tests/e2e/{m2,m6}.mjs`、`tests/e2e/gates/v4-f-*.mjs` |

規則：`app/src/viz/**`、`physics/**`、`track/**`、`metrics/**`、`practice/**`、`workers/**`、`calib/**`、`import/**` **任何包都不准改**（只 import）；需要時向 V4-A 提需求。
`course/` 目錄內依檔名分屬 C（模型與產生）與 D（繪製）。新增檔案依上表目錄判定歸屬。共用字串放 `common`，由 V4-A 合併。
跨包呼叫只透過 G.0 凍結的函式（例如 F 的 shot 畫面呼叫 E 的 `openShareSheet`；E 的 compose 呼叫 F 的 `computeLines/drawLines`；B 的 live 載入 D 的 `sim-banner.js`）。

### G.2 共通驗收（每包）

- `bash scripts/verify.sh` 最後一行 `all stages passed`（無 `RUN_BROWSER_E2E` 時 `no failures, but this is NOT a full verification` 在包內可接受）。
- `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only 'v4-<x>-*'` 退出碼 0（V4-C 無畫面，無 gate；瀏覽器行為由 v4-d 覆蓋）。
- `node scripts/check_i18n.mjs --strict --quiet`、`node scripts/check_tokens.mjs --strict`、`node scripts/check_brands.mjs` 退出碼 0。
- shell 增量 ≤ 該包上限（§F.7）：`node -e` 讀 `dist/precache-manifest.json` 與 `tests/fixtures/v4/budget-baseline.json` 相減，印 `SHELL DELTA <n> OK|FAIL`（腳本由 V4-A 在 drop 1 提供：`scripts/budget_delta.mjs --max <n>`）。

### G.3 各包驗收（機械判定）

**V4-A**
1. `node scripts/check_contract.mjs` 輸出含 `(47 reason codes;`。
2. `node --test tests/unit/v4.contract.round.test.mjs` → `# fail 0`：所有 `valid_*` round 夾具通過、每個 `bad_*` 失敗且訊息含其規則名；`tracks.club_px` frame 不遞增的 shot 失敗（`tracks_club_frame_increasing`）；既有 v2 夾具全數仍通過。
3. `node -e "import('./app/src/store/core.js').then(m=>console.log(m.SCHEMA_VERSION, ['rounds','lab'].every(s=>m.STORE_NAMES.includes(s))))"` → `5 true`；`store.core` 測試含「v4 資料庫升 v5 後 shots／drills 筆數不變」。
4. `node --test tests/unit/store.export.test.mjs`：rounds 往返深度相等；帶 `rounds[]` 的檔案用 0.3.0 的 `checkEnvelope` 邏輯不被拒絕（鎖住現行行為）。
5. `node --test tests/unit/v4.brands.test.mjs`：在暫存目錄放入含競品字樣與「準確率 90%」字樣的檔案 → `check_brands --root <tmp>` 退出碼 1 並列出兩者；乾淨 repo → 0。
6. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only v4-a-shell` → PASS：5 個新畫面可導覽、`focusOnH1`、`noHScroll`（200%）、lazy CSS 在 `show()` 完成前已套用（探針規則的 computed style）。
7. 預算：`node scripts/budget_delta.mjs --max 11000` → `OK`。

**V4-B**
1. `node --test tests/unit/quick.estimate.test.mjs` → `# fail 0`：`quick-swings.json` 200 揮（30／60 fps 各半）：速報 `club_speed_mps` 的 ci95 涵蓋精算值 ≥ 85%；tempo 三項速報 vs 精算中位 |Δ| ≤ 0.05 s；
   dtl／hb 速報 carry 的 origin 為 prior 且含 `GAPPING_PRIOR` 或 `REFERENCE_PRIOR`；任何速報 metric validity ∈ {`low_confidence`, null}，非 null 必有 ci95 且含 `PROVISIONAL`。
2. `node --test tests/unit/quick.perf.test.mjs` → `quickEstimate` 中位 CPU ≤ 20 ms；`node scripts/make_carry_table.mjs --check` 退出碼 0。
3. `node --test tests/unit/events.live.test.mjs` → `impact` 事件在含音訊 onset 的夾具中於 onset 後 ≤ 1 個樣本內發出；既有 `shot` 事件序列與 0.3.0 逐筆相同（夾具快照）。
4. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only v4-b-latency` → PASS（stand-in 姿勢 seam、CPU ×4、10 揮夾具）：`quick-card[data-stage=provisional]` 出現時間距夾具 impact 的中位 ≤ 1.5 s、最大 ≤ 2.5 s；
   之後同卡轉為 `data-stage=refined`（≤ 12 s，既有 d-latency 標準）；每個速報磚有 `.mt-ci` 與 `quick.provisional` 譯文；診斷 JSON 含 `live.quick.latency_ms_p50`。
5. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only m5` 不退步；`settings.quick.enabled=false` 時 DOM 無 `quick-card`。
6. `node tests/e2e/screenshot_matrix.mjs --screens live:provisional,live:refined` 0 findings。

**V4-C**
1. `node --test tests/unit/course.determinism.test.mjs`：同輸入兩次 `generateCourse` 的 canonical JSON sha256 相同；與 `tests/fixtures/v4/course-golden.json`（3 風格 × 種子 1、42、987654）逐一相同；`grep -rnE 'Math\.(sin|cos|tan|atan2?|exp|log|pow|random)|Date\.now' app/src/course/{model,detmath,generate,styles,validate}.js | wc -l` → `0`。
2. `node --test tests/unit/course.validate.test.mjs`：3 風格 × 3,334 個種子（18 洞）全部 `validateCourse.ok`；par 組合與長度範圍正確。
3. `node --test tests/unit/course.perf.test.mjs`：18 洞產生中位 ≤ 30 ms。
4. `node --test tests/unit/sim.rules.test.mjs`：球位係數、OB（兩種規則）、水、樹碰撞（給定 flight.samples）、斜面交點、每洞上限各有表格案例；自動推桿：期望推數對距離單調不減、d = 0.5 m 時各程度一推率 ≥ 0.95、最多 4 推。
5. `node --test tests/unit/sim.source.test.mjs`：§B.1 表逐列（來源 × 機位）檢查 validity、origin、原因碼；所有輸出 validity ≠ `valid`；非手動輸出必有 ci95 或 sigma；`unobservedSide='center'` 時 side = μ。
6. `node --test tests/unit/sim.replay.test.mjs`：用夾具 strokes 重演，`replayRound` 的每個 rest 與存檔差 ≤ 0.05 m；同種子同輸入兩次整回合結果相同。
7. `node --test tests/unit/sim.recommend.test.mjs`：夾具距離表 → 預期球桿；n < 5 → `small_sample`；沙坑球位不推薦 driver。
8. 純度：`course/{model,…}`、`sim/**` 不 import `ui/`、不碰 `document`／`window`（grep 測試）。

**V4-D**
1. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only v4-d-round` → PASS：新回合（links、9 洞、種子 42、2 人）→ 略過飛越 → 第 1 洞兩人都用「手動輸入」打到果嶺 → 自動推桿 → `scorecard` 總計等於 strokes 推導值；中途 reload 回到同洞同桿同位置（IDB `rounds` 1 筆）。
2. `--only v4-d-honesty` → PASS：用夾具「即時 dtl 來源」的一桿，地圖 canvas 的 a11y params 含 `ellipse: true` 與來源 `gapping`；本桿 chip 文字含 validity 字樣與「抽樣」；記分卡頁尾 key `score.disclaimer` 存在。
3. `--only v4-d-perf` → PASS（CPU ×4）：飛越每幀繪製中位 ≤ 12 ms、P95 ≤ 25 ms（`app.e2e` state 回傳幀時間）；換洞到可操作 ≤ 1,000 ms；瀏覽器內 `generateCourse(42,'links',18)` sha256 = node golden（跨引擎可重現）。
4. `--only v4-d-motion` → PASS：`reducedMotion: 'reduce'` 時飛越只畫 1 幀、落點無動畫。
5. `node tests/e2e/screenshot_matrix.mjs --screens course,course:new,round,round:flyover,round:aim,round:green,round:recommend,round:manual,scorecard` 0 findings；`minTargets 44`（瞄準按鈕）。

**V4-E**
1. `node --test tests/unit/share.timeline.test.mjs`：240／60／30 fps 夾具的時間軸總長 ≤ 12 s、揮桿段 ≤ 4 s、幀對應單調；`share.trails`：8 色對 halo ≥ 4.5、兩兩 CIEDE2000 ≥ 20。
2. `node --test tests/unit/share.card.test.mjs`（錄製型假 canvas）：每個畫出的距離／速度數字字串旁有 `±` 或範圍；所有 `fillStyle/strokeStyle` 來自 palette；`indistinguishable` 時畫的是說明文字而非數字。
3. `node --test tests/unit/pipeline.assemble.test.mjs`：240 fps face_on 合成片段 → `tracks.club_px` 非空、frame 遞增、通過 v2 驗證。
4. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only v4-e-video` → PASS（chromium，`context.setOffline(true)`）：以 `valid_face_on_240` ＋夾具片段合成 → blob 50 KB–15 MB、mime 以 `video/webm` 或 `video/mp4` 開頭、`<video>` 載入後 duration 與時間軸差 ≤ 10%；
   `navigator.share` 被 stub 時，第二次點擊 `share-send` 才呼叫且帶 1 個 File；刪掉 `navigator.share` 時出現 `share-download`。
5. `--only v4-e-card` → PASS：session 卡 PNG 為 1080×1350；回合卡含「模擬」譯文。
6. `node tests/e2e/screenshot_matrix.mjs --screens share,share:ready` 0 findings。

**V4-F**
1. `node --test tests/unit/lab.faults.view.test.mjs`：11 問題 × 3 機位 × fps {30, 60, 120, 240}：不在允許欄的組合**全部** `unknown`＋`VIEW_*`／`FPS_TOO_LOW`，從不出現 `fault`／`possible`。
2. `node --test tests/unit/lab.faults.logic.test.mjs`：區間整段在外 → `fault`；跨門檻 → `possible`＋`FAULT_INCONCLUSIVE`；量值 null → `unknown` 並帶量值原因碼；`relaxed` 門檻 ×1.5。
3. `node --test tests/unit/lab.synthetic.test.mjs`：`lab-sessions.json` 注入 early extension 0.10 m 的 50 揮 dtl → `fault`＋`possible` ≥ 90%；乾淨 50 揮誤報（`fault`）≤ 10%；sway／slide 同法各一組。
4. `node --test tests/unit/lab.lines.test.mjs`：每機位可畫的線集合 = §E.1 表；無球位校正時 `ball_*_plane` 為 null＋`NO_CALIBRATION`。
5. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only v4-f-lab` → PASS：從 `valid_dtl_30` 結果頁 `shot-lab` 進入 → 8 張 `lab-phase`；`lab-line` 數 = 6；上一／下一問題按鈕可用；問題 chip 含 validity 字樣；
   練習卡「開始練習」導到 live 且 hero 指標 = 該量值；`document.querySelectorAll('a[href^="http"]').length === 0`。
6. `--only v4-f-patterns` → PASS：匯入 `lab-sessions.json` → `history-seg[data-seg=patterns]`，每列有 n 與區間；face_on 與 dtl 的問題不出現在同一列。
7. `node tests/e2e/screenshot_matrix.mjs --screens lab,lab:lines,lab:phase,lab:fault,patterns,shot` 0 findings（既有 shot testid 全保留）。

### G.4 順序與整合

1. V4-A drop 1（G.0 全部＋stub＋夾具＋基準值）。
2. 並行：V4-B、V4-C、V4-E、V4-F（純模組部分先、畫面後）；V4-D 從 drop 1 起用 C 的 stub＋round 夾具做畫面，C 合併後切真實作。
3. 合併順序任意，但 D 的 `v4-d-perf` 跨引擎檢查要等 C 合併後才算。每個 PR：G.2 共通驗收＋自己的 gates。
4. V4-A 整合 commit：移除 stub 與 `PACKAGE_PENDING`、`LAZY_*` 最終清單、`package.json` 版本 `0.4.0`、文件索引。
5. **fresh-context 驗收 agent**（實作者不自驗）：
   - `RUN_BROWSER_E2E=1 bash scripts/verify.sh` → `all stages passed`。
   - 完整截圖矩陣（既有全部 state ＋ §F.8 新 state）`--json` → 0 findings（3 主題 × 2 語系 × 2 字級 × 2 寬度）。
   - `dist/precache-manifest.json`：`shell_bytes ≤ 992000`、`precache_bytes ≤ 32500000`；`git diff -U0 scripts/build.mjs | grep -c 'BUDGETS = '` → `0`。
   - `node scripts/check_brands.mjs --root dist` 與 `--root .` 皆 0。
   - `node -e "console.log(require('./dist/precache-manifest.json').version.startsWith('0.4.0+'))"` → `true`。
6. 擁有者實機清單（寫進 `docs/device-checklist.md`）：速報延遲 P50／P95（A.5）；iOS 上 `captureStream`＋`MediaRecorder` 出 mp4 能否在「照片」播放與分享；飛越 fps；陽光下地圖可讀（sun 主題）；
   手套操作瞄準按鈕；一輪 9 洞 2 人實打的節奏（目標 ≤ 45 分鐘）。

---

## H. 風險與我們誠實贏不了的地方

| 風險／限制 | 影響 | 對策與 UI 溝通 |
|---|---|---|
| **沒有任何實機準確度驗證**（沒有發射監測器） | 所有球數據、模擬落點可能系統性偏差 | 永不宣稱準確率；每個數字 ±；詳情 sheet 寫方法；LMS §9 的「找一次監測器對照」仍是把「低」升「估」的唯一途徑 |
| 即時模式 carry 誤差大（face_on ±30–35%，dtl／hb 只是距離表） | 模擬成績主要反映「你平常打多遠」而不是這一球 | 落點 95% 橢圓、來源 chip（量到／推估／距離表／抽樣／手動）、記分卡固定聲明；建議用 face_on 打模擬（新回合 sheet 提示） |
| 左右在 face_on／dtl 量不到 | 模擬的方向感是抽樣 | 預設抽樣並標「抽樣」；可改直球模式；hb 240 才有真的左右 |
| 「0.2 s」在 web 上不可承諾 | 速度感可能輸競品 | 速報 P95 ≤ 1 s 的實際目標；不寫秒數；診斷顯示實測值 |
| 問題規則門檻是教學經驗值、非個人化 | 誤報或漏報 | 只在看得到的機位判；區間跨門檻寫「可能」；`relaxed` 選項；趨勢用比例＋區間；不做 casting 等看不到的問題 |
| iOS `MediaRecorder`／`captureStream` 行為（mp4 片段化、`requestFrame` 支援）UNVERIFIED | 影片可能無法在相簿播放 | webm／mp4 依 `pickMimeType`；失敗時退回 PNG 卡並說明；實機清單項 |
| 合成影片時間 ≈ 影片長度（即時繪製） | 等 10–15 s | 進度條＋取消；揮桿段 ≤ 4 s 控制總長 |
| shell 只剩約 25 KB | 超預算即建置失敗 | §F.7 每包上限＋`budget_delta.mjs`；新 CSS lazy；設定正規化放 lazy 模組 |
| 產生器跨引擎不一致 | 同種子不同球場 | 自寫決定性數學＋量化；round 存幾何快照；跨引擎 e2e |
| IDB 回合紀錄變大（18 洞 ≈ 150 KB） | 配額 | 單筆 256 KB 上限；`store/quota.js` 既有守門 |
| 自動推桿／切桿是模型 | 短桿成績不反映實力 | 標 `AUTO_PUTT`／`AUTO_CHIP`；可手動輸入推桿數；記分卡分開列推桿數 |
| 分享影片含本人身體影像 | 隱私 | 不含聲音；可選臉部馬賽克；分享前一次性提示（`share.privacy_note`） |

**不做（0.4.0）**：真實／授權球場、地形起伏與風、線上對戰或排行、帳號、外部教學影片連結、推桿點擊小遊戲、casting／桿面類問題、精算後回頭改模擬球位、影片含原聲、WebGL 函式庫。

---

## I. 版本與品牌檢查

- 版本：`package.json` `0.4.0`；build 產生 `APP_SEMVER = '0.4.0'`、`precache-manifest.version = '0.4.0+<10 hex>'`。
- 新 `scripts/check_brands.mjs`（V4-A；verify 新 stage `brands`，位於 `static` 之後），規則（全部不分大小寫；模式只能用字元類寫法，讓腳本與本檔本身不會命中）：

| 規則 | 模式 | 範圍 | 允許例外 |
|---|---|---|---|
| `competitor` | `\bgolf[r]\b` | **整個 repo 追蹤檔**＋`dist/`（app、docs、scripts、tests、README、schema） | 無 |
| `lm-brand` | `\btrack[ ]?ma[n]\b` | `app/`、`dist/` | 沿用 LMS §5.2：只在 `docs/`、`tests/unit/physics.ballistics.test.mjs` 註解內 |
| `feature-names` | `\bpocket[ ]?si[m]\b`、`\brange[ ]?finde[r]\b`、`\bhighlight[s]\b` | `app/i18n/**`、`app/src/**` 的字串字面值、分享檔名 | CSS 屬性 `-webkit-tap-highlight-color`、註解 |
| `accuracy-claim` | `(準確\|精準\|準度\|accura)[^"]{0,24}\d{1,3}\s?%`、`\d{1,3}\s?%[^"]{0,24}(準確\|精準\|準度\|accura)` | `app/i18n/**`、`dist/i18n/**` | 無 |
| `vendor-ban`（既有精神，集中化） | `ultralytics`、`opencv`（排除 LMS §5.2 的已知 guard 與座標慣例註解） | `app/src`、`app/i18n`、`app/styles`、`dist/` | 同 LMS §5.2 |

- 識別字命名規則：`golf` 後面不得直接接以 `r` 開頭的字（含駝峰寫法，雖然駝峰不會命中 `\b`）；回合相關一律用 `round`／`course` 命名。
- 截圖矩陣 OCR 不做；品牌檢查以文字為準。

---

## J. 擁有者決定（2026-11-07 定案）

| # | 問題 | 決定 |
|---|---|---|
| Q1 | 自動推桿預設程度 | 差點帶 20（擁有者 11-07） |
| Q2 | OB 預設規則 | `drop_2`：+2 就近打（擁有者 11-07） |
| Q3 | 手動輸入的數字是否進入距離表 | 不進入，只用於模擬（擁有者 11-07） |
| Q4 | 分享影片的 app 標記預設 | 關（沿用預設） |
| Q5 | 問題規則預設敏感度 | `standard`（擁有者 11-07） |
