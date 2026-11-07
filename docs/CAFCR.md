# 離線高爾夫揮桿分析 PWA（golf-swing-lab）— CAFCR 計畫 v2

> 2026-11-04。本檔照 CAFCR（Customer objectives → Application → Functional → Conceptual → Realization）組織，最後是推理鏈、待決定與驗證。
> §G 數字已經過一輪獨立驗算（6 組 Python 重算＋被判錯的條目由第二位裁決員複核＋完整性審查）；驗算腳本在 scratchpad `verify/`。v1 備份：`offline-app-iterative-quiche.md.20261104-preCAFCR.bak`。

## 0. 已定案事項

| 日期 | 裁示 |
|---|---|
| 11-04 | 平台＝**PWA**（加到主畫面、離線）；手機 iPhone 12／14（未來升級）；Linux 開發機無法簽 iOS App |
| 11-04 | 數據＝**全套**：姿勢、tempo、桿頭速度、球速、發射角、carry；每個數字帶可信度，做不到給誠實空值 |
| 11-04 | **一支手機一次一個角度**；第一版自己練球用（單機、無帳號、資料只在手機、繁中） |
| 11-04 | 可用公開影片訓練（GolfDB） |
| 11-04 | 正式版放**公開 GitHub Pages**（開 repo 前仍先問一次）；開發用 Tailscale serve **9443**（443 已開 Funnel，禁用） |
| 11-04 | **沒有對齊桿、先不買**；**自拍架還沒買**；場地＝**練習場打位（墊子、有隔板）**；每次架設 **≤5 分鐘** |
| 11-04 | 自拍架由我決定：**1.7m 級鋁合金攝影三腳架＋球型雲台＋手機夾＋藍牙遙控**（C2 採購規格）；三個角度都要能用；**木桿（含 driver 架球座）與鐵桿都要支援，同一機位打所有球桿**（C1.4）；真俯視不做 |

---

# C — Customer objectives（關鍵驅動因子）

| KD | 擁有者要什麼 | 可量化目標 | 驗收（見 R6） |
|---|---|---|---|
| KD1 | **每次量得一樣**（同機位可比） | 拆裝 5 次：偏航 SD ≤0.5°、滾轉 SD ≤0.3°、D SD ≤20mm、h SD ≤15mm、球徑 CV ≤2%（三個角度各自驗） | M2b |
| KD2 | **誠實的準確度** | 合成：球速中位誤差 ≤2%、P90 ≤5%、ci95 涵蓋率 85–99%；實機：落球測試重力 9.81±3%；所有 null 有原因碼 | M4、M2b、contract 階段 |
| KD3 | **架設快** | 每次每角度 ≤5:00（P90，n≥10）；新場地一次性 ≤10:00 | M2b |
| KD4 | **每球很快出數據** | 即時模式 P95 ≤8s；高速模式每支 ≤45s（iPhone 12） | M5、M4b |
| KD5 | **離線** | 飛航模式下 匯入→分析→結果卡→匯出 全部走完 | M1、M6 |
| KD6 | **進步可量化** | 每球記 `preset_id`；跨預設比較 100% 帶 `PRESET_MISMATCH` | M6 |
| KD7 | **不打亂練球節奏** | 即時模式每球觸碰 0 次；高速模式每球 ≤2 次（診斷報告 `touches_per_shot`） | M5、M4b |
| KD8 | **事件時間準**（tempo 與所有指標的錨點） | GolfDB split1 PCE ≥0.70、Impact ≥0.95；擁有者 20 桿 Impact ±1 幀（60Hz）≥90% | M3 |
| KD9 | **全套數據都有答案**（含 carry） | 表 F2 每一格：有值必有 ci95／σ，null 必有原因碼；carry 永遠標 `estimated`＋`SPIN_ASSUMED` | M4、contract |
| KD10 | **支援多角度** | 正面、後方 DTL、高斜角後方三個角度各有架設規格、預設、重現驗收 | M2b |

---

# A — Application（使用情境）

**情境**：同一家練習場的打位（人工草墊、兩側隔板、身後走道），戶外或棚下光線，隔壁打位有擊球聲；自拍架；一支手機一次一個角度；一段練習約 50–100 球、1–2 個角度、每桿間隔 20–60 秒；每週 1–3 次。

**使用者旅程**：新場地建檔（一次）→ 開始練習 → 架設與校正 → 即時模式打球（或高速模式錄慢動作再匯入）→ 看結果、必要時修事件幀 → 換角度（重新架設）→ 歷史比較、匯出備份。

**非功能限制（2026-11-04 查證，細節見 v1 報告）**

| 項目 | 事實 | 對設計的影響 |
|---|---|---|
| iOS getUserMedia 幀率 | 官方無數字；WebKit 原始碼推論高幀率格式拿不到 | 即時模式以 30fps 設計，60 算加分；M1 實測 |
| 主畫面 App 相機權限 | 每次啟動重問（bug 327237）；hash 導航會重置 | 一段練習只 getUserMedia 一次、不用 hash／history 路由 |
| DeviceMotion 權限 | 需 transient activation（MDN）；主畫面 App 是否保留 UNVERIFIED；WebKit bug 269706 只說「經 worker 往返後呼叫會被拒」，**不是**「不能和 getUserMedia 共用一次點擊」 | 在同一個點擊處理器中**第一個**呼叫（任何 await 之前）；失敗則另給按鈕 |
| MediaPipe PoseLandmarker | iOS Safari 有成功案例（#4499）；官方不保證；lite 5.8MB／full 9.4MB／heavy 30.7MB；wasm 14.6MB | worker、先 GPU 失敗退 CPU；版本釘死 |
| WebCodecs | iOS 16.4+；HEVC 能否解 UNVERIFIED | M2 實測決定 720p240 H.264 或 1080p240 HEVC |
| 從「照片」匯入 | 會壓縮；「檔案」路徑原樣 | 匯入教學走「儲存到檔案→瀏覽」 |
| iPhone 視角 | 12 Pro Max 1080p240＝**68.161°**、720p240 同 68.161°（binned）；1080p120 裁切約 37.6°；12／14 非 Pro 與內建相機防手震裁切 UNVERIFIED | 不依賴 FOV：墊子校正時解 f；f 偏差檢查抓誤用 120fps／2x |
| 儲存 | 配額可達磁碟 60%；主畫面 App 不受 7 天清除 | `persist()`；超量先刪影片保數據 |
| Web Share Target | iOS 不支援 | 匯入只能 App 內開檔案選擇器 |
| 滾動快門讀出時間 | 無公開量測（假設 2–4ms） | 中值校正＋殘差入 ci95（C3） |

**場地與裝備假設（第一次到場地實量後覆寫）**：墊子 1.50m（沿目標線）×1.25m；球放墊子長邊中點、距相機側長邊 0.30m；打位寬（隔板到隔板）約 3–3.5m（**會限制正面距離**：球到面前隔板 B ≥2.95m 才能用理想 D=2.7，見 C2 窄打位）；走道深 ≥3m；練習場有固定橡膠球座（高度 UNVERIFIED，P1 量）；球手身高 1.75m、右打（左打全部鏡像）。

---

# F — Functional（功能與規格）

## F1 功能清單

| 功能 | 內容 | 服務的 KD |
|---|---|---|
| F1 拍攝 | 即時相機 30–60fps、連續錄影切片、擊球聲偵測、Wake Lock | KD4、KD7 |
| F2 匯入 | 慢動作檔探測（effective_fps、VFR、旋轉）、逐幀解碼 | KD4 |
| F3 姿勢／事件／指標 | PoseLandmarker、規則式＋TCN 事件、依角度的指標 registry | KD8、KD9 |
| F4 球與桿頭追蹤＋物理 | 背景相減追球、**3D 深度項擬合（fit3d）**、彈道 carry、MC 不確定度、滾動快門校正 | KD2、KD9 |
| F5 **架設校正與預設** | 墊子四角 PnP（解 f）、重力水平儀、幽靈框、檢查燈號、預設存取、架設計時、落球測試 | KD1、KD3、KD6、KD10 |
| F6 儲存與匯出 | IndexedDB、匯出 JSON／CSV、匯入還原、跨預設比較警示 | KD5、KD6 |
| F7 診斷 | 裝置能力報告 JSON、延遲／掉幀／觸碰計數 | KD2、KD4、KD7 |
| F8 **離線訓練與模型替換** | GolfDB→關鍵點→TCN→匯出→golden；擁有者標註微調；可回滾 | KD8 |

## F2 角度×指標表（registry 照表實作、逐格測試；可＝valid、估＝estimated、低＝low_confidence、不可＝null＋原因碼）

> 2026-11-06：發射監測器級擴充（golf-shot/2、14 個新 metric、high_behind 三格由不可改低）見 `docs/LAUNCH-MONITOR-SPEC.md`；本表保留為 golf-shot/1 的原始規格。

| # | 指標 | 正面 face_on | 後方 dtl | 高斜角後方 high_behind | 最低 fps | 不可時原因碼 |
|---|---|---|---|---|---|---|
|1|上桿／下桿時間、tempo|可|可|可|30|—|
|2|頭部位移：沿目標線|可|不可|低|30|VIEW_DEPTH_AXIS|
|3|頭部位移：垂直|可|可|不可|30|VIEW_DEPTH_AXIS|
|4|頭部位移：朝球／離球|不可|可|低|30|VIEW_DEPTH_AXIS|
|5|脊椎前傾角|不可|可|不可|30|VIEW_PLANE_MISMATCH|
|6|脊椎側傾角|可|不可|不可|30|VIEW_PLANE_MISMATCH|
|7–9|肩轉、髖轉、X-factor|低|低|低|30|—|
|10|手部路徑 vs 桿身平面|不可|可|不可|30|VIEW_PLANE_MISMATCH|
|11|上桿頂點桿身角|不可|估|不可|120|VIEW_PLANE_MISMATCH|
|12|重心轉移（骨盆側移％站寬，代理量）|估|不可|不可|30|VIEW_DEPTH_AXIS|
|13|早伸展（骨盆朝球位移）|不可|可|不可|30|VIEW_DEPTH_AXIS|
|14|桿頭速度|30–60fps 低（±25%）；240 估|不可|不可|30／240|VIEW_DEPTH_AXIS|
|15|擊球桿頭路徑 in-to-out|不可|不可|低（240；±2–4°）|240|VIEW_PLANE_MISMATCH／TRACK_TOO_SHORT|
|16|球初速|240 估；<200 不可|不可|不可|200|FPS_TOO_LOW／VIEW_DEPTH_AXIS|
|17|垂直發射角|估|不可|不可|200|同上|
|18|水平出球方向|不可（fit3d 的 ψ 只內部用；驗證後再議）|不可|低（240）|200|LAUNCH_DIR_UNOBSERVABLE|
|19|carry|估（需 16、17）|不可|不可|200|DEPENDS_ON_NULL|
|20|smash factor|估（需 14、16）|不可|不可|240|DEPENDS_ON_NULL|

tempo 量化誤差（±0.5 幀×3 事件，tempo 3.0）：30fps 2.56–3.57、60fps 2.77–3.27、240fps 2.94–3.06（已驗算）。

## F3 每球結果契約 `golf-shot/1`（schema/shot-v1.schema.json）

- 頂層：`schema, shot_id, session_id, venue_id, preset_id, created_at, app_version, algorithms{pose,events,calib,ball,fit3d,carry 各含 sha256}, capture{mode,view,source,orientation,width,height,nominal_fps,effective_fps,vfr,timestamps,clip_ref,trim_s}, calibration{…}, club{type,length_m,lie:'mat'|'tee',tee_lift_m,tee_lift_source:'measured'|'assumed'}, handedness, events{8 事件}, metrics{…}, quality{pose_mean_vis,frames_analyzed,frames_dropped,audio_onset,touches,warnings[]}, starred, note, revision`。
- `calibration{method:'mat_pnp'|'club_line'|'ball_only', source:'live'|'clip', f_px, f_locked, pose{yaw_deg,pitch_deg,roll_deg,X_m,Y_m,h_m,D_m}, pose_sigma{…}, reproj_rmse_px, slope_deg, preset_dev{…}, readout_ms, readout_source:'assumed'|'measured'}`；各平面比例尺（球平面、身體平面、地面）由 pose 推出，是衍生值不另存。
- 每個 metric：`{value, unit, ci95|sigma, validity, value_origin, measured, reason_codes[]}`。
- **歸屬規則**：架設／整球層級的狀況（`SETUP_UNVERIFIED、CALIB_STALE、PRESET_MISMATCH、NO_GRAVITY_REF`）寫進 `quality.warnings`，並把受影響的 metric 降級為 `low_confidence` 且在其 `reason_codes` 重複一次；單一指標的狀況只寫該 metric 的 `reason_codes`。
- **不變式（verify.sh contract 階段）**：validity ∈ {valid, estimated, low_confidence, occluded, ambiguous, dropped, stale, not_observable, implausible, not_computed}；`value≠null ⇔ validity∈{valid,estimated,low_confidence}`；null ⇒ reason_codes 非空；非 null ⇒ 有 ci95 或 sigma；每個碼都在 `contract/reason-codes.js` 有繁中說明。
- 原因碼（v1 已有＋本版新增）：`VIEW_DEPTH_AXIS, VIEW_PLANE_MISMATCH, FPS_TOO_LOW, TRACK_TOO_SHORT, TRACK_MAY_BE_SHORT, LAUNCH_DIR_UNOBSERVABLE, DEPENDS_ON_NULL, SPIN_ASSUMED, WIND_IGNORED, TIMESTAMPS_NOMINAL, TIMEBASE_SUSPECT, SETUP_UNVERIFIED, CALIB_STALE, PRESET_MISMATCH, DEPTH_DRIFT_SUSPECT, ROLLING_SHUTTER_ASSUMED, BODY_PLANE_ASSUMED, NO_GRAVITY_REF, AUDIO_UNAVAILABLE, THERMAL_DEGRADED, TEE_LIFT_ASSUMED`。

---

# C — Conceptual（核心概念與取捨）

| 概念 | 解決 | 取捨 |
|---|---|---|
| **K1 墊子即校正物** | KD1、KD2、KD3：不買對齊桿也有比例尺＋垂直度＋距離 | 綁場地；第一次要量墊子 |
| **K2 位姿預設＋幽靈框** | KD1、KD3、KD10：每次回到同一機位 | 預設存「位姿」不存像素（串流與慢動作 FOV 可能不同），所以每次都要先解位姿 |
| **K3 f 鎖定** | KD1：建檔時用放大鏡點選多次平均解出 f 並鎖進場地預設；之後每次用鎖定的 f 解位姿 | f 與 D 高度相關（r=0.98），不鎖 f 時 D 的 σ 57mm（3px），重現檢查會誤判；鎖 f 後 4–11mm |
| **K4 深度項 3D 擬合（fit3d）** | KD2：球的起飛方向 ψ 每球不同、架設控制不了；線性擬合 ψ=5° 偏 −5%／+4–5% | 要已知起點（墊子單應性給）、要 ≥5 幀；ψ 只內部用 |
| **K5 誤差預算與可信度傳遞** | KD2、KD9：每個數字的 ci95 由實際架設偏差、雜訊、系統項算出 | ci95 變寬 |
| **K6 系統偏差不平方和** | KD2：滾動快門是單邊偏差 | 用中值校正＋殘差入 σ；方向由裝置橫向（landscape left／right）決定符號 |
| **K7 誠實空值契約** | KD2、KD9 | 數字變少 |
| **K8 兩模式分工** | KD4、KD7：即時 30–60fps 給姿勢／tempo；球數據只在 240fps 高速模式 | 高速模式每段每角度多錄一次校正短片 |
| **K9 規則式事件為基準、TCN 要贏才上線** | KD8 | 訓練不在關鍵路徑；GolfDB 與自拍有落差 |
| **K10 單一 worker 影格管線** | KD4 | 見 R1 |
| **K11 落球測試** | KD2：沒有發射監測器也能在真實影片驗證比例尺＋時間基準 | 只驗比例尺與時間，不驗球速擬合本身 |

## C1 誤差預算（共同假設見 A；已驗算）

### C1.1 正面 face_on（D=2.7m、h=0.84m、俯仰 0、橫拍、240fps、1080p）

| 誤差來源 | 影響 # | 量級（驗算後） | 架設壓制 | App 現場檢查 |
|---|---|---|---|---|
| 墊子尺寸 | 16、14、2、3、12 | 捲尺 ±3mm/1.5m＝±0.2%；A4×5 ±0.7%；排球法 ±1–2%（偏長）；固定系統誤差 | 新場地捲尺量一次 | 墊子重投影 RMSE ≤2.0px |
| 誤套平面 | 2、3、12 | 球平面比例尺套到身體平面差 30%（0.8/2.7） | 身體深度由腳踝觸地點經墊子單應性取得 ±3cm→±0.9% | 腳踝落在墊內，否則 `BODY_PLANE_ASSUMED` |
| 偏航 θ | 14、16、19、20 | 墊子 PnP σ 0.10°（1px）／0.31°（3px）；線性擬合 ≈1.0%/°（遠離為負、靠近為正）；fit3d ≈0 | 平移腳架、不轉向；幽靈框 | \|θ\|≤1.5°、與預設差 ≤1.0°；墊子長邊兩半像素長度差 4.8px/° 交叉檢查 |
| 起飛方向 ψ | 16、17、19 | 線性擬合 ψ=5°：遠離 −5%、靠近 +4–5%（10°：−11%／+7–9%）；發射角耦合 Δθ≈cos²θ·(h−z)/D·tanψ＝0.27–0.29°/°；fit3d 殘差 <0.03% | 無法控制 | fit3d \|ψ\|>10° 或殘差 >1.5px→`DEPTH_DRIFT_SUSPECT` 並放大 σ |
| 俯仰 φ | 6、3、17 | 鉛直線傾斜 1°→0.06°、5°→0.29°（脊椎軸外 0.2m）；身體平面比例梯度 水平 0.5%／垂直 1.0% 每 °每 m（球平面 0.65／1.3）；肩轉 1°→≤0.04° | 0±1° | 重力 \|φ\|≤1.0°；墊子 PnP 俯仰 σ 0.10–0.31°（f 鎖定） |
| 滾轉 | 6、17（1:1） | 墊子 σ 0.08–0.25°；加速度計 ±0.3–0.5°（UNVERIFIED）；墊面排水坡度 | 每場地量一次坡度 | 相對重力 \|ψ_r\|≤0.5° |
| 距離／側向 | 間接 | f 鎖定：σ_D 4–11mm、σ_X 6–19mm；球平面比例尺 f/D 只差 0.16–0.48% | 腳架頂隔板（或球桿量距） | \|ΔD\|≤50、\|ΔX\|≤50、\|Δh\|≤30mm |
| 畸變 | 16、墊角 | 殘差 0.5–1%（UNVERIFIED）→球速 ±0.3–0.5% | 球與四角在置中 95% 框內（四邊各留 2.5%） | 選配：近端長邊弓高 >2px 啟用 k1 |
| 球心定位 | 16、17 | fit3d（起點以 5mm 先驗一起解）：球速 σ 0.23–0.31%、發射角 0.05–0.09°；1080p 球寬 22.4px（720p 14.9px）；球偏光軸 17° 時影像垂直拉長 4.6% | 1080p 優先 | 預測球徑用**水平寬**；靜止球 ±6%、飛行拖影幀 ±25%；拖影長寬比 ≤4 |
| 時間量化 | 1、事件 | ±2.1ms；擬合有 t0 | — | `TIMESTAMPS_NOMINAL` |
| 滾動快門 | 16、14 | **讀出 2–4ms → 水平與垂直速度同比例偏 −1.3…−2.8%**（讀出方向反過來就變正）；發射角 <0.03° | 一定橫拍（直拍大 2.4–4.7 倍） | 用 T_read=3ms 中值校正（+2.0%），殘差 ±0.7% 均勻→σ 0.4% 入 ci95；`ROLLING_SHUTTER_ASSUMED`；符號依 `screen.orientation` |
| 飛行幀數 | 16–20 | 保守模型（置中 90% 框、扣 impact 幀）：球置中 9.4/5.7/4.7（40/60/70 m/s）；**往目標側平移 0.4m→12.0/7.4/6.1**。字面到出畫面：11.7/7.5/6.4、平移後 14.2/9.2/7.8 | 平移 +0.3–0.4m | 架設時預算 <6 幀→`TRACK_MAY_BE_SHORT`（警示）；每球實際 <5 次偵測→`TRACK_TOO_SHORT`（null） |
| 空氣阻力 | 16 | 2m 內減速 0.65–0.93%（與球速無關），fit3d 內含阻力項 | — | — |
| 姿勢模型 | 1–13 | 角度 ±3–6°、位移 ±2–5%（假設）；正面以肩寬比反推肩轉本身有 −1°（45°）～−10°（90°）透視偏差 | 光線均勻 | `pose_mean_vis` |
| **球速合計（1σ）** | 16 | **模型內雜訊 ±0.5–1.0%**（墊子 0.2–0.6、球心 0.2–0.3、墊子尺寸 0.2、畸變 0.3–0.5、快門殘差 0.4）；**保守值 ±1.5–2.5%**（含未建模：真實畸變、拖影、ψ 實際行為）；線性擬合 ±4–7% | | |

### C1.2 後方 dtl（Db=3.0–3.5m、h=1.0m、俯仰 0、直拍）

| 誤差來源 | 影響 # | 量級 | 壓制 | 檢查 |
|---|---|---|---|---|
| 滾轉 | 5、10、11（1:1） | σ0.28°＋坡度 | 同正面 | ≤0.5° |
| 俯仰 | 5、13 | 球手軸外 0.7m：1°→0.23°、5°→1.17° | 0±1° | ≤1.0° |
| 偏航 | 5、4、13 | 一階透視項 ≈(x/Z)·tanθ：脊椎角 tan ≈0.4%/° → 1°≈0.1°、5°≈0.4–0.6°；墊子 σ 0.26–0.31° | 墊子中線延長線 | ≤1.0° |
| 側向／高度 | 10、11 | 平面線只在固定機位可比 | ±30mm | ≤30mm |
| 比例尺 | 4、13 | 473px/m（3.0m）；腳踝深度 ±3cm→±1% | — | 腳踝在墊內 |
| 框景 | 11 | 直拍 Db=2.5m 墊子四角出畫面 → Db ≥3.0m | — | 四角在框內 |
| 球速類 | 14、16、17、19、20 | 沿光軸深度無約束（棒球單鏡實測同結論）→ 不可 | — | `VIEW_DEPTH_AXIS` |

### C1.3 高斜角後方 high_behind（球線延長線、球後 2.75–3.0m、h≈1.7m（腳架最高）、對準球、橫拍、240fps）

| 誤差來源 | 影響 # | 量級 | 壓制 | 檢查 |
|---|---|---|---|---|
| 地面單應性 | 15、18 | 偏航 σ 0.42°（1.5m、俯角 31°）、0.58°（2.0m、39°）；1.7m 介於兩者之間（未另算） | 四角入鏡 | RMSE ≤2px |
| 桿頭取樣 | 15 | 桿頭 40m/s 時幀距 16.7cm → 擊球點 ±0.15m 內只有 1–2 點（20% 只有 1 點）；定位 σ1px 時 1.0–1.5°/px，拖影下實際 2–4° | 240fps | <2 點→`TRACK_TOO_SHORT` |
| 平面假設（桿頭離地 0–5cm） | 15 | 相機在球線上、最低點在球位 ≤0.35°；下壓擊球（最低點在球前 8cm、路徑 4°）約 1°；側偏 0.3m 時 0.4–2.2° | 球線延長線 | 側偏 >0.15m 紅燈 |
| 架高的效益 | 15 | 沿目標線方向的解析度 ∝ h/(Db²+h²)：Db 2.75–3.0m 時 1.7m＝理論最佳（h=Db）的 86–89%、2.0m＝92–95%、1.5m＝80–84%；而 #15 誤差由桿頭只有 1–2 個取樣點主導（2–4°） | 架 1.7m 即可，不必追 2m | — |
| 安全 | — | 上桿桿頭後掃直線上限：鐵桿 1.56m、driver 1.92m（手臂 0.62m＋桿長＋driver 球位前移 0.15m） | Db ≥2.75m（driver 留 ≥0.8m） | — |

### C1.4 木桿與鐵桿（同一機位打所有球桿；已驗算 V6＋獨立複核 V7，腳本 scratchpad `verify/V6-clubs/`、`verify/V7-recheck/`）

| 項目 | 鐵桿（PW–7i） | 球道木／混血 | Driver（架球座） | 處理 |
|---|---|---|---|---|
| 典型球速／發射角（假設） | 30–48m/s／17–28° | 52–60m/s／11–13° | 55–75m/s／10–13° | 球速上限依球桿（待決定 6） |
| 正面飛行幀數（保守模型、D=2.7、平移 0.4m） | 17.5–9.7 | 8.7–7.3 | 8.2–5.6 | 80m/s 剩 5.2；ψ 朝相機 6° 再少 0.3–0.4 幀（≥75m/s）、0.5–0.6（48–60m/s）、PW 約 1.0；driver ≥70m/s 在架設預算 <6 時會例行亮 `TRACK_MAY_BE_SHORT`（只是警示）；每球實際 <5 次偵測→`TRACK_TOO_SHORT` |
| 球的起點高度 | 墊上（球心 z=r） | 墊上 | **架在球座上**：若誤當墊上，深度與球速一起偏大，每 10mm 球座高約 +1.25–1.3%（30mm +3.8%、50mm +6.5%）；球徑差 30mm 時 3.7%、50mm 時 6.1%（臨界），多數情況落在 ±6% 容差內，**無法可靠地從球本身看出來** | P1 量球座高度（球底離墊）；C7 自動判斷球下方有無白色球座，判不出依目前球桿；沒量過用 30±15mm 先驗→`TEE_LIFT_ASSUMED`、σ 入 ci95；量到 ±5mm→±0.6% |
| 球位 | 同一點 | 同一點 | 球座位置 | **所有球桿的球放同一點（±10cm）**，相機側向基準＝這一點；±10cm 在 70m/s 時 ±0.3–0.4 幀 |
| 正面框景 | 桿頭後掃上限 1.56m | — | 1.92m | 平移 0.4m 後：球往目標側畫面寬 2.14m，往後（上桿）側只剩 1.34m（球平面，置中 95% 框；身體平面 D+0.7 處 1.79m）→ 上桿桿身水平附近桿頭會短暫出框（鐵桿可能、driver 一定），頂點桿頭也出框；可接受：桿頭追蹤只用擊球前後段，Top 事件看手腕，手腕在框內 |
| 高斜角後方 | 下壓擊球，平面誤差約 1° | — | 上揚擊球，桿頭離地 2–5cm，在 C1.3 平面假設範圍內 | Db 2.75–3.0m |
| 後方 dtl | — | — | 球位前移＝沿光軸更遠，不影響框景 | 不變 |
| carry | spin 先驗依球桿 | | | 待決定 6；永遠 `estimated`＋`SPIN_ASSUMED` |

## C2 最佳架設規格（三個角度都有物理參考點）

| 項目 | 正面 face_on | 後方 dtl | 高斜角後方 high_behind（選配） |
|---|---|---|---|
| 物理定位 | 腳架前腳頂住**相機側隔板底部**的標記點；或從墊子相機側長邊量 2.4m（兩支 driver 長＋約 0.1m） | 腳架中柱對準**墊子中線（長軸）的延長線**（目視沿墊子兩短邊中點瞄）；距墊子後短邊 2.25–2.75m | **球線**延長線（墊子相機側長邊往球手側 0.30m 的平行線，約 7 顆球寬）；距墊子後短邊 2.0–2.25m |
| 側向 | 球手正前方再**往目標側平移 +0.3–0.4m（不轉向）** | 中線上（＝手部延長線，球線往球手側約 0.35m） | 球線上，側偏 ≤0.15m（不可放墊子中線，差 0.33m） |
| 距離（到球） | D≈2.7m（2.7–3.0；<2.7 見窄打位，D=2.5 時 h 上限 0.79） | Db 3.0–3.5m | 2.75–3.0m（driver 安全距離） |
| 高度（手機中心） | **0.84m（0.82–0.86）**；h=0.88 時墊子近端角出框、h=1.0 墊子整個出框 | 1.00m | 腳架最高（約 1.7m，標記） |
| 俯仰／滾轉 | 0±1°／±0.5° | 0±1°／±0.5° | 對準球（俯角 = atan(h/Db)：約 30–32°），相對預設 Δφ ≤1.0°；滾轉 ±0.5° |
| 偏航 | ⊥ 墊子長邊 ±1.5° | ∥ 長邊 ±1.0°（長邊消失點在中心欄） | ∥ 長邊 ±1.0° |
| 方向 | **橫拍**（直拍到出畫面只剩 6.6/4.2/3.6 幀） | **直拍** | 橫拍 |
| 中柱標記 | 0.84m 一道 | 1.00m 一道 | 最高或固定刻度 |
| 鏡頭／慢動作 | 1x；240fps（禁 120）；720p240 H.264 或 1080p240 HEVC（M2 定，720p 球寬 14.9px 接近 ≥12px 門檻） | 1x；即時 30–60（高速 240 也可） | 1x；240 |
| 入鏡 | address 全身＋墊子四角在置中 95% 框；上桿頂點手高 >2.05m 進邊界帶、桿頭頂點會出框（可接受，Top 事件看手腕） | 全身＋四角 | 墊子四角＋球＋桿頭擊球段 |

**窄打位（正面）**：P1 量「球到面前隔板」的距離 B（腳架佔 0.25m，D=B−0.25）。限制是墊子近端兩角要在置中 95% 框內，以及 address 頭頂要在畫面內。

| B | D | 手機高度上限 | 平移 | 正面飛行幀數 48/60/70m/s | 身體平面畫面頂（95%） | 判定 |
|---|---|---|---|---|---|---|
| ≥2.95m | 2.7 | 0.84（上限 0.87） | 0.4 | 9.7／7.4／6.1 | 2.07m | 理想 |
| 2.65m | 2.4 | ≤0.74 | 0.4 | 8.7／6.6／5.5 | 1.86m | 可用 |
| 2.45m | 2.2 | ≤0.67 | 0.4 | 8.1／6.1／5.1 | 1.72m | 可用；driver >70m/s 常 `TRACK_TOO_SHORT` |
| <2.45m | <2.2 | D=2.0 時 ≈0.59 | D=2.0 時上限 0.34 | D=2.0 時 7.2／5.4／4.4 | 1.57m（頭頂進邊界） | 正面球數據不保證；改以後方／高斜角為主，或試 0.5x 超廣角（240fps 是否支援、畸變 UNVERIFIED） |

**校正物退化階梯**（墊子看不到或不是矩形時自動降級，`calibration.method` 記錄）：
1. `mat_pnp` 墊子四角＋鎖定 f：偏航 σ 0.1–0.3°、球速 ±0.5–1.0%（保守 1.5–2.5%）。
2. `club_line` 一支球桿平放沿目標線＋重力：偏航 σ ≈1.3–2°、球速 fit3d ±2–3%。
3. `ball_only` 只有球＋重力＋目測：偏航 3–5°、fit3d ±3–4%、線性 ±4–7%；身體平面靠身高 ±3–5%。
4. 選配升級：兩支對齊桿 T 形（σ 0.16°／0.5° @1px／3px）——只有草地或非矩形墊才需要買。

**帶去練習場的東西**：手機、三腳架、藍牙遙控（多數附）、**捲尺**（第一次量墊子、球座高度、球到面前隔板距離）、**紙膠帶**（中柱標記，不貼隔板也行）。沒有捲尺時用 A4 紙沿邊排（±0.7%）。

**自拍架採購規格（11-04 定案，一支打三個角度、所有球桿）**

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

真俯視不做：需要 ≥2.5m 的吊臂把手機伸到打擊區正上方，一個人 5 分鐘內架不穩，掉落會砸到人。high_behind 是唯一的高角度。

## C3 定位方法（架設 → 現場檢查 → 鎖定預設 → 下次重現）

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

---

# R — Realization（實作）

## R1 架構（靜態 PWA、無後端、無打包工具、純 ES modules）

主執行緒：介面、相機、錄影、回放（不用 hash／history 路由）。`vision.worker.js`：解碼、姿勢、追蹤。AudioWorklet：擊球聲。事件／指標／物理／校正數學是純函式，可在 Node 測。

| 模組（app/src/） | 函式庫 | 執行緒 | 重點 |
|---|---|---|---|
| `capture/{camera,recorder,frametap}.js` | getUserMedia、MediaRecorder、rVFC、Wake Lock | 主 | 一次 getUserMedia 同時要影像＋聲音（`frameRate:{ideal:60}`）；ROI ≤384px ImageBitmap＋`t_media_s` 轉 worker；高速模式鎖定後主動 `stop()` track 讓出相機 |
| `sensors/gravity.js` | DeviceMotion | 主 | 點擊處理器第一個呼叫 `requestPermission()`；低通濾波得俯仰／滾轉 |
| `import/{probe,demux,decode}.js` | mp4box（vendor，BSD-3）＋WebCodecs；備援 `<video>` seek＋rVFC | worker（不行就主執行緒解碼轉送） | `probe{codec,w,h,rotation,sample_count,effective_fps,vfr,cts_s[]}`；容器 CTS，不單調退名目 fps（照先前單鏡棒球追蹤工具的做法） |
| `pose/*` | @mediapipe/tasks-vision 1.2.2（Apache-2.0） | worker；GPU→CPU | 即時 lite、匯入 full、heavy 按需；`PoseSeq{t_s[T], img[T*33*4], world[T*33*3]}` |
| `events/{rules,tcn,detect}.js` | 純 JS（自寫 Conv1d） | worker／Node | 30Hz 特徵→8 事件；high_behind 先只用規則式（GolfDB 無此視角） |
| `metrics/{common,face_on,dtl,high_behind,registry}.js` | 純 JS | worker | F2 表寫成資料；左打鏡像 |
| `calib/{mat,pnp,gravity,preset,ghost,checks,timer,droptest}.js` | 純 JS（自寫 homography 分解＋LM；PnP 與重投影 RMSE 做法照 `camera.py:85-109`，但支援解 f 與鎖 f） | 主／worker | 墊角偵測（邊線擬合）＋放大鏡點選；位姿＋σ；預設 CRUD；幽靈框；燈號；計時 |
| `track/{bgsub,ccl,ball,club}.js` | 純 JS（移植 `tracking.py:11-70`） | worker | 不用 OpenCV.js、不用 Ultralytics（AGPL） |
| `physics/{fit3d,fit2d,ballistics,mc,shutter}.js` | 純 JS（fit3d 移植 `estimate.py:70-127,130-187` 的 model 法＋已知起點 p0 先驗＋阻力項；門檻照 `:14-22`；MC 照 `:165-176`） | worker | 球速、發射角、ψ（內部）、桿頭速度、smash、carry（RK4＋500 次 MC、spin 依球桿先驗）、滾動快門中值校正 |
| `audio/{onset.worklet,onset}.js` | AudioWorklet | 音訊 | 麥克風被拒→退回手腕速度峰值＋`AUDIO_UNAVAILABLE` |
| `store/{db,quota,export}.js` | 自寫 IndexedDB 包裝；`navigator.storage.persist/estimate` | 主 | venues、presets、sessions、shots、poses、clips |
| `ui/{replay,setup,results,history}.js` | Canvas 2D | 主 | 骨架疊圖、逐幀、事件修正、可信度徽章、幽靈框 |
| `diag/report.js` | — | 主 | 裝置報告 JSON（含架設計時、位姿、偏差、f、touches_per_shot、延遲、掉幀） |
| `sw.js`（由 `app/sw.template.js` 產生） | — | SW | 見 R4 |

**資源預算**：預快取 ≤35MB（約 31MB）；worker 影格環形緩衝 ≤6s×384px；處理完立刻 `close()`；延遲 p95 超過 12s 或連續掉幀 >10% 時自動降級（full→lite、抽幀加倍），記 `THERMAL_DEGRADED`。

## R2 訓練（GolfDB → 揮桿事件；與 M0–M2 平行、不在關鍵路徑）

- **範圍**：開源影片只用來訓練「揮桿事件偵測」。姿勢用現成 MediaPipe；球速、桿頭、carry 不靠開源影片（以合成資料＋落球測試驗）。
- **路線**：mediapipe 1.2.2（與網頁同版）抽關鍵點→小型 TCN（4 層 dilated Conv1d、64 通道、約 6 萬參數）→純 JS 推論。重訓 SwingNet→ONNX 只做離線天花板參考。
- **環境**：新建 `~/.local/share/golf-swing-lab-venv`（3.12）：torch 2.14.0（cu130）、mediapipe 1.2.2、opencv-python-headless 5.0.0.93、numpy、scipy、pandas、onnx、onnxruntime、gdown、pytest，釘在 `training/requirements.lock`。不碰既有兩個 venv。
- **資料**：clone wmcnally/golfdb 到 `training/vendor/golfdb`（保留 LICENSE）；gdown videos_160 到空目錄 `training/data/videos_160`＋sha256 manifest；Python 一律 `-I`；`data/`、`cache/` 進 .gitignore；不抓 YouTube 原片（預設）；「關於」頁註明出處。
- **落差與限制**：GolfDB 是轉播職業選手、160×160、多數非慢動作、視角只有 face-on／DTL／其他 → high_behind 只用規則式；以擁有者自己標註的 20 桿以上補足（P14），之後再微調。授權 CC BY-NC（code）、影片與標註未寫 → 只個人非商業用途；權重是否隨公開站發布待決定。
- **流程**：見 P13。驗收：split1 整體 PCE ≥0.70、扣 Address／Finish ≥0.88、Impact ≥0.95、Top ≥0.80、贏規則式 ≥0.05（論文 76.1／91.8／98.4／83.9）；JS TCN 對 golden ≤1e-4。

## R3 專案落地

```
golf-swing-lab/   （git；main 原始碼、gh-pages 部署）
  app/       index.html  manifest.webmanifest  sw.template.js  styles/  icons/  models/
             src/{main.js,ui,capture,sensors,import,pose,events,metrics,calib,track,physics,audio,store,contract,diag,workers}
             vendor/   ← scripts/vendor.mjs 依 vendor/manifest.json（版本＋sha256）拉取
  schema/shot-v1.schema.json
  docs/      CAFCR.md（本計畫的正式版）  contract.md  metrics-by-view.md  setup-guide.md  device-checklist.md  ADR/
  scripts/   verify.sh  build.mjs  check-sw.mjs  vendor.mjs  devserve.py  deploy_pages.sh  check_device_report.mjs  eval_owner_set.mjs  make_y4m.py
  tests/     unit/*.test.mjs  e2e/*.mjs  synth/（揮桿、球飛行、墊子、落球產生器）  fixtures/
  training/  requirements.lock  golfdb/  extract_keypoints.py  train_tcn.py  eval_pce.py  export.py  tests/
  deploy/last-deploy.json   dist/（gitignore）
```

- 不用 Vite（Node 18.19.1；Vite 7/8 要 ≥20.19）。零依賴 `scripts/build.mjs`。
- **verify.sh**（stage() 印 PASS/FAIL/SKIP、失敗數＝exit code）：env（node、vendor sha256）／static（`node --check`；grep 禁 `location.hash`、`history.pushState`、外部 `https://`）／unit（指標、事件、彈道、追蹤、**calib**、**fit3d**、shutter、store）／contract／model-parity／synthetic-e2e（M4 門檻）／**synthetic-calib**（M2b 機器門檻）／build（shell ≤1MB、預快取 ≤35MB）／sw-version／browser-e2e（選配，Playwright 1.49.1）／training（選配）。

## R4 sw.js、部署、手機實測

- `VERSION=<semver>+<預快取內容 sha256 前 10 碼>` 由 build 產生；check-sw.mjs 檢查雜湊＝VERSION、引用檔都在清單、內容變但 semver 沒升→FAIL。快取兩層：`gsl-shell-<VERSION>`（整個換）＋`gsl-assets`（大檔帶內容雜湊網址、跨版本保留）。新版只顯示「點此更新」橫幅，練習中不重整。
- 部署 `scripts/deploy_pages.sh`（照 `global-flow-dashboard/deploy_pages.sh:19-34`）：verify 全過＋工作樹乾淨→暫時 index `GIT_INDEX_FILE=… git --work-tree=dist add -A && git write-tree`→`commit-tree`→`push --force origin <commit>:refs/heads/gh-pages`（含 .nojekyll）→`git prune --expire=3.days.ago`→更新 `deploy/last-deploy.json`。網址 `https://ahhshiba.github.io/golf-swing-lab/`。
- 手機實測：`node scripts/build.mjs --dev`→`python3 scripts/devserve.py --bind 127.0.0.1 --port 8796 --root dist --prefix /golf-swing-lab/`→`timeout 15 tailscale serve --bg --https=9443 http://127.0.0.1:8796`（`tailscale serve status` 須 9443 且無 Funnel；**絕不掛 443**）→iPhone 開 `https://<host>.<tailnet>.ts.net:9443/golf-swing-lab/`→用完 `tailscale serve --https=9443 off`。

## R5 流程定義（每個流程 8 欄）

| 流程 | 目的 | 觸發 | 前置條件 | 步驟 | 檢查與門檻 | 輸出 | 失敗處理 | 耗時 |
|---|---|---|---|---|---|---|---|---|
| P0 首次安裝 | 裝到主畫面、預快取 | 第一次開網址 | iOS 17+、Wi-Fi | 開網址→加到主畫面→下載進度 | `standalone`、`sw_controlled`、`precache_complete==1.0` | 可離線的 App | 續傳；換網路 | ≤3 分 |
| P1 場地建檔（一次性） | 建立 venue（墊子尺寸、坡度、f） | 新練習場或換墊子 | P0；捲尺 | 量墊子長寬兩次→手機平放墊上 3 秒量坡度→量球座高度（球底離墊）與球到面前隔板距離 B→中柱貼標記→（可行時）隔板標記→做一次 P3（同時放大鏡點四角 3 次平均解 f 並鎖定） | 兩次量差 ≤3mm；坡度穩定 ±0.1°；三次 f 解 SD ≤1% | `venue{mat_L,mat_W,slope,tee_lift_m,bay_B_m,f_locked,ref_points}` | 量差大重量；f 不穩→檢查 1x／240fps | (2–3)＋0.5＋0.3＋1＋1＋(3.8–4.1) ≈ **8.6–9.9 分** |
| P2 每次練習開始 | 一次取得所有權限 | 按「開始練習」 | P0 | 同一點擊內：DeviceMotion.requestPermission（第一個、await 之前）→getUserMedia（影像＋聲音）→AudioContext.resume→Wake Lock | `gum_calls==1`；四項權限狀態記入報告 | session | 見 P17 | ≤20s |
| P3 架設與校正 | 回到預設機位並驗證 | P2 之後、換角度時 | 有 venue；選角度 | C3 表 C0–C9（高速模式 C10 取代 C5） | C3 各門檻 | `calibration`、`preset_id` | 見 C3；紅燈可強制（`SETUP_UNVERIFIED`） | 即時 ≤4:05、高速 4:30 |
| P4 即時模式一桿 | 自動切片出姿勢與 tempo | 偵測 ADDRESS | P3 已鎖定 | 10Hz lite 待機→ADDRESS（手腕 <0.15m/s ≥0.5s）→SWING（>1m/s）→IMPACT（擊球聲落在 SWING 內；無聲用手腕峰值）→FINISH（靜止 ≥0.7s）→補跑全幀率→結果卡；MediaRecorder stop/start 切片 | 只有聲音無動作＝隔壁，忽略；有動作無聲＝空揮；`touches==0` | shot（含 `preset_id`） | 延遲超標→降級（R1） | P95 ≤8s |
| P5 高速模式一支 | 球數據 | 使用者錄完慢動作 | P3（C10）完成 | 藍牙遙控錄→回 App「匯入」→檔案選擇器→探測→漂移檢查→第一輪 60Hz 姿勢→事件→第二輪 impact 前 30／後 60 幀全幀率追球→fit3d→MC→carry | effective_fps ≥200；下桿時長 0.15–0.60s（否則 `TIMEBASE_SUSPECT`）；墊角漂移 ≤2px（否則 `CALIB_STALE`）；球速 10–90m/s、發射角 −5～45°（否則 `implausible`） | shot | <200fps→教「儲存到檔案→瀏覽」 | 每支 ≤45s |
| P6 檢視與修正 | 人工修正事件幀並重算 | 打開結果卡 | 有 shot | 拖時間軸→修事件→重算 | 事件順序單調；`revision+1`；保留原值 | 新 revision | 不單調拒存 | — |
| P7 歷史與匯出 | 追蹤進步、備份 | 使用者 | 有 shots | 篩選（角度、預設、球桿）→比較→匯出 JSON／CSV | 跨預設比較 100% 帶 `PRESET_MISMATCH`；匯出再匯入完全相同 | 檔案 | 匯入 schema 不符拒絕並說明 | 匯出 ≤10s／1000 球 |
| P8 App 更新 | 拿新版 | sw 偵測到新 VERSION | 不在練習中 | 顯示橫幅→使用者點→重整 | 練習中不重整 | 新版 | 失敗保留舊版 | ≤30s |
| P9 模型更新 | 換更好的事件模型 | 新權重 | P14 標註集 | 微調→golden ≤1e-4→PCE 不退步→替換 | 兩個門檻 | 新模型＋舊版保留 | 回滾 | 離線 |
| P10 儲存清理 | 不讓空間爆 | 用量 >上限（待決定 9） | — | 提醒匯出→先刪原始影片→保留數據與姿勢 | 刪後低於上限 | — | 練習中只警告不刪 | — |
| P11 診斷報告 | 實機驗收與除錯 | 隨時 | — | 診斷頁→複製報告 JSON | 欄位齊全（schema） | report.json | — | ≤5s |
| P12 實機驗收 | 里程碑判定 | 里程碑 | P11 報告 | 貼回開發機→`node scripts/check_device_report.mjs r.json --milestone Mx` | exit 0 | 驗收紀錄 | FAIL 回對應里程碑 | — |
| P13 訓練資料流程 | 產事件模型 | 開發機 | venv、GolfDB | 下載→sha256→抽關鍵點→`train_tcn.py --split 1..4`→`eval_pce.py`→`export.py`→golden | R2 門檻 | `event-tcn-v1.bin`＋json＋golden | 未過只上規則式 | 抽關鍵點約數十分；訓練 <1 小時（估） |
| P14 擁有者標註 | 補足領域落差 | 累積 ≥20 桿 | P6 介面 | 每桿標 8 事件→存標註集→`eval_owner_set.mjs` | 首次記基準；之後 Impact ±1 幀 ≥90% | 標註集 | — | 約 30s／桿 |
| P15 場地／預設切換 | 換場地或打位 | 開始練習時 | 多個 venue | 自動依上次 venue 預選→使用者確認或切換；同練習場不同打位＝同 venue、不同 preset | 墊子尺寸差 >1% 提示「可能換了墊子」→跑 P1 | venue_id、preset_id | — | ≤10s |
| P16 多角度輪換 | 同一段練習換角度 | 使用者選換角度 | session 進行中 | 選角度→換橫直→重跑 P3（5 分預算每個角度各算） | 同 P3 | 新 preset 的 shots | — | 每角度 ≤5 分 |
| P17 權限與中斷恢復 | 被拒或被打斷不當機 | 權限被拒、切到內建相機、來電、鎖屏 | — | 相機被拒→只能高速匯入模式；麥克風被拒→`AUDIO_UNAVAILABLE`、改手腕峰值；水平儀被拒→另按鈕、仍拒→`NO_GRAVITY_REF`；回到前景且 track 已結束→提示重新 getUserMedia（記 `gum_calls`） | 每種情況都有 UI 狀態，不卡死 | 狀態列 | — | — |
| P18 發熱／電量／空間守門 | 長時間練習穩定 | 延遲或掉幀超標、電量低（若可得）、空間 <500MB | — | 自動降級（full→lite、抽幀加倍）→仍超標停即時改提示高速；空間不足先停錄原始影片 | 降級後 P95 ≤8s | `THERMAL_DEGRADED` 標記 | — | — |
| P19 校正健檢 | 抓墊子被移動、光線改變、比例尺漂移 | 每支影片、每 20 球、每月 | 有 preset | 墊角漂移比對；墊子尺寸重解差 >1%→提示；畫面平均亮度變化 >30%→背景模型重建；（選配）落球測試重力 9.81±3% | 各門檻 | 警示與原因碼 | 重跑 P3 或 P1 | 落球 ≤1 分 |

流程關係：
```
P0 → P1（每場地一次）→ P15 → P2 → P3 ─┬→ P4（即時）─┐
                                      └→ P5（高速）─┴→ P6 → P7 → P10
                     P16 換角度回 P3；P17／P18／P19 隨時；P8、P9、P13、P14 只在練習外；P11→P12 綁里程碑
```

## R6 里程碑（順序 M0→M1→M2→M2b→M3→M4→M4b→M5→M6；訓練 P13 自 M0 起平行；M4 依賴 M2b＋M3；M5 依賴 M1＋M3）

實機驗收一律走 P11→P12（`check_device_report.mjs` exit 0）。每個里程碑交付前，≥2 檔改動派 fresh-context `verifier` 驗收。

| 里程碑 | 機器驗收（verify.sh） | 實機驗收（P12） | KD |
|---|---|---|---|
| **M0 環境與資料** | env PASS；`python -I -c 'import torch,mediapipe;assert torch.cuda.is_available();assert mediapipe.__version__=="1.2.2"'`；`check_data.py` 印 1400 annotations／4 splits | — | KD8 |
| **M1 PWA 骨架＋相機** | build、sw-version PASS；browser-e2e 離線重整後 `#app-ready` 存在且 SW 控制頁面 | `standalone`、`sw_controlled`、`precache_complete==1.0`、`webcodecs.avc1`、`media_recorder.types` 非空；實測 `frameRate` 與 DeviceMotion 權限行為照實記錄（＝UNVERIFIED 轉實測） | KD5 |
| **M2 匯入、解碼、姿勢回放** | browser-e2e 匯入 240fps 測試檔：解碼幀數＝樣本數、時間戳單調、effective_fps 誤差 <1% | 「照片」「檔案」兩路至少一路 effective_fps ≥200 且 decoded==sample_count；HEVC 能否解；`pose.full.ms_p50 ≤60` 才預設 full | KD4 |
| **M2b 校正與架設重現（新）** | synthetic-calib：合成墊子＋雜訊，**1px**：偏航 P95 ≤0.25°、滾轉 ≤0.2°、D（f 鎖定）≤10mm；**3px**：偏航 ≤0.7°、滾轉 ≤0.6°、D（f 鎖定）≤25mm；f 自由解 σ ≤1%（1px）；退化階梯 club_line／ball_only 自動降級測試 | 三個角度各：同位置拆裝 5 次，偏航 SD ≤0.5°、滾轉 SD ≤0.3°、D SD ≤20mm、h SD ≤15mm、球徑 CV ≤2%、墊角 SD ≤4px；架設計時 P90 ≤300s（n≥10）；新場地 ≤600s；落球測試 9.81±3% | KD1、KD3、KD10、KD2 |
| **M3 事件＋tempo＋姿勢指標** | `eval_pce.py --split 1` 達 R2 門檻；unit 逐格檢查 F2 表；model-parity、contract PASS | 擁有者 20 桿標註：首次記基準，之後 Impact ±1 幀（60Hz）≥90% | KD8、KD9 |
| **M4 球與桿頭＋球速、發射角、carry** | synthetic-e2e 60 球（30–80m/s、5–30°、**⅓ 架球座（球座高 0–50mm、量測誤差 ±5mm）**、**偏航 ±2°、ψ ±6°、讀出 0–4ms 且方向兩種、墊角雜訊 3px**、雜訊＋拖影）：球速誤差中位 ≤2%、P90 ≤5%；發射角中位 ≤1°、P90 ≤2.5°；ci95 涵蓋率 85–99%；**fit3d 誤差中位數 < 線性擬合的一半**；30fps 輸入 100% 球速 null＋`FPS_TOO_LOW`；不合理擬合全 `implausible`；碼皆合契約 | 鐵桿與 driver 各 10 球正面 240fps，各 ≥7 球球速非 null；（若有發射監測器場次）中位誤差 ≤3%，否則明寫「實機未校正」 | KD2、KD9 |
| **M4b 高速模式效能（新）** | — | iPhone 12：每支 ≤45s；`touches_per_shot ≤2` | KD4、KD7 |
| **M5 即時模式自動切片** | Chromium 假相機＋假音訊：10 真揮＋5 空揮＋10 隔壁聲→召回 ≥0.9、誤觸發 ≤1 | 偵測數與實際差 ≤1；`latency_p95_s ≤8`；`gum_calls==1`；`touches_per_shot==0` | KD4、KD7 |
| **M6 歷史與匯出** | unit：匯出再匯入相同、CSV 欄位固定、跨預設比較帶 `PRESET_MISMATCH`；browser-e2e：建 3 球→匯出→清空→匯入→3 球回來 | 飛航模式下 匯入→分析→結果卡→匯出 全通過；`storage.persisted` | KD5、KD6 |

## R7 風險與緩解

| 風險 | 緩解 |
|---|---|
| iPhone 12 WASM 姿勢太慢、發燙 | lite＋ROI＋抽幀；即時模式本質是事後補算；P18 降級 |
| MediaPipe GPU delegate／worker 在 Safari 出問題 | 自動退 CPU；版本釘死放 vendor |
| Safari 不能解 HEVC | 720p240 H.264（球寬 14.9px）；備援 `<video>` seek |
| 匯入 240fps 被轉檔 | 探測有效幀率；「儲存到檔案→瀏覽」；`TIMEBASE_SUSPECT` |
| 每次開 App 重問權限 | 一段練習只要一次；不用 hash；P17 |
| 墊子邊緣偵測不穩（綠草對綠框） | 放大鏡手點為主、自動偵測為輔；f 鎖定降低依賴 |
| 墊子被別人移動或換墊子 | P19 漂移與尺寸重解；P15 |
| 隔板不能貼標記 | 改用球桿量距（C2）＋幽靈框收斂 |
| 打位太窄（B <2.45m） | P1 先量；窄打位預設（C2）；最壞時正面只做姿勢 |
| 球座高度沒量或換了球座 | `TEE_LIFT_ASSUMED`＋σ 入 ci95；C7 每次判斷有無球座 |
| 讀出時間未知 | 中值校正＋殘差入 ci95；符號依方向；之後可做燈光閃爍條紋自校（待決定 8） |
| 真實準確度無參考 | 落球測試；盡量找一次發射監測器場次（待決定 5） |
| GolfDB 落差與授權 | 關鍵點模型＋擁有者標註；只個人非商業；權重發布待決定 |
| 首次載入 31MB／資料被清 | Wi-Fi 下載、大檔跨版本保留、`persist()`、提醒匯出 |
| 443 開著 Funnel | 開發一律 9443 並檢查非 Funnel |

---

# 推理鏈（每個 KD 都落到可機械判定的驗收）

| KD | Application | Functional | Conceptual | Realization | 驗收 |
|---|---|---|---|---|---|
| KD1 重現 | 同一打位反覆來、腳架每次拆裝 | F5 | K1、K2、K3 | calib/{mat,pnp,preset,ghost}；C2 物理參考點 | M2b 拆裝 5 次×3 角度 |
| KD2 誠實準確 | 單鏡、偏航與 ψ 不可控、讀出未知 | F4、F5 | K4、K5、K6、K11 | physics/{fit3d,shutter,mc}；calib/droptest | M4 合成（含偏航、ψ、讀出）；M2b 落球 |
| KD3 架設快 | 每段時間有限 | F5 | K1、K2 | calib/timer；C3 流程 | M2b P90 ≤300s、新場地 ≤600s |
| KD4 出數快 | 每桿 20–60 秒 | F1、F2 | K8、K10 | capture、worker、P18 | M5、M4b |
| KD5 離線 | 練習場可能無網路 | 全部 | 靜態 PWA | sw.js 兩層快取 | M1、M6 飛航模式全流程 |
| KD6 進步可量化 | 長期追蹤 | F6 | K2（preset_id） | store、P7 | M6 |
| KD7 不碰手機 | 手上有球桿 | F1、F7 | K8＋藍牙遙控 | capture、diag `touches_per_shot` | M5、M4b |
| KD8 事件準 | 公開影片＋自己的揮桿 | F3、F8 | K9 | events、training、P13、P14 | M3 |
| KD9 全套數據 | 要 carry | F3、F4 | K7、K5 | metrics/registry、physics/ballistics、contract | M4、contract 階段 |
| KD10 多角度 | 正面／後方／高斜角 | F5、F3 | K2 | C2 三角度物理定位、registry | M2b 三角度各自驗 |

---

# 待擁有者決定（合併清單；不阻塞 M0–M2，到相關里程碑前再問）

1. GolfDB 訓練出的權重是否隨公開站發布（替代：從手機「檔案」匯入）→ M3 前。
2. 要不要抓 YouTube 原片換解析度（預設不抓）。
3. （11-04 已結案）自拍架＝1.7m 級攝影三腳架；真俯視不做，high_behind 是唯一高角度。
4. 慢動作格式「最相容」720p240 或 1080p240 HEVC → M2 實測後。
5. 能否找一次有發射監測器（Trackman／Toptracer 等）的場次校正球速／carry → M4 前。
6. 各球桿 spin 先驗與球速上限、身高、慣用手 → M4 前。
7. 架設紅燈時：允許強制開始（球速類降為 low_confidence＋`SETUP_UNVERIFIED`，預設）或直接擋球速類。
8. 讀出時間：用中值假設（預設）或之後做燈光閃爍條紋自校。
9. 原始影片保留份數與儲存上限 → M6 前。
10. `tailscale serve --https=9443` 持久設定 → M1 前。
11. 正面相機往目標側平移 +0.4m（多 2.6/1.7/1.4 幀，shank 風險略增）。
12. 隔板可否貼標記（不行就用球桿量距）。
13. 高速模式每支 ≤45s 目標值。
14. 正面 #18 起飛方向在 fit3d 經實機驗證後是否開放成「低」。
15. 第一次到場地若球到面前隔板 B <2.45m：正面改以姿勢為主、球數據靠後方或試 0.5x 超廣角 → P1 後。
- 已結案：對齊桿（不買，改用墊子）；hosting（公開 GitHub Pages）；自拍架（1.7m 級攝影三腳架）；球桿範圍（木桿與鐵桿都要）。

# UNVERIFIED → 在哪裡轉實測

| 項目 | 里程碑 |
|---|---|
| getUserMedia 實際幀率、MediaRecorder 幀率 | M1 |
| DeviceMotion 權限是否保留、能否與 getUserMedia 同一點擊 | M1 |
| 12／14 非 Pro 1080p240 FOV、內建相機防手震裁切（以解出的 f 判斷） | M2b |
| 240fps 匯入是否保留、HEVC 能否解、worker 內 WebCodecs | M2 |
| MediaPipe GPU delegate 與 iPhone 12 效能 | M2 |
| 墊子尺寸、隔板距離（B）、走道深度、坡度、球座高度 | P1（第一次到場地） |
| 0.5x 超廣角能否錄 240fps、畸變（只在窄打位需要） | M2 |
| 墊子邊緣自動偵測成功率、加速度計精度 | M2b |
| 畸變殘差、滾動快門讀出時間 | M2b（畸變弓高檢查）、M4（若做條紋自校） |
| fit3d 真實準確度 | M4（落球測試；發射監測器若有） |
| 姿勢模型誤差、拖影、擁有者揮桿範圍與球速 | M3、M4 |

# 驗證（端到端）

1. 每個里程碑：`scripts/verify.sh` 全 PASS（SKIP 要列出）＋該里程碑 `check_device_report.mjs` exit 0。
2. 交付前派 `verifier`（fresh context）重跑 verify.sh、核對 R6 該列逐條 PASS/FAIL。
3. 部署後：iPhone 加到主畫面→飛航模式→P3 架設計時→匯入一支 240fps→結果卡出現球速（或空值＋原因碼）→報告貼回核對。
4. 本計畫的數字修正以 `docs/CAFCR.md` 落地；之後實測值回寫 `docs/device-checklist.md`，計畫與文件衝突時以實測為準。
