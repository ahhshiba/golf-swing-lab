# 實機待驗證清單（UNVERIFIED → 實測）

> 來源：[CAFCR.md](CAFCR.md) 的「UNVERIFIED → 在哪裡轉實測」表，加上內文各處標 UNVERIFIED 的項目（A 的非功能限制、C1 誤差預算、C2 窄打位）。
> 計畫與這份文件衝突時，以實測為準（CAFCR 驗證段第 4 點）：量到之後把數字填進「實測值」欄，並在儲存格內寫上日期與機型（例：`2026-11-20 iPhone 12`）。
> 實機驗收走 P11→P12：診斷頁複製報告 JSON → `node scripts/check_device_report.mjs r.json --milestone Mx`。
> 「診斷報告欄位」只列 CAFCR 已經寫出名字的欄位；寫「欄位名待定」的項目，等 `diag/report.js` 定案後補上，不先猜名字。

| # | 項目 | 里程碑 | 怎麼量 | 診斷報告欄位 | 實測值 |
|---|---|---|---|---|---|
| U01 | getUserMedia 實際幀率（`frameRate:{ideal:60}` 拿到多少；決定即時模式以 30fps 設計、60 算加分） | M1 | iPhone 12 以主畫面 App 開一次 getUserMedia，讀取 track 實際設定值並記錄 | `frameRate`（R6 M1 的命名；完整路徑待定） | |
| U02 | MediaRecorder 實際幀率與可用格式 | M1 | 錄一段切片，列出支援的 mimeType；幀率用匯入探測算 effective_fps | `media_recorder.types`（非空）；幀率欄位名待定 | |
| U03 | DeviceMotion 權限在主畫面 App 是否保留（關掉再開是否還要問） | M1 | 同一點擊內第一個呼叫 `requestPermission()`；重開 App 再試，照實記錄 | 欄位名待定（R6 M1 只要求照實記錄） | |
| U04 | DeviceMotion 權限能否與 getUserMedia 共用同一次點擊（WebKit bug 269706 不是這個結論） | M1 | P2：同一點擊內 `requestPermission()`（第一個、await 之前）→ getUserMedia → AudioContext.resume → Wake Lock；看四項權限狀態 | `gum_calls`（須為 1）；四項權限狀態（欄位名待定） | |
| U05 | 12／14 非 Pro 的 1080p240 視角（Pro Max 為 68.161°） | M2b | 墊子校正解出 f 後反推水平視角，與 68.161° 比對 | `calibration.f_px`、`calibration.f_locked` | |
| U06 | 內建相機防手震裁切是否縮小視角 | M2b | 同上，以解出的 f 判斷；與 U05 同一場地、同一格式比較 | `calibration.f_px` | |
| U07 | 240fps 匯入是否保留（「照片」與「檔案」兩路各測） | M2 | 匯入同一支 240fps 慢動作檔，比對探測結果與解碼幀數 | `effective_fps`（須 ≥200）、解碼幀數須等於 `sample_count`（欄位名待定） | |
| U08 | HEVC 能否解碼（決定 720p240 H.264 或 1080p240 HEVC） | M2 | WebCodecs 查 HEVC 支援並實際解一支 1080p240 HEVC | `webcodecs.avc1`（已知）；HEVC 欄位名待定 | |
| U09 | worker 內 WebCodecs 能否運作（不行就退回主執行緒解碼） | M2 | 在 vision worker 內建立 VideoDecoder 解一支檔 | 欄位名待定 | |
| U10 | MediaPipe GPU delegate 在 iPhone 12 的可用性與效能（full 能否當預設） | M2 | worker 內先 GPU、失敗退 CPU；量 full 模型每幀耗時 | `pose.full.ms_p50`（須 ≤60 才預設 full）；GPU／CPU 欄位名待定 | |
| U11 | 0.5x 超廣角能否錄 240fps、畸變多大（只在窄打位 B <2.45m 才需要） | M2 | 切到 0.5x 鏡頭試錄 240fps；拍墊子看邊線弓高 | 欄位名待定 | |
| U12 | 墊子尺寸 `mat_L`、`mat_W` | P1（第一次到場地） | 捲尺量兩次，量差 ≤3mm（假設值 1.50m×1.25m） | `venue.mat_L`、`venue.mat_W` | |
| U13 | 球到面前隔板的距離 B（決定正面 D 與窄打位判定） | P1 | 捲尺從球位量到面前隔板；D＝B−0.25 | `venue.bay_B_m` | |
| U14 | 走道深度（後方 Db 3.0–3.5m、高斜角 2.75–3.0m 要放得下） | P1 | 捲尺量墊子後短邊到身後走道盡頭（假設 ≥3m） | 無 venue 欄位（CAFCR 未定義），直接填在實測值 | |
| U15 | 打位坡度 | P1 | 手機平放墊上 3 秒，穩定 ±0.1° | `venue.slope`（`calibration.slope_deg`） | |
| U16 | 球座高度（球底離墊；練習場固定橡膠球座） | P1 | 球放在球座上，捲尺量球底到墊面，量到 ±5mm；沒量過 App 用 30±15mm 先驗 | `venue.tee_lift_m`；shot 的 `club.tee_lift_m`、`club.tee_lift_source` | |
| U17 | 墊子邊緣自動偵測成功率 | M2b | 多場地、多光線下跑自動偵測，統計成功與需手點的比例 | 欄位名待定 | |
| U18 | 加速度計（水平儀）精度；CAFCR 假設滾轉 ±0.3–0.5° | M2b | 與墊子解出的滾轉比對（同一次架設） | `calibration.pose.roll_deg`、`calibration.slope_deg`；水平儀欄位名待定 | |
| U19 | 鏡頭畸變殘差；CAFCR 假設 0.5–1%（球速影響 ±0.3–0.5%） | M2b | 畸變弓高檢查：近端長邊弓高 >2px 即啟用 k1 | `calibration.reproj_rmse_px`；弓高欄位名待定 | |
| U20 | 滾動快門讀出時間；CAFCR 假設 2–4ms，目前用 3ms 中值 | M4（若做燈光閃爍條紋自校） | 閃爍光源下錄影，由條紋間距算讀出時間 | `calibration.readout_ms`、`calibration.readout_source`（`assumed`→`measured`） | |
| U21 | 架設重現性（KD1）：同位置拆裝 5 次，三個角度各測 | M2b | 偏航 SD ≤0.5°、滾轉 SD ≤0.3°、D SD ≤20mm、h SD ≤15mm、球徑 CV ≤2%、墊角 SD ≤4px | `calibration.pose`、`calibration.pose_sigma`；架設計時欄位名待定 | |
| U22 | fit3d 真實準確度（合成資料以外） | M4 | 落球測試：重力 9.81±3%；若有發射監測器場次，球速中位誤差 ≤3%，否則明寫「實機未校正」 | 球速、發射角的 metric 值與 `ci95`；落球測試欄位名待定 | |
| U23 | 姿勢模型誤差（角度 ±3–6°、位移 ±2–5% 是假設） | M3、M4 | 擁有者 20 桿標註，比對事件與關鍵點；Impact ±1 幀（60Hz）≥90% | `quality.pose_mean_vis` | |
| U24 | 拖影（球與桿頭）實際長度 | M3、M4 | 高速模式下取球的拖影幀，看長寬比（門檻 ≤4） | 欄位名待定 | |
| U25 | 擁有者的揮桿範圍與球速（決定各球桿球速上限與 spin 先驗，待決定 6） | M3、M4 | 鐵桿與 driver 各 10 球正面 240fps，各 ≥7 球球速非 null | 球速 metric；`touches_per_shot`（M4b 須 ≤2） | |

## 機器上已驗、仍須實機的項目（2026-11-04，e2e gate real-pose／m5／WebKit）

| # | 項目 | 機器上的結果（不是實機） | 實機要做什麼 |
|---|---|---|---|
| U26 | 真實 MediaPipe full＋事件 TCN 在 Safari 上的速度與結果 | Chromium（Playwright，GPU delegate）6 支 GolfDB 720×720 30fps：Impact 6/6 誤差 0 幀、Top 6/6（±1 內），每支 80–130 秒；tempo 6/6 有值與 ci95 | iPhone 12 主畫面 App 匯入自己 30／240fps 揮桿，記錄每支秒數（KD4 ≤45s）與 `import.last.events_source` |
| U27 | H.264 解碼走 WebCodecs（Safari） | Playwright Chromium 沒有 H.264 解碼器（`isConfigSupported(avc1)` false）；Playwright WebKit 因缺 `libwoff1`、`libevent-2.1-7t64`、`libavif16`（需 sudo）無法啟動，m1／screens／m2／real-pose 的 @webkit 版本為 SKIP | 實機匯入 H.264 MP4，看 m2 條件（解碼數＝sample_count） |
| U28 | MediaPipe 遙測被擋後在 Safari 無副作用 | tasks-vision 1.2.2 每 60 秒 POST `odml.pa.googleapis.com/v1/log`；`blockForeignFetch` 擋下後 Chromium 正常 | 實機飛航模式與連網各匯入一次，診斷報告 `pose.blocked_requests` 有數字、分析正常 |
| U29 | 即時模式音訊與影像時間對齊（M5 依擊球時間比對） | 假相機＋假麥克風：比對誤差與音訊-影像偏移見 m5 輸出 | 實機 10 真揮＋5 空揮＋10 隔壁聲，`live.shot_log` 對照錄影時間 |
