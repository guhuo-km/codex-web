# 防御性编程收敛重构计划

> 状态：已实施并通过验证  
> 项目：codex-web  
> 原则：低耦合，高内聚。本项目是本地局域网服务，核心依赖缺失或核心接口失败时应显式暴露，不需要为了外部攻击面做过度隐藏。

## 目标

收敛当前代码里“失败后伪装成空数据”与“缺字段后伪造数据”的逻辑。保留已经由实际问题证明必要的 UI 竞态补丁和 Codex app-server 多版本结构兼容。

## 非目标

- 不重做 `ChatPane` 的用户滚动意图补丁。
- 不删除 Codex app-server 历史/事件多结构兼容。
- 不新增复杂权限/安全防护。本项目按本地局域网工具处理。
- 不主动调整 UI 产品方案。

## 保留项

1. `ChatPane` 的用户滚动意图判断。
   - 原因：已经定位过程序滚动会误触发“加载更早对话”，这是必要补丁。

2. `ChatPane` 的双帧滚动到底部和延迟补偿。
   - 原因：Markdown、代码块、工具调用展开会造成晚布局，当前补丁解决真实 UI 竞态。
   - 后续可重构方向：用底部锚点 + ResizeObserver 取代经验延迟。

3. `api.ts` 中非 JSON HTTP 响应的解析兜底。
   - 原因：HTTP 错误可能没有 JSON body，这是合理的 API client 防御。

4. `thread-history.ts` 中对 Codex 多种历史结构的兼容。
   - 原因：Codex app-server / 本地历史 / 事件流结构存在版本差异。
   - 后续可重构方向：集中到 normalizer 层，而不是散落在 UI 和历史解析中。

## 重构项

### 1. 前端接口失败不再静默变空数据

涉及文件：

- `web/src/App.tsx`
- `web/src/components/Composer.tsx`

当前问题：

- `api.threads().catch(() => [])` 会把会话接口失败伪装成“没有会话”。
- `api.models().catch(() => setModels([]))` 会把模型接口失败伪装成“没有模型”。

计划：

1. 增加轻量错误状态，例如 `threadLoadError`、`modelLoadError`。
2. 接口失败时保留错误状态，不覆盖为正常空数据。
3. UI 只显示自然的失败/重试状态，不出现开发者占位文案。
4. 刷新成功后清理错误状态。

验证：

- 模拟 `/api/threads` 失败时，不应显示成“暂无会话”。
- 模拟 `/api/models` 失败时，模型菜单应显示加载失败或禁用态。

### 2. 历史消息时间戳不再使用 `Date.now()` 伪造

涉及文件：

- `web/src/thread-history.ts`
- `web/src/components/ChatPane.tsx`

当前问题：

- 历史消息缺少时间字段时会 fallback 到 `Date.now()`，导致刷新后用户消息时间变成刷新时间。

计划：

1. 调整历史解析时间优先级：
   - 消息自身时间
   - turn 开始/完成时间
   - 事件记录时间
   - 无时间
2. 缺时间时返回 `undefined` 或明确空值，不使用当前时间。
3. `ChatPane` 时间渲染支持缺失时间：不显示时间或显示低调的“未知时间”。

验证：

- 构造缺少消息时间的历史数据，刷新后时间不应变成当前时间。

### 3. 后端核心依赖去 optional 化

涉及文件：

- `src/http/routes.ts`
- 服务装配入口
- 相关测试 mock

当前问题：

- `deps.projects?.list() ?? []`
- `deps.themes?.list() ?? []`
- `deps.threadMetadata?.list()`

这些会把服务装配错误伪装成空数据。

计划：

1. 明确哪些依赖是核心依赖：
   - `projects`：核心
   - `themes`：当前 UI 已依赖，按核心处理
   - `threadMetadata`：置顶/排序依赖，按核心处理
2. 将 `RouteDeps` 对应字段改为必填。
3. 删除核心路由里的 `?.` 和 `?? []`。
4. 更新测试装配，缺 mock 就让测试失败。

验证：

- 缺核心依赖时服务启动/路由测试直接失败。
- 正常装配下项目、主题、会话排序接口仍通过。

### 4. 本地历史合并失败可见

涉及文件：

- `src/http/routes.ts`
- `src/codex/session-history.ts`

当前问题：

- `listLocalCodexThreads(...).catch(() => [])` 会隐藏本地历史读取失败。

计划：

1. 保留 app-server thread list 的主路径。
2. 本地历史读取失败时记录后端日志。
3. 如 API 结构允许，在返回数据中附带 warnings；如果不引入 API 结构变化，至少后端日志必须可见。

验证：

- 模拟本地历史读取失败时，接口仍可返回 app-server 数据，但日志中能看到失败原因。

### 5. Codex 事件兼容逻辑集中化

涉及文件：

- `web/src/App.tsx`
- `web/src/thread-history.ts`
- 可新增：`web/src/codex-normalizers.ts`

当前问题：

- tool call、raw response item、turn timing、token usage 解析在实时事件和历史恢复中重复。

计划：

1. 抽出纯函数：
   - `normalizeToolCall`
   - `normalizeRawToolCall`
   - `normalizeRawToolOutput`
   - `normalizeTurnTiming`
   - `normalizeTokenUsage`
2. `App.tsx` 和 `thread-history.ts` 只调用 normalizer，不各自散落 `typeof` / `??` / fallback。
3. normalizer 内保留兼容逻辑，并写单元测试覆盖常见 Codex item 形态。

验证：

- 实时事件工具调用仍显示。
- 历史恢复工具调用仍显示。
- fileChange、commandExecution、mcpToolCall、webSearch 基本形态都有测试。

## 执行顺序

1. 前端接口失败显式化。
2. 历史时间戳去伪造。
3. 后端核心依赖去 optional 化。
4. 本地历史合并失败可见。
5. Codex normalizer 集中化。
6. 全量验证。

## 验证命令

每个阶段至少运行：

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

涉及后端或共享类型时运行：

```powershell
npm test
```

本次验证结果：

- `npx tsc -p web/tsconfig.json` 通过。
- `npx tsc -p tsconfig.json --noEmit` 通过。
- `npx vitest run tests/thread-history.test.ts tests/http-routes.test.ts tests/approval-routes.test.ts` 通过，31 个测试通过。
- `npx vitest run tests/codex-normalizers.test.ts` 通过，3 个测试通过。
- `npm test` 通过，17 个测试文件、69 个测试通过。
- `npm run build:web` 通过。

## 浏览器排障规则

当需要使用浏览器自动化工具排障时：

1. 先定位代码路径和状态边界。
2. 在相关代码路径添加有边界的 console 日志或断点式日志。
3. 使用浏览器控制台消息验证状态变化顺序。
4. 不反复依赖页面快照和截图猜测原因。
5. 截图/快照只用于确认布局、可见文本和最终表现。
