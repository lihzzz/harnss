# Harnss 接入 Codex 持久 Goal 实施计划

## 1. 文档信息

- 状态：已实现（2026-10-01）
- 目标：让 Harnss 支持与 Codex 原生 Goal 模式一致的持久目标能力
- 当前本机 Codex：`codex-cli 0.159.2`
- 计划目录：`plans/codex-goal/`
- 依据：仓库中的 Codex app-server 类型、当前 IPC/会话架构和本机 app-server 实测

本计划只描述实施方案，不修改现有 Plan Mode，也不把 Goal 模拟成 `collaborationMode: "goal"`。

## 2. 当前接入结论

当前协议中的 `ModeKind` 只有 `"plan" | "default"`，因此 Goal 不是一种 collaboration mode。Goal 是线程级持久能力，使用独立的 app-server RPC：

```text
thread/goal/get
thread/goal/set
thread/goal/clear

thread/goal/updated
thread/goal/cleared
```

Harnss 的 RPC 客户端已经接受任意 method，主进程也会转发未知通知，因此底层传输可以承载 Goal。当前缺口在业务层：

- 没有 Goal 协议类型和通知联合类型
- 没有 Electron IPC、preload 和 `window` API
- `useCodex` 没有 Goal 状态和事件 reducer
- 后台 session store 没有保存 Goal 快照
- session 持久化只有 `planMode`
- 没有 Goal 自动续跑、暂停、恢复、清除的生命周期处理
- 没有 Goal 专用 UI
- 普通 turn 完成通知可能误报为整个 Goal 已完成

## 3. 设计原则

1. Codex app-server 是 Goal 状态的最终来源，Harnss 只保存最近一次快照。
2. Goal 与 Plan Mode 完全分离，不能复用 `ExitPlanMode`、Plan 卡片或 Plan 权限流程。
3. 不发送假的用户消息来启动 Goal。
4. 不在 Harnss 中复制原生 Goal runner，除非协议验证证明客户端必须驱动下一轮 turn。
5. 所有 Goal 操作按 session/thread 隔离，支持后台 session 和 split view。
6. 通过运行时能力探测判断支持情况，不按 Codex 版本号硬编码。
7. 在确认 wire schema 和自动续跑语义前，不实现假定的 pause/resume 行为。

## 4. P0：建立原生行为契约

在业务实现前，增加一个 Codex app-server 探测脚本和一个 fake RPC fixture，形成 `docs/codex-goal/behavior-contract.md`。

### 4.1 必须验证的行为

1. 新线程执行 `thread/goal/get` 的返回值。
2. `thread/goal/set` 的准确请求参数、返回值和通知顺序。
3. `set` 是否自动启动第一轮 turn。
4. active Goal 是否自动启动后续 turn。
5. 一轮 turn 完成与下一轮开始之间是否存在空闲窗口。
6. pause 是立即停止，还是当前 turn 完成后停止。
7. resume 是否自动继续。
8. clear 对当前 turn 的影响。
9. 修改 objective 或 token budget 的语义。
10. Goal 期间用户输入是排队、`turn/steer` 还是拒绝。
11. `thread/resume` 后 active Goal 是否自动恢复。
12. app-server 重启后 Goal 是否仍然存在。
13. `blocked`、`usageLimited`、`budgetLimited`、`complete` 的产生条件。
14. `thread/goal/updated` 的发送频率和字段完整性。
15. 老版本返回 `-32601` 时的错误形态。

### 4.2 当前已知的数据模型

以当前本机 app-server 实测为基准，Goal 包含以下字段：

```ts
type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}
```

具体字段命名、set 参数和状态转移以 fixture 和目标 Codex 版本输出为准。

### 4.3 P0 退出条件

- 自动续跑是否由服务端负责已确定
- pause/resume/clear 的语义已确定
- 用户输入行为已确定
- resume 和 app-server 重启行为已确定
- 终态触发条件已记录
- fixture 可以稳定重放主要事件序列

## 5. P1：协议类型和运行时解析

### 5.1 新增类型

建议新增到 `shared/types/codex-protocol/v2/`：

```text
ThreadGoal.ts
ThreadGoalStatus.ts
ThreadGoalGetParams.ts
ThreadGoalGetResponse.ts
ThreadGoalSetParams.ts
ThreadGoalSetResponse.ts
ThreadGoalClearParams.ts
ThreadGoalClearResponse.ts
ThreadGoalUpdatedNotification.ts
ThreadGoalClearedNotification.ts
```

同步更新：

```text
shared/types/codex.ts
shared/types/codex-protocol/ClientRequest.ts
shared/types/codex-protocol/ServerNotification.ts
shared/types/codex-protocol/index.ts
shared/types/codex-protocol/v2/index.ts
src/types/codex.ts
```

### 5.2 生成方式

优先使用与当前 Codex 版本一致的 app-server 类型生成命令。如果重新生成带来大量无关 diff，则只引入 Goal 相关扩展类型，并在代码中记录协议绑定版本。

增加运行时解析函数：

```ts
parseThreadGoal(value: unknown): ThreadGoal | null
isThreadGoalStatus(value: unknown): boolean
```

服务端通知不能完全依赖 TypeScript cast，未知状态和不完整事件应被记录并安全忽略。

## 6. P2：主进程 RPC 和 IPC

主要修改：

```text
electron/src/ipc/codex-sessions.ts
electron/src/preload.ts
src/types/window.d.ts
```

### 6.1 CodexSession 扩展

```ts
goalSupport: "unknown" | "supported" | "unsupported";
goal: ThreadGoal | null;
```

抽取统一的：

```ts
ensureCodexThread(session)
```

该函数供 `start`、`send`、`resume` 和 Goal RPC 共用，避免空白会话创建 Goal 时重复实现线程初始化。

### 6.2 Harnss IPC API

```ts
codex:goal-get({ sessionId })
codex:goal-set({ sessionId, objective, tokenBudget? })
codex:goal-clear({ sessionId })
```

Renderer 可以提供 `pauseGoal` 和 `resumeGoal` 便捷方法，但底层映射必须根据 P0 结果调用正确的原生协议；不能先假定存在独立 RPC。

建议返回结构：

```ts
type GoalResult =
  | { supported: true; goal: ThreadGoal | null }
  | { supported: false; goal: null; reason: "method-not-found" }
  | { supported: true; error: string };
```

### 6.3 主进程职责

- 校验 `sessionId` 和 threadId
- 确保线程存在
- 校验 objective 非空
- 校验 token budget 为正整数或 null
- 串行化同一 session 的 Goal mutation
- 调用原生 Goal RPC
- 将 `-32601` 映射为 `supported: false`
- 转发 `thread/goal/updated` 和 `thread/goal/cleared`
- 在 `thread/resume` 后执行一次 `thread/goal/get`
- 防止旧 app-server session 的事件覆盖新 session

## 7. P3：Renderer、后台和会话持久化

### 7.1 Renderer 状态

主要修改：

```text
src/hooks/useCodex.ts
src/hooks/session/useSessionRevival.ts
src/hooks/session/useDraftMaterialization.ts
src/hooks/session/useSessionPane.ts
src/hooks/usePaneController.ts
src/types/session.ts
```

`useCodex` 增加：

```ts
goal: ThreadGoal | null;
goalSupported: boolean | null;
goalLoading: boolean;
goalError: string | null;

getGoal(): Promise<void>;
setGoal(input): Promise<boolean>;
clearGoal(): Promise<boolean>;
pauseGoal(): Promise<boolean>;
resumeGoal(): Promise<boolean>;
```

事件处理：

```text
thread/goal/updated -> 替换 Goal 快照
thread/goal/cleared  -> goal = null
```

更新时优先比较服务端 `updatedAt`；如果服务端没有可比较版本，则使用本地事件序号，避免旧事件覆盖新状态。

### 7.2 后台和分屏

修改：

```text
src/lib/background/codex-handler.ts
src/lib/background/session-store.ts
```

后台快照增加：

```ts
codexGoal: ThreadGoal | null;
codexGoalSupported: boolean | null;
```

必须验证：

- 非活动 session 收到 Goal 更新不会丢失
- 切回 session 可以恢复 Goal
- 两个 Codex session 的 Goal 不串线
- split view 使用 pane-scoped Goal 状态
- app-server 重启后重新 get
- 延迟到达的旧事件不会覆盖当前 session

### 7.3 会话持久化

修改：

```text
shared/lib/session-persistence.ts
src/lib/session/records.ts
src/hooks/session/useSessionPersistence.ts
src/hooks/session/useSessionCache.ts
electron/src/ipc/sessions.ts
```

在 `SessionBase`、`ChatSession`、`PersistedSession`、`SessionMeta` 和后台快照中增加：

```ts
codexGoal?: ThreadGoal | null;
```

原则：

- 老会话没有字段时按 `null` 处理
- clear 后持久化为 `null`
- Goal 更新使用 debounce/throttle
- clear、pause、resume 等人工操作可以立即 flush
- resume 成功后使用 `thread/goal/get` 覆盖本地快照
- 本地快照只用于 UI 恢复，Codex 服务端是权威来源

## 8. P4：自动续跑、输入和通知

现有通知逻辑会把 `isProcessing: true -> false` 视为普通任务完成。Goal 模式必须区分：

```text
turn completed
Goal completed
```

规则：

- Goal 为 `active` 时，单轮 turn 完成不触发普通任务完成通知
- active Goal 在自动续跑间隙也不能误报完成
- `paused` 不触发普通完成通知
- `complete` 触发完成通知
- `blocked` 触发阻塞通知
- `usageLimited` / `budgetLimited` 触发受限通知
- 后台 session 使用同一套规则
- `goal/updated` 与 `turn/completed` 同时到达时只通知一次

增加纯函数：

```ts
getGoalNotificationTransition(previous, current)
```

通知去重键建议为：

```text
sessionId + goal.updatedAt + goal.status
```

用户输入处理必须遵循 P0 行为契约：

- 原生要求 `turn/steer` 时，active Goal 中的输入走 steer
- 原生排队时，沿用现有队列
- 原生拒绝时，给出明确提示
- 不通过用户消息修改 Goal objective

如果原生 Goal 已经由 app-server 负责自动执行，Harnss 不实现客户端循环。如果验证证明需要客户端驱动，则实现带 generation token 的 Goal runner，并保证暂停、清除、重启不会重复启动 turn。

## 9. P5：UI

建议新增：

```text
src/components/codex/CodexGoalDialog.tsx
src/components/codex/CodexGoalStatus.tsx
src/components/codex/CodexGoalBadge.tsx
```

修改：

```text
src/components/input-bar/EngineControls.tsx
src/components/input-bar/InputBar.tsx
src/components/ChatHeader.tsx
src/components/split/SplitChatPane.tsx
src/components/split/SplitPaneHost.tsx
src/lib/i18n.tsx
```

UI 功能：

- Codex 专属 Goal 按钮
- objective 输入框
- 可选 token budget
- active / paused 状态
- pause / resume
- clear Goal
- objective 和 budget 编辑
- token 使用量和耗时
- blocked、usageLimited、budgetLimited、complete 状态
- unsupported、loading、error 状态

Goal 应作为独立状态面板和 header 状态显示，不复用 Plan 卡片。

Goal 不支持时隐藏或禁用按钮，并且只提示一次；普通 Codex 对话和 Plan Mode 不受影响。

## 10. 能力检测和兼容性

启动或恢复 app-server 后执行：

```text
thread/goal/get
```

状态流转：

```text
unknown -> supported
unknown -> unsupported
```

不要按版本号硬编码，因为 Codex binary 可能来自 Desktop、managed binary、PATH 或 custom binary。

兼容性要求：

| 场景 | 预期行为 |
| --- | --- |
| 新版 Codex | Goal 全功能 |
| 老版 Codex | 普通对话正常，Goal 控件不可用 |
| Goal RPC 超时 | 显示错误，不修改本地状态 |
| app-server 重启 | resume 后重新拉取 Goal |
| malformed notification | 忽略并记录日志 |
| Plan Mode + Goal | 两者状态互不覆盖 |

## 11. 测试计划

### 11.1 单元测试

覆盖：

- Goal status 解析
- set/get/clear 请求参数
- objective 和 token budget 校验
- `-32601` 到 unsupported 的转换
- Goal event reducer
- stale event 丢弃
- background Goal state
- 持久化 round-trip
- 老会话兼容
- clear 持久化为 null
- active Goal 不触发普通 completion
- terminal Goal 通知去重
- Plan Mode 与 Goal 独立

### 11.2 RPC 集成测试

使用 fake app-server 或 JSONL fixture：

```text
initialize
thread/start
thread/goal/get
thread/goal/set
thread/goal/get
thread/goal/clear
thread/goal/get
```

验证请求 method、params、response、notification 顺序和 sessionId 注入。

### 11.3 真实 Codex smoke test

使用当前本机 Codex 执行：

```text
创建空白线程
设置 Goal
观察第一轮 turn
观察自动续跑
暂停
恢复
清除
重启 app-server
resume
重新 get Goal
```

### 11.4 生命周期测试

- 空白会话创建 Goal
- objective 修改
- token budget 修改
- complete
- blocked
- usageLimited
- budgetLimited
- app 重启恢复
- 后台 session
- split view 两个 Goal
- 自动 turn 中发送用户输入
- interrupt
- 老 Codex 返回 `-32601`

## 12. 推荐实施顺序和验收标准

```text
P0 原生行为契约
  ↓
P1 协议类型和解析
  ↓
P2 主进程 RPC / IPC
  ↓
P3 renderer、后台和持久化
  ↓
P4 自动续跑、输入和通知
  ↓
P5 UI 和空白 Goal 会话
  ↓
P6 集成测试、smoke test、兼容性发布
```

每一阶段先补最小验证，再进入下一阶段。最终验收标准：

1. 用户可以从空白 Codex 会话创建 Goal。
2. 不会向聊天记录插入假的启动消息。
3. Goal 状态由 Codex 服务端驱动并实时反映。
4. 自动执行行为与原生 Codex 一致。
5. pause、resume、clear、complete、blocked、预算限制行为一致。
6. 应用重启、后台 session、分屏 session 都能恢复正确状态。
7. Goal 不会误触发普通 turn 完成通知。
8. 不支持 Goal 的 Codex 版本仍可正常使用普通对话。
9. `pnpm test` 通过。
10. `pnpm build` 通过。
11. 本机真实 Codex app-server smoke test 通过。
