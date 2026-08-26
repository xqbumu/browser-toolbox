/**
 * 截图工具设置视图（popup 内）：保存位置 / 历史条数 / 截图参数 / 高级开关。
 * 自 options 页迁移至此，跟随工具上下文；读写走 GET_CONFIG / SET_CONFIG。
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  MessagePlugin,
  Select,
} from "tdesign-react";
import { DEFAULT_CONFIG, type CaptureConfig } from "@/types/config";
import type { OutputFormat } from "@/types/capture";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { sanitizeSubfolder } from "@/utils/naming";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function ScreenshotSettings(): ReactNode {
  const [config, setConfig] = useState<CaptureConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(
          await request<CaptureConfig>({ type: "GET_CONFIG", payload: {} }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  function patch(p: Partial<CaptureConfig>): void {
    setConfig((c) => ({ ...c, ...p }));
  }

  async function save(): Promise<void> {
    setError(null);
    try {
      // 提交前清洗子文件夹名与 clamp 历史条数，保证落库值合法
      const payload: CaptureConfig = {
        ...config,
        saveSubfolder: sanitizeSubfolder(config.saveSubfolder),
        historyLimit: clamp(config.historyLimit, 1, 200),
      };
      setConfig(await request<CaptureConfig>({ type: "SET_CONFIG", payload }));
      void MessagePlugin.success({ content: "已保存", duration: 2000 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="settings-view">
      <div className="rule-editor">
        <h3>保存位置</h3>
        <label className="field">
          <span className="field-label">
            默认保存目录（下载目录下的子文件夹名）
          </span>
          <Input
            value={config.saveSubfolder}
            placeholder="网页截图"
            onChange={(v) => patch({ saveSubfolder: String(v ?? "") })}
          />
          <span className="hint">
            扩展只能写入浏览器「下载」目录，此处填写其下子文件夹名；留空则直接存下载根目录。
          </span>
        </label>
      </div>

      <div className="rule-editor">
        <h3>历史记录</h3>
        <label className="field">
          <span className="field-label">保留最近（1 ~ 200 条）</span>
          <InputNumber
            min={1}
            max={200}
            step={1}
            theme="column"
            value={config.historyLimit}
            onChange={(v) =>
              patch({ historyLimit: toNumber(String(v ?? "50"), 50) })
            }
          />
          <span className="hint">
            超过该条数时按最旧优先自动淘汰（含缩略图与原图）。
          </span>
        </label>
      </div>

      <div className="rule-editor">
        <h3>截图参数</h3>
        <label className="field">
          <span className="field-label">
            重叠区比例（0 ~ 0.3，越大接缝越稳、分片越多）
          </span>
          <InputNumber
            min={0}
            max={0.3}
            step={0.05}
            theme="column"
            value={config.overlapRatio}
            onChange={(v) =>
              patch({ overlapRatio: toNumber(String(v ?? "0.05"), 0.05) })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">网络空闲窗口（ms）</span>
          <InputNumber
            min={100}
            step={100}
            theme="column"
            value={config.networkIdleMs}
            onChange={(v) =>
              patch({ networkIdleMs: toNumber(String(v ?? "500"), 500) })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">稳定延时（ms）</span>
          <InputNumber
            min={0}
            step={100}
            theme="column"
            value={config.stableWaitMs}
            onChange={(v) =>
              patch({ stableWaitMs: toNumber(String(v ?? "800"), 800) })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">最大等待（ms）</span>
          <InputNumber
            min={1000}
            step={500}
            theme="column"
            value={config.maxWaitMs}
            onChange={(v) =>
              patch({ maxWaitMs: toNumber(String(v ?? "15000"), 15000) })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">输出格式</span>
          <Select
            value={config.format}
            options={[
              { value: "png", label: "PNG" },
              { value: "jpeg", label: "JPEG" },
            ]}
            onChange={(v) => patch({ format: v as OutputFormat })}
          />
        </label>
        {config.format === "jpeg" && (
          <label className="field">
            <span className="field-label">JPEG 质量（0 ~ 1）</span>
            <InputNumber
              min={0}
              max={1}
              step={0.01}
              theme="column"
              value={config.quality}
              onChange={(v) =>
                patch({ quality: toNumber(String(v ?? "1"), 1) })
              }
            />
          </label>
        )}
      </div>

      <div className="rule-editor">
        <h3>高级</h3>
        <Checkbox
          checked={config.handleFixed}
          onChange={(v) => patch({ handleFixed: Boolean(v) })}
        >
          处理固定元素（fixed/sticky 只出现一次）
        </Checkbox>
        <Checkbox
          checked={config.triggerLazyLoad}
          onChange={(v) => patch({ triggerLazyLoad: Boolean(v) })}
        >
          触发懒加载（滚动前预加载图片）
        </Checkbox>
      </div>

      {error && <Alert theme="error" message={error} />}

      <Button block theme="primary" onClick={() => void save()}>
        保存
      </Button>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toNumber(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}
