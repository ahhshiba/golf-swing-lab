# 練習場架設指南（擁有者用）

> 這份是給你在練習場照著做的清單。所有數字抄自 [CAFCR.md](CAFCR.md)（C2 最佳架設規格、C3 定位方法、R5 的 P1），
> 沒有另外新增數字。第一次到場地實量之後，以實量值為準，並把結果填進 [device-checklist.md](device-checklist.md)。
> 專有名詞：**D**＝正面相機到球的距離；**Db**＝後方相機到球的距離；**h**＝手機中心離地高度；**B**＝球到面前隔板的距離。
> 世界座標：原點是球的位置，+x 朝目標，右打者站在 +y 側（左打全部鏡像）。
> 表格裡的 C1／C2／C3、P17、K11、待決定 7 等代號指 CAFCR.md 的章節；`#11`、`#15` 這類數字是 CAFCR F2 的指標編號。
> **即時模式**＝App 用相機即時拍（30–60fps），給姿勢與 tempo；**高速模式**＝用內建相機錄 240fps 慢動作再匯入 App，球數據只在這個模式出。

## 1. 先買什麼：三腳架採購規格

一支架子打三個角度、所有球桿（鐵桿、球道木、架球座的 driver）。穩定比高度重要：240fps 下架子一晃，墊子四角就會漂移，每次量得一樣這個目標就毀了。

| 項目 | 規格 | 理由 |
|---|---|---|
| 型式 | **鋁合金攝影三腳架**（三腳＋可升降中柱）＋球型雲台＋手機夾 | 240fps 下架子晃會讓墊角漂移、破壞重現（KD1）；穩定比高度重要 |
| 手機中心最高 | **≥1.7m**（含雲台與手機夾） | 高斜角後方 1.7m 已達理論最佳的 86–89%；拉到 2.0m 只多約 6 個百分點，而且 #15 的誤差由取樣點數主導 |
| 手機中心最低 | **≤0.60m** | 正面理想 0.84m；窄打位 D=2.2 要 ≤0.67m |
| 腳架 | 三節或四節腳、中柱可鎖死、中柱下有掛勾 | 戶外有風時掛背包壓重 |
| 承重標示 | ≥3kg | 代表剛性，不是因為手機重 |
| 雲台 | 球型、可往下俯 ≥45°（高斜角只要 30–32°）、附水平氣泡、**鎖緊後放手不下垂** | 下垂會讓幽靈框對不上 |
| 手機夾 | 夾得住 iPhone 14 加殼、可轉 90° 橫直 | 正面與高斜角橫拍、後方直拍 |
| 遙控 | 藍牙、支援 iPhone（等同音量鍵） | 高速模式不碰手機（KD7） |
| 不要買 | 單管「自拍棒腳架」（腳細，1.7m 會晃）；2m「燈架型」手機腳架（最低高度多半太高、中柱細） | — |
| 參考型號 | K&F Concept E224A3＋BH-18 雲台＋手機夾（賣場標示 360–1700mm、承重 4kg、附藍牙遙控；標示高度是否含雲台要看官方頁） | 符合規格的例子，不是唯一選擇 |

**不用追 2 公尺**：高斜角後方的手機高度只影響沿目標線方向的解析度，1.7m 已達理論最佳的 86–89%，2.0m 是 92–95%、1.5m 是 80–84%；而桿頭路徑誤差主要來自擊球點附近只拍到 1–2 個點，高度多出幾個百分點改變不了這點。

**真俯視不做**：需要 ≥2.5m 的吊臂把手機伸到打擊區正上方，一個人 5 分鐘內架不穩，掉落會砸到人。高斜角後方是唯一的高角度。

## 2. 帶去練習場的東西

手機、三腳架、藍牙遙控（多數附）、**捲尺**（第一次量墊子、球座高度、球到面前隔板距離）、**紙膠帶**（中柱標記，不貼隔板也行）。沒有捲尺時用 A4 紙沿邊排（±0.7%）。

## 3. 第一次到場地：先量這些（P1，一次性）

預設假設（量完之後覆寫）：墊子 1.50m（沿目標線）×1.25m；球放墊子長邊中點、距相機側長邊 0.30m；打位寬（隔板到隔板）約 3–3.5m（**會限制正面距離**：球到面前隔板 B ≥2.95m 才能用理想 D=2.7，見 C2 窄打位）；走道深 ≥3m；練習場有固定橡膠球座（高度 UNVERIFIED，P1 量）；球手身高 1.75m、右打（左打全部鏡像）。

| 要量什麼 | 怎麼量 | 門檻 | 記成 |
|---|---|---|---|
| 墊子長 `mat_L`（沿目標線的長邊） | 捲尺量兩次 | 兩次量差 ≤3mm | `venue.mat_L` |
| 墊子寬 `mat_W`（短邊） | 捲尺量兩次 | 兩次量差 ≤3mm | `venue.mat_W` |
| 坡度 | 手機平放墊上 3 秒，App 讀水平儀 | 穩定 ±0.1° | `venue.slope` |
| 球座高度（球底離墊子） | 把球放上練習場的固定橡膠球座，捲尺量球底到墊面 | 量到 ±5mm（沒量過 App 只能用 30±15mm 先驗，並標 `TEE_LIFT_ASSUMED`） | `venue.tee_lift_m` |
| 球到面前（相機側）隔板的距離 **B** | 從球位量到面前那片隔板，量完對照第 6 節窄打位表 | 腳架佔 0.25m，D＝B−0.25 | `venue.bay_B_m` |
| 打位寬、走道深度 | 捲尺量隔板到隔板、身後走道 | 打位寬約 3–3.5m、走道深 ≥3m 是假設值 | 記在 device-checklist |
| 中柱標記 | 紙膠帶貼在中柱上：正面 0.84m 一道、後方 1.00m 一道、高斜角最高或固定刻度 | — | —（貼在器材上） |
| 隔板標記（可行時） | 在相機側隔板底部貼標記點，腳架前腳頂住；不能貼就用球桿量距 | — | `venue.ref_points` |
| 鎖定焦距 f | 做一次完整架設（第 7 節），用放大鏡點墊子四角 3 次，取平均解 f 並鎖定 | 三次 f 解的 SD ≤1% | `venue.f_locked` |

P1 全部加起來約 **8.6–9.9 分**（其中做一次完整架設佔 3.8–4.1 分），新場地一次性目標 ≤10:00。同一個練習場換打位＝同一個 venue、不同 preset；墊子尺寸和上次差 >1% 時 App 會提示「可能換了墊子」，要重做 P1。

## 4. 每個角度怎麼架

每次練習每個角度都要架一次（≤5 分鐘）。換角度就換橫直、重新架設，每個角度各算 5 分鐘。

### 正面 face_on

| 項目 | 規格 |
|---|---|
| 物理定位 | 腳架前腳頂住**相機側隔板底部**的標記點；或從墊子相機側長邊量 2.4m（兩支 driver 長＋約 0.1m） |
| 側向 | 球手正前方再**往目標側平移 +0.3–0.4m（不轉向）** |
| 距離（到球） | D≈2.7m（2.7–3.0；<2.7 見窄打位，D=2.5 時 h 上限 0.79） |
| 高度（手機中心） | **0.84m（0.82–0.86）**；h=0.88 時墊子近端角出框、h=1.0 墊子整個出框 |
| 俯仰／滾轉 | 0±1°／±0.5° |
| 偏航 | ⊥ 墊子長邊 ±1.5° |
| 方向 | **橫拍**（直拍到出畫面只剩 6.6/4.2/3.6 幀） |
| 中柱標記 | 0.84m 一道 |
| 鏡頭／慢動作 | 1x；240fps（禁 120）；720p240 H.264 或 1080p240 HEVC（M2 定，720p 球寬 14.9px 接近 ≥12px 門檻） |
| 入鏡 | address 全身＋墊子四角在置中 95% 框；上桿頂點手高 >2.05m 進邊界帶、桿頭頂點會出框（可接受，Top 事件看手腕） |

### 後方 dtl

| 項目 | 規格 |
|---|---|
| 物理定位 | 腳架中柱對準**墊子中線（長軸）的延長線**（目視沿墊子兩短邊中點瞄）；距墊子後短邊 2.25–2.75m |
| 側向 | 中線上（＝手部延長線，球線往球手側約 0.35m） |
| 距離（到球） | Db 3.0–3.5m |
| 高度（手機中心） | 1.00m |
| 俯仰／滾轉 | 0±1°／±0.5° |
| 偏航 | ∥ 長邊 ±1.0°（長邊消失點在中心欄） |
| 方向 | **直拍** |
| 中柱標記 | 1.00m 一道 |
| 鏡頭／慢動作 | 1x；即時 30–60（高速 240 也可） |
| 入鏡 | 全身＋四角 |

### 高斜角後方 high_behind（選配）

| 項目 | 規格 |
|---|---|
| 物理定位 | **球線**延長線（墊子相機側長邊往球手側 0.30m 的平行線，約 7 顆球寬）；距墊子後短邊 2.0–2.25m |
| 側向 | 球線上，側偏 ≤0.15m（不可放墊子中線，差 0.33m） |
| 距離（到球） | 2.75–3.0m（driver 安全距離） |
| 高度（手機中心） | 腳架最高（約 1.7m，標記） |
| 俯仰／滾轉 | 對準球（俯角 = atan(h/Db)：約 30–32°），相對預設 Δφ ≤1.0°；滾轉 ±0.5° |
| 偏航 | ∥ 長邊 ±1.0° |
| 方向 | 橫拍 |
| 中柱標記 | 最高或固定刻度 |
| 鏡頭／慢動作 | 1x；240 |
| 入鏡 | 墊子四角＋球＋桿頭擊球段 |

### 打不同球桿的三條規則

同一個機位打所有球桿，球的位置和球座高度要固定：

- **球座高度要量一次**（第 3 節）。架在球座上的球被當成放在墊子上時，每 10mm 球座高，球速與深度約多算 1.25–1.3%（30mm +3.8%、50mm +6.5%），而且無法可靠地從球本身看出來。
- **所有球桿的球放在同一點（±10cm）**，相機側向基準就是這一點；±10cm 在 70m/s 時影響約 ±0.3–0.4 幀。
- **高斜角後方離球 2.75–3.0m**：上桿時桿頭往後掃的直線上限，鐵桿 1.56m、driver 1.92m，Db ≥2.75m 才讓 driver 留 ≥0.8m 的安全距離。

## 5. 正面的框景提醒

正面相機往目標側平移 0.4m 後，球往目標側的畫面寬 2.14m，往後（上桿）側只剩 1.34m（球所在平面、置中 95% 框）。所以上桿到桿身水平附近，桿頭會短暫出框（鐵桿可能、driver 一定），上桿頂點桿頭也會出框；這是可接受的：桿頭追蹤只用擊球前後那一段，上桿頂點（Top）看手腕，手腕在框內。

## 6. 窄打位（正面）

先量 B（球到面前隔板），腳架佔 0.25m，所以 D＝B−0.25。限制是墊子近端兩角要在置中 95% 框內，以及 address 頭頂要在畫面內。

| B | D | 手機高度上限 | 平移 | 正面飛行幀數 48/60/70m/s | 身體平面畫面頂（95%） | 判定 |
|---|---|---|---|---|---|---|
| ≥2.95m | 2.7 | 0.84（上限 0.87） | 0.4 | 9.7／7.4／6.1 | 2.07m | 理想 |
| 2.65m | 2.4 | ≤0.74 | 0.4 | 8.7／6.6／5.5 | 1.86m | 可用 |
| 2.45m | 2.2 | ≤0.67 | 0.4 | 8.1／6.1／5.1 | 1.72m | 可用；driver >70m/s 常 `TRACK_TOO_SHORT` |
| <2.45m | <2.2 | D=2.0 時 ≈0.59 | D=2.0 時上限 0.34 | D=2.0 時 7.2／5.4／4.4 | 1.57m（頭頂進邊界） | 正面球數據不保證；改以後方／高斜角為主，或試 0.5x 超廣角（240fps 是否支援、畸變 UNVERIFIED） |

B <2.45m（表的最後一列）時，正面只做姿勢分析，球數據改由後方或高斜角取得。

## 7. 現場步驟 C0–C10（含估時）

C1 的「物理定位」就是第 4 節各角度表的第一列。C10 只在高速模式用，取代 C5。

| 步驟 | 使用者動作 | App 自動檢查與門檻 | 失敗補救 | 估時 |
|---|---|---|---|---|
| C0 裝機 | 展開、夾手機、切橫直 | — | — | 45s |
| C1 物理定位 | 依 C2「物理定位」放腳架；中柱到膠帶標記 | — | — | 30s |
| C2 開 App | 一次點擊「開始練習」（P2） | 權限全取得 | 見 P17 | 20s |
| C3 水平 | 調雲台（與 C4 同時） | 正面／dtl：\|φ\|≤1.0°、\|ψ_r\|≤0.5°；high_behind：相對預設 Δφ≤1.0° | 無感測器→由墊子解（`NO_GRAVITY_REF`） | 含在 C4 |
| C4 幽靈框對齊 | 微調到墊子四角落在幽靈點 | 四角距幽靈點 ≤8px | 墊子被移動→以墊子為準重對 | 75s |
| C5 墊角精修 | 確認自動偵測，或放大鏡點選四角 | 邊線殘差 ≤1.5px；RMSE ≤2.0px；以鎖定 f 解位姿；另做一次 f 自由解作格式檢查：\|Δf\|≤4%（放大鏡 1px，≈5σ）／≤6%（自動 3px） | 對比不足→手點；f 偏差→檢查倍率與慢動作格式 | 30–45s |
| C6 位姿 | — | 絕對門檻見 C1；相對預設 Δθ≤1.0°、Δφ≤1.0°、Δψ_r≤0.5°、ΔD≤50mm、ΔX≤50mm、Δh≤30mm | 依箭頭微調 | 自動 |
| C7 球 | 放球（所有球桿放同一點） | 球**水平寬**與位姿預測差 ±6%；≥12px；幀數預算 ≥6；判斷有無球座（有→`lie=tee`，套 venue 球座高度） | 移動放球位置 | 15s |
| C8 框景 | address 姿勢 2 秒 | 關鍵點外留 ≥5%；之後每桿事後檢查 Top 手腕是否出框（出框→`low_confidence` 該桿 #11） | 調高度 | 10s |
| C9 鎖定 | 按「鎖定」 | 存 calibration、preset_id、偏差 | 紅燈可強制開始→`SETUP_UNVERIFIED` 降級（待決定 7） | 5s |
| C10 高速模式校正短片（取代 C5） | 釋放相機→內建相機錄 2 秒空墊慢動作→匯入 | 在短片上做 C5 的全部檢查；兩幀四角漂移 ≤1px | 重錄 | 70s |

- **時間加總（已驗算）**：即時模式 C0–C9 ＝ **230–245s（3:50–4:05）**；高速模式 C10 取代 C5 ＝ **270s（4:30）**。每段練習每角度做一次。
- 之後每支影片比對看得到的墊角，漂移 >2px 標 `CALIB_STALE`。
- **落球測試（K11，選配，每月一次或懷疑時）**：高速模式下在球位上方約 1m 放手讓球自由落下，fit3d 擬合的重力須 9.81 ±3%，否則比例尺或時間基準有問題（P19）。

## 8. 墊子看不到或不是矩形時

App 會自動降級，`calibration.method` 會記錄用了哪一級：

1. `mat_pnp` 墊子四角＋鎖定 f：偏航 σ 0.1–0.3°、球速 ±0.5–1.0%（保守 1.5–2.5%）。
2. `club_line` 一支球桿平放沿目標線＋重力：偏航 σ ≈1.3–2°、球速 fit3d ±2–3%。
3. `ball_only` 只有球＋重力＋目測：偏航 3–5°、fit3d ±3–4%、線性 ±4–7%；身體平面靠身高 ±3–5%。
4. 選配升級：兩支對齊桿 T 形（σ 0.16°／0.5° @1px／3px）——只有草地或非矩形墊才需要買。

---

## App: practice-flow implementation and contracts (WP-B, for developers)

What the practice screens do, where the numbers come from, and what other packages and the e2e gates can rely on.
Spec: `docs/PRODUCT-SPEC.md` §2.2, §2.3 (Practice, Venue, Setup, Live), WP-B.

### Screens and files

| screen | file | notes |
|---|---|---|
| Onboarding (first launch) | `app/src/ui/onboarding.js` | rendered inside the home root; root gets class `is-onboarding` (main.js hides the tab bar on it) |
| Practice (home) | `app/src/ui/home.js` | context rows open sheets; `開始練習` calls `controller.startPractice()` synchronously from the click |
| Venue wizard / list | `app/src/ui/venue.js`, `app/src/ui/venues.js` | `nav.go('venue')` new, `{ venue_id }` edit, `{ list: true }` list |
| Setup stepper | `app/src/ui/setup.js`, `magnifier.js`, `tripod-diagram.js` | six steps, camera-off state |
| Live scoreboard | `app/src/ui/live.js` | forced dark (`data-live-theme="dark"` on its root unless the theme is sun) |
| Pure helpers | `app/src/session/bay.js`, `app/src/calib/checks.js` | numbers and codes only, no prose |

Styles: `app/styles/screens/practice.css` (tokens only). Catalogs: `app/i18n/{zh-Hant,en}/{onboarding,home,venue,setup,calib,live,bay,health,camera}.json`.

### Where the tripod goes (step 1, UX-02)

`tripodPlacement(venue, view)` in `session/bay.js` (world: ball at the origin, +x toward the target, mat near edge at
y = −ball_edge_m):

| view | phone | distance | height | sideways |
|---|---|---|---|---|
| face-on | landscape, 1× | D = B − 0.25 m capped at 2.7 m (CAFCR C2 bay table), else 2.7 m | min(0.84 m, bay limit) | 0.40 m toward the target (0.34 m in a bay < 2.45 m) |
| DTL | portrait, 1× | 3.25 m behind the ball on the target line | 1.0 m | 0.35 m toward the golfer |
| high behind | landscape, 1× | 2.875 m behind the ball | 1.7 m | 0 |

The screen shows the distance from the nearest mat edge (what the user measures), the lens height, the sideways move,
the orientation, and the distance in driver lengths (1.15 m each) as a tape alternative. The ghost frame in step 3 is
projected from the same numbers, so diagram and ghost agree. Lengths use `settings.units.body` (cm, or ft/in above 0.9 m
for imperial).

### Setup steps

1. **Tripod**: diagram + numbers, angle picker (segmented, labelled).
2. **Level**: bubble; auto-advance after 1 s inside ±1.0° pitch / ±0.5° roll. No sensor after 3 s, or motion
   denied: a notice and "continue without the level" (shots then carry `NO_GRAVITY_REF`).
3. **Mat corners**: ghost frame on the preview; the picker freezes a frame, 2× loupe, fine adjust (corner 1–4, ±1 px
   arrows, long-press repeat, ×10, next corner; arrow keys / Shift ×10 / 1–4 / Enter on the focused canvas). After the
   first solve the focal length locks from 3 refined solves taken automatically 1 s apart (SD ≤ 1 %); otherwise the
   user can tap again. High-speed mode adds the calibration-clip card.
4. **Ball**: rest-ball detection, or skip.
5. **Address**: hold 2 s (manual confirmation; no automatic framing check yet).
6. **Done**: green → start; amber → start with the notes; red → one plain fix instruction from `fixInstruction()`
   (most fundamental failing check, with direction and amount) + "start anyway" through a ConfirmSheet. The list of
   failing checks is a disclosure with `calib.check.*` labels. Pose numbers, RMSE and the C0–C10 timer show only with
   `settings.dev`. When the preview is very bright (mean luma > 200) the Sun display is suggested once.

Camera denied / busy / missing (from `permissions.camera` and the getUserMedia error name) replaces the screen with a
recovery state: `camera-retry` (same-click `controller.reopenCamera()`), `camera-import-instead` (ends the session,
sets high-speed mode, opens Import). Microphone denied is a non-blocking notice.

### Live (R1, V11, ux-m1)

- `attachStream(stream?)`: main.js calls it after `controller.reopenCamera()`; the screen also subscribes to
  `controller.onStreamChange` when the controller has it, and to `state.cameraInterrupted`. The preview and the whole
  capture chain (frame tap, segment recorder, onset detector, live loop) move to the new stream; a start that was
  overtaken tears itself down.
- In-screen recovery: when the camera stops, the pill turns to error and `live-reopen` re-opens it (same click).
- Club chip (`live-club`): a sheet of clubs; the choice is written into the live loop's `clipOptions.club`, which the
  next analysis job reads, and to `controller.setClub()` when present. Diag: `live.next_club`, `live.job_club`.
- Hero numbers: `settings.live.metrics` filtered to what the live mode measures (`LIVE_MEASURABLE`), `--t-hero`
  (56 px at 100 % text) in portrait, `clamp(3.5rem, 15vh, 7rem)` in landscape.
- Voice readout after each shot (`settings.live.voice`), zh-TW or en-US voice.
- 結束練習 asks with a ConfirmSheet only when the session has shots.

### Contracts other packages use

- `mountVenues(root, app, { header })` from `ui/venues.js` → `{ show(), hide() }` (Settings › Venues).
- Re-run onboarding (Settings › Help): `app.nav.go('home', { onboarding: true })`.
- `calibHealth().prompts[]` = `{ id, level, code, params }`; render with `msg(p)` (`code` is `health.prompt.*`).
- `bayAdvice(B)` = `{ ok, B_m, D_m, h_max_m, h_nominal_m, shift_m, verdict, row }` (`h_max` / `shift` kept as aliases);
  words in `bay.verdict.<v>`, `bay.body.<v>` (`{D} {h} {shift}`), `bay.short.<v>`.
- `calib.check.<check>` labels for every `evaluate()` failure; params `{ limit }` (and A's `{ value }`).

### e2e

Gates: `tests/e2e/gates/b-practice.mjs` (`b-onboarding`, `b-camera-denied`, `b-reopen`, `b-setup-steps`,
`b-live-glance`, `b-home`, `b-checks`). Seams, all through `globalThis.__GSL_E2E__` set before boot:

| seam | effect |
|---|---|
| object present | setup shows `btn-skip-setup`; the picker canvas carries `data-ghost` (ghost corners in image px) |
| `onboarding: true` | an automated browser (`navigator.webdriver`) still shows onboarding; without it onboarding is skipped so the older gates start on the home form |
| `pose(bitmap, t_s, model, o)` | replaces MediaPipe in live (gate m5's disc stand-in, or b-practice's scripted swing) |

Test ids: `onb-next`, `onb-skip`, `onb-allow`, `onb-mode-live|highspeed`, `onb-no-tripod`, `setup-step[data-step]`,
`setup-primary`, `setup-skip-level`, `setup-skip-ball`, `setup-tripod`, `setup-fix`, `camera-off[data-kind]`,
`camera-retry`, `camera-import-instead`, `live-state`, `live-hero`, `live-club`, `live-club-sheet`, `live-end`,
`live-reopen`, `live-last`, `live-count`, `btn-start-practice`, `nav-import|venue|history|settings|diag|about`,
`home-venue|view|club|mode|preset`, `home-back-live`, `home-end`, `venue-step[data-step]`, `venue-primary`,
`venue-row`, `venues-add`.

### iPhone-only checks

Real permission prompt order and the sticky-deny recovery text; tripod diagram against a real bay; hero number
readable at 2.7 m in sun and in a dim bay; glove taps on the corner fine adjust; speechSynthesis voice in zh-TW and en;
landscape on notch devices (safe areas); wake lock during live.
