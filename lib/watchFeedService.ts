import { supabase } from './supabase';
import { filterVisibleWatchMedia } from './watchVisibility';

export interface WatchMediaFeedItem {
  id: string;
  creator_id: string | null;
  title: string;
  description: string | null;
  category: string;
  tags: string[];
  media_type: string;
  media_url: string | null;
  thumbnail_url: string | null;
  thumbnail_mode: string;
  thumbnail_time_sec: number | null;
  visibility: 'public' | 'subscribers' | 'private';
  allow_comments: boolean;
  monetize: boolean;
  show_likes: boolean;
  show_views: boolean;
  created_at: string;
}

export async function fetchWatchFeedItems(
  category?: string
): Promise<WatchMediaFeedItem[]> {
  let query = supabase
    .from('watch_media')
    .select('*')
    .order('created_at', { ascending: false });

  if (category && category !== 'All') {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as WatchMediaFeedItem[]) : [];
  return filterVisibleWatchMedia(rows);
}