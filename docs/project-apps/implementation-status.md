# 项目应用实施记录

更新：2026-10-09。原始范围保留于 [集成计划](integration-plan.md)，用户操作见 [使用说明](user-guide.md)。本记录区分代码落地、自动化验证和真实产品验收，不能把单元测试通过等同于跨平台发布验收。

当前：P0–P4 的核心实现及 P6/P7 的选定能力已落地，P5 验收进行中。尚不声明原计划所有平台和场景验收完成。GUI 已观察到零项目、零会话可进入应用页；完整 GUI 流程、最终打包和 Agent MCP 烟测由主任务继续记录。

## 按计划范围映射

| 计划章节/阶段 | 已实现入口与文件 | 已有证据与剩余要求 |
| --- | --- | --- |
| §1/§3/P3 应用目录与导航 | `src/components/apps/ProjectAppsView.tsx`、`ProjectAppCard.tsx`；`AppLayout.tsx`、`AppSidebar.tsx`、`sidebar/ProjectSection.tsx`；`useAppEnvironmentState.ts`、`useAppSpaceWorkflow.ts` | 无会话主视图、当前/全部 Space、项目/状态/收藏/文件夹筛选、搜索、URL 临时打开/保存、卡片菜单已实现。零项目/零会话入口 GUI 已观察；完整交互矩阵待继续验证。 |
| §3/P1/P3 添加与编辑 | `ProjectAppEditor.tsx`、`electron/src/lib/project-apps/discovery.ts`、`command-resolver.ts` | 项目/网站、接入已有目录、worktree、相对 cwd、候选脚本、结构化 command/args、env、端口和健康配置。发现过程不执行命令。Vite 与缺失运行时分支有自动化证据；Next 真实项目待验收。 |
| §4/P0 身份模型 | `shared/types/project-apps.ts`、`workspace.ts`、`shared/lib/project-apps.ts`、`electron/src/lib/project-apps/workspace.ts` | managed/web 判别联合、固定 workspace、冻结 run 配置、expectedRevision、稳定 conversationId。真实 linked worktree/越界拒绝、前端绝不选择另一个工作区实例的测试已通过。 |
| §5/P1 权威持久化 | `electron/src/lib/project-apps/store.ts`、`service.ts`、`index.ts` | 原子写与串行变更、版本校验、损坏保留、有限运行历史；实现采用单一 `catalog.json`，见下方差异说明。并发冲突/损坏保留测试通过；磁盘故障的完整产品提示待验收。 |
| §5/P1 进程间协议 | `electron/src/ipc/project-apps.ts`、`preload.ts`、`src/types/window.d.ts`、`src/stores/project-apps-store.ts`、`src/hooks/useProjectApps.ts` | 主窗口来源限制、先订阅再快照、目录 revision 与单 run revision 分离；日志不进入全局目录 store。8 个初始纯测试与后续 3 个补读策略测试通过。 |
| §6/P2 端口与就绪 | `health.ts`、`runtime.ts`、`command-resolver.ts` | 固定/框架自动端口、TCP 预检、HTTP 健康、超时和进程退出。真实临时 HTTP、端口占用、Vite 通过；预检后的端口抢占完整矩阵及 Next 跨平台待验收。 |
| §7/P0/P2 进程归属 | `process-tree.ts`、`runtime.ts`、`electron/src/lib/project-apps/windows-job.ts` | Windows Job Object/helper、POSIX 进程组；实际包装进程退出后 detached 孙进程仍被正确停止。Windows 成功；macOS/Linux 未实机验证。Windows helper 使用 PowerShell/C# Add-Type 本机编译，整包需验证该系统能力可用。 |
| §7/P2 生命周期 | `service.ts`、`electron/src/main.ts`、`ipc/git.ts`、既有 SessionRepository runtime lease | 启动/停止/重启幂等与竞态、项目删除屏障、worktree 清理、普通退出等待清理、历史 interrupted。启动中移除、无效重启不杀旧服务、worktree 删除测试通过；整包退出行为继续验证。 |
| §5/§7/P2/P3 日志 | `logs.ts`、`ProjectAppLogs.tsx`、`app-utils.ts` | 1 MiB 内存、2 MiB JSON 尾部、75 ms 后端批次、100 ms 前端批次、虚拟化最近 3,000 块；seq 去重、有界重放、truncated 不重试已淘汰历史。块边界 UTF-8/秘密脱敏、容量与序号纯测试有证据；50,000 行产品压测尚未给出实测值。 |
| §8/P3 预览 | `ProjectAppDetail.tsx`、`BrowserPanel.tsx`、`browser/BrowserNavBar.tsx`、`WebviewInstance.tsx` | 独立于 session；HTTP URL 受控请求、稳定标签与持久化 scope；返回网格/切日志保留一个宿主，切应用释放旧宿主。process-readiness 允许手动 URL 预览并明确未 HTTP 验证。真实 Electron 预览/刷新/端口改变持续验证中。 |
| §9/P4 继续优化 | `useAppLaunchActions.ts`、`shared/types/workspace.ts`、`src/hooks/session/workspace-binding.ts`、session CRUD/materialization/cache/revival/restart、`shared/lib/session-persistence.ts` | prepareContext 校验绑定与上限；草稿方式传递，保留引用边界；所有引擎启动/恢复路径传递 cwd 与来源。workspace 4、records 8、revival/restart 44 测试通过；完整真实三引擎产品流程未验收。 |
| §9/P4 关联会话 | `AppSessionLink`、service links/linkSession、`ProjectAppDetail.tsx`、`useAppLaunchActions.ts` | 使用 conversationId，运行不依赖会话；跨 Space 导航与目录校验已接。会话删除/历史身份变化的完整 GUI 验收待补。 |
| §10/P6 Agent 工具 | `agent-bridge.ts`、`agent-bridge.test.ts`、`electron/src/project-apps-mcp.ts`、`project-apps.ts` IPC、`shared/types/project-app-agent.ts` | stdio MCP 转发同一主服务；随机 256-bit token、loopback 私有端点、Origin 拒绝、1h TTL、session/项目/固定 cwd 范围、会话停止/轮换吊销。12 项桥接测试通过；独立构建产物 stdio 烟测与真实模型调用状态见证据部分。 |
| §10/P6 宿主审批 | `ProjectAppAgentPermissions.tsx`、bridge 请求/响应队列、AppLayout 常驻 | 页面未打开也显示请求、项目/cwd/工具/完整参数；一次批准、2 分钟到期、配置变更/撤销后拒绝。伪造 approved 参数、跨 worktree、过期/停止后的权限测试通过；弹窗真实模型联动待验收。 |
| §15/P7 清单交换 | service `exportConfig/importConfig`、`ProjectAppManifest.tsx`、shared 校验 | `schemaVersion:1`，重新绑定项目，无绝对机器路径/env/日志/PID/授权；导入不执行。JSON 可复制/下载/选文件导入。源码包与 WorldBase 包转换未实现，仍保留为后续需求。 |
| §3/P7 组织与本地化 | `strings.ts` 复用 `src/lib/i18n.tsx`、编辑器 folder/order、卡片 favorite、AppFields | 中英同步、文件夹文字分组、数字顺序、响应式网格与菜单/弹窗。拖拽排序、批量操作后续；完整键盘/读屏与 500 项 <100 ms 目标尚未实测。 |
| §14/P5 数据回退与帮助 | `user-guide.md`、store/catalog version、可选 session workspace 字段 | 新目录加法存储；说明损坏备份/停止后降级/旧版未知字段风险。没有声称旧版重写会话一定无损，升级降级完整演练待验收。 |

## 本次实现相对设计的明确选择

- 配置主存储为 `<userData>/openacpui-data/project-apps/catalog.json`，结构为 `{version:1, apps, links}`；采用单写队列统一跨应用/Space/链接事务。早期计划中的按 project/Space 分片是建议落点，不是已交付格式。
- 运行存储为 `runs/<runId>/meta.json`（`version:1`）与 `output.json`。单 run 日志采用 1 MiB 内存、最多 2 MiB 落盘 JSON；历史每应用 20 次、全局 128 次已结束运行，对应约 256 MiB 的历史日志上限，活跃实例另计。前端保留 3,000 块并虚拟化。
- Windows 使用 Job Object/helper 清理归属进程树；停止是强制树终止。POSIX 先 SIGTERM 后 SIGKILL。不能把正常退出保障扩展成断电/系统强杀零残留承诺。
- 页面要求先停止运行实例再移除卡片；底层移除仍有停止/删除屏障。完整卡片菜单中的详细操作集中在详情区；未另造多个同时驻留的应用窗口。
- P6 已提前实现受宿主审批的 MCP 工具层，P7 提前实现配置清单和基础组织。可选 `apps_request` 业务 API 验证、多服务编排、Docker 专用适配、源码 ZIP 包仍未实现；原计划范围与后续方向未删除。

## 已有验证证据

以下是本轮对应工作树的执行证据，后续若代码变化需以主任务最终复验为准。

- 主任务报告 renderer/electron 双 TypeScript 检查通过，tsup 与 Vite 构建通过；最近一次完整 Vitest 为 **119 个文件通过、1 个跳过；792 个测试通过、1 个跳过**。该总数记录早于后加的日志补读策略用例，不能据此声称最终汇总已经复跑。
- 后端 `electron/src/lib/project-apps/project-apps.test.ts` 定向 **21 项通过**，耗时约 9.57 秒（Windows）。使用真实 Git linked worktree、junction/symlink、临时 HTTP 进程、外部占用端口、Windows 包装进程/孙进程、启动中删除、无效 restart、历史恢复、generic Windows `.cmd` 特殊字符参数保真、排队 Agent 操作撤销授权。
- 本机真实 **Vite 7.3.1** 项目通过 `pnpm.cmd → JS shim → dev script` 启动，在中文含空格目录完成预览健康检测、停止与端口释放。未下载外部运行时；本机没有可用 npm executable/Next 依赖，Next 未实跑。
- 会话及 Agent 定向 **93 项通过**：workspace-binding 4、records 8、revival/restart 44、agent-bridge 12、engine runtime races 25。桥接测试包含真实本地 HTTP 请求，不需要真实模型账户。
- 前端 `src/components/apps/app-utils.test.ts` 最新 **11 项通过**：快照晚于 run 事件、旧快照不复活删除项、每 run 独立排序、日志不更新目录 store、历史/事件去重、固定 worktree 选择、环境变量/HTTP URL、缺口 cursor、已截断历史停止重试、有限重试。
- UI 已观察到隔离 Electron 环境中的零项目/零会话应用页可用。主任务继续验证添加、预览、草稿、状态切换、持久化与审批；此处不写“GUI 全通过”。
- 构建的 `electron/dist/project-apps-mcp.js` 启动真实子进程，无模型 stdio 烟测通过：JSON-RPC `initialize → tools/list`（12 个工具，含 `apps_register`）`→ tools/call apps_list`，Bearer token 正确转发本地 fixture host，进程 exit 0。真实 Claude/Codex/ACP 模型驱动工具调用尚未验收。
- 一次 Windows `electron-builder --dir` 被完整性检查正确阻止：构建过程中再次写入 `electron/dist`，使 main/preload 比 header 记录的尺寸分别增大 27,304/485 字节，导致后续 package.json 偏移 27,789 字节。实际 package.json 内容与预期 hash 一致，属于输入竞态；没有绕过校验或修改已有打包 hook。主任务冻结构建产物后重跑，最终结果待补。

## 尚需完成的验收

1. Windows 最终打包与安装目录执行：原生依赖、PATH/`.cmd`、应用子进程树、常规退出阻止漏管进程；以冻结的构建输入运行。
2. 完整 Electron GUI：添加项目和网站、URL 搜索动作、健康/日志、跨 Space、多 worktree 精确目标、重启、保存/导入/导出、刷新与持久化、草稿和关联会话、审批超时及拒绝。
3. 三引擎真实模型流程：新草稿/首次发送/恢复/重启的 cwd，MCP 注入可见性和工具调用、宿主审批、配置版本变化和 session 撤销。
4. macOS/Linux 实机及安装包；真实 Next.js、npm/yarn/bun 多包管理器测试，尤其 POSIX 组清理与 GUI PATH。
5. 500 应用搜索延迟、50,000 行日志压力和聊天响应隔离的机器/样本实测；键盘、焦点、读屏与减少动效检查。
6. 磁盘写失败、配置损坏修复、升级降级/会话未知字段的完整演练。错误不能显示成成功；原目录必须保留。

这些待验收项属于原计划的发布要求，不由已有类型检查、单元测试或其他平台成功结果替代。
