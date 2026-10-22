# 资源体系重构：双轨次数 · 火种 · 范围认领 · 巡夜

日期：2026-09-23
状态：已评审通过（分 7 节逐节确认）

---

## 1. 背景与问题

当前资源体系有三个结构性缺陷，导致「没有每天上线的欲望」：

1. **次数花不出去（消耗端被地理位置卡死）**
   `clearFog` 的重叠规则是 3km 内存在任何已有区域（含他人）即拒绝。动线固定的用户在「家」「公司」各点一次 ✦ 之后，普通次数全部作废——**资源的可用上限由去过几个不同地方决定，而不是由持有多少次数决定**。
2. **获取端是杂活**
   `checkIn` 中 `gained = newCount % 2 === 0 ? 1 : 0`，偶数次签到才 +1 次，日均仅 **0.5 次**；新用户 `initUser` 种 5 次、`getUserStats` 种 1 次，两处不一致。
3. **离开后世界不变**
   次数不随时间恢复，地图不产生任何价值，玩家没有任何「今天必须打开」的理由。

附带问题：等级奖励几乎全是「认领 +N 次/天」，是同一动作的重复量，而非能力扩张。

## 2. 目标与非目标

**目标**：把日均可用行动从 0.5 次提升到最高 8 次；让固定动线的用户永远有处可花；让世界在玩家离开期间继续变化。

**非目标（本期明确不做）**：

- Plan B 驱散预览卡（稀有度线索、边疆提示）
- 每日 / 每周小目标
- 主题图鉴、收集完成度
- Plan C 全球点亮进度
- 反作弊加固（继续沿用现有客户端 GPS 信任模型）
- `clearFog` 中「检查次数 > 0 与扣减非原子」的既有并发问题

## 3. 决策记录

| 决策 | 结论 | 被否方案与原因 |
|---|---|---|
| 资源结构 | **双轨**：自然恢复（保底）+ 火种离线产出（成长） | 只按面积产 → 新玩家冷启动产出为 0；只做恢复 → 地图仍是静态战利品，经济闭环断裂 |
| 火种产出依据 | **按点亮块数 × 面积 × 稀有度系数** | 纯按块数 → 与面积脱钩，激励刷密集小块；纯按等级/稀有度 → 需遍历聚合，复杂度高 |
| 稀有度持续价值 | **本期纳入**（产出系数） | 原倾向留作后续加强；用户要求现在就加 |
| 次数货币 | **合并为单一 `clearAttempts`**，✦ 与长按共用 | 两套并存 → 保底轨对固定动线用户依然作废，火种无处可去 |
| 长按是否限制范围 | **限制，且半径随等级解锁** | 无范围 → 坐在家里涂全世界、排行榜被刷、游戏身份丧失；固定半径 → 无法替代被删掉的等级奖励 |
| 巡夜（重访自有区域） | **纳入，每日 1 次 +10 火种** | 放弃 → 范围已解决「花不出去」，但「今天没出门也有事做」仍无着落 |

## 4. 终态资源模型

### 4.1 钱包 `clearAttempts`

上限 **`WALLET_CAP = 10`**。

**入账**

| 来源 | 数值 | 约束 |
|---|---|---|
| 自然恢复 | 每 **4h** +1 | **只补到 `REGEN_FLOOR = 3`**，超出的时间作废 |
| 签到 | 每次 **+1** + 20 XP | 每天 1 次（保留 `lastCheckInDate` 判重） |
| 火种兑换 | **10 火种 = 1 次** | 兑到钱包满为止，余数留在火种余额 |
| 新用户初始 | **5** | 统一为 `initUser` 的值 |

**出账**：✦ 当前位置、长按认领，**各扣 1**。

**删除**：`claimCount` / `claimDate` 每日限额、`getClaimLimit()`。`isClaim` 参数保留，语义从「使用另一套货币」改为「**需要范围校验**」。

> **为什么保底轨上限是 3 而不是钱包上限 10**：自动回复永远填不满钱包，**火种是唯一能把钱包推到 10 的通道**，成长轨才不会被保底轨架空。

### 4.2 结算时机

- 恢复结算在 `getUserStats`（打开时）和 `clearFog`（扣减前）执行。
- 火种结算**只在 `getUserStats`** 执行。
- 一切时间戳用服务端时间（`db.serverDate()` / 服务端 `Date.now()`），不接受客户端时间。

**恢复结算规则**

```
capped = min(max(attempts, 0), WALLET_CAP)        // 先夹紧，存量超上限不还原

缺时间戳 → attempts = max(capped, REGEN_FLOOR)，ts = now（视为「立即补到 3」）

capped ≥ REGEN_FLOOR → 不恢复，ts 不变（保底线之上没有可恢复量）

否则 recovered = floor((now − ts) / 4h)；recovered ≤ 0 → 不变
   sum = capped + recovered
   sum ≥ REGEN_FLOOR → attempts = REGEN_FLOOR，ts = now（多余时间作废）
   否则              → attempts = sum，ts += recovered × 4h
```

**扣减时 ts 一律置为 now**（`clearFog` 的唯一用户写入）。这是防囤积的关键：
ts 只在「真正恢复」和「扣减」时前进，所以钱包一旦降到保底线以下，累计时长
只从上次扣减算起，不会因为长期满额而凭空补满。

> 曾考虑的写法 `after = min(attempts + recovered, REGEN_FLOOR)` 是错的——当
> attempts = 5（> 保底线）时它会把玩家的次数直接砍到 3。故先判
> `capped ≥ REGEN_FLOOR` 再走恢复分支。

## 5. 长按范围（等级解锁）

等级由 `xp` 推导，**`LEVELS_XP = [0, 200, 800, 2000, 5000, 10000, 20000]`**，等级 = 命中下标 + 1。

| 等级 | 名称 | 可认领半径 |
|---|---|---|
| Lv1 | 微光 | 不可用长按 |
| Lv2 | 火种 | 15 km |
| Lv3 | 烛光 | 30 km |
| Lv4 | 火炬 | 60 km |
| Lv5 | 篝火 | 150 km |
| Lv6 | 星火 | 500 km |
| Lv7 | 曙光 | 无限制 |

- 客户端随请求上报**当前定位**，服务端 haversine 计算「当前定位 → 目标点」，超限即拒绝。
- 服务端必须自行由 `user.xp` 推导等级，不信任客户端上报的等级。
- 信任模型与现有 `clearFog` 一致（现状即完全信任客户端 GPS），本期不做反作弊。

**设计收益**：气泡跟着人走 → 出门/旅行时权限刷新；同城 15km 内有足够多相距 3km 以上的独立落点，固定动线用户照样花得掉次数；`≥50km` 的边疆稀有度线索成为旅行者专属；Lv7 无限留给顶级玩家去点真边疆，为后续全球进度供内容。

## 6. 火种（离线产出）

余额上限 **`EMBER_CAP = 30`**（未收割余额），展示向下取整，存储为浮点。

```
BLOCK_AREA_KM2   = π × 2²  ≈ 12.57
BASE_RATE_KM2    = 0.15
RARITY_MULT      = { common:1, uncommon:1.5, rare:2.5, epic:4 }
levelCoeff       = 1 + 0.1 × (Lv − 1)

ratePerDay = BLOCK_AREA_KM2 × BASE_RATE_KM2
             × (n_common×1 + n_uncommon×1.5 + n_rare×2.5 + n_epic×4)
             × levelCoeff

elapsedDays = min((now − emberUpdatedAtMs) / 86400000, 1)
pending     = min(ratePerDay × elapsedDays, EMBER_CAP − ember)
ember      += pending
emberUpdatedAtMs = now       // 无论是否触及上限，结算后一律置为 now
```

- **数据源是 `users` 上的计数器，不扫 `cleared_areas`**：新增 `uncommonCount`（照现有 `rareEpicWrite` 的增量模式维护），配合已有 `totalCleared / rareCount / epicCount`，一次 `users` 读即可算出。这避开了 1000 行扫描与 `calcUnionArea` 的 2000 次蒙特卡洛采样。
- **封顶固定 30，等级只加速产速不抬上限** → 日上限恒定，数值有界。

**成长曲线**（12.57 × 0.15 = 1.89 / 块 / 天）

| 状态 | 产速/天 | 攒满 30 需 |
|---|---|---|
| 1 块 common | 1.9 | 16 天 |
| 16 块 common | 30 | 24 小时（≈ +3 次/天） |
| 40 块（含 5 稀有）@ Lv4 | 116 | **6 小时** |

## 7. 巡夜（重访自有区域）

- **触发**：✦ 或长按落点与**自己**的已点亮区域距离 < 3km（即现行代码中返回「你已经驱散过这里了」的分支）。
- **归属优先级**：落点可能同时与「我的」和「他人的」区域重叠，**取距离最近的那块判断归属**——最近为我的 → 巡夜；最近为他人的 → 拒绝文案。不得用「先找到谁就是谁」的遍历顺序决定结果。
- **效果**：不扣次数、不写入新区域，**+10 火种 +10 XP**，每天限 1 次（`nightWatchDate` 存 `YYYY-MM-DD`）。
- **不设次数门槛**：钱包为 0 时巡夜照常可用（重叠检查在次数检查之前，沿用现有代码顺序）。
- **他人**区域：保持现有拒绝文案，无产出。
- **为何是 +10**：10 火种 = 1 次，且受 `EMBER_CAP = 30` 约束——若探索已把余额攒满，巡夜产出溢出作废，**自动抑制「宅家比出门划算」**。
- 返回结构 `type: 'nightWatch'`，客户端渲染结果卡的巡夜变体。

## 8. 收割交互

- `getUserStats` 打开时惰性结算，返回 `ember`（余额）与 `pendingEmber`（本次结算新增量）。
- 当 **`ember ≥ EMBER_PER_ATTEMPT`（余额够兑换）且 `clearAttempts < WALLET_CAP`（钱包有空位）** → 弹收获卡（复用现有 result card 结构与样式），一键调用 `collectEmber`。
- 卡面展示：有新增时显示「本次 +X」，恒显示「余额 Y/30」。
- **判定用余额而不是 `pendingEmber`**：上次弹过卡但玩家没收，下次结算的 `pendingEmber` 趋近 0，若以它为条件卡就再也不会出现，而余额其实一直够兑换。
- 钱包满 10 → 卡片改为「钱包已满，花一次再收」，**不自动兑换**——收割时机本身成为一个微决策。
- 「我的」页状态条：`火种 18/30 · 次数 3/10 · 4h 后 +1`。
- **不加地图常驻按钮**：避开 cover-view 在 map 上的层级与性能坑（现有 UI 已出现过卡片被压住的问题）。

## 9. 数据模型

**`users` 新增**

| 字段 | 类型 | 说明 |
|---|---|---|
| `ember` | number(float) | 火种余额，上限 30 |
| `emberUpdatedAtMs` | number(ms) | 上次火种结算时间，Unix 毫秒 |
| `attemptUpdatedAtMs` | number(ms) | 上次恢复结算时间，Unix 毫秒 |
| `uncommonCount` | number | uncommon 稀有度块数，增量维护 |
| `nightWatchDate` | string | 最近一次巡夜日期 `YYYY-MM-DD` |

时间戳存**毫秒数字**而非 Date 对象：与纯函数的入参出参同型，单测无需处理
数据库日期序列化差异，也不必在云函数里来回转换。

**弃用不删**：`claimCount`、`claimDate`（停止读写，字段保留）。
**`cleared_areas` 完全不变，不新建集合。**

## 10. 云函数改动

| 函数 | 改动 |
|---|---|
| `getUserStats` | 惰性结算（恢复 + 火种）；返回 `ember / pendingEmber / clearAttempts`；种子统一为 5 并补新字段 |
| `collectEmber` | **新增**：10:1 兑换入钱包 |
| `clearFog` | 删 `getClaimLimit` 与 claim 限额 → 加范围校验 → 维护 `uncommonCount` → 重叠命中自己走巡夜 → 先结算恢复再扣 1 |
| `checkIn` | 每次 +1，删除 `gained = newCount % 2 === 0` 判定 |
| `initUser` | 种子补齐 `clearAttempts: 5`、`ember: 0`、两个时间戳、`uncommonCount: 0` |
| `getUserInfo` | 透传新字段（无逻辑改动） |

**`collectEmber` 并发安全（不引入事务，沿用代码库的条件更新风格）**

```
读 → convert = min(floor(ember / 10), WALLET_CAP − clearAttempts)
   → update where { _id, ember: ≥ convert×10, clearAttempts: ≤ WALLET_CAP − convert }
       set ember: _.inc(−convert×10), clearAttempts: _.inc(convert)
   → 0 条匹配则重读并重试一次，仍失败返回「请重试」
```

`clearFog` 中「检查次数 > 0 与扣减非原子」是**既有问题，本期不处理**。

## 11. 客户端改动

- **`pages/fogmap`**
  - 认领卡去掉「今日认领 x/y」，改为显示「距你 8.2km / 上限 15km」；复用现有 `claimWarning` 机制，超范围时确认按钮禁用。
  - 长按落点时即刻校验距离，确认时二次校验。
  - 次数不足文案改为：「次数不足：4 小时后自动恢复，或收取火种」。
  - 结果卡增加 `nightWatch` 变体（显示 `+10 火种`）。
  - 移除 `claimLimits` 数组与 `claimUsed / claimLimit` 状态。
- **`pages/profile`**
  - `LEVELS` 的 `unlock` 文案改为对应半径（见 §5 表）。
  - 移除 `claimLimits` 相关展示。
  - 新增火种状态条（§8）。
  - 签到提示文案改为「每次签到 +1 驱散次数」。
- **`utils/db.js`**：新增 `collectEmber()`。

## 12. 可测性与常量共享

范围表、火种公式、兑换率、各上限、巡夜限额、`LEVELS_XP` **全部抽成纯函数与常量**，放在 `gameplay.js`，`index.js` 只做 IO（沿用 `cloudfunctions/clearFog/gameplay.js` 现有分层约定）。

需要这些常量的云函数各放一份同源拷贝：

- `cloudfunctions/clearFog/gameplay.js`（范围表、等级、巡夜）
- `cloudfunctions/getUserStats/gameplay.js`（火种公式、恢复规则、上限）
- `cloudfunctions/collectEmber/gameplay.js`（兑换率、上限）
- `miniprogram/utils/gameplay.js`（客户端范围表、等级、上限展示）

`checkIn`、`initUser` 不需要共享常量，不拷贝。

**契约测试**：根目录 `tests/` 断言上述各份拷贝中同名常量与函数结果完全一致（沿用现有「客户端 `BADGE_META` ↔ 服务端 `BADGE_DEFS` 契约」测试模式）。

## 13. 数值总账

| | 现在 | 改后 |
|---|---|---|
| 日常可用次数 | 0.5 | 最高 **8**（恢复 3 + 签到 1 + 火种 3 + 巡夜 1） |
| 花不出去？ | 是（3km 卡死） | 否（15km 起步气泡） |
| 离开后变化 | 无 | 火种持续累积 |
| 等级价值 | 认领 +N 次/天 | 半径 15km → 500km → 无限 + 火种产速 ×(1+0.1(Lv−1)) |
| 钱包囤积 | 无上限（未约束） | 10（≈ 1.4 天） |

## 14. 风险与迁移

| 风险 | 应对 |
|---|---|
| 合并货币后长按无每日次数限制，定位向「地图轻策略」偏移 | **已明确接受**（现有长按认领本就在这个方向上） |
| 客户端上报定位可伪造 | 与现有信任模型一致，本期不加固；反作弊列入非目标 |
| 火种产速过高 → 次数泛滥、选择感消失 | `EMBER_CAP 30` 固定 + `WALLET_CAP 10` 硬顶 → 日上限 8 有界 |
| 巡夜优于探索 | +10/天 + 余额上限自动抑制 |
| 存量用户 `clearAttempts` > 10 | 首次结算夹到 `WALLET_CAP` |
| 缺 `attemptUpdatedAtMs` | 视为「立即补到 3」 |
| 存量用户缺 `uncommonCount` | 记 0，`n_common = totalCleared − rareCount − epicCount − uncommonCount` |
| `initUser`(5) 与 `getUserStats`(1) 种子不一致 | 统一为 5，`getUserStats` 建档分支同步修正 |

## 15. 测试

扩 `tests/gameplay.test.js`（`node:test` + `node:assert/strict`，直接 require 纯逻辑模块）：

- **恢复结算**：4h 边界（3h59m 不恢复、4h 恢复 1）；只补到 3；存量缺时间戳补到 3；超时时间作废
- **火种累计**：封顶 30；`>24h` 按 24h 计；四档稀有度系数；等级系数；余额已满不产出
- **兑换**：10:1 向下取整；钱包满时余数保留；`convert = 0` 时不写
- **范围**：Lv1 拒绝长按；15/30/60/150/500 各档边界（等于上限通过、超出 1m 拒绝）；Lv7 无限
- **巡夜**：每日 1 次；+10 火种；命中他人区域不触发；不扣次数
- **签到**：每次 +1（奇数次也给）
- **契约**：各份 `gameplay.js` 拷贝常量一致

## 16. 后续（不在本期）

按既定顺序：**每日 / 每周小目标 → 主题图鉴（分母固定）→ Plan B 驱散预览 → Plan C 全球进度（改为周常集体倒计时）**。
