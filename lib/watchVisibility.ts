import { supabase } from './supabase';

export type WatchVisibility = 'public' | 'subscribers' | 'private';

export function normalizeVisibility(raw?: string | null): WatchVisibility {
  const val = (raw || '').trim().toLowerCase();
  if (val === 'subscribers' || val === 'subscriptions' || val === 'subscribers_only') {
    return 'subscribers';
  }
  if (val === 'private') {
    return 'private';
  }
  return 'public';
}

export async function getSubscribedCreatorIds(viewerId?: string | null): Promise<Set<string>> {
  const result = new Set<string>();
  if (!viewerId) return result;

  const candidateTables = [
    { table: 'subscriptions', followerCol: 'subscriber_id', creatorCol: 'creator_id' },
    { table: 'subscriptions', followerCol: 'user_id', creatorCol: 'channel_id' },
  ];

  for (const cfg of candidateTables) {
    try {
      const { data, error } = await supabase
        .from(cfg.table)
        .select(cfg.creatorCol)
        .eq(cfg.followerCol, viewerId);

      if (!error && Array.isArray(data)) {
        for (const row of data as any[]) {
          const targetId = row?.[cfg.creatorCol];
          if (typeof targetId === 'string' && targetId.trim()) {
            result.add(targetId.trim());
          }
        }
        if (result.size > 0) return result;
      }
    } catch {
      // try next table shape if schema differs
    }
  }

  return result;
}

export function canViewWatchMedia(
  item: { creator_id?: string | null; visibility?: string | null },
  viewerId?: string | null,
  subscribedCreatorIds?: Set<string>
): boolean {
  const vis = normalizeVisibility(item?.visibility);
  const creatorId = (item?.creator_id || '').trim();
  const currentViewerId = (viewerId || '').trim();

  if (vis === 'public') {
    return true;
  }

  if (currentViewerId && creatorId && currentViewerId === creatorId) {
    return true;
  }

  if (vis === 'private') {
    return false;
  }

  if (vis === 'subscribers') {
    if (!currentViewerId || !creatorId) return false;
    return Boolean(subscribedCreatorIds?.has(creatorId));
  }

  return true;
}

export async function filterVisibleWatchMedia<
  T extends { creator_id?: string | null; visibility?: string | null }
>(items: T[]): Promise<T[]> {
  if (!Array.isArray(items) || items.length === 0) return [];

  let viewerId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id || null;
  } catch {
    viewerId = null;
  }

  const subscribedSet = await getSubscribedCreatorIds(viewerId);
  return items.filter((item) => canViewWatchMedia(item, viewerId, subscribedSet));
}