# 發射監測器級推估的物理研究筆記（launch-monitor physics）

> 2026-11-06。這份是 `docs/LAUNCH-MONITOR-SPEC.md` §1、§2 的依據：來源、公式、係數、誤差傳遞（MC）結果。
> 重算腳本放在這次 session 的 scratchpad：`lm/mc_lm.py`（D-plane／spin 的 MC）、`lm/flight.py`（`aero.js` 的 RK4 複刻，
> 算 carry／apex／landing／hang 和 curve 的敏感度）、`lm/contrast.py`（調色盤對比）。實作包 LM-B 要把這些
> 搬成 `tests/unit/lm.*.test.mjs`（JS），scratchpad 裡的 Python 只當對照。
> 標 **UNVERIFIED** 的數字還沒跟發射監測器實測比對過，規格裡一律寫成可調參數（`app/src/physics/lm/params.js`）。

## 0. 名詞（產品內只用通用高爾夫術語）

| 本 app 的 id | 中文 | 英文（通用術語） | 定義 |
|---|---|---|---|
| `club_speed_mps` | 桿頭速度 | Club speed | 擊球前一刻桿頭中心的速度 |
| `attack_angle_deg` | 攻擊角 | Attack angle | 桿頭速度向量相對水平的仰角（向下為負） |
| `club_path_deg` | 桿頭路徑 | Club path | 桿頭速度向量在水平面的方向，相對目標線（+ = 內往外） |
| `dynamic_loft_deg` | 動態桿面仰角 | Dynamic loft | 擊球瞬間桿面法線相對水平的仰角 |
| `face_angle_deg` | 桿面角 | Face angle | 擊球瞬間桿面法線在水平面的方向，相對目標線（+ = 開） |
| `face_to_path_deg` | 桿面對路徑 | Face to path | face − path |
| `spin_loft_deg` | 旋轉仰角 | Spin loft | 桿頭速度向量與桿面法線的 3D 夾角（小角度時 ≈ dynamic loft − attack angle） |
| `spin_rate_rpm` | 旋轉量 | Spin rate | 起飛時的總轉速 |
| `spin_axis_deg` | 旋轉軸 | Spin axis | 轉軸相對水平的傾斜（+ = 右傾，右打者向右彎） |
| `carry_m`／`total_m` | 飛行距離／總距離 | Carry／Total | 落地點／停止點沿目標線的距離 |
| `carry_side_m`／`total_side_m` | 落點偏移／總偏移 | Side／Side total | 落地點／停止點的橫向偏移（+ = 右） |
| `curve_m` | 彎曲量 | Curve | 落點相對「起飛方向直線」的橫向偏移 |
| `apex_m` | 最高點 | Height／Apex | 飛行最高點離地高度 |
| `landing_angle_deg` | 落地角 | Landing angle | 落地瞬間速度向量相對水平的俯角 |
| `hang_time_s` | 滯空時間 | Hang time | 起飛到落地的時間 |

符號沿用現有程式（`physics/clubpath.js`、`launch_h.js`）：標準右打座標系，+ = 遠離球員（右打者的右邊）；左打鏡像。

## 1. D-plane：起飛方向由桿面與路徑共同決定

**模型（小角度線性化）**

- 水平：`launch_h ≈ h·face + (1 − h)·path`  → 反推 `face = (launch_h − (1 − h)·path) / h`，`face_to_path = (launch_h − path) / h`。
- 垂直：`launch_v ≈ v·dynamic_loft + (1 − v)·attack`  → 反推 `dynamic_loft = (launch_v − (1 − v)·attack) / v`。
- `h`、`v` 隨 spin loft 下降（斜擊越大，球越不跟桿面走）。

**係數與來源**

| 來源 | driver | 7 鐵 | 挖起桿 | 可信度 |
|---|---|---|---|---|
| Wood, Henrikson, Broadie（PING），ISEA 2018，*Proceedings* 2, 249，表 1（95% CI，157 名球員＋機器人）：水平 `h` | 0.76 ± 0.08 | 0.69 ± 0.03（機器人 0.63 ± 0.04） | 0.61 ± 0.07 | 同儕審查；https://mdpi-res.com/proceedings/proceedings-02-00249/article_deploy/proceedings-02-00249.pdf （doi:10.3390/proceedings2060249） |
| 同上，垂直 `v` | 0.83 ± 0.08 | 0.81 ± 0.05 | 0.72 ± 0.06 | 同上 |
| 業界經驗法則（Titleist Learning Lab 引用發射監測器資料）：水平 driver 0.85、鐵桿 0.75 | 0.85 | 0.75 | — | 廠商教學文；https://www.titleist.com/learning-lab/performance/golf-club-face-angle （本次抓取 403，內容由搜尋摘要轉述） |
| 論壇轉述某發射監測器學院：driver 0.87、6 鐵／PW 0.81 | 0.87 | 0.81 | 0.81 | 二手；https://golfsimulatorforum.com/forum/foresight-sports/345478-experiment-rough-calculation-of-clubface-using-launch-direction-and-club-path |
| 垂直經驗法則：driver 0.85、鐵桿 0.75 | 0.85 | 0.75 | — | 論壇；https://thesandtrap.com/forums/topic/64174-how-launch-angle-aoa-spin-rate-and-smash-factor-work-to-maximize-distance |

**採用**：預設用 Wood 2018 的平均值，依 spin loft 線性內插（spin loft 13° → driver 欄、30° → 7 鐵欄、50° → 挖起桿欄，兩端外推用端點值）：
`h(SL) = interp(SL; [13, 30, 50] → [0.76, 0.69, 0.61])`、`v(SL) = interp(SL; [13, 30, 50] → [0.83, 0.81, 0.72])`。
其他來源的 0.75–0.87 放進可調範圍。Wood 2018 的圖 3c/3d 顯示**單球**比值散佈遠大於平均值的 CI，部分原因是 face−path 小的時候分母接近零。
單球比值 1σ 先取 `σ_h = 0.10`、`σ_v = 0.05`（**UNVERIFIED**，從圖 3c/3d 目測）。
實作（`app/src/physics/lm/dplane.js`）：`h`、`v` 取在 3D spin loft 上；垂直反推時 SL 依賴 DL，用定點疊代解（收斂到 1e-13°）；face_on 看不到左右，反推時 face = path = 0（小角度下對 SL 影響 < 0.3°）。比值夾在 [0.3, 1]。

## 2. Spin loft → 旋轉量

**形式**：斜向碰撞＋球在分離前滾動（實心球 I = 2/5·m·r²、桿頭遠重於球）時，切向衝量給的轉速是
`ω ≈ (5/7)·v_t / r`，`v_t ∝ v_club·sin(SL)`（Penner, *Am. J. Phys.* 69, 563–567, 2001；Penner, *Rep. Prog. Phys.* 66, 131–171, 2003。
本次只查到二手摘要，公式由推導重建，**原文待核對**：https://www.scribd.com/document/621738341/golf-loft）。
真實桿面有摩擦上限、溝紋、齒輪效應，所以寫成每類球桿一個有效係數 `A`：

`spin_rpm = A_club · v_club · sin(SL) / r · 60 / (2π)`

**`A` 的擬合**：用職業巡迴賽平均表（下表），對每支球桿先用 §1 的 `v(SL)` 反推 dynamic loft 與 spin loft，再解 `A`：

| 球桿 | 桿速 mph | 攻擊角 | 球速 mph | smash | 發射角 | spin rpm | 最高點 yd | 落地角 | carry yd | 反推 DL | 反推 SL | A |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Driver | 113 | −1.3 | 167 | 1.48 | 10.9 | 2686 | 32 | 38 | 275 | 13.4 | 14.7 | 0.467 |
| 3 木 | 107 | −2.9 | 158 | 1.48 | 9.2 | 3655 | 30 | 43 | 243 | 11.7 | 14.6 | 0.677 |
| 混血 | 100 | −3.5 | 146 | 1.46 | 10.2 | 4437 | 29 | 47 | 225 | 13.1 | 16.6 | 0.777 |
| 5 鐵 | 94 | −3.7 | 132 | 1.41 | 12.1 | 5361 | 31 | 49 | 194 | 15.5 | 19.2 | 0.867 |
| 7 鐵 | 90 | −4.3 | 120 | 1.33 | 16.3 | 7097 | 32 | 50 | 172 | 21.0 | 25.3 | 0.924 |
| 9 鐵 | 85 | −4.7 | 109 | 1.28 | 20.4 | 8647 | 30 | 51 | 148 | 26.5 | 31.2 | 0.982 |
| PW | 83 | −5.0 | 102 | 1.23 | 24.2 | 9304 | 29 | 52 | 136 | 32.6 | 37.6 | 0.917 |

表的來源：發射監測器廠商公布的 PGA 巡迴賽平均表（https://support.trackmangolf.com/hc/en-us/article_attachments/7349802113051 ；
檔案超過抓取上限，本次只透過搜尋摘要核對到 **Driver、6 鐵（92/−4.1/127/1.38/14.1/6231/30/50/183）、PW 三列**，
其他列是轉抄，**UNVERIFIED**；`app/src/physics/aero.js` 的係數也是擬合這張表，同樣標 UNVERIFIED）。
2023 版另有更新（https://www.trackman.com/blog/golf/introducing-updated-tour-averages ，表格是圖片，沒能抽出）。
這是**職業選手**的平均，業餘的 `A` 可能不同（擊球點分散、桿面較髒）：`A` 的模型誤差 1σ 先取 **15%（UNVERIFIED）**。

經驗法則對照（只當交叉檢查，不採用）：論壇轉述「spin ≈ (2.3–3.0)·桿速 mph·spin loft」（https://thesandtrap.com/forums/topic/70119-backspin/?page=2 ，二手）。
用 driver 列驗算得 1.7，與它不符；所以不採用這條法則。

**spin loft 超過約 45–50° 後旋轉量不再上升**（球沿桿面滑動；教學資料轉述監測器資料，https://golfwrx.com/324662/the-science-of-adding-spin-to-your-wedge-shots/ ，**UNVERIFIED**）
→ `SL_MAX_DEG = 48` 可調，超過時夾住並加 `SPIN_MODELLED` 的 σ 50%。

**與球桿先驗合併**：現有 `ballistics.js` 的 `SPIN_PRIORS`（driver 2700 ± 600 … ）是第二個獨立估計；兩者以反變異數加權：
`ω̂ = (ω_phys/σ_p² + ω_prior/σ_q²) / (1/σ_p² + 1/σ_q²)`。

**實作時的修正（2026-11-06，LM-B）**：
- `A` 用 app 自己的反推（`physics/lm/dplane.js` 的定點疊代、`BALL_R = 0.021335 m`）重新擬合到 6 位小數：driver 0.467059、
  3 木 0.676734、混血 0.776631、5 鐵 0.866489、7 鐵 0.923607、9 鐵 0.981602、PW 0.917166（上表 3 位小數是同一組數字四捨五入）；
  7 列前向都回到表上的 spin（誤差 < 0.001%，`tests/unit/lm.physics.table.test.mjs` 鎖住）。
- **先驗的 σ 下限 30%**（`LM_PARAMS.spin.prior_sigma_floor_frac`）：照上式直接合併時，合成資料的 ci95 涵蓋率只有 72–90%（依球桿），
  z 分數 SD 1.24–1.47。原因是 `SPIN_PRIORS` 的 σ（15–20%）比這個模型自己隱含的族群散佈窄：A 的 15% 加上 spin loft ±3°
  （中鐵 sin 變化 ±11%）、桿速差異，族群散佈約 20–25%；業餘桿速低於巡迴賽時，先驗平均還會把 spin 往上拉。
  先驗 σ 取 max(原值, 30% × 平均) 之後涵蓋率 88–95%（整體 92.5%，見 §9）。代價：合併後的 spin 1σ 約 **16–19%**，
  比 §5 原先估的 12–17% 寬。純物理估計本身的 ci95 涵蓋率是 95%（校準正確）。

## 3. Spin axis（旋轉軸）

**向量定義（實作照這個，不用小角度近似）**：
`ĉ = (cosA·cosP, cosA·sinP, sinA)`（A = attack，P = path），`n̂ = (cosL·cosF, cosL·sinF, sinL)`（L = dynamic loft，F = face）。
D-plane 由 ĉ、n̂ 張成，轉軸 ŵ ∥ ĉ × n̂；`spin_axis = atan2(ŵ_z, ‖(ŵ_x, ŵ_y)‖)`，符號依 §0。
（上式的 y 軸朝右。實作 `physics/lm/dplane.js` 用 app 的右手座標系——x 目標、y 朝右打者（目標線左側）、z 上，角度 + = 往 −y——
寫成 ĉ = (cosA·cosP, −cosA·sinP, sinA)、n̂ = (cosL·cosF, −cosL·sinF, sinL)，所以是 `atan2(−ŵ_z, ‖ŵ_xy‖)`；開桿面 → + axis → 往右彎，兩者一致。）
小角度近似 `tan(axis) ≈ tan(face_to_path) / tan(SL)` 只用在單元測試當交叉檢查；這裡的 SL 是垂直的 DL − A（3D 夾角另含 F − P，
F2P 6°、SL 10° 時兩種 SL 代進去差 3.9°）。|F2P| ≤ 6°、SL 10–40°、攻擊角 ±3° 時向量形式與近似差 < 0.5°；攻擊角到 ±5°、SL 40° 時可到 0.6–0.8°。
來源：D-plane 的幾何（Jorgensen, *The Physics of Golf*, 1999）；部落格的兩個數值例（VDiff 5.5° → 32.7°、31.5° → 6.6°，兩者都對到水平差約 3.6°），
與 atan 形式一致：https://strongergolf.blogspot.com/2011/11/spin-loft-part-ii-spin-rate-and-spin.html 。
也注意：部分市售監測器的 spin axis 是看前 50 碼飛行的彎曲反推的，不是從桿頭算（https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/275665/face-to-path-and-spin-axis/1343312 ），
所以拿不同機器的 axis 來比對時要先確認它的定義。

## 4. 飛行（carry、apex、落地角、滯空、curve、side）

沿用 `aero.js`＋`ballistics.js` 的 RK4（Smits & Smith 1994 的形式，係數擬合巡迴賽表，**UNVERIFIED**）。轉軸改成可傾斜：
初始 ŵ 是 backspin 軸繞 v̂₀ 轉 `spin_axis`。用 `lm/flight.py` 複刻驗算（同一組常數）；app 的 `physics/lm/flight.js`（dt 4 ms、落地點在最後一步內線性內插）
得 240.36／156.87／119.74 m、31.73／27.75／28.76 m、39.89／45.21／50.95°、6.815／6.169／5.895 s，與下表差 < 0.1（`lm.physics.table` 測試鎖住 ±0.5 m）：

| | carry m（表） | apex m（表） | 落地角（表） | 滯空 s |
|---|---|---|---|---|
| Driver | 240.4（251.5） | 31.7（29.3） | 39.9（38） | 6.82 |
| 7 鐵 | 156.9（157.3） | 27.7（29.3） | 45.2（50） | 6.17 |
| PW | 119.8（124.4） | 28.8（26.5） | 51.0（52） | 5.90 |

→ 模型系統誤差：carry −4.4%…0%、apex ±10%、**7 鐵落地角少 5°**。規格把 `APEX_MODEL_SIGMA_FRAC = 0.10`、
`LANDING_MODEL_SIGMA_DEG = 3` 放進 MC 的系統項（K6：同一個 draw 內一致套用），並在 LM-B 的驗收裡留一條回歸檢查，確保將來重擬合時有人看得到。

**MC（球速 σ 2%、發射角 σ 0.3°、spin σ 15% / 25%）**：

| | carry 1σ | apex 1σ | 落地角 1σ | 滯空 1σ |
|---|---|---|---|---|
| Driver | 2.4% / 2.7% | 2.7 / 3.8 m | 2.0 / 3.1° | 0.28 / 0.43 s |
| 7 鐵 | 3.5% / 4.6% | 1.6 / 2.2 m | 1.9 / 3.2° | 0.16 / 0.24 s |
| PW | 4.5% / 6.8% | 1.3 / 1.4 m | 1.6 / 2.5° | 0.13 / 0.14 s |

（再加上現有 `CARRY_MODEL_SIGMA_FRAC = 0.03` 的模型項。）

**curve 敏感度**（小角度、同一模型）：每 1° spin axis 造成的落點橫移：driver 1.94 m、7 鐵 1.44 m、PW 1.06 m；
起飛方向 σ 0.35° 只造成 0.8–1.5 m。→ **side／curve 的誤差幾乎全來自 spin axis，也就是 club path 的誤差**。

## 5. D-plane 反推的誤差（MC，`lm/mc_lm.py`，N = 200,000）

**正面 face_on 240 fps**（發射角 σ 0.3°、桿速 σ 3%、`σ_v` 0.05、`A` 15%；攻擊角 σ 2.5° / 1.5°）：

| | dynamic loft 1σ | spin loft 1σ | spin（純物理）1σ |
|---|---|---|---|
| Driver | 1.13 / 1.03° | 3.19 / 2.06° | 26% / 21% |
| 混血 | 1.22 / 1.14° | 3.23 / 2.13° | 25% / 20% |
| 7 鐵 | 1.72 / 1.65° | 3.47 / 2.46° | 20% / 18% |
| PW | 2.60 / 2.54° | 4.08 / 3.17° | 18% / 17% |

純物理 spin 只比球桿先驗（15–22%）好一點點；兩者合併後約 **12–17%**（**實作後更正為 16–19%**：先驗 σ 下限 30%，見 §2「實作時的修正」與 §9；規格 §1.2 #12 已改）。**誠實結論：單機位推不出比先驗好很多的 spin**，
最大的貢獻是「讓同一支球桿的 spin 隨每球的 spin loft 變動」（例如挖起桿打薄、driver 下壓），而不是讓平均值更準。

**高斜角後方 high_behind 240 fps**（起飛方向 σ 0.35°、`σ_h` 0.10、spin loft 用球桿先驗 σ 3°；face−path 真值 3°）：

| path σ | 桿面角 1σ | 桿面對路徑 1σ | spin axis 1σ（driver / 7 鐵 / PW） |
|---|---|---|---|
| 2° | 1.0–1.4° | 2.8–3.2° | 10.8 / 6.4 / 4.3° |
| 3° | 1.4–2.0° | 4.2–4.8° | 15.2 / 9.3 / 6.2° |
| 4° | 1.7–2.6° | 5.5–6.3° | 19.3 / 12.1 / 8.2° |

桿面角中位偏差 ≈ −0.1°（`h` 的非線性），可忽略。→ curve／side 1σ：driver 21–37 m、7 鐵 9–17 m、PW 4.5–9 m（axis σ × §4 的敏感度）。
**誠實結論：driver 的彎曲量與左右偏移在單機位下只能當「方向感」，數字範圍會很寬**；鐵桿與挖起桿還堪用。

## 6. 落地滾動（total = carry + roll）

文獻沒有可直接套的通用模型：彈跳＋滾動距離隨落地角變陡而減少（Sports Engineering 2023，https://link.springer.com/article/10.1007/s12283-023-00442-4 ）；
driver 典型落地 29.5 m/s、36°、1950 rpm（同文引用）；Penner 2001 的 run 模型擬合 Williams 的實驗資料（原文待核對）；
果嶺彈跳用分段仿射比物理模型更準（https://lida.sport-iat.de/twm/Record/4085528 ）。
→ 採用**純經驗表**，全部 **UNVERIFIED**，寫成可調參數：`roll = carry × f(落地角, 草況)`，

| 落地角 | 硬 firm | 一般 normal（預設） | 軟 soft |
|---|---|---|---|
| ≤ 30° | 0.14 | 0.10 | 0.06 |
| 40° | 0.09 | 0.06 | 0.03 |
| 50° | 0.04 | 0.025 | 0.01 |
| ≥ 55° | 0.02 | 0.01 | 0.00 |

中間線性內插；roll 的 1σ = 50% × roll（MC 內與 carry 同一 draw）；忽略落地 spin（後旋強的挖起桿可能倒退，模型不處理 → 加 `ROLL_MODELLED`）。
驗算：driver carry 240 m、落地 40° → roll 14 m（≈ 15 碼），量級與一般說法相符，但沒有實測來源。

## 7. high_behind 的桿速與球速（新推估）

- 桿速（原估）：`clubpath.js` 已把桿頭軌跡投到地面；同一批點的「路徑長／時間」就是水平速度，除以 cos(攻擊角先驗) 得桿速。
  誤差：沿目標線的地面解析度 ≈ 233 px/m（f ≈ 1423 px、相機到球 3.2 m、俯角 32°），每幀位移 16.7 cm ≈ 39 px，
  桿頭拖影質心 σ 1.5–4 px → 每幀 4–10%，兩個間隔平均 3–7%；桿頭高度 0–5 cm 的尺度項 ≈ 0.9%；
  合計 σ 5–8%。
- **桿速（實作後更正，2026-11-06，LM-B）**：上面漏了一項，而且是最大的一項。高斜角後方的相機幾乎沿著桿頭運動方向看，
  桿頭高度的變化會被投成沿目標線的距離（δx ≈ δz / tan(俯角)，俯角約 32–35° → 約 1.5 倍）。擊球前桿頭沿弧線下降
  （攻擊角加上垂直曲率 κ_z ≈ sin(揮桿平面)/半徑 ≈ 0.43–0.69 /m），只用固定高度平面投影時，前一幀的位移被壓短 25–40%。
  實作（`physics/lm/hbspeed.js`）改成把桿頭像素與曲面 z(s) = z0 + s·tan(攻擊角先驗) + ½·κ_z·s² 求交（s ≤ 0 為擊球前距離），
  只用最後 2 個擊球前樣本（3D 折線長／rolling-shutter 時間），MC 抽像素雜訊、z0 ~ U(0, 5 cm)、攻擊角 ~ 球桿先驗（±2.5°）、
  κ_z ~ N(0.57, 0.12)、系統項 5%。合成掃描（`simulateClubHead`，平面 50–65°、半徑 1.3–1.8 m、攻擊角 ~ 先驗、像素雜訊 1.5 px，
  `tests/unit/lm.physics.club.test.mjs`）：中位偏差 −2.5%、P10/P90 −20%/+19%，ci95 涵蓋率 96%，**σ ≈ 15–20%（中位 17%）**。
  拆解：攻擊角已知且無像素雜訊時 SD 4.7%（弧線與 z0），加像素雜訊 10%，再加攻擊角先驗 15%。**σ 5–8% 在單機位做不到**；
  驗收資料仍是合成的（UNVERIFIED）。
- 球速：`桿速 × smash 先驗`（巡迴賽 smash 依球桿 1.23–1.48；業餘 σ ≈ 0.05 → 3.5%）→ 原估 σ 6–9%，**依上面更正為 σ 16–19%**，標 `SMASH_ASSUMED`。
- carry：球速 σ 加上發射角先驗（球桿表 ± 3°）與 spin 先驗 → 原估 σ 8–13%，**更正為 σ 約 20–26%**（桿速 σ 17% 的合成批次，
  各球桿 carry 1σ 中位 20–26%；carry side 1σ driver 21 m、7 鐵 12 m、PW 7 m，與 §5 一致）。D3 照裁示顯示並標「低」＋誤差範圍。

## 8. 未查證／待實測清單（同步到規格 §9）

1. 巡迴賽平均表中 Driver／6 鐵／PW 以外的列（轉抄）。
2. `A_club`（spin 係數）對業餘的適用性；模型 σ 15%。
3. `σ_h = 0.10`、`σ_v = 0.05`（單球比值散佈）。
4. spin loft 的摩擦上限 48°。
5. 滾動表（全表）與 roll σ 50%。
6. face_on 攻擊角 σ 1.5–2.5°（取樣點少＋弧線曲率修正）；κ_v = 0.76 ± 0.18 /m 是合成揮桿擬合的（§9）。
7. high_behind 桿速 σ 15–20%、球速 σ 16–19%、carry σ 20–26%（§7 更正；原估 5–8%／6–9%／8–13% 漏了桿頭高度項）。
11. spin 先驗 σ 下限 30%（§2 實作修正）是用合成族群決定的，真實業餘族群的 spin 散佈待實測。
8. aero 模型的系統誤差（apex ±10%、落地角 −5°）。
9. Penner 碰撞公式與 run 模型的原文。
10. 整體：沒有任何數字跟發射監測器做過同球比對（CAFCR 待決定 5）。

## 9. 實作（LM-B，2026-11-06）與驗收結果

模組：`app/src/physics/lm/`（lazy）——`params.js`（全部可調參數＋`version`，`algorithms.lm.sha256` = 參數的 canonical JSON 的 SHA-256）、
`dplane.js`（§1、§3）、`spin.js`（§2）、`flight.js`（§4）、`roll.js`（§6）、`attack.js`（face_on 攻擊角）、`hbspeed.js`（§7）、
`profile.js`（球桿檔案；D2 裁示不借用，目前沒有呼叫端）、`index.js`（`deriveLaunchMonitor`、`rederive`）。
`pipeline/assemble.js` 在時間檢查之後呼叫 `deriveLaunchMonitor`；`metrics/registry.js` 的格子決定每個值能不能出、最好到什麼 validity。

- **face_on 攻擊角**：`physics/club.js` 的擊球前弦（球平面上最後 2 個桿頭樣本）的垂直分量，加弧線項 κ_v·s̄（s̄ = 弦中點到擊球的距離）。
  `simulateClubHead` 掃描（平面 48–66°、半徑 1.0–1.8 m、攻擊角 −5…+4°、路徑 ±4°、深度 0–5 cm）擬合 κ_v = 0.76 /m（P10–P90 0.55–1.0）；
  σ = 弦的像素雜訊 ⊕ 0.18·s̄ ⊕ 0.5°，中位 2.5°；獨立種子驗證：中位誤差 0.16°、|誤差|中位 1.6°、±1.96σ 涵蓋 95.8%。
- **MC（§1.5）**：每個 draw 抽一次所有輸入（各自 metric 的 σ）與系統項（h、v 比值偏移、A、先驗、carry ×N(1, 0.03) 套在整個落點向量、
  apex ×N(1, 0.10)、落地角 +N(0, 3°)、roll ×max(0, N(1, 0.5))），每個 draw 一次 RK4，n = 256。中心值 = 輸入值走同一條鏈；
  ci95 = 2.5–97.5 百分位（放寬到包含值）。spin 的每個 draw = w·物理 draw + (1 − w)·先驗平均 + 補足後驗 σ 的獨立項。
  輸入低於自己的格子（例如 SETUP_UNVERIFIED、TIMEBASE_SUSPECT）時，推出來的值降為 low_confidence 並帶上該原因碼。
- **涵蓋率**（`tests/unit/lm.physics.coverage.test.mjs`，合成 face_on 200＋high_behind 200，真值由 `tests/synth/ballflight.js lmShot`
  依 §5 的雜訊與上述模型項產生；face_on 真值帶 ±3° 路徑與 ±2° 桿面對路徑飛行，估計時看不到）：
  動態仰角 94.0%、旋轉仰角 93.0%、旋轉量 92.5%、carry 93.5%、total 95.0%、apex 95.5%、落地角 94.5%、滯空 91.5%；
  hb 桿面角 95.5%、桿面對路徑 95.0%、旋轉軸 95.5%、carry 93.0%、total 94.0%、落點偏移 95.5%（全部在 85–99% 內）。
  這是**自洽檢查**：真值與估計用同一組模型與分佈，它證明誤差傳遞沒算錯，不證明模型對真實球（§8-10）。
  **整合重跑（2026-11-06，LM-A 整合）**：合成的 hb 桿速雜訊 `LM_NOISE.hb_club_speed_frac` 由 0.10 改成 0.17，對齊 §7 量到的
  正式桿速 σ（中位 17%）。重跑結果：face_on 8 項不變；hb 桿面角 95.5%、桿面對路徑 95.0%、旋轉軸 95.5%、carry 93.5%、
  total 95.0%、落點偏移 96.5%（全部仍在 85–99% 內，閘門未放寬）。hb carry ci95 半寬中位 72.9 m、落點偏移 29.1 m。
- **效能**：`deriveLaunchMonitor` 每球 CPU 中位約 145 ms、最大約 220 ms（n = 256，Node 單執行緒；預算 1500 ms）。
- **座標**：所有計算在右手座標系做（左打者鏡像）；回報的左右值一律 + = 遠離球員；`flight.samples` 寫回墊子座標系
  （x 目標、y 目標線左側、z 上），右打者的 + 落點偏移在 samples 裡是 −y，這樣才能用 `calibration.camera` 投影到影片上（tracer）。

