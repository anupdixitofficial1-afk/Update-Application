import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '../supabase';
import {
  AppUser,
  BackendProvider,
  ChatMessageRecord,
  ChatRoomChannel,
  ChatUserProfile,
  FeedPost,
  LiveChatMessageRecord,
  LiveJoinRequestRecord,
  LivePresenceEntry,
  LiveRoomChannel,
  LiveStreamRecord,
  WatchCommentRow,
  WatchReactionRow,
} from './types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createNotificationRecord(params: {
  userId?: string | null;
  actorId?: string | null;
  type: string;
  message: string;
  targetId?: string | null;
}): Promise<void> {
  const recipientId = (params.userId || '').trim();
  const actorId = (params.actorId || '').trim();
  if (!recipientId || !actorId || recipientId === actorId) return;

  try {
    const { data: actor } = await supabase
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', actorId)
      .maybeSingle();

    await supabase.from('notifications').insert({
      user_id: recipientId,
      actor_id: actorId,
      actor_name: actor?.full_name || actor?.username || null,
      actor_username: actor?.username || null,
      actor_avatar: actor?.avatar_url || null,
      type: params.type,
      message: params.message,
      target_id: params.targetId || null,
      is_read: false,
    });
  } catch {
    // Non-blocking notification insert
  }
}

function detectIdentifierType(raw: string): 'email' | 'phone' | 'username' {
  const clean = raw.trim();
  if (EMAIL_REGEX.test(clean.toLowerCase())) return 'email';
  const compact = clean.replace(/[\s\-()]/g, '');
  if (/^\+?\d{6,15}$/.test(compact)) return 'phone';
  return 'username';
}

const withTimeout = async <T,>(
  promise: PromiseLike<T>,
  ms = 4500,
  fallback?: T
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback as T), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const syncProfileFollowCounters = async (userId: string) => {
  try {
    const [{ count: followersCount }, { count: followingCount }] =
      await Promise.all([
        supabase
          .from('follows')
          .select('*', { count: 'exact', head: true })
          .eq('following_id', userId)
          .or('status.eq.accepted,status.is.null'),
        supabase
          .from('follows')
          .select('*', { count: 'exact', head: true })
          .eq('follower_id', userId)
          .or('status.eq.accepted,status.is.null'),
      ]);

    if (
      typeof followersCount === 'number' &&
      typeof followingCount === 'number'
    ) {
      await supabase
        .from('profiles')
        .update({
          followers_count: followersCount,
          following_count: followingCount,
        })
        .eq('id', userId);
    }
  } catch {
    // ignore
  }
};

const fetchSubscriptionMeta = async (
  profileId: string
): Promise<{ ids: string[]; metaById: Record<string, any> }> => {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .or(`subscriber_id.eq.${profileId},user_id.eq.${profileId}`);

    if (error) return { ids: [], metaById: {} };

    const activeRows = (data || []).filter((row: any) => {
      const st = String(row?.status || 'active').toLowerCase();
      return st === 'active' || st === 'subscribed' || st === 'accepted';
    });

    const ids: string[] = [];
    const metaById: Record<string, any> = {};

    for (const row of activeRows) {
      const targetId = row.creator_id || row.channel_id || row.target_id;
      if (targetId && targetId !== profileId) {
        if (!metaById[targetId]) {
          ids.push(targetId);
          metaById[targetId] = row;
        }
      }
    }

    return { ids, metaById };
  } catch {
    return { ids: [], metaById: {} };
  }
};

const fetchSubscriptionCount = async (profileId: string): Promise<number> => {
  const meta = await fetchSubscriptionMeta(profileId);
  return meta.ids.length;
};

const isRemoteHttpUrl = (uri: string): boolean => /^https?:\/\//i.test(uri.trim());

const isVideoUri = (uri: string): boolean => {
  const clean = uri.trim().toLowerCase();
  return /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i.test(clean);
};

const guessExtension = (uri: string, fallbackExt: string): string => {
  const clean = uri.split('?')[0] || '';
  const match = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? match[1].toLowerCase() : fallbackExt;
};

const getAvailableBuckets = async (
  kind: 'video' | 'thumbnail'
): Promise<string[]> => {
  const preferred =
    kind === 'video'
      ? ['watch-media', 'media']
      : ['watch-media', 'media', 'avatars'];

  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (!error && Array.isArray(data) && data.length > 0) {
      const existingNames = data
        .map((b: any) => (typeof b?.name === 'string' ? b.name : ''))
        .filter(Boolean);

      if (existingNames.length > 0) {
        const matched = preferred.filter((p) => existingNames.includes(p));
        const others = existingNames.filter((n) => !matched.includes(n));
        return [...matched, ...others];
      }
    }
  } catch {
    // ignore
  }

  return preferred;
};

async function prepareReadableUri(
  rawUri: string,
  ext: string
): Promise<{ uri: string; cleanupUri: string | null }> {
  const clean = rawUri.trim();
  if (!clean.startsWith('content://')) {
    return { uri: clean, cleanupUri: null };
  }
  const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!cacheDir) {
    return { uri: clean, cleanupUri: null };
  }
  const dest = `${cacheDir}upload_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 7)}.${ext}`;
  await FileSystem.copyAsync({ from: clean, to: dest });
  return { uri: dest, cleanupUri: dest };
}

async function uploadLocalFileToBucket(params: {
  localUri: string;
  bucket: string;
  filePath: string;
  ext: string;
  mimeType: string;
  upsert?: boolean;
}): Promise<string> {
  const { localUri, bucket, filePath, ext, mimeType, upsert = true } = params;
  const { uri: readableUri, cleanupUri } = await prepareReadableUri(
    localUri,
    ext
  );

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token || SUPABASE_ANON_KEY;

    if (typeof FileSystem.uploadAsync === 'function') {
      const encodedPath = filePath
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(
        bucket
      )}/${encodedPath}`;

      const result = await FileSystem.uploadAsync(uploadUrl, readableUri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': mimeType,
          'x-upsert': upsert ? 'true' : 'false',
        },
      });

      if (result.status >= 200 && result.status < 300) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
        if (data?.publicUrl) return data.publicUrl;
      }

      let errMsg = `Storage upload failed (${result.status})`;
      try {
        const parsed = JSON.parse(result.body || '{}');
        if (parsed?.message || parsed?.error) {
          errMsg = String(parsed.message || parsed.error);
        }
      } catch {
        // ignore JSON parse
      }
      throw new Error(errMsg);
    }

    const base64 = await FileSystem.readAsStringAsync(readableUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) {
      throw new Error('Unable to read media file for upload.');
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, decode(base64), {
        contentType: mimeType,
        upsert,
      });

    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
    if (!data?.publicUrl) throw new Error('Unable to resolve public media URL.');
    return data.publicUrl;
  } finally {
    if (cleanupUri) {
      void FileSystem.deleteAsync(cleanupUri, { idempotent: true }).catch(
        () => { }
      );
    }
  }
}

const getRoomChannelName = (userA: string, userB: string) => {
  const sorted = [userA, userB].sort();
  return `chat-room-${sorted[0]}-${sorted[1]}`;
};

export const supabaseAdapter: BackendProvider = {
  auth: {
    async getCurrentUser(): Promise<AppUser | null> {
      const { data: authData, error } = await supabase.auth.getUser();
      const user = authData?.user;
      if (error || !user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      return {
        id: user.id,
        email: profile?.email || user.email || '',
        fullName:
          profile?.full_name || user.user_metadata?.full_name || 'User',
        username: profile?.username || user.user_metadata?.username || '',
        phone: profile?.phone || user.user_metadata?.phone || '',
        avatarUrl:
          profile?.avatar_url ||
          user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          null,
        isProfileCompleted: Boolean(profile?.is_profile_completed),
        isVerified: Boolean(profile?.is_verified),
      };
    },

    async getSessionInfo() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return null;
      return {
        email: session.user.email || 'Signed in account',
        lastSignInAt: session.user.last_sign_in_at || null,
      };
    },

    onAuthStateChange(callback: (isSignedIn: boolean) => void) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(Boolean(session?.user));
      });
      return () => {
        data?.subscription?.unsubscribe();
      };
    },

    async signInWithIdentifier(
      identifier: string,
      password: string,
      countryCode = '+91'
    ): Promise<AppUser> {
      const trimmed = identifier.trim();
      const kind = detectIdentifierType(trimmed);
      let resolvedEmail: string | null = null;

      if (kind === 'email') {
        resolvedEmail = trimmed.toLowerCase();
      } else if (kind === 'phone') {
        const digits = trimmed.replace(/\D/g, '');
        const fullPhone = trimmed.startsWith('+')
          ? trimmed.replace(/[^\d+]/g, '')
          : `${countryCode}${digits}`;

        const { data } = await supabase
          .from('profiles')
          .select('email')
          .or(`phone.eq.${fullPhone},mobile_number.eq.${digits}`)
          .limit(1)
          .maybeSingle();

        resolvedEmail = data?.email
          ? String(data.email).trim().toLowerCase()
          : null;
      } else {
        const cleanHandle = trimmed.replace(/^@+/, '').toLowerCase();
        const { data } = await supabase
          .from('profiles')
          .select('email')
          .or(`username.ilike.${cleanHandle},username.ilike.@${cleanHandle}`)
          .limit(1)
          .maybeSingle();

        resolvedEmail = data?.email
          ? String(data.email).trim().toLowerCase()
          : null;
      }

      if (!resolvedEmail) {
        throw new Error(
          kind === 'phone'
            ? 'No account found with this mobile number.'
            : kind === 'username'
              ? 'No account found with this username.'
              : 'Enter a valid email address.'
        );
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password,
      });

      if (error || !data.user) {
        throw new Error(error?.message || 'Invalid credentials.');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle();

      return {
        id: data.user.id,
        email: resolvedEmail,
        fullName:
          profile?.full_name || data.user.user_metadata?.full_name || '',
        username: profile?.username || data.user.user_metadata?.username || '',
        phone: profile?.phone || '',
        avatarUrl: profile?.avatar_url || null,
        isProfileCompleted: Boolean(profile?.is_profile_completed),
        isVerified: Boolean(profile?.is_verified),
      };
    },

    async signUp(payload) {
      const fullPhone = `${payload.countryCode}${payload.mobileNumber}`;
      const handle = payload.username.startsWith('@')
        ? payload.username
        : `@${payload.username}`;

      const { data, error } = await supabase.auth.signUp({
        email: payload.email.trim().toLowerCase(),
        password: payload.password,
        options: {
          data: {
            full_name: payload.fullName.trim(),
            username: handle,
            email: payload.email.trim().toLowerCase(),
            country_code: payload.countryCode,
            mobile_number: payload.mobileNumber,
            phone: fullPhone,
          },
        },
      });

      if (error) throw new Error(error.message);
      if (!data.user) throw new Error('Account creation failed.');

      if (data.session) {
        const { error: profileError } = await supabase.from('profiles').upsert(
          {
            id: data.user.id,
            full_name: payload.fullName.trim(),
            username: handle,
            email: payload.email.trim().toLowerCase(),
            country_code: payload.countryCode,
            mobile_number: payload.mobileNumber,
            phone: fullPhone,
          },
          { onConflict: 'id' }
        );
        if (profileError) throw new Error(profileError.message);
      }
    },

    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(error.message);
    },

    async signOutOtherDevices() {
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      if (error) throw new Error(error.message);
    },

    async updatePassword(newPassword: string) {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw new Error(error.message);
    },

    async sendPasswordReset(email: string) {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: 'vibesphere://reset-password' }
      );
      if (error) throw new Error(error.message);
    },

    async checkAvailability(
      field: 'username' | 'email' | 'phone',
      value: string
    ): Promise<boolean> {
      const clean = value.trim();
      if (!clean) return true;

      if (field === 'username') {
        const plain = clean.replace(/^@+/, '').toLowerCase();
        const { data } = await supabase
          .from('profiles')
          .select('id')
          .or(`username.ilike.${plain},username.ilike.@${plain}`)
          .limit(1);
        return !data || data.length === 0;
      }

      if (field === 'email') {
        const { data } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', clean.toLowerCase())
          .limit(1);
        return !data || data.length === 0;
      }

      const digits = clean.replace(/\D/g, '');
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('mobile_number', digits)
        .limit(1);
      return !data || data.length === 0;
    },
  },

  storage: {
    async uploadMedia(localUri: string, folder = 'feed'): Promise<string> {
      const cleanUri = (localUri || '').trim();
      if (/^https?:\/\//i.test(cleanUri)) return cleanUri;

      const ext = guessExtension(cleanUri, 'jpg');
      const mimeType =
        ext === 'mp4'
          ? 'video/mp4'
          : ext === 'mov'
            ? 'video/quicktime'
            : ext === 'm4a' || ext === 'mp3' || ext === 'aac' || ext === 'wav'
              ? `audio/${ext === 'm4a' ? 'mp4' : ext}`
              : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      return uploadLocalFileToBucket({
        localUri: cleanUri,
        bucket: 'media',
        filePath: path,
        ext,
        mimeType,
        upsert: false,
      });
    },

    async uploadAvatar(userId: string, localUri: string): Promise<string> {
      const cleanUri = (localUri || '').trim();
      if (/^https?:\/\//i.test(cleanUri)) return cleanUri;

      const filePath = `${userId}/avatar_${Date.now()}.jpg`;
      const publicUrl = await uploadLocalFileToBucket({
        localUri: cleanUri,
        bucket: 'avatars',
        filePath,
        ext: 'jpg',
        mimeType: 'image/jpeg',
        upsert: true,
      });
      return `${publicUrl}?t=${Date.now()}`;
    },
  },

  posts: {
    async getFeed(limit = 30): Promise<FeedPost[]> {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);

      return (data || []).map((row: any) => ({
        id: String(row.id),
        authorId: String(row.author_id || row.user_id || ''),
        authorName: row.author_name || 'User',
        authorHandle: row.author_handle || '',
        authorAvatar: row.author_avatar || null,
        caption: row.caption || '',
        visibility: row.visibility || 'public',
        mediaType: row.media_type === 'video' ? 'video' : 'image',
        mediaUrl: row.media_url || null,
        photos: Array.isArray(row.photos) ? row.photos : [],
        meta: row.meta || {},
        likesCount: Number(row.likes_count || 0),
        commentsCount: Number(row.comments_count || 0),
        createdAt: row.created_at || new Date().toISOString(),
      }));
    },

    async createPost(payload: Record<string, any>): Promise<void> {
      const { error } = await supabase.from('posts').insert(payload);
      if (error) throw new Error(error.message);
    },

    async getUserInteractions(userId: string) {
      const { data, error } = await supabase
        .from('post_interactions')
        .select('post_id, liked, saved, hidden')
        .eq('user_id', userId);

      if (error) return { likedIds: [], savedIds: [], hiddenIds: [] };

      const likedIds: string[] = [];
      const savedIds: string[] = [];
      const hiddenIds: string[] = [];

      for (const row of data || []) {
        if (row.liked) likedIds.push(String(row.post_id));
        if (row.saved) savedIds.push(String(row.post_id));
        if (row.hidden) hiddenIds.push(String(row.post_id));
      }

      return { likedIds, savedIds, hiddenIds };
    },

    async toggleInteraction(
      userId: string,
      postId: string,
      patch: Partial<{ liked: boolean; saved: boolean; hidden: boolean }>
    ): Promise<void> {
      const { error } = await supabase.from('post_interactions').upsert(
        {
          user_id: userId,
          post_id: postId,
          ...patch,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,post_id' }
      );
      if (error) throw new Error(error.message);

      if (patch.liked) {
        supabase
          .from('posts')
          .select('author_id, user_id')
          .eq('id', postId)
          .maybeSingle()
          .then(({ data }) => {
            const ownerId = String(data?.author_id || data?.user_id || '');
            if (ownerId) {
              void createNotificationRecord({
                userId: ownerId,
                actorId: userId,
                type: 'like',
                message: 'liked your post.',
                targetId: postId,
              });
            }
          });
      }
    },

    async getHomeExtras(userId: string | null) {
      const nowIso = new Date().toISOString();
      const [
        profilesRes,
        liveRes,
        followsRes,
        unreadMsgRes,
        unreadNotifRes,
        storiesRes,
      ] = await Promise.all([
        withTimeout<any>(
          supabase
            .from('profiles')
            .select('id, full_name, username, avatar_url')
            .order('updated_at', { ascending: false })
            .limit(20),
          4500,
          { data: [] }
        ),
        withTimeout<any>(
          supabase
            .from('live_streams')
            .select('id, host_id, host_name, title, is_live')
            .eq('is_live', true)
            .limit(10),
          4500,
          { data: [] }
        ),
        userId
          ? withTimeout<any>(
            supabase
              .from('follows')
              .select('following_id')
              .eq('follower_id', userId)
              .or('status.eq.accepted,status.is.null'),
            4500,
            { data: [] }
          )
          : Promise.resolve({ data: [] }),
        userId
          ? withTimeout<any>(
            supabase
              .from('messages')
              .select('sender_id, is_read, read_at')
              .eq('receiver_id', userId)
              .or('is_read.eq.false,is_read.is.null')
              .limit(300),
            4500,
            { data: [] }
          )
          : Promise.resolve({ data: [] }),
        userId
          ? withTimeout<any>(
            supabase
              .from('notifications')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', userId)
              .eq('is_read', false)
              .neq('type', 'message'),
            4500,
            { count: 0 }
          )
          : Promise.resolve({ count: 0 }),
        withTimeout<any>(
          supabase
            .from('stories')
            .select('*')
            .gt('expires_at', nowIso)
            .order('created_at', { ascending: true })
            .limit(80),
          4500,
          { data: [] }
        ),
      ]);

      const liveHostIds = new Set<string>();
      for (const ls of liveRes?.data || []) {
        if (ls?.host_id) liveHostIds.add(String(ls.host_id));
      }

      const storiesByUser = new Map<
        string,
        Array<{
          id: string;
          mediaUrl: string;
          mediaType: 'image' | 'video';
          caption?: string;
          createdAt: string;
        }>
      >();
      const authorMetaByUser = new Map<
        string,
        { name: string; avatar: string }
      >();

      for (const s of storiesRes?.data || []) {
        const uid = String(s?.user_id || '');
        const mUrl = String(s?.media_url || '').trim();
        if (!uid || !mUrl) continue;
        const list = storiesByUser.get(uid) || [];
        list.push({
          id: String(s.id),
          mediaUrl: mUrl,
          mediaType: s.media_type === 'video' ? 'video' : 'image',
          caption: s.caption ? String(s.caption) : undefined,
          createdAt: String(s.created_at || nowIso),
        });
        storiesByUser.set(uid, list);
        if (!authorMetaByUser.has(uid)) {
          authorMetaByUser.set(uid, {
            name: String(s.author_handle || s.author_name || 'Member')
              .replace(/^@+/, '')
              .trim(),
            avatar: String(s.author_avatar || '').trim(),
          });
        }
      }

      const seenAuthorIds = new Set<string>();
      const stories: Array<{
        id: string;
        authorId: string;
        name: string;
        imageUrl: string;
        isLive?: boolean;
        hasActiveStory?: boolean;
        storyItems?: Array<{
          id: string;
          mediaUrl: string;
          mediaType: 'image' | 'video';
          caption?: string;
          createdAt: string;
        }>;
      }> = [];

      for (const p of profilesRes?.data || []) {
        if (!p?.id || p.id === userId) continue;
        const pid = String(p.id);
        seenAuthorIds.add(pid);
        const items = storiesByUser.get(pid) || [];
        const isLive = liveHostIds.has(pid);
        if (items.length === 0 && !isLive) continue;
        const handle = String(p.username || '')
          .replace(/^@+/, '')
          .trim();
        const display = handle || String(p.full_name || 'Member').trim();
        stories.push({
          id: `st-${pid}`,
          authorId: pid,
          name: display,
          imageUrl:
            (p.avatar_url || '').trim() ||
            'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0',
          isLive,
          hasActiveStory: items.length > 0,
          storyItems: items,
        });
      }

      for (const [uid, items] of storiesByUser.entries()) {
        if (uid === userId || seenAuthorIds.has(uid) || items.length === 0) {
          continue;
        }
        const meta = authorMetaByUser.get(uid);
        stories.unshift({
          id: `st-${uid}`,
          authorId: uid,
          name: meta?.name || 'Member',
          imageUrl:
            meta?.avatar ||
            'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0',
          isLive: liveHostIds.has(uid),
          hasActiveStory: true,
          storyItems: items,
        });
      }

      stories.sort((a, b) => {
        const aScore = (a.hasActiveStory ? 2 : 0) + (a.isLive ? 1 : 0);
        const bScore = (b.hasActiveStory ? 2 : 0) + (b.isLive ? 1 : 0);
        return bScore - aScore;
      });

      const followingIds = Array.from(
        new Set<string>(
          (followsRes?.data || [])
            .map((r: any) => String(r?.following_id || ''))
            .filter(Boolean)
        )
      );

      const unreadSenderIds = new Set<string>();
      for (const row of unreadMsgRes?.data || []) {
        const sid = String(row?.sender_id || '').trim();
        if (!sid || sid === userId) continue;
        const isUnreadRow =
          row?.is_read === false ||
          (row?.is_read == null && row?.read_at == null);
        if (isUnreadRow) {
          unreadSenderIds.add(sid);
        }
      }

      return {
        stories,
        myStories: userId ? storiesByUser.get(userId) || [] : [],
        followingIds,
        unreadMessagesCount: unreadSenderIds.size,
        unreadNotificationsCount: Number(unreadNotifRes?.count || 0),
      };
    },

    async createStory({ userId, mediaUri, mediaType, caption }) {
      const ext = guessExtension(
        mediaUri,
        mediaType === 'video' ? 'mp4' : 'jpg'
      );
      const mimeType =
        mediaType === 'video'
          ? ext === 'mov'
            ? 'video/quicktime'
            : 'video/mp4'
          : ext === 'png'
            ? 'image/png'
            : 'image/jpeg';

      const uploadedUrl = await uploadLocalFileToBucket({
        localUri: mediaUri,
        bucket: 'media',
        filePath: `stories/${userId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}.${ext}`,
        ext,
        mimeType,
        upsert: true,
      });

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, username, avatar_url')
        .eq('id', userId)
        .maybeSingle();

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const id = `story-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const { data, error } = await supabase
        .from('stories')
        .insert({
          id,
          user_id: userId,
          author_name: profile?.full_name || null,
          author_handle: profile?.username || null,
          author_avatar: profile?.avatar_url || null,
          media_url: uploadedUrl,
          media_type: mediaType,
          caption: (caption || '').trim() || null,
          created_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .select('*')
        .single();

      if (error) throw new Error(error.message);

      return {
        id: String(data?.id || id),
        mediaUrl: String(data?.media_url || uploadedUrl),
        mediaType: data?.media_type === 'video' ? 'video' : 'image',
        caption: data?.caption ? String(data.caption) : undefined,
        createdAt: String(data?.created_at || now.toISOString()),
      };
    },

    async deleteStory(storyId: string, userId: string) {
      const { error } = await supabase
        .from('stories')
        .delete()
        .eq('id', storyId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
  },

  social: {
    async getBlockedRelationships(userId: string) {
      const [{ data: iBlocked }, { data: blockedMe }] = await Promise.all([
        supabase
          .from('blocked_users')
          .select('blocked_id')
          .eq('blocker_id', userId),
        supabase
          .from('blocked_users')
          .select('blocker_id')
          .eq('blocked_id', userId),
      ]);

      return {
        blockedByMe: (iBlocked || [])
          .map((r: any) => String(r.blocked_id || ''))
          .filter(Boolean),
        blockingMe: (blockedMe || [])
          .map((r: any) => String(r.blocker_id || ''))
          .filter(Boolean),
      };
    },

    async blockUser(blockerId: string, blockedId: string): Promise<void> {
      const { error } = await supabase.from('blocked_users').upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: 'blocker_id,blocked_id' }
      );
      if (error) throw new Error(error.message);
    },
  },

  watch: {
    async getWatchData(userKey: string, limit = 40) {
      const [reactionsRes, subsRes, commentsRes, mediaRes] = await Promise.all([
        withTimeout<any>(
          supabase
            .from('watch_reactions')
            .select('media_id, liked, disliked, saved')
            .eq('user_key', userKey),
          4500,
          { data: [] }
        ),
        withTimeout<any>(
          supabase
            .from('watch_subscriptions')
            .select('creator_handle')
            .eq('user_key', userKey),
          4500,
          { data: [] }
        ),
        withTimeout<any>(
          supabase
            .from('watch_comments')
            .select('id, media_id, author, comment_text, created_at')
            .order('created_at', { ascending: false })
            .limit(200),
          4500,
          { data: [] }
        ),
        withTimeout<any>(
          supabase
            .from('watch_media')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit),
          4500,
          { data: [] }
        ),
      ]);

      return {
        reactions: (reactionsRes?.data || []) as WatchReactionRow[],
        subscriptions: (subsRes?.data || [])
          .map((r: any) => String(r.creator_handle || '').toLowerCase())
          .filter(Boolean),
        comments: (commentsRes?.data || []) as WatchCommentRow[],
        media: Array.isArray(mediaRes?.data) ? mediaRes.data : [],
      };
    },

    async upsertReaction(userKey: string, mediaId: string, patch) {
      await withTimeout(
        supabase
          .from('watch_reactions')
          .upsert(
            {
              user_key: userKey,
              media_id: mediaId,
              ...patch,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_key,media_id' }
          )
          .then(() => undefined),
        4500
      );

      if (patch.liked && !userKey.startsWith('guest_')) {
        supabase
          .from('watch_media')
          .select('creator_id')
          .eq('id', mediaId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.creator_id) {
              void createNotificationRecord({
                userId: String(data.creator_id),
                actorId: userKey,
                type: 'like',
                message: 'liked your video.',
                targetId: mediaId,
              });
            }
          });
      }
    },

    async setSubscription(
      userKey: string,
      creatorHandle: string,
      subscribed: boolean
    ) {
      const cleanHandle = creatorHandle.toLowerCase();
      if (subscribed) {
        await withTimeout(
          supabase
            .from('watch_subscriptions')
            .upsert(
              { user_key: userKey, creator_handle: cleanHandle },
              { onConflict: 'user_key,creator_handle' }
            )
            .then(() => undefined),
          4500
        );

        if (!userKey.startsWith('guest_')) {
          const plain = cleanHandle.replace(/^@+/, '');
          if (plain) {
            supabase
              .from('profiles')
              .select('id')
              .or(`username.ilike.${plain},username.ilike.@${plain}`)
              .limit(1)
              .then(({ data }) => {
                const ownerId = data?.[0]?.id ? String(data[0].id) : '';
                if (ownerId) {
                  void createNotificationRecord({
                    userId: ownerId,
                    actorId: userKey,
                    type: 'follow',
                    message: 'subscribed to your channel.',
                  });
                }
              });
          }
        }
      } else {
        await withTimeout(
          supabase
            .from('watch_subscriptions')
            .delete()
            .eq('user_key', userKey)
            .eq('creator_handle', cleanHandle)
            .then(() => undefined),
          4500
        );
      }
    },

    async addComment(payload) {
      const { data: authData } = await supabase.auth.getUser().catch(() => ({
        data: { user: null },
      }));
      const { error } = await supabase.from('watch_comments').insert({
        id: payload.id,
        media_id: payload.mediaId,
        author: payload.author,
        comment_text: payload.text,
      });
      if (error) throw new Error(error.message);

      if (authData?.user?.id) {
        supabase
          .from('watch_media')
          .select('creator_id')
          .eq('id', payload.mediaId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.creator_id) {
              void createNotificationRecord({
                userId: String(data.creator_id),
                actorId: authData.user!.id,
                type: 'comment',
                message: `commented: "${payload.text.slice(0, 60)}"`,
                targetId: payload.mediaId,
              });
            }
          });
      }
    },
  },

  studio: {
    async getCreatorQuickStats(userId: string) {
      const [{ count: uploadsCount }, { data: profile }, { data: mediaRows }] =
        await Promise.all([
          withTimeout<any>(
            supabase
              .from('watch_media')
              .select('id', { count: 'exact', head: true })
              .eq('creator_id', userId),
            3500,
            { count: 0 }
          ),
          withTimeout<any>(
            supabase
              .from('profiles')
              .select('followers_count')
              .eq('id', userId)
              .maybeSingle(),
            3500,
            { data: null }
          ),
          withTimeout<any>(
            supabase
              .from('watch_media')
              .select('views_count')
              .eq('creator_id', userId),
            3500,
            { data: [] }
          ),
        ]);

      const totalViews = Array.isArray(mediaRows)
        ? mediaRows.reduce(
          (sum: number, r: any) => sum + (Number(r?.views_count) || 0),
          0
        )
        : 0;

      return {
        uploads: Number(uploadsCount) || 0,
        followers: Number(profile?.followers_count) || 0,
        views: totalViews,
      };
    },

    async getDashboardData(userId: string) {
      const [profileRes, mediaRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('followers_count')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('watch_media')
          .select('*')
          .eq('creator_id', userId)
          .order('created_at', { ascending: false }),
      ]);

      const followersCount = Number(profileRes.data?.followers_count) || 0;
      const media = Array.isArray(mediaRes.data) ? mediaRes.data : [];
      let comments: any[] = [];

      if (media.length > 0) {
        const mediaIds = media.map((m: any) => String(m.id));
        const { data: cData } = await supabase
          .from('watch_comments')
          .select('id, media_id, author, comment_text, created_at')
          .in('media_id', mediaIds)
          .order('created_at', { ascending: false })
          .limit(40);

        if (Array.isArray(cData)) {
          comments = cData;
        }
      }

      return { followersCount, media, comments };
    },

    async uploadWatchFile(
      localUri: string,
      folder: string,
      ext: string,
      mimeType: string
    ): Promise<string | null> {
      const filePath = `${folder}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}.${ext}`;

      return uploadLocalFileToBucket({
        localUri,
        bucket: 'watch-media',
        filePath,
        ext,
        mimeType,
        upsert: true,
      });
    },

    async uploadAsset(
      localUri: string,
      kind: 'video' | 'thumbnail',
      userId: string,
      onProgress?: (msg: string, pct?: number) => void,
      mediaFolder: 'video' | 'reels' | 'live' = 'video'
    ): Promise<string> {
      const cleanUri = localUri.trim();
      if (!cleanUri) return '';
      if (isRemoteHttpUrl(cleanUri)) return cleanUri;

      const isVideo = kind === 'video';
      if (!isVideo && isVideoUri(cleanUri)) {
        throw new Error('Thumbnail cannot be a video file.');
      }

      const rawImgExt = guessExtension(cleanUri, 'jpg');
      const imgExt = ['png', 'webp', 'gif', 'heic', 'heif'].includes(rawImgExt)
        ? rawImgExt === 'heic' || rawImgExt === 'heif'
          ? 'jpg'
          : rawImgExt
        : 'jpg';
      const ext = isVideo ? guessExtension(cleanUri, 'mp4') : imgExt;
      const mimeType = isVideo
        ? ext === 'mov'
          ? 'video/quicktime'
          : 'video/mp4'
        : ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'image/jpeg';

      const uniqueSuffix = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const filePath = isVideo
        ? `${userId}/${mediaFolder}/${uniqueSuffix}`
        : `${userId}/${mediaFolder}/thumbnails/${uniqueSuffix}`;

      const startPct = isVideo ? 35 : 15;
      const ceilingPct = isVideo ? 78 : 30;

      onProgress?.(
        isVideo ? 'Preparing video...' : 'Preparing thumbnail...',
        startPct
      );

      let currentPct = startPct + 4;
      onProgress?.(
        isVideo ? 'Uploading video...' : `Uploading ${mediaFolder} thumbnail...`,
        currentPct
      );

      const pulseTimer = setInterval(() => {
        currentPct = Math.min(ceilingPct, currentPct + (isVideo ? 6 : 3));
        onProgress?.(
          isVideo
            ? 'Uploading video...'
            : `Uploading ${mediaFolder} thumbnail...`,
          currentPct
        );
      }, 350);

      const bucketsToTry = await getAvailableBuckets(kind);
      let lastError: any = null;

      try {
        for (const bucket of bucketsToTry) {
          try {
            const publicUrl = await uploadLocalFileToBucket({
              localUri: cleanUri,
              bucket,
              filePath,
              ext,
              mimeType,
              upsert: true,
            });
            onProgress?.(
              isVideo ? 'Video uploaded' : 'Thumbnail uploaded',
              isVideo ? 80 : 32
            );
            return publicUrl;
          } catch (uploadErr: any) {
            lastError = uploadErr;
          }
        }
      } finally {
        clearInterval(pulseTimer);
      }

      throw (
        lastError ||
        new Error(`Failed to upload ${kind} to Supabase Storage.`)
      );
    },

    async upsertWatchMedia(
      payload: Record<string, any>,
      existingId?: string | null
    ): Promise<any> {
      const targetId = existingId || payload.id;
      const safeMediaUrl =
        typeof payload.media_url === 'string' && payload.media_url.trim()
          ? payload.media_url.trim()
          : 'pending://video';
      const safeThumbUrl =
        typeof payload.thumbnail_url === 'string' &&
          payload.thumbnail_url.trim() &&
          !isVideoUri(payload.thumbnail_url)
          ? payload.thumbnail_url.trim()
          : null;

      const baseWithId = {
        ...payload,
        ...(targetId ? { id: targetId } : {}),
        media_url: safeMediaUrl,
        thumbnail_url: safeThumbUrl,
      };

      const stripExtended = (src: Record<string, any>) => {
        const copy = { ...src };
        delete copy.meta_text;
        delete copy.scheduled_at;
        delete copy.is_premiere;
        delete copy.location;
        delete copy.playlist_name;
        delete copy.collaborators;
        delete copy.pinned_comment;
        delete copy.thumbnail_b_url;
        delete copy.auto_captions;
        delete copy.paid_promotion;
        delete copy.allow_downloads;
        delete copy.age_restricted;
        delete copy.made_for_kids;
        return copy;
      };

      const candidatePayloads: Record<string, any>[] = [
        { ...baseWithId },
        stripExtended(baseWithId),
        (() => {
          const copy = stripExtended(baseWithId);
          delete copy.visibility;
          delete copy.thumbnail_time_sec;
          delete copy.total_seconds;
          return copy;
        })(),
        (() => {
          const copy = stripExtended(baseWithId);
          delete copy.visibility;
          delete copy.thumbnail_time_sec;
          delete copy.total_seconds;
          delete copy.thumbnail_mode;
          delete copy.show_likes;
          delete copy.show_views;
          delete copy.monetize;
          delete copy.allow_comments;
          return copy;
        })(),
        (() => {
          const copy = stripExtended(baseWithId);
          delete copy.visibility;
          delete copy.thumbnail_time_sec;
          delete copy.total_seconds;
          delete copy.thumbnail_mode;
          delete copy.show_likes;
          delete copy.show_views;
          delete copy.monetize;
          delete copy.allow_comments;
          delete copy.tags;
          delete copy.badge_text;
          delete copy.orientation;
          return copy;
        })(),
      ];

      let lastErr: any = null;
      for (const body of candidatePayloads) {
        const { data, error } = targetId
          ? await supabase
            .from('watch_media')
            .upsert(body, { onConflict: 'id' })
            .select()
            .single()
          : await supabase.from('watch_media').insert(body).select().single();

        if (!error && data) {
          return data;
        }
        lastErr = error;
      }

      throw (
        lastErr || new Error('Failed to save video record to watch_media.')
      );
    },

    async updateWatchMedia(
      mediaId: string,
      patch: Record<string, any>
    ): Promise<void> {
      const { error } = await supabase
        .from('watch_media')
        .update(patch)
        .eq('id', mediaId);
      if (error) throw new Error(error.message);
    },

    async deleteWatchMedia(mediaId: string): Promise<void> {
      const { error } = await supabase
        .from('watch_media')
        .delete()
        .eq('id', mediaId);
      if (error) throw new Error(error.message);
    },

    async deleteWatchComment(commentId: string): Promise<void> {
      const { error } = await supabase
        .from('watch_comments')
        .delete()
        .eq('id', commentId);
      if (error) throw new Error(error.message);
    },
  },

  connect: {
    async getProfiles(excludeUserId: string | null, searchPattern?: string) {
      let q = supabase.from('profiles').select('*').limit(100);
      if (excludeUserId) q = q.neq('id', excludeUserId);
      if (searchPattern) {
        q = q.or(
          `full_name.ilike.${searchPattern},username.ilike.${searchPattern},city.ilike.${searchPattern},location.ilike.${searchPattern}`
        );
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },

    async getMyCoordinates(userId: string) {
      const { data } = await supabase
        .from('profiles')
        .select('latitude, longitude')
        .eq('id', userId)
        .maybeSingle();

      return {
        lat: typeof data?.latitude === 'number' ? data.latitude : null,
        lng: typeof data?.longitude === 'number' ? data.longitude : null,
      };
    },

    async getRelations(userId: string) {
      const [followingRes, blockedRes, mutedRes, incomingRes] =
        await Promise.all([
          supabase
            .from('follows')
            .select('following_id, status')
            .eq('follower_id', userId),
          supabase
            .from('blocked_users')
            .select('blocked_id')
            .eq('blocker_id', userId),
          supabase
            .from('muted_users')
            .select('muted_id')
            .eq('muter_id', userId),
          supabase
            .from('follows')
            .select('id, follower_id, status')
            .eq('following_id', userId)
            .eq('status', 'pending'),
        ]);

      const followingIds: string[] = [];
      const requestedIds: string[] = [];
      for (const r of followingRes.data || []) {
        if (!r.following_id) continue;
        if (r.status === 'pending') requestedIds.push(r.following_id);
        else followingIds.push(r.following_id);
      }

      return {
        followingIds,
        requestedIds,
        blockedIds: (blockedRes.data || [])
          .map((r: any) => r.blocked_id)
          .filter(Boolean),
        mutedIds: (mutedRes.data || [])
          .map((r: any) => r.muted_id)
          .filter(Boolean),
        incomingRequests: (incomingRes.data || []).map((r: any) => ({
          id: r.id,
          follower_id: r.follower_id,
        })),
      };
    },

    async getConnectionsTabData(
      profileId: string,
      tab: 'followers' | 'following' | 'subscriptions',
      currentAuthId: string | null
    ) {
      const [followersRes, followingRes, subData, myFollowingRes] =
        await Promise.all([
          supabase
            .from('follows')
            .select('follower_id')
            .eq('following_id', profileId)
            .or('status.eq.accepted,status.is.null'),
          supabase
            .from('follows')
            .select('following_id')
            .eq('follower_id', profileId)
            .or('status.eq.accepted,status.is.null'),
          fetchSubscriptionMeta(profileId),
          currentAuthId
            ? supabase
              .from('follows')
              .select('following_id')
              .eq('follower_id', currentAuthId)
              .or('status.eq.accepted,status.is.null')
            : Promise.resolve({ data: [] as any[] }),
        ]);

      const followerIds = Array.from(
        new Set(
          (followersRes.data || [])
            .map((r: any) => r.follower_id)
            .filter(Boolean)
        )
      );
      const followingIds = Array.from(
        new Set(
          (followingRes.data || [])
            .map((r: any) => r.following_id)
            .filter(Boolean)
        )
      );
      const myFollowingIds = Array.from(
        new Set<string>(
          ((myFollowingRes as any)?.data || [])
            .map((r: any) => String(r.following_id || ''))
            .filter(Boolean)
        )
      );

      const targetIds =
        tab === 'followers'
          ? followerIds
          : tab === 'following'
            ? followingIds
            : subData.ids;

      const metaById = tab === 'subscriptions' ? subData.metaById : {};
      let users: any[] = [];

      if (targetIds.length > 0) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, bio')
          .in('id', targetIds);

        if (error) throw new Error(error.message);

        const map = new Map((data || []).map((p: any) => [p.id, p]));
        users = targetIds
          .map((id) => {
            const p = map.get(id);
            if (!p) return null;
            const subMeta = metaById[id] || {};
            return {
              ...p,
              plan_name: subMeta.plan_name || subMeta.tier || 'Active Plan',
              status: subMeta.status || 'active',
              expires_at: subMeta.expires_at || subMeta.ends_at || null,
              created_at: subMeta.created_at || null,
            };
          })
          .filter(Boolean);
      }

      return {
        followersCount: followerIds.length,
        followingCount: followingIds.length,
        subscriptionsCount: subData.ids.length,
        myFollowingIds,
        users,
      };
    },

    async followUser(followerId: string, followingId: string, isPrivate = false) {
      const nextStatus = isPrivate ? 'pending' : 'accepted';
      const { error } = await supabase.from('follows').upsert(
        {
          follower_id: followerId,
          following_id: followingId,
          status: nextStatus,
        },
        { onConflict: 'follower_id,following_id' }
      );
      if (error) throw new Error(error.message);

      void createNotificationRecord({
        userId: followingId,
        actorId: followerId,
        type: 'follow',
        message: isPrivate
          ? 'requested to follow you.'
          : 'started following you.',
      });

      if (!isPrivate) {
        await Promise.all([
          syncProfileFollowCounters(followerId),
          syncProfileFollowCounters(followingId),
        ]);
      }
      return nextStatus;
    },

    async unfollowUser(followerId: string, followingId: string) {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', followerId)
        .eq('following_id', followingId);
      if (error) throw new Error(error.message);

      await Promise.all([
        syncProfileFollowCounters(followerId),
        syncProfileFollowCounters(followingId),
      ]);
    },

    async acceptFollowRequest(
      requestId: string,
      myId: string,
      requesterId: string
    ) {
      const { error } = await supabase
        .from('follows')
        .update({ status: 'accepted' })
        .eq('id', requestId);
      if (error) throw new Error(error.message);

      void createNotificationRecord({
        userId: requesterId,
        actorId: myId,
        type: 'follow',
        message: 'accepted your follow request.',
      });

      await Promise.all([
        syncProfileFollowCounters(myId),
        syncProfileFollowCounters(requesterId),
      ]);
    },

    async acceptAllFollowRequests(requestIds: string[], myId: string) {
      const { data: reqRows } = await supabase
        .from('follows')
        .select('id, follower_id')
        .in('id', requestIds);

      const { error } = await supabase
        .from('follows')
        .update({ status: 'accepted' })
        .in('id', requestIds);
      if (error) throw new Error(error.message);

      const requesterIds = Array.from(
        new Set(
          (reqRows || []).map((r: any) => r.follower_id).filter(Boolean)
        )
      );
      await Promise.all([
        syncProfileFollowCounters(myId),
        ...requesterIds.map((rid) => syncProfileFollowCounters(rid)),
      ]);
    },

    async declineFollowRequest(
      requestId: string,
      myId: string,
      requesterId: string
    ) {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('id', requestId);
      if (error) throw new Error(error.message);

      await Promise.all([
        syncProfileFollowCounters(myId),
        syncProfileFollowCounters(requesterId),
      ]);
    },

    async setUserMuted(muterId: string, mutedId: string, muted: boolean) {
      if (muted) {
        const { error } = await supabase.from('muted_users').upsert(
          { muter_id: muterId, muted_id: mutedId },
          { onConflict: 'muter_id,muted_id' }
        );
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('muted_users')
          .delete()
          .eq('muter_id', muterId)
          .eq('muted_id', mutedId);
        if (error) throw new Error(error.message);
      }
    },

    async blockAndUnfollow(blockerId: string, blockedId: string) {
      const { error } = await supabase.from('blocked_users').upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: 'blocker_id,blocked_id' }
      );
      if (error) throw new Error(error.message);

      await supabase
        .from('follows')
        .delete()
        .or(
          `and(follower_id.eq.${blockerId},following_id.eq.${blockedId}),and(follower_id.eq.${blockedId},following_id.eq.${blockerId})`
        );

      await Promise.all([
        syncProfileFollowCounters(blockerId),
        syncProfileFollowCounters(blockedId),
      ]);
    },

    async sendWave(actorId: string, targetUserId: string) {
      const { data: actor } = await supabase
        .from('profiles')
        .select('full_name, username, avatar_url')
        .eq('id', actorId)
        .maybeSingle();

      const { error } = await supabase.from('notifications').insert({
        user_id: targetUserId,
        actor_id: actorId,
        actor_name: actor?.full_name || actor?.username || null,
        actor_username: actor?.username || null,
        actor_avatar: actor?.avatar_url || null,
        type: 'wave',
        message: 'waved at you!',
        is_read: false,
      });
      if (error) throw new Error(error.message);
    },

    subscribeFollowChanges(userId: string, onChange: () => void) {
      const channelId = `connect-follows-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const channel = supabase
        .channel(channelId)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'follows' },
          onChange
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    },
  },

  profile: {
    async getProfileById(profileId: string) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data;
    },

    async upsertProfile(userId: string, fields: Record<string, any>) {
      const safeFields = { ...fields };
      delete safeFields.is_verified;
      delete safeFields.verified_at;
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: userId, ...safeFields }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    },

    async isUsernameAvailableForUser(
      plainHandle: string,
      currentUserId: string | null
    ) {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .or(`username.ilike.${plainHandle},username.ilike.@${plainHandle}`)
        .limit(5);

      const takenByOther = (data || []).some(
        (row: any) => String(row.id) !== String(currentUserId || '')
      );
      return !takenByOther;
    },

    async getFollowRelationship(viewerId: string, viewedId: string) {
      const [rel1, rel2] = await Promise.all([
        supabase
          .from('follows')
          .select('id')
          .eq('follower_id', viewerId)
          .eq('following_id', viewedId)
          .limit(1),
        supabase
          .from('follows')
          .select('id')
          .eq('follower_id', viewedId)
          .eq('following_id', viewerId)
          .limit(1),
      ]);

      return {
        isFollowing: Boolean(rel1.data && rel1.data.length > 0),
        isFollowedBy: Boolean(rel2.data && rel2.data.length > 0),
      };
    },

    async getBlockStatus(viewerId: string, viewedId: string) {
      const [b1, b2] = await Promise.all([
        supabase
          .from('blocked_users')
          .select('id')
          .eq('blocker_id', viewerId)
          .eq('blocked_id', viewedId)
          .limit(1),
        supabase
          .from('blocked_users')
          .select('id')
          .eq('blocker_id', viewedId)
          .eq('blocked_id', viewerId)
          .limit(1),
      ]);

      return {
        isBlockedByMe: Boolean(b1.data && b1.data.length > 0),
        isBlockingMe: Boolean(b2.data && b2.data.length > 0),
      };
    },

    async unblockUser(blockerId: string, blockedId: string) {
      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId);
      if (error) throw new Error(error.message);
    },

    async getProfileCounts(profileId: string) {
      const [profRes, followersCountRes, followingCountRes, subsCount] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('followers_count, following_count')
            .eq('id', profileId)
            .maybeSingle(),
          supabase
            .from('follows')
            .select('id', { count: 'exact', head: true })
            .eq('following_id', profileId),
          supabase
            .from('follows')
            .select('id', { count: 'exact', head: true })
            .eq('follower_id', profileId),
          fetchSubscriptionCount(profileId),
        ]);

      const prof = profRes.data;
      return {
        followersCount:
          typeof prof?.followers_count === 'number'
            ? prof.followers_count
            : typeof followersCountRes.count === 'number'
              ? followersCountRes.count
              : null,
        followingCount:
          typeof prof?.following_count === 'number'
            ? prof.following_count
            : typeof followingCountRes.count === 'number'
              ? followingCountRes.count
              : null,
        subscriptionsCount: subsCount,
      };
    },

    async getPrivacySettings(profileId: string) {
      const { data } = await supabase
        .from('profiles')
        .select('privacy_settings')
        .eq('id', profileId)
        .maybeSingle();

      const ps = data?.privacy_settings;
      if (!ps || typeof ps !== 'object') return null;

      return {
        ...ps,
        profileViewAlerts: Boolean(ps.profileViewAlerts),
        preventScreenshots: Boolean(ps.preventScreenshots),
        screenshotAlerts: Boolean(ps.screenshotAlerts),
      };
    },

    async sendNotification(payload) {
      await createNotificationRecord({
        userId: payload.userId,
        actorId: payload.actorId,
        type: payload.type,
        message: payload.message,
      });
    },

    subscribeProfileRow(profileId: string, onUpdate: (row: any) => void) {
      const channelId = `profile-row-${profileId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const channel = supabase
        .channel(channelId)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${profileId}`,
          },
          (payload) => onUpdate(payload.new)
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    },

    async getProfileContent(profileId: string, viewerId: string | null) {
      const [postsRes, watchRes, liveRes, subMeta] = await Promise.all([
        supabase
          .from('posts')
          .select('*')
          .or(`author_id.eq.${profileId},user_id.eq.${profileId}`)
          .order('created_at', { ascending: false })
          .limit(60),
        supabase
          .from('watch_media')
          .select('*')
          .eq('creator_id', profileId)
          .order('created_at', { ascending: false })
          .limit(60),
        supabase
          .from('live_streams')
          .select('*')
          .eq('host_id', profileId)
          .order('created_at', { ascending: false })
          .limit(30),
        viewerId
          ? fetchSubscriptionMeta(viewerId)
          : Promise.resolve({ ids: [] as string[], metaById: {} }),
      ]);

      const isSelf = Boolean(viewerId && viewerId === profileId);
      const isSubscribed = subMeta.ids.includes(profileId);

      const canSee = (vis?: string | null) => {
        const v = String(vis || 'public').toLowerCase();
        if (isSelf) return true;
        if (v === 'private') return false;
        if (v === 'subscribers' || v === 'subscriptions') return isSubscribed;
        return true;
      };

      const formatViews = (val: any): string => {
        const n = Number(val) || 0;
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
        return String(n);
      };

      const formatRelative = (iso?: string | null): string => {
        if (!iso) return 'Recently';
        const diffSec = Math.max(
          0,
          Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
        );
        if (diffSec < 60) return 'Just now';
        const mins = Math.floor(diffSec / 60);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
      };

      const formatDur = (sec?: number | null): string | undefined => {
        if (typeof sec !== 'number' || sec <= 0) return undefined;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
      };

      const defaultThumb =
        'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&q=80&w=600';

      const posts: Array<{
        id: string;
        title: string;
        views?: string;
        duration?: string;
        thumbnail: string;
        type: 'post' | 'video' | 'short';
        uploadDate?: string;
      }> = [];
      const videos: typeof posts = [];
      const live: typeof posts = [];

      for (const row of postsRes.data || []) {
        if (!canSee(row.visibility)) continue;
        const thumb =
          (Array.isArray(row.photos) && row.photos[0]) ||
          row.media_url ||
          defaultThumb;
        posts.push({
          id: String(row.id),
          title: String(row.caption || 'Post'),
          thumbnail: String(thumb),
          type: 'post',
          uploadDate: formatRelative(row.created_at),
        });
      }

      for (const row of watchRes.data || []) {
        if (!canSee(row.visibility)) continue;
        const isReel =
          row.format === 'reel' ||
          row.mode === 'reel' ||
          row.orientation === 'vertical';
        const isLiveItem = Boolean(row.is_live) || row.mode === 'live';
        const rawThumb = String(row.thumbnail_url || row.cover_url || '').trim();
        const isStockThumb =
          !rawThumb || rawThumb.includes('images.unsplash.com');
        const thumb = isLiveItem
          ? isStockThumb
            ? ''
            : rawThumb
          : rawThumb || defaultThumb;
        const entry = {
          id: String(row.id),
          title: String(row.title || 'Untitled'),
          views: formatViews(row.views_count),
          duration: formatDur(row.total_seconds),
          thumbnail: thumb,
          type: (isReel ? 'short' : 'video') as 'post' | 'video' | 'short',
          uploadDate: formatRelative(row.created_at),
        };

        if (isLiveItem) {
          live.push(entry);
        } else if (isReel) {
          posts.push(entry);
        } else {
          videos.push(entry);
        }
      }

      for (const ls of liveRes.data || []) {
        live.push({
          id: String(ls.id),
          title: String(ls.title || 'Live Stream'),
          views: formatViews(ls.viewer_count),
          thumbnail: '',
          type: 'video',
          uploadDate: ls.is_live
            ? 'Live now'
            : `Streamed ${formatRelative(ls.created_at)}`,
        });
      }

      return { posts, videos, live };
    },

    async getVerificationStatus(userId: string) {
      const [{ data: approvedRows }, { data: reqData }] = await Promise.all([
        supabase
          .from('verification_requests')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'approved')
          .limit(1),
        supabase
          .from('verification_requests')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        isVerified: Boolean(approvedRows && approvedRows.length > 0),
        latestRequest: (reqData as any) || null,
      };
    },

    async submitVerificationRequest(payload: {
      userId: string;
      fullName: string;
      username?: string;
      category: string;
      reason: string;
      documentUrl?: string;
    }) {
      const { data: approvedExisting } = await supabase
        .from('verification_requests')
        .select('id')
        .eq('user_id', payload.userId)
        .eq('status', 'approved')
        .limit(1);

      if (approvedExisting && approvedExisting.length > 0) {
        throw new Error('Your account already has an approved Blue Tick.');
      }

      const { data: existingPending } = await supabase
        .from('verification_requests')
        .select('id')
        .eq('user_id', payload.userId)
        .eq('status', 'pending')
        .limit(1);

      if (existingPending && existingPending.length > 0) {
        throw new Error(
          'You already have a pending verification request under review.'
        );
      }

      const { data, error } = await supabase
        .from('verification_requests')
        .insert({
          user_id: payload.userId,
          full_name: payload.fullName.trim(),
          username: (payload.username || '').trim() || null,
          category: payload.category.trim() || 'Creator',
          reason: payload.reason.trim(),
          document_url: (payload.documentUrl || '').trim() || null,
          status: 'pending',
        })
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(
          error?.message || 'Unable to submit verification request.'
        );
      }
      return data as any;
    },
  },

  settings: {
    async getBlockedUsers(blockerId: string) {
      const { data: blocks, error } = await supabase
        .from('blocked_users')
        .select('id, blocked_id')
        .eq('blocker_id', blockerId);

      if (error || !blocks || blocks.length === 0) {
        return [];
      }

      const blockedIds = blocks.map((b: any) => b.blocked_id).filter(Boolean);
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .in('id', blockedIds);

      const profileMap = new Map<string, any>();
      for (const p of profilesData || []) {
        profileMap.set(p.id, p);
      }

      return blocks.map((b: any) => {
        const prof = profileMap.get(b.blocked_id);
        return {
          id: String(b.id),
          blocked_id: String(b.blocked_id),
          name: prof?.full_name || 'Blocked Member',
          handle: prof?.username
            ? prof.username.startsWith('@')
              ? prof.username
              : `@${prof.username}`
            : '@user',
        };
      });
    },

    async getPrivacySettings(userId: string) {
      const { data, error } = await supabase
        .from('profiles')
        .select('privacy_settings')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data?.privacy_settings) return null;
      return data.privacy_settings as Record<string, any>;
    },

    async savePrivacySettings(
      userId: string,
      privacySettings: Record<string, any>,
      flatColumns?: Record<string, any>
    ) {
      const { error } = await supabase
        .from('profiles')
        .update({
          privacy_settings: privacySettings,
          ...(flatColumns || {}),
        })
        .eq('id', userId);

      if (error && flatColumns) {
        const { error: fallbackErr } = await supabase
          .from('profiles')
          .update({ privacy_settings: privacySettings })
          .eq('id', userId);
        if (fallbackErr) throw new Error(fallbackErr.message);
      } else if (error) {
        throw new Error(error.message);
      }
    },
  },

  notifications: {
    async getNotifications(userId: string, limit = 60) {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .neq('type', 'message')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) return [];
      return Array.isArray(data) ? data : [];
    },

    async markAsRead(notificationId: string) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
    },

    async markAllAsRead(userId: string) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);
    },

    async deleteNotification(notificationId: string) {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);
      if (error) throw new Error(error.message);
    },

    subscribeNotifications(userId: string, onInsert: (row: any) => void) {
      const channelId = `notifications-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const channel = supabase
        .channel(channelId)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (payload?.new) onInsert(payload.new);
          }
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    },
  },

  chats: {
    async touchLastSeen(userId: string) {
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', userId);
    },

    async getConversationMessages(userId: string): Promise<ChatMessageRecord[]> {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error || !Array.isArray(data)) return [];
      return data as ChatMessageRecord[];
    },

    async getPeerProfiles(
      excludeUserId: string | null
    ): Promise<ChatUserProfile[]> {
      let query = supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (excludeUserId) {
        query = query.neq('id', excludeUserId);
      }

      const { data, error } = await query;
      if (error || !Array.isArray(data)) return [];
      return data as ChatUserProfile[];
    },

    async markThreadRead(userId: string, peerId: string) {
      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('sender_id', peerId)
        .eq('receiver_id', userId)
        .eq('is_read', false);
    },

    async deleteConversation(userId: string, peerId: string) {
      await supabase
        .from('messages')
        .delete()
        .or(
          `and(sender_id.eq.${userId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${userId})`
        );
    },

    async upsertPreferences(
      userId: string,
      peerId: string,
      patch: Record<string, any>
    ) {
      await supabase.from('chat_preferences').upsert(
        {
          user_id: userId,
          peer_id: peerId,
          ...patch,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,peer_id' }
      );
    },

    subscribeInboxEvents(userId: string, handlers) {
      const channelId = `chats-list-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const channel = supabase
        .channel(channelId)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            if (payload?.new) {
              handlers.onMessageInsert(payload.new as ChatMessageRecord);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          (payload) => {
            if (payload?.new) {
              handlers.onMessageUpdate(payload.new as ChatMessageRecord);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles' },
          (payload) => {
            if (payload?.new) {
              handlers.onProfileUpdate(payload.new as ChatUserProfile);
            }
          }
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    },
  },

  messages: {
    async areMutualFollowers(meId: string, peerId: string): Promise<boolean> {
      const [{ data: iFollowPeer }, { data: peerFollowsMe }] =
        await Promise.all([
          supabase
            .from('follows')
            .select('id')
            .eq('follower_id', meId)
            .eq('following_id', peerId)
            .eq('status', 'accepted')
            .maybeSingle(),
          supabase
            .from('follows')
            .select('id')
            .eq('follower_id', peerId)
            .eq('following_id', meId)
            .eq('status', 'accepted')
            .maybeSingle(),
        ]);

      return Boolean(iFollowPeer && peerFollowsMe);
    },

    async markMessagesSeen(myId: string, senderId: string, seenIso: string) {
      await supabase
        .from('messages')
        .update({ is_read: true, seen_at: seenIso })
        .eq('sender_id', senderId)
        .eq('receiver_id', myId)
        .eq('is_read', false);
    },

    async getThreadMessages(
      myId: string,
      peerId: string
    ): Promise<ChatMessageRecord[]> {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${myId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${myId})`
        )
        .order('created_at', { ascending: true });

      if (error || !Array.isArray(data)) return [];
      return data as ChatMessageRecord[];
    },

    async sendMessage({
      senderId,
      receiverId,
      content,
    }): Promise<ChatMessageRecord | null> {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          sender_id: senderId,
          receiver_id: receiverId,
          content,
          text: content,
          is_read: false,
          seen_at: null,
        })
        .select('*')
        .single();

      if (error) throw new Error(error.message);

      const isCallLogContent =
        content.startsWith('📞 Voice Call') ||
        content.startsWith('📹 Video Call');
      const isScreenshotContent = content === '📸 Screenshot taken of this chat';

      let pushBody = content;
      if (content.startsWith('📷 Photo::')) {
        pushBody = 'Sent you a photo';
      } else if (content.startsWith('🎥 Video::')) {
        pushBody = 'Sent you a video';
      } else if (content.startsWith('🎤 Voice Note')) {
        pushBody = 'Sent you a voice note';
      } else if (content.startsWith('📍 Location::')) {
        pushBody = 'Shared their location';
      } else if (content.startsWith('👁️ View-Once')) {
        pushBody = 'Sent a view-once message';
      }

      // Message alerts go straight to the user's phone notification tray (push/local),
      // NOT the in-app Notifications feed.
      if (data?.id && !isCallLogContent && !isScreenshotContent) {
        void (async () => {
          try {
            const [{ data: senderProf }, { data: receiverProf }] =
              await Promise.all([
                supabase
                  .from('profiles')
                  .select('full_name, username')
                  .eq('id', senderId)
                  .maybeSingle(),
                supabase
                  .from('profiles')
                  .select('expo_push_token')
                  .eq('id', receiverId)
                  .maybeSingle(),
              ]);
            const pushToken = String(
              receiverProf?.expo_push_token || ''
            ).trim();
            if (!pushToken) return;
            const senderTitle =
              String(
                senderProf?.full_name || senderProf?.username || 'New Message'
              ).trim() || 'New Message';
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                to: pushToken,
                sound: 'default',
                title: senderTitle,
                body: pushBody,
                channelId: 'messages',
                data: {
                  route: 'messages',
                  userId: senderId,
                  name: senderTitle,
                },
              }),
            });
          } catch {
            // Best-effort push delivery
          }
        })();
      }
      return (data as ChatMessageRecord) || null;
    },

    async updateMessageText(messageId: string, text: string) {
      await supabase
        .from('messages')
        .update({ content: text, text })
        .eq('id', messageId);
    },

    async deleteMessageById(messageId: string) {
      await supabase.from('messages').delete().eq('id', messageId);
    },

    async savePushToken(userId: string, token: string) {
      await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', userId);
    },

    async sendDirectAlert(
      recipientUserId: string,
      event: string,
      payload: Record<string, any>
    ) {
      const directCh = supabase.channel(`user-alerts-${recipientUserId}`);
      directCh.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void directCh.send({
            type: 'broadcast',
            event,
            payload,
          });
          setTimeout(() => {
            void supabase.removeChannel(directCh);
          }, 1500);
        }
      });
    },

    async triggerCallPush(payload) {
      await supabase.functions.invoke('send-call-push', { body: payload });
    },

    subscribeThreadMessages(myId: string, peerId: string, handlers) {
      const channelId = `chat-thread-${myId}-${peerId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const msgChannel = supabase
        .channel(channelId)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (msgPayload) => {
            const row = msgPayload.new as ChatMessageRecord;
            const matchesThread =
              (row.sender_id === myId && row.receiver_id === peerId) ||
              (row.sender_id === peerId && row.receiver_id === myId);
            if (matchesThread) {
              handlers.onInsert(row);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          (msgPayload) => {
            if (msgPayload?.new) {
              handlers.onUpdate(msgPayload.new as ChatMessageRecord);
            }
          }
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(msgChannel);
      };
    },

    joinRoomChannel(
      myId: string,
      peerId: string,
      onEvent: (event: string, payload: any) => void
    ): ChatRoomChannel {
      const roomName = getRoomChannelName(myId, peerId);
      const roomChannel = supabase.channel(roomName);

      const events = [
        'typing',
        'screenshot_taken',
        'call_capture_attempt',
        'call_type_switch',
        'call_invite',
        'call_ringing',
        'call_accept',
        'call_reject',
        'call_end',
        'webrtc_offer',
        'webrtc_answer',
        'webrtc_ice',
      ];

      for (const ev of events) {
        roomChannel.on('broadcast', { event: ev }, ({ payload }) => {
          onEvent(ev, payload);
        });
      }

      roomChannel.subscribe();

      return {
        send: (msg) => roomChannel.send(msg),
        unsubscribe: () => {
          void supabase.removeChannel(roomChannel);
        },
      };
    },
  },

  live: {
    async getCurrentUserLiveProfile() {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, username, avatar_url, followers_count')
        .eq('id', user.id)
        .maybeSingle();

      const metaName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        (user.email ? user.email.split('@')[0] : undefined);

      const resolvedName =
        profile?.full_name?.trim() ||
        profile?.username?.trim() ||
        metaName?.trim() ||
        'Creator';

      const resolvedAvatar =
        profile?.avatar_url?.trim() ||
        (user.user_metadata?.avatar_url as string | undefined)?.trim() ||
        (user.user_metadata?.picture as string | undefined)?.trim() ||
        undefined;

      return {
        userId: user.id,
        name: resolvedName,
        avatarUri: resolvedAvatar,
        followersCount: Number(profile?.followers_count) || 0,
      };
    },

    async getRoomBundle(streamId: string, isHost: boolean) {
      const [{ data: streamRow }, { data: msgRows }, reqRes] =
        await Promise.all([
          supabase
            .from('live_streams')
            .select('id, title, viewer_count, is_live')
            .eq('id', streamId)
            .maybeSingle(),
          supabase
            .from('live_messages')
            .select('id, username, message, color')
            .eq('stream_id', streamId)
            .order('created_at', { ascending: true })
            .limit(120),
          isHost
            ? supabase
              .from('live_join_requests')
              .select('id, username, status')
              .eq('stream_id', streamId)
              .eq('status', 'pending')
              .order('created_at', { ascending: true })
            : Promise.resolve({ data: [] as any[] }),
        ]);

      return {
        stream: (streamRow as LiveStreamRecord) || null,
        messages: Array.isArray(msgRows)
          ? (msgRows as LiveChatMessageRecord[])
          : [],
        pendingRequests: Array.isArray(reqRes?.data)
          ? (reqRes.data as LiveJoinRequestRecord[])
          : [],
      };
    },

    async createStreamSession({ hostName, title }) {
      const { data: authData } = await supabase.auth.getUser().catch(() => ({
        data: { user: null },
      }));
      const { data, error } = await supabase
        .from('live_streams')
        .insert({
          host_id: authData?.user?.id ?? null,
          host_name: hostName,
          title,
          is_live: true,
          viewer_count: 1,
        })
        .select('id, title, viewer_count, is_live')
        .single();

      if (error) throw new Error(error.message);
      return (data as LiveStreamRecord) || null;
    },

    async updateStreamStatus(streamId: string, patch: Record<string, any>) {
      const { error } = await supabase
        .from('live_streams')
        .update(patch)
        .eq('id', streamId);
      if (error) throw new Error(error.message);
    },

    async sendChatMessage({ streamId, username, message, color }) {
      const { data, error } = await supabase
        .from('live_messages')
        .insert({
          stream_id: streamId,
          username,
          message,
          color,
        })
        .select('id, username, message, color')
        .single();

      if (error) throw new Error(error.message);
      return (data as LiveChatMessageRecord) || null;
    },

    async deleteChatMessage(messageId: string) {
      const { error } = await supabase
        .from('live_messages')
        .delete()
        .eq('id', messageId);
      if (error) throw new Error(error.message);
    },

    async createJoinRequest({ streamId, username }) {
      const { data, error } = await supabase
        .from('live_join_requests')
        .insert({
          stream_id: streamId,
          username,
          status: 'pending',
        })
        .select('id, username, status')
        .single();

      if (error) throw new Error(error.message);
      return (data as LiveJoinRequestRecord) || null;
    },

    async updateJoinRequestStatus(
      requestId: string,
      status: 'accepted' | 'declined'
    ) {
      const { error } = await supabase
        .from('live_join_requests')
        .update({ status })
        .eq('id', requestId);
      if (error) throw new Error(error.message);
    },

    async uploadRecordingReplay(
      fileUri: string,
      streamId?: string
    ): Promise<string | null> {
      try {
        const cleanUri = fileUri.trim();
        if (!cleanUri) return null;

        const fileInfo = await FileSystem.getInfoAsync(cleanUri);
        if (!fileInfo.exists) return null;
        if (typeof (fileInfo as any).size === 'number' && (fileInfo as any).size < 1024) {
          return null;
        }

        const fileName = `live-replay-${streamId || 'session'}-${Date.now()}.mp4`;
        const publicUrl = await uploadLocalFileToBucket({
          localUri: cleanUri,
          bucket: 'live-recordings',
          filePath: fileName,
          ext: 'mp4',
          mimeType: 'video/mp4',
          upsert: true,
        });

        if (streamId && publicUrl) {
          await supabase
            .from('live_streams')
            .update({ recording_url: publicUrl })
            .eq('id', streamId);
        }

        return publicUrl;
      } catch {
        return null;
      }
    },

    joinLiveRoom(
      streamId: string,
      presenceKey: string,
      handlers
    ): LiveRoomChannel {
      const channel = supabase.channel(`live-room-${streamId}`, {
        config: { presence: { key: presenceKey } },
      });

      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_messages',
            filter: `stream_id=eq.${streamId}`,
          },
          (payload) => {
            if (payload?.new) {
              handlers.onMessageInsert(payload.new as LiveChatMessageRecord);
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'live_messages',
            filter: `stream_id=eq.${streamId}`,
          },
          (payload) => {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) handlers.onMessageDelete(oldId);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_join_requests',
            filter: `stream_id=eq.${streamId}`,
          },
          (payload) => {
            if (payload?.new) {
              handlers.onJoinRequestInsert(
                payload.new as LiveJoinRequestRecord
              );
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'live_join_requests',
            filter: `stream_id=eq.${streamId}`,
          },
          (payload) => {
            if (payload?.new) {
              handlers.onJoinRequestUpdate(
                payload.new as LiveJoinRequestRecord
              );
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'live_streams',
            filter: `id=eq.${streamId}`,
          },
          (payload) => {
            if (payload?.new) {
              handlers.onStreamUpdate(payload.new as LiveStreamRecord);
            }
          }
        )
        .on('broadcast', { event: 'live_reaction' }, ({ payload }) => {
          handlers.onBroadcast('live_reaction', payload);
        })
        .on('broadcast', { event: 'live_gift_banner' }, ({ payload }) => {
          handlers.onBroadcast('live_gift_banner', payload);
        })
        .on('broadcast', { event: 'live_studio_state' }, ({ payload }) => {
          handlers.onBroadcast('live_studio_state', payload);
        })
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState() as Record<string, any[]>;
          const list: LivePresenceEntry[] = [];
          Object.entries(state).forEach(([key, entries]) => {
            const meta = entries?.[0];
            if (meta) {
              list.push({
                key,
                name: meta.name || 'Viewer',
                role: meta.role || 'viewer',
              });
            }
          });
          handlers.onPresenceSync(list);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            handlers.onSubscribed();
          }
        });

      return {
        send: (msg) => {
          void channel.send(msg);
        },
        track: (state) => {
          void channel.track(state);
        },
        unsubscribe: () => {
          void supabase.removeChannel(channel);
        },
      };
    },
  },
};