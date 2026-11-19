import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { activeStyleWallpaper } from '@/lib/appearance/themeStyle';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useThemeStore } from '@/store/useThemeStore';
import { accentHex } from './accentHex';
import { type Mounted, mountStyleWallpaper } from './engine';
import { hasScene, loadScene } from './registry';

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const osReduced = () => window.matchMedia(REDUCED).matches;

/** Reduced motion = the in-app Animations setting, or (when it is "system") the OS preference. "Full" overrides the OS. */
export function useStill(): boolean {
  const pref = useSettingsStore((s) => s.motion);
  const os = useSyncExternalStore(subscribeReduced, osReduced, () => false);
  return pref === 'reduced' || (pref === 'system' && os);
}

/**
 * The style's animated wallpaper, behind everything. Renders nothing unless the active style has one, "Style wallpaper" is on and the
 * user has not picked a colour / gradient / mesh / picture of their own; then it loads the scene (a lazy chunk) and runs it on a fixed,
 * full-viewport canvas. Switching style tears the scene down completely and builds the next one. Contract: README.md.
 */
export function StyleWallpaper() {
  const style = useAppearanceStore((s) => s.style);
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  const enabled = useAppearanceStore((s) => s.styleWallpaper);
  const def = activeStyleWallpaper(style, wallpaper, enabled);
  if (!def || !hasScene(def.scene)) return null;
  return <Painted key={def.scene} scene={def.scene} />;
}

function Painted({ scene }: { scene: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const dark = useThemeStore((s) => s.resolved) === 'dark';
  const accentChoice = useAppearanceStore((s) => s.accent);
  const plate = useAppearanceStore((s) => s.plate);
  const still = useStill();
  const accent = accentHex(accentChoice, dark);
  const [ready, setReady] = useState(false);

  const latest = useRef({ dark, accent, plate, still });
  latest.current = { dark, accent, plate, still };

  useEffect(() => {
    let cancelled = false;
    let m: Mounted | null = null;
    void loadScene(scene).then((factory) => {
      const host = hostRef.current;
      const canvas = canvasRef.current;
      if (cancelled || !factory || !host || !canvas) return;
      m = mountStyleWallpaper(host, canvas, {
        factory,
        ...latest.current,
        onFirstFrame: () => {
          if (!cancelled) setReady(true);
        },
      });
      mounted.current = m;
    });
    return () => {
      cancelled = true;
      m?.dispose();
      mounted.current = null;
    };
  }, [scene]);

  useEffect(() => mounted.current?.setDark(dark), [dark]);
  useEffect(() => mounted.current?.setAccent(accent), [accent]);
  useEffect(() => mounted.current?.setPlate(plate), [plate]);
  useEffect(() => mounted.current?.setStill(still), [still]);

  return (
    <div ref={hostRef} className="stylewall" data-stylewall={scene} data-ready={ready ? '' : undefined} aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className="stylewall-scrim" />
      <div className="stylewall-vignette" />
    </div>
  );
}
