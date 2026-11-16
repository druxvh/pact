import { useAuthStore } from '@/store/useAuthStore';
import type { CommunityApi } from './api';
import { createCommunityStore } from './store';
import { communityApiFor } from './supabaseApi';
import { CommunityError } from './types';

/** Test / dev-harness override. Production never sets this. */
let override: CommunityApi | null = null;
export const setCommunityApiForTesting = (api: CommunityApi | null) => {
  override = api;
};

/** The data layer for whoever is signed in (components use it directly for things that aren't shared state, like file URLs). */
export function getCommunityApi(): CommunityApi {
  if (override) return override;
  const user = useAuthStore.getState().user;
  if (!user) throw new CommunityError('not_allowed', 'Sign in to use communities.');
  return communityApiFor(user.id);
}

/** The app's Communities store, bound to whoever is signed in. */
export const useCommunityStore = createCommunityStore(getCommunityApi);
