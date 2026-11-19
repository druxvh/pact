/** The three small popovers of the studio: quick adjustments, camera settings and the keyboard shortcuts. */
import { Keyboard, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button, IconButton, Kbd, Popover, PopoverContent, PopoverTrigger, Segmented, Select, Slider, Switch } from '@/components/ui';
import type { ResolutionId } from '@/features/camera/constraints';
import { RESOLUTIONS } from '@/features/camera/constraints';
import { ADJUST_MAX, ADJUST_MIN, type Adjust, isNeutralAdjust, NEUTRAL_ADJUST } from '@/features/camera/filters';
import { StageButton } from '@/features/camera/parts';
import type { CameraDevice, CameraInfo } from '@/features/camera/useCameraStream';

function SliderRow({ label, value, display, children }: { label: string; value: number; display: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5" data-value={value}>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{display}</span>
      </div>
      {children}
    </div>
  );
}

/** Brightness, contrast and (when the camera can) zoom. */
export function AdjustPopover({
  adjust,
  onAdjust,
  info,
  onZoom,
}: {
  adjust: Adjust;
  onAdjust: (a: Adjust) => void;
  info: CameraInfo | null;
  onZoom: (v: number) => void;
}) {
  const zoom = info?.zoom ?? null;
  const changed = !isNeutralAdjust(adjust) || Boolean(zoom && info && info.zoomValue > zoom.min + zoom.step / 2);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <StageButton label="Adjust" changed={changed}>
            <SlidersHorizontal />
          </StageButton>
        }
      />
      <PopoverContent align="end" className="w-64 space-y-3.5 p-3.5">
        <SliderRow label="Brightness" value={adjust.brightness} display={`${adjust.brightness}%`}>
          <Slider
            aria-label="Brightness"
            min={ADJUST_MIN}
            max={ADJUST_MAX}
            step={1}
            value={adjust.brightness}
            onValueChange={(brightness) => onAdjust({ ...adjust, brightness })}
          />
        </SliderRow>
        <SliderRow label="Contrast" value={adjust.contrast} display={`${adjust.contrast}%`}>
          <Slider
            aria-label="Contrast"
            min={ADJUST_MIN}
            max={ADJUST_MAX}
            step={1}
            value={adjust.contrast}
            onValueChange={(contrast) => onAdjust({ ...adjust, contrast })}
          />
        </SliderRow>
        {zoom && info && (
          <SliderRow label="Zoom" value={info.zoomValue} display={`${info.zoomValue.toFixed(1)}×`}>
            <Slider aria-label="Zoom" min={zoom.min} max={zoom.max} step={zoom.step} value={info.zoomValue} onValueChange={onZoom} />
          </SliderRow>
        )}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={isNeutralAdjust(adjust) && !(zoom && info && info.zoomValue > zoom.min)}
            onClick={() => {
              onAdjust(NEUTRAL_ADJUST);
              if (zoom) onZoom(zoom.min);
            }}
          >
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Which camera, how sharp, and the shutter click. */
export function SettingsPopover({
  devices,
  info,
  deviceId,
  onDevice,
  resolution,
  onResolution,
  shutterSound,
  onShutterSound,
  soundsEnabled,
  disabled,
}: {
  devices: CameraDevice[];
  info: CameraInfo | null;
  deviceId: string | null;
  onDevice: (id: string) => void;
  resolution: ResolutionId;
  onResolution: (r: ResolutionId) => void;
  shutterSound: boolean;
  onShutterSound: (on: boolean) => void;
  /** Settings → Sounds is on (the camera's own switch does nothing while it's off). */
  soundsEnabled: boolean;
  /** Camera and resolution can't change mid-recording. */
  disabled: boolean;
}) {
  const options = RESOLUTIONS.filter((r) => !info || info.resolutions.includes(r.id)).map((r) => ({ value: r.id, label: r.label }));
  const current = info?.deviceId ?? deviceId ?? devices[0]?.deviceId ?? '';
  return (
    <Popover>
      <PopoverTrigger render={<IconButton label="Camera settings" />}>
        <Settings2 />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3.5 p-3.5">
        {devices.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium" id="camera-device-label">
              Camera
            </p>
            <Select
              aria-label="Camera"
              value={current}
              onValueChange={onDevice}
              options={devices.map((d) => ({ value: d.deviceId, label: d.label }))}
              className={disabled ? 'pointer-events-none opacity-50' : undefined}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">Resolution</p>
          <Segmented aria-label="Resolution" size="sm" fullWidth value={resolution} onValueChange={onResolution} options={options} disabled={disabled} />
          {info && info.width > 0 && (
            <p className="text-xs text-muted-foreground">
              Now at {info.width}×{info.height}. 1080p appears when your camera supports it.
            </p>
          )}
        </div>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>
            <span className="font-medium">Shutter sound</span>
            {!soundsEnabled && <span className="block text-xs text-muted-foreground">Sounds are off in Settings.</span>}
          </span>
          <Switch aria-label="Shutter sound" checked={shutterSound} onCheckedChange={onShutterSound} />
        </label>
        <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">Photos and videos stay on this device. Nothing is uploaded.</p>
      </PopoverContent>
    </Popover>
  );
}

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['Space / Enter', 'Take photo · start or stop recording'],
  ['P / V', 'Photo / video mode'],
  ['M', 'Mirror'],
  ['G', 'Grid'],
  ['T', 'Cycle self-timer'],
  ['A', 'Cycle aspect ratio'],
  ['1 – 8', 'Filters'],
  ['← / →', 'Previous / next in the viewer'],
  ['Esc', 'Cancel timer · close viewer · close'],
];

export function ShortcutsPopover() {
  return (
    <Popover>
      <PopoverTrigger render={<IconButton label="Keyboard shortcuts" className="hidden sm:inline-flex" />}>
        <Keyboard />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3.5">
        <p className="mb-2 text-[13px] font-medium">Keyboard shortcuts</p>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-start justify-between gap-3 text-[13px]">
              <dt className="text-muted-foreground">{what}</dt>
              <dd className="shrink-0">
                <Kbd className="h-5 px-1.5">{keys}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
