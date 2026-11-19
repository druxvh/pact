import { lazy, Suspense, useEffect, useState } from 'react';
import { useUiStore } from '@/store/useUiStore';

// The studio (and everything it pulls in) is its own chunk: it only loads the first time the camera is opened.
const CameraStudio = lazy(() => import('@/features/camera/CameraStudio'));

/**
 * Mount once in the app shell. Opens whenever `useUiStore.cameraOpen` is true (`!cam`, "Open camera" in the palette).
 * Nothing here touches the camera: the stream starts inside the studio, only while it is open, and stops when it closes.
 */
export function CameraHost() {
  const open = useUiStore((s) => s.cameraOpen);
  const setOpen = useUiStore((s) => s.setCameraOpen);
  // Load the chunk on first use, then keep the (closed) dialog mounted so it can animate out.
  const [wanted, setWanted] = useState(open);
  useEffect(() => {
    if (open) setWanted(true);
  }, [open]);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <CameraStudio open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
