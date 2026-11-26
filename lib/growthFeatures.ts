import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { scheduleLiveReminderNotification } from './deviceNotifications';

export const GROWTH_UPDATED_EVENT = 'vibesphere-growth-updated';
export const COLLECTIONS_UPDATED_EVENT = 'vibesphere-collections-updated';
export const SCHEDULED_LIVES_UPDATED_EVENT = 'vibesphere-scheduled-lives-updated';

export interface VibeStreakState {
  streakDays: number;
  lastActiveDay: string; // YYYY-MM-DD
}

export interface ReferralState {
  invitedCount: number;
  tierLabel: 'New Member' | 'Early Supporter' | 'Rising Creator' | 'Founder Circle';
  nextTarget: number;
}

export interface CollectionEntry {
  id: string;
  kind: 'reel' | 'video' | 'post';
  title: string;
  author: string;
  thumbnailUrl?: string;
  savedAt: string;
}

export interface VibeCollection {
  id: string;
  title: string;
  description: string;
  items: CollectionEntry[];
  updatedAt: string;
}

export interface ScheduledLiveItem {
  id: string;
  hostId: string;
  hostName: string;
  hostHandle: string;
  hostAvatar?: string;
  title: string;
  category: string;
  scheduledAtMs: number;
  reminded?: boolean;
}

export interface CommentMetaState {
  pinnedCommentId?: string | null;
  creatorLikedIds: string[];
}

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function getYesterdayKey(): string {
  const d = new Date(Date.now() - 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export async function recordDailyVibeActivity(
  userId?: string | null
): Promise<VibeStreakState> {
  const key = `vibe_streak_v1_${userId || 'guest'}`;
  const today = getTodayKey();
  const yesterday = getYesterdayKey();

  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed: VibeStreakState | null = raw ? JSON.parse(raw) : null;
    if (parsed?.lastActiveDay === today) {
      return parsed;
    }
    const nextStreak =
      parsed?.lastActiveDay === yesterday
        ? Math.max(1, Number(parsed.streakDays || 1) + 1)
        : 1;
    const next: VibeStreakState = {
      streakDays: nextStreak,
      lastActiveDay: today,
    };
    await AsyncStorage.setItem(key, JSON.stringify(next));
    DeviceEventEmitter.emit(GROWTH_UPDATED_EVENT);
    return next;
  } catch {
    return { streakDays: 1, lastActiveDay: today };
  }
}

export async function getVibeStreak(
  userId?: string | null
): Promise<VibeStreakState> {
  const key = `vibe_streak_v1_${userId || 'guest'}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as VibeStreakState;
      if (parsed?.streakDays) return parsed;
    }
  } catch {}
  return recordDailyVibeActivity(userId);
}

export function getInviteTier(count: number): ReferralState {
  if (count >= 5) {
    return { invitedCount: count, tierLabel: 'Founder Circle', nextTarget: 10 };
  }
  if (count >= 3) {
    return { invitedCount: count, tierLabel: 'Rising Creator', nextTarget: 5 };
  }
  if (count >= 1) {
    return { invitedCount: count, tierLabel: 'Early Supporter', nextTarget: 3 };
  }
  return { invitedCount: 0, tierLabel: 'New Member', nextTarget: 1 };
}

export function buildInviteUrl(username?: string | null, userId?: string | null): string {
  const cleanHandle = String(username || '')
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();
  const slug = cleanHandle || (userId ? userId.slice(0, 8) : 'vibesphere');
  return `https://vibesphere.app/invite/${encodeURIComponent(slug)}`;
}

export function buildShareDeepLink(
  kind: 'reel' | 'video' | 'post' | 'live' | 'profile',
  id: string
): string {
  return `https://vibesphere.app/${kind}/${encodeURIComponent(id)}`;
}

export async function getReferralState(
  userId?: string | null
): Promise<ReferralState> {
  const key = `vibe_referrals_v1_${userId || 'guest'}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    const count = raw ? Number(JSON.parse(raw)?.invitedCount || 0) : 0;
    return getInviteTier(Math.max(0, Math.floor(count)));
  } catch {
    return getInviteTier(0);
  }
}

export async function incrementReferralProgress(
  userId?: string | null
): Promise<ReferralState> {
  const key = `vibe_referrals_v1_${userId || 'guest'}`;
  const current = await getReferralState(userId);
  const nextCount = current.invitedCount + 1;
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ invitedCount: nextCount, updatedAt: Date.now() })
    );
    DeviceEventEmitter.emit(GROWTH_UPDATED_EVENT);
  } catch {}
  return getInviteTier(nextCount);
}

const DEFAULT_COLLECTIONS: VibeCollection[] = [
  {
    id: 'col-weekend',
    title: 'Weekend Trip Ideas',
    description: 'Places, vlogs & aesthetic travel reels',
    items: [],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'col-workout',
    title: 'Workout & Wellness',
    description: 'Daily fitness clips and routines',
    items: [],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'col-tech',
    title: 'Tech & Creator Gear',
    description: 'Setups, AI workflows, and tutorials',
    items: [],
    updatedAt: new Date().toISOString(),
  },
];

export async function getVibeCollections(
  userId?: string | null
): Promise<VibeCollection[]> {
  const key = `vibe_collections_v1_${userId || 'guest'}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_COLLECTIONS;
}

export async function createVibeCollection(
  userId: string | null | undefined,
  title: string,
  description = 'Shared Vibe Watchlist'
): Promise<VibeCollection[]> {
  const cleanTitle = title.trim();
  const list = await getVibeCollections(userId);
  if (!cleanTitle) return list;
  const created: VibeCollection = {
    id: `col-${Date.now()}`,
    title: cleanTitle,
    description: description.trim() || 'Shared Vibe Watchlist',
    items: [],
    updatedAt: new Date().toISOString(),
  };
  const next = [created, ...list];
  try {
    await AsyncStorage.setItem(
      `vibe_collections_v1_${userId || 'guest'}`,
      JSON.stringify(next)
    );
    DeviceEventEmitter.emit(COLLECTIONS_UPDATED_EVENT);
  } catch {}
  return next;
}

export async function saveItemToCollection(
  userId: string | null | undefined,
  collectionId: string,
  entry: Omit<CollectionEntry, 'savedAt'>
): Promise<VibeCollection[]> {
  const list = await getVibeCollections(userId);
  const nowIso = new Date().toISOString();
  const next = list.map((col) => {
    if (col.id !== collectionId) return col;
    const filtered = col.items.filter((i) => i.id !== entry.id);
    return {
      ...col,
      updatedAt: nowIso,
      items: [{ ...entry, savedAt: nowIso }, ...filtered],
    };
  });
  try {
    await AsyncStorage.setItem(
      `vibe_collections_v1_${userId || 'guest'}`,
      JSON.stringify(next)
    );
    DeviceEventEmitter.emit(COLLECTIONS_UPDATED_EVENT);
  } catch {}
  return next;
}

const SCHEDULED_LIVES_KEY = 'vibesphere_scheduled_lives_v1';

export async function getScheduledLives(): Promise<ScheduledLiveItem[]> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULED_LIVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScheduledLiveItem[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((s) => Number(s.scheduledAtMs) > now - 30 * 60 * 1000)
      .sort((a, b) => a.scheduledAtMs - b.scheduledAtMs);
  } catch {
    return [];
  }
}

export async function scheduleUpcomingLive(
  item: Omit<ScheduledLiveItem, 'id'>
): Promise<ScheduledLiveItem> {
  const created: ScheduledLiveItem = {
    ...item,
    id: `sched-${Date.now()}`,
  };
  const existing = await getScheduledLives();
  const next = [created, ...existing];
  try {
    await AsyncStorage.setItem(SCHEDULED_LIVES_KEY, JSON.stringify(next));
    DeviceEventEmitter.emit(SCHEDULED_LIVES_UPDATED_EVENT);
  } catch {}
  return created;
}

export async function toggleLiveReminder(
  streamId: string
): Promise<ScheduledLiveItem[]> {
  const existing = await getScheduledLives();
  let targetItem: ScheduledLiveItem | null = null;
  const next = existing.map((item) => {
    if (item.id !== streamId) return item;
    const nextReminded = !item.reminded;
    const updated = { ...item, reminded: nextReminded };
    if (nextReminded) targetItem = updated;
    return updated;
  });

  try {
    await AsyncStorage.setItem(SCHEDULED_LIVES_KEY, JSON.stringify(next));
    DeviceEventEmitter.emit(SCHEDULED_LIVES_UPDATED_EVENT);
  } catch {}

  if (targetItem) {
    const t: ScheduledLiveItem = targetItem;
    await scheduleLiveReminderNotification({
      streamId: t.id,
      title: t.title,
      hostName: t.hostName,
      scheduledAtMs: t.scheduledAtMs,
    });
  }
  return next;
}

const COMMENT_META_PREFIX = 'vibesphere_comment_meta_v1_';

export async function getCommentMeta(
  targetId: string
): Promise<CommentMetaState> {
  try {
    const raw = await AsyncStorage.getItem(`${COMMENT_META_PREFIX}${targetId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        pinnedCommentId: parsed?.pinnedCommentId || null,
        creatorLikedIds: Array.isArray(parsed?.creatorLikedIds)
          ? parsed.creatorLikedIds
          : [],
      };
    }
  } catch {}
  return { pinnedCommentId: null, creatorLikedIds: [] };
}

export async function toggleCommentCreatorLike(
  targetId: string,
  commentId: string
): Promise<CommentMetaState> {
  const current = await getCommentMeta(targetId);
  const exists = current.creatorLikedIds.includes(commentId);
  const next: CommentMetaState = {
    ...current,
    creatorLikedIds: exists
      ? current.creatorLikedIds.filter((id) => id !== commentId)
      : [...current.creatorLikedIds, commentId],
  };
  try {
    await AsyncStorage.setItem(
      `${COMMENT_META_PREFIX}${targetId}`,
      JSON.stringify(next)
    );
  } catch {}
  return next;
}

export async function togglePinnedComment(
  targetId: string,
  commentId: string
): Promise<CommentMetaState> {
  const current = await getCommentMeta(targetId);
  const next: CommentMetaState = {
    ...current,
    pinnedCommentId: current.pinnedCommentId === commentId ? null : commentId,
  };
  try {
    await AsyncStorage.setItem(
      `${COMMENT_META_PREFIX}${targetId}`,
      JSON.stringify(next)
    );
  } catch {}
  return next;
}
