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

## 平台穩定性與效能（WP-D，2026-11-05；機器上的 gate：`tests/e2e/gates/d-platform.mjs`）

機器上（Chromium，這台主機）已驗的結果寫在第三欄；第四欄是只有 iPhone 才能確認的事。實測後把結果寫進最後一欄。

| # | 項目 | 機器上的結果（不是實機） | 實機要做什麼 | 實機結果 |
|---|---|---|---|---|
| D1 | 相機中斷後恢復（來電、鎖定螢幕、切到其他 App） | 單元測試：track ended → `session.status.camera_lost`；`reopenCamera()` 後 `onStreamChange` 收到新 stream，track 訂閱只有一個 | 即時模式中各做一次：來電、鎖屏 30 秒、切到相機 App 再回來；按「重新開啟相機」後 20 秒內繼續偵測到揮桿（診斷 `live.detections` 增加、`interruptions.count`） | |
| D2 | 100 球練習不被系統砍掉（記憶體） | d-recorder：閒置 120 秒，每段 ≤ 8.1 秒（上限 12 秒），保留的錄影段 0，JS heap 增加 < 0.1 MB；即時畫面 1280×720 | 實機打 100 球（或閒置 + 揮桿 30 分鐘），App 沒有被重新載入；診斷 `recorder.segments.max_s` ≤ 12、`live.retained_blobs` ≤ 2 | |
| D3 | 手機空間滿 | d-quota（4 MB 配額）：存 1 球、0 支影片，球帶 `CLIP_NOT_SAVED`；單元測試：寫入時 QuotaExceededError 會改存不含影片 | 把手機空間塞到剩 < 500 MB，打 3 球：數字照常保存、影片沒存、出現「空間不足」提示；清出空間後新的球又會存影片 | |
| D4 | `navigator.storage.persist()` 在主畫面 App 的結果 | Chromium 桌面回傳 false（非主畫面） | 加入主畫面後開啟一次，診斷「防止系統清除資料」是「是」；Safari 分頁裡應是「否」並看得到提醒 | |
| D5 | 720p 即時擷取不影響 240 fps 高速匯入 | 即時模式要求 1280×720（PF-5）；高速模式只走匯入，不經相機 | 錄 240 fps 慢動作後匯入，`import.last.effective_fps` ≥ 200，球數據有值 | |
| D6 | 發熱降級 | 單元測試：p95 延遲 > 12 秒先降級（lite、抽幀加倍），再建議改高速模式 | 夏天戶外 30 分鐘即時模式，記錄 `thermal.degraded` 何時出現、球到數字的秒數（`live.latency_p95_s`） | |
| D7 | 即時模式一球到結果的時間 | d-latency（CPU×4，假相機）：中位 4.3 秒；本機 GPU 是軟體模擬，姿勢改用 CPU delegate（`pose.gpu_software`），每幀 20 ms（GPU 模擬 370 ms） | iPhone 13 即時模式 10 球，`live.jobs` 的 `latency_s` 中位 ≤ 6 秒；`pose.delegate` 應為 GPU、`pose.gpu_software` 不存在 | |
| D8 | 離線可用 | d-offline：170 個檔案 20.7 MB，首次開啟約 4 秒完成並發出進度；重新載入後仍顯示已完成 | 主畫面 App 第一次開啟時看到下載進度直到「可離線使用」，再開飛航模式重開 App，可以練習與匯入 | |
| D9 | IndexedDB 卡住 | d-idb-hang：`indexedDB.open` 永不回應時 5.7 秒內進入 App，顯示「結果不會被儲存」 | （難以人為重現）若曾看到「載入中…」不動，回報診斷檔案 | |
| D10 | 分析引擎當掉 | d-worker-crash：當掉後 1.4 秒顯示「分析引擎停止回應，已重新啟動」，重建後同一支影片可再分析；單幀姿勢 5 秒逾時 | 連續匯入 10 支長影片（各 > 10 秒）不需要重開 App；若出現錯誤，診斷「最近的錯誤」有時間與錯誤 | |

## 發射監測器級功能（LAUNCH-MONITOR-SPEC §5.3-5，2026-11-06 整合）

機器上的 gate：`lm-a-shell`、`lm-d-*`、`lm-e-drill`、`lm-f-*`、`a-matrix`（528 個畫面狀態 0 findings）。這些只證明畫面與流程在 Chromium 上成立，**下面每一項都要 iPhone 實機確認**。

**先讀這兩點再看數字**：
- **高斜角後方（high_behind）的桿速、球速、carry、左右偏移都是低信心推估，誤差很寬**：桿速 1σ 約 15–20%、球速 16–19%、carry 20–26%、driver 落點左右 1σ 21–37 m（RN §5、§7；合成資料量的，UNVERIFIED）。結果頁會標「估」與虛線，但大字仍然很有說服力，看的時候以範圍為準。
- **所有推估值（旋轉量、旋轉軸、桿面角、動態仰角、carry／total、apex、落地角、滯空、左右偏移…）都還沒有跟任何真的發射監測器比對過**（同一球的對照數據 0 筆，RN §8-10）。唯一的升級途徑見規格 §9：在有監測器的場地同時錄 240 fps，把數字抄進 `tests/fixtures/owner/lm-reference.json`。

| # | 項目 | 機器上的結果（不是實機） | 實機要做什麼 | 實機結果 |
|---|---|---|---|---|
| LM1 | 深色儀表在戶外陽光下可讀 | 三主題對比測試 ≥ 3.0（`tokens.contrast`）；矩陣 3 主題 × 2 字級 0 findings | 白天戶外打開一球的結果頁（深色）與統計頁，看大數字、「估」標記、彈道圖線條是否看得清；看不清就到 設定 › 外觀 切「陽光」，再看一次並記錄哪個主題可用 | |
| LM2 | tracer 疊在 240 fps 實拍片段上的位置 | 夾具：`flight.samples[0]` 投影到擊球幀球心誤差 0.003 px（`viz.project`）；合成影片才有偵測點 | 匯入自己的 240 fps 正面與高斜角後方各 3 支，結果頁「影片」分頁：實線（偵測）是否貼著球、點線（模擬）是否從球的位置接出去、方向大致對；偏差多少像素或明顯錯邊就截圖 | |
| LM3 | 20 球批次匯入對應到測驗格 | `lm-e-drill`：2 個夾具片段依拍攝時間對應到第 1、2 題，重新載入後進度仍在 | 開「距離控制 18 題」，一次打完 20 球再從相簿批次匯入：每題的球是否對到正確順序（看拍攝時間）、多出的 2 球沒有被塞進題目且有說明 | |
| LM4 | 3D 彈道的拖曳與按鈕戴手套可用 | 按鈕 ≥ 44 px（e2e 共用檢查 `minTargets 44`）；拖曳與方向鍵在 Chromium 可轉 | 戴高爾夫手套：在 3D 分頁單指拖曳旋轉、按「向左轉／向右轉 15 度」與「俯視／斜視」各 5 次，記錄誤觸或沒反應的次數 | |
| LM5 | high_behind 數字的實際偏差（低信心、誤差寬） | 只有合成資料：涵蓋率 93–97%（自洽檢查，不是準確度） | 若有機會在監測器旁打：高斜角後方 10 球同時記錄監測器的桿速、球速、carry、左右，填進 `lm-reference.json`；沒有就保持「低」，不得升級 | |
| LM6 | 推估值與真監測器比對（目前 0 筆） | 無（RN §8-10） | 同上，正面 10 球：球速、發射角、旋轉量、carry、apex；比對結果決定哪些格子能從「低」升「估」 | |

## 0.4.0：秒出數據、模擬球場、軌跡影片、揮桿實驗室（V04-SPEC §A.5、§G.4-6，2026-11-07 整合）

機器上的 gate：`v4-a-shell`、`v4-b-latency`、`v4-b-off`、`v4-d-*`、`v4-e-*`、`v4-f-*`、`a-matrix`（1,080 個畫面狀態 0 findings）。
這些都是 Chromium 假相機／假麥克風／姿勢替身，**下列每一項只能在 iPhone 實機確認**。照實記錄，達不到目標**不改目標**，開問題單。

| # | 項目 | 機器上的結果（不是實機） | 實機要做什麼 | 診斷報告欄位 | 實機結果 |
|---|---|---|---|---|---|
| V1 | 速報延遲（§A.5） | `v4-b-latency`（CPU ×4、姿勢替身、不含相機擷取延遲）：撞擊 → 速報卡中位 0.07 s、最大 0.10 s | iPhone 12 主畫面 App、face_on 打 20 球，結束後 設定 › 診斷 複製報告 | `live.quick.latency_ms_p50`（目標 ≤ 500）、`live.quick.latency_ms_p95`（目標 ≤ 1000） | |
| V2 | 速報 vs 精算的偏差率 | e2e：`live.quick.miss` 0/30（精算值落在速報 95% 區間外的次數） | 同 V1 的 20 球：記下 `miss / compared`；> 10% 就附報告開單（速報區間太窄） | `live.quick.compared`、`live.quick.miss` | |
| V3 | 精算節奏（tempo）不再偏低 | 0.3.0 的錯：錄影片段起點取「最後一張分析幀」，比真正開錄早約 1 幀，聲音撞擊點落到片段裡就晚約 35 ms → 下桿變長、tempo 偏低（夾具 2.34 vs 3.0）。0.4.0 改成「開錄後第一幀」（`capture/recorder.js startClock`）；`v4-b-latency` 用畫面編碼量：片段起點誤差中位 1.7 ms，精算 tempo 中位 2.71（剩下的偏差是 30 fps 下頂點早約 1 幀，夾具特性） | 用節拍器或手機計時拍自己 3 拍上桿、1 拍下桿（tempo 約 3.0）的揮桿 10 球，看精算的 tempo 是否在 2.6–3.4；再用 240 fps 匯入同一種揮桿對照 | `live.quick_log`（速報）與結果頁 tempo | |
| V4 | Safari `MediaRecorder` + `canvas.captureStream` 出影片（§D.1、§H） | `v4-e-video`（Chromium）：webm，大小、時長與時間軸差 ≤ 10%；WebKit 代理無法跑 | 一球結果頁 › 軌跡影片 › 製作：記錄得到的格式（mp4／webm）、檔案大小、時長；用「分享」存到「照片」後能否播放、能否再分享到 LINE／IG；隱藏畫布、逐幀節奏有無卡頓或掉幀（影片看起來快轉或停格就記下） | 檔名副檔名；分享面板顯示的狀態文字 | |
| V5 | 軌跡影片的記憶體（約 120 幀解碼） | Chromium 無崩潰 | 240 fps 片段做 3 次影片（直式、橫式、含對齊線）；記錄有無被系統關掉重載、做完後 App 是否變慢 | `diag` events[] 有無錯誤 | |
| V6 | 模擬球場飛越動畫 fps（§G.3 V4-D 3） | `v4-d-perf`（CPU ×4）：每幀繪製中位 ≤ 12 ms、P95 ≤ 25 ms | 開新回合（18 洞、links），看第 1、5、10 洞的飛越是否順；有卡頓就記洞號 | `round:perf` 是 gate 專用；實機用目視＋錄螢幕 | |
| V7 | 陽光下地圖可讀（sun 主題） | 三主題矩陣 0 findings、球標記每人顏色＋形狀不同（圓、方、三角、菱形） | 白天戶外 2 人回合：分得出誰的球（不靠顏色也行）、95% 橢圓、瞄準線 | — | |
| V8 | 戴手套操作瞄準按鈕 | 按鈕 ≥ 44 px（`minTargets 44`） | 戴手套左右轉瞄準、手動輸入、推桿數各 5 次，記錄誤觸 | — | |
| V9 | 9 洞 2 人實打的節奏 | 無 | 目標 ≤ 45 分鐘；記錄實際時間與最卡的步驟 | — | |
| V10 | 記憶體與穩定度（回合＋實驗室） | 單元與 e2e 無洩漏斷言 | 9 洞回合中途切到揮桿實驗室再回來 3 次、重開 App 一次：回合是否在同洞同桿 | — | |
