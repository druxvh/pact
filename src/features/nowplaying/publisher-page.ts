/** The publisher, wired to the real Supabase client. Imported by the offscreen page (Chromium) and, on Firefox, by the background page. */
import { supabase } from '@/lib/supabase/client';
import { NowPlayingPublisher, type PublisherClient } from './publisher.ts';

let instance: NowPlayingPublisher | null = null;

export function pagePublisher(): NowPlayingPublisher {
  instance ??= new NowPlayingPublisher(supabase as unknown as PublisherClient | null);
  return instance;
}
