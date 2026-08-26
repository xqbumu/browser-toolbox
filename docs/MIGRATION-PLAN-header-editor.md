# HeaderEditor 功能迁移计划

> 参照项目：FirefoxBar/HeaderEditor。目标：将其成熟功能迁移进本工具箱的「请求头改写」工具，
> 并保持 **Chrome(DNR) / Firefox(MV2) / Safari(DNR)** 三端行为最大一致。
> 明确排除：云同步（用户要求）。响应体改写因 Chrome/Safari 无对应 API，暂不纳入（见附录）。

## 现状基线（已具备）

- 头部改写：请求/响应 × set/remove/append，双引擎
- URL 条件组：多条、独立方式（pattern/contains/regex），OR 语义
- method/resourceTypes 过滤（双端严格语义一致）
- 全局总开关 + rail 状态点；规则独立启停；备注字段
- popup 内全量 CRUD + 命中置顶视图；options 完整管理页
- 导入导出 JSON（三代形态自动迁移 + 逐条校验）

---

## Phase 1 分组管理（Groups）—— 高价值

**模型**
```ts
interface HeaderGroup { id: string; name: string; enabled: boolean; createdAt: number }
HeaderRule.groupId?: string   // 缺省 = 「未分组」（隐式、恒启用）
```
**存储**：`storage.local` 新增键 `headerGroups`；`migrateHeaderRule` 不动分组（groupId 直通）
**引擎**：sync 时过滤 `group.enabled === false` 的成员（等价总开关的空集路径）
**UI**
- options：分组侧栏/分段；组头行（启停 Switch、重命名、删除→成员归未分组）
- 编辑器：所属分组下拉（可留空=未分组）
- popup 行：组名 Tag 徽标；组停用时整组行降透明
**消息**：GROUPS_LIST / GROUPS_SAVE / GROUPS_DELETE / GROUPS_TOGGLE
**测试**：组级联停用→引擎空集；删除组→成员保留；迁移直通

## Phase 2 排除域名（Excludes）—— 中价值

**范围收敛**：本轮仅做 **排除域名列表**（双端可一致表达），regex/方法级排除延后
**模型**：`condition.excludeDomains?: string[]`
**引擎**
- DNR：`condition.excludedRequestDomains`（原生支持，需去 `*.` 前缀后取 registrable 域，逐条展开）
- MV2：`resolveBeforeRequest` 与 header 谓词前先做 hostname 后缀匹配，命中即跳过
**UI**：编辑器条件区新增折叠块「排除域名（可选）」，多行文本（每行一域，支持 `*.example.com` 通配写法→存储时拆分为裸域+通配标记）
**测试**：DNL 展开包含 excludedRequestDomains；MV2 域名命中即不改写；通配拆分正确性

## Phase 3 ModHeader 导入兼容 —— 中价值

**输入**：ModHeader 导出 JSON（`profiles[].headers[]`，字段 urlPattern/enabled/requestHeaders…按其公开格式）
**映射**
- 每个 profile → 一条规则（name=profile 名；enabled 继承）
- headers[].type(set/remove/append)+urlPattern → matches:[{pattern,value:urlPattern}] + actions[]
- responseHeaders 同理拆分 target
**UI**：导入面板新增来源单选「工具箱 JSON / ModHeader」
**测试**：样例 JSON 固定快照 → 断言生成规则数与关键字段

## Phase 4 规则排序 —— 低价值

**模型**：`HeaderRule.order?: number`（缺省按 updatedAt）
**引擎**：DNR `priority` 按 order 映射（1..1000），解决同头冲突的确定性
**UI**：options 列表 ↑↓ 按钮（popup 窄面板不做拖拽，保持简单）
**测试**：同头两规则按 order 决定最终值（DNR priority 数值大者生效→priority = 1000-order）

## Phase 5 暗色模式 —— 低价值

- TDesign `theme-mode` 切换 + `prefers-color-scheme` 跟随；设置项存 storage.sync
- 各页面硬编码色替换为 `--td-*` 令牌（本轮 UI 已基本令牌化，剩余少量）

---

## 附录：明确不做 / 暂缓

| 项 | 原因 |
|---|---|
| 云同步 | 用户明确排除 |
| modifyReceiveBody | 仅 Firefox filterResponseData 可行；三端无法一致，暂缓 |
| excludeRegex/excludeMethod | RE2/DNR 无法原生表达，待专项设计 |
| 函数型规则(isFunction/code) | 安全面大（需注入执行），不在迁移范围 |

## 执行约定

- 每阶段独立提交；完成后跑 tsc/vitest/build×2/dev 冒烟
- 存储变更必须经 migrateHeaderRule/store 迁移路径并补测试
