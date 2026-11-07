# Golf Swing Lab — 發射監測器級功能規格（LAUNCH-MONITOR-SPEC v1，2026-11-06）

> 給實作 agent 的派工規格。Repo：`/home/simon/Desktop/golf-swing-lab`（0.2.0+ec90647ec8，Node 18、純 ES modules、無打包工具，
> 驗證入口 `bash scripts/verify.sh`）。目標：做到「Trackman 等級的功能」（內部參考用語），UI 改成大數字深色儀表風格。
> 物理依據、來源、MC 重算在 `docs/research/launch-monitor-physics.md`（下稱 **RN**），本檔引用它的段落（RN §n）。
> 規範用語 MUST／SHOULD 同 RFC 2119。「機械判定」＝在 `bash scripts/verify.sh` 或 `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs` 裡印 PASS/FAIL，不需要人判斷。

## 0. 擁有者裁示與硬約束（本規格全部遵守）

| 來源 | 內容 |
|---|---|
| 11-06 裁示 1 | 量不到的（旋轉量、旋轉軸、桿面角、動態仰角、spin loft…）**用物理反推**（D-plane、spin-loft 模型），一律標「估」＋誤差範圍，絕不冒充實測（契約 `measured` 永遠 `false`） |
| 11-06 裁示 2 | 四組功能全做：(a) 完整數據表；(b) 影片 tracer＋俯視散佈圖＋2D/3D 彈道；(c) 練習與測驗（目標距離、距離表 gapping、固定題目測驗與分數）；(d) 統計與比較 |
| 11-06 裁示 3 | UI：深色底、大數字數據磚、使用者自選欄位、彈道圖為主角；保留淺色與 sun 主題 |
| 硬體 | 一支 iPhone，240 fps 慢動作，球寬 15–22 px；**一次一個機位**：face_on／dtl／high_behind |
| 契約不變式 | `value≠null ⇔ validity∈{valid,estimated,low_confidence}`；null 必有原因碼；非 null 必有 ci95 或 sigma；每個原因碼要有 zh-Hant 與 en 說明 |
| lint | `check_i18n --strict`（app/src 0 個 CJK 字面值）；`check_tokens --strict` |
| 法務 | GolfDB 衍生物不進產品；禁 Ultralytics、OpenCV.js；不對外部網域發請求；**產品內不得出現 Trackman 名稱、商標或其視覺識別**（只在 docs 內部用語；產品用通用術語，見 RN §0） |
| 預算 | shell ≤ 1,000,000 B（目前 949,715 B，剩約 50 KB）；precache ≤ 35,000,000 B（目前 31,663,391 B）。**不准提高預算**；新畫面一律 lazy（`scripts/build.mjs` `LAZY_FILES`，算 precache 不算 shell） |

**單一機位的根本限制（貫穿全文）**：每一球只來自一個機位。face_on 看得到球速、發射角、桿速、攻擊角，**看不到左右**；
high_behind 看得到起飛方向、桿頭路徑，**看不到球速與發射角**；dtl 什麼球數據都沒有。所以 D-plane 的水平半邊只能在
high_behind 做、垂直半邊只能在 face_on 做。任何「把兩個機位的資料拼成一球」的做法都是統計拼接，不是同一球的量測 → 見 §1.4 跨機位選項（預設關）。

---

## 1. 參數表

### 1.1 分類與 fps 規則

- **實測**：該量本身由影像追蹤直接求得（仍經過校正與擬合，所以 validity 是 `estimated` 或 `low_confidence`，不是 `valid`；沿用 CAFCR F2 的規則）。
- **推估**：由實測量經物理模型反推（D-plane、spin-loft、飛行 RK4、滾動表）或混入先驗；validity `estimated`／`low_confidence`，
  reason_codes 必含模型碼（§2.3）。
- **不可**：null＋原因碼。
- **fps**：所有球／飛行／D-plane 參數 **< 200 fps → null＋`FPS_TOO_LOW`**（沿用 `result.js` 的 `BALL_MIN_FPS`）；攻擊角、high_behind 桿速、桿頭路徑需 **≥ 240**（`fpsAtLeast` 容差）。
  **30–60 fps 即時模式與 120 fps：下表除了 face_on 桿速（現有，`low_confidence` ±25%）以外全部是 null。** 下表列的是 240 fps 的格子。

### 1.2 參數 × 機位（240 fps）

代號：**實**＝實測、**推**＝推估、**—**＝不可；括號＝validity（估＝estimated、低＝low_confidence）。σ 為 1σ，來源欄指 RN 段落；新原因碼見 §2.3。

| # | id | 參數 | face_on | dtl | high_behind | 方法與輸入 | 預期 1σ | 原因碼（有值時附加／不可時） | 與現行 F2 差異 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `club_speed_mps` | 桿頭速度 | 實（估） | — | **實（低）** | fo：現行 `physics/club.js`；hb：地面投影桿頭軌跡的路徑長／時間 ÷ cos(攻擊角先驗)（RN §7） | fo 2–3%；hb 15–20%（中位 17%；原估 5–8% 漏了桿頭高度項，RN §7 更正）UNVERIFIED | hb 有值：`TRACK_MAY_BE_SHORT` 視情況；不可：dtl `VIEW_DEPTH_AXIS` | hb 由「不可」改「低」 |
| 2 | `attack_angle_deg` | 攻擊角 | **實（低）** | — | — | fo：撞擊前 2 幀桿頭軌跡在球平面的垂直分量（同 `club.js` 的平面），弧線曲率修正 κ_v（類比 `clubpath.js` 的 κ） | 1.5–2.5° UNVERIFIED（RN §8-6） | 不可：dtl `VIEW_DEPTH_AXIS`；hb `VIEW_PLANE_MISMATCH`；取樣 <2 點 `TRACK_TOO_SHORT` | 新增 |
| 3 | `club_path_deg` | 桿頭路徑 | — | — | 實（低） | 現行 `physics/clubpath.js` | 2–4°（C1.3） | 不可：fo/dtl `VIEW_PLANE_MISMATCH` | 不變 |
| 4 | `dynamic_loft_deg` | 動態桿面仰角 | **推（估）** | — | — | 垂直 D-plane 反推 `DL=(LV−(1−v)·AoA)/v`，`v(SL)` 內插（RN §1） | 1.0–2.6°（RN §5） | `DPLANE_MODEL`；不可：dtl `VIEW_DEPTH_AXIS`、hb `DEPENDS_ON_NULL` | 新增 |
| 5 | `face_angle_deg` | 桿面角 | — | — | **推（低）** | 水平 D-plane 反推 `F=(LH−(1−h)·P)/h`，`h(SL)` 內插；SL 用球桿先驗（RN §1） | 1.0–2.6°（path σ 2–4°） | `DPLANE_MODEL`、`SPIN_LOFT_ASSUMED`；不可：fo/dtl `LAUNCH_DIR_UNOBSERVABLE` | 新增 |
| 6 | `face_to_path_deg` | 桿面對路徑 | — | — | **推（低）** | `(LH−P)/h` | 2.8–6.3° | 同 #5 | 新增 |
| 7 | `spin_loft_deg` | 旋轉仰角 | **推（估）** | — | — | 3D 夾角 ∠(ĉ, n̂)，由 #2、#4 與 path=0、face=0 假設（fo 看不到水平，小角度下水平分量對 SL 影響 <0.3°） | 2.1–4.1° | `DPLANE_MODEL`；不可：dtl `VIEW_DEPTH_AXIS`、hb `DEPENDS_ON_NULL` | 新增 |
| 8 | `ball_speed_mps` | 球速 | 實（估） | — | **推（低）** | fo：現行 fit3d；hb：#1 × smash 先驗（RN §7） | fo 1.5–2.5%；hb 16–19%（原估 6–9%，RN §7 更正）UNVERIFIED | hb：`SMASH_ASSUMED`；不可：dtl `VIEW_DEPTH_AXIS` | hb 由「不可」改「低」 |
| 9 | `smash_factor` | 擊球效率 | 實（估） | — | — | 現行（#8／#1，K6 系統項相消） | ≈1.5–3% | 不可：dtl `DEPENDS_ON_NULL`、hb `DEPENDS_ON_NULL`（hb 的球速是用 smash 算的，回報會循環） | 不變 |
| 10 | `launch_v_deg` | 發射角 | 實（估） | — | — | 現行 fit3d | 0.1–0.3° | 不可：dtl `VIEW_DEPTH_AXIS`、hb `VIEW_DEPTH_AXIS`（深度耦合） | 不變 |
| 11 | `launch_h_deg` | 起飛方向 | — | — | 實（低） | 現行 `launch_h.js` | 0.3–0.6° | 不可：fo/dtl `LAUNCH_DIR_UNOBSERVABLE` | 不變 |
| 12 | `spin_rate_rpm` | 旋轉量 | **推（估）** | — | — | spin-loft 模型 `A_club·v_c·sin(SL)/r` 與球桿先驗反變異數合併（RN §2） | 16–19%（原估 12–17%；先驗 σ 下限 30% 後，RN §2 實作修正、§9）（純物理 17–26%） | `SPIN_MODELLED`；不可：dtl `VIEW_DEPTH_AXIS`；hb `DEPENDS_ON_NULL`（只剩先驗，不顯示純先驗） | 新增（現行 carry 內部用先驗、不回報） |
| 13 | `spin_axis_deg` | 旋轉軸 | — | — | **推（低）** | D-plane 向量 ŵ ∥ ĉ×n̂（RN §3）；hb 的 AoA、DL 用球桿先驗 | driver 11–19°、7 鐵 6–12°、PW 4–8° | `DPLANE_MODEL`、`SPIN_LOFT_ASSUMED`；不可：fo/dtl `LAUNCH_DIR_UNOBSERVABLE` | 新增 |
| 14 | `carry_m` | 飛行距離 | 推（估） | — | **推（低）** | RK4（`ballistics.js`）；fo：#8、#10、#12、axis=0；hb：#8、發射角先驗、#13 | fo 3.5–7.5%（含模型 3%）；hb 20–26%（原估 8–13%，RN §7 更正）UNVERIFIED | 現有 `SPIN_ASSUMED`→fo 改 `SPIN_MODELLED`；`WIND_IGNORED`、`FLIGHT_MODELLED`；hb 加 `SMASH_ASSUMED`、`LAUNCH_V_ASSUMED` | hb 由「不可」改「低」 |
| 15 | `total_m` | 總距離 | **推（估）** | — | **推（低）** | carry + roll 表（落地角 × 草況，RN §6） | fo carry σ ⊕ 50%·roll（driver ≈ ±12 m） | `ROLL_MODELLED` ＋ #14 的碼 | 新增 |
| 16 | `carry_side_m` | 落點偏移 | — | — | **推（低）** | RK4 落點的 y（起飛方向 #11 ＋ 傾斜轉軸 #13） | driver 21–37 m、7 鐵 9–17 m、PW 4.5–9 m | `DPLANE_MODEL`、`FLIGHT_MODELLED`；不可：fo/dtl `LAUNCH_DIR_UNOBSERVABLE` | 新增 |
| 17 | `total_side_m` | 總偏移 | — | — | **推（低）** | #16 ＋ roll 沿落地水平速度方向 | 同 #16 略大 | ＋`ROLL_MODELLED` | 新增 |
| 18 | `curve_m` | 彎曲量 | — | — | **推（低）** | 落點相對起飛方向直線的橫移 | ≈ #16 | 同 #16 | 新增 |
| 19 | `apex_m` | 最高點 | **推（估）** | — | — | RK4 最高點 | 1.3–3.8 m ⊕ 模型 10% | `FLIGHT_MODELLED`；不可：hb `LAUNCH_V_ASSUMED`（只剩先驗）、dtl `VIEW_DEPTH_AXIS` | 新增 |
| 20 | `landing_angle_deg` | 落地角 | **推（估）** | — | — | RK4 落地速度俯角 | 1.6–3.2° ⊕ 模型 3° | 同 #19 | 新增 |
| 21 | `hang_time_s` | 滯空時間 | **推（估）** | — | — | RK4 時間 | 0.13–0.43 s | 同 #19 | 新增 |
| 22 | — | 揮桿平面 swing plane | — | — | — | dtl 只有手部平面（現行 F2 #10）；桿身平面在擊球時拖影 | — | 不進契約 | 不做 |
| 23 | — | 揮桿方向 swing direction | — | — | — | 需要 3D 揮桿弧 | — | 不進契約 | 不做 |
| 24 | — | 最低點 low point | — | — | — | 需要擊球前後多點桿頭高度，240 fps 只有 1–2 點 | — | 不進契約 | 不做 |
| 25 | — | 擊球點 impact height/offset | — | — | — | 球寬 15–22 px，桿面看不清 | — | 不進契約 | 不做 |
| 26 | — | 動態桿身傾角 dynamic lie | — | — | — | dtl 擊球幀桿身拖影 | — | 不進契約 | 不做（研究項） |

**計數（240 fps、每機位 26 列）**

| 機位 | 實測 | 推估 | 不可 |
|---|---|---|---|
| face_on | 5（#1 #2 #8 #9 #10） | 8（#4 #7 #12 #14 #15 #19 #20 #21） | 13 |
| dtl | 0 | 0 | 26（球／桿資料全無；dtl 照舊只給身體指標） |
| high_behind | 3（#1 #3 #11） | 9（#5 #6 #8 #13 #14 #15 #16 #17 #18） | 14 |

**刻意的誠實選擇**：hb 的 #12 spin、#19–21 apex／落地角／滯空會**幾乎完全由先驗決定**（發射角看不到），所以填 null；
hb 的 carry 保留（主要由 hb 桿速決定），但標「低」。driver 的 #16–18 數字範圍很寬（±20–37 m），UI 必須把範圍畫出來（§3.4）。

### 1.3 與現行 F2 表（CAFCR）差異摘要

1. 新增 14 個 metric id：#2、#4–7、#12、#13、#15–21。
2. 三個格子由「不可」改「低」：hb 的 `club_speed_mps`、`ball_speed_mps`、`carry_m`（全部新方法，UNVERIFIED，需 M4 類的實地驗證前不得改成「估」）。
3. face_on 的 carry：原因碼由 `SPIN_ASSUMED` 改為 `SPIN_MODELLED`（spin 不再是純先驗）；`SPIN_ASSUMED` 保留給 hb 與舊資料。
4. `metrics/registry.js` 的 ROWS 新增 14 列（F2 列號 21–34），`depends` 依上表；`cellFor` 不改簽名。
5. `docs/metrics-by-view.md` 與 CAFCR F2 的對照由 LM-A 更新（CAFCR.md 本身不改，加一行指向本檔）。

### 1.4 跨機位選項（預設關；待擁有者決定 D2）

`settings.lm.crossView = false`。開啟時，hb 球可以向同一支球桿近 30 天、≥ 20 球 face_on 的「球桿檔案」借 AoA、DL、發射角、spin 的平均與 SD 當先驗：
#4、#7、#10、#12、#19–21 在 hb 變成「推（低）」，加 `CROSS_VIEW_PRIOR`。這是**統計拼接**（不同球的平均），不是同一球的量測；UI 在這些磚上加註「借用正面機位平均」。

### 1.5 誤差傳遞（MC）

- 延用 `physics/mc.js` 的 K6 原則：每個 draw 抽一次系統項，並一致套用到同一 draw 的所有輸出。新增的系統項：
  `h`、`v` 單球比值（N(·, σ_h／σ_v)）、`A_club`（×N(1, 0.15)）、spin 先驗、roll 比例（×N(1, 0.5)，截在 ≥0）、
  `APEX_MODEL_SIGMA_FRAC 0.10`、`LANDING_MODEL_SIGMA_DEG 3`、`CARRY_MODEL_SIGMA_FRAC 0.03`（現有）、hb 的 smash 先驗、發射角先驗。
- 每個 draw 跑一次 RK4（dt 4 ms），n = `LM_MC_DRAWS`（預設 256）。`ci95` = 2.5–97.5 百分位（放寬到包含值），`sigma` = SD。
- 可調參數全部集中在 `app/src/physics/lm/params.js`（凍結物件＋`version`），寫進 `algorithms.lm.version`，
  sha256 由 assemble 計算，讓統計比較能偵測模型版本不同（§3.7）。
- 效能預算：衍生計算 ≤ 1.5 s／球（node、單執行緒，`tests/unit/lm.perf.test.mjs` 以 CPU 時間量），不使 KD4（高速模式 ≤ 45 s／球）退步。

---

## 2. 契約：`golf-shot/2`

### 2.1 版本策略（決定：v2＋無損遷移）

v1 的 `metrics` 用 `additionalProperties:false`＋`minProperties:22` 規定「剛好這些 id」，`value_origin` 是封閉 enum，
現有測試夾具 `bad_missing_metric_id.json`、`bad_unknown_metric_id.json` 依賴這點。在 v1 加欄位會讓舊檔或舊驗證器其中一邊失效，
所以**升 `golf-shot/2`**：

- `schema/shot-v2.schema.json`（新）；`schema/shot-v1.schema.json` **不動**（仍用來驗證匯入的舊檔）。
- `app/src/contract/migrate.js`（新，純函式）：`migrateShot(any) -> {shot: v2, migrated: boolean}`。v1 → v2：
  新增的 14 個 metric 填 `not_computed`＋`MIGRATED_V1`；`flight: null`、`tracks: null`、`practice: null`；
  `algorithms.lm = {version: 'none', sha256: sha256('none')}`；其餘欄位原樣。冪等（v2 輸入原樣返回）。
- 讀：IDB 裡的舊 v1 shot **讀取時遷移**（`store/core.js` 的 `shots.get/list` 經 `migrateShot`），背景每批 50 筆寫回（不開長交易）；匯入備份接受 v1／v2。
- 寫：一律 v2。匯出 v2。**舊版 app 無法匯入 v2 備份**：About／匯出畫面加一行說明。
- 重新推導：`physics/lm/index.js` 提供 `rederive(shot, ctx)`，只用已存的 metrics＋club＋view 就能補算 D-plane／flight 類（不需重跑影像）；
  結果頁在 `algorithms.lm.version` 為 `none` 或落後時提供「用新模型重算」按鈕，產生新 revision（現有 `history` 機制）。

### 2.2 v2 的差異（其餘與 v1 相同）

```
schema: 'golf-shot/2'
algorithms: { ...v1, lm: {version, sha256} }                       // 新增 key
metrics: { ...v1 的 22 個, attack_angle_deg, dynamic_loft_deg, face_angle_deg, face_to_path_deg, spin_loft_deg,
           spin_rate_rpm, spin_axis_deg, total_m, carry_side_m, total_side_m, curve_m, apex_m,
           landing_angle_deg, hang_time_s }                         // minProperties 36
metric.unit 新增：'rpm'；metric.value_origin 新增：'dplane', 'spin_model', 'flight_model', 'prior'
flight: null | {                                                    // 給彈道圖與 tracer；中心值軌跡
  samples: [[t_s, x_m, y_m, z_m], ...]  (≤ 64 點，等時距抽樣，最後一點是落地)
  landing: {x_m, y_m, t_s}, rest: {x_m, y_m} | null,
  band: { side_lo: [[x,y]...], side_hi: [[x,y]...] } | null         // 落點 ±1σ 橢圓的 16 點外框（俯視圖用）
  ground: 'firm'|'normal'|'soft', model: 'lm-1' }
tracks: null | {                                                    // 給影片 tracer（影像座標，原始解析度）
  ball_px: [[frame, u, v, r_px], ...]  (≤ 40 點)
  impact_frame: int, view: 'face_on'|'dtl'|'high_behind' }
practice: null | { drill_id, slot, target_m, attempt }              // 練習／測驗歸屬（§3.5）
```

驗證器（`contract/validate.js`）新增的跨欄位規則：`flight.samples` t 遞增、z ≥ −0.01；`flight` 非 null ⇒ `carry_m.value` 非 null 且
`|landing.x − carry| ≤ 0.5 m`；`tracks.ball_px` 的 frame 遞增；`practice.target_m > 0`；
新 metric 的「模型碼規則」：`value_origin ∈ {dplane, spin_model, flight_model, prior}` 且非 null ⇒ `reason_codes` 至少含一個模型碼（§2.3 標 ★）。

### 2.3 新原因碼（只增不改；每個都要有 `reason.<CODE>.short/.long/.fix` 的 zh-Hant 與 en）

| 碼 | 意思（zh-Hant `.long` 草稿） | 用在 |
|---|---|---|
| `DPLANE_MODEL` ★ | 由 D-plane 模型從起飛方向／發射角與桿頭數據反推，不是直接量到的 | #4–7、#13、#16–18 |
| `SPIN_MODELLED` ★ | 旋轉量由 spin loft 與桿速的碰撞模型推估，並與該球桿的典型值合併 | #12、fo #14 |
| `SPIN_LOFT_ASSUMED` | 這個機位量不到 spin loft，用了該球桿的典型值 | hb #5、#6、#13 |
| `FLIGHT_MODELLED` ★ | 飛行軌跡由空氣動力模型模擬，模型尚未與發射監測器比對 | #14–21 |
| `ROLL_MODELLED` ★ | 落地後滾動由落地角與草況的經驗表估計 | #15、#17 |
| `SMASH_ASSUMED` | 球速 = 桿速 × 該球桿典型擊球效率，不是直接量到的 | hb #8、#14–18 |
| `LAUNCH_V_ASSUMED` | 這個機位量不到發射角，用了該球桿的典型值 | hb #14–18；不可時 hb #19–21 |
| `CROSS_VIEW_PRIOR` | 借用同一支球桿在正面機位的近期平均值（不是這一球量到的） | §1.4 |
| `MIGRATED_V1` | 這筆紀錄來自舊版，當時沒有計算這個數據；可用新模型重算 | 遷移 |

既有 `SPIN_ASSUMED`、`WIND_IGNORED`、`DEPENDS_ON_NULL`、`LAUNCH_DIR_UNOBSERVABLE`、`VIEW_*`、`TRACK_*` 照用。
`SETUP_LEVEL_CODES` 的歸屬規則：`BALL_CLUB_IDS` 擴充為 #1–21 全部（新 id 都依賴校正）。

---

## 3. 畫面與流程（IA）

### 3.1 導覽

三個分頁不變（練習／紀錄／設定，`state.js` `TABS`）。新增 SUB_SCREENS（全部 lazy）：

| screen id | 模組（lazy） | 分頁 | 入口 |
|---|---|---|---|
| `drills` | `app/src/ui/drills.js` `mountDrills` | 練習 | 首頁「練習模式」卡 |
| `drill` | `app/src/ui/drill.js` `mountDrill` | 練習 | drills 選定題目後 |
| `stats` | `app/src/ui/stats.js` `mountStats` | 紀錄 | 紀錄頁頂部分段控制「紀錄｜統計｜距離表」 |
| `gapping` | `app/src/ui/gapping.js` `mountGapping` | 紀錄 | 同上 |

結果頁仍是 `shot`（`app/src/ui/shot.js`，改版）；彈道／散佈／tracer 繪圖程式在 `app/src/viz/**`（lazy，由 shot/stats/gapping/drill 動態 import）。

### 3.2 結果頁（`shot`）— 深色儀表版

由上而下（390×844 直拍，首屏不捲動就看得到 1–3）：

1. **頂列**：球桿 chip（可點換球桿→重算）、機位、時間、`◀ ▶` 同一練習的上一球／下一球（44 px 按鈕，非手勢獨占）。
2. **主視覺（高度 38–42 vh）**：分段控制 `側視｜俯視｜3D｜影片` 切換：
   - 側視：x（距離）× z（高度）彈道曲線；估＝實線＋淺色 ±1σ 帶（apex 與 carry 的範圍），低＝虛線。
   - 俯視：x × y；落點橢圓（`flight.band`），face_on 球沒有 side → 畫在中線上並以橫向「?」寬帶表示「左右未知」，旁註原因。
   - 3D：§3.6。
   - 影片：tracer（§3.3）；沒有影片（`CLIP_NOT_SAVED`）時此段 disabled 並顯示理由行。
   沒有 flight（dtl、或 fps 不足）：主視覺改顯示揮桿節奏卡（現行 hero），不留空白。
3. **數據磚網格**：直拍 2 欄（≥ 600 px 寬 3 欄、橫拍 4 欄），預設 6 磚可見（首屏），可捲動到全部選定磚。
   磚的結構：標籤（caption、`--text-2`）· 大數字（`--fs-metric-xl`，tabular-nums）· 單位（0.45em）· `±` 範圍（footnote）· 右上 validity 標記（● 實測估／◐ 推估／▲ 低／— 不可）。
   **推估磚一律在數字下方加小字「估」**（i18n `tiles.estimated_badge`），和 ◐ 並存，顏色不是唯一載體。null 磚顯示「—」與短原因（`reason.<CODE>.short`），不隱藏，可點。
   點任一磚 → sheet：定義（RN §0 一句話）、怎麼來的（實測／推估＋方法一句）、輸入值與各自 σ、範圍、原因碼的 `.long` 與 `.fix`。
4. **自訂按鈕「欄位」** → 欄位編輯 sheet（§3.4）。
5. 下方保留現行：身體／節奏群組、未量測 disclosure（`shot-unmeasured`）、replay＋事件修正、動作列。

既有 testid 必須保留：`shot-hero`（改掛在磚網格容器上）、`shot-unmeasured`、`event-*`、`shot-star`、`shot-delete`。新 testid 見 §5.0-12。

### 3.3 影片 tracer

- 資料：`tracks.ball_px`（實際偵測，實線＋點）＋`flight.samples` 經 `calibration.camera` 投影到影像（模擬延伸，虛線，圖例「模擬」）。
  投影超出畫面的部分裁掉；face_on 的模擬延伸通常很快出畫面，這是預期行為。
- 繪製：在 replay 的 canvas 疊一層 overlay canvas；兩筆畫（深色 halo 4 px＋亮色 2 px，`--viz-tracer-halo`／`--viz-tracer`），在任何影片背景都看得見。
- 播放：跟 replay 的時間軸同步，撞擊幀後逐幀長出；`prefers-reduced-motion: reduce` → 直接畫完整線。
- 匯出（選配，SHOULD）：「存成圖片」用 `canvas.toBlob` 合成當前幀＋線，走現有 `shareOrDownload`。不做影片重新編碼。

### 3.4 自選欄位（數據磚）

- 設定：`settings.lm.tiles: string[]`（1–16 個 metric id，依序）、`settings.lm.tilePreset: 'auto'|'custom'`。
  `auto` 依機位給預設：face_on `[carry_m, total_m, ball_speed_mps, club_speed_mps, smash_factor, launch_v_deg, spin_rate_rpm, apex_m, landing_angle_deg, attack_angle_deg, dynamic_loft_deg, spin_loft_deg]`；
  high_behind `[carry_side_m, curve_m, launch_h_deg, club_path_deg, face_angle_deg, face_to_path_deg, spin_axis_deg, club_speed_mps, carry_m]`；dtl：現行身體指標。
- 編輯 sheet：三組（球桿／球／飛行）的清單，每列：switch（選用）＋上移／下移按鈕（44 px；**不可只靠拖曳**）；頂部「依機位自動」「全部」「清空為預設」。
  選了但這球不可的磚照樣顯示「—」。編輯即時預覽，關閉即存。
- 預設集（presets）先不做（§6）。

### 3.5 練習與測驗

**流程前提**：球數據要 240 fps 慢動作，即時模式拿不到 carry。所以練習／測驗走「先排題目 → 用相機 App 每球錄一段慢動作 → 批次匯入 → 依片段時間順序對到題目格」。
匯入頁（`import.js`）在有進行中的 drill 時，於佇列上方顯示「這批會對到：題目 3–9」，可手動改對應（每格一個下拉選單）。

- `drills`：卡片清單三類——
  1. **目標距離練習**：輸入目標 carry（單位依設定）與球桿、球數（預設 10）。每球結果：差距（+長／−短）、若有 side 則 2D 誤差、分數。
  2. **距離表測驗（gapping session）**：選球桿（預設 CLUBS 全部），每支 N 球（預設 5）。結果直接寫進距離表的樣本。
  3. **固定題目測驗**：預設題組「距離控制 18 題」：目標 40、50…120 碼（9 個）× 2 輪，每輪隨機順序（種子寫進 drill，可重現）；
     另一題組「全套球桿 3 輪」。題組定義是資料（`app/src/practice/drills.js`），可新增。
- **分數（通用公式，不仿任何商業產品）**：單球 `s = 100·max(0, 1 − d / (k·T))`，T = 目標，d = |carry − T|（無 side 時）或 √((carry − T)² + side²)（有 side 時），`k = 0.25`（可調）。
  分數的不確定度：由 carry／side 的 σ 以 200 次抽樣算 `σ_s`，結果顯示「72 ± 6」。整體分數 = 單球平均，附 95% 區間；
  題組分數只在**同一題組、同機位**之間比較（不同機位的 side 有無不同，分數不可比 → 畫面加註）。
- `drill`（進行中）：大字顯示「第 n 題：目標 90 碼・7 鐵」、題目進度條、「去錄影 → 回來匯入」按鈕、已完成格的分數；
  中途離開保留進度（存 `drills` store）。結果頁：分數、每題差距長條圖（`viz/charts.js`）、與上一次同題組比較。
- 每球 `practice: {drill_id, slot, target_m, attempt}` 寫進 shot。

### 3.6 2D／3D 彈道

- 純 Canvas 2D，不加函式庫。3D 用自寫的透視投影（相機繞落點中心的 yaw/pitch 軌道），畫：地面網格（每 25 m／25 碼）、目標線、
  各球彈道（顏色 = 球桿系列色）、落點點。互動：單指拖曳旋轉＋兩個按鈕（左轉／右轉 15°、俯視／斜視切換）供無障礙與手套；
  不自動旋轉。`app/src/viz/traj3d.js` ≤ 12 KB（未壓縮）。
- **不用 three.js**：three.js 的 module 版 minified 約 600–700 KB（**UNVERIFIED**，版本相依），即使 lazy 也吃掉 precache 剩餘預算的 20%，
  而本需求只要線段與點。若擁有者日後要地形或貼圖，再評估（§6）。
- 多球疊圖：`stats` 與 `gapping` 也用同一個 2D／3D 元件畫整場或某球桿的所有球（≤ 200 球；超過則抽樣並標示）。

### 3.7 統計與比較（`stats`）

- 篩選：期間（本次／7 天／30 天／全部）、機位、球桿、預設（preset）、是否排除失誤球（MAD 3.5 倍以外）。
- 每支球桿一張卡：n、平均、中位、SD、P10–P90、95% CI（平均），指標可切換（預設 carry、total、球速、桿速、發射角、spin）。
- **一致性（誠實版）**：觀測 SD 含量測雜訊。顯示 `SD_obs`、`σ_noise`（各球 σ 的均方根）、`SD_est = √max(0, SD_obs² − σ_noise²)`；
  `SD_obs ≤ 1.2·σ_noise` 時寫「散佈小於量測誤差，無法分辨你的一致性」而不是給一個漂亮的小數字。
- **與上次比較**：同球桿、上次練習 vs 本次：Δ平均＋95% CI（Welch），CI 不含 0 且同 preset、同機位、同 `algorithms.lm` 版本才寫「有差」；
  否則沿用 `store/compare.js` 的 notes（`PRESET_MISMATCH`、`view_mismatch`），新增 note `model_mismatch`、`small_sample`（n < 5）。
- 圖：俯視散佈（全部球的落點＋每支球桿的 1σ 橢圓）、側視疊圖、每球桿箱形圖。散佈圖上 face_on 球（無 side）放在獨立的「只有距離」橫條上，**不與有 side 的球混在同一平面**。

### 3.8 距離表（`gapping`）

- 每支球桿一列：carry 中位數、P10–P90 帶、total 中位數、n、與下一支的間距；n < 5 標「樣本不足」。
- 來源預設只用 face_on（估）；開關「含高斜角後方（低）」可併入 hb 的 carry（低）並以不同點形標示。
- 間距小於 `GAP_MIN`（預設 8 碼）或大於 `GAP_MAX`（預設 20 碼）時標記（**UNVERIFIED 經驗值**，可調）。
- 可匯出 CSV（數字＋單位，無本地化文字，沿用 `store/export.js` 規則）。

### 3.9 設定新增（設定 › 顯示／數據）

`theme` 新安裝預設（待決定 D1）、`lm.ground`（硬／一般／軟，預設一般）、`lm.crossView`（預設關）、`lm.tiles`／`lm.tilePreset`、
`lm.gapMin`／`lm.gapMax`、`lm.excludeMishits`（預設開）。

---

## 4. 設計系統變更（tokens）

### 4.1 主題

- 保留 light／dark／sun。新增「資料畫面深色」：`shot`、`stats`、`gapping`、`drill` 的根元素在 `theme = auto` 時設 `data-live-theme="dark"`
  （沿用 live 的機制）；使用者明確選 light → light；sun → sun。全 app 預設是否改深色 → 待決定 D1（建議：新安裝 `theme` 預設 `dark`，既有設定不動）。
- 不採用任何商業監測器的品牌色（例如以橘色為主色的儀表外觀）；主色維持 Range 綠。

### 4.2 新 token（只在 `tokens.css`；三主題都要定義，對比測試涵蓋）

| token | dark | light | sun | 對比（需） |
|---|---|---|---|---|
| `--fs-metric-xl` | `clamp(2.25rem, 9vw, 3.5rem) × --hero-scale` | 同 | 同 ×1.15 | 390 寬時 ≥ 40 px（e2e） |
| `--fs-metric` | 1.75rem | 同 | 同 | — |
| `--t-metric` | `700 var(--fs-metric-xl)/1.0 var(--font)` | 同 | 800 | — |
| `--tile-bg` | #111C16（=surface） | #FFFFFF | #FFFFFF | — |
| `--tile-border` | 1px #24352B | 1px #C9D3CD | 2px #3D4A43（9.30） | sun 邊框 ≥ 3.0 |
| `--viz-bg` | #07100B | #FFFFFF | #FFFFFF | — |
| `--viz-axis` | #5D7A69（3.71 vs surface） | #7C8C82（3.54） | #3D4A43（9.30） | ≥ 3.0 |
| `--viz-grid` | #24352B | #E6ECE8 | #C9D3CD | 裝飾，豁免 |
| `--viz-text` | = `--text-2` | = `--text-2` | = `--text-2` | ≥ 4.5（既有） |
| `--viz-series-1…8` | #6FA8FF #FFC940 #FF7A70 #7FE0A8 #D59CFF #5FD3E0 #FFA45C #EAF2ED | #1D5FBF #8A5700 #B3261E #0B6B3F #7B3FB8 #00707A #A84B00 #3C4A42 | #0B3F8C #5C3A00 #8A140C #00552F #5A2490 #004F57 #7A3600 #000000 | 各對 surface／bg：dark 5.83–16.93；light 5.18–9.33；sun 8.92–21.0（已算，RN 腳本 `contrast.py`）≥ 3.0 |
| `--viz-ci-fill` | series 色 18% 透明 | 14% | 不用填色，改 1.5 px 外框 | 裝飾 |
| `--viz-target` | #FFC940 | #8A5700 | #000000 | ≥ 3.0 |
| `--viz-tracer` ／ `--viz-tracer-halo` | #FFC940 ／ rgb(0 0 0/.7) | 同（畫在影片上） | #FFFFFF ／ #000000 | 影片上雙筆畫 |

規則：
- 系列色依球桿固定（`CLUBS` 順序 → series 1–8），**每個系列另有點形**（● ■ ▲ ◆ ▼ ✚ ✕ ○），顏色不是唯一載體。
- 線型：實測＝實線、推估＝實線＋σ 帶、低＝虛線（6 4）、模擬延伸＝點線。
- Canvas 取色只能經 `viz/palette.js` 的 `vizPalette(el)`（`getComputedStyle` 讀 `--viz-*`）；`check_tokens` 新規則：`app/src/viz/**` 與 `app/src/ui/**` 的 JS 不得出現 hex 色碼字面值。
- 大數字：所有數字 `font-variant-numeric: tabular-nums`；數字顏色 = `--text`（不用系列色寫數字）。
- sun 主題：磚 2 px 邊框、無透明填色、σ 帶改外框線、hero 數字 +15%（既有 `--hero-scale`）。

---

## 5. 工作包

### 5.0 跨包共用介面（FROZEN，LM-A 的 drop 1 先落地）

1. **契約**：§2 全部；`METRIC_IDS` 36 個（順序 = F2 1–20 的 22 個＋§1.2 新增 14 個依 #2,#4,#5,#6,#7,#12,#13,#15,#16,#17,#18,#19,#20,#21）；`METRIC_UNITS` 新增 `rpm`；新 RC（§2.3）。
2. **遷移**：`import { migrateShot, SCHEMA_V2 } from '../contract/migrate.js'`。
3. **物理**（LM-B）：`import { deriveLaunchMonitor, rederive, LM_PARAMS } from '../physics/lm/index.js'`
   `deriveLaunchMonitor({view, fps, club, metrics /* v1 22 個 */, fit /* fit3d 結果, 可 null */, clubTrack, calibration, settings:{ground, crossView}, clubProfile|null, rng})`
   → `{metrics: {<14 個新 id + 被改格子的 id>: Metric}, flight|null, tracks|null, algorithm:{version, sha256}}`。
   `rederive(shot, {settings, clubProfile}) -> shot'`（純函式、不改輸入、revision+1 由呼叫端做）。
   `clubProfile(shots, clubType, {days=30, minN=20}) -> {n, aoa:{mean,sd}, dl, lv, spin}|null`。
4. **視覺化**（LM-C，全部 lazy、輸入只有數字與 canvas）：
   `vizPalette(el) -> {series:[8], seriesGlyph:[8], axis, grid, text, target, ciAlpha, tracer, halo, bg}`；
   `drawSide(canvas, {flights:[{samples, club, validity, band}], units, palette, target_m?})`；
   `drawTop(canvas, {points:[{x,y|null,sx,sy,club,validity}], units, palette, target?})`；
   `createTraj3d(canvas, {flights, palette, units}) -> {rotate(dYawDeg), setPitch('top'|'oblique'), redraw(), destroy()}`；
   `drawTracer(canvas, {track, projected, frame, palette, reducedMotion})`；`projectFlight(camera, samples) -> [[u,v]|null]`；
   `drawBars(canvas, {...})`、`drawBox(canvas, {...})`。每個 draw 回傳 `{a11y: string-key, params}` 讓呼叫端產生替代文字（canvas 一律 `role=img`＋`aria-label`）。
5. **統計**（LM-F）：`store/stats.js`：`summarize(values, sigmas) -> {n, mean, median, sd_obs, sigma_noise, sd_est, indistinguishable, p10, p90, ci95_mean}`；
   `gapping(shots, {includeHB, gapMin, gapMax}) -> [{club, n, carry:{...}, total:{...}, gap_next_m, flag}]`；`compareSessions(aShots, bShots, ids) -> {...store/compare.js 形式 + notes}`；`isMishit(x, all)`.
6. **練習**（LM-E）：`practice/drills.js`：`DRILL_TEMPLATES`、`makeDrill(templateId, {seed, clubs, targets}) -> drill`；
   `practice/scoring.js`：`scoreShot({target_m, carry_m, carry_sigma, side_m|null, side_sigma|null, k}) -> {score, score_sigma, miss_m, miss_side_m}`；
   `practice/assign.js`：`assignClips(drill, clips:[{started_at}]) -> [{slot, clipIndex}]`。
7. **Repo**（LM-A，`store/core.js` SCHEMA_VERSION 4，加性）：新 store `drills`（keyPath `drill_id`，index `created_at`、`template`）；
   `repo.drills.{put,get,list}`；`shots.get/list` 回傳 v2（讀時遷移）；`repo.migrateBatch(n)`。
8. **App 狀態**：`app.drill = { current() -> drill|null, set(drill|null), onChange(fn) }`（LM-A 在 main.js 提供空實作，LM-E 使用）。
9. **設定**：§3.9 鍵，`session/settings.js`（LM-A）含預設與正規化。
10. **i18n**：新命名空間 `tiles`（LM-D）、`viz`（LM-C）、`drill`（LM-E）、`stats`、`gapping`（LM-F）；`metric`（14 個新 label/term）、`reason`（9 碼）、`unit.rpm` 由 LM-A。
    新命名空間全部列入 `LAZY_I18N_NAMESPACES`（shot 畫面已在 `i18nComplete` 之後掛載，安全）。
11. **build**：`LAZY_FILES` 加入 `src/viz/*.js`、`src/ui/{drills,drill,stats,gapping,tiles}.js`、`src/practice/*.js`、`src/store/stats.js`、`src/physics/lm/*.js`（physics 由 worker／分析路徑動態 import，不在 boot graph）。
12. **testid**（新）：`shot-viz`、`shot-viz-tab`（`data-tab=side|top|3d|video`）、`shot-tile`（`data-metric=<id>`）、`shot-tiles-edit`、`tiles-sheet`、`tiles-row`（`data-metric`）、`tiles-up`、`tiles-down`、
    `shot-prev`、`shot-next`、`shot-rederive`、`drills-card`（`data-template`）、`drill-target`、`drill-progress`、`drill-import`、`drill-score`、`import-slot`、
    `stats-filter`、`stats-club-card`、`stats-consistency`、`gapping-row`、`history-seg`（`data-seg=list|stats|gapping`）。
13. **e2e 狀態掛勾**（LM-A，main.js）：`app.e2e.registerState(screen, name, async fn)`；`screenshot_matrix.mjs` 以 `--screens shot:tiles,shot:3d,...` 呼叫；
    各包為自己的畫面註冊狀態。
14. **夾具**（LM-A）：`tests/fixtures/shots/v2/*.json`（`valid_face_on_240`、`valid_high_behind_240`、`valid_dtl_30`、`migrated_v1_face_on`、一筆無影片的 face_on、bad_* 每條新規則一筆；
    face_on 與 hb 夾具的 `flight.samples[0]` 經 `calibration.camera` 投影須落在 `tracks.ball_px` 撞擊幀球心 2 px 內，LM-C 驗收 1 依賴這點）、
    `tests/fixtures/lm/sessions-1000.json`（1000 球、8 支球桿、3 機位、12 次練習，數字由 `scripts/make_lm_fixtures.mjs` 以固定種子產生，不呼叫物理）。

### 5.1 檔案擁有權

| 包 | 名稱 | 可改的檔案／目錄（獨占） |
|---|---|---|
| **LM-A** | 契約與基礎（drop 1） | `schema/shot-v2.schema.json`（新）、`app/src/contract/**`、`app/src/metrics/registry.js`、`app/src/state.js`、`app/src/main.js`、`app/index.html`、`app/styles/tokens.css`、`app/styles/app.css`、`app/styles/screens/settings.css`、`app/src/ui/components.js`、`app/src/ui/icons.js`、`app/src/ui/settings.js`、`app/src/i18n/**`、`app/src/session/settings.js`、`app/src/store/core.js`、`app/src/store/export.js`、`app/i18n/namespaces.json`、`app/i18n/{zh-Hant,en}/{metric,reason,unit,validity,common,nav,screen,club,settings}.json`、`scripts/build.mjs`、`scripts/check_contract.mjs`、`scripts/check_tokens.mjs`、`scripts/check_i18n.mjs`、`scripts/verify.sh`、`scripts/make_lm_fixtures.mjs`（新）、`tests/e2e/screenshot_matrix.mjs`、`tests/e2e/lib.mjs`、`tests/e2e/checks.mjs`、`tests/e2e/gates/lm-a-*.mjs`、`tests/fixtures/shots/v2/**`（新）、`tests/fixtures/lm/**`（新）、`tests/unit/{contract.*,metrics.registry,tokens.*,appcore.*,i18n.*,units.*,store.core,store.export,lm.contract.*}.test.mjs`、`docs/contract.md`、`docs/interfaces.md`、`docs/design-system.md`、`docs/i18n.md`、`docs/e2e-hooks.md`、`docs/metrics-by-view.md`、`docs/CAFCR.md`（只加一行指向本檔） |
| **LM-B** | 物理推導 | `app/src/physics/**`（含新 `physics/lm/{index,dplane,spin,flight,roll,hbspeed,profile,params}.js`）、`app/src/track/**`、`app/src/pipeline/assemble.js`、`app/src/metrics/compute.js`、`tests/synth/ballflight.js`、`tests/unit/{physics.*,pipeline.assemble,pipeline.face_on,lm.physics.*,lm.perf}.test.mjs`、`docs/research/launch-monitor-physics.md` |
| **LM-C** | 視覺化元件 | `app/src/viz/**`（新）、`app/styles/screens/viz.css`（新，LM-A 在 index.html 連結）、`app/i18n/{zh-Hant,en}/viz.json`、`tests/unit/viz.*.test.mjs`、`docs/viz.md`（新） |
| **LM-D** | 結果頁與數據磚 | `app/src/ui/shot.js`、`app/src/ui/replay.js`、`app/src/ui/tiles.js`（新）、`app/src/ui/glossary.js`、`app/styles/screens/results.css`、`app/i18n/{zh-Hant,en}/{shot,replay,tiles}.json`、`tests/unit/{ui.timeline,ui.tiles}.test.mjs`、`tests/e2e/m2.mjs`、`tests/e2e/gates/lm-d-*.mjs` |
| **LM-E** | 練習與測驗 | `app/src/practice/**`（新）、`app/src/ui/drills.js`（新）、`app/src/ui/drill.js`（新）、`app/src/ui/home.js`、`app/src/ui/import.js`、`app/styles/screens/practice.css`、`app/i18n/{zh-Hant,en}/{drill,home,import}.json`、`tests/unit/practice.*.test.mjs`、`tests/e2e/gates/lm-e-*.mjs` |
| **LM-F** | 統計、距離表、比較 | `app/src/store/stats.js`（新）、`app/src/store/compare.js`、`app/src/ui/history.js`、`app/src/ui/compare.js`、`app/src/ui/stats.js`（新）、`app/src/ui/gapping.js`（新）、`app/styles/screens/stats.css`（新，LM-A 在 index.html 連結）、`app/i18n/{zh-Hant,en}/{history,compare,stats,gapping}.json`、`tests/unit/{store.compare,store.stats}.test.mjs`、`tests/e2e/m6.mjs`、`tests/e2e/gates/lm-f-*.mjs` |

**交叉檢查（每個容易撞的路徑只屬一包）**

| 路徑 | LM-A | LM-B | LM-C | LM-D | LM-E | LM-F |
|---|---|---|---|---|---|---|
| `app/src/contract/**`、`schema/` | ✔ | | | | | |
| `app/src/metrics/registry.js` | ✔ | | | | | |
| `app/src/metrics/compute.js` | | ✔ | | | | |
| `app/src/physics/**`、`app/src/track/**` | | ✔ | | | | |
| `app/src/pipeline/assemble.js` | | ✔ | | | | |
| `app/src/viz/**` | | | ✔ | | | |
| `app/src/ui/shot.js`、`replay.js`、`tiles.js`、`glossary.js` | | | | ✔ | | |
| `app/src/ui/home.js`、`import.js`、`drills.js`、`drill.js` | | | | | ✔ | |
| `app/src/ui/history.js`、`compare.js`、`stats.js`、`gapping.js` | | | | | | ✔ |
| `app/src/ui/settings.js`、`components.js`、`icons.js` | ✔ | | | | | |
| `app/src/store/core.js`、`export.js` | ✔ | | | | | |
| `app/src/store/compare.js`、`stats.js` | | | | | | ✔ |
| `app/src/practice/**` | | | | | ✔ | |
| `app/src/main.js`、`state.js`、`index.html` | ✔ | | | | | |
| `app/styles/tokens.css`、`app.css`、`screens/settings.css` | ✔ | | | | | |
| `app/styles/screens/viz.css` | | | ✔ | | | |
| `app/styles/screens/results.css` | | | | ✔ | | |
| `app/styles/screens/practice.css` | | | | | ✔ | |
| `app/styles/screens/stats.css` | | | | | | ✔ |
| i18n `metric,reason,unit,validity,common,nav,screen,club,settings` | ✔ | | | | | |
| i18n `viz` | | | ✔ | | | |
| i18n `shot,replay,tiles` | | | | ✔ | | |
| i18n `drill,home,import` | | | | | ✔ | |
| i18n `history,compare,stats,gapping` | | | | | | ✔ |
| `app/i18n/namespaces.json` | ✔ | | | | | |
| `scripts/**`（build、check_*、verify、make_lm_fixtures） | ✔ | | | | | |
| `tests/e2e/screenshot_matrix.mjs`、`lib.mjs`、`checks.mjs` | ✔ | | | | | |
| `tests/e2e/m2.mjs` | | | | ✔ | | |
| `tests/e2e/m6.mjs` | | | | | | ✔ |
| `tests/e2e/gates/lm-<x>-*.mjs`（LM-C 沒有 gate，見 §5.2 共通驗收） | a | | | d | e | f |
| `tests/fixtures/shots/v2/**`、`tests/fixtures/lm/**` | ✔ | | | | | |
| `tests/synth/ballflight.js` | | ✔ | | | | |
| `tests/unit/` 前綴 `contract. metrics.registry tokens. appcore. i18n. units. store.core store.export lm.contract.` | ✔ | | | | | |
| `tests/unit/` 前綴 `physics. pipeline.assemble pipeline.face_on lm.physics. lm.perf` | | ✔ | | | | |
| `tests/unit/viz.*` | | | ✔ | | | |
| `tests/unit/ui.timeline ui.tiles` | | | | ✔ | | |
| `tests/unit/practice.*` | | | | | ✔ | |
| `tests/unit/store.compare store.stats` | | | | | | ✔ |
| `docs/research/launch-monitor-physics.md` | | ✔ | | | | |
| `docs/viz.md` | | | ✔ | | | |
| 其他 docs（contract、interfaces、design-system、i18n、e2e-hooks、metrics-by-view、CAFCR 一行） | ✔ | | | | | |

每一列恰好一個勾 → 互不重疊。本規格以外的檔案（例如 `live.js`、`setup.js`、`events/**`、`workers/**`）**任何包都不准改**；需要時在 PR 說明裡向 LM-A 提需求。
新增檔案以上表的目錄歸屬判定；共用字串（按鈕「完成」之類）放 `common`，由 LM-A 合併。

### 5.2 各包內容與驗收（全部機械判定；指令在 repo 根目錄執行）

共通驗收（每包都要）：
- `bash scripts/verify.sh` 最後一行 `all stages passed`（`RUN_BROWSER_E2E` 未設時 browser-e2e 為 SKIP 屬正常，此時最後一行為 `no failures, but this is NOT a full verification` 亦可在包內接受，整合時必須 `all stages passed`）。
- `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only 'lm-<x>-*'` 退出碼 0。**LM-C 不適用**：它是純模組、沒有自己的畫面，所以沒有 `lm-c-*` gate；
  它在瀏覽器裡的行為由 `lm-d-viz`（結果頁四個分頁）與 `lm-f-stats`（統計圖）涵蓋（整合時補記）。
- `node scripts/check_i18n.mjs --strict --quiet` 退出碼 0；`node scripts/check_tokens.mjs --strict` 退出碼 0。
- `grep -rniE 'trackman|golfdb|ultralytics|opencv' app/src app/i18n app/styles | grep -viE 'golfdb: false|\.golfdb|"golfdb": ?false|card field golfdb|\(OpenCV[:)]' | wc -l` 輸出 `0`。
  排除項（LM-A drop 1 實測，2026-11-06；其餘 0 筆）：事件模型卡的 GolfDB 防線欄位 `golfdb: false`（`events/card.js` 3 處、`events/calib-conf.js`／`.json` 各 1、`session/models.js` 2 處——檢查「不是 GolfDB 衍生」的 guard，不是使用 GolfDB）；`geom/camera.js:4`、`calib/gravity.js:9` 註解裡的「(OpenCV)」相機座標慣例名（不是 OpenCV 函式庫）。`physics/aero.js`、`physics/ballistics.js` 註解原本引用商業監測器名稱，LM-A 已改為通用措辭（只改註解）。

#### LM-A — 契約與基礎（drop 1 = 凍結 §5.0 的檔案與最小實作）
內容：v2 schema、migrate、validate 新規則、RC 與說明、registry 新 14 列、settings 新鍵、repo v4（drills store、讀時遷移、背景回寫）、
tokens（§4.2）與 tile／viz 共用 class、components 新增 `dataTile({metric, id, units, estimatedBadge})`、`segmented` 已有、
main.js：SCREEN_MODULES 加 4 個畫面、`app.drill`、`app.e2e.registerState`、資料畫面深色、index.html 連結 viz.css／stats.css、
build LAZY 清單、check_tokens 新規則（JS hex）、screenshot_matrix 擴充、夾具與產生腳本、設定畫面新項目。
驗收：
1. `node --test tests/unit/lm.contract.v2.test.mjs` → `# fail 0`，且測試包含：所有 `tests/fixtures/shots/*.json`（v1）經 `migrateShot` 後通過 v2 驗證；`migrateShot(migrateShot(x))` 深度相等；每個 `tests/fixtures/shots/v2/bad_*.json` 驗證失敗且錯誤訊息含檔名約定的規則名。
2. `node scripts/check_contract.mjs` 退出碼 0，且輸出含 `(38 reason codes;`（目前印 `check_contract: OK (29 reason codes; …)`；29 舊＋9 新），每碼在 zh-Hant 與 en 的 `reason.json` 都有 `.short/.long/.fix`。
3. `node --test tests/unit/tokens.contrast.test.mjs` → `# fail 0`，且新加的 `--viz-series-1…8`、`--viz-axis`、`--viz-target`、`--tile-border`（sun）在三主題各對 `--surface` 與 `--bg` 的對比 ≥ 3.0（測試列出 ≥ 48 對）。
4. `node scripts/build.mjs --quiet && node -e "const m=require('./dist/precache-manifest.json');const t=m.totals;console.log(t.shell_bytes<=1e6&&t.precache_bytes<=35e6?'BUDGET OK':'BUDGET FAIL')"` → `BUDGET OK`；且 LM-A 自身造成的 shell 增量 ≤ 20,000 B（`tests/unit/appcore.build.test.mjs` 斷言 shell ≤ 969,715 B 於 drop 1 時）。
5. `node -e "import('./app/src/store/core.js').then(m=>console.log(m.SCHEMA_VERSION, m.STORE_NAMES.includes('drills')))"` → `4 true`；`node --test tests/unit/store.core.test.mjs` 含「v3 資料庫開啟後讀回的 shot 為 golf-shot/2」案例，`# fail 0`。
6. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-a-shell` → PASS：4 個新畫面可導覽、`focusOnH1`、`noHScroll` 200%、`theme=auto` 時 shot 根元素有 `data-live-theme="dark"`。

#### LM-B — 物理推導
內容：`physics/lm/*`（§1.2 方法欄全部）、face_on 攻擊角（`track/club.js` 輸出垂直分量＋`physics/lm/attack`）、hb 桿速、
`assemble.js` 寫入新 metrics／flight／tracks／algorithms.lm、`rederive`、`clubProfile`、參數檔與版本、合成資料擴充（`ballflight.js` 產生帶已知 face/path/DL/AoA/spin 的球）。
驗收：
1. `node --test tests/unit/lm.physics.dplane.test.mjs` → `# fail 0`：前向 D-plane（已知 F、P、DL、AoA → LH、LV）再反推，誤差 < 1e-9°；向量 spin axis 與小角度 `atan(tan F2P / tan SL)` 在 |F2P| ≤ 6°、SL 10–40° 時差 < 0.5°；符號表（開桿面→正 axis、右打／左打鏡像）全對。
2. `node --test tests/unit/lm.physics.coverage.test.mjs` → `# fail 0`：合成 400 球（face_on 200、hb 200，依 RN §5 的雜訊注入），#4、#5、#6、#7、#12、#13、#14、#15、#16、#19、#20、#21 的 ci95 涵蓋率各在 **85–99%**（輸出表格逐 id 列出）。
3. `node --test tests/unit/lm.physics.table.test.mjs` → `# fail 0`：用 `LM_PARAMS` 對 RN §2 巡迴賽表 7 列做前向（桿速、AoA、發射角 → spin），每列相對誤差 ≤ 1%（`A_club` 擬合自洽）；RK4 carry 對表的誤差落在 RN §4 記錄值 ±0.5 m 內（回歸鎖定，改模型必須同時改 RN）。
4. `node --test tests/unit/lm.physics.cells.test.mjs` → `# fail 0`：每個 view × fps（30、60、120、240）× 36 id 的輸出 validity 與 `registry.cellFor` 一致；每個 null 有原因碼；每個推估值的 reason_codes 含 §2.3 的模型碼；dtl 的 14 個新 id 全為 null。
5. `node --test tests/unit/lm.perf.test.mjs` → `# fail 0`：`deriveLaunchMonitor` 中位 CPU 時間 ≤ 1500 ms（n = 256 draws），輸出 `perf median_ms=<n>`。
6. `node scripts/synth_e2e.mjs` 退出碼 0，產生的 shot 通過 v2 驗證（`assemble` 輸出 schema `golf-shot/2`）。

#### LM-C — 視覺化元件
內容：§5.0-4 全部函式、palette、投影、3D 軌道相機、tracer 兩筆畫、箱形圖／長條圖、替代文字 key、reduced-motion。
驗收：
1. `node --test tests/unit/viz.project.test.mjs` → `# fail 0`：`projectFlight` 用 `tests/fixtures/shots/v2/valid_face_on_240.json` 的 camera 投影 `flight.samples[0]`，與 `tracks.ball_px` 撞擊幀的球心差 ≤ 2 px；3D 投影的已知點（原點、(100,0,0)、(0,0,30)）誤差 < 1e-9。
2. `node --test tests/unit/viz.draw.test.mjs` → `# fail 0`：以紀錄型假 canvas（在本包的測試檔內自帶，不改 LM-A 以外沒人擁有的 `tests/unit/_fakedom.mjs`）呼叫每個 draw，斷言：不讀任何 hex 字面值（所有 `strokeStyle/fillStyle` 都等於 palette 物件中的值）；低 validity 的線有 `setLineDash([6,4])`；每個 draw 回傳 a11y key 在 `app/i18n/{zh-Hant,en}/viz.json` 都存在。
3. `wc -c app/src/viz/traj3d.js | awk '{print ($1<=12288)?"SIZE OK":"SIZE FAIL"}'` → `SIZE OK`；`du -cb app/src/viz/*.js | tail -1 | awk '{print ($1<=60000)?"VIZ OK":"VIZ FAIL"}'` → `VIZ OK`。
4. `node scripts/check_imports.mjs` 退出碼 0，且 `grep -rE "from '(https?:|[a-z@])" app/src/viz | wc -l` → `0`（無外部套件、無網址）。

#### LM-D — 結果頁與數據磚
內容：§3.2、§3.3、§3.4；磚詳情 sheet；重算按鈕；上一球／下一球；保留既有 testid。
驗收（fixture：`tests/fixtures/shots/v2/` 經 history 匯入）：
1. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-d-tiles` → PASS：390×844 face_on fixture 首屏（不捲動）有 ≥ 6 個 `shot-tile`，每個 `.mt-num` computed font-size ≥ 40 px；每個 validity 為 estimated 且 value_origin ∈ 推估類的磚，文字含 `tiles.estimated_badge` 的譯文且有 ◐；null 磚顯示 `—` 與短原因。
2. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-d-edit` → PASS：開 `shot-tiles-edit`，關掉 `carry_m`、把 `spin_rate_rpm` 用 `tiles-up` 移到第一，關 sheet、reload 後第一個 `shot-tile` 的 `data-metric` 為 `spin_rate_rpm` 且沒有 `carry_m`；整個流程無任何 drag 事件。
3. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-d-viz` → PASS：四個 `shot-viz-tab` 依序點擊後，`shot-viz` 內 canvas 非透明像素數 > 500（`getImageData`）；`valid_dtl_30` fixture 的主視覺顯示節奏卡而非空 canvas；無影片的 fixture `video` 分頁 `aria-disabled=true` 且有理由文字。
4. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-d-legacy` → PASS：v1 fixture（遷移後）結果頁可開、14 個新磚為 `—`＋`MIGRATED_V1` 短原因、`shot-rederive` 可按且產生 revision+1 後新磚有值（face_on fixture）。
5. `node tests/e2e/screenshot_matrix.mjs --screens shot,shot:tiles,shot:side,shot:top,shot:3d,shot:video` 退出碼 0（0 findings）。

#### LM-E — 練習與測驗
內容：§3.5 全部；首頁入口；匯入對應；drills store 讀寫；分數與不確定度。
驗收：
1. `node --test tests/unit/practice.scoring.test.mjs` → `# fail 0`：`scoreShot` 表格案例（T=100 m：d=0→100、d=25→0、d=12.5→50、有 side 時用 2D 距離）；`score_sigma` 對 `carry_sigma=0` 為 0、對 carry σ 5 m 落在 18–22（MC 200 次、固定種子）。
2. `node --test tests/unit/practice.drills.test.mjs` → `# fail 0`：同種子 `makeDrill` 兩次輸出深度相等；「距離控制 18 題」每輪 9 個目標各出現一次；`assignClips` 依 `started_at` 排序對應，片段數多於題目時多的不對應並回報。
3. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-e-drill` → PASS：從首頁 `drills-card[data-template=distance18]` 開始 → `drill-target` 顯示第 1 題 → `drill-import` 匯入 2 個 fixture 片段 → 兩個 `import-slot` 分別為 1、2 → 回到 drill，`drill-progress` 顯示 2/18 且有 2 個 `drill-score`；reload 後進度仍為 2/18（IDB `drills` 有 1 筆）。
4. `node tests/e2e/screenshot_matrix.mjs --screens home,drills,drill,drill:result,import` 退出碼 0。

#### LM-F — 統計、距離表、比較
內容：§3.7、§3.8；紀錄頁分段控制；compare 新 notes；CSV 匯出。
驗收：
1. `node --test tests/unit/store.stats.test.mjs` → `# fail 0`：`summarize([10,12,14],[0,0,0])` → mean 12、sd_obs 2、sd_est 2；`summarize` 在 sd_obs=2、各 σ=2 時 `indistinguishable=true`、sd_est=0；P10/P90 與 numpy `percentile(…, method='linear')` 的參考值一致（測試內寫死參考數字）；`gapping` 對夾具輸出依球桿長度排序、n<5 標 `small_sample`。
2. `node --test tests/unit/store.compare.test.mjs` → `# fail 0`：兩組不同 `algorithms.lm.version` 的比較含 note `model_mismatch`，且 `significant` 全為 false；同版本、同 preset、差 10 m、n=20、σ=3 m 的兩組 `significant=true`。
3. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-f-stats` → PASS：匯入 `tests/fixtures/lm/sessions-1000.json` 後，`history-seg[data-seg=stats]` 開啟到第一張 `stats-club-card` 可見 ≤ 800 ms（CPU ×4），DOM 節點 ≤ 2,000；face_on 與 hb 的點不在同一個散佈平面（hb 點在 `drawTop` 的有 side 區、face_on 點在距離橫條，由 canvas 的 a11y 參數斷言）。
4. `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only lm-f-gapping` → PASS：`gapping-row` 數 = 夾具中 n ≥ 1 的球桿數；匯出 CSV 無 CJK 字元、欄位 `club,n,carry_median_m,carry_p10_m,carry_p90_m,total_median_m,gap_next_m,flag`。
5. `node tests/e2e/screenshot_matrix.mjs --screens history,stats,gapping` 退出碼 0。

### 5.3 整合順序與關卡

1. LM-A drop 1 落地（§5.0 全部檔案＋最小實作＋夾具）。其他包從一開始就照 §5.0 寫，drop 1 之前用夾具與注入的假實作跑單元測試。
2. LM-B、LM-C 可先合（純模組）；LM-D、LM-E、LM-F 依賴 B 的輸出形狀（夾具已涵蓋）與 C 的 draw 函式，任意順序合。
   每個 PR：`bash scripts/verify.sh` ＋ 自己的 `--only 'lm-<x>-*'`。
3. LM-A 整合 commit：移除過渡別名、`LAZY_FILES` 最終清單、`check_tokens --strict` 的 JS hex 規則從 WARN 改 FAIL。
4. **fresh-context 驗收 agent**（實作者不自驗）跑：
   - `RUN_BROWSER_E2E=1 bash scripts/verify.sh` → 最後一行 `all stages passed`。
   - `node tests/e2e/screenshot_matrix.mjs --screens home,venue,import,shot,shot:tiles,shot:side,shot:top,shot:3d,shot:video,history,stats,gapping,drills,drills:setup,drill,drill:result,drill:active,diag,settings,about,setup,live --json /tmp/m.json`
     → 退出碼 0（**0 findings**；3 主題 × 2 語系 × 2 字級 × 2 寬度，setup／live 另含橫拍）。
   - 預算：`dist/precache-manifest.json` 的 `shell_bytes ≤ 1,000,000`、`precache_bytes ≤ 35,000,000`；`BUDGETS` 常數未被修改（`git diff --stat scripts/build.mjs` 中 `BUDGETS` 那行不變：`git diff -U0 scripts/build.mjs | grep -c 'BUDGETS = '` → `0`）。
   - `grep -rniE 'trackman' app/ dist/ | wc -l` → `0`。
5. 擁有者 iPhone 實測清單（寫進 `docs/device-checklist.md`）：深色儀表在戶外陽光下可讀（不行就切 sun）、tracer 在 240 fps 實拍片段上的位置、
   20 球批次匯入對應到測驗格、3D 拖曳與按鈕在手套下可用。

---

## 6. 不做的事與風險

### 6.1 不做

| 項目 | 理由 |
|---|---|
| 揮桿平面、揮桿方向、最低點、擊球點、動態桿身傾角（§1.2 #22–26） | 單機 240 fps 解析度與取樣點不足；做了只會是先驗 |
| 同一球多機位融合（兩支手機同步） | 硬體只有一支手機（擁有者裁示） |
| hb 的 spin、apex、落地角、滯空；fo 的左右類 | 會幾乎完全等於先驗（§1.2 說明）；跨機位選項是唯一例外，且預設關 |
| 3D 函式庫（three.js 等） | 600–700 KB（UNVERIFIED）換不到必要功能；自寫 ≤ 12 KB |
| 影片重新編碼匯出 tracer 影片 | 需要 WebCodecs 編碼＋mux，iOS 支援與檔案大小風險；只做靜態圖 |
| 球場模擬、地形、風 | 無風速資料；`WIND_IGNORED` 照舊 |
| 數據磚預設集（多組版面切換） | 先做一組自選；預設集等擁有者用過再說 |
| 線上排行、分享測驗分數到網路 | 本機唯一、零網路（PRODUCT-SPEC §9） |
| 模仿商業產品的名稱、配色、版面細節、測驗名稱 | 法務約束；只用通用術語與自己的配色 |

### 6.2 風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| 推估數字看起來像實測（大字很有說服力） | 誤導練習方向 | 每個推估磚強制「估」＋◐＋範圍；詳情 sheet 寫方法；`measured` 永遠 false；e2e 斷言（LM-D 驗收 1） |
| D-plane 係數與 spin 係數來自職業選手平均 | 業餘偏差未知 | 參數集中在 `params.js`＋版本；比較時檢查版本；RN §8 清單待實測 |
| driver 的 side／curve 範圍 ±20–37 m | 散佈圖看起來很亂 | 散佈圖畫 1σ 橢圓、把 face_on 球分開放；文字寫明「方向感」 |
| hb 新推估（桿速、球速、carry）完全沒驗證 | 數字可能系統性偏差 | validity 固定「低」；未經實測前不得升「估」（寫進 registry 註解與 LM-B 測試） |
| shell 預算只剩約 50 KB | shot.js 改版＋新 token 可能超標 | 新畫面全 lazy；LM-A 驗收 4 限制 drop 1 增量；整合驗收看總量 |
| v2 遷移在大資料庫上卡住 | 開 app 變慢 | 讀時遷移＋每批 50 筆背景寫回，不開長交易；1000 球夾具 e2e |
| 舊版 app 讀不到 v2 備份 | 降版還原失敗 | 匯出畫面說明；v1 schema 保留給匯入 |
| 每球 MC 加 RK4 變慢 | KD4 退步 | LM-B 驗收 5 的 1.5 s 上限；必要時降 draws 並在 σ 上加 t 修正 |
| 單機測驗需要「錄完再匯入」 | 節奏比商業機器慢 | 批次匯入＋自動對應；本版不嘗試即時球數據 |

---

## 7. 擁有者決定（2026-11-06 已裁示）

裁示：D1＝深色為新安裝預設；D2＝不借用（§1.4 不實作）；D3＝hb 的 carry／side 顯示並標估計（低）＋誤差；D5＝落地草況預設「一般球道」，設定可改；D4、D6 採下表建議（k=0.25 可調、接受舊版讀不到 v2 備份）。


| # | 問題 | 建議 |
|---|---|---|
| D1 | 全 app 預設主題是否改深色（新安裝） | 是；既有使用者設定不動；資料畫面在 auto 時一律深色 |
| D2 | 是否允許跨機位借用（§1.4） | 預設關，先累積 face_on 資料後再開 |
| D3 | hb 的 carry／side（以 hb 桿速 × smash 先驗為基礎、σ 8–13%；實作後量到 20–26%，RN §7）要不要顯示 | 顯示但標「低」；若擁有者覺得太像猜，改 null（只需改 registry 一格） |
| D4 | 測驗預設題組的目標距離（40–120 碼 × 2 輪）與分數係數 k = 0.25 | 先用預設，用一週後調 |
| D5 | 落地草況預設「一般」 | 依練習場（墊子打出去的落點多為硬地）可能要改「硬」 |
| D6 | 是否接受 v2 備份無法被舊版讀取 | 接受（目前只有擁有者一人使用） |

## 8. 推理鏈（每個需求落到可機械判定的驗收）

| 需求 | 規格位置 | 驗收 |
|---|---|---|
| 量不到的用物理反推＋標估＋誤差 | §1.2、§1.5、§2.3 | LM-B 2、4；LM-D 1 |
| 完整數據表 | §1.2、§3.2、§3.4 | LM-D 1、2；LM-A 1 |
| tracer＋散佈＋2D/3D | §3.3、§3.6、§3.7 | LM-C 1–3；LM-D 3；LM-F 3 |
| 練習／測驗／gapping | §3.5、§3.8 | LM-E 1–3；LM-F 4 |
| 統計比較 | §3.7 | LM-F 1–3 |
| 深色儀表 UI＋三主題 AA | §4 | LM-A 3、6；整合 screenshot matrix 0 findings |
| 不加預算、lazy | §0、§5.0-11 | LM-A 4；LM-C 3；整合預算檢查 |
| 不用商業名稱／GolfDB／禁用套件 | §0 | 共通 grep；整合 grep |

## 9. UNVERIFIED 清單（轉實測的地方）

見 RN §8（10 項）。另加本檔的：three.js 大小（§3.6）、`GAP_MIN/GAP_MAX` 經驗值（§3.8）、測驗分數係數 k（§3.5）。
轉實測方式：擁有者若能在任何有發射監測器的場地打 20 球（face_on 10、hb 10，同時錄 240 fps），把監測器數字手抄進 `tests/fixtures/owner/lm-reference.json`，
LM-B 的 `lm.physics.coverage` 會多一個「實機涵蓋率」報表（不阻擋 verify，只報告）；這是把任何「低」升成「估」的唯一途徑。
