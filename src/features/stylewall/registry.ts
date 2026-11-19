/**
 * Which scene paints which style. Every scene is a lazy `import()` so Default / Dot Matrix users (and the Settings screen until it needs
 * a preview) load none of this. The key is a theme style id (`ThemeStyleDef.wallpaper.scene`).
 */
import type { SceneFactory, SceneModule } from './types';

const LOADERS: Record<string, () => Promise<SceneModule>> = {
  ultramarine: () => import('./scenes/ultramarine/scene'),
  dusk: () => import('./scenes/dusk/scene'),
};

export const hasScene = (id: string): boolean => Object.hasOwn(LOADERS, id);

const cache = new Map<string, Promise<SceneFactory | null>>();

/** The scene's factory (null for an unknown id or a chunk that failed to load — the wallpaper then simply stays off). */
export function loadScene(id: string): Promise<SceneFactory | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const loader = hasScene(id) ? LOADERS[id] : undefined;
  const p = loader
    ? loader()
        .then((m) => m.create)
        .catch(() => {
          cache.delete(id);
          return null;
        })
    : Promise.resolve(null);
  cache.set(id, p);
  return p;
}
