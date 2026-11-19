import { useEffect, useState } from 'react';

/** An object URL for a blob that is revoked when the blob changes or the component goes away (so nothing leaks). */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || blob.size === 0) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [blob]);
  return url;
}
