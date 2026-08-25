/**
 * Options 设置页：保存位置（子文件夹）、历史记录（保留条数）、
 * 截图参数（重叠比例/等待时长/输出格式）、高级（fixed/懒加载）。
 * 保存后写入 browser.storage.sync，后台即时生效。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_CONFIG, type CaptureConfig } from '@/types/config';
import type { OutputFormat } from '@/types/capture';
import type { PopupRequest, PopupResponse } from '@/types/messages';
import { sanitizeSubfolder } from '@/utils/naming';

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export default function App() {
  const [config, setConfig] = useState<CaptureConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await request<CaptureConfig>({ type: 'GET_CONFIG', payload: {} });
        setConfig(cfg);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  function patch(p: Partial<CaptureConfig>): void {
    setConfig((c) => ({ ...c, ...p }));
    setSaved(false);
  }

  async function save(): Promise<void> {
    setError(null);
    setSaved(false);
    try {
      // 提交前清洗子文件夹名与 clamp 历史条数，保证落库值合法
      const payload: CaptureConfig = {
        ...config,
        saveSubfolder: sanitizeSubfolder(config.saveSubfolder),
        historyLimit: clamp(config.historyLimit, 1, 200),
      };
      const next = await request<CaptureConfig>({
        type: 'SET_CONFIG',
        payload,
      });
      setConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="options-page">
      <h1>⚙️ 网页截图助手 · 设置</h1>

      <section>
        <h2>保存位置</h2>
        <Field label="默认保存目录（下载目录下的子文件夹名）">
          <input
            type="text"
            value={config.saveSubfolder}
            placeholder="网页截图"
            onChange={(e) => patch({ saveSubfolder: e.target.value })}
          />
        </Field>
        <p className="hint">
          扩展只能写入浏览器「下载」目录，此处填写其下子文件夹名；留空则直接存下载根目录。
        </p>
      </section>

      <section>
        <h2>历史记录</h2>
        <Field label="保留最近（1 ~ 200 条）">
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            value={config.historyLimit}
            onChange={(e) => patch({ historyLimit: toInt(e.target.value, 50) })}
          />
        </Field>
        <p className="hint">超过该条数时按最旧优先自动淘汰（含缩略图与原图）。</p>
      </section>

      <section>
        <h2>截图参数</h2>

        <Field label="重叠区比例（0 ~ 0.3，越大接缝越稳、分片越多）">
          <input
            type="number"
            min={0}
            max={0.3}
            step={0.05}
            value={config.overlapRatio}
            onChange={(e) => patch({ overlapRatio: clamp(parseFloat(e.target.value), 0, 0.3) })}
          />
        </Field>

        <Field label="网络空闲窗口（ms，判定页面加载完成的连续无活动时长）">
          <input
            type="number"
            min={100}
            step={100}
            value={config.networkIdleMs}
            onChange={(e) => patch({ networkIdleMs: toInt(e.target.value, 500) })}
          />
        </Field>

        <Field label="稳定延时（ms，空闲后追加的固定等待兜底）">
          <input
            type="number"
            min={0}
            step={100}
            value={config.stableWaitMs}
            onChange={(e) => patch({ stableWaitMs: toInt(e.target.value, 800) })}
          />
        </Field>

        <Field label="最大等待（ms，单页等待总上限）">
          <input
            type="number"
            min={1000}
            step={500}
            value={config.maxWaitMs}
            onChange={(e) => patch({ maxWaitMs: toInt(e.target.value, 15000) })}
          />
        </Field>

        <Field label="输出格式">
          <select
            value={config.format}
            onChange={(e) => patch({ format: e.target.value as OutputFormat })}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </select>
        </Field>

        {config.format === 'jpeg' && (
          <Field label="JPEG 质量（0 ~ 1）">
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={config.quality}
              onChange={(e) => patch({ quality: clamp(parseFloat(e.target.value), 0, 1) })}
            />
          </Field>
        )}
      </section>

      <section>
        <h2>高级</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={config.handleFixed}
            onChange={(e) => patch({ handleFixed: e.target.checked })}
          />
          处理固定元素（fixed/sticky 只出现一次）
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={config.triggerLazyLoad}
            onChange={(e) => patch({ triggerLazyLoad: e.target.checked })}
          />
          触发懒加载（滚动前预加载图片）
        </label>
      </section>

      <div className="actions">
        <button className="primary" onClick={() => void save()}>
          保存
        </button>
        {saved && <span className="saved">✓ 已保存</span>}
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toInt(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}
