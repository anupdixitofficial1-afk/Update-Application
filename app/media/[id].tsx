import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../lib/supabase';
import { backend } from '../../lib/backend';

const { width } = Dimensions.get('window');

const DEFAULT_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';
const DEFAULT_MEDIA_COVER =
  'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&q=80&w=800';

interface MediaComment {
  id: string;
  user: string;
  avatar: string;
  text: string;
  time: string;
}

interface ResolvedMediaItem {
  id: string;
  source: 'watch_media' | 'posts' | 'live_streams';
  title: string;
  description: string;
  thumbnailUrl: string;
  mediaUrl: string | null;
  isVideo: boolean;
  viewsCount: number;
  likesCount: number;
  allowComments: boolean;
  createdAt: string;
  creatorId: string | null;
  creatorName: string;
  creatorHandle: string;
  creatorAvatar: string;
  creatorFollowers: number;
  creatorVerified?: boolean;
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'Just now';
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
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function EmbeddedVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  return (
    <VideoView
      player={player}
      style={styles.playerVideo}
      contentFit="contain"
      nativeControls
    />
  );
}

export default function MediaDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const mediaId = typeof params.id === 'string' ? params.id.trim() : '';

  const [loading, setLoading] = useState(true);
  const [media, setMedia] = useState<ResolvedMediaItem | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserDisplay, setCurrentUserDisplay] = useState('You');
  const [currentUserAvatar, setCurrentUserAvatar] = useState(DEFAULT_AVATAR);

  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [comments, setComments] = useState<MediaComment[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const loadMediaDetails = useCallback(async () => {
    if (!mediaId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const user = await backend.auth.getCurrentUser().catch(() => null);
      const viewerId = user?.id ?? null;
      setCurrentUserId(viewerId);
      if (user) {
        setCurrentUserDisplay(
          user.fullName?.trim() ||
            user.username?.replace(/^@+/, '') ||
            user.email?.split('@')[0] ||
            'You'
        );
        if (user.avatarUrl) setCurrentUserAvatar(user.avatarUrl);
      }

      let resolved: ResolvedMediaItem | null = null;

      const { data: watchRow } = await supabase
        .from('watch_media')
        .select('*')
        .eq('id', mediaId)
        .maybeSingle();

      if (watchRow) {
        const mediaUrl =
          typeof watchRow.media_url === 'string' &&
          watchRow.media_url.trim() &&
          !watchRow.media_url.startsWith('pending://')
            ? watchRow.media_url.trim()
            : null;
        resolved = {
          id: String(watchRow.id),
          source: 'watch_media',
          title: String(watchRow.title || 'Untitled'),
          description: String(watchRow.description || ''),
          thumbnailUrl: String(
            watchRow.thumbnail_url || watchRow.cover_url || DEFAULT_MEDIA_COVER
          ),
          mediaUrl,
          isVideo: Boolean(mediaUrl),
          viewsCount: Number(watchRow.views_count) || 0,
          likesCount: Number(watchRow.likes_count) || 0,
          allowComments: watchRow.allow_comments !== false,
          createdAt: String(watchRow.created_at || new Date().toISOString()),
          creatorId: watchRow.creator_id ? String(watchRow.creator_id) : null,
          creatorName: String(watchRow.creator_name || 'Creator'),
          creatorHandle: String(watchRow.creator_handle || '@creator'),
          creatorAvatar: String(watchRow.creator_avatar || DEFAULT_AVATAR),
          creatorFollowers: 0,
        };
      } else {
        const { data: postRow } = await supabase
          .from('posts')
          .select('*')
          .eq('id', mediaId)
          .maybeSingle();

        if (postRow) {
          const firstPhoto =
            (Array.isArray(postRow.photos) && postRow.photos[0]) ||
            postRow.media_url ||
            DEFAULT_MEDIA_COVER;
          resolved = {
            id: String(postRow.id),
            source: 'posts',
            title: String(postRow.caption || 'Post'),
            description: String(postRow.caption || ''),
            thumbnailUrl: String(firstPhoto),
            mediaUrl:
              postRow.media_type === 'video' && postRow.media_url
                ? String(postRow.media_url)
                : null,
            isVideo: postRow.media_type === 'video' && Boolean(postRow.media_url),
            viewsCount: 0,
            likesCount: Number(postRow.likes_count) || 0,
            allowComments: true,
            createdAt: String(postRow.created_at || new Date().toISOString()),
            creatorId:
              postRow.author_id || postRow.user_id
                ? String(postRow.author_id || postRow.user_id)
                : null,
            creatorName: String(postRow.author_name || 'Member'),
            creatorHandle: String(postRow.author_handle || '@user'),
            creatorAvatar: String(postRow.author_avatar || DEFAULT_AVATAR),
            creatorFollowers: 0,
          };
        } else {
          const { data: liveRow } = await supabase
            .from('live_streams')
            .select('*')
            .eq('id', mediaId)
            .maybeSingle();

          if (liveRow) {
            resolved = {
              id: String(liveRow.id),
              source: 'live_streams',
              title: String(liveRow.title || 'Live Broadcast'),
              description: '',
              thumbnailUrl: DEFAULT_MEDIA_COVER,
              mediaUrl: liveRow.recording_url ? String(liveRow.recording_url) : null,
              isVideo: Boolean(liveRow.recording_url),
              viewsCount: Number(liveRow.viewer_count) || 0,
              likesCount: 0,
              allowComments: true,
              createdAt: String(liveRow.created_at || new Date().toISOString()),
              creatorId: liveRow.host_id ? String(liveRow.host_id) : null,
              creatorName: String(liveRow.host_name || 'Host'),
              creatorHandle: '@live',
              creatorAvatar: DEFAULT_AVATAR,
              creatorFollowers: 0,
            };
          }
        }
      }

      if (!resolved) {
        setMedia(null);
        return;
      }

      if (resolved.creatorId) {
        const [creatorProfile, creatorVerif] = await Promise.all([
          backend.profile.getProfileById(resolved.creatorId).catch(() => null),
          backend.profile
            .getVerificationStatus(resolved.creatorId)
            .catch(() => ({ isVerified: false })),
        ]);
        resolved.creatorVerified = Boolean(creatorVerif?.isVerified);
        if (creatorProfile) {
          resolved.creatorName =
            creatorProfile.full_name || resolved.creatorName;
          resolved.creatorHandle = creatorProfile.username
            ? creatorProfile.username.startsWith('@')
              ? creatorProfile.username
              : `@${creatorProfile.username}`
            : resolved.creatorHandle;
          resolved.creatorAvatar =
            creatorProfile.avatar_url || resolved.creatorAvatar;
          resolved.creatorFollowers =
            Number(creatorProfile.followers_count) || 0;
        }
      }

      setMedia(resolved);
      setLikesCount(resolved.likesCount);

      const [commentsRes, reactionRes, followRes] = await Promise.all([
        supabase
          .from('watch_comments')
          .select('id, author, author_avatar, comment_text, created_at')
          .eq('media_id', mediaId)
          .order('created_at', { ascending: false })
          .limit(100),
        viewerId
          ? resolved.source === 'posts'
            ? supabase
                .from('post_interactions')
                .select('liked, saved')
                .eq('user_id', viewerId)
                .eq('post_id', mediaId)
                .maybeSingle()
            : supabase
                .from('watch_reactions')
                .select('liked, saved')
                .eq('user_key', viewerId)
                .eq('media_id', mediaId)
                .maybeSingle()
          : Promise.resolve({ data: null }),
        viewerId && resolved.creatorId && viewerId !== resolved.creatorId
          ? backend.profile
              .getFollowRelationship(viewerId, resolved.creatorId)
              .catch(() => ({ isFollowing: false, isFollowedBy: false }))
          : Promise.resolve({ isFollowing: false, isFollowedBy: false }),
      ]);

      setComments(
        (commentsRes.data || []).map((c: any) => ({
          id: String(c.id),
          user: String(c.author || 'Member'),
          avatar: String(c.author_avatar || DEFAULT_AVATAR),
          text: String(c.comment_text || ''),
          time: formatRelativeTime(c.created_at),
        }))
      );

      setIsLiked(Boolean(reactionRes.data?.liked));
      setIsSaved(Boolean(reactionRes.data?.saved));
      setIsFollowing(Boolean(followRes.isFollowing));

      if (resolved.source === 'watch_media') {
        void backend.studio
          .updateWatchMedia(resolved.id, {
            views_count: resolved.viewsCount + 1,
          })
          .catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  }, [mediaId]);

  useEffect(() => {
    void loadMediaDetails();
  }, [loadMediaDetails]);

  const handleLikeToggle = async () => {
    if (!media) return;
    const nextLiked = !isLiked;
    setIsLiked(nextLiked);
    setLikesCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    if (!currentUserId) return;
    try {
      if (media.source === 'posts') {
        await backend.posts.toggleInteraction(currentUserId, media.id, {
          liked: nextLiked,
        });
      } else {
        await backend.watch.upsertReaction(currentUserId, media.id, {
          liked: nextLiked,
        });
      }
    } catch {
      // keep optimistic UI
    }
  };

  const handleSaveToggle = async () => {
    if (!media) return;
    const nextSaved = !isSaved;
    setIsSaved(nextSaved);

    if (!currentUserId) return;
    try {
      if (media.source === 'posts') {
        await backend.posts.toggleInteraction(currentUserId, media.id, {
          saved: nextSaved,
        });
      } else {
        await backend.watch.upsertReaction(currentUserId, media.id, {
          saved: nextSaved,
        });
      }
    } catch {
      // keep optimistic UI
    }
  };

  const handleFollowToggle = async () => {
    if (!media?.creatorId || !currentUserId || currentUserId === media.creatorId) {
      return;
    }
    const nextFollow = !isFollowing;
    setIsFollowing(nextFollow);
    try {
      if (nextFollow) {
        await backend.connect.followUser(currentUserId, media.creatorId, false);
      } else {
        await backend.connect.unfollowUser(currentUserId, media.creatorId);
      }
    } catch (err: any) {
      setIsFollowing(!nextFollow);
      Alert.alert('Error', err?.message || 'Unable to update follow state.');
    }
  };

  const handleAddComment = async () => {
    const clean = newCommentText.trim();
    if (!clean || !media || submittingComment) return;

    setSubmittingComment(true);
    const id = `cmt-${Date.now()}`;
    try {
      const { error } = await supabase.from('watch_comments').insert({
        id,
        media_id: media.id,
        author: currentUserDisplay,
        author_id: currentUserId,
        author_avatar: currentUserAvatar,
        comment_text: clean,
      });
      if (error) throw error;

      setComments((prev) => [
        {
          id,
          user: currentUserDisplay,
          avatar: currentUserAvatar,
          text: clean,
          time: 'Just now',
        },
        ...prev,
      ]);
      setNewCommentText('');
    } catch (err: any) {
      Alert.alert('Comment Failed', err?.message || 'Could not post comment.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleShare = async () => {
    if (!media) return;
    try {
      await Share.share({
        message: `${media.title} by ${media.creatorName} (${media.creatorHandle})`,
      });
    } catch {
      // ignore cancel
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {media?.title || 'Media Player'}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#059669" />
        </View>
      ) : !media ? (
        <View style={styles.centerBox}>
          <Ionicons name="film-outline" size={34} color="#94a3b8" />
          <Text style={styles.notFoundText}>Media not found.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.playerContainer}>
              {media.isVideo && media.mediaUrl ? (
                <EmbeddedVideoPlayer uri={media.mediaUrl} />
              ) : (
                <Image
                  source={{ uri: media.thumbnailUrl }}
                  style={styles.playerImage}
                  resizeMode="cover"
                />
              )}
            </View>

            <View style={styles.infoSection}>
              <Text style={styles.mediaTitle}>{media.title}</Text>

              <View style={styles.subInfoRow}>
                <Text style={styles.viewsText}>
                  {formatCompact(media.viewsCount)} views
                </Text>
                <Text style={styles.dotSeparator}>•</Text>
                <Text style={styles.dateText}>
                  {formatRelativeTime(media.createdAt)}
                </Text>
              </View>

              {media.description && media.description !== media.title ? (
                <Text style={styles.descText}>{media.description}</Text>
              ) : null}

              <View style={styles.authorRow}>
                <TouchableOpacity
                  style={styles.authorLeft}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (media.creatorId) {
                      router.push({
                        pathname: '/(tabs)/profile' as any,
                        params: { userId: media.creatorId },
                      });
                    }
                  }}
                >
                  <Image
                    source={{ uri: media.creatorAvatar }}
                    style={styles.authorAvatar}
                  />
                  <View style={{ marginLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.authorName}>{media.creatorName}</Text>
                      {media.creatorVerified && (
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color="#0095f6"
                          style={{ marginLeft: 4 }}
                        />
                      )}
                    </View>
                    <Text style={styles.subscriberText}>
                      {formatCompact(media.creatorFollowers)} Followers
                    </Text>
                  </View>
                </TouchableOpacity>

                {media.creatorId && media.creatorId !== currentUserId && (
                  <TouchableOpacity
                    style={[
                      styles.followBtn,
                      !isFollowing && {
                        backgroundColor: '#059669',
                        borderColor: '#059669',
                      },
                    ]}
                    onPress={() => void handleFollowToggle()}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.followBtnText,
                        !isFollowing && { color: '#ffffff' },
                      ]}
                    >
                      {isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.actionsBar}>
                <TouchableOpacity
                  style={[styles.actionButton, isLiked && styles.activeActionButton]}
                  onPress={() => void handleLikeToggle()}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isLiked ? 'heart' : 'heart-outline'}
                    size={18}
                    color={isLiked ? '#ef4444' : '#0f172a'}
                  />
                  <Text
                    style={[
                      styles.actionButtonText,
                      isLiked && { color: '#ef4444' },
                    ]}
                  >
                    {formatCompact(likesCount)}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => void handleSaveToggle()}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isSaved ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={isSaved ? '#059669' : '#0f172a'}
                  />
                  <Text style={styles.actionButtonText}>
                    {isSaved ? 'Saved' : 'Save'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => void handleShare()}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="share-social-outline"
                    size={18}
                    color="#0f172a"
                  />
                  <Text style={styles.actionButtonText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>

            {media.allowComments && (
              <View style={styles.commentsSection}>
                <Text style={styles.commentsHeaderTitle}>
                  Comments ({comments.length})
                </Text>

                <View style={styles.commentInputBox}>
                  <TextInput
                    style={styles.commentTextInput}
                    placeholder="Add a comment..."
                    placeholderTextColor="#94a3b8"
                    value={newCommentText}
                    onChangeText={setNewCommentText}
                  />
                  <TouchableOpacity
                    style={[
                      styles.sendCommentBtn,
                      (!newCommentText.trim() || submittingComment) && {
                        opacity: 0.5,
                      },
                    ]}
                    onPress={() => void handleAddComment()}
                    disabled={!newCommentText.trim() || submittingComment}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="send" size={14} color="#ffffff" />
                  </TouchableOpacity>
                </View>

                {comments.length === 0 ? (
                  <Text style={styles.noCommentsText}>
                    No comments yet. Be the first to comment!
                  </Text>
                ) : (
                  comments.map((item) => (
                    <View key={item.id} style={styles.commentCard}>
                      <Image
                        source={{ uri: item.avatar }}
                        style={styles.commentAvatar}
                      />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <View style={styles.commentUserRow}>
                          <Text style={styles.commentUsername}>{item.user}</Text>
                          <Text style={styles.commentTime}>{item.time}</Text>
                        </View>
                        <Text style={styles.commentText}>{item.text}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f9f8' },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  notFoundText: { fontSize: 14, color: '#64748b', fontWeight: '600' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerTitle: {
    flex: 1,
    marginHorizontal: 10,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },

  scrollContent: { paddingBottom: 40 },

  playerContainer: {
    width,
    height: width * 0.56,
    backgroundColor: '#0f172a',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerImage: { width: '100%', height: '100%' },
  playerVideo: { width: '100%', height: '100%' },

  infoSection: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  mediaTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 21,
    marginBottom: 6,
  },
  subInfoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  viewsText: { fontSize: 11.5, color: '#64748b', fontWeight: '600' },
  dotSeparator: { marginHorizontal: 6, color: '#cbd5e1', fontSize: 11 },
  dateText: { fontSize: 11.5, color: '#94a3b8', fontWeight: '500' },
  descText: {
    fontSize: 12.5,
    color: '#334155',
    lineHeight: 18,
    marginBottom: 12,
  },

  authorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 14,
  },
  authorLeft: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 38, height: 38, borderRadius: 19 },
  authorName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  subscriberText: {
    fontSize: 10.5,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 1,
  },
  followBtn: {
    backgroundColor: '#e6f7f0',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  followBtnText: { fontSize: 12, fontWeight: '700', color: '#059669' },

  actionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 4,
  },
  activeActionButton: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
  },
  actionButtonText: { fontSize: 11, fontWeight: '700', color: '#0f172a' },

  commentsSection: {
    backgroundColor: '#ffffff',
    marginTop: 12,
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  commentsHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },

  commentInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  commentTextInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0f172a',
    paddingVertical: 6,
  },
  sendCommentBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  noCommentsText: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 12 },

  commentCard: {
    flexDirection: 'row',
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  commentAvatar: { width: 32, height: 32, borderRadius: 16 },
  commentUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  commentUsername: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  commentTime: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '500',
    marginLeft: 8,
  },
  commentText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 17,
    marginBottom: 4,
  },
});
