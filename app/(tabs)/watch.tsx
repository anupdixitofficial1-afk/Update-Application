import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { setStatusBarHidden, StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  DeviceEventEmitter,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { backend } from '../../lib/backend';
import {
  canViewWatchMedia,
  getSubscribedCreatorIds,
  normalizeVisibility,
  WatchVisibility,
} from '../../lib/watchVisibility';
import { WatchGridSkeleton } from '../../components/SkeletonLoader';
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
import { openMiniPlayer } from '../../lib/miniPlayerStore';
import {
  CommentMetaState,
  getCommentMeta,
  getScheduledLives,
  SCHEDULED_LIVES_UPDATED_EVENT,
  ScheduledLiveItem,
  toggleCommentCreatorLike,
  toggleLiveReminder,
  togglePinnedComment,
} from '../../lib/growthFeatures';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

type WatchSection = 'videos' | 'reels';
type WatchCategory = 'All' | 'Live' | 'Travel' | 'Tech' | 'Music' | 'Fitness';

interface CommentEntry {
  id: string;
  author: string;
  text: string;
  timeAgo: string;
}

interface VideoItem {
  id: string;
  creatorId: string | null;
  visibility: WatchVisibility;
  showLikes: boolean;
  showViews: boolean;
  allowComments: boolean;
  orientation: 'horizontal';
  title: string;
  creatorName: string;
  creatorHandle: string;
  creatorAvatar: string;
  thumbnailUrl: string;
  videoUrl?: string;
  category: Exclude<WatchCategory, 'All'>;
  isLive: boolean;
  viewsCount: number;
  likesCount: number;
  metaText: string;
  durationOrBadge: string;
  totalSeconds: number;
  description: string;
}

interface ReelItem {
  id: string;
  creatorId: string | null;
  visibility: WatchVisibility;
  showLikes: boolean;
  showViews: boolean;
  allowComments: boolean;
  orientation: 'vertical';
  title: string;
  creatorName: string;
  creatorHandle: string;
  creatorAvatar: string;
  coverUrl: string;
  reelUrl?: string;
  category: Exclude<WatchCategory, 'All'>;
  viewsCount: number;
  likesCount: number;
  viewsText: string;
  durationText: string;
  caption: string;
}

const WATCH_CATEGORIES: WatchCategory[] = [
  'All',
  'Live',
  'Travel',
  'Tech',
  'Music',
  'Fitness',
];

const { width: WATCH_SCREEN_WIDTH } = Dimensions.get('window');
const REEL_TILE_WIDTH = Math.floor((WATCH_SCREEN_WIDTH - 2) / 2);

const DEVICE_USER_KEY_STORAGE = 'watch_device_user_key_v1';

function formatViewsLabel(rawCount?: number | null): string {
  const count = Math.max(0, Math.floor(Number(rawCount) || 0));
  if (count === 1) return '1 view';
  if (count >= 1_000_000) {
    const val = (count / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${val}M views`;
  }
  if (count >= 1_000) {
    const val = (count / 1_000).toFixed(1).replace(/\.0$/, '');
    return `${val}K views`;
  }
  return `${count} views`;
}

function formatCountCompact(rawCount?: number | null): string {
  const count = Math.max(0, Math.floor(Number(rawCount) || 0));
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(count);
}

const normalizeCategory = (raw?: string): Exclude<WatchCategory, 'All'> => {
  const val = (raw || '').trim();
  if (
    val === 'Live' ||
    val === 'Travel' ||
    val === 'Tech' ||
    val === 'Music' ||
    val === 'Fitness'
  ) {
    return val;
  }
  return 'Travel';
};

function cleanAvatarUrl(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || /placehold\.co/i.test(trimmed)) return '';
  return trimmed;
}

async function resolveWatchUserKey(): Promise<string> {
  const currentUser = await backend.auth.getCurrentUser().catch(() => null);
  if (currentUser?.id) return currentUser.id;

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

function formatDurationClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function mapRowToVideo(row: any): VideoItem | null {
  if (!row || !row.title) return null;
  const cat = normalizeCategory(row.category);
  const isLive = Boolean(row.is_live) || cat === 'Live';
  const rawDuration =
    row.total_seconds ?? row.duration_sec ?? row.video_duration ?? 0;
  const totalSec =
    typeof rawDuration === 'number' && rawDuration > 0
      ? rawDuration > 10000
        ? Math.round(rawDuration / 1000)
        : rawDuration
      : 0;
  const showViews = row.show_views !== false;
  const timeLabel = formatRelativeTime(row.created_at);
  const viewsCount = Math.max(0, Number(row.views_count || 0));
  const viewsLabel = formatViewsLabel(viewsCount);

  return {
    id: String(row.id || `vid-${Date.now()}`),
    creatorId: row.creator_id ? String(row.creator_id) : null,
    visibility: normalizeVisibility(row.visibility),
    showLikes: row.show_likes !== false,
    showViews,
    allowComments: row.allow_comments !== false,
    orientation: 'horizontal',
    title: String(row.title),
    creatorName: row.creator_name || 'Creator Studio',
    creatorHandle: row.creator_handle || '@creator',
    creatorAvatar: cleanAvatarUrl(row.creator_avatar),
    thumbnailUrl: (row.thumbnail_url || row.cover_url || '').trim(),
    videoUrl: (row.media_url || row.video_url || '').trim() || undefined,
    category: cat,
    isLive,
    viewsCount,
    likesCount: Math.max(0, Number(row.likes_count || 0)),
    metaText: showViews ? `${viewsLabel} · ${timeLabel}` : timeLabel,
    durationOrBadge: isLive
      ? 'LIVE'
      : totalSec > 0
        ? formatDurationClock(totalSec)
        : '',
    totalSeconds: totalSec,
    description: row.description || '',
  };
}

function mapRowToReel(row: any): ReelItem | null {
  if (!row || !row.title) return null;
  const cat = normalizeCategory(row.category);
  const showViews = row.show_views !== false;
  const rawDuration =
    row.total_seconds ?? row.duration_sec ?? row.video_duration ?? 0;
  const totalSec =
    typeof rawDuration === 'number' && rawDuration > 0
      ? rawDuration > 10000
        ? Math.round(rawDuration / 1000)
        : rawDuration
      : 0;
  const viewsCount = Math.max(0, Number(row.views_count || 0));
  const viewsLabel = formatViewsLabel(viewsCount);
  const timeLabel = formatRelativeTime(row.created_at);
  const rawCaption = String(row.description || row.caption || '').replace(
    /^\[(PUBLIC|PRIVATE|FOLLOWERS|SUBSCRIBERS)\]\s*/i,
    ''
  );

  return {
    id: String(row.id || `reel-${Date.now()}`),
    creatorId: row.creator_id ? String(row.creator_id) : null,
    visibility: normalizeVisibility(row.visibility),
    showLikes: row.show_likes !== false,
    showViews,
    allowComments: row.allow_comments !== false,
    orientation: 'vertical',
    title: String(row.title),
    creatorName: row.creator_name || 'Creator Studio',
    creatorHandle: row.creator_handle || '@creator',
    creatorAvatar: cleanAvatarUrl(row.creator_avatar),
    coverUrl: (row.cover_url || row.thumbnail_url || '').trim(),
    reelUrl: (row.media_url || row.reel_url || '').trim() || undefined,
    category: cat,
    viewsCount,
    likesCount: Math.max(0, Number(row.likes_count || 0)),
    viewsText: showViews ? viewsLabel : timeLabel,
    durationText:
      totalSec > 0
        ? formatDurationClock(totalSec)
        : row.duration_text || '',
    caption: rawCaption,
  };
}

function isReelRow(row: any): boolean {
  return (
    row?.format === 'reel' ||
    row?.mode === 'reel' ||
    row?.media_type === 'reel' ||
    row?.orientation === 'vertical'
  );
}

async function setPlayerSourceSafe(
  player: any,
  uri: string,
  muted: boolean,
  shouldPlay: boolean
) {
  if (!player || !uri) return;
  try {
    player.loop = false;
    player.muted = muted;
    if (typeof player.replaceAsync === 'function') {
      await player.replaceAsync(uri);
    } else if (typeof player.replace === 'function') {
      player.replace(uri);
    }
    if (shouldPlay) {
      player.play?.();
    } else {
      player.pause?.();
    }
  } catch {
    // ignore source replacement race
  }
}

function CreatorAvatarBadge({
  uri,
  name,
  size = 38,
  bordered = false,
}: {
  uri?: string;
  name: string;
  size?: number;
  bordered?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const cleanUri = cleanAvatarUrl(uri);

  useEffect(() => {
    setFailed(false);
  }, [cleanUri]);

  const initials = (name || 'C')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  if (!cleanUri || failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#27272a',
          borderWidth: bordered ? 1.5 : 1,
          borderColor: bordered
            ? 'rgba(255,255,255,0.85)'
            : 'rgba(113,113,122,0.25)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: '#ffffff',
            fontWeight: '700',
            fontSize: Math.max(10, Math.round(size * 0.36)),
          }}
        >
          {initials || 'C'}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: cleanUri }}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#27272a',
        borderWidth: bordered ? 1.5 : 1,
        borderColor: bordered
          ? 'rgba(255,255,255,0.85)'
          : 'rgba(113,113,122,0.2)',
      }}
    />
  );
}

interface ActiveVideoStreamProps {
  uri: string;
  isPlaying: boolean;
  isMuted: boolean;
  seekCommand: { targetSec: number; seq: number } | null;
  onTimeSync: (elapsedSec: number, durationSec: number) => void;
  onVideoEnded: () => void;
}

function ActiveVideoStream({
  uri,
  isPlaying,
  isMuted,
  seekCommand,
  onTimeSync,
  onVideoEnded,
}: ActiveVideoStreamProps) {
  const videoViewRef = useRef<VideoView>(null);
  const playerRef = useRef<any>(null);
  const playingRef = useRef<boolean>(isPlaying);
  const mutedRef = useRef<boolean>(isMuted);
  const endedRef = useRef<boolean>(false);
  playingRef.current = isPlaying;
  mutedRef.current = isMuted;

  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = isMuted;
    if (isPlaying) p.play();
    else p.pause();
  });

  playerRef.current = player;

  useEffect(() => {
    endedRef.current = false;
    let active = true;
    setPlayerSourceSafe(
      playerRef.current,
      uri,
      mutedRef.current,
      playingRef.current
    ).then(() => {
      if (!active) return;
      try {
        if (playingRef.current) playerRef.current?.play?.();
      } catch {
        // ignore
      }
    });
    return () => {
      active = false;
    };
  }, [uri]);

  useEffect(() => {
    if (!playerRef.current) return;
    try {
      playerRef.current.loop = false;
      playerRef.current.muted = isMuted;
    } catch {
      // ignore
    }
  }, [isMuted]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;

    const endSub = p.addListener?.('playToEnd', () => {
      endedRef.current = true;
      onVideoEnded();
    });

    const statusSub = p.addListener?.('statusChange', (event: any) => {
      if (event?.status === 'readyToPlay' && playingRef.current) {
        try {
          p.play();
        } catch {
          // ignore
        }
      }
    });

    return () => {
      try {
        endSub?.remove?.();
        statusSub?.remove?.();
      } catch {
        // ignore
      }
    };
  }, [onVideoEnded]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (isPlaying) {
        if (endedRef.current) {
          endedRef.current = false;
          p.currentTime = 0;
        }
        p.play();
      } else {
        p.pause();
      }
    } catch {
      // ignore
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!seekCommand || !playerRef.current) return;
    try {
      endedRef.current = false;
      playerRef.current.currentTime = Math.max(0, seekCommand.targetSec);
    } catch {
      // ignore
    }
  }, [seekCommand]);

  useEffect(() => {
    const interval = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const cur = p.currentTime || 0;
        const dur = p.duration || 0;
        onTimeSync(cur, dur);
        if (dur > 0 && cur >= dur - 0.15 && !endedRef.current) {
          endedRef.current = true;
          onVideoEnded();
        }
      } catch {
        // ignore
      }
    }, 250);
    return () => clearInterval(interval);
  }, [onTimeSync, onVideoEnded]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={styles.videoPlayerSurface}
        contentFit="contain"
        nativeControls={false}
        surfaceType="textureView"
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture
      />
    </View>
  );
}

function extractRemixInfo(rawCaption?: string | null): {
  remixAuthor: string | null;
  cleanCaption: string;
} {
  const txt = String(rawCaption || '');
  const match = txt.match(/^\[remix:(@?[^|\]]+)\|([^\]]*)\]\s*/i);
  if (!match) return { remixAuthor: null, cleanCaption: txt };
  return {
    remixAuthor: match[1].startsWith('@') ? match[1] : `@${match[1]}`,
    cleanCaption: txt.slice(match[0].length).trim(),
  };
}

function MutedPreviewVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    try {
      player.muted = true;
      player.play();
    } catch {}
  }, [player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

interface ActiveReelStreamProps {
  uri: string;
  isPlaying: boolean;
  isMuted: boolean;
}

function ActiveReelStream({ uri, isPlaying, isMuted }: ActiveReelStreamProps) {
  const reelViewRef = useRef<VideoView>(null);
  const playerRef = useRef<any>(null);
  const playingRef = useRef<boolean>(isPlaying);
  const mutedRef = useRef<boolean>(isMuted);
  playingRef.current = isPlaying;
  mutedRef.current = isMuted;

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = isMuted;
    if (isPlaying) p.play();
    else p.pause();
  });

  playerRef.current = player;

  useEffect(() => {
    setPlayerSourceSafe(
      playerRef.current,
      uri,
      mutedRef.current,
      playingRef.current
    );
  }, [uri]);

  useEffect(() => {
    if (!playerRef.current) return;
    try {
      playerRef.current.muted = isMuted;
    } catch {
      // ignore
    }
  }, [isMuted]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (isPlaying) p.play();
      else p.pause();
    } catch {
      // ignore
    }
  }, [isPlaying]);

  return (
    <View pointerEvents="none" style={styles.fullVideoImage}>
      <VideoView
        ref={reelViewRef}
        player={player}
        style={styles.fullVideoImage}
        contentFit="cover"
        nativeControls={false}
      />
    </View>
  );
}

export default function WatchScreen() {
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
      liveRed: '#ef4444',
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

  const [activeSection, setActiveSection] = useState<WatchSection>('videos');
  const activeSectionRef = useRef<WatchSection>(activeSection);
  activeSectionRef.current = activeSection;
  const [reelViewport, setReelViewport] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const reelPagerRef = useRef<FlatList<ReelItem>>(null);
  const sectionSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 18 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -45 && activeSectionRef.current === 'videos') {
            setActiveSection('reels');
          } else if (gesture.dx > 45 && activeSectionRef.current === 'reels') {
            setActiveSection('videos');
          }
        },
      }),
    []
  );
  const [selectedCategory, setSelectedCategory] = useState<WatchCategory>('All');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [reels, setReels] = useState<ReelItem[]>([]);

  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);
  const [activeReelIndex, setActiveReelIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isEnded, setIsEnded] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState<boolean>(false);
  const [showVideoControls, setShowVideoControls] = useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [activeDurationSec, setActiveDurationSec] = useState<number>(0);
  const [seekCommand, setSeekCommand] = useState<{
    targetSec: number;
    seq: number;
  } | null>(null);
  const [progressBarWidth, setProgressBarWidth] = useState<number>(1);
  const [seekBadge, setSeekBadge] = useState<{
    side: 'left' | 'right';
    key: number;
  } | null>(null);

  const stageWidthRef = useRef<number>(1);
  const lastTapRef = useRef<{ time: number; x: number } | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSingleTapTimer = useCallback(() => {
    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
    }
    lastTapRef.current = null;
  }, []);

  const clearSeekBadgeTimer = useCallback(() => {
    if (seekBadgeTimerRef.current) {
      clearTimeout(seekBadgeTimerRef.current);
      seekBadgeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearSingleTapTimer();
      clearSeekBadgeTimer();
    };
  }, [clearSingleTapTimer, clearSeekBadgeTimer]);

  const [controlsNonce, setControlsNonce] = useState<number>(0);
  const showVideoControlsRef = useRef<boolean>(showVideoControls);
  showVideoControlsRef.current = showVideoControls;

  const revealVideoControls = useCallback(() => {
    setShowVideoControls(true);
    setControlsNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!activeVideo || !isPlaying || !showVideoControls) return;
    const hideTimer = setTimeout(() => {
      setShowVideoControls(false);
    }, 3000);
    return () => clearTimeout(hideTimer);
  }, [
    activeVideo?.id,
    isVideoFullscreen,
    isPlaying,
    showVideoControls,
    controlsNonce,
  ]);

  const wantsLandscape = isVideoFullscreen && !!activeVideo;
  useEffect(() => {
    StatusBar.setHidden(wantsLandscape, 'fade');
    setStatusBarHidden(wantsLandscape, 'fade');
    ScreenOrientation.lockAsync(
      wantsLandscape
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP
    ).catch(() => {});
  }, [wantsLandscape]);

  useEffect(() => {
    return () => {
      StatusBar.setHidden(false, 'fade');
      setStatusBarHidden(false, 'fade');
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {});
    };
  }, []);

  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});
  const [dislikedIds, setDislikedIds] = useState<Record<string, boolean>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [subscribedHandles, setSubscribedHandles] = useState<
    Record<string, boolean>
  >({});

  const [commentTargetId, setCommentTargetId] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState<string>('');
  const [commentsByMedia, setCommentsByMedia] = useState<
    Record<string, CommentEntry[]>
  >({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [authUserIdState, setAuthUserIdState] = useState<string | null>(null);
  const [scheduledLives, setScheduledLives] = useState<ScheduledLiveItem[]>([]);
  const [shareModalItem, setShareModalItem] =
    useState<ShareCardPayload | null>(null);
  const [collectionModalTarget, setCollectionModalTarget] =
    useState<CollectionSaveTarget | null>(null);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const [reelHeartBurstKey, setReelHeartBurstKey] = useState(0);
  const reelTapTimerRef = useRef<number>(0);
  const [commentMetaByMedia, setCommentMetaByMedia] = useState<
    Record<string, CommentMetaState>
  >({});

  const appendCreatedMedia = useCallback(async (row: any) => {
    if (!row || !row.title) return;

    const currentUser = await backend.auth.getCurrentUser().catch(() => null);
    const viewerId = currentUser?.id || null;

    const subIds = await getSubscribedCreatorIds(viewerId);
    if (!canViewWatchMedia(row, viewerId, subIds)) return;

    if (isReelRow(row)) {
      const nextReel = mapRowToReel(row);
      if (!nextReel) return;
      setReels((prev) => [
        nextReel,
        ...prev.filter((item) => item.id !== nextReel.id),
      ]);
    } else {
      const nextVideo = mapRowToVideo(row);
      if (!nextVideo) return;
      setVideos((prev) => [
        nextVideo,
        ...prev.filter((item) => item.id !== nextVideo.id),
      ]);
    }
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'watch-media-created',
      (payload) => {
        void appendCreatedMedia(payload);
      }
    );
    return () => sub.remove();
  }, [appendCreatedMedia]);

  const syncWatchData = useCallback(async () => {
    try {
      const [userKey, currentUser] = await Promise.all([
        resolveWatchUserKey(),
        backend.auth.getCurrentUser().catch(() => null),
      ]);

      const authUserId = currentUser?.id || null;
      setAuthUserIdState(authUserId);
      const authAvatarFallback = cleanAvatarUrl(currentUser?.avatarUrl || '');

      const [watchPayload, subscribedCreators] = await Promise.all([
        backend.watch.getWatchData(userKey, 50),
        getSubscribedCreatorIds(authUserId),
      ]);

      const nextLiked: Record<string, boolean> = {};
      const nextDisliked: Record<string, boolean> = {};
      const nextSaved: Record<string, boolean> = {};
      for (const row of watchPayload.reactions) {
        if (row.liked) nextLiked[row.media_id] = true;
        if (row.disliked) nextDisliked[row.media_id] = true;
        if (row.saved) nextSaved[row.media_id] = true;
      }
      setLikedIds(nextLiked);
      setDislikedIds(nextDisliked);
      setSavedIds(nextSaved);

      const nextSubs: Record<string, boolean> = {};
      for (const handle of watchPayload.subscriptions) {
        nextSubs[handle] = true;
      }
      setSubscribedHandles(nextSubs);

      const dbCommentsByMedia: Record<string, CommentEntry[]> = {};
      for (const row of watchPayload.comments) {
        if (!dbCommentsByMedia[row.media_id]) {
          dbCommentsByMedia[row.media_id] = [];
        }
        dbCommentsByMedia[row.media_id].push({
          id: row.id,
          author: row.author,
          text: row.comment_text,
          timeAgo: formatRelativeTime(row.created_at),
        });
      }
      setCommentsByMedia(dbCommentsByMedia);

      const dbVideos: VideoItem[] = [];
      const dbReels: ReelItem[] = [];

      for (const row of watchPayload.media) {
        if (!canViewWatchMedia(row, authUserId, subscribedCreators)) continue;

        const enrichedRow =
          !cleanAvatarUrl(row.creator_avatar) &&
          authUserId &&
          row.creator_id === authUserId &&
          authAvatarFallback
            ? { ...row, creator_avatar: authAvatarFallback }
            : row;

        if (isReelRow(enrichedRow)) {
          const mappedReel = mapRowToReel(enrichedRow);
          if (mappedReel) dbReels.push(mappedReel);
        } else {
          const mappedVideo = mapRowToVideo(enrichedRow);
          if (mappedVideo) dbVideos.push(mappedVideo);
        }
      }

      setVideos(dbVideos);
      setReels(dbReels);
    } catch {
      // Keep current state when offline
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void syncWatchData();
    void getScheduledLives().then(setScheduledLives);
    const subSched = DeviceEventEmitter.addListener(
      SCHEDULED_LIVES_UPDATED_EVENT,
      () => {
        void getScheduledLives().then(setScheduledLives);
      }
    );
    return () => {
      subSched.remove();
    };
  }, [syncWatchData]);

  useEffect(() => {
    if (!commentTargetId) return;
    void getCommentMeta(commentTargetId).then((meta) => {
      setCommentMetaByMedia((prev) => ({ ...prev, [commentTargetId]: meta }));
    });
  }, [commentTargetId]);

  const persistReaction = useCallback(
    async (
      mediaId: string,
      patch: Partial<{ liked: boolean; disliked: boolean; saved: boolean }>
    ) => {
      try {
        const userKey = await resolveWatchUserKey();
        await backend.watch.upsertReaction(userKey, mediaId, patch);
      } catch {
        // Keep optimistic state
      }
    },
    []
  );

  const persistSubscription = useCallback(
    async (creatorHandle: string, subscribed: boolean) => {
      try {
        const userKey = await resolveWatchUserKey();
        await backend.watch.setSubscription(userKey, creatorHandle, subscribed);
      } catch {
        // Keep optimistic state
      }
    },
    []
  );

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    setIsEnded(true);
    revealVideoControls();
  }, [revealVideoControls]);

  useEffect(() => {
    if (!activeVideo || activeVideo.videoUrl || !isPlaying) return;
    const maxSec = activeDurationSec || activeVideo.totalSeconds;
    if (!maxSec || maxSec <= 0) return;
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => {
        if (prev + 1 >= maxSec) {
          handleVideoEnded();
          return maxSec;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeVideo, activeDurationSec, isPlaying, handleVideoEnded]);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (commentTargetId !== null) {
          setCommentTargetId(null);
          return true;
        }
        if (isVideoFullscreen) {
          clearSingleTapTimer();
          setIsVideoFullscreen(false);
          revealVideoControls();
          return true;
        }
        if (activeReelIndex !== null) {
          setActiveReelIndex(null);
          setActiveSection('videos');
          return true;
        }
        if (activeVideo !== null) {
          clearSingleTapTimer();
          setIsVideoFullscreen(false);
          setActiveVideo(null);
          return true;
        }
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
          return true;
        }
        if (activeSection === 'reels') {
          setActiveSection('videos');
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress
      );
      return () => subscription.remove();
    }, [
      activeSection,
      activeReelIndex,
      activeVideo,
      isVideoFullscreen,
      commentTargetId,
      searchOpen,
      clearSingleTapTimer,
      revealVideoControls,
    ])
  );

  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return videos.filter((item) => {
      if (item.orientation !== 'horizontal') return false;
      const matchesCategory =
        selectedCategory === 'All' ||
        (selectedCategory === 'Live' && item.isLive) ||
        item.category === selectedCategory;
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.creatorName.toLowerCase().includes(q) ||
        item.creatorHandle.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [videos, selectedCategory, searchQuery]);

  const filteredReels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reels.filter((item) => {
      if (item.orientation !== 'vertical') return false;
      const matchesCategory =
        selectedCategory === 'All' ||
        selectedCategory === 'Live' ||
        item.category === selectedCategory;
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.creatorName.toLowerCase().includes(q) ||
        item.creatorHandle.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [reels, selectedCategory, searchQuery]);

  const upNextVideos = useMemo(() => {
    if (!activeVideo) return [];
    return filteredVideos.filter((v) => v.id !== activeVideo.id);
  }, [filteredVideos, activeVideo]);

  const activeReel =
    activeReelIndex !== null && filteredReels[activeReelIndex]
      ? filteredReels[activeReelIndex]
      : null;

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    syncWatchData().finally(() => setRefreshing(false));
  }, [syncWatchData]);

  const viewedMediaIdsRef = useRef<Set<string>>(new Set());

  const trackMediaView = useCallback(
    (mediaId: string, kind: 'video' | 'reel', currentViews: number) => {
      if (!mediaId || viewedMediaIdsRef.current.has(mediaId)) return;
      viewedMediaIdsRef.current.add(mediaId);
      const nextViews = Math.max(1, currentViews + 1);
      const nextViewsText = formatViewsLabel(nextViews);

      if (kind === 'video') {
        setVideos((prev) =>
          prev.map((v) => {
            if (v.id !== mediaId) return v;
            const timePart = v.metaText.includes(' · ')
              ? v.metaText.split(' · ').slice(1).join(' · ')
              : 'Just now';
            return {
              ...v,
              viewsCount: nextViews,
              metaText: v.showViews ? `${nextViewsText} · ${timePart}` : timePart,
            };
          })
        );
        setActiveVideo((prev) => {
          if (!prev || prev.id !== mediaId) return prev;
          const timePart = prev.metaText.includes(' · ')
            ? prev.metaText.split(' · ').slice(1).join(' · ')
            : 'Just now';
          return {
            ...prev,
            viewsCount: nextViews,
            metaText: prev.showViews ? `${nextViewsText} · ${timePart}` : timePart,
          };
        });
      } else {
        setReels((prev) =>
          prev.map((r) =>
            r.id === mediaId
              ? {
                  ...r,
                  viewsCount: nextViews,
                  viewsText: r.showViews ? nextViewsText : r.viewsText,
                }
              : r
          )
        );
      }

      backend.studio
        .updateWatchMedia(mediaId, { views_count: nextViews })
        .catch(() => {});
    },
    []
  );

  const handleOpenVideoPlayer = useCallback(
    (item: VideoItem) => {
      clearSingleTapTimer();
      clearSeekBadgeTimer();
      setSeekBadge(null);
      setActiveVideo(item);
      setElapsedSeconds(0);
      setActiveDurationSec(item.totalSeconds);
      setSeekCommand(null);
      setIsEnded(false);
      setIsVideoFullscreen(false);
      setIsPlaying(true);
      revealVideoControls();
      trackMediaView(item.id, 'video', item.viewsCount);
    },
    [
      clearSingleTapTimer,
      clearSeekBadgeTimer,
      revealVideoControls,
      trackMediaView,
    ]
  );

  const effectiveTotalSeconds =
    activeDurationSec > 0 ? activeDurationSec : activeVideo?.totalSeconds || 0;

  const handlePrimaryPlayOrReplay = useCallback(() => {
    if (isEnded) {
      setIsEnded(false);
      setElapsedSeconds(0);
      setSeekCommand((prev) => ({ targetSec: 0, seq: (prev?.seq || 0) + 1 }));
      setIsPlaying(true);
      revealVideoControls();
      return;
    }
    setIsPlaying((p) => !p);
    revealVideoControls();
  }, [isEnded, revealVideoControls]);

  const triggerSeekBadge = useCallback(
    (side: 'left' | 'right') => {
      clearSeekBadgeTimer();
      setSeekBadge({ side, key: Date.now() });
      seekBadgeTimerRef.current = setTimeout(() => {
        seekBadgeTimerRef.current = null;
        setSeekBadge(null);
      }, 650);
    },
    [clearSeekBadgeTimer]
  );

  const handleSeekRelative = useCallback(
    (deltaSec: number) => {
      if (!activeVideo) return;
      const maxDur = Math.max(1, effectiveTotalSeconds);
      const nextSec = Math.min(maxDur, Math.max(0, elapsedSeconds + deltaSec));
      setIsEnded(false);
      setElapsedSeconds(nextSec);
      setSeekCommand((prev) => ({
        targetSec: nextSec,
        seq: (prev?.seq || 0) + 1,
      }));
      triggerSeekBadge(deltaSec < 0 ? 'left' : 'right');
      revealVideoControls();
    },
    [
      activeVideo,
      effectiveTotalSeconds,
      elapsedSeconds,
      triggerSeekBadge,
      revealVideoControls,
    ]
  );

  const handleSeekByTouch = useCallback(
    (locationX: number) => {
      if (!activeVideo || progressBarWidth <= 0) return;
      const maxDur = Math.max(1, effectiveTotalSeconds);
      const ratio = Math.min(1, Math.max(0, locationX / progressBarWidth));
      const nextSec = Math.round(ratio * maxDur);
      setIsEnded(false);
      setElapsedSeconds(nextSec);
      setSeekCommand((prev) => ({
        targetSec: nextSec,
        seq: (prev?.seq || 0) + 1,
      }));
      revealVideoControls();
    },
    [activeVideo, effectiveTotalSeconds, progressBarWidth, revealVideoControls]
  );

  const handleToggleAppFullscreen = useCallback(() => {
    clearSingleTapTimer();
    setIsVideoFullscreen((prev) => !prev);
    revealVideoControls();
  }, [clearSingleTapTimer, revealVideoControls]);

  const seekRelativeRef = useRef(handleSeekRelative);
  seekRelativeRef.current = handleSeekRelative;

  const handleStageTap = useCallback(
    (tapX: number) => {
      const now = Date.now();
      const prevTap = lastTapRef.current;

      if (
        prevTap &&
        now - prevTap.time < 300 &&
        Math.abs(tapX - prevTap.x) < 90
      ) {
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapRef.current = null;
        const goBack = tapX < stageWidthRef.current / 2;
        seekRelativeRef.current(goBack ? -10 : 10);
        return;
      }

      lastTapRef.current = { time: now, x: tapX };
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }

      if (!showVideoControlsRef.current) {
        revealVideoControls();
        singleTapTimerRef.current = setTimeout(() => {
          singleTapTimerRef.current = null;
          lastTapRef.current = null;
        }, 300);
        return;
      }

      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        lastTapRef.current = null;
        setShowVideoControls(false);
      }, 280);
    },
    [revealVideoControls]
  );

  const handleOpenReelPlayer = useCallback(
    (item: ReelItem) => {
      const idx = filteredReels.findIndex((r) => r.id === item.id);
      setActiveReelIndex(idx >= 0 ? idx : 0);
      setIsPlaying(true);
      trackMediaView(item.id, 'reel', item.viewsCount);
    },
    [filteredReels, trackMediaView]
  );

  useEffect(() => {
    if (activeReel) {
      trackMediaView(activeReel.id, 'reel', activeReel.viewsCount);
    }
  }, [activeReel?.id]);

  const handleNavigateToCreator = useCallback(
    (handle: string, mediaId: string) => {
      clearSingleTapTimer();
      setIsVideoFullscreen(false);
      setCommentTargetId(null);
      setActiveVideo(null);
      setActiveReelIndex(null);
      router.push({
        pathname: '/profile',
        params: {
          username: handle.replace(/^@/, ''),
          mediaId,
          fromWatch: '1',
        },
      } as any);
    },
    [clearSingleTapTimer]
  );

  const toggleLike = useCallback(
    (id: string) => {
      const nextLiked = !likedIds[id];
      const nextDisliked = nextLiked ? false : !!dislikedIds[id];
      const delta = nextLiked ? 1 : -1;

      setLikedIds((prev) => ({ ...prev, [id]: nextLiked }));
      if (nextLiked) setDislikedIds((d) => ({ ...d, [id]: false }));

      let computedLikes: number | null = null;
      setVideos((prev) =>
        prev.map((v) => {
          if (v.id !== id) return v;
          computedLikes = Math.max(0, v.likesCount + delta);
          return { ...v, likesCount: computedLikes };
        })
      );
      setReels((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          computedLikes = Math.max(0, r.likesCount + delta);
          return { ...r, likesCount: computedLikes };
        })
      );
      setActiveVideo((prev) => {
        if (!prev || prev.id !== id) return prev;
        const nextVal = Math.max(0, prev.likesCount + delta);
        if (computedLikes === null) computedLikes = nextVal;
        return { ...prev, likesCount: nextVal };
      });

      void persistReaction(id, {
        liked: nextLiked,
        disliked: nextDisliked,
      });

      if (computedLikes !== null) {
        void backend.studio
          .updateWatchMedia(id, { likes_count: computedLikes })
          .catch(() => {});
      }
    },
    [likedIds, dislikedIds, persistReaction]
  );

  const toggleDislike = useCallback(
    (id: string) => {
      const nextDisliked = !dislikedIds[id];
      const nextLiked = nextDisliked ? false : !!likedIds[id];
      setDislikedIds((prev) => ({ ...prev, [id]: nextDisliked }));
      if (nextDisliked) setLikedIds((l) => ({ ...l, [id]: false }));
      void persistReaction(id, {
        disliked: nextDisliked,
        liked: nextLiked,
      });
    },
    [dislikedIds, likedIds, persistReaction]
  );

  const toggleSave = useCallback(
    (id: string) => {
      const nextSaved = !savedIds[id];
      setSavedIds((prev) => ({ ...prev, [id]: nextSaved }));
      void persistReaction(id, { saved: nextSaved });
    },
    [savedIds, persistReaction]
  );

  const toggleSubscribe = useCallback(
    (handle: string) => {
      const nextSub = !subscribedHandles[handle];
      setSubscribedHandles((prev) => ({ ...prev, [handle]: nextSub }));
      void persistSubscription(handle, nextSub);
    },
    [subscribedHandles, persistSubscription]
  );

  const handleShareMedia = useCallback(
    (
      title: string,
      creatorName: string,
      extra?: Partial<ShareCardPayload>
    ) => {
      setShareModalItem({
        id: extra?.id || `watch-${Date.now()}`,
        kind: extra?.kind || (activeSection === 'reels' ? 'reel' : 'video'),
        title,
        creatorHandle: creatorName,
        thumbnailUrl: extra?.thumbnailUrl,
      });
    },
    [activeSection]
  );

  const weeklyLeaderboard = useMemo(() => {
    const map = new Map<
      string,
      {
        handle: string;
        name: string;
        avatar: string;
        category: string;
        score: number;
        views: number;
      }
    >();
    const consider = (item: {
      creatorHandle: string;
      creatorName: string;
      creatorAvatar: string;
      category: string;
      viewsCount: number;
      likesCount: number;
    }) => {
      if (
        selectedCategory !== 'All' &&
        selectedCategory !== 'Live' &&
        item.category !== selectedCategory
      ) {
        return;
      }
      const key = item.creatorHandle || item.creatorName;
      const prev = map.get(key);
      const itemScore = item.viewsCount + item.likesCount * 5 + 10;
      map.set(key, {
        handle: item.creatorHandle,
        name: item.creatorName,
        avatar: item.creatorAvatar,
        category: item.category,
        score: (prev?.score || 0) + itemScore,
        views: (prev?.views || 0) + item.viewsCount,
      });
    };
    videos.forEach(consider);
    reels.forEach(consider);
    return Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [videos, reels, selectedCategory]);

  const handleAddComment = useCallback(async () => {
    const trimmed = commentInput.trim();
    if (!trimmed || !commentTargetId) return;

    const targetId = commentTargetId;
    const newEntry: CommentEntry = {
      id: `c-${Date.now()}`,
      author: 'You',
      text: trimmed,
      timeAgo: 'Just now',
    };

    setCommentsByMedia((prev) => ({
      ...prev,
      [targetId]: [newEntry, ...(prev[targetId] || [])],
    }));
    setCommentInput('');

    try {
      await backend.watch.addComment({
        id: newEntry.id,
        mediaId: targetId,
        author: newEntry.author,
        text: newEntry.text,
      });
    } catch {
      // keep optimistic
    }
  }, [commentInput, commentTargetId]);

  const bottomNavClearance =
    Platform.OS === 'android'
      ? Math.max(insets.bottom, 24) + 96
      : Math.max(insets.bottom, 16) + 96;
  const reelBottomSafePadding =
    Platform.OS === 'android'
      ? Math.max(insets.bottom, 0) + 12
      : Math.max(insets.bottom, 12) + 8;
  const reelTopSafePadding = Math.max(insets.top, 16) + 8;

  const activeVideoComments = activeVideo
    ? commentsByMedia[activeVideo.id] || []
    : [];
  const activeVideoLastComment =
    activeVideoComments.length > 0 ? activeVideoComments[0] : null;

  const progressPercent = activeVideo
    ? Math.min(
        100,
        Math.max(
          0,
          (elapsedSeconds / Math.max(1, effectiveTotalSeconds || 1)) * 100
        )
      )
    : 0;

  /* EDGE-TO-EDGE VIDEO FEED ITEM */
  const renderVideoItem = ({
    item,
    index,
  }: {
    item: VideoItem;
    index: number;
  }) => {
    const shouldAutoPreview =
      index === 0 &&
      !activeVideo &&
      activeReelIndex === null &&
      activeSection === 'videos' &&
      Boolean(item.videoUrl);

    return (
      <TouchableOpacity
        style={[
          styles.edgeVideoItem,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
        activeOpacity={0.92}
        onPress={() => handleOpenVideoPlayer(item)}
      >
        <View
          style={[styles.edgeThumbBox, { backgroundColor: colors.surface }]}
        >
          {item.thumbnailUrl ? (
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.fullImg}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <Ionicons
                name="videocam-outline"
                size={28}
                color={colors.subtext}
              />
            </View>
          )}

          {shouldAutoPreview && item.videoUrl ? (
            <MutedPreviewVideoPlayer uri={item.videoUrl} />
          ) : null}

          {shouldAutoPreview ? (
            <View style={styles.mutedPreviewTag}>
              <Ionicons name="volume-mute" size={11} color="#fff" />
              <Text style={styles.mutedPreviewTagText}>Preview</Text>
            </View>
          ) : null}

        {item.durationOrBadge ? (
          <View
            style={[
              styles.durationPill,
              item.isLive && styles.liveDurationPill,
            ]}
          >
            {item.isLive ? <View style={styles.liveDotWhite} /> : null}
            <Text style={styles.durationPillText}>{item.durationOrBadge}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.edgeVideoMeta}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleNavigateToCreator(item.creatorHandle, item.id)}
        >
          <CreatorAvatarBadge
            uri={item.creatorAvatar}
            name={item.creatorName}
            size={38}
          />
        </TouchableOpacity>
        <View style={styles.videoTextCol}>
          <Text
            style={[styles.videoTitle, { color: colors.text }]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <Text
            style={[styles.videoSubtext, { color: colors.subtext }]}
            numberOfLines={1}
          >
            {item.creatorName} · {item.metaText}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.moreIconBtn}
          onPress={() => handleOpenVideoPlayer(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={colors.subtext} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
    );
  };

  /* EDGE-TO-EDGE SEAMLESS REELS GRID ITEM */
  const renderReelCard = ({ item }: { item: ReelItem }) => (
    <TouchableOpacity
      style={styles.edgeReelTile}
      activeOpacity={0.92}
      onPress={() => handleOpenReelPlayer(item)}
    >
      {item.coverUrl ? (
        <Image
          source={{ uri: item.coverUrl }}
          style={styles.fullImg}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.reelPlaceholder}>
          <Ionicons name="sparkles-outline" size={26} color="#71717a" />
        </View>
      )}

      {item.durationText ? (
        <View style={styles.reelTopRight}>
          <View style={styles.reelDurationBadge}>
            <Ionicons name="play" size={9} color="#ffffff" />
            <Text style={styles.reelDurationText}>{item.durationText}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.reelBottomScrim}>
        <Text style={styles.reelTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.reelCreatorRow}>
          <CreatorAvatarBadge
            uri={item.creatorAvatar}
            name={item.creatorName}
            size={18}
            bordered
          />
          <Text style={styles.reelCreatorText} numberOfLines={1}>
            {item.creatorName}
          </Text>
        </View>
        <View style={styles.reelViewsRow}>
          <Ionicons name="eye-outline" size={11} color="#e4e4e7" />
          <Text style={styles.reelViewsText} numberOfLines={1}>
            {item.viewsText}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const activeCommentMeta: CommentMetaState = commentTargetId
    ? commentMetaByMedia[commentTargetId] || {
        pinnedCommentId: null,
        creatorLikedIds: [],
      }
    : { pinnedCommentId: null, creatorLikedIds: [] };

  const commentListForTarget = useMemo(() => {
    const list = commentTargetId ? commentsByMedia[commentTargetId] || [] : [];
    const pinId = activeCommentMeta.pinnedCommentId;
    if (!pinId) return list;
    return [...list].sort((a, b) =>
      a.id === pinId ? -1 : b.id === pinId ? 1 : 0
    );
  }, [commentTargetId, commentsByMedia, activeCommentMeta.pinnedCommentId]);
  const canSendComment = commentInput.trim().length > 0;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      {/* MINIMAL EDGE-TO-EDGE HEADER */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        {searchOpen ? (
          <View
            style={[
              styles.inlineSearchBar,
              { backgroundColor: colors.surface },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={colors.subtext} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={
                activeSection === 'videos'
                  ? 'Search videos, creators...'
                  : 'Search reels, creators...'
              }
              placeholderTextColor={colors.subtext}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                setSearchOpen(false);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={19} color={colors.text} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Watch
            </Text>

            <View style={styles.headerRightActions}>
              <TouchableOpacity
                style={[styles.headerIconBtn, { backgroundColor: colors.surface }]}
                onPress={() => setLeaderboardVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="trophy-outline" size={18} color="#f59e0b" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerIconBtn, { backgroundColor: colors.surface }]}
                onPress={() => setSearchOpen(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="search-outline" size={19} color={colors.text} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* EDGE-TO-EDGE UNDERLINE SECTION TABS */}
      <View
        style={[
          styles.sectionTabsBar,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        {(
          [
            { key: 'videos', label: 'Videos' },
            { key: 'reels', label: 'Reels' },
          ] as const
        ).map((tab) => {
          const active = activeSection === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.sectionTabBtn,
                active && { borderBottomColor: colors.text },
              ]}
              onPress={() => setActiveSection(tab.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.sectionTabText,
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

      {/* EDGE-TO-EDGE CATEGORY STRIP */}
      <View
        style={[
          styles.categoryStrip,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {WATCH_CATEGORIES.map((category) => {
            const active = selectedCategory === category;
            const isLiveChip = category === 'Live';
            return (
              <TouchableOpacity
                key={category}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.accent : colors.surface,
                  },
                ]}
                onPress={() => setSelectedCategory(category)}
                activeOpacity={0.82}
              >
                {isLiveChip ? <View style={styles.chipLiveDot} /> : null}
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? colors.accentText : colors.subtext },
                    active && { fontWeight: '700' },
                  ]}
                >
                  {category}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* SWIPEABLE VIDEOS / REELS FEEDS */}
      <View style={{ flex: 1 }} {...sectionSwipeResponder.panHandlers}>
        {/* EDGE-TO-EDGE VIDEOS FEED */}
        {activeSection === 'videos' &&
          (isInitialLoading && filteredVideos.length === 0 ? (
            <WatchGridSkeleton isDark={isDark} />
          ) : (
            <FlatList
              key="videos-list"
              data={filteredVideos}
              keyExtractor={(item) => item.id}
              renderItem={renderVideoItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomNavClearance }}
              ListHeaderComponent={
                scheduledLives.length > 0 ? (
                  <View
                    style={[
                      styles.scheduledSection,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={styles.scheduledHeaderRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="calendar-outline" size={15} color="#ef4444" />
                        <Text style={[styles.scheduledHeading, { color: colors.text }]}>
                          Upcoming Live Premieres
                        </Text>
                      </View>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingHorizontal: 14, gap: 10 }}
                    >
                      {scheduledLives.map((sched) => {
                        const minsLeft = Math.max(
                          1,
                          Math.round((sched.scheduledAtMs - Date.now()) / 60000)
                        );
                        const timeLabel =
                          minsLeft >= 60
                            ? `In ${Math.round(minsLeft / 60)}h`
                            : `In ${minsLeft}m`;
                        return (
                          <View
                            key={sched.id}
                            style={[
                              styles.scheduledCard,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.borderStrong,
                              },
                            ]}
                          >
                            <View style={styles.scheduledTopMeta}>
                              <View style={styles.schedCountdownBadge}>
                                <Text style={styles.schedCountdownText}>
                                  {timeLabel}
                                </Text>
                              </View>
                              <Text
                                style={[
                                  styles.schedCategory,
                                  { color: colors.subtext },
                                ]}
                              >
                                {sched.category}
                              </Text>
                            </View>
                            <Text
                              style={[styles.schedTitle, { color: colors.text }]}
                              numberOfLines={2}
                            >
                              {sched.title}
                            </Text>
                            <Text
                              style={[styles.schedHost, { color: colors.subtext }]}
                              numberOfLines={1}
                            >
                              {sched.hostName} · {sched.hostHandle}
                            </Text>
                            <TouchableOpacity
                              style={[
                                styles.schedRemindBtn,
                                sched.reminded && styles.schedRemindBtnActive,
                              ]}
                              onPress={() =>
                                void toggleLiveReminder(sched.id).then(
                                  setScheduledLives
                                )
                              }
                            >
                              <Ionicons
                                name={
                                  sched.reminded
                                    ? 'notifications'
                                    : 'notifications-outline'
                                }
                                size={14}
                                color={sched.reminded ? '#052e16' : '#ffffff'}
                              />
                              <Text
                                style={[
                                  styles.schedRemindText,
                                  sched.reminded && { color: '#052e16' },
                                ]}
                              >
                                {sched.reminded ? 'Reminder Set' : 'Remind Me'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : undefined
              }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.text}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <View
                  style={[
                    styles.emptyIconCircle,
                    { backgroundColor: colors.surface },
                  ]}
                >
                  <Ionicons
                    name="videocam-outline"
                    size={26}
                    color={colors.subtext}
                  />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  No videos found
                </Text>
                <Text style={[styles.emptyText, { color: colors.subtext }]}>
                  Try switching categories or searching another keyword.
                </Text>
              </View>
            }
          />
          ))}

        {/* EDGE-TO-EDGE SEAMLESS REELS GRID */}
        {activeSection === 'reels' && (
          <FlatList
            key="reels-grid"
            data={filteredReels}
            numColumns={2}
            keyExtractor={(item) => item.id}
            renderItem={renderReelCard}
            showsVerticalScrollIndicator={false}
            columnWrapperStyle={styles.edgeReelsRow}
            contentContainerStyle={{ paddingBottom: bottomNavClearance }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.text}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <View
                  style={[
                    styles.emptyIconCircle,
                    { backgroundColor: colors.surface },
                  ]}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={26}
                    color={colors.subtext}
                  />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  No reels found
                </Text>
                <Text style={[styles.emptyText, { color: colors.subtext }]}>
                  Check back soon or explore another category.
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* EDGE-TO-EDGE VIDEO PLAYER MODAL */}
      <Modal
        visible={!!activeVideo}
        animationType="slide"
        presentationStyle="fullScreen"
        supportedOrientations={['portrait', 'landscape']}
        statusBarTranslucent={isVideoFullscreen}
        navigationBarTranslucent={false}
        onRequestClose={() => {
          clearSingleTapTimer();
          if (isVideoFullscreen) {
            setIsVideoFullscreen(false);
            revealVideoControls();
            return;
          }
          setActiveVideo(null);
        }}
      >
        <SafeAreaView
          style={styles.watchScreenContainer}
          edges={isVideoFullscreen ? [] : ['top']}
        >
          <ExpoStatusBar hidden={wantsLandscape} />
          {activeVideo && (
            <>
              <View
                style={[
                  isVideoFullscreen
                    ? styles.fullscreenVideoStage
                    : styles.fullVideoStage,
                  isVideoFullscreen && {
                    paddingTop: Math.max(insets.top, 8),
                    paddingBottom: Math.max(insets.bottom, 10),
                    paddingLeft: Math.max(insets.left, 10),
                    paddingRight: Math.max(insets.right, 10),
                  },
                ]}
                onLayout={(e) => {
                  stageWidthRef.current = Math.max(
                    1,
                    e.nativeEvent.layout.width
                  );
                }}
              >
                {!activeVideo.videoUrl && activeVideo.thumbnailUrl ? (
                  <Image
                    source={{ uri: activeVideo.thumbnailUrl }}
                    style={styles.fullVideoImage}
                    resizeMode="cover"
                  />
                ) : null}

                {activeVideo.videoUrl ? (
                  <ActiveVideoStream
                    key={activeVideo.id}
                    uri={activeVideo.videoUrl}
                    isPlaying={isPlaying}
                    isMuted={isMuted}
                    seekCommand={seekCommand}
                    onTimeSync={(curSec, durSec) => {
                      setElapsedSeconds(curSec);
                      if (durSec > 0) setActiveDurationSec(durSec);
                    }}
                    onVideoEnded={handleVideoEnded}
                  />
                ) : null}

                {showVideoControls ? (
                  <View
                    pointerEvents="none"
                    style={styles.videoControlsScrim}
                  />
                ) : null}

                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.stageTapCatcher}
                  onPress={(e) =>
                    handleStageTap(e.nativeEvent?.locationX ?? 0)
                  }
                />

                {seekBadge ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.seekFeedbackPill,
                      seekBadge.side === 'left'
                        ? styles.seekFeedbackLeft
                        : styles.seekFeedbackRight,
                    ]}
                  >
                    <Ionicons
                      name={
                        seekBadge.side === 'left'
                          ? 'play-back'
                          : 'play-forward'
                      }
                      size={16}
                      color="#ffffff"
                    />
                    <Text style={styles.seekFeedbackText}>10s</Text>
                  </View>
                ) : null}

                {showVideoControls && (
                  <>
                    <View
                      style={[
                        styles.videoStageHeaderBar,
                        isVideoFullscreen && {
                          paddingTop: Math.max(insets.top, 12),
                          paddingHorizontal: Math.max(
                            insets.left,
                            insets.right,
                            18
                          ),
                        },
                      ]}
                      pointerEvents="box-none"
                    >
                      {isVideoFullscreen ? (
                        <View style={styles.stageTopIconSpacer} />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <TouchableOpacity
                            style={styles.stageTopIconBtn}
                            onPress={() => {
                              clearSingleTapTimer();
                              setActiveVideo(null);
                            }}
                          >
                            <Ionicons
                              name="chevron-down"
                              size={20}
                              color="#ffffff"
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.stageTopIconBtn}
                            onPress={() => {
                              clearSingleTapTimer();
                              openMiniPlayer({
                                id: activeVideo.id,
                                kind: activeVideo.isLive ? 'live' : 'video',
                                title: activeVideo.title,
                                creatorName: activeVideo.creatorName,
                                mediaUrl: activeVideo.videoUrl,
                                thumbnailUrl: activeVideo.thumbnailUrl,
                                isLive: activeVideo.isLive,
                                isPlaying,
                                expandRoute: `/media/${activeVideo.id}`,
                              });
                              setActiveVideo(null);
                            }}
                          >
                            <Ionicons
                              name="albums-outline"
                              size={17}
                              color="#ffffff"
                            />
                          </TouchableOpacity>
                        </View>
                      )}

                      <TouchableOpacity
                        style={styles.stageTopIconBtn}
                        onPress={() => {
                          setIsMuted((m) => !m);
                          revealVideoControls();
                        }}
                      >
                        <Ionicons
                          name={isMuted ? 'volume-mute' : 'volume-high'}
                          size={18}
                          color="#ffffff"
                        />
                      </TouchableOpacity>
                    </View>

                    <View
                      style={styles.ytCenterControlsRow}
                      pointerEvents="box-none"
                    >
                      <TouchableOpacity
                        style={styles.ytSeekBtn}
                        onPress={() => handleSeekRelative(-10)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="play-back" size={18} color="#ffffff" />
                        <Text style={styles.ytSeekText}>10</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.videoPlayCircle}
                        activeOpacity={0.85}
                        onPress={handlePrimaryPlayOrReplay}
                      >
                        <Ionicons
                          name={
                            isEnded ? 'reload' : isPlaying ? 'pause' : 'play'
                          }
                          size={26}
                          color="#ffffff"
                          style={
                            !isEnded && !isPlaying
                              ? { marginLeft: 3 }
                              : undefined
                          }
                        />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.ytSeekBtn}
                        onPress={() => handleSeekRelative(10)}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="play-forward"
                          size={18}
                          color="#ffffff"
                        />
                        <Text style={styles.ytSeekText}>10</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                <View
                  style={[
                    styles.videoStageBottomInfo,
                    isVideoFullscreen && {
                      paddingBottom: Math.max(insets.bottom, 12),
                      paddingHorizontal: Math.max(
                        insets.left,
                        insets.right,
                        14
                      ),
                    },
                  ]}
                  pointerEvents="box-none"
                >
                  {showVideoControls && (
                    <View style={styles.ytTimeRow}>
                      <View style={styles.timePill}>
                        <Text style={styles.videoStageStatus}>
                          {formatDurationClock(elapsedSeconds)}
                          <Text style={styles.videoStageDurationDim}>
                            {' / '}
                            {activeVideo.isLive
                              ? 'LIVE'
                              : formatDurationClock(effectiveTotalSeconds)}
                          </Text>
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.stageFullscreenButton}
                        activeOpacity={0.8}
                        onPress={handleToggleAppFullscreen}
                      >
                        <Ionicons
                          name={
                            isVideoFullscreen
                              ? 'contract-outline'
                              : 'expand-outline'
                          }
                          size={17}
                          color="#ffffff"
                        />
                      </TouchableOpacity>
                    </View>
                  )}

                  {(showVideoControls || !isVideoFullscreen) && (
                    <TouchableOpacity
                      activeOpacity={1}
                      style={[
                        styles.ytScrubberTouchArea,
                        !showVideoControls && styles.ytScrubberCompact,
                      ]}
                      onLayout={(e) =>
                        setProgressBarWidth(
                          Math.max(1, e.nativeEvent.layout.width)
                        )
                      }
                      onPress={(e) =>
                        handleSeekByTouch(e.nativeEvent.locationX)
                      }
                    >
                      <View style={styles.videoProgressTrack}>
                        <View
                          style={[
                            styles.videoProgressFill,
                            { width: `${progressPercent}%` },
                          ]}
                        />
                        {showVideoControls ? (
                          <View
                            pointerEvents="none"
                            style={[
                              styles.videoProgressThumb,
                              { left: `${progressPercent}%` },
                            ]}
                          />
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {!isVideoFullscreen && (
                <ScrollView
                  style={[
                    styles.videoDetailsScroll,
                    { backgroundColor: colors.bg },
                  ]}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingBottom:
                      Platform.OS === 'android'
                        ? Math.max(insets.bottom, 48) + 20
                        : Math.max(insets.bottom, 20) + 20,
                  }}
                >
                  <View
                    style={[
                      styles.videoDetailBody,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[styles.watchVideoTitle, { color: colors.text }]}
                    >
                      {activeVideo.title}
                    </Text>
                    <Text
                      style={[styles.watchVideoMeta, { color: colors.subtext }]}
                    >
                      {activeVideo.metaText}
                    </Text>

                    <View style={styles.creatorBar}>
                      <TouchableOpacity
                        style={styles.creatorBarLeft}
                        activeOpacity={0.8}
                        onPress={() =>
                          handleNavigateToCreator(
                            activeVideo.creatorHandle,
                            activeVideo.id
                          )
                        }
                      >
                        <CreatorAvatarBadge
                          uri={activeVideo.creatorAvatar}
                          name={activeVideo.creatorName}
                          size={40}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.watchCreatorName,
                              { color: colors.text },
                            ]}
                            numberOfLines={1}
                          >
                            {activeVideo.creatorName}
                          </Text>
                          <Text
                            style={[
                              styles.watchCreatorHandle,
                              { color: colors.subtext },
                            ]}
                            numberOfLines={1}
                          >
                            {activeVideo.creatorHandle}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.subscribePillBtn,
                          {
                            backgroundColor: subscribedHandles[
                              activeVideo.creatorHandle
                            ]
                              ? colors.surface
                              : colors.accent,
                          },
                        ]}
                        onPress={() =>
                          toggleSubscribe(activeVideo.creatorHandle)
                        }
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            styles.subscribePillText,
                            {
                              color: subscribedHandles[
                                activeVideo.creatorHandle
                              ]
                                ? colors.text
                                : colors.accentText,
                            },
                          ]}
                        >
                          {subscribedHandles[activeVideo.creatorHandle]
                            ? 'Subscribed'
                            : 'Subscribe'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.actionPillsRow}
                    >
                      <View
                        style={[
                          styles.reactionPillGroup,
                          { backgroundColor: colors.surface },
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.reactionPillHalf}
                          onPress={() => toggleLike(activeVideo.id)}
                        >
                          <Ionicons
                            name={
                              likedIds[activeVideo.id]
                                ? 'thumbs-up'
                                : 'thumbs-up-outline'
                            }
                            size={17}
                            color={
                              likedIds[activeVideo.id]
                                ? colors.text
                                : colors.subtext
                            }
                          />
                          <Text
                            style={[
                              styles.actionPillLabel,
                              {
                                color: likedIds[activeVideo.id]
                                  ? colors.text
                                  : colors.subtext,
                              },
                            ]}
                          >
                            {activeVideo.showLikes
                              ? `Like · ${formatCountCompact(activeVideo.likesCount)}`
                              : 'Like'}
                          </Text>
                        </TouchableOpacity>
                        <View
                          style={[
                            styles.reactionPillDivider,
                            { backgroundColor: colors.borderStrong },
                          ]}
                        />
                        <TouchableOpacity
                          style={styles.reactionPillHalf}
                          onPress={() => toggleDislike(activeVideo.id)}
                        >
                          <Ionicons
                            name={
                              dislikedIds[activeVideo.id]
                                ? 'thumbs-down'
                                : 'thumbs-down-outline'
                            }
                            size={17}
                            color={
                              dislikedIds[activeVideo.id]
                                ? colors.text
                                : colors.subtext
                            }
                          />
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.actionPillBtn,
                          { backgroundColor: colors.surface },
                        ]}
                        onPress={() =>
                          handleShareMedia(
                            activeVideo.title,
                            activeVideo.creatorName,
                            {
                              id: activeVideo.id,
                              kind: activeVideo.isLive ? 'live' : 'video',
                              thumbnailUrl: activeVideo.thumbnailUrl,
                            }
                          )
                        }
                      >
                        <Ionicons
                          name="share-social-outline"
                          size={17}
                          color={colors.text}
                        />
                        <Text
                          style={[
                            styles.actionPillLabel,
                            { color: colors.text },
                          ]}
                        >
                          Share
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.actionPillBtn,
                          { backgroundColor: colors.surface },
                        ]}
                        onPress={() => {
                          toggleSave(activeVideo.id);
                          setCollectionModalTarget({
                            id: activeVideo.id,
                            kind: 'video',
                            title: activeVideo.title,
                            author: activeVideo.creatorHandle,
                            thumbnailUrl: activeVideo.thumbnailUrl,
                          });
                        }}
                      >
                        <Ionicons
                          name={
                            savedIds[activeVideo.id]
                              ? 'bookmark'
                              : 'bookmark-outline'
                          }
                          size={17}
                          color={colors.text}
                        />
                        <Text
                          style={[
                            styles.actionPillLabel,
                            { color: colors.text },
                          ]}
                        >
                          {savedIds[activeVideo.id] ? 'Saved' : 'Save'}
                        </Text>
                      </TouchableOpacity>

                      {activeVideo.allowComments ? (
                        <TouchableOpacity
                          style={[
                            styles.actionPillBtn,
                            { backgroundColor: colors.surface },
                          ]}
                          onPress={() => setCommentTargetId(activeVideo.id)}
                        >
                          <Ionicons
                            name="chatbubble-outline"
                            size={16}
                            color={colors.text}
                          />
                          <Text
                            style={[
                              styles.actionPillLabel,
                              { color: colors.text },
                            ]}
                          >
                            {activeVideoComments.length}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </ScrollView>

                    {activeVideo.allowComments ? (
                      <TouchableOpacity
                        style={[
                          styles.commentsCard,
                          { backgroundColor: colors.surface },
                        ]}
                        activeOpacity={0.82}
                        onPress={() => setCommentTargetId(activeVideo.id)}
                      >
                        <View style={styles.commentsHeaderLine}>
                          <View style={styles.commentsTitleRow}>
                            <Text
                              style={[
                                styles.commentsCountLabel,
                                { color: colors.text },
                              ]}
                            >
                              Comments
                            </Text>
                            <Text
                              style={[
                                styles.commentsCountBadge,
                                { color: colors.subtext },
                              ]}
                            >
                              {activeVideoComments.length}
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={colors.subtext}
                          />
                        </View>
                        <Text
                          style={[
                            styles.lastCommentLine,
                            { color: colors.subtext },
                          ]}
                          numberOfLines={2}
                        >
                          {activeVideoLastComment
                            ? `${activeVideoLastComment.author}: ${activeVideoLastComment.text}`
                            : 'No comments yet. Tap to start the conversation.'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}

                    {activeVideo.description ? (
                      <View
                        style={[
                          styles.descriptionCard,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.watchDescriptionText,
                            { color: colors.text },
                          ]}
                        >
                          {activeVideo.description}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {upNextVideos.length > 0 && (
                    <View style={styles.upNextSection}>
                      <Text
                        style={[styles.upNextHeading, { color: colors.text }]}
                      >
                        Up Next
                      </Text>
                      {upNextVideos.map((nextVid) => (
                        <TouchableOpacity
                          key={nextVid.id}
                          style={styles.upNextRow}
                          activeOpacity={0.85}
                          onPress={() => handleOpenVideoPlayer(nextVid)}
                        >
                          <View
                            style={[
                              styles.upNextThumbWrap,
                              { backgroundColor: colors.surface },
                            ]}
                          >
                            {nextVid.thumbnailUrl ? (
                              <Image
                                source={{ uri: nextVid.thumbnailUrl }}
                                style={styles.fullImg}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={styles.thumbPlaceholder}>
                                <Ionicons
                                  name="videocam"
                                  size={18}
                                  color={colors.subtext}
                                />
                              </View>
                            )}
                            <View
                              style={[
                                styles.upNextBadge,
                                nextVid.isLive && styles.liveDurationPill,
                              ]}
                            >
                              <Text style={styles.upNextBadgeText}>
                                {nextVid.durationOrBadge}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.upNextInfo}>
                            <Text
                              style={[
                                styles.upNextTitle,
                                { color: colors.text },
                              ]}
                              numberOfLines={2}
                            >
                              {nextVid.title}
                            </Text>
                            <Text
                              style={[
                                styles.upNextSub,
                                { color: colors.subtext },
                              ]}
                              numberOfLines={1}
                            >
                              {nextVid.creatorName}
                            </Text>
                            <Text
                              style={[
                                styles.upNextMeta,
                                { color: colors.subtext },
                              ]}
                              numberOfLines={1}
                            >
                              {nextVid.metaText}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </ScrollView>
              )}
            </>
          )}
        </SafeAreaView>
      </Modal>

      {/* FULLSCREEN REELS MODAL */}
      <Modal
        visible={!!activeReel}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent={false}
        onRequestClose={() => {
          setActiveReelIndex(null);
          setActiveSection('videos');
        }}
      >
        <View
          style={styles.fullReelScreen}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (height <= 0 || width <= 0) return;
            setReelViewport((prev) => {
              if (
                prev &&
                Math.abs(height - prev.height) <= 1 &&
                Math.abs(width - prev.width) <= 1
              ) {
                return prev;
              }
              if (prev && activeReelIndex !== null) {
                requestAnimationFrame(() => {
                  reelPagerRef.current?.scrollToOffset({
                    offset: activeReelIndex * height,
                    animated: false,
                  });
                });
              }
              return { width, height };
            });
          }}
        >
          {reelViewport && activeReelIndex !== null && filteredReels.length > 0 && (
            <>
              <View
                style={[styles.topReelBar, { paddingTop: reelTopSafePadding }]}
                pointerEvents="box-none"
              >
                <TouchableOpacity
                  style={styles.topReelCircleBtn}
                  onPress={() => {
                    setActiveReelIndex(null);
                    setActiveSection('videos');
                  }}
                >
                  <Ionicons name="arrow-back" size={20} color="#ffffff" />
                </TouchableOpacity>

                <View style={styles.topReelArrowsCluster}>
                  <TouchableOpacity
                    style={styles.topReelCircleBtn}
                    onPress={() => setIsMuted((m) => !m)}
                  >
                    <Ionicons
                      name={isMuted ? 'volume-mute' : 'volume-high'}
                      size={18}
                      color="#ffffff"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <FlatList
                ref={reelPagerRef}
                data={filteredReels}
                keyExtractor={(item) => item.id}
                pagingEnabled
                disableIntervalMomentum
                showsVerticalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={reelViewport.height}
                snapToAlignment="start"
                initialScrollIndex={Math.min(
                  activeReelIndex,
                  Math.max(0, filteredReels.length - 1)
                )}
                getItemLayout={(_, index) => ({
                  length: reelViewport.height,
                  offset: reelViewport.height * index,
                  index,
                })}
                onMomentumScrollEnd={(e) => {
                  const pageH = Math.max(1, reelViewport.height);
                  const nextIdx = Math.round(
                    e.nativeEvent.contentOffset.y / pageH
                  );
                  if (
                    nextIdx >= 0 &&
                    nextIdx < filteredReels.length &&
                    nextIdx !== activeReelIndex
                  ) {
                    setActiveReelIndex(nextIdx);
                    setIsPlaying(true);
                  }
                }}
                windowSize={3}
                maxToRenderPerBatch={2}
                removeClippedSubviews={Platform.OS === 'android'}
                renderItem={({ item, index }) => {
                  const isCurrent = index === activeReelIndex;
                  const remixMeta = extractRemixInfo(item.caption);
                  return (
                    <View
                      style={[
                        styles.fullReelScreen,
                        {
                          width: reelViewport.width,
                          height: reelViewport.height,
                        },
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.fullReelMediaLayer}
                        activeOpacity={1}
                        onPress={() => {
                          const now = Date.now();
                          if (now - reelTapTimerRef.current < 270) {
                            reelTapTimerRef.current = 0;
                            triggerHeartHaptic();
                            setReelHeartBurstKey((k) => k + 1);
                            if (!likedIds[item.id]) {
                              toggleLike(item.id);
                            }
                            return;
                          }
                          reelTapTimerRef.current = now;
                          setIsPlaying((p) => !p);
                        }}
                      >
                        {item.coverUrl ? (
                          <Image
                            source={{ uri: item.coverUrl }}
                            style={styles.fullVideoImage}
                            resizeMode="cover"
                          />
                        ) : null}
                        {item.reelUrl && isCurrent ? (
                          <ActiveReelStream
                            key={item.id}
                            uri={item.reelUrl}
                            isPlaying={isPlaying}
                            isMuted={isMuted}
                          />
                        ) : null}
                        <DoubleTapHeartBurst
                          triggerKey={isCurrent ? reelHeartBurstKey : 0}
                        />
                        <View style={styles.reelWatermarkPill} pointerEvents="none">
                          <Text style={styles.reelWatermarkText}>
                            VibeSphere · {item.creatorHandle}
                          </Text>
                        </View>
                        {!isPlaying && isCurrent && (
                          <View style={[styles.fullReelPauseBadge, { zIndex: 6 }]}>
                            <Ionicons
                              name="play"
                              size={34}
                              color="#ffffff"
                              style={{ marginLeft: 4 }}
                            />
                          </View>
                        )}
                      </TouchableOpacity>

                      <View
                        style={[
                          styles.bottomReelOverlay,
                          { paddingBottom: reelBottomSafePadding },
                        ]}
                      >
                        <View style={styles.bottomReelTextCol}>
                          <View style={styles.bottomReelCreatorRow}>
                            <TouchableOpacity
                              style={styles.reelCreatorTouch}
                              onPress={() =>
                                handleNavigateToCreator(
                                  item.creatorHandle,
                                  item.id
                                )
                              }
                            >
                              <CreatorAvatarBadge
                                uri={item.creatorAvatar}
                                name={item.creatorName}
                                size={36}
                                bordered
                              />
                              <View style={{ flexShrink: 1 }}>
                                <Text
                                  style={styles.bottomReelCreatorName}
                                  numberOfLines={1}
                                >
                                  {item.creatorName}
                                </Text>
                                <Text
                                  style={styles.bottomReelHandle}
                                  numberOfLines={1}
                                >
                                  {item.creatorHandle}
                                </Text>
                              </View>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[
                                styles.reelBWSubBtn,
                                subscribedHandles[item.creatorHandle] &&
                                  styles.reelBWSubBtnSubscribed,
                              ]}
                              onPress={() =>
                                toggleSubscribe(item.creatorHandle)
                              }
                            >
                              <Text
                                style={[
                                  styles.reelBWSubBtnText,
                                  subscribedHandles[item.creatorHandle] &&
                                    styles.reelBWSubBtnTextSubscribed,
                                ]}
                              >
                                {subscribedHandles[item.creatorHandle]
                                  ? 'Subscribed'
                                  : 'Subscribe'}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {remixMeta.remixAuthor ? (
                            <View style={styles.remixSourceBadge}>
                              <Ionicons name="repeat" size={12} color="#10b981" />
                              <Text style={styles.remixSourceText}>
                                Remixed from {remixMeta.remixAuthor}
                              </Text>
                            </View>
                          ) : null}

                          <Text style={styles.bottomReelTitle} numberOfLines={2}>
                            {item.title}
                          </Text>
                          {remixMeta.cleanCaption ? (
                            <Text
                              style={styles.bottomReelCaption}
                              numberOfLines={2}
                            >
                              {remixMeta.cleanCaption}
                            </Text>
                          ) : null}
                          <Text style={styles.bottomReelViews}>
                            {item.viewsText}
                            {item.durationText
                              ? ` · ${item.durationText}`
                              : ''}
                          </Text>
                        </View>

                        <View style={styles.bottomReelActionsCol}>
                          <TouchableOpacity
                            style={styles.bottomReelActionBtn}
                            onPress={() => toggleLike(item.id)}
                          >
                            <View
                              style={[
                                styles.bottomReelActionIcon,
                                likedIds[item.id] &&
                                  styles.bottomReelActionIconActive,
                              ]}
                            >
                              <Ionicons
                                name={
                                  likedIds[item.id]
                                    ? 'thumbs-up'
                                    : 'thumbs-up-outline'
                                }
                                size={20}
                                color={
                                  likedIds[item.id] ? '#09090b' : '#ffffff'
                                }
                              />
                            </View>
                            <Text style={styles.bottomReelActionLabel}>
                              {item.showLikes
                                ? formatCountCompact(item.likesCount)
                                : 'Like'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.bottomReelActionBtn}
                            onPress={() => toggleDislike(item.id)}
                          >
                            <View
                              style={[
                                styles.bottomReelActionIcon,
                                dislikedIds[item.id] &&
                                  styles.bottomReelActionIconActive,
                              ]}
                            >
                              <Ionicons
                                name={
                                  dislikedIds[item.id]
                                    ? 'thumbs-down'
                                    : 'thumbs-down-outline'
                                }
                                size={20}
                                color={
                                  dislikedIds[item.id] ? '#09090b' : '#ffffff'
                                }
                              />
                            </View>
                            <Text style={styles.bottomReelActionLabel}>
                              Dislike
                            </Text>
                          </TouchableOpacity>

                          {item.allowComments ? (
                            <TouchableOpacity
                              style={styles.bottomReelActionBtn}
                              onPress={() => setCommentTargetId(item.id)}
                            >
                              <View style={styles.bottomReelActionIcon}>
                                <Ionicons
                                  name="chatbubble-outline"
                                  size={19}
                                  color="#ffffff"
                                />
                              </View>
                              <Text style={styles.bottomReelActionLabel}>
                                {(commentsByMedia[item.id] || []).length}
                              </Text>
                            </TouchableOpacity>
                          ) : null}

                          <TouchableOpacity
                            style={styles.bottomReelActionBtn}
                            onPress={() =>
                              handleShareMedia(item.title, item.creatorName, {
                                id: item.id,
                                kind: 'reel',
                                thumbnailUrl: item.coverUrl,
                              })
                            }
                          >
                            <View style={styles.bottomReelActionIcon}>
                              <Ionicons
                                name="share-social-outline"
                                size={20}
                                color="#ffffff"
                              />
                            </View>
                            <Text style={styles.bottomReelActionLabel}>
                              Share
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.bottomReelActionBtn}
                            onPress={() => {
                              setActiveReelIndex(null);
                              router.push({
                                pathname: '/studio/reel',
                                params: {
                                  remixOfId: item.id,
                                  remixAuthor: item.creatorHandle,
                                  remixTitle: item.title,
                                  remixThumbnail: item.coverUrl,
                                },
                              } as any);
                            }}
                          >
                            <View style={styles.bottomReelActionIcon}>
                              <Ionicons name="repeat" size={20} color="#10b981" />
                            </View>
                            <Text style={styles.bottomReelActionLabel}>
                              Remix
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.bottomReelActionBtn}
                            onPress={() => {
                              toggleSave(item.id);
                              setCollectionModalTarget({
                                id: item.id,
                                kind: 'reel',
                                title: item.title,
                                author: item.creatorHandle,
                                thumbnailUrl: item.coverUrl,
                              });
                            }}
                          >
                            <View
                              style={[
                                styles.bottomReelActionIcon,
                                savedIds[item.id] &&
                                  styles.bottomReelActionIconActive,
                              ]}
                            >
                              <Ionicons
                                name={
                                  savedIds[item.id]
                                    ? 'bookmark'
                                    : 'bookmark-outline'
                                }
                                size={19}
                                color={
                                  savedIds[item.id] ? '#09090b' : '#ffffff'
                                }
                              />
                            </View>
                            <Text style={styles.bottomReelActionLabel}>
                              Save
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                }}
              />
            </>
          )}
        </View>
      </Modal>

      {/* COMMENTS BOTTOM SHEET MODAL */}
      <Modal
        visible={!!commentTargetId}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentTargetId(null)}
      >
        <KeyboardAvoidingView
          style={styles.commentBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setCommentTargetId(null)}
          />
          <View
            style={[
              styles.commentSheet,
              {
                backgroundColor: colors.card,
                paddingBottom:
                  Platform.OS === 'android'
                    ? Math.max(insets.bottom, 48) + 16
                    : Math.max(insets.bottom, 16) + 12,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />

            <View
              style={[
                styles.commentHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.commentsTitleRow}>
                <Text style={[styles.commentTitle, { color: colors.text }]}>
                  Comments
                </Text>
                <Text
                  style={[
                    styles.commentCountPill,
                    {
                      backgroundColor: colors.surface,
                      color: colors.subtext,
                    },
                  ]}
                >
                  {commentListForTarget.length}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setCommentTargetId(null)}
              >
                <Ionicons name="close" size={19} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.commentList}
              showsVerticalScrollIndicator={false}
            >
              {commentListForTarget.length === 0 ? (
                <View style={styles.emptyCommentsWrap}>
                  <Ionicons
                    name="chatbubbles-outline"
                    size={28}
                    color={colors.subtext}
                  />
                  <Text
                    style={[styles.noCommentsText, { color: colors.subtext }]}
                  >
                    No comments yet. Be the first to share your thoughts.
                  </Text>
                </View>
              ) : (
                commentListForTarget.map((c) => {
                  const isPinned =
                    activeCommentMeta.pinnedCommentId === c.id;
                  const isCreatorLiked =
                    activeCommentMeta.creatorLikedIds.includes(c.id);
                  return (
                    <View key={c.id} style={styles.commentRow}>
                      <CreatorAvatarBadge name={c.author} size={30} />
                      <View style={styles.commentContentCol}>
                        <View style={styles.commentMetaTopRow}>
                          <Text
                            style={[styles.commentAuthor, { color: colors.text }]}
                          >
                            {c.author}
                            <Text
                              style={[
                                styles.commentTime,
                                { color: colors.subtext },
                              ]}
                            >
                              {'  ·  '}
                              {c.timeAgo}
                            </Text>
                          </Text>
                          {isPinned && (
                            <View style={styles.pinnedBadgePill}>
                              <Ionicons name="pin" size={10} color="#10b981" />
                              <Text style={styles.pinnedBadgeText}>Pinned</Text>
                            </View>
                          )}
                          {isCreatorLiked && (
                            <View style={styles.creatorLikedPill}>
                              <Ionicons name="heart" size={10} color="#f43f5e" />
                              <Text style={styles.creatorLikedText}>
                                Liked by creator
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={[styles.commentBody, { color: colors.text }]}
                        >
                          {c.text}
                        </Text>
                      </View>
                      <View style={styles.commentItemActions}>
                        <TouchableOpacity
                          onPress={() => {
                            if (!commentTargetId) return;
                            void toggleCommentCreatorLike(
                              commentTargetId,
                              c.id
                            ).then((next) =>
                              setCommentMetaByMedia((prev) => ({
                                ...prev,
                                [commentTargetId]: next,
                              }))
                            );
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons
                            name={isCreatorLiked ? 'heart' : 'heart-outline'}
                            size={15}
                            color={isCreatorLiked ? '#f43f5e' : colors.subtext}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            if (!commentTargetId) return;
                            void togglePinnedComment(commentTargetId, c.id).then(
                              (next) =>
                                setCommentMetaByMedia((prev) => ({
                                  ...prev,
                                  [commentTargetId]: next,
                                }))
                            );
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons
                            name={isPinned ? 'pin' : 'pin-outline'}
                            size={15}
                            color={isPinned ? '#10b981' : colors.subtext}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View
              style={[
                styles.commentInputBar,
                { borderTopColor: colors.border },
              ]}
            >
              <TextInput
                style={[
                  styles.commentInput,
                  { backgroundColor: colors.surface, color: colors.text },
                ]}
                value={commentInput}
                onChangeText={setCommentInput}
                placeholder="Add a comment..."
                placeholderTextColor={colors.subtext}
                returnKeyType="send"
                onSubmitEditing={handleAddComment}
              />
              <TouchableOpacity
                style={[
                  styles.commentSendBtn,
                  {
                    backgroundColor: canSendComment
                      ? colors.accent
                      : colors.surface,
                  },
                ]}
                disabled={!canSendComment}
                onPress={handleAddComment}
              >
                <Ionicons
                  name="arrow-up"
                  size={18}
                  color={canSendComment ? colors.accentText : colors.subtext}
                />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* WEEKLY CREATOR LEADERBOARD MODAL */}
      <Modal
        visible={leaderboardVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLeaderboardVisible(false)}
      >
        <View style={styles.commentBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setLeaderboardVisible(false)}
          />
          <View
            style={[
              styles.commentSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 20) + 12,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <View
              style={[
                styles.commentHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="trophy" size={18} color="#f59e0b" />
                <Text style={[styles.commentTitle, { color: colors.text }]}>
                  Weekly Creators ({selectedCategory})
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.sheetCloseBtn, { backgroundColor: colors.surface }]}
                onPress={() => setLeaderboardVisible(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 340, marginTop: 8 }}>
              {weeklyLeaderboard.length === 0 ? (
                <Text style={[styles.noCommentsText, { color: colors.subtext, paddingVertical: 28 }]}>
                  No creator activity yet in this category.
                </Text>
              ) : (
                weeklyLeaderboard.map((entry, idx) => (
                  <TouchableOpacity
                    key={entry.handle + idx}
                    style={[
                      styles.leaderRow,
                      { borderBottomColor: colors.border },
                    ]}
                    onPress={() => {
                      setLeaderboardVisible(false);
                      handleNavigateToCreator(entry.handle, '');
                    }}
                  >
                    <Text
                      style={[
                        styles.leaderRank,
                        { color: idx < 3 ? '#f59e0b' : colors.subtext },
                      ]}
                    >
                      #{idx + 1}
                    </Text>
                    <CreatorAvatarBadge
                      uri={entry.avatar}
                      name={entry.name}
                      size={38}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.commentAuthor, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {entry.name}
                      </Text>
                      <Text style={{ fontSize: 11.5, color: colors.subtext }}>
                        {entry.handle} · {entry.category}
                      </Text>
                    </View>
                    <View style={styles.leaderScorePill}>
                      <Text style={styles.leaderScoreText}>
                        {formatCountCompact(entry.views)} views
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <BrandedShareModal
        visible={!!shareModalItem}
        item={shareModalItem}
        onClose={() => setShareModalItem(null)}
        onSaveToCollection={
          shareModalItem
            ? () =>
                setCollectionModalTarget({
                  id: shareModalItem.id,
                  kind:
                    shareModalItem.kind === 'reel'
                      ? 'reel'
                      : shareModalItem.kind === 'post'
                        ? 'post'
                        : 'video',
                  title: shareModalItem.title,
                  author: shareModalItem.creatorHandle,
                  thumbnailUrl: shareModalItem.thumbnailUrl,
                })
            : undefined
        }
      />

      <SaveToCollectionModal
        visible={!!collectionModalTarget}
        userId={authUserIdState}
        target={collectionModalTarget}
        onClose={() => setCollectionModalTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fullImg: { width: '100%', height: '100%' },

  /* Minimal Edge-to-Edge Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 52,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineSearchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 0,
  },

  /* Edge-to-Edge Underline Tabs */
  sectionTabsBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  sectionTabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  sectionTabText: {
    fontSize: 14,
    fontWeight: '600',
  },

  /* Category Strip */
  categoryStrip: {
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  chipsRow: {
    paddingHorizontal: 14,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 6.5,
    borderRadius: 999,
  },
  chipLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  chipText: { fontSize: 12.5, fontWeight: '600' },

  /* True Edge-to-Edge Video Feed */
  edgeVideoItem: {
    borderBottomWidth: 1,
    paddingBottom: 14,
  },
  edgeThumbBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
    overflow: 'hidden',
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationPill: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  liveDurationPill: { backgroundColor: '#dc2626' },
  liveDotWhite: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  durationPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  edgeVideoMeta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingTop: 11,
    gap: 11,
  },
  videoTextCol: { flex: 1 },
  videoTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  videoSubtext: {
    fontSize: 12.5,
    marginTop: 3,
    fontWeight: '500',
  },
  moreIconBtn: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* True Edge-to-Edge Reels Grid */
  edgeReelsRow: {
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  edgeReelTile: {
    width: REEL_TILE_WIDTH,
    height: 280,
    backgroundColor: '#18181b',
    position: 'relative',
    overflow: 'hidden',
  },
  reelPlaceholder: {
    flex: 1,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reelTopRight: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
  },
  reelDurationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(9, 9, 11, 0.72)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  reelDurationText: { color: '#ffffff', fontSize: 10.5, fontWeight: '700' },
  reelBottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingTop: 18,
    paddingBottom: 10,
    backgroundColor: 'rgba(9, 9, 11, 0.56)',
  },
  reelTitle: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 16.5,
  },
  reelCreatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  reelCreatorText: {
    color: '#fafafa',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  reelViewsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  reelViewsText: {
    color: '#e4e4e7',
    fontSize: 10.5,
    fontWeight: '600',
  },

  /* Empty State */
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 15.5, fontWeight: '700' },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 19,
  },

  /* Video Player Modal */
  watchScreenContainer: { flex: 1, backgroundColor: '#09090b' },
  fullVideoStage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#09090b',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  fullscreenVideoStage: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#09090b',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  videoPlayerSurface: {
    width: '100%',
    height: '100%',
    backgroundColor: '#09090b',
  },
  videoControlsScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    zIndex: 4,
  },
  stageTapCatcher: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.001)',
    zIndex: 5,
  },
  seekFeedbackPill: {
    position: 'absolute',
    top: '40%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(9, 9, 11, 0.82)',
    zIndex: 12,
  },
  seekFeedbackLeft: { left: 24 },
  seekFeedbackRight: { right: 24 },
  seekFeedbackText: { color: '#ffffff', fontSize: 12.5, fontWeight: '800' },
  fullVideoImage: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  videoStageHeaderBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    zIndex: 10,
  },
  stageTopIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(9, 9, 11, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageTopIconSpacer: { width: 36, height: 36 },
  ytCenterControlsRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    zIndex: 10,
  },
  ytSeekBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(9, 9, 11, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ytSeekText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
    marginTop: -2,
  },
  videoPlayCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(9, 9, 11, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoStageBottomInfo: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  ytTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 5,
  },
  timePill: {
    backgroundColor: 'rgba(9, 9, 11, 0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  videoStageStatus: { color: '#ffffff', fontSize: 11.5, fontWeight: '700' },
  videoStageDurationDim: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontWeight: '600',
  },
  stageFullscreenButton: {
    width: 34,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9, 9, 11, 0.55)',
  },
  ytScrubberTouchArea: {
    width: '100%',
    minHeight: 25,
    paddingTop: 5,
    paddingBottom: 7,
    justifyContent: 'flex-end',
  },
  ytScrubberCompact: { minHeight: 3.5, paddingTop: 0, paddingBottom: 0 },
  videoProgressTrack: {
    width: '100%',
    height: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    position: 'relative',
  },
  videoProgressFill: { height: '100%', backgroundColor: '#ef4444' },
  videoProgressThumb: {
    position: 'absolute',
    top: -4.25,
    marginLeft: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#ffffff',
  },

  /* Video Details */
  videoDetailsScroll: { flex: 1 },
  videoDetailBody: {
    paddingTop: 14,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  watchVideoTitle: {
    fontSize: 17.5,
    fontWeight: '800',
    lineHeight: 23,
    letterSpacing: -0.3,
    paddingHorizontal: 16,
  },
  watchVideoMeta: {
    fontSize: 12.5,
    marginTop: 4,
    paddingHorizontal: 16,
    fontWeight: '500',
  },
  creatorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 14,
    gap: 12,
  },
  creatorBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  watchCreatorName: { fontSize: 14.5, fontWeight: '700' },
  watchCreatorHandle: { fontSize: 12, marginTop: 1, fontWeight: '500' },
  subscribePillBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8.5,
    borderRadius: 999,
  },
  subscribePillText: { fontSize: 12.5, fontWeight: '700' },
  actionPillsRow: { paddingHorizontal: 16, paddingTop: 14, gap: 8 },
  reactionPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    height: 36,
    paddingHorizontal: 4,
  },
  reactionPillHalf: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: '100%',
  },
  reactionPillDivider: { width: 1, height: 18 },
  actionPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  actionPillLabel: { fontSize: 12.5, fontWeight: '600' },
  commentsCard: {
    marginTop: 14,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 5,
  },
  commentsHeaderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentsCountLabel: { fontSize: 13, fontWeight: '700' },
  commentsCountBadge: { fontSize: 12, fontWeight: '600' },
  lastCommentLine: { fontSize: 12.5, lineHeight: 18 },
  descriptionCard: {
    marginTop: 10,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  watchDescriptionText: { fontSize: 13, lineHeight: 19 },
  upNextSection: { paddingVertical: 16, gap: 12 },
  upNextHeading: {
    fontSize: 13.5,
    fontWeight: '800',
    paddingHorizontal: 16,
  },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
  },
  upNextThumbWrap: {
    width: 136,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  upNextBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  upNextBadgeText: { color: '#ffffff', fontSize: 9.5, fontWeight: '700' },
  upNextInfo: { flex: 1, paddingTop: 1 },
  upNextTitle: { fontSize: 13.5, fontWeight: '700', lineHeight: 18 },
  upNextSub: { fontSize: 12, marginTop: 3, fontWeight: '600' },
  upNextMeta: { fontSize: 11.5, marginTop: 1 },

  /* Fullscreen Reels */
  fullReelScreen: { flex: 1, backgroundColor: '#09090b', position: 'relative' },
  fullReelMediaLayer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullReelPauseBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(9, 9, 11, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topReelBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    zIndex: 20,
  },
  topReelArrowsCluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topReelCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(9, 9, 11, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topReelBtnMuted: { opacity: 0.32 },
  bottomReelOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    zIndex: 20,
  },
  bottomReelTextCol: { flex: 1, marginRight: 14 },
  bottomReelCreatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  reelCreatorTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flexShrink: 1,
  },
  bottomReelCreatorName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bottomReelHandle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11.5,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  reelBWSubBtn: {
    marginLeft: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 13,
    paddingVertical: 6.5,
    borderRadius: 999,
  },
  reelBWSubBtnSubscribed: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  reelBWSubBtnText: { color: '#09090b', fontSize: 11.5, fontWeight: '700' },
  reelBWSubBtnTextSubscribed: { color: '#ffffff' },
  bottomReelTitle: {
    color: '#ffffff',
    fontSize: 15.5,
    fontWeight: '700',
    lineHeight: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bottomReelCaption: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 12.5,
    marginTop: 4,
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bottomReelViews: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11.5,
    marginTop: 7,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bottomReelActionsCol: { alignItems: 'center', gap: 13 },
  bottomReelActionBtn: { alignItems: 'center', gap: 4 },
  bottomReelActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(9, 9, 11, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomReelActionIconActive: { backgroundColor: '#ffffff' },
  bottomReelActionLabel: { color: '#ffffff', fontSize: 11, fontWeight: '600' },

  /* Comments Sheet */
  commentBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  commentSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: '76%',
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  commentTitle: { fontSize: 16.5, fontWeight: '800' },
  commentCountPill: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentList: { maxHeight: 300, paddingVertical: 8 },
  emptyCommentsWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  noCommentsText: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
  },
  commentContentCol: { flex: 1 },
  commentAuthor: { fontSize: 12.5, fontWeight: '700' },
  commentTime: { fontSize: 11, fontWeight: '500' },
  commentBody: { fontSize: 13.5, marginTop: 3, lineHeight: 19 },
  commentInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  commentInput: {
    flex: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
  },
  commentSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedPreviewTag: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(9,9,11,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  mutedPreviewTagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  scheduledSection: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  scheduledHeaderRow: {
    paddingHorizontal: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scheduledHeading: {
    fontSize: 13.5,
    fontWeight: '800',
  },
  scheduledCard: {
    width: 224,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 5,
  },
  scheduledTopMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  schedCountdownBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  schedCountdownText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  schedCategory: {
    fontSize: 11,
    fontWeight: '600',
  },
  schedTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    marginTop: 2,
  },
  schedHost: {
    fontSize: 11.5,
  },
  schedRemindBtn: {
    marginTop: 6,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#09090b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  schedRemindBtnActive: {
    backgroundColor: '#10b981',
  },
  schedRemindText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  reelWatermarkPill: {
    position: 'absolute',
    top: 56,
    left: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  reelWatermarkText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 10.5,
    fontWeight: '700',
  },
  remixSourceBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 6,
  },
  remixSourceText: {
    color: '#6ee7b7',
    fontSize: 11,
    fontWeight: '700',
  },
  commentMetaTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  pinnedBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(16,185,129,0.16)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  pinnedBadgeText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '700',
  },
  creatorLikedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(244,63,94,0.14)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  creatorLikedText: {
    color: '#f43f5e',
    fontSize: 10,
    fontWeight: '700',
  },
  commentItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leaderRank: {
    width: 28,
    fontSize: 14,
    fontWeight: '900',
  },
  leaderScorePill: {
    backgroundColor: 'rgba(16,185,129,0.14)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  leaderScoreText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '800',
  },
});