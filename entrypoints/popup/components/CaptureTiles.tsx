/**
 * 截图动作磁贴（直按式）：三种模式各一个等宽磁贴，点击立即执行。
 * 取消「先选模式再点执行」的两步交互；忙碌时对应磁贴展示进度文案。
 */
import { Button, Loading, Tag } from "tdesign-react";
import type { CaptureMode } from "@/types/capture";
import type { ProgressEvent } from "@/types/messages";

interface ModeAvailability {
  visible: boolean;
  area: boolean;
  fullpage: boolean;
}

interface Props {
  availability: ModeAvailability;
  /** 正在执行的截图模式（用于磁贴 loading 态），空闲为 null */
  pending: CaptureMode | null;
  /** 忙碌时磁贴内的进度文案 */
  progressLabel: string;
  onStart: (mode: CaptureMode) => void;
}

const TILES: {
  mode: CaptureMode;
  label: string;
  title: string;
  recommend?: boolean;
}[] = [
  { mode: "visible", label: "可见区域", title: "截取当前可见区域" },
  { mode: "area", label: "选区", title: "关闭弹窗，拖拽框选区域" },
  { mode: "fullpage", label: "整页", title: "整页滚动长图", recommend: true },
];

export function CaptureTiles({
  availability,
  pending,
  progressLabel,
  onStart,
}: Props) {
  return (
    <div className="capture-tiles">
      {TILES.map((tile) => {
        const disabled =
          !availability[tile.mode] ||
          (pending != null && pending !== tile.mode);
        const isPending = pending === tile.mode;
        return (
          <Button
            key={tile.mode}
            className="capture-tile"
            variant="outline"
            disabled={disabled}
            title={tile.title}
            onClick={() => onStart(tile.mode)}
          >
            {isPending ? (
              <Loading loading size="small" text={progressLabel} />
            ) : (
              <>
                <span className="capture-tile-label">
                  {tile.label}
                  {tile.recommend && (
                    <Tag size="small" theme="primary" variant="light">
                      荐
                    </Tag>
                  )}
                </span>
                <span className="capture-tile-desc">
                  {tile.mode === "visible" && "当前视口"}
                  {tile.mode === "area" && "拖拽框选"}
                  {tile.mode === "fullpage" && "滚动长图"}
                </span>
              </>
            )}
          </Button>
        );
      })}
    </div>
  );
}
