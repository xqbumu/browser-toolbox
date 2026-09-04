/**
 * 请求头管理中心（独立标签页，仿截图历史模块）：
 * - 规则管理：分组侧栏（创建 / 重命名 / 删除 / 组开关 / 按组批量启停成员）
 *   + 规则列表（搜索过滤、行内启停、编辑、上下移、会话级临时覆盖、删除）；
 * - 运行日志：改写成功日志 + 按条数 / 按天自动清理设置；
 * - 统计：总量 / 今日 / 近 7 天 / 按分组 / 按日 / 按方向。
 * 写操作统一走 background 消息（引擎即时重建）；总开关直写 storage（后台兜底监听）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, MessagePlugin, Switch, Tabs } from "tdesign-react";
import { FilterIcon } from "tdesign-icons-react";
import {
  describeActions,
  describeCondition,
  newHeaderGroup,
  newHeaderRule,
  type HeaderGroup,
  type HeaderRule,
} from "@/types/headers";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { HeaderRuleEditor } from "@/ui/HeaderRuleEditor";
import { HeaderImportExport } from "@/ui/HeaderImportExport";
import { ConfirmDialog, EmptyState } from "@/ui/kit";
import { ThemeToggle } from "@/ui/theme-toggle";
import { detectHeaderEngine } from "@/core/headers/engine";
import { collectLearnedHeaderNames } from "@/utils/header-hints";
import { genId } from "@/utils/helpers";
import {
  isHeaderMasterEnabled,
  setHeaderMasterEnabled,
} from "@/utils/header-rules-store";
import { LogsPane } from "./components/LogsPane";
import { StatsPane } from "./components/StatsPane";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** 列表选区：全部 / 未分组 / 指定分组 */
type Segment =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "group"; id: string };

const segmentLabel = (seg: Segment, groups: HeaderGroup[]): string => {
  if (seg.kind === "all") return "全部规则";
  if (seg.kind === "none") return "未分组";
  return groups.find((g) => g.id === seg.id)?.name ?? "分组";
};

/** 规则所属分组是否停用（未分组恒视为启用）。组开关是最高优先级：组停用时成员/会话覆盖均不生效 */
function isGroupOff(rule: HeaderRule, groups: HeaderGroup[]): boolean {
  return (
    rule.groupId != null &&
    !groups.find((g) => g.id === rule.groupId)?.enabled
  );
}

export default function App(): React.ReactNode {
  const [rules, setRules] = useState<HeaderRule[]>([]);
  const [groups, setGroups] = useState<HeaderGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [masterOn, setMasterOn] = useState(true);
  const [sessionOv, setSessionOv] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState("rules");
  const [seg, setSeg] = useState<Segment>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<HeaderRule | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
    null,
  );
  const [newGroupName, setNewGroupName] = useState("");
  // 重命名 Esc 取消防护：Esc 卸载输入框时若浏览器补发 blur，会误触发 onBlur 提交；
  // 置位后由 onBlur 消费并复位；新一轮重命名打开时再次复位，避免误吞后续点击失焦提交。
  const renameCancelled = useRef(false);

  const engineKind = detectHeaderEngine();
  const engineAvailable = engineKind != null;
  const dnrLimited = engineKind === "dnr";
  // 日志观测能力：MV2 阻塞路径恒可记；MV3 DNR 需浏览器提供只读 webRequest（Chrome 有、Safari 无）
  const logCapable = useMemo(() => {
    if (engineKind === "webrequest") return true;
    if (engineKind !== "dnr") return false;
    const wr = (browser as unknown as {
      webRequest?: { onBeforeSendHeaders?: { addListener?: unknown } };
    }).webRequest;
    return typeof wr?.onBeforeSendHeaders?.addListener === "function";
  }, [engineKind]);

  async function reload(): Promise<void> {
    try {
      setRules(
        await request<HeaderRule[]>({ type: "HEADERS_LIST", payload: {} }),
      );
    } catch {
      // 保持旧列表
    }
  }

  async function reloadGroups(): Promise<void> {
    try {
      setGroups(
        await request<HeaderGroup[]>({ type: "GROUPS_LIST", payload: {} }),
      );
    } catch {
      // 保持旧列表
    }
  }

  async function reloadAll(): Promise<void> {
    await Promise.all([reload(), reloadGroups()]);
  }

  useEffect(() => {
    void (async () => {
      try {
        await reloadAll();
        setMasterOn(await isHeaderMasterEnabled().catch(() => true));
        setSessionOv(
          await request<Record<string, boolean>>({
            type: "HEADERS_SESSION_LIST",
          }).catch(() => ({})),
        );
      } finally {
        // 任何一步失败都不允许首屏卡在「加载中…」
        setLoaded(true);
      }
    })();
    // 其它入口（popup / options）写库后，本页就近实时刷新
    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ): void => {
      if (area !== "local") return;
      if (["headerRules", "headerGroups", "headerEnabled"].some((k) => changes[k])) {
        void reloadAll();
        void isHeaderMasterEnabled().then(setMasterOn).catch(() => {});
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  function flash(text: string): void {
    void MessagePlugin.success({ content: text, duration: 2000 });
  }

  async function toggleMaster(on: boolean): Promise<void> {
    const prev = masterOn;
    setMasterOn(on);
    try {
      await setHeaderMasterEnabled(on);
    } catch {
      setMasterOn(prev);
    }
  }

  async function toggleRule(id: string, enabled: boolean): Promise<void> {
    // 组停用 = 整组暂停（组开关最高优先级）：仅拦截「启用」方向，避免 UI 显示生效而实际无效
    const rule = rules.find((r) => r.id === id);
    if (rule && enabled && isGroupOff(rule, groups)) {
      void MessagePlugin.warning({
        content: "分组已停用，组内规则暂不生效——请先开启分组",
        duration: 2500,
      });
      return;
    }
    const prev = rules;
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      await request({ type: "HEADERS_TOGGLE", payload: { id, enabled } });
    } catch {
      setRules(prev);
    }
  }

  async function toggleSession(id: string): Promise<void> {
    const rule = rules.find((r) => r.id === id);
    const has = id in sessionOv;
    const nextOv = has ? null : !rule?.enabled;
    // 「强制启用」方向受组开关约束：组停用时先提示开启分组
    if (rule && nextOv === true && isGroupOff(rule, groups)) {
      void MessagePlugin.warning({
        content: "分组已停用，会话覆盖不会生效——请先开启分组",
        duration: 2500,
      });
      return;
    }
    const prev = sessionOv;
    setSessionOv((m) => {
      const copy = { ...m };
      if (nextOv === null) delete copy[id];
      else copy[id] = nextOv;
      return copy;
    });
    try {
      await request({
        type: "HEADERS_SESSION_OVERRIDE",
        payload: { id, enabled: nextOv },
      });
    } catch {
      setSessionOv(prev);
    }
  }

  async function moveRule(id: string, dir: "up" | "down"): Promise<void> {
    const sorted = [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const i = sorted.findIndex((r) => r.id === id);
    const j = i + (dir === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const a = sorted[i]!;
    const b = sorted[j]!;
    const ao = a.order ?? 0;
    const bo = b.order ?? 0;
    try {
      await request({ type: "HEADERS_SAVE", payload: { rule: { ...a, order: bo } } });
      await request({ type: "HEADERS_SAVE", payload: { rule: { ...b, order: ao } } });
      await reload();
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  async function removeRule(id: string): Promise<void> {
    await request({ type: "HEADERS_DELETE", payload: { id } }).catch(() => {});
    setDeleteId(null);
    await reload();
  }

  async function save(): Promise<void> {
    if (!editing) return;
    try {
      await request({ type: "HEADERS_SAVE", payload: { rule: editing } });
      setEditing(null);
      await reload();
      flash("已保存并生效");
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  async function createGroup(): Promise<void> {
    const name = newGroupName.trim();
    if (!name) return;
    await request({
      type: "GROUPS_SAVE",
      payload: { group: { ...newHeaderGroup(), id: genId(), name } },
    });
    setNewGroupName("");
    await reloadGroups();
  }

  async function renameGroupCommit(): Promise<void> {
    if (!renaming) return;
    const id = renaming.id;
    const name = renaming.value.trim();
    const group = groups.find((g) => g.id === id);
    if (group && name && name !== group.name) {
      await request({
        type: "GROUPS_SAVE",
        payload: { group: { ...group, name } },
      }).catch(() => {});
      await reloadGroups();
    }
    setRenaming(null);
  }

  async function toggleGroup(id: string, enabled: boolean): Promise<void> {
    await request({ type: "GROUPS_TOGGLE", payload: { id, enabled } }).catch(
      () => {},
    );
    await reloadGroups();
  }

  async function removeGroup(id: string): Promise<void> {
    await request({ type: "GROUPS_DELETE", payload: { id } }).catch(() => {});
    setDeleteGroupId(null);
    if (seg.kind === "group" && seg.id === id) setSeg({ kind: "all" });
    await reloadAll();
  }

  /** 按组批量启停成员（'' = 未分组）；返回实际变更数 */
  async function batchSetRules(
    groupId: string | undefined,
    enabled: boolean,
  ): Promise<void> {
    try {
      // 停用组内「启用全部」会连带开启组开关（见 background GROUPS_SET_RULES），提前提示
      const groupOff =
        enabled && groupId !== undefined
          ? !groups.find((g) => g.id === groupId)?.enabled
          : false;
      const { updated } = await request<{ updated: number }>({
        type: "GROUPS_SET_RULES",
        payload: { groupId: groupId ?? "", enabled },
      });
      flash(
        `已${enabled ? "启用" : "停用"} ${updated} 条规则${groupOff ? "（分组已连带开启）" : ""}`,
      );
      await reloadAll();
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  const shownRules = useMemo(() => {
    const inSeg = rules.filter((r) => {
      if (seg.kind === "all") return true;
      if (seg.kind === "none") return r.groupId == null;
      return r.groupId === seg.id;
    });
    const q = query.trim().toLowerCase();
    if (!q) return inSeg;
    return inSeg.filter(
      (r) =>
        (r.name || "").toLowerCase().includes(q) ||
        describeCondition(r.condition).toLowerCase().includes(q) ||
        describeActions(r).toLowerCase().includes(q),
    );
  }, [rules, seg, query]);

  const counts = useMemo(() => {
    const groupCount = new Map<string, number>();
    let noneCount = 0;
    for (const r of rules) {
      if (r.groupId == null) noneCount += 1;
      else groupCount.set(r.groupId, (groupCount.get(r.groupId) ?? 0) + 1);
    }
    return { noneCount, groupCount };
  }, [rules]);

  const isNone = seg.kind === "none";
  const isGroup = seg.kind === "group";

  return (
    <div className="hm-page">
      <header className="page-head">
        <h1>
          请求头管理中心
          {rules.length > 0 && <span className="count-tag">{rules.length} 条规则</span>}
          {engineKind && <span className="hm-engine-tag">{engineKind}</span>}
        </h1>
        <div className="page-actions">
          <label className="hm-master">
            <Switch
              size="small"
              value={masterOn}
              onChange={(v) => void toggleMaster(Boolean(v))}
            />
            <span className={masterOn ? "" : "off"}>改写总开关</span>
          </label>
          <ThemeToggle />
        </div>
      </header>

      {!engineAvailable && (
        <Alert
          theme="warning"
          message="当前浏览器不支持请求头改写（需要 declarativeNetRequest 或阻塞式 webRequest）。规则可管理，但不会生效。"
        />
      )}

      <Tabs value={tab} onChange={(v) => setTab(String(v ?? "rules"))}>
        <Tabs.TabPanel value="rules" label={`规则（${rules.length}）`}>
          {editing ? (
            <div className="hm-editor-card">
              <HeaderRuleEditor
                draft={editing}
                groups={groups}
                learnedNames={collectLearnedHeaderNames(rules)}
                onChange={setEditing}
                onSave={save}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : (
            <div className="hm-work">
              <aside className="hm-side">
                <div className="hm-side-title">分组</div>
                <button
                  type="button"
                  className={`hm-seg${seg.kind === "all" ? " active" : ""}`}
                  onClick={() => setSeg({ kind: "all" })}
                >
                  <span>全部规则</span>
                  <span className="hm-count">{rules.length}</span>
                </button>
                <button
                  type="button"
                  className={`hm-seg${isNone ? " active" : ""}`}
                  onClick={() => setSeg({ kind: "none" })}
                >
                  <span>未分组</span>
                  <span className="hm-count">{counts.noneCount}</span>
                </button>

                <div className="hm-group-zone">
                  {groups.map((g) => {
                    const active = isGroup && seg.id === g.id;
                    const renamingThis = renaming?.id === g.id;
                    return (
                      <div
                        key={g.id}
                        className={`hm-seg hm-seg-group${active ? " active" : ""}${g.enabled ? "" : " off"}`}
                      >
                        <Switch
                          size="small"
                          value={g.enabled}
                          onChange={(v) => void toggleGroup(g.id, Boolean(v))}
                        />
                        {renamingThis ? (
                          <input
                            className="hm-seg-rename"
                            autoFocus
                            value={renaming?.value ?? g.name}
                            onChange={(e) =>
                              setRenaming({ id: g.id, value: e.target.value })
                            }
                            onBlur={() => {
                              // Esc 取消失效防护：卸载补发的 blur 不应反向提交
                              if (renameCancelled.current) {
                                renameCancelled.current = false;
                                return;
                              }
                              void renameGroupCommit();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void renameGroupCommit();
                              if (e.key === "Escape") {
                                renameCancelled.current = true;
                                setRenaming(null);
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="hm-seg-name"
                            title={g.enabled ? "重命名分组" : "分组已停用（组内规则不生效）"}
                            onClick={() => {
                              renameCancelled.current = false;
                              setSeg({ kind: "group", id: g.id });
                              setRenaming({ id: g.id, value: g.name });
                            }}
                          >
                            <span className="hm-seg-text">{g.name}</span>
                            <span className="hm-count">
                              {counts.groupCount.get(g.id) ?? 0}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="hm-icon-btn danger"
                          title="删除分组（组内规则归未分组）"
                          onClick={() => setDeleteGroupId(g.id)}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  {groups.length === 0 && (
                    <p className="hint hm-side-hint">
                      暂无分组；规则默认归「未分组」
                    </p>
                  )}
                </div>

                <form
                  className="hm-group-create"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createGroup();
                  }}
                >
                  <input
                    className="hm-group-input"
                    placeholder="新分组名称"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                  <Button type="submit" size="small" disabled={!newGroupName.trim()}>
                    添加
                  </Button>
                </form>
                <p className="hint hm-side-hint">
                  组开关 = 整组暂停；点组名可重命名。删除组后成员归「未分组」。
                </p>
              </aside>

              <section className="hm-main">
                <div className="hm-toolbar">
                  <Input
                    placeholder="搜索规则名 / 条件 / 动作"
                    clearable
                    size="small"
                    style={{ width: 240 }}
                    value={query}
                    onChange={(v) => setQuery(String(v ?? ""))}
                  />
                  <div className="hm-seg-info">
                    <strong>{segmentLabel(seg, groups)}</strong>
                    <span className="muted">
                      · {shownRules.length} 条
                      {isGroup &&
                        !(groups.find((g) => g.id === seg.id)?.enabled) && (
                          <span className="badge warn">分组已停用</span>
                        )}
                    </span>
                  </div>
                  <div className="hm-toolbar-actions">
                    {(isNone || isGroup) && (
                      <>
                        <Button
                          size="small"
                          variant="outline"
                          disabled={shownRules.length === 0}
                          onClick={() =>
                            void batchSetRules(
                              isGroup ? seg.id : undefined,
                              true,
                            )
                          }
                        >
                          启用本组全部
                        </Button>
                        <Button
                          size="small"
                          variant="outline"
                          theme="danger"
                          disabled={shownRules.length === 0}
                          onClick={() =>
                            void batchSetRules(
                              isGroup ? seg.id : undefined,
                              false,
                            )
                          }
                        >
                          停用本组全部
                        </Button>
                      </>
                    )}
                    <HeaderImportExport rules={rules} onImported={reload} />
                    <Button
                      theme="primary"
                      size="small"
                      onClick={() => {
                        setEditing({ ...newHeaderRule(), id: genId() });
                      }}
                    >
                      ＋ 新建规则
                    </Button>
                  </div>
                </div>

                {!loaded && <p className="muted">加载中…</p>}

                {loaded && shownRules.length === 0 && (
                  <EmptyState
                    icon={<FilterIcon />}
                    title={rules.length === 0 ? "还没有请求头规则" : "没有匹配的规则"}
                    hint={
                      rules.length === 0
                        ? "点击右上角「新建规则」创建第一条"
                        : "试试调整搜索词或切换分组"
                    }
                  />
                )}

                <div className="hm-rule-list">
                  {shownRules.map((rule) => {
                    const group = groups.find((g) => g.id === rule.groupId);
                    const groupOff = rule.groupId != null && !group?.enabled;
                    const effective =
                      rule.id in sessionOv ? sessionOv[rule.id]! : rule.enabled;
                    const regexLimited =
                      dnrLimited &&
                      ((rule.condition.excludeRegex ?? []).some((p) => p.trim()) ||
                        rule.kind === "body");
                    return (
                      <div
                        key={rule.id}
                        className={`rule-row${effective ? "" : " disabled"}${groupOff ? " group-off" : ""}`}
                      >
                        <Switch
                          size="small"
                          value={rule.enabled}
                          onChange={(v) => void toggleRule(rule.id, Boolean(v))}
                        />
                        <button
                          type="button"
                          className="rule-meta as-button"
                          onClick={() => setEditing(structuredClone(rule))}
                        >
                          <span className="rule-name">
                            {group && <span className="badge group">{group.name}</span>}
                            {regexLimited && <span className="badge warn">仅Firefox</span>}
                            {rule.id in sessionOv && <span className="badge session">临时</span>}
                            {groupOff && <span className="badge warn">组已停用</span>}
                            {rule.name || "未命名规则"}
                          </span>
                          <span className="rule-sub">
                            {describeCondition(rule.condition)} · {describeActions(rule)}
                          </span>
                        </button>
                        <div className="rule-ops hm-rule-ops">
                          <button
                            className="hm-icon-btn"
                            title="上移（同头冲突时后应用者生效）"
                            onClick={() => void moveRule(rule.id, "up")}
                          >
                            ↑
                          </button>
                          <button
                            className="hm-icon-btn"
                            title="下移"
                            onClick={() => void moveRule(rule.id, "down")}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="hm-session-btn"
                            title={
                              rule.id in sessionOv
                                ? "清除会话临时覆盖"
                                : "本次会话临时翻转启用状态"
                            }
                            onClick={() => void toggleSession(rule.id)}
                          >
                            ⚡
                          </button>
                          <button
                            type="button"
                            className="hm-text-btn"
                            onClick={() => setEditing(structuredClone(rule))}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="hm-text-btn danger"
                            onClick={() => setDeleteId(rule.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}
        </Tabs.TabPanel>

        <Tabs.TabPanel value="logs" label="运行日志">
          {tab === "logs" && (
            <LogsPane engineAvailable={engineAvailable} logCapable={logCapable} />
          )}
        </Tabs.TabPanel>

        <Tabs.TabPanel value="stats" label="统计">
          {tab === "stats" && (
            <StatsPane engineAvailable={engineAvailable} logCapable={logCapable} />
          )}
        </Tabs.TabPanel>
      </Tabs>

      <ConfirmDialog
        open={deleteId != null}
        header="删除规则"
        body={`确定删除规则「${rules.find((r) => r.id === deleteId)?.name || "未命名"}」？`}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleteId) void removeRule(deleteId);
        }}
        onClose={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={deleteGroupId != null}
        header="删除分组"
        body={`删除「${groups.find((g) => g.id === deleteGroupId)?.name ?? ""}」后，组内规则将归为「未分组」（规则不会被删除）。确认？`}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleteGroupId) void removeGroup(deleteGroupId);
        }}
        onClose={() => setDeleteGroupId(null)}
      />
    </div>
  );
}
