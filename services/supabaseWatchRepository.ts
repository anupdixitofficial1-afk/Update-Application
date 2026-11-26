import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

export interface CommentEntry {
  id: string;
  author: string;
  text: string;
  timeAgo: string;
}

export interface WatchStateSnapshot {
  likedIds: Record<string, boolean>;
  dislikedIds: Record<string, boolean>;
  savedIds: Record<string, boolean>;
  subscribedHandles: Record<string, boolean>;
  commentsByMedia: Record<string, CommentEntry[]>;
}

const DEVICE_USER_KEY_STORAGE = 'watch_device_user_key_v1';

async function getUserKey(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (data.user?.id) return data.user.id;

  let localKey = await AsyncStorage.getItem(DEVICE_USER_KEY_STORAGE);
  if (!localKey) {
    localKey = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await AsyncStorage.setItem(DEVICE_USER_KEY_STORAGE, localKey);
  }
  return localKey;
}

function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return 'Just now';
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  );
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export async function loadWatchStateFromSupabase(): Promise<WatchStateSnapshot> {
  const userKey = await getUserKey();

  const [reactionsRes, subsRes, commentsRes] = await Promise.all([
    supabase
      .from('watch_reactions')
      .select('media_id, liked, disliked, saved')
      .eq('user_key', userKey),
    supabase
      .from('watch_subscriptions')
      .select('creator_handle')
      .eq('user_key', userKey),
    supabase
      .from('watch_comments')
      .select('id, media_id, author, comment_text, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const likedIds: Record<string, boolean> = {};
  const dislikedIds: Record<string, boolean> = {};
  const savedIds: Record<string, boolean> = {};

  for (const row of reactionsRes.data ?? []) {
    if (row.liked) likedIds[row.media_id] = true;
    if (row.disliked) dislikedIds[row.media_id] = true;
    if (row.saved) savedIds[row.media_id] = true;
  }

  const subscribedHandles: Record<string, boolean> = {};
  for (const row of subsRes.data ?? []) {
    subscribedHandles[row.creator_handle] = true;
  }

  const commentsByMedia: Record<string, CommentEntry[]> = {};
  for (const row of commentsRes.data ?? []) {
    if (!commentsByMedia[row.media_id]) {
      commentsByMedia[row.media_id] = [];
    }
    commentsByMedia[row.media_id].push({
      id: row.id,
      author: row.author,
      text: row.comment_text,
      timeAgo: formatRelativeTime(row.created_at),
    });
  }

  return {
    likedIds,
    dislikedIds,
    savedIds,
    subscribedHandles,
    commentsByMedia,
  };
}

export async function upsertReactionFlag(
  mediaId: string,
  patch: Partial<{ liked: boolean; disliked: boolean; saved: boolean }>
): Promise<void> {
  const userKey = await getUserKey();

  const { data: existing } = await supabase
    .from('watch_reactions')
    .select('liked, disliked, saved')
    .eq('user_key', userKey)
    .eq('media_id', mediaId)
    .maybeSingle();

  const nextPayload = {
    user_key: userKey,
    media_id: mediaId,
    liked: patch.liked ?? existing?.liked ?? false,
    disliked: patch.disliked ?? existing?.disliked ?? false,
    saved: patch.saved ?? existing?.saved ?? false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('watch_reactions')
    .upsert(nextPayload, { onConflict: 'user_key,media_id' });

  if (error) throw error;
}

export async function setSubscriptionState(
  creatorHandle: string,
  subscribed: boolean
): Promise<void> {
  const userKey = await getUserKey();

  if (subscribed) {
    const { error } = await supabase
      .from('watch_subscriptions')
      .upsert(
        { user_key: userKey, creator_handle: creatorHandle },
        { onConflict: 'user_key,creator_handle' }
      );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('watch_subscriptions')
      .delete()
      .eq('user_key', userKey)
      .eq('creator_handle', creatorHandle);
    if (error) throw error;
  }
}

export async function insertWatchComment(
  mediaId: string,
  comment: CommentEntry
): Promise<void> {
  const { error } = await supabase.from('watch_comments').insert({
    id: comment.id,
    media_id: mediaId,
    author: comment.author,
    comment_text: comment.text,
  });
  if (error) throw error;
}