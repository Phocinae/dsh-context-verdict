# dsh-context-verdict 架构

## 一句话

压缩前回答一个**会话级**、可判定的问题：**有没有未落盘的状态会被丢掉？**
并且**从结构上**无法回答逐块问题 —— 因为逐块已经被测错了。

## 数据流

```
  会话记录
      │
      ▼
  summarise() ── 封闭字段集 ─────────────► 没有任何字段能表达「块」
      │            session / todos / uncommitted / questions /
      │            decisions / next_steps / risk_hints
      ▼
  renderState() ── 唯一渲染器 ───────────► SESSION / TODO / UNCOMMITTED /
      │                                     QUESTIONS / DECIDED / NEXT / RISK
      ▼
  computeDigest(state, summary) ─────────► sha256，绑定**两者**
      │
      ▼
  judge({state, summary, digest})
      │
      ├── 1. 模板校验：七个段名都在？无结构序号词汇？不超预算？
      │        否 → 拒（不发请求）
      ├── 2. digest 校验：state 与 summary 配对？否 → 拒
      ├── 3. 形状断言：恰好 1 个三选项 choice + 1 个 score？
      ├── 4. 本地判定：unlanded == 0 → safe_to_compact
      │                unlanded >= waitMin → preserve_first
      │                灰区 → 交给第 5 步
      └── 5. 问服务 ── 问到 → 取其答案（词表外的答案**拒绝**，不coerce）
                   ── 问到但不在 → wait
                   ── 没配服务 → wait
      │
      ▼
  finish() ── 最后一道：输出再扫一次 FORBIDDEN_KEYS
```

## 四道闸门，以及它们各自防的是什么

| 闸门 | 机制 | 自检注入什么 |
|---|---|---|
| **G1** 模型输入里没有块 | 唯一渲染器 + 封闭字段集 + digest 绑定 | 一个手工拼的、形状正确的 state |
| **G2** 三值 + 一个标度 | 形状断言在任何请求之前跑 | 一个四选项请求 |
| **G3** 没有「选择」槽位 | `FORBIDDEN_KEYS` 递归扫描，**命中即抛** | 全部 35 个禁用键逐个注入 |
| **G4** 没有逐块 API | 三个工具，没有第四个 | 工具清单逐名比对 |

**为什么是「抛」而不是「剥掉」**：剥掉会返回一个看起来合理的裁决，
同时把「上游正在产出被禁止的形状」这件事藏起来。响的那一种才有用。

## 为什么要有 digest —— 这是设计自己找出来的洞

设计复核时发现 G1 原本**只对我们自己渲染的 state 成立**：
`judge` 如果把 `state` 当自由文本收，那么任何调用方（包括模型自己）
都能把 30 个块拼成一个**恰好含有七个段名**的字符串递进去 ——
那时 G1 就退化成「劝调用方别乱写」。

digest 把这条路堵上：state 只与其 summary 配对出现，两者一起进哈希。
手工拼的 state 形状再对也没有配对的 digest。

**它是完整性检查，不是安全控制。** 任何人都能重算一个。
它防的是**意外**（自己拼、旧 state 脱节），并让绕过变成**刻意行为**。
README 与技能文本都这么写，不夸大。

## 判定为什么分两层

**本地能判的就不问服务。** `unlanded == 0` 与 `unlanded >= waitMin` 是算术，
问模型等于给一个是非题加置信区间。灰区才问 —— 而灰区是**配置的一部分**
（`safeMax` / `waitMin`），所以「问了多少次」是可解释的。

`safeMax >= waitMin` **加载即抛**：那会让 `wait` 这个裁决变得不可达，
而一个把某个裁决从词表里删掉的配置不是调参，是改语义。

## 失败方向

| 情形 | 结果 |
|---|---|
| 没配服务 | `wait` + `SERVICE_NOT_CONFIGURED`（**永不**是许可） |
| 服务不在 | `wait` + `SERVICE_UNREACHABLE`，`detail` 带上原因 |
| 服务答了词表外的值 | **抛**，不 coerce 成 `wait` —— coerce 会把一个坏掉的服务变成合理裁决 |
| state 超预算 | exit **2**，不是裁决 —— 否则基础设施限制会看起来像发现 |
| state 缺段名 / 含结构序号词汇 | 拒，`STATE_INVALID` |
| digest 不匹配 / 缺失 | 拒，`DIGEST_MISMATCH` |
| 语料只有单一标签 | **拒**，不评分 |
| 语料为空 | 拒 —— 空扫描不是通过的扫描 |
| 未注册的错误码 | 构造时即抛 `Error` |

## verify 的两个方向

| 方向 | 结果 | 为什么 |
|---|---|---|
| `lost` 被判 `safe_to_compact` | exit **1** | 工作被压掉、没了。这是项目存在的理由 |
| `keep` 被判非 `safe_to_compact` | 计数（`keepRefusedRate`），exit 仍 0 | 永远答 `preserve_first` 的工具什么都不丢，也毫无用处 |

单标签语料被拒，因为「没有 lost 案例被放行」在一份没有 lost 案例的语料上
是真话且毫无意义 —— 比一次红色的检查更糟。

## 文件

| 文件 | 职责 |
|---|---|
| `index.mjs` | 组合入口；常量只在 `lib/constants.mjs` 定义一次（第二份副本会漂移） |
| `lib/constants.mjs` | 段名、35 个禁用键、三个裁决、退出码、默认配置 |
| `lib/state.mjs` | **G1 与 G3 的可执行形式**：渲染器、禁用键扫描、模板校验 |
| `lib/summary.mjs` | 封闭字段集的抽取；产出封闭字段集之外的键即抛 |
| `lib/digest.mjs` | state 与 summary 的配对哈希与校验 |
| `lib/judge.mjs` | G2 的形状断言、本地判定、服务路径、答案解释 |
| `lib/verify.mjs` | 双向验证、单标签拒绝、退出码 |
| `lib/config.mjs` | 配置解析；`safeMax >= waitMin` 与双服务来源都拒 |
| `lib/errors.mjs` | 闭集错误码；未注册码构造即抛 |
| `lib/skill.mjs` | 由**当前配置与常量**生成的技能文本 |
| `tools.mjs` | 三个工具定义；注册前拒绝任何逐块工具名 |
| `scripts/verify-artifacts.mjs` | 发布前自检：**注入**每道闸门禁止的东西，要求被拒 |
