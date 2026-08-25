/**
 * 三种截图模式横向分段控件（可见区域 / 选区 / 整页）。
 * 依据浏览器能力禁用对应模式入口；当前选中高亮。
 */
import type { CaptureMode } from '@/types/capture';

interface ModeAvailability {
  visible: boolean;
  area: boolean;
  fullpage: boolean;
}

interface Props {
  value: CaptureMode;
  availability: ModeAvailability;
  onChange: (mode: CaptureMode) => void;
}

const OPTIONS: { value: CaptureMode; label: string; title: string; recommend?: boolean }[] = [
  { value: 'visible', label: '可见区域', title: '截取当前可见区域' },
  { value: 'area', label: '选区', title: '拖拽框选区域' },
  { value: 'fullpage', label: '整页', title: '整页滚动截图', recommend: true },
];

export function ModeSelector({ value, availability, onChange }: Props) {
  return (
    <div className="mode-segment" role="group" aria-label="截图模式">
      {OPTIONS.map((o) => {
        const disabled = !availability[o.value];
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={`mode-segment-btn${active ? ' active' : ''}`}
            disabled={disabled}
            aria-pressed={active}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {o.label}
            {o.recommend && <span className="mode-recommend">荐</span>}
          </button>
        );
      })}
    </div>
  );
}
