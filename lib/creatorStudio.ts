import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { DeviceEventEmitter } from 'react-native';
import { backend } from './backend';
import { supabase } from './supabase';

export const CATEGORIES = [
  'Live',
  'Gaming',
  'Music',
  'Tech',
  'Travel',
  'Fitness',
  'Education',
  'General',
] as const;

export type MediaCategory = (typeof CATEGORIES)[number] | (string & {});
export type ThumbnailMode = 'auto' | 'custom' | 'video';
export type CreationModeKey = 'video' | 'reel' | 'live' | 'post';

export const DEFAULT_COVER: Record<string, string> = {
  Live: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80',
  Gaming:
    'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=800&q=80',
  Music:
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=800&q=80',
  Tech: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=800&q=80',
  Travel:
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
  Fitness:
    'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=800&q=80',
  Education:
    'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80',
  General:
    'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80',
};

export interface DraftItem {
  id: string;
  mode: CreationModeKey;
  title: string;
  category: MediaCategory;
  description: string;
  tagsText: string;
  thumbnailMode: ThumbnailMode;
  musicTrackId: string | null;
  customAudioUri: string;
  mediaUri: string;
  coverUri: string;
  visibility?: 'public' | 'subscribers' | 'private';
  savedAt: string;
  coverTimeSec?: number | null;
  mediaDurationSec?: number;
  selectedThumbSec?: number;
  thumbScrubRatio?: number;
  playlistName?: string;
  locationText?: string;
  collaboratorsText?: string;
  pinnedComment?: string;
  allowComments?: boolean;
  monetize?: boolean;
  showLikesCount?: boolean;
  showViewsCount?: boolean;
  [key: string]: any;
}

export interface PublishCreatorPayload {
  id?: string;
  mode: CreationModeKey;
  title: string;
  description?: string;
  category?: MediaCategory;
  tags?: string[];
  thumbnailMode?: ThumbnailMode;
  mediaUri?: string;
  coverUri?: string;
  thumbnailUrl?: string;
  musicTrack?: string;
  customAudioUri?: string;
  visibility?: string;
  allowComments?: boolean;
  monetize?: boolean;
  creatorId?: string;
  photos?: string[];
  onProgress?: (message: string) => void;
  [key: string]: any;
}

const DRAFTS_STORAGE_KEY = '@creator_studio_drafts_v1';

export function parseTags(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const matches = raw.match(/#?[a-zA-Z0-9_.-]+/g) || [];
  const unique = new Set<string>();
  for (const token of matches) {
    const clean = token.replace(/^#+/, '').trim();
    if (clean) unique.add(clean);
  }
  return Array.from(unique).slice(0, 20);
}

export function isLikelyImageUri(uri?: string | null): boolean {
  const clean = (uri || '').trim();
  if (!clean) return false;
  const base = clean.split('?')[0].toLowerCase();
  if (/\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/.test(base)) return false;
  return (
    /^(https?:|file:|content:|ph:|assets-library:|data:image\/)/i.test(clean) ||
    /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp)$/.test(base)
  );
}

function mapDbDraftToItem(row: any): DraftItem {
  const extra =
    row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...extra,
    id: String(row.id),
    mode: (row.mode || 'video') as CreationModeKey,
    title: String(row.title || 'Untitled'),
    category: (row.category || 'General') as MediaCategory,
    description: String(row.description || ''),
    tagsText: String(row.tags_text || ''),
    thumbnailMode: (row.thumbnail_mode || 'custom') as ThumbnailMode,
    musicTrackId: row.music_track_id ?? null,
    customAudioUri: String(row.custom_audio_uri || ''),
    mediaUri: String(row.media_url || ''),
    coverUri: String(row.cover_url || ''),
    visibility:
      row.visibility === 'subscribers' || row.visibility === 'private'
        ? row.visibility
        : 'public',
    savedAt: extra.savedAt || 'Recently',
  };
}

async function readLocalDrafts(): Promise<DraftItem[]> {
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalDrafts(drafts: DraftItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore storage write failure
  }
}

export async function getStudioDrafts(): Promise<DraftItem[]> {
  const local = await readLocalDrafts();
  try {
    const user = await backend.auth.getCurrentUser().catch(() => null);
    if (!user?.id) return local;

    const { data, error } = await supabase
      .from('studio_drafts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error || !Array.isArray(data)) return local;

    const remote = data.map(mapDbDraftToItem);
    const mergedMap = new Map<string, DraftItem>();
    for (const d of remote) mergedMap.set(d.id, d);
    for (const d of local) {
      if (d?.id && !mergedMap.has(d.id)) mergedMap.set(d.id, d);
    }
    const merged = Array.from(mergedMap.values());
    await writeLocalDrafts(merged);
    return merged;
  } catch {
    return local;
  }
}

export async function saveStudioDraft(draft: DraftItem): Promise<DraftItem[]> {
  const existing = await readLocalDrafts();
  const normalized: DraftItem = {
    ...draft,
    id: draft.id || `draft-${Date.now()}`,
    mode: draft.mode || 'video',
    title: draft.title || 'Untitled Draft',
    category: draft.category || 'General',
    description: draft.description || '',
    tagsText: draft.tagsText || '',
    thumbnailMode: draft.thumbnailMode || 'custom',
    musicTrackId: draft.musicTrackId ?? null,
    customAudioUri: draft.customAudioUri || '',
    mediaUri: draft.mediaUri || '',
    coverUri: draft.coverUri || '',
    savedAt: draft.savedAt || 'Just now',
  };

  const next = [normalized, ...existing.filter((d) => d?.id !== normalized.id)];
  await writeLocalDrafts(next);

  try {
    const user = await backend.auth.getCurrentUser().catch(() => null);
    if (user?.id) {
      await supabase.from('studio_drafts').upsert(
        {
          id: normalized.id,
          user_id: user.id,
          mode: normalized.mode,
          title: normalized.title,
          category: String(normalized.category || 'General'),
          description: normalized.description,
          tags_text: normalized.tagsText,
          thumbnail_mode: normalized.thumbnailMode,
          music_track_id: normalized.musicTrackId,
          custom_audio_uri: normalized.customAudioUri,
          media_url: normalized.mediaUri,
          cover_url: normalized.coverUri,
          visibility: normalized.visibility || 'public',
          payload: normalized,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    }
  } catch {
    // local cache already saved
  }

  DeviceEventEmitter.emit('studio-drafts-updated');
  return next;
}

export async function deleteStudioDraft(id: string): Promise<DraftItem[]> {
  const existing = await readLocalDrafts();
  const next = existing.filter((d) => d?.id !== id);
  await writeLocalDrafts(next);

  try {
    const user = await backend.auth.getCurrentUser().catch(() => null);
    if (user?.id && id) {
      await supabase
        .from('studio_drafts')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
    }
  } catch {
    // ignore remote delete error
  }

  DeviceEventEmitter.emit('studio-drafts-updated');
  return next;
}

export async function uploadLocalToStorage(
  localUri: string,
  folder: string,
  ext: string,
  mimeType: string
): Promise<string | null> {
  const cleanUri = (localUri || '').trim();
  if (!cleanUri) return null;
  if (/^https?:\/\//i.test(cleanUri)) {
    return cleanUri;
  }

  const isThumbnail =
    folder.includes('thumbnails') || mimeType.startsWith('image/');

  try {
    const info = await FileSystem.getInfoAsync(cleanUri);
    if (!info.exists) {
      if (isThumbnail) return null;
      throw new Error('Selected media file no longer exists. Please re-select.');
    }

    return await backend.studio.uploadWatchFile(
      cleanUri,
      folder,
      ext,
      mimeType
    );
  } catch (err) {
    if (isThumbnail) {
      return null;
    }
    throw err;
  }
}

export async function publishCreatorItem(
  payload: PublishCreatorPayload
): Promise<any> {
  const onProgress = payload.onProgress;
  onProgress?.('Preparing upload...');

  const currentUser = await backend.auth.getCurrentUser().catch(() => null);
  const creatorId = payload.creatorId || currentUser?.id || null;
  const creatorName =
    currentUser?.fullName?.trim() ||
    currentUser?.email?.split('@')[0]?.trim() ||
    'Creator';
  const rawHandle =
    currentUser?.username?.trim() ||
    currentUser?.email?.split('@')[0]?.trim() ||
    'creator';
  const cleanHandle =
    rawHandle.replace(/^@+/, '').replace(/[^a-zA-Z0-9._-]/g, '') || 'creator';
  const creatorHandle = `@${cleanHandle}`;
  const creatorAvatar = currentUser?.avatarUrl || null;

  if (payload.mode === 'post') {
    onProgress?.('Uploading photos...');
    const rawPhotos = Array.isArray(payload.photos)
      ? payload.photos
      : payload.coverUri
        ? [payload.coverUri]
        : [];
    const uploadedPhotos: string[] = [];

    for (const uri of rawPhotos) {
      const clean = (uri || '').trim();
      if (!clean) continue;
      if (/^https?:\/\//i.test(clean)) {
        uploadedPhotos.push(clean);
      } else {
        const publicUrl = await backend.storage.uploadMedia(clean, 'posts');
        if (publicUrl) uploadedPhotos.push(publicUrl);
      }
    }

    onProgress?.('Publishing post...');
    const postId = payload.id || `post-${Date.now()}`;
    const rawVis = String(payload.visibility || 'public').toLowerCase();
    const visibility =
      rawVis.includes('follower') || rawVis.includes('friend')
        ? 'friends'
        : 'public';

    const {
      id: _id,
      mode: _mode,
      title: _title,
      description: _desc,
      category: _cat,
      tags: _tags,
      thumbnailMode: _tm,
      mediaUri: _mu,
      coverUri: _cu,
      thumbnailUrl: _tu,
      onProgress: _op,
      creatorId: _cid,
      photos: _photos,
      ...restMeta
    } = payload;

    const postRow = {
      id: postId,
      author_id: creatorId,
      user_id: creatorId,
      author_name: creatorName,
      author_handle: creatorHandle,
      author_avatar: creatorAvatar,
      caption: payload.description || payload.title || '',
      visibility,
      media_type: 'image',
      media_url: uploadedPhotos[0] || null,
      photos: uploadedPhotos,
      meta: {
        ...restMeta,
        tags: payload.tags || [],
      },
    };

    await backend.posts.createPost(postRow);
    return postRow;
  }

  const category = String(payload.category || 'Travel');
  const folder: 'video' | 'reels' | 'live' =
    payload.mode === 'reel'
      ? 'reels'
      : payload.mode === 'live'
        ? 'live'
        : 'video';

  let uploadedMediaUrl = (payload.mediaUri || '').trim();
  if (
    uploadedMediaUrl &&
    !/^https?:\/\//i.test(uploadedMediaUrl) &&
    !uploadedMediaUrl.startsWith('pending://')
  ) {
    onProgress?.('Uploading video...');
    if (creatorId) {
      uploadedMediaUrl = await backend.studio.uploadAsset(
        uploadedMediaUrl,
        'video',
        creatorId,
        (msg) => onProgress?.(msg),
        folder
      );
    } else {
      const uploaded = await uploadLocalToStorage(
        uploadedMediaUrl,
        folder,
        'mp4',
        'video/mp4'
      );
      if (uploaded) uploadedMediaUrl = uploaded;
    }
  }

  let uploadedCoverUrl = (
    payload.thumbnailUrl ||
    payload.coverUri ||
    ''
  ).trim();
  if (
    uploadedCoverUrl &&
    !/^https?:\/\//i.test(uploadedCoverUrl) &&
    isLikelyImageUri(uploadedCoverUrl)
  ) {
    onProgress?.('Uploading cover...');
    let uploadedResult: string | null = null;
    if (creatorId) {
      try {
        uploadedResult = await backend.studio.uploadAsset(
          uploadedCoverUrl,
          'thumbnail',
          creatorId,
          (msg) => onProgress?.(msg),
          folder
        );
      } catch {
        uploadedResult = await uploadLocalToStorage(
          uploadedCoverUrl,
          `${folder}/thumbnails`,
          'jpg',
          'image/jpeg'
        );
      }
    } else {
      uploadedResult = await uploadLocalToStorage(
        uploadedCoverUrl,
        `${folder}/thumbnails`,
        'jpg',
        'image/jpeg'
      );
    }

    if (!uploadedResult) {
      throw new Error('Failed to upload the selected thumbnail image.');
    }
    uploadedCoverUrl = uploadedResult;
  }

  const cleanCoverUrl =
    uploadedCoverUrl && isLikelyImageUri(uploadedCoverUrl)
      ? uploadedCoverUrl
      : !uploadedMediaUrl
        ? DEFAULT_COVER[category] || DEFAULT_COVER.General
        : null;

  onProgress?.('Saving to database...');
  const rowId =
    payload.id ||
    `${payload.mode === 'reel' ? 'reel' : payload.mode === 'live' ? 'live' : 'vid'}-${Date.now()}`;

  const safeTotalSeconds =
    typeof payload.totalSeconds === 'number' && payload.totalSeconds > 0
      ? Math.round(payload.totalSeconds)
      : null;

  const watchRow: Record<string, any> = {
    id: rowId,
    creator_id: creatorId,
    creator_name: creatorName,
    creator_handle: creatorHandle,
    creator_avatar: creatorAvatar,
    mode: payload.mode,
    format: payload.mode === 'reel' ? 'reel' : 'video',
    orientation: payload.mode === 'reel' ? 'vertical' : 'horizontal',
    title: payload.title.trim(),
    description: (payload.description || '').trim(),
    category,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    thumbnail_mode: payload.thumbnailMode || 'custom',
    thumbnail_url: cleanCoverUrl,
    cover_url: cleanCoverUrl,
    media_url: uploadedMediaUrl || 'pending://video',
    audio_url: payload.customAudioUri || null,
    music_track: payload.musicTrack || null,
    visibility: payload.visibility || 'public',
    is_live: payload.mode === 'live',
    allow_comments: payload.allowComments !== false,
    monetize: Boolean(payload.monetize),
    views_count: typeof payload.viewsCount === 'number' ? payload.viewsCount : 0,
    ...(safeTotalSeconds ? { total_seconds: safeTotalSeconds } : {}),
  };

  return backend.studio.upsertWatchMedia(watchRow, rowId);
}
