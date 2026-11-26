import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  DeviceEventEmitter,
  Modal,
  RefreshControl,
  Share,
  TextInput,
  ActivityIndicator,
  Platform,
  useColorScheme,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backend, FeedPost } from '../../lib/backend';
import { FeedSkeletonList } from '../../components/SkeletonLoader';
import {
  DoubleTapHeartBurst,
  triggerHeartHaptic,
} from '../../components/DoubleTapHeartOverlay';
import {
  BrandedShareModal,
  ShareCardPayload,
} from '../../components/BrandedShareModal';
import {
  CollectionSaveTarget,
  SaveToCollectionModal,
} from '../../components/SaveToCollectionModal';
import {
  getScheduledLives,
  getVibeStreak,
  GROWTH_UPDATED_EVENT,
  SCHEDULED_LIVES_UPDATED_EVENT,
  ScheduledLiveItem,
  toggleLiveReminder,
} from '../../lib/growthFeatures';

const FOLLOWS_UPDATED_EVENT = 'follows-updated';
const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';

type ThemeMode = 'light' | 'dark' | 'system';
type FeedTab = 'for_you' | 'following';

interface StoryMediaEntry {
  id: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
  createdAt: string;
}

interface StoryItem {
  id: string;
  authorId: string;
  name: string;
  imageUrl: string;
  isYourStory?: boolean;
  isLive?: boolean;
  hasActiveStory?: boolean;
  storyItems?: StoryMediaEntry[];
}

function StoryVideoSurface({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });

  useEffect(() => {
    try {
      player.replaceAsync?.(uri);
      player.play();
    } catch {
      // ignore
    }
  }, [player, uri]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

interface FeedPostItem {
  id: string;
  authorId: string;
  userName: string;
  userHandle: string;
  timeAgo: string;
  avatarUrl: string;
  visibilityType: 'public' | 'friends';
  caption: string;
  mediaType: 'video' | 'image';
  mediaUrl: string;
  videoTitle?: string;
  videoMeta?: string;
  watchLabel?: string;
  likes: number;
  comments: number;
  isFromDb?: boolean;
}

const DEFAULT_AVATAR_URL =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';

function formatCompactCount(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function formatTimeAgo(isoDate?: string): string {
  if (!isoDate) return 'Just now';
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  );
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

function mapDbPostToItem(p: FeedPost): FeedPostItem {
  const firstPhoto = p.photos?.[0] || p.mediaUrl || '';
  return {
    id: p.id,
    authorId: p.authorId,
    userName: p.authorName || 'User',
    userHandle: p.authorHandle?.startsWith('@')
      ? p.authorHandle
      : `@${p.authorHandle || 'user'}`,
    timeAgo: formatTimeAgo(p.createdAt),
    avatarUrl:
      p.authorAvatar ||
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150',
    visibilityType: p.visibility === 'friends' ? 'friends' : 'public',
    caption: p.caption || '',
    mediaType: p.mediaType === 'video' ? 'video' : 'image',
    mediaUrl: firstPhoto,
    videoTitle: p.meta?.videoTitle,
    videoMeta: p.meta?.videoMeta,
    watchLabel: p.meta?.watchLabel,
    likes: p.likesCount || 0,
    comments: p.commentsCount || 0,
    isFromDb: true,
  };
}

export default function HomeFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const colors = useMemo(
    () => ({
      bg: isDark ? '#09090b' : '#ffffff',
      surface: isDark ? '#18181b' : '#f4f4f5',
      card: isDark ? '#18181b' : '#ffffff',
      border: isDark ? '#27272a' : '#f1f5f9',
      borderStrong: isDark ? '#3f3f46' : '#e4e4e7',
      text: isDark ? '#fafafa' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#71717a',
      accent: isDark ? '#fafafa' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
      emerald: '#10b981',
      danger: '#ef4444',
      amber: '#f59e0b',
    }),
    [isDark]
  );

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setThemeMode(saved);
        }
      })
      .catch(() => {});

    const sub = DeviceEventEmitter.addListener(
      THEME_CHANGED_EVENT,
      (mode: ThemeMode) => {
        if (mode === 'light' || mode === 'dark' || mode === 'system') {
          setThemeMode(mode);
        }
      }
    );
    return () => sub.remove();
  }, []);

  const [activeTab, setActiveTab] = useState<FeedTab>('for_you');
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [posts, setPosts] = useState<FeedPostItem[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [blockedByMeIds, setBlockedByMeIds] = useState<Set<string>>(new Set());
  const [blockingMeIds, setBlockingMeIds] = useState<Set<string>>(new Set());
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(new Set());
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedPostForMenu, setSelectedPostForMenu] =
    useState<FeedPostItem | null>(null);
  const [myStories, setMyStories] = useState<StoryMediaEntry[]>([]);
  const [myProfileAvatar, setMyProfileAvatar] = useState<string>(DEFAULT_AVATAR_URL);
  const [pendingStoryMedia, setPendingStoryMedia] = useState<{
    uri: string;
    mediaType: 'image' | 'video';
  } | null>(null);
  const [storyCaption, setStoryCaption] = useState('');
  const [uploadingStory, setUploadingStory] = useState(false);
  const [storyViewer, setStoryViewer] = useState<{
    authorId: string;
    name: string;
    avatarUrl: string;
    isOwn: boolean;
    items: StoryMediaEntry[];
    index: number;
  } | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [vibeStreakDays, setVibeStreakDays] = useState(1);
  const [scheduledLives, setScheduledLives] = useState<ScheduledLiveItem[]>([]);
  const [shareCardItem, setShareCardItem] = useState<ShareCardPayload | null>(
    null
  );
  const [collectionSaveTarget, setCollectionSaveTarget] =
    useState<CollectionSaveTarget | null>(null);
  const [heartBurst, setHeartBurst] = useState<{
    postId: string;
    seq: number;
  }>({ postId: '', seq: 0 });
  const lastMediaTapRef = React.useRef<{ postId: string; time: number }>({
    postId: '',
    time: 0,
  });

  const restrictedUserIds = useMemo(() => {
    const combined = new Set<string>();
    blockedByMeIds.forEach((id) => combined.add(id));
    blockingMeIds.forEach((id) => combined.add(id));
    return combined;
  }, [blockedByMeIds, blockingMeIds]);

  const syncFeedAndRelationships = useCallback(async () => {
    try {
      const [user, dbPosts] = await Promise.all([
        backend.auth.getCurrentUser().catch(() => null),
        backend.posts.getFeed(40).catch(() => []),
      ]);

      setPosts(dbPosts.map(mapDbPostToItem));

      const activeUserId = user?.id ?? null;
      setCurrentUserId(activeUserId);

      const extras = await backend.posts
        .getHomeExtras(activeUserId)
        .catch(() => null);

      const myAvatar = (user?.avatarUrl || '').trim() || DEFAULT_AVATAR_URL;
      setMyProfileAvatar(myAvatar);
      const myStoryList = extras?.myStories || [];
      setMyStories(myStoryList);

      const selfStory: StoryItem = {
        id: 'st-self',
        authorId: activeUserId || 'self-user',
        name: 'Your Story',
        imageUrl: myAvatar,
        isYourStory: true,
        hasActiveStory: myStoryList.length > 0,
        storyItems: myStoryList,
      };
      setStories([selfStory, ...(extras?.stories || [])]);
      setFollowingIds(new Set(extras?.followingIds || []));
      setUnreadMessagesCount(extras?.unreadMessagesCount || 0);
      setUnreadNotificationsCount(extras?.unreadNotificationsCount || 0);

      if (!activeUserId) {
        setBlockedByMeIds(new Set());
        setBlockingMeIds(new Set());
        return;
      }

      const [blocks, interactions] = await Promise.all([
        backend.social.getBlockedRelationships(activeUserId).catch(() => null),
        backend.posts.getUserInteractions(activeUserId).catch(() => null),
      ]);

      if (blocks) {
        setBlockedByMeIds(new Set(blocks.blockedByMe));
        setBlockingMeIds(new Set(blocks.blockingMe));
      }

      if (interactions) {
        setLikedPostIds(new Set(interactions.likedIds));
        setSavedPostIds(new Set(interactions.savedIds));
        setHiddenPostIds(new Set(interactions.hiddenIds));
      }
      const [streakState, schedList] = await Promise.all([
        getVibeStreak(activeUserId),
        getScheduledLives(),
      ]);
      setVibeStreakDays(streakState.streakDays || 1);
      setScheduledLives(schedList);
    } catch {
      // Keep current state on transient network error
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void syncFeedAndRelationships();
    const sub1 = DeviceEventEmitter.addListener(FOLLOWS_UPDATED_EVENT, () => {
      void syncFeedAndRelationships();
    });
    const sub2 = DeviceEventEmitter.addListener('watch-media-created', () => {
      void syncFeedAndRelationships();
    });
    const sub3 = DeviceEventEmitter.addListener('notifications-updated', () => {
      void syncFeedAndRelationships();
    });
    const sub4 = DeviceEventEmitter.addListener(
      SCHEDULED_LIVES_UPDATED_EVENT,
      () => {
        void getScheduledLives().then(setScheduledLives);
      }
    );
    const sub5 = DeviceEventEmitter.addListener(GROWTH_UPDATED_EVENT, () => {
      void getVibeStreak(currentUserId).then((s) =>
        setVibeStreakDays(s.streakDays || 1)
      );
    });
    return () => {
      sub1.remove();
      sub2.remove();
      sub3.remove();
      sub4.remove();
      sub5.remove();
    };
  }, [syncFeedAndRelationships]);

  useEffect(() => {
    if (!currentUserId) return;
    const unsubscribeNotifs = backend.notifications.subscribeNotifications(
      currentUserId,
      (incoming) => {
        if ((incoming?.type || '').toLowerCase().includes('message')) return;
        setUnreadNotificationsCount((c) => c + 1);
      }
    );
    const unsubscribeInbox = backend.chats.subscribeInboxEvents(
      currentUserId,
      {
        onMessageInsert: (row) => {
          if (row?.receiver_id === currentUserId) {
            void backend.posts
              .getHomeExtras(currentUserId)
              .then((extras) => {
                if (extras) {
                  setUnreadMessagesCount(extras.unreadMessagesCount || 0);
                }
              })
              .catch(() => {});
          }
        },
        onMessageUpdate: () => {
          void backend.posts
            .getHomeExtras(currentUserId)
            .then((extras) => {
              if (extras) {
                setUnreadMessagesCount(extras.unreadMessagesCount || 0);
              }
            })
            .catch(() => {});
        },
        onProfileUpdate: () => {},
      }
    );
    return () => {
      unsubscribeNotifs();
      unsubscribeInbox();
    };
  }, [currentUserId]);

  useFocusEffect(
    useCallback(() => {
      void syncFeedAndRelationships();
    }, [syncFeedAndRelationships])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    syncFeedAndRelationships().finally(() => setRefreshing(false));
  }, [syncFeedAndRelationships]);

  const isUserRestricted = useCallback(
    (userId?: string | null) => {
      const clean = (userId || '').trim();
      if (!clean) return false;
      return restrictedUserIds.has(clean);
    },
    [restrictedUserIds]
  );

  const visibleStories = useMemo(
    () =>
      stories.filter(
        (story) => story.isYourStory || !isUserRestricted(story.authorId)
      ),
    [stories, isUserRestricted]
  );

  const visiblePosts = useMemo(
    () =>
      posts.filter((post) => {
        if (hiddenPostIds.has(post.id) || isUserRestricted(post.authorId)) {
          return false;
        }
        if (activeTab === 'following') {
          return (
            followingIds.has(post.authorId) ||
            (currentUserId !== null && post.authorId === currentUserId)
          );
        }
        return true;
      }),
    [posts, hiddenPostIds, isUserRestricted, activeTab, followingIds, currentUserId]
  );

  const handleOpenProfile = (targetId: string, handleText?: string) => {
    if (isUserRestricted(targetId)) {
      Alert.alert(
        'Unavailable',
        'This profile is unavailable due to block settings.'
      );
      return;
    }

    if (currentUserId && targetId === currentUserId) {
      router.push('/(tabs)/profile' as any);
      return;
    }

    router.push({
      pathname: '/(tabs)/profile' as any,
      params: {
        userId: targetId,
        ...(handleText ? { username: handleText.replace(/^@/, '') } : {}),
      },
    });
  };

  const handleOpenWatch = (post: FeedPostItem) => {
    if (isUserRestricted(post.authorId)) {
      Alert.alert('Unavailable', 'You cannot view content from this user.');
      return;
    }

    router.push({
      pathname: '/watch' as any,
      params: {
        postId: post.id,
        authorId: post.authorId,
        title: post.videoTitle || post.caption,
      },
    });
  };

  const handleHidePost = (post: FeedPostItem) => {
    setHiddenPostIds((prev) => new Set(prev).add(post.id));
    setSelectedPostForMenu(null);
    if (currentUserId && post.isFromDb) {
      void backend.posts
        .toggleInteraction(currentUserId, post.id, { hidden: true })
        .catch(() => {});
    }
  };

  const handleBlockPostAuthor = async (post: FeedPostItem) => {
    setSelectedPostForMenu(null);

    if (!currentUserId) {
      setBlockedByMeIds((prev) => new Set(prev).add(post.authorId));
      return;
    }

    if (currentUserId === post.authorId) return;

    try {
      await backend.social.blockUser(currentUserId, post.authorId);

      setBlockedByMeIds((prev) => new Set(prev).add(post.authorId));
      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
        followerId: currentUserId,
        followingId: post.authorId,
        status: 'blocked',
      });

      Alert.alert(
        'User Blocked',
        `${post.userName} (${post.userHandle}) has been blocked.`
      );
    } catch (err: any) {
      Alert.alert('Block Failed', err?.message || 'Could not block user.');
    }
  };

  const handleReportPost = (post: FeedPostItem) => {
    setSelectedPostForMenu(null);
    setHiddenPostIds((prev) => new Set(prev).add(post.id));
    if (currentUserId && post.isFromDb) {
      void backend.posts
        .toggleInteraction(currentUserId, post.id, { hidden: true })
        .catch(() => {});
    }
    Alert.alert(
      'Reported',
      `Thanks for reporting this post by ${post.userHandle}. It has been hidden from your feed.`
    );
  };

  const toggleLike = (post: FeedPostItem) => {
    const nextLiked = !likedPostIds.has(post.id);
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      if (nextLiked) next.add(post.id);
      else next.delete(post.id);
      return next;
    });

    if (currentUserId && post.isFromDb) {
      void backend.posts
        .toggleInteraction(currentUserId, post.id, { liked: nextLiked })
        .catch(() => {});
    }
  };

  const toggleSave = (post: FeedPostItem) => {
    const nextSaved = !savedPostIds.has(post.id);
    setSavedPostIds((prev) => {
      const next = new Set(prev);
      if (nextSaved) next.add(post.id);
      else next.delete(post.id);
      return next;
    });

    if (currentUserId && post.isFromDb) {
      void backend.posts
        .toggleInteraction(currentUserId, post.id, { saved: nextSaved })
        .catch(() => {});
    }

    if (nextSaved) {
      setCollectionSaveTarget({
        id: post.id,
        kind: post.mediaType === 'video' ? 'video' : 'post',
        title: post.videoTitle || post.caption || 'VibeSphere Post',
        author: post.userHandle,
        thumbnailUrl: post.mediaUrl,
      });
    }
  };

  const toggleExpandCaption = (postId: string) => {
    setExpandedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const launchStoryPicker = useCallback(async (source: 'camera' | 'gallery') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Camera Permission Needed',
            'Please allow camera access to capture a story.'
          );
          return;
        }
        const res = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images', 'videos'],
          quality: 0.85,
          videoMaxDuration: 30,
        });
        if (!res.canceled && res.assets?.[0]?.uri) {
          const asset = res.assets[0];
          setStoryCaption('');
          setPendingStoryMedia({
            uri: asset.uri,
            mediaType: asset.type === 'video' ? 'video' : 'image',
          });
        }
        return;
      }

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Gallery Permission Needed',
          'Please allow photo library access to pick a story.'
        );
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.85,
        videoMaxDuration: 30,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        const asset = res.assets[0];
        setStoryCaption('');
        setPendingStoryMedia({
          uri: asset.uri,
          mediaType: asset.type === 'video' ? 'video' : 'image',
        });
      }
    } catch (err: any) {
      Alert.alert('Story Picker Error', err?.message || 'Could not pick media.');
    }
  }, []);

  const handleAddStoryPress = useCallback(() => {
    if (!currentUserId) {
      Alert.alert('Sign In Required', 'Please sign in to post a story.');
      return;
    }
    Alert.alert('Add to Your Story', 'Choose how you want to create your story', [
      { text: 'Camera', onPress: () => void launchStoryPicker('camera') },
      {
        text: 'Choose from Gallery',
        onPress: () => void launchStoryPicker('gallery'),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [currentUserId, launchStoryPicker]);

  const handlePublishStory = useCallback(async () => {
    if (!currentUserId || !pendingStoryMedia) return;
    try {
      setUploadingStory(true);
      const created = await backend.posts.createStory({
        userId: currentUserId,
        mediaUri: pendingStoryMedia.uri,
        mediaType: pendingStoryMedia.mediaType,
        caption: storyCaption.trim() || undefined,
      });
      setMyStories((prev) => [...prev, created]);
      setPendingStoryMedia(null);
      setStoryCaption('');
      void syncFeedAndRelationships();
    } catch (err: any) {
      Alert.alert(
        'Story Upload Failed',
        err?.message || 'Unable to upload story right now.'
      );
    } finally {
      setUploadingStory(false);
    }
  }, [currentUserId, pendingStoryMedia, storyCaption, syncFeedAndRelationships]);

  const handleDeleteCurrentStory = useCallback(async () => {
    if (!currentUserId || !storyViewer || !storyViewer.isOwn) return;
    const currentItem = storyViewer.items[storyViewer.index];
    if (!currentItem) return;
    try {
      await backend.posts.deleteStory(currentItem.id, currentUserId);
      const remaining = storyViewer.items.filter((i) => i.id !== currentItem.id);
      setMyStories((prev) => prev.filter((i) => i.id !== currentItem.id));
      if (remaining.length === 0) {
        setStoryViewer(null);
      } else {
        setStoryViewer({
          ...storyViewer,
          items: remaining,
          index: Math.min(storyViewer.index, remaining.length - 1),
        });
      }
      void syncFeedAndRelationships();
    } catch (err: any) {
      Alert.alert('Delete Failed', err?.message || 'Could not delete story.');
    }
  }, [currentUserId, storyViewer, syncFeedAndRelationships]);

  const handleSharePost = (post: FeedPostItem) => {
    setShareCardItem({
      id: post.id,
      kind: post.mediaType === 'video' ? 'video' : 'post',
      title: post.videoTitle || post.caption || 'VibeSphere Post',
      creatorHandle: post.userHandle,
      thumbnailUrl: post.mediaUrl,
    });
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      {/* 1. MINIMAL EDGE-TO-EDGE HEADER */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.brandTitle, { color: colors.text }]}>
            VibeSphere
          </Text>
          <View
            style={[
              styles.streakHeaderBadge,
              { backgroundColor: colors.surface, borderColor: colors.borderStrong },
            ]}
          >
            <Ionicons name="flame" size={13} color="#f97316" />
            <Text style={[styles.streakHeaderText, { color: colors.text }]}>
              {vibeStreakDays}d
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push('/notifications' as any)}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name="notifications-outline"
              size={25}
              color={colors.text}
            />
            {unreadNotificationsCount > 0 && (
              <View style={[styles.notifDot, { borderColor: colors.bg }]} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push('/chats' as any)}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather name="send" size={23} color={colors.text} />
            {unreadMessagesCount > 0 && (
              <View style={styles.chatBadge}>
                <Text style={styles.chatBadgeText}>
                  {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. EDGE-TO-EDGE FEED TABS */}
      <View
        style={[
          styles.tabsRow,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        {(
          [
            { key: 'for_you', label: 'For You' },
            { key: 'following', label: 'Following' },
          ] as const
        ).map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tabBtn,
                active && { borderBottomColor: colors.text },
              ]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? colors.text : colors.subtext },
                  active && { fontWeight: '800' },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom:
            Platform.OS === 'android'
              ? Math.max(insets.bottom, 24) + 96
              : Math.max(insets.bottom, 16) + 84,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.text}
          />
        }
      >
        {/* 3. EDGE-TO-EDGE STORIES TRAY */}
        <View
          style={[
            styles.storiesStrip,
            { backgroundColor: colors.bg, borderBottomColor: colors.border },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.storiesContent}
          >
            {visibleStories.map((story) => {
              const items = story.isYourStory ? myStories : story.storyItems || [];
              const hasActive = items.length > 0;
              return (
                <TouchableOpacity
                  key={story.id}
                  style={styles.storyItem}
                  activeOpacity={0.82}
                  onPress={() => {
                    if (story.isYourStory) {
                      if (hasActive) {
                        setStoryViewer({
                          authorId: story.authorId,
                          name: 'Your Story',
                          avatarUrl: myProfileAvatar || story.imageUrl,
                          isOwn: true,
                          items,
                          index: 0,
                        });
                      } else {
                        handleAddStoryPress();
                      }
                    } else if (hasActive) {
                      setStoryViewer({
                        authorId: story.authorId,
                        name: story.name,
                        avatarUrl: story.imageUrl,
                        isOwn: false,
                        items,
                        index: 0,
                      });
                    } else if (story.isLive) {
                      router.push('/(tabs)/watch' as any);
                    } else {
                      handleAddStoryPress();
                    }
                  }}
                >
                  <View
                    style={[
                      styles.storyRing,
                      {
                        borderColor: hasActive
                          ? colors.emerald
                          : story.isLive
                            ? colors.danger
                            : colors.borderStrong,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: story.imageUrl }}
                      style={styles.storyAvatar}
                    />
                    {story.isYourStory && (
                      <TouchableOpacity
                        style={[
                          styles.addStoryBadge,
                          {
                            backgroundColor: colors.accent,
                            borderColor: colors.bg,
                          },
                        ]}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          handleAddStoryPress();
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Ionicons
                          name="add"
                          size={12}
                          color={colors.accentText}
                        />
                      </TouchableOpacity>
                    )}
                    {story.isLive && (
                      <View
                        style={[styles.livePill, { borderColor: colors.bg }]}
                      >
                        <Text style={styles.livePillText}>LIVE</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[styles.storyName, { color: colors.subtext }]}
                    numberOfLines={1}
                  >
                    {story.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* UPCOMING SCHEDULED LIVE COUNTDOWN */}
        {scheduledLives.length > 0 && (
          <View
            style={[
              styles.upcomingLiveBanner,
              {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={styles.upcomingLiveBadge}>
                  <Text style={styles.upcomingLiveBadgeText}>LIVE SOON</Text>
                </View>
                <Text
                  style={[styles.upcomingLiveTitle, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {scheduledLives[0].title}
                </Text>
              </View>
              <Text style={[styles.upcomingLiveSub, { color: colors.subtext }]}>
                {scheduledLives[0].hostName} · Starts in{' '}
                {Math.max(
                  1,
                  Math.round(
                    (scheduledLives[0].scheduledAtMs - Date.now()) / 60000
                  )
                )}
                m
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.upcomingRemindBtn,
                scheduledLives[0].reminded && { backgroundColor: colors.emerald },
              ]}
              onPress={() =>
                void toggleLiveReminder(scheduledLives[0].id).then(
                  setScheduledLives
                )
              }
            >
              <Ionicons
                name={
                  scheduledLives[0].reminded
                    ? 'notifications'
                    : 'notifications-outline'
                }
                size={14}
                color="#fff"
              />
              <Text style={styles.upcomingRemindText}>
                {scheduledLives[0].reminded ? 'Set' : 'Remind Me'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 4. EDGE-TO-EDGE FEED POSTS */}
        {isInitialLoading && visiblePosts.length === 0 ? (
          <FeedSkeletonList isDark={isDark} />
        ) : visiblePosts.length === 0 ? (
          <View style={styles.emptyFeed}>
            <Ionicons
              name="sparkles-outline"
              size={28}
              color={colors.subtext}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              You're all caught up
            </Text>
            <Text style={[styles.emptySub, { color: colors.subtext }]}>
              Pull down to refresh or switch tabs to explore more posts.
            </Text>
          </View>
        ) : (
          visiblePosts.map((post) => {
            const isLiked = likedPostIds.has(post.id);
            const isSaved = savedPostIds.has(post.id);
            const isExpanded = expandedPostIds.has(post.id);
            const isLongCaption = post.caption.length > 100;
            const displayLikes = post.likes + (isLiked ? 1 : 0);

            return (
              <View
                key={post.id}
                style={[
                  styles.postBlock,
                  {
                    backgroundColor: colors.bg,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                {/* Post Author Row */}
                <View style={styles.postHeader}>
                  <TouchableOpacity
                    style={styles.authorLeft}
                    activeOpacity={0.8}
                    onPress={() =>
                      handleOpenProfile(post.authorId, post.userHandle)
                    }
                  >
                    <Image
                      source={{ uri: post.avatarUrl }}
                      style={styles.avatar}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={styles.nameLine}>
                        <Text
                          style={[styles.userName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {post.userName}
                        </Text>
                        <Text
                          style={[styles.timeMeta, { color: colors.subtext }]}
                        >
                          · {post.timeAgo}
                        </Text>
                      </View>
                      <View style={styles.handleLine}>
                        <Text
                          style={[styles.userHandle, { color: colors.subtext }]}
                        >
                          {post.userHandle}
                        </Text>
                        {post.visibilityType === 'friends' && (
                          <View
                            style={[
                              styles.friendsTag,
                              { backgroundColor: colors.surface },
                            ]}
                          >
                            <Ionicons
                              name="people-outline"
                              size={10}
                              color={colors.subtext}
                            />
                            <Text
                              style={[
                                styles.friendsTagText,
                                { color: colors.subtext },
                              ]}
                            >
                              Friends
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setSelectedPostForMenu(post)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={19}
                      color={colors.subtext}
                    />
                  </TouchableOpacity>
                </View>

                {/* Caption with See More / See Less */}
                <View style={styles.captionWrap}>
                  <Text
                    style={[styles.caption, { color: colors.text }]}
                    numberOfLines={isExpanded ? undefined : 2}
                  >
                    {post.caption}
                  </Text>
                  {isLongCaption && (
                    <TouchableOpacity
                      onPress={() => toggleExpandCaption(post.id)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 12 }}
                    >
                      <Text
                        style={[styles.seeMoreText, { color: colors.subtext }]}
                      >
                        {isExpanded ? 'See less' : 'See more'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Edge-to-Edge Media */}
                {post.mediaType === 'video' ? (
                  <TouchableOpacity
                    style={styles.edgeVideoBox}
                    activeOpacity={0.92}
                    onPress={() => handleOpenWatch(post)}
                  >
                    <Image
                      source={{ uri: post.mediaUrl }}
                      style={styles.fullMedia}
                      resizeMode="cover"
                    />
                    <View style={styles.videoScrim} />

                    <View style={styles.centerPlayCircle}>
                      <Ionicons
                        name="play"
                        size={24}
                        color="#09090b"
                        style={{ marginLeft: 3 }}
                      />
                    </View>

                    <View style={styles.videoBottomBar}>
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <Text style={styles.videoTitle} numberOfLines={1}>
                          {post.videoTitle || post.caption}
                        </Text>
                        <Text style={styles.videoMeta} numberOfLines={1}>
                          {post.videoMeta || 'Full Episode'}
                        </Text>
                      </View>
                      <View style={styles.watchPill}>
                        <Text style={styles.watchPillText}>
                          {post.watchLabel || 'Watch'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ) : post.mediaUrl ? (
                  <TouchableOpacity
                    activeOpacity={0.95}
                    onPress={() => {
                      const now = Date.now();
                      if (
                        lastMediaTapRef.current.postId === post.id &&
                        now - lastMediaTapRef.current.time < 280
                      ) {
                        lastMediaTapRef.current = { postId: '', time: 0 };
                        triggerHeartHaptic();
                        setHeartBurst((prev) => ({
                          postId: post.id,
                          seq: prev.seq + 1,
                        }));
                        if (!likedPostIds.has(post.id)) {
                          toggleLike(post);
                        }
                        return;
                      }
                      lastMediaTapRef.current = { postId: post.id, time: now };
                    }}
                  >
                    <Image
                      source={{ uri: post.mediaUrl }}
                      style={[
                        styles.edgePhoto,
                        { backgroundColor: colors.surface },
                      ]}
                      resizeMode="cover"
                    />
                    <DoubleTapHeartBurst
                      triggerKey={
                        heartBurst.postId === post.id ? heartBurst.seq : 0
                      }
                    />
                  </TouchableOpacity>
                ) : null}

                {/* Minimal Action Row */}
                <View style={styles.actionsRow}>
                  <View style={styles.actionsLeft}>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => toggleLike(post)}
                      activeOpacity={0.75}
                    >
                      <Ionicons
                        name={isLiked ? 'heart' : 'heart-outline'}
                        size={22}
                        color={isLiked ? colors.danger : colors.text}
                      />
                      <Text
                        style={[
                          styles.actionCount,
                          { color: isLiked ? colors.danger : colors.subtext },
                        ]}
                      >
                        {formatCompactCount(displayLikes)}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleOpenWatch(post)}
                      activeOpacity={0.75}
                    >
                      <Ionicons
                        name="chatbubble-outline"
                        size={20}
                        color={colors.text}
                      />
                      <Text
                        style={[styles.actionCount, { color: colors.subtext }]}
                      >
                        {post.comments}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleSharePost(post)}
                      activeOpacity={0.75}
                    >
                      <Feather name="send" size={19} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    onPress={() => toggleSave(post)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={isSaved ? 'bookmark' : 'bookmark-outline'}
                      size={21}
                      color={isSaved ? colors.text : colors.subtext}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* POST SAFETY BOTTOM SHEET */}
      <Modal
        visible={Boolean(selectedPostForMenu)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPostForMenu(null)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSelectedPostForMenu(null)}
          />
          {selectedPostForMenu && (
            <View
              style={[
                styles.sheetCard,
                {
                  backgroundColor: colors.card,
                  paddingBottom:
                    Platform.OS === 'android'
                      ? Math.max(insets.bottom, 48) + 14
                      : Math.max(insets.bottom, 16) + 10,
                },
              ]}
            >
              <View
                style={[
                  styles.sheetHandle,
                  { backgroundColor: colors.borderStrong },
                ]}
              />
              <Text
                style={[styles.sheetTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {selectedPostForMenu.userName} ·{' '}
                {selectedPostForMenu.userHandle}
              </Text>

              <TouchableOpacity
                style={[
                  styles.sheetOption,
                  { borderTopColor: colors.border },
                ]}
                onPress={() => handleHidePost(selectedPostForMenu)}
              >
                <Ionicons
                  name="eye-off-outline"
                  size={19}
                  color={colors.text}
                />
                <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                  Hide this post
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sheetOption,
                  { borderTopColor: colors.border },
                ]}
                onPress={() => void handleBlockPostAuthor(selectedPostForMenu)}
              >
                <Ionicons
                  name="ban-outline"
                  size={19}
                  color={colors.danger}
                />
                <Text
                  style={[styles.sheetOptionText, { color: colors.danger }]}
                >
                  Block {selectedPostForMenu.userHandle}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sheetOption,
                  { borderTopColor: colors.border },
                ]}
                onPress={() => handleReportPost(selectedPostForMenu)}
              >
                <Ionicons
                  name="flag-outline"
                  size={19}
                  color={colors.amber}
                />
                <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                  Report post
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sheetCancelBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setSelectedPostForMenu(null)}
              >
                <Text style={[styles.sheetCancelText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* STORY COMPOSER MODAL */}
      <Modal
        visible={Boolean(pendingStoryMedia)}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          if (!uploadingStory) setPendingStoryMedia(null);
        }}
      >
        <View style={styles.storyFullScreen}>
          {pendingStoryMedia?.mediaType === 'video' ? (
            <StoryVideoSurface uri={pendingStoryMedia.uri} />
          ) : pendingStoryMedia?.uri ? (
            <Image
              source={{ uri: pendingStoryMedia.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
          ) : null}

          <View
            style={[
              styles.storyTopHeader,
              { paddingTop: Math.max(insets.top, 16) + 10 },
            ]}
          >
            <TouchableOpacity
              style={styles.storyCloseCircle}
              onPress={() => !uploadingStory && setPendingStoryMedia(null)}
              disabled={uploadingStory}
            >
              <Ionicons name="close" size={22} color="#ffffff" />
            </TouchableOpacity>
            <Text style={styles.storyComposerTitle}>Your Story</Text>
            <View style={{ width: 38 }} />
          </View>

          <View
            style={[
              styles.storyComposerFooter,
              {
                paddingBottom:
                  Platform.OS === 'android'
                    ? Math.max(insets.bottom, 48) + 16
                    : Math.max(insets.bottom, 20) + 16,
              },
            ]}
          >
            <TextInput
              style={styles.storyCaptionInput}
              value={storyCaption}
              onChangeText={setStoryCaption}
              placeholder="Add a caption to your story..."
              placeholderTextColor="rgba(255,255,255,0.65)"
              maxLength={160}
            />
            <TouchableOpacity
              style={[
                styles.storyShareBtn,
                uploadingStory && { opacity: 0.65 },
              ]}
              onPress={() => void handlePublishStory()}
              disabled={uploadingStory}
              activeOpacity={0.85}
            >
              {uploadingStory ? (
                <ActivityIndicator size="small" color="#09090b" />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#09090b" />
                  <Text style={styles.storyShareBtnText}>Share Story</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* STORY VIEWER MODAL */}
      <Modal
        visible={Boolean(storyViewer)}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setStoryViewer(null)}
      >
        {storyViewer && storyViewer.items[storyViewer.index] && (
          <View style={styles.storyFullScreen}>
            {storyViewer.items[storyViewer.index].mediaType === 'video' ? (
              <StoryVideoSurface
                key={storyViewer.items[storyViewer.index].id}
                uri={storyViewer.items[storyViewer.index].mediaUrl}
              />
            ) : (
              <Image
                source={{ uri: storyViewer.items[storyViewer.index].mediaUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
            )}

            {/* Left / Right tap zones */}
            <View style={styles.storyTapRow}>
              <TouchableOpacity
                style={styles.storyTapHalf}
                activeOpacity={1}
                onPress={() =>
                  setStoryViewer((prev) => {
                    if (!prev) return null;
                    if (prev.index > 0) {
                      return { ...prev, index: prev.index - 1 };
                    }
                    return prev;
                  })
                }
              />
              <TouchableOpacity
                style={styles.storyTapHalf}
                activeOpacity={1}
                onPress={() =>
                  setStoryViewer((prev) => {
                    if (!prev) return null;
                    if (prev.index < prev.items.length - 1) {
                      return { ...prev, index: prev.index + 1 };
                    }
                    return null;
                  })
                }
              />
            </View>

            {/* Progress Bars + Author Header */}
            <View
              pointerEvents="box-none"
              style={[
                styles.storyViewerTop,
                { paddingTop: Math.max(insets.top, 16) + 8 },
              ]}
            >
              <View style={styles.storyProgressRow}>
                {storyViewer.items.map((st, idx) => (
                  <View key={st.id} style={styles.storyProgressTrack}>
                    <View
                      style={[
                        styles.storyProgressFill,
                        {
                          width:
                            idx <= storyViewer.index ? '100%' : '0%',
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>

              <View style={styles.storyViewerMetaRow}>
                <TouchableOpacity
                  style={styles.storyViewerAuthorLeft}
                  activeOpacity={0.8}
                  onPress={() => {
                    const aid = storyViewer.authorId;
                    const aname = storyViewer.name;
                    const isOwn = storyViewer.isOwn;
                    setStoryViewer(null);
                    if (isOwn) {
                      router.push('/(tabs)/profile' as any);
                    } else {
                      handleOpenProfile(aid, aname);
                    }
                  }}
                >
                  <Image
                    source={{ uri: storyViewer.avatarUrl }}
                    style={styles.storyViewerAvatar}
                  />
                  <View>
                    <Text style={styles.storyViewerName}>
                      {storyViewer.name}
                    </Text>
                    <Text style={styles.storyViewerTime}>
                      {formatTimeAgo(
                        storyViewer.items[storyViewer.index].createdAt
                      )}
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {storyViewer.isOwn && (
                    <TouchableOpacity
                      style={styles.storyCloseCircle}
                      onPress={handleAddStoryPress}
                    >
                      <Ionicons name="add" size={20} color="#ffffff" />
                    </TouchableOpacity>
                  )}
                  {storyViewer.isOwn && (
                    <TouchableOpacity
                      style={styles.storyCloseCircle}
                      onPress={() => void handleDeleteCurrentStory()}
                    >
                      <Ionicons name="trash-outline" size={18} color="#ffffff" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.storyCloseCircle}
                    onPress={() => setStoryViewer(null)}
                  >
                    <Ionicons name="close" size={21} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {storyViewer.items[storyViewer.index].caption ? (
              <View
                style={[
                  styles.storyViewerCaptionBar,
                  {
                    paddingBottom:
                      Platform.OS === 'android'
                        ? Math.max(insets.bottom, 48) + 16
                        : Math.max(insets.bottom, 20) + 16,
                  },
                ]}
              >
                <Text style={styles.storyViewerCaptionText}>
                  {storyViewer.items[storyViewer.index].caption}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </Modal>

      <BrandedShareModal
        visible={!!shareCardItem}
        item={shareCardItem}
        onClose={() => setShareCardItem(null)}
        onSaveToCollection={
          shareCardItem
            ? () =>
                setCollectionSaveTarget({
                  id: shareCardItem.id,
                  kind:
                    shareCardItem.kind === 'video' ? 'video' : 'post',
                  title: shareCardItem.title,
                  author: shareCardItem.creatorHandle,
                  thumbnailUrl: shareCardItem.thumbnailUrl,
                })
            : undefined
        }
      />

      <SaveToCollectionModal
        visible={!!collectionSaveTarget}
        userId={currentUserId}
        target={collectionSaveTarget}
        onClose={() => setCollectionSaveTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  /* Minimal Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 52,
  },
  brandTitle: {
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  notifDot: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
  },
  chatBadge: {
    position: 'absolute',
    right: 0,
    top: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  chatBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },

  /* Underline Feed Tabs */
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },

  /* Stories Tray */
  storiesStrip: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  storiesContent: {
    paddingHorizontal: 12,
    gap: 12,
  },
  storyItem: {
    alignItems: 'center',
    width: 68,
  },
  storyRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
    position: 'relative',
  },
  storyAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  addStoryBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePill: {
    position: 'absolute',
    bottom: -5,
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  livePillText: {
    color: '#ffffff',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  storyName: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },

  /* Edge-to-Edge Posts */
  postBlock: {
    borderBottomWidth: 1,
    paddingTop: 12,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  authorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  userName: {
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  timeMeta: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  handleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  userHandle: {
    fontSize: 12,
    fontWeight: '500',
  },
  friendsTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  friendsTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  captionWrap: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  caption: {
    fontSize: 14,
    lineHeight: 20,
  },
  seeMoreText: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },

  /* Edge-to-Edge Media */
  edgeVideoBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#09090b',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fullMedia: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  videoScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(9, 9, 11, 0.28)',
  },
  centerPlayCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(9, 9, 11, 0.72)',
  },
  videoTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  videoMeta: {
    color: '#d4d4d8',
    fontSize: 11,
    marginTop: 2,
  },
  watchPill: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  watchPillText: {
    color: '#09090b',
    fontSize: 11.5,
    fontWeight: '800',
  },
  edgePhoto: {
    width: '100%',
    aspectRatio: 4 / 5,
  },

  /* Actions Bar */
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionCount: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* Empty Feed */
  emptyFeed: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  /* Safety Sheet */
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  sheetOptionText: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  sheetCancelBtn: {
    marginTop: 8,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelText: {
    fontSize: 14.5,
    fontWeight: '700',
  },

  /* Stories Composer & Viewer */
  storyFullScreen: {
    flex: 1,
    backgroundColor: '#09090b',
    justifyContent: 'space-between',
  },
  storyTopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
  },
  storyCloseCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(9, 9, 11, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyComposerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  storyComposerFooter: {
    paddingHorizontal: 16,
    gap: 10,
    zIndex: 10,
  },
  storyCaptionInput: {
    backgroundColor: 'rgba(24, 24, 27, 0.85)',
    color: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  storyShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    height: 48,
    borderRadius: 24,
  },
  storyShareBtnText: {
    color: '#09090b',
    fontSize: 15,
    fontWeight: '800',
  },
  storyTapRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    zIndex: 5,
  },
  storyTapHalf: {
    flex: 1,
  },
  storyViewerTop: {
    paddingHorizontal: 14,
    gap: 10,
    zIndex: 12,
  },
  storyProgressRow: {
    flexDirection: 'row',
    gap: 5,
  },
  storyProgressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.32)',
    overflow: 'hidden',
  },
  storyProgressFill: {
    height: '100%',
    backgroundColor: '#ffffff',
  },
  storyViewerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  storyViewerAuthorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  storyViewerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  storyViewerName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  storyViewerTime: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11.5,
    fontWeight: '500',
  },
  storyViewerCaptionBar: {
    paddingHorizontal: 18,
    paddingTop: 12,
    zIndex: 12,
  },
  storyViewerCaptionText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  streakHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  streakHeaderText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  upcomingLiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  upcomingLiveBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  upcomingLiveBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
  },
  upcomingLiveTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  upcomingLiveSub: {
    fontSize: 11.5,
    marginTop: 2,
  },
  upcomingRemindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#09090b',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  upcomingRemindText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '700',
  },
});