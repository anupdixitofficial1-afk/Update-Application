import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
  DeviceEventEmitter,
  Pressable,
  Modal,
  LayoutChangeEvent,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as FileSystemDefault from 'expo-file-system';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CATEGORIES,
  MediaCategory,
  ThumbnailMode,
  deleteStudioDraft,
  getStudioDrafts,
  isLikelyImageUri,
  parseTags,
  saveStudioDraft,
} from '../../lib/creatorStudio';
import { backend } from '../../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

type VideoThumbMode = ThumbnailMode | 'video';
export type VideoVisibility = 'public' | 'subscribers' | 'private';
export type ThumbnailMediaFolder = 'video' | 'reels' | 'live';
type ScheduleOption = 'now' | '1h' | 'tonight' | 'tomorrow' | 'custom';

interface FilmstripFrame {
  ratio: number;
  sec: number;
  uri: string;
}

const VIDEO_CATEGORIES = CATEGORIES.filter((c) => c !== 'Live');
const DRAFTS_STORAGE_KEY = '@creator_studio_drafts_v1';
const FILMSTRIP_RATIOS = [0.04, 0.22, 0.4, 0.58, 0.76, 0.92];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FileSystemCompat: any =
  typeof FileSystemLegacy?.readAsStringAsync === 'function'
    ? FileSystemLegacy
    : FileSystemDefault;

const VISIBILITY_OPTIONS: {
  value: VideoVisibility;
  label: string;
  shortDesc: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: 'public',
    label: 'Public',
    shortDesc: 'Everyone can search and watch',
    icon: 'globe-outline',
  },
  {
    value: 'subscribers',
    label: 'Subscribers',
    shortDesc: 'Only your subscribers can watch',
    icon: 'people-outline',
  },
  {
    value: 'private',
    label: 'Private',
    shortDesc: 'Only visible to you',
    icon: 'lock-closed-outline',
  },
];

const SCHEDULE_PRESETS: {
  value: Exclude<ScheduleOption, 'custom'>;
  label: string;
  sub: string;
}[] = [
  { value: 'now', label: 'Publish Now', sub: 'Go live immediately after upload' },
  { value: '1h', label: 'In 1 Hour', sub: 'Auto-publish 1 hour from now' },
  { value: 'tonight', label: 'Tonight · 8:00 PM', sub: 'Prime evening audience slot' },
  { value: 'tomorrow', label: 'Tomorrow · 10:00 AM', sub: 'Morning discovery slot' },
];

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Travel: 'airplane-outline',
  Tech: 'hardware-chip-outline',
  Music: 'musical-notes-outline',
  Fitness: 'barbell-outline',
};

const SMART_TAGS_BY_CATEGORY: Record<string, string[]> = {
  General: ['vlog', 'trending', 'creator', 'video', 'watch'],
  Travel: ['travel', 'vlog', 'explore', 'cinematic', 'wanderlust'],
  Tech: ['tech', 'review', 'setup', 'coding', 'gadgets'],
  Music: ['music', 'cover', 'acoustic', 'beats', 'studio'],
  Fitness: ['fitness', 'workout', 'gym', 'health', 'routine'],
};

const SUGGESTED_PLAYLISTS = [
  'Vlogs 2026',
  'Tech & Gear Reviews',
  'Behind The Scenes',
  'Tutorials & Guides',
];

function createMediaId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatTimeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

function formatScheduleDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const mon = SHORT_MONTHS[date.getMonth()];
  let hours = date.getHours();
  const mins = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${mon} · ${hours}:${mins} ${ampm}`;
}

function cleanFileNameToTitle(rawName?: string | null): string {
  if (!rawName) return '';
  const withoutExt = rawName.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  const cleaned = withoutExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^(vid|img|pxl|mov|dsc|video)\s*\d+/i.test(cleaned)) {
    return '';
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function buildTitleEnhancements(rawTitle: string, category: string): string[] {
  const base =
    rawTitle.trim() ||
    (category ? `My ${category} Experience` : 'My Latest Video');
  const cleanBase = base.replace(/[.!?]+$/, '');
  return [
    `${cleanBase} — What Nobody Tells You`,
    `I Tried ${cleanBase} (Honest Results)`,
    `${cleanBase} | Complete 2026 Guide`,
  ];
}

function resolveScheduledIso(
  option: ScheduleOption,
  customDate: Date
): string | null {
  if (option === 'now') return null;
  const now = new Date();
  if (option === '1h')
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  if (option === 'tonight') {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (option === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  }
  return customDate.toISOString();
}

function isRemoteHttpUrl(uri: string): boolean {
  return /^https?:\/\//i.test(uri.trim());
}

function normalizeExternalMediaUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/https?:\/\/\S+/i);
  if (urlMatch) return urlMatch[0].replace(/[),.;]+$/, '');
  if (/^www\./i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isLocalAssetUri(uri: string): boolean {
  const clean = uri.trim();
  if (!clean || isRemoteHttpUrl(clean)) return false;
  return /^(file:|content:|ph:|assets-library:|\/)/i.test(clean);
}

function isVideoUri(uri: string): boolean {
  const clean = uri.trim().toLowerCase();
  if (!clean) return false;
  if (isLikelyImageUri(clean)) return false;
  return /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i.test(clean);
}

function isValidImageCandidate(uri: string, videoUri?: string): boolean {
  const clean = uri.trim();
  if (!clean) return false;
  if (videoUri && clean === videoUri.trim()) return false;
  if (isVideoUri(clean)) return false;
  return (
    isLikelyImageUri(clean) || isRemoteHttpUrl(clean) || isLocalAssetUri(clean)
  );
}

async function removeDraftById(id: string): Promise<void> {
  if (!id) return;
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const filtered = parsed.filter((item) => item?.id !== id);
    await AsyncStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(filtered));
    DeviceEventEmitter.emit('studio-drafts-updated');
  } catch {
    // ignore
  }
}

async function captureViewSnapshotUri(viewRef: any): Promise<string | null> {
  if (!viewRef?.current) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: any = require('react-native-view-shot');
    const captureFn =
      typeof mod?.captureRef === 'function'
        ? mod.captureRef
        : typeof mod?.default?.captureRef === 'function'
          ? mod.default.captureRef
          : null;

    if (captureFn) {
      const uri = await captureFn(viewRef.current, {
        format: 'jpg',
        quality: 0.85,
        result: 'tmpfile',
      });
      return typeof uri === 'string' && uri.trim() ? uri.trim() : null;
    }
  } catch {
    // ignore
  }
  return null;
}

async function extractVideoFrameImageUri(
  videoUri: string,
  seekSec: number,
  quality = 0.85
): Promise<string | null> {
  const cleanUri = videoUri.trim();
  if (!cleanUri) return null;

  try {
    const mod: any = await import('expo-video-thumbnails');
    const getThumbFn =
      typeof mod?.getThumbnailAsync === 'function'
        ? mod.getThumbnailAsync
        : typeof mod?.default?.getThumbnailAsync === 'function'
          ? mod.default.getThumbnailAsync
          : null;

    if (!getThumbFn) return null;

    const timeMs = Math.max(0, Math.round(seekSec * 1000));

    try {
      const direct = await getThumbFn(cleanUri, {
        time: timeMs,
        quality,
      });
      if (typeof direct?.uri === 'string' && direct.uri.trim()) {
        return direct.uri.trim();
      }
    } catch {
      // retry via cache
    }

    if (
      FileSystemCompat?.cacheDirectory &&
      typeof FileSystemCompat?.copyAsync === 'function'
    ) {
      const cachedVideoPath = `${FileSystemCompat.cacheDirectory}thumb_src_${Date.now()}.mp4`;
      await FileSystemCompat.copyAsync({
        from: cleanUri,
        to: cachedVideoPath,
      });
      const fromCache = await getThumbFn(cachedVideoPath, {
        time: timeMs,
        quality,
      });
      if (typeof fromCache?.uri === 'string' && fromCache.uri.trim()) {
        return fromCache.uri.trim();
      }
    }
  } catch {
    // ignore
  }

  return null;
}

async function replacePlayerSourceAsync(player: any, nextUri: string) {
  if (!player || !nextUri) return;
  try {
    if (typeof player.replaceAsync === 'function') {
      await player.replaceAsync(nextUri);
    } else if (typeof player.replace === 'function') {
      player.replace(nextUri);
    }
    player.pause?.();
  } catch {
    // ignore
  }
}

interface StudioStagePlayerProps {
  uri: string;
  posterUri: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPlayerMetaUpdate?: (currentSec: number, durationSec: number) => void;
}

function StudioStagePlayer({
  uri,
  posterUri,
  isPlaying,
  onTogglePlay,
  onPlayerMetaUpdate,
}: StudioStagePlayerProps) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubRatio, setScrubRatio] = useState(0);
  const trackWidthRef = useRef<number>(1);
  const scrubRatioRef = useRef<number>(0);
  const playerRef = useRef<any>(null);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.pause();
  });

  playerRef.current = player;

  useEffect(() => {
    let active = true;
    setCurrentSec(0);
    setDurationSec(0);
    setScrubRatio(0);
    scrubRatioRef.current = 0;
    setIsScrubbing(false);
    setControlsVisible(true);

    replacePlayerSourceAsync(player, uri).then(() => {
      if (!active) return;
      try {
        player.pause();
      } catch {
        // ignore
      }
    });

    return () => {
      active = false;
    };
  }, [player, uri]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (isPlaying) p.play();
      else p.pause();
    } catch {
      // ignore
    }
  }, [player, isPlaying]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isScrubbing) return;
      const p = playerRef.current;
      if (!p) return;
      const cur = typeof p.currentTime === 'number' ? p.currentTime : 0;
      const dur =
        typeof p.duration === 'number' && p.duration > 0 ? p.duration : 0;
      setCurrentSec(cur);
      if (dur > 0) setDurationSec(dur);
      onPlayerMetaUpdate?.(cur, dur);
    }, 200);

    return () => clearInterval(timer);
  }, [uri, isScrubbing, onPlayerMetaUpdate]);

  const ratioFromLocationX = useCallback((locationX: number) => {
    const w = Math.max(1, trackWidthRef.current);
    return Math.min(1, Math.max(0, locationX / w));
  }, []);

  const commitSeekToRatio = useCallback(
    (ratio: number) => {
      const p = playerRef.current;
      const dur =
        typeof p?.duration === 'number' && p.duration > 0
          ? p.duration
          : durationSec;
      if (!p || !dur || dur <= 0) return;
      const targetSec = Math.min(dur, Math.max(0, ratio * dur));
      try {
        p.currentTime = targetSec;
      } catch {
        // ignore
      }
      setCurrentSec(targetSec);
    },
    [durationSec]
  );

  const activeRatio = useMemo(() => {
    if (isScrubbing) return scrubRatio;
    if (!durationSec || durationSec <= 0) return 0;
    return Math.min(1, Math.max(0, currentSec / durationSec));
  }, [isScrubbing, scrubRatio, currentSec, durationSec]);

  const displayedSec = useMemo(() => {
    if (isScrubbing && durationSec > 0) return scrubRatio * durationSec;
    return currentSec;
  }, [isScrubbing, scrubRatio, durationSec, currentSec]);

  const showPosterOverlay =
    !isPlaying && Boolean(posterUri) && isValidImageCandidate(posterUri, uri);

  return (
    <View style={styles.playerWrap}>
      <VideoView
        player={player}
        style={styles.videoSurface}
        contentFit="contain"
        nativeControls={false}
      />

      {showPosterOverlay ? (
        <Image
          source={{ uri: posterUri }}
          style={styles.posterLayer}
          resizeMode="cover"
          pointerEvents="none"
        />
      ) : null}

      <Pressable
        style={styles.backdropPressLayer}
        onPress={() => setControlsVisible((v) => !v)}
      >
        {controlsVisible ? (
          <TouchableOpacity
            style={styles.centerPlayBtn}
            activeOpacity={0.85}
            onPress={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={24}
              color="#09090b"
              style={!isPlaying ? { marginLeft: 3 } : undefined}
            />
          </TouchableOpacity>
        ) : null}
      </Pressable>

      <View style={styles.bottomProgressWrap}>
        <View
          style={styles.scrubTouchArea}
          onLayout={(e: LayoutChangeEvent) => {
            if (e.nativeEvent.layout.width > 0)
              trackWidthRef.current = e.nativeEvent.layout.width;
          }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            const r = ratioFromLocationX(e.nativeEvent.locationX);
            scrubRatioRef.current = r;
            setScrubRatio(r);
            setIsScrubbing(true);
          }}
          onResponderMove={(e) => {
            const r = ratioFromLocationX(e.nativeEvent.locationX);
            scrubRatioRef.current = r;
            setScrubRatio(r);
          }}
          onResponderRelease={() => {
            const finalRatio = scrubRatioRef.current;
            setIsScrubbing(false);
            commitSeekToRatio(finalRatio);
          }}
          onResponderTerminate={() => {
            const finalRatio = scrubRatioRef.current;
            setIsScrubbing(false);
            commitSeekToRatio(finalRatio);
          }}
        >
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(activeRatio * 100)}%` },
              ]}
            />
          </View>
        </View>
        <Text style={styles.timeText}>
          {formatTimeSec(displayedSec)} / {formatTimeSec(durationSec)}
        </Text>
      </View>
    </View>
  );
}

interface ThumbFrameLiveBoxProps {
  videoUri: string;
  seekSec: number;
  imageUri: string;
  useLiveVideo: boolean;
  extracting: boolean;
  snapshotRef: React.RefObject<any>;
}

function ThumbFrameLiveBox({
  videoUri,
  seekSec,
  imageUri,
  useLiveVideo,
  extracting,
  snapshotRef,
}: ThumbFrameLiveBoxProps) {
  const thumbPlayerRef = useRef<any>(null);
  const thumbPlayer = useVideoPlayer(videoUri, (p) => {
    p.loop = false;
    p.muted = true;
    p.pause();
  });
  thumbPlayerRef.current = thumbPlayer;

  useEffect(() => {
    const p = thumbPlayerRef.current;
    if (!p) return;
    try {
      p.pause();
      p.currentTime = Math.max(0, seekSec);
    } catch {
      // ignore
    }
  }, [thumbPlayer, seekSec, videoUri]);

  const showImage =
    !useLiveVideo &&
    Boolean(imageUri) &&
    isValidImageCandidate(imageUri, videoUri);

  return (
    <View style={styles.thumbSheetPreviewFrame}>
      <View
        ref={snapshotRef}
        style={styles.thumbSnapshotInner}
        collapsable={false}
      >
        {showImage ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.thumbPreviewImage}
            resizeMode="cover"
          />
        ) : videoUri ? (
          <VideoView
            player={thumbPlayer}
            style={styles.thumbPreviewImage}
            contentFit="cover"
            nativeControls={false}
          />
        ) : (
          <View style={styles.emptyThumbBox}>
            <Ionicons name="image-outline" size={32} color="#71717a" />
            <Text style={styles.emptyThumbText}>No thumbnail selected</Text>
          </View>
        )}
      </View>
      {extracting ? (
        <View style={styles.thumbSpinnerOverlay}>
          <ActivityIndicator size="small" color="#ffffff" />
        </View>
      ) : null}
    </View>
  );
}

export default function LongFormVideoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const colors = useMemo(
    () => ({
      bg: isDark ? '#09090b' : '#f4f4f5',
      surface: isDark ? '#18181b' : '#f1f5f9',
      inputBg: isDark ? '#09090b' : '#f8fafc',
      card: isDark ? '#18181b' : '#ffffff',
      border: isDark ? '#27272a' : '#e2e8f0',
      borderStrong: isDark ? '#3f3f46' : '#e2e8f0',
      text: isDark ? '#fafafa' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#64748b',
      accent: isDark ? '#fafafa' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
      emerald: '#10b981',
      emeraldSoft: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
      amber: '#f59e0b',
      amberSoft: isDark ? 'rgba(245, 158, 11, 0.16)' : '#fffbeb',
      switchTrackFalse: isDark ? '#3f3f46' : '#cbd5e1',
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

  const [category, setCategory] = useState<MediaCategory | ''>('');
  const [playlistName, setPlaylistName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [visibility, setVisibility] = useState<VideoVisibility>('public');

  const [locationText, setLocationText] = useState('');
  const [collaboratorsText, setCollaboratorsText] = useState('');
  const [pinnedComment, setPinnedComment] = useState('');

  const [scheduleOption, setScheduleOption] = useState<ScheduleOption>('now');
  const [isPremiere, setIsPremiere] = useState(false);
  const [customScheduleDate, setCustomScheduleDate] = useState<Date>(
    () => new Date(Date.now() + 2 * 60 * 60 * 1000)
  );
  const [nativePickerMode, setNativePickerMode] = useState<
    'date' | 'time' | null
  >(null);

  const [thumbMode, setThumbMode] = useState<VideoThumbMode>('video');
  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [activeThumbVariant, setActiveThumbVariant] = useState<'A' | 'B'>('A');
  const [variantBUri, setVariantBUri] = useState('');

  const [mediaUri, setMediaUri] = useState('');
  const [coverUri, setCoverUri] = useState('');
  const [videoFrameUri, setVideoFrameUri] = useState('');
  const [filmstripFrames, setFilmstripFrames] = useState<FilmstripFrame[]>([]);
  const [loadingFilmstrip, setLoadingFilmstrip] = useState(false);

  const [showUrlBox, setShowUrlBox] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [extractingFrame, setExtractingFrame] = useState(false);
  const [savingThumb, setSavingThumb] = useState(false);

  const [isStagePlaying, setIsStagePlaying] = useState(false);
  const [currentPlaySec, setCurrentPlaySec] = useState(0);
  const [selectedThumbSec, setSelectedThumbSec] = useState(0.5);
  const [videoDurationSec, setVideoDurationSec] = useState(0);
  const [thumbScrubRatio, setThumbScrubRatio] = useState(0.04);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const filmstripWidthRef = useRef<number>(1);
  const thumbRatioRef = useRef<number>(0.04);

  const [allowComments, setAllowComments] = useState(true);
  const [monetizeContent, setMonetizeContent] = useState(true);
  const [showLikesCount, setShowLikesCount] = useState(true);
  const [showViewsCount, setShowViewsCount] = useState(true);
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [paidPromotion, setPaidPromotion] = useState(false);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [ageRestricted, setAgeRestricted] = useState(false);
  const [madeForKids, setMadeForKids] = useState(false);

  const [thumbSheetOpen, setThumbSheetOpen] = useState(false);
  const [titleEnhancerOpen, setTitleEnhancerOpen] = useState(false);
  const [visibilitySheetOpen, setVisibilitySheetOpen] = useState(false);
  const [categoryPlaylistSheetOpen, setCategoryPlaylistSheetOpen] =
    useState(false);
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [locationCollabSheetOpen, setLocationCollabSheetOpen] = useState(false);
  const [pinnedCommentSheetOpen, setPinnedCommentSheetOpen] = useState(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [feedPreviewOpen, setFeedPreviewOpen] = useState(false);

  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [publishPercent, setPublishPercent] = useState(0);

  const mediaRowIdRef = useRef<string>(createMediaId());
  const savedThumbUrlRef = useRef<string>('');
  const thumbSetByUserRef = useRef<boolean>(false);
  const snapshotRef = useRef<any>(null);

  const isBusy = publishing || savingDraft || savingThumb;
  const mediaFolder: ThumbnailMediaFolder = 'video';

  useEffect(() => {
    if (!mediaUri.trim()) {
      setFilmstripFrames([]);
      return;
    }

    let cancelled = false;
    const dur = videoDurationSec > 0 ? videoDurationSec : 12;

    const buildFilmstrip = async () => {
      setLoadingFilmstrip(true);
      const generated: FilmstripFrame[] = [];
      for (const ratio of FILMSTRIP_RATIOS) {
        if (cancelled) return;
        const sec = Math.max(0.1, ratio * dur);
        const frameUri = await extractVideoFrameImageUri(mediaUri, sec, 0.45);
        generated.push({ ratio, sec, uri: frameUri || '' });
        if (!cancelled) setFilmstripFrames([...generated]);
      }
      if (!cancelled) {
        setLoadingFilmstrip(false);
        const firstValid = generated.find((f) => f.uri);
        if (firstValid && !videoFrameUri && thumbMode !== 'custom') {
          setVideoFrameUri(firstValid.uri);
        }
      }
    };

    void buildFilmstrip();
    return () => {
      cancelled = true;
    };
  }, [mediaUri, videoDurationSec > 0 ? Math.round(videoDurationSec) : 0]);

  const updateProgress = useCallback((msg: string, pct?: number) => {
    setProgressText(msg);
    if (typeof pct === 'number') {
      setPublishPercent((prev) =>
        Math.min(100, Math.max(prev, Math.round(pct)))
      );
    }
  }, []);

  const handlePlayerMetaUpdate = useCallback((cur: number, dur: number) => {
    setCurrentPlaySec(cur);
    if (dur > 0) setVideoDurationSec(dur);
  }, []);

  const persistThumbnailToDb = useCallback(
    async (
      remoteThumbUrl: string,
      thumbSec: number,
      mode: ThumbnailMode,
      overrideMediaUrl?: string
    ) => {
      const cleanThumb = isValidImageCandidate(remoteThumbUrl, mediaUri)
        ? remoteThumbUrl.trim()
        : '';
      if (!cleanThumb) return;

      const user = await backend.auth.getCurrentUser().catch(() => null);
      const creatorDisplayName =
        user?.fullName?.trim() ||
        user?.email?.split('@')[0]?.trim() ||
        'Creator';

      const rawHandle =
        user?.username?.trim() ||
        user?.email?.split('@')[0]?.trim() ||
        'creator';

      const normalizedHandle =
        rawHandle.replace(/^@+/, '').replace(/[^a-zA-Z0-9._-]/g, '') ||
        'creator';
      const creatorHandle = `@${normalizedHandle}`;
      const creatorAvatar = user?.avatarUrl || null;
      const parsed = parseTags(tagsText);

      const resolvedMediaUrl =
        (overrideMediaUrl && overrideMediaUrl.trim()) ||
        (isRemoteHttpUrl(mediaUri) ? mediaUri.trim() : '') ||
        mediaUri.trim() ||
        'pending://video';

      const payload: Record<string, any> = {
        id: mediaRowIdRef.current,
        title: title.trim() || 'Untitled Video',
        description: (description || '').trim(),
        category: category || null,
        tags: parsed,
        media_type: 'video',
        orientation: 'landscape',
        creator_name: creatorDisplayName,
        creator_handle: creatorHandle,
        creator_avatar: creatorAvatar,
        media_url: resolvedMediaUrl,
        thumbnail_url: cleanThumb,
        thumbnail_mode: mode,
        thumbnail_time_sec:
          mode === 'video' ? Number(Math.max(0, thumbSec).toFixed(2)) : null,
        total_seconds:
          videoDurationSec > 0 ? Math.round(videoDurationSec) : null,
        visibility,
        allow_comments: allowComments,
        monetize: monetizeContent,
        show_likes: showLikesCount,
        show_views: showViewsCount,
      };

      if (user?.id) payload.creator_id = user.id;

      await backend.studio.upsertWatchMedia(payload, mediaRowIdRef.current);
      savedThumbUrlRef.current = cleanThumb;
    },
    [
      description,
      tagsText,
      title,
      category,
      mediaUri,
      videoDurationSec,
      visibility,
      allowComments,
      monetizeContent,
      showLikesCount,
      showViewsCount,
    ]
  );

  const captureFrameFromVideo = useCallback(
    async (
      targetUri: string,
      options?: {
        switchMode?: boolean;
        seekSec?: number;
        commitAndSave?: boolean;
        fallbackUri?: string;
        silent?: boolean;
        onProgress?: (msg: string, pct?: number) => void;
      }
    ): Promise<string> => {
      const cleanUri = targetUri.trim();
      if (!cleanUri) return '';

      setExtractingFrame(true);
      if (options?.commitAndSave) setSavingThumb(true);

      try {
        if (options?.switchMode) setThumbMode('video');

        const targetSec =
          typeof options?.seekSec === 'number'
            ? Math.max(0, options.seekSec)
            : Math.max(0, selectedThumbSec);

        setSelectedThumbSec(targetSec);

        let candidateImageUri = '';
        if (
          thumbMode === 'custom' &&
          isValidImageCandidate(coverUri, cleanUri)
        ) {
          candidateImageUri = coverUri.trim();
        } else {
          const extractedUri = await extractVideoFrameImageUri(
            cleanUri,
            targetSec,
            0.85
          );
          const snappedUri = !extractedUri
            ? await captureViewSnapshotUri(snapshotRef)
            : null;

          const pool = [
            extractedUri || '',
            snappedUri || '',
            (options?.fallbackUri || '').trim(),
            videoFrameUri.trim(),
            savedThumbUrlRef.current.trim(),
            coverUri.trim(),
          ];

          candidateImageUri =
            pool.find((item) => isValidImageCandidate(item, cleanUri)) || '';

          if (candidateImageUri) {
            if (abTestEnabled && activeThumbVariant === 'B') {
              setVariantBUri(candidateImageUri);
            } else {
              setVideoFrameUri(candidateImageUri);
            }
          }
        }

        if (options?.commitAndSave) {
          if (
            !candidateImageUri ||
            !isValidImageCandidate(candidateImageUri, cleanUri)
          ) {
            if (!options?.silent) {
              Alert.alert(
                'Frame Unavailable',
                'Could not extract a frame. Try uploading a custom thumbnail image.'
              );
            }
            return '';
          }

          let uploadedUrl = candidateImageUri;
          if (!isRemoteHttpUrl(candidateImageUri)) {
            const user = await backend.auth.getCurrentUser().catch(() => null);
            const userId = user?.id || 'anonymous';
            uploadedUrl = await backend.studio.uploadAsset(
              candidateImageUri,
              'thumbnail',
              userId,
              options?.onProgress,
              mediaFolder
            );
          }

          const activeMode: ThumbnailMode =
            thumbMode === 'custom' ? 'custom' : 'video';
          await persistThumbnailToDb(uploadedUrl, targetSec, activeMode);
          thumbSetByUserRef.current = true;
          return uploadedUrl;
        }

        return candidateImageUri;
      } catch (err: any) {
        if (options?.commitAndSave && !options?.silent) {
          Alert.alert(
            'Thumbnail Save Failed',
            err?.message || 'Unable to save thumbnail image.'
          );
        }
        return '';
      } finally {
        setExtractingFrame(false);
        if (options?.commitAndSave) setSavingThumb(false);
      }
    },
    [
      selectedThumbSec,
      thumbMode,
      coverUri,
      videoFrameUri,
      abTestEnabled,
      activeThumbVariant,
      mediaFolder,
      persistThumbnailToDb,
    ]
  );

  useEffect(() => {
    if (!draftId) return;
    getStudioDrafts().then((items) => {
      const found = items.find((d) => d.id === draftId) as any;
      if (!found) return;
      if (found.id) mediaRowIdRef.current = found.id;
      setTitle(found.title || '');
      setCategory(found.category || '');
      setPlaylistName(found.playlistName || '');
      setLocationText(found.locationText || '');
      setCollaboratorsText(found.collaboratorsText || '');
      setPinnedComment(found.pinnedComment || '');
      setDescription(found.description || '');
      setTagsText(found.tagsText || '');
      if (
        found.visibility === 'public' ||
        found.visibility === 'subscribers' ||
        found.visibility === 'private'
      ) {
        setVisibility(found.visibility);
      }
      if (typeof found.selectedThumbSec === 'number') {
        setSelectedThumbSec(found.selectedThumbSec);
      }
      if (typeof found.thumbScrubRatio === 'number') {
        setThumbScrubRatio(found.thumbScrubRatio);
      }
      setThumbMode(found.thumbnailMode || 'video');
      setMediaUri(found.mediaUri || '');
      const draftCover =
        found.coverUri && isValidImageCandidate(found.coverUri, found.mediaUri)
          ? found.coverUri
          : '';
      setCoverUri(draftCover);
      setIsStagePlaying(false);
    });
  }, [draftId]);

  const parsedTags = useMemo(() => parseTags(tagsText), [tagsText]);
  const suggestedTags =
    (category && SMART_TAGS_BY_CATEGORY[category]) ||
    SMART_TAGS_BY_CATEGORY.General;

  const titleSuggestions = useMemo(
    () => buildTitleEnhancements(title, category),
    [title, category]
  );

  const handleToggleSmartTag = (tag: string) => {
    const clean = tag.toLowerCase();
    const existing = parsedTags.map((t) => t.replace(/^#+/, '').toLowerCase());
    if (existing.includes(clean)) return;
    const next = tagsText.trim() ? `${tagsText.trim()}, ${clean}` : clean;
    setTagsText(next);
  };

  const handleInsertChapter = () => {
    const stamp = formatTimeSec(currentPlaySec);
    const chapterLine = `${stamp} Chapter Title`;
    setDescription((prev) =>
      prev.trim() ? `${prev.trim()}\n${chapterLine}` : chapterLine
    );
  };

  const resolvedCoverImage = useMemo(() => {
    if (thumbMode === 'custom' && isValidImageCandidate(coverUri, mediaUri)) {
      return coverUri.trim();
    }
    if (isValidImageCandidate(videoFrameUri, mediaUri)) {
      return videoFrameUri.trim();
    }
    if (isValidImageCandidate(savedThumbUrlRef.current, mediaUri)) {
      return savedThumbUrlRef.current.trim();
    }
    if (isValidImageCandidate(coverUri, mediaUri)) {
      return coverUri.trim();
    }
    return '';
  }, [thumbMode, coverUri, videoFrameUri, mediaUri]);

  const activeSheetPreviewImage =
    abTestEnabled && activeThumbVariant === 'B'
      ? variantBUri
      : resolvedCoverImage;

  const normalizedThumbMode: ThumbnailMode =
    thumbMode === 'custom' ? 'custom' : 'video';

  const activeVisibilityMeta = useMemo(
    () =>
      VISIBILITY_OPTIONS.find((item) => item.value === visibility) ||
      VISIBILITY_OPTIONS[0],
    [visibility]
  );

  const scheduleDisplayLabel = useMemo(() => {
    const base =
      scheduleOption === 'custom'
        ? formatScheduleDateTime(customScheduleDate)
        : SCHEDULE_PRESETS.find((p) => p.value === scheduleOption)?.label ||
          'Publish Now';
    return scheduleOption !== 'now' && isPremiere ? `${base} · Premiere` : base;
  }, [scheduleOption, customScheduleDate, isPremiere]);

  const pickVideoFile = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Allow media library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      const pickedAsset = res.assets[0];
      const pickedDurSec =
        typeof pickedAsset.duration === 'number' && pickedAsset.duration > 0
          ? pickedAsset.duration > 1000
            ? pickedAsset.duration / 1000
            : pickedAsset.duration
          : 0;

      if (!title.trim()) {
        const autoTitle = cleanFileNameToTitle(
          pickedAsset.fileName || pickedAsset.uri.split('/').pop()
        );
        if (autoTitle) setTitle(autoTitle);
      }

      mediaRowIdRef.current = createMediaId();
      savedThumbUrlRef.current = '';
      thumbSetByUserRef.current = false;
      setMediaUri(pickedAsset.uri);
      setVideoFrameUri('');
      setCoverUri('');
      setVariantBUri('');
      setFilmstripFrames([]);
      setIsStagePlaying(false);
      setSelectedThumbSec(0.5);
      setVideoDurationSec(pickedDurSec);
      setThumbScrubRatio(0.04);
    }
  }, [title]);

  const recordVideo = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Allow camera access.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      const recordedAsset = res.assets[0];
      const recordedDurSec =
        typeof recordedAsset.duration === 'number' &&
        recordedAsset.duration > 0
          ? recordedAsset.duration > 1000
            ? recordedAsset.duration / 1000
            : recordedAsset.duration
          : 0;

      mediaRowIdRef.current = createMediaId();
      savedThumbUrlRef.current = '';
      thumbSetByUserRef.current = false;
      setMediaUri(recordedAsset.uri);
      setVideoFrameUri('');
      setCoverUri('');
      setVariantBUri('');
      setFilmstripFrames([]);
      setIsStagePlaying(false);
      setSelectedThumbSec(0.5);
      setVideoDurationSec(recordedDurSec);
      setThumbScrubRatio(0.04);
    }
  }, []);

  const pickCustomThumbnail = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Allow photo access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      const pickedImg = res.assets[0].uri;
      if (!isValidImageCandidate(pickedImg, mediaUri)) {
        Alert.alert('Invalid Image', 'Please select a valid thumbnail image.');
        return;
      }

      if (abTestEnabled && activeThumbVariant === 'B') {
        setVariantBUri(pickedImg);
        return;
      }

      setThumbMode('custom');
      setCoverUri(pickedImg);
      setSavingThumb(true);
      try {
        let savedUrl = pickedImg;
        if (!isRemoteHttpUrl(pickedImg)) {
          const user = await backend.auth.getCurrentUser().catch(() => null);
          const userId = user?.id || 'anonymous';
          savedUrl = await backend.studio.uploadAsset(
            pickedImg,
            'thumbnail',
            userId,
            undefined,
            mediaFolder
          );
        }
        await persistThumbnailToDb(savedUrl, selectedThumbSec, 'custom');
        thumbSetByUserRef.current = true;
      } catch (err: any) {
        Alert.alert(
          'Thumbnail Save Failed',
          err?.message || 'Unable to save custom thumbnail.'
        );
      } finally {
        setSavingThumb(false);
      }
    }
  }, [
    abTestEnabled,
    activeThumbVariant,
    mediaFolder,
    mediaUri,
    persistThumbnailToDb,
    selectedThumbSec,
  ]);

  const applyUrl = useCallback(() => {
    const clean = normalizeExternalMediaUrl(urlInput);
    if (!clean || !isRemoteHttpUrl(clean)) {
      Alert.alert(
        'Invalid URL',
        'Enter a valid video link (e.g. https://example.com/video.mp4).'
      );
      return;
    }
    mediaRowIdRef.current = createMediaId();
    savedThumbUrlRef.current = '';
    thumbSetByUserRef.current = false;
    setMediaUri(clean);
    setVideoFrameUri('');
    setCoverUri('');
    setVariantBUri('');
    setFilmstripFrames([]);
    setIsStagePlaying(false);
    setUrlInput('');
    setShowUrlBox(false);
    setSelectedThumbSec(0.5);
    setVideoDurationSec(0);
    setThumbScrubRatio(0.04);

    if (!title.trim()) {
      const pathName = clean.split('?')[0].split('/').pop();
      const autoTitle = cleanFileNameToTitle(pathName);
      if (autoTitle) setTitle(autoTitle);
    }

    void captureFrameFromVideo(clean, { seekSec: 0.5, silent: true });
  }, [captureFrameFromVideo, title, urlInput]);

  const clearSelectedVideo = useCallback(() => {
    mediaRowIdRef.current = createMediaId();
    savedThumbUrlRef.current = '';
    thumbSetByUserRef.current = false;
    setMediaUri('');
    setVideoFrameUri('');
    setCoverUri('');
    setVariantBUri('');
    setFilmstripFrames([]);
    setThumbMode('video');
    setIsStagePlaying(false);
    setSelectedThumbSec(0.5);
    setVideoDurationSec(0);
    setThumbScrubRatio(0.04);
  }, []);

  const updateFilmstripScrub = (locationX: number) => {
    const w = Math.max(1, filmstripWidthRef.current);
    const r = Math.min(0.98, Math.max(0.02, locationX / w));
    thumbRatioRef.current = r;
    setThumbScrubRatio(r);
    const dur = videoDurationSec > 0 ? videoDurationSec : 12;
    setSelectedThumbSec(r * dur);
  };

  const handleSaveDraft = useCallback(async () => {
    if (isBusy) return;
    try {
      setSavingDraft(true);
      setIsStagePlaying(false);
      const cleanTitle = title.trim() || 'Untitled Video';
      await saveStudioDraft({
        id: draftId || mediaRowIdRef.current || `draft-${Date.now()}`,
        mode: 'video',
        title: cleanTitle,
        category: (category || 'Travel') as MediaCategory,
        playlistName: playlistName.trim(),
        locationText: locationText.trim(),
        collaboratorsText: collaboratorsText.trim(),
        pinnedComment: pinnedComment.trim(),
        description: (description || '').trim(),
        tagsText: tagsText.trim(),
        thumbnailMode: normalizedThumbMode,
        musicTrackId: null,
        customAudioUri: '',
        mediaUri: mediaUri.trim(),
        coverUri: resolvedCoverImage,
        visibility,
        selectedThumbSec,
        thumbScrubRatio,
        allowComments,
        monetize: monetizeContent,
        showLikesCount,
        showViewsCount,
        savedAt: 'Just now',
      } as any);
      DeviceEventEmitter.emit('studio-drafts-updated');
      Alert.alert('Saved to Drafts', `"${cleanTitle}" saved.`);
      router.back();
    } catch (err: any) {
      Alert.alert('Draft Failed', err?.message || 'Unable to save draft.');
    } finally {
      setSavingDraft(false);
    }
  }, [
    isBusy,
    title,
    description,
    draftId,
    category,
    playlistName,
    locationText,
    collaboratorsText,
    pinnedComment,
    tagsText,
    normalizedThumbMode,
    mediaUri,
    resolvedCoverImage,
    visibility,
    selectedThumbSec,
    thumbScrubRatio,
    allowComments,
    monetizeContent,
    showLikesCount,
    showViewsCount,
    router,
  ]);

  const handlePublish = useCallback(async () => {
    let effectiveMediaUri = mediaUri.trim();
    if (!effectiveMediaUri && urlInput.trim()) {
      const candidateUrl = normalizeExternalMediaUrl(urlInput);
      if (isRemoteHttpUrl(candidateUrl)) {
        effectiveMediaUri = candidateUrl;
        setMediaUri(candidateUrl);
        setShowUrlBox(false);
        setUrlInput('');
      }
    }
    if (!title.trim()) {
      Alert.alert('Title Required', 'Please enter a video title.');
      return;
    }
    if (!effectiveMediaUri) {
      Alert.alert(
        'Video Required',
        'Please select a video or paste a valid URL before publishing.'
      );
      return;
    }
    if (isBusy) return;

    const cleanDescription = (description || '').trim();
    const scheduledAtIso = resolveScheduledIso(
      scheduleOption,
      customScheduleDate
    );

    try {
      setPublishing(true);
      setPublishPercent(2);
      setIsStagePlaying(false);
      updateProgress('Preparing upload...', 5);

      const user = await backend.auth.getCurrentUser().catch(() => null);
      const userId = user?.id || 'anonymous';
      updateProgress('Account verified', 10);

      let uploadedThumbUrl = isValidImageCandidate(
        savedThumbUrlRef.current,
        effectiveMediaUri
      )
        ? savedThumbUrlRef.current.trim()
        : '';

      if (!thumbSetByUserRef.current || !uploadedThumbUrl) {
        updateProgress('Extracting thumbnail frame...', 14);
        let autoThumbCandidate = '';
        try {
          autoThumbCandidate = await captureFrameFromVideo(effectiveMediaUri, {
            seekSec: selectedThumbSec,
            commitAndSave: true,
            fallbackUri: resolvedCoverImage,
            silent: true,
            onProgress: updateProgress,
          });
        } catch {
          autoThumbCandidate = '';
        }
        uploadedThumbUrl = isValidImageCandidate(
          autoThumbCandidate,
          effectiveMediaUri
        )
          ? autoThumbCandidate.trim()
          : isValidImageCandidate(savedThumbUrlRef.current, effectiveMediaUri)
            ? savedThumbUrlRef.current.trim()
            : isValidImageCandidate(resolvedCoverImage, effectiveMediaUri)
              ? resolvedCoverImage.trim()
              : '';
      } else {
        updateProgress('Thumbnail ready', 32);
      }

      if (uploadedThumbUrl && isLocalAssetUri(uploadedThumbUrl)) {
        try {
          uploadedThumbUrl = await backend.studio.uploadAsset(
            uploadedThumbUrl,
            'thumbnail',
            userId,
            updateProgress,
            mediaFolder
          );
        } catch {
          uploadedThumbUrl = '';
        }
      }

      if (
        uploadedThumbUrl &&
        !isValidImageCandidate(uploadedThumbUrl, effectiveMediaUri)
      ) {
        uploadedThumbUrl = '';
      }

      let uploadedThumbBUrl: string | null = null;
      if (
        abTestEnabled &&
        variantBUri &&
        isValidImageCandidate(variantBUri, effectiveMediaUri)
      ) {
        try {
          uploadedThumbBUrl = isLocalAssetUri(variantBUri)
            ? await backend.studio.uploadAsset(
                variantBUri,
                'thumbnail',
                userId,
                undefined,
                mediaFolder
              )
            : variantBUri;
        } catch {
          uploadedThumbBUrl = null;
        }
      }

      let uploadedVideoUrl = isRemoteHttpUrl(effectiveMediaUri)
        ? effectiveMediaUri
        : '';

      if (!uploadedVideoUrl && effectiveMediaUri) {
        uploadedVideoUrl = await backend.studio.uploadAsset(
          effectiveMediaUri,
          'video',
          userId,
          updateProgress,
          mediaFolder
        );
      } else {
        updateProgress('Video URL ready', 80);
      }

      updateProgress('Saving to database...', 92);

      const rowId = mediaRowIdRef.current || createMediaId();
      mediaRowIdRef.current = rowId;

      const finalPlayableUri = uploadedVideoUrl || effectiveMediaUri || null;

      const finalThumbnailUri =
        uploadedThumbUrl ||
        (isRemoteHttpUrl(resolvedCoverImage) ? resolvedCoverImage.trim() : null);

      const creatorDisplayName =
        user?.fullName?.trim() ||
        user?.email?.split('@')[0]?.trim() ||
        'Creator';

      const rawHandle =
        user?.username?.trim() ||
        user?.email?.split('@')[0]?.trim() ||
        'creator';

      const normalizedHandle =
        rawHandle.replace(/^@+/, '').replace(/[^a-zA-Z0-9._-]/g, '') ||
        'creator';
      const creatorHandle = `@${normalizedHandle}`;
      const creatorAvatar = user?.avatarUrl || null;

      const formattedTagList = parsedTags
        .map((t) => t.replace(/^#+/, '').trim())
        .filter(Boolean)
        .map((t) => `#${t}`);

      const metaText = [locationText.trim() || null, formattedTagList.join(' ')]
        .filter(Boolean)
        .join(' · ');

      const safeDurationSec =
        videoDurationSec > 0 ? Math.round(videoDurationSec) : null;

      const collaboratorsList = collaboratorsText
        .split(/[,\s]+/)
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => (c.startsWith('@') ? c : `@${c}`));

      const basePayload: Record<string, any> = {
        id: rowId,
        title: title.trim(),
        description: cleanDescription,
        meta_text: metaText || null,
        badge_text: null,
        category: category || null,
        playlist_name: playlistName.trim() || null,
        location: locationText.trim() || null,
        collaborators: collaboratorsList.length > 0 ? collaboratorsList : null,
        pinned_comment: pinnedComment.trim() || null,
        tags: parsedTags,
        mode: 'video',
        format: 'video',
        media_type: 'video',
        orientation: 'landscape',
        creator_name: creatorDisplayName,
        creator_handle: creatorHandle,
        creator_avatar: creatorAvatar,
        media_url: finalPlayableUri || 'pending://video',
        thumbnail_url: finalThumbnailUri,
        cover_url: finalThumbnailUri,
        thumbnail_b_url: uploadedThumbBUrl,
        thumbnail_mode: normalizedThumbMode,
        thumbnail_time_sec:
          normalizedThumbMode === 'video'
            ? Number(selectedThumbSec.toFixed(2))
            : null,
        total_seconds: safeDurationSec,
        visibility,
        scheduled_at: scheduledAtIso,
        is_premiere: scheduleOption !== 'now' && isPremiere,
        allow_comments: allowComments,
        monetize: monetizeContent,
        show_likes: showLikesCount,
        show_views: showViewsCount,
        auto_captions: autoCaptions,
        paid_promotion: paidPromotion,
        allow_downloads: allowDownloads,
        age_restricted: ageRestricted,
        made_for_kids: madeForKids,
      };

      if (user?.id) basePayload.creator_id = user.id;

      const dbRow = await backend.studio.upsertWatchMedia(basePayload, rowId);

      if (pinnedComment.trim() && allowComments) {
        try {
          await backend.watch.addComment({
            id: `pin-${Date.now()}`,
            mediaId: dbRow?.id || rowId,
            author: `${creatorDisplayName} (Pinned)`,
            text: pinnedComment.trim(),
          });
        } catch {
          // ignore if comments table differs
        }
      }

      if (draftId) {
        await deleteStudioDraft(draftId);
        await removeDraftById(draftId);
      }

      const finalEventPayload = {
        ...(dbRow || {}),
        description: dbRow?.description ?? cleanDescription,
        creator_avatar: creatorAvatar || dbRow?.creator_avatar || null,
        media_url: finalPlayableUri || dbRow?.media_url || null,
        thumbnail_url:
          (dbRow?.thumbnail_url &&
          isValidImageCandidate(dbRow.thumbnail_url, mediaUri)
            ? dbRow.thumbnail_url
            : finalThumbnailUri) || null,
        total_seconds: safeDurationSec ?? dbRow?.total_seconds ?? null,
        visibility,
        show_likes: showLikesCount,
        show_views: showViewsCount,
      };

      updateProgress('Published 100%', 100);
      DeviceEventEmitter.emit('watch-media-created', finalEventPayload);

      Alert.alert(
        scheduleOption === 'now' ? 'Published' : 'Scheduled',
        scheduleOption === 'now'
          ? `Your video is live as ${activeVisibilityMeta.label}.`
          : `Scheduled for ${scheduleDisplayLabel} (${activeVisibilityMeta.label}).`,
        [
          { text: 'Back', onPress: () => router.back() },
          {
            text: 'Open Watch',
            onPress: () => router.replace('/(tabs)/watch' as any),
          },
        ]
      );
    } catch (err: any) {
      Alert.alert(
        'Publish Failed',
        err?.message || 'Unable to publish video.'
      );
    } finally {
      setPublishing(false);
      setProgressText('');
      setPublishPercent(0);
    }
  }, [
    title,
    mediaUri,
    isBusy,
    description,
    scheduleOption,
    customScheduleDate,
    isPremiere,
    scheduleDisplayLabel,
    updateProgress,
    captureFrameFromVideo,
    selectedThumbSec,
    resolvedCoverImage,
    abTestEnabled,
    variantBUri,
    mediaFolder,
    parsedTags,
    normalizedThumbMode,
    allowComments,
    monetizeContent,
    activeVisibilityMeta.label,
    videoDurationSec,
    category,
    playlistName,
    locationText,
    collaboratorsText,
    pinnedComment,
    visibility,
    showLikesCount,
    showViewsCount,
    autoCaptions,
    paidPromotion,
    allowDownloads,
    ageRestricted,
    madeForKids,
    draftId,
    urlInput,
    router,
  ]);

  const videoReady =
    Boolean(mediaUri.trim()) ||
    isRemoteHttpUrl(normalizeExternalMediaUrl(urlInput));
  const titleReady = title.trim().length > 0;
  const thumbReady = Boolean(resolvedCoverImage);
  const isFormReady = videoReady && titleReady;

  const advancedSummary = [
    allowComments ? 'Comments On' : 'Comments Off',
    monetizeContent ? 'Monetized' : null,
    paidPromotion ? 'Sponsored' : null,
    ageRestricted ? '18+' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.topBar,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          <View style={styles.headerSideLeft}>
            <TouchableOpacity
              onPress={() => !isBusy && router.back()}
              style={[styles.iconCircleBtn, { backgroundColor: colors.surface }]}
              activeOpacity={0.75}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.headerTitle, { color: colors.text }]}>
            New Video
          </Text>

          <View style={styles.headerSideRight}>
            <TouchableOpacity
              style={[styles.iconCircleBtn, { backgroundColor: colors.surface }]}
              onPress={() => setFeedPreviewOpen(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="eye-outline" size={18} color={colors.text} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.draftPillBtn, { backgroundColor: colors.surface }]}
              onPress={handleSaveDraft}
              disabled={isBusy}
              activeOpacity={0.75}
            >
              <Text style={[styles.draftPillText, { color: colors.text }]}>
                Draft
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scrollBody,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.stageContainer}>
            <View
              style={[
                styles.stageBox,
                { backgroundColor: mediaUri ? '#09090b' : colors.bg },
              ]}
            >
              {mediaUri ? (
                <StudioStagePlayer
                  uri={mediaUri}
                  posterUri={resolvedCoverImage}
                  isPlaying={isStagePlaying}
                  onTogglePlay={() => setIsStagePlaying((p) => !p)}
                  onPlayerMetaUpdate={handlePlayerMetaUpdate}
                />
              ) : (
                <TouchableOpacity
                  style={styles.emptyHeroStage}
                  onPress={pickVideoFile}
                  activeOpacity={0.88}
                >
                  <View style={styles.emptyHeroIconCircle}>
                    <Ionicons name="videocam" size={24} color="#10b981" />
                  </View>
                  <Text style={styles.emptyHeroTitle}>
                    Select or Record Video
                  </Text>
                  <Text style={styles.emptyHeroDesc}>
                    MP4 or MOV · 16:9 Widescreen HD
                  </Text>
                  <View style={styles.chooseHeroPill}>
                    <Ionicons
                      name="cloud-upload-outline"
                      size={14}
                      color="#09090b"
                    />
                    <Text style={styles.chooseHeroPillText}>Browse Files</Text>
                  </View>
                </TouchableOpacity>
              )}

              {mediaUri ? (
                <>
                  <TouchableOpacity
                    style={styles.floatingThumbBtn}
                    onPress={() => {
                      setIsStagePlaying(false);
                      setThumbSheetOpen(true);
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="image-outline" size={14} color="#ffffff" />
                    <Text style={styles.floatingThumbText}>
                      {abTestEnabled ? 'A/B Thumbnails' : 'Thumbnail'}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.floatingRightGroup}>
                    <View style={styles.specsBadge}>
                      <Text style={styles.specsBadgeText}>
                        16:9 · {formatTimeSec(videoDurationSec)} · HD
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.floatingRemoveBtn}
                      onPress={clearSelectedVideo}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ffffff" />
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </View>

            <View
              style={[
                styles.sourceBarCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.sourceChip,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.border,
                  },
                ]}
                onPress={pickVideoFile}
                disabled={isBusy}
              >
                <Ionicons
                  name="folder-open-outline"
                  size={15}
                  color={colors.text}
                />
                <Text style={[styles.sourceChipText, { color: colors.text }]}>
                  Gallery
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sourceChip,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.border,
                  },
                ]}
                onPress={recordVideo}
                disabled={isBusy}
              >
                <Ionicons
                  name="videocam-outline"
                  size={15}
                  color={colors.text}
                />
                <Text style={[styles.sourceChipText, { color: colors.text }]}>
                  Camera
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sourceChip,
                  {
                    backgroundColor: showUrlBox
                      ? colors.accent
                      : colors.inputBg,
                    borderColor: showUrlBox ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => setShowUrlBox((v) => !v)}
                disabled={isBusy}
              >
                <Ionicons
                  name="link-outline"
                  size={15}
                  color={showUrlBox ? colors.accentText : colors.text}
                />
                <Text
                  style={[
                    styles.sourceChipText,
                    { color: showUrlBox ? colors.accentText : colors.text },
                  ]}
                >
                  URL
                </Text>
              </TouchableOpacity>

              {!mediaUri && (
                <TouchableOpacity
                  style={[
                    styles.sourceChip,
                    {
                      backgroundColor: colors.inputBg,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setThumbSheetOpen(true)}
                  disabled={isBusy}
                >
                  <Ionicons
                    name="image-outline"
                    size={15}
                    color={colors.text}
                  />
                  <Text style={[styles.sourceChipText, { color: colors.text }]}>
                    Thumb
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {showUrlBox && (
              <View style={styles.urlInlineBar}>
                <TextInput
                  style={[
                    styles.urlInput,
                    {
                      backgroundColor: colors.card,
                      color: colors.text,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                  value={urlInput}
                  onChangeText={setUrlInput}
                  placeholder="https://example.com/video.mp4"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[
                    styles.urlApplyBtn,
                    { backgroundColor: colors.accent },
                  ]}
                  onPress={applyUrl}
                >
                  <Text
                    style={[
                      styles.urlApplyBtnText,
                      { color: colors.accentText },
                    ]}
                  >
                    Load
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View
            style={[
              styles.editorBlockCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <View style={styles.fieldLabelRow}>
              <Text style={[styles.fieldLabel, { color: colors.subtext }]}>
                TITLE
              </Text>
              <View style={styles.titleMetaRight}>
                <TouchableOpacity
                  style={[
                    styles.enhanceBtn,
                    { backgroundColor: colors.emeraldSoft },
                  ]}
                  onPress={() => setTitleEnhancerOpen(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="sparkles" size={11} color={colors.emerald} />
                  <Text style={styles.enhanceBtnText}>Enhance</Text>
                </TouchableOpacity>
                <Text style={[styles.charCount, { color: colors.subtext }]}>
                  {title.length}/100
                </Text>
              </View>
            </View>
            <TextInput
              style={[
                styles.titleInputBox,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBg,
                  borderColor: colors.border,
                },
              ]}
              value={title}
              onChangeText={setTitle}
              maxLength={100}
              placeholder="Create a compelling title..."
              placeholderTextColor={colors.subtext}
              multiline
            />

            <View style={{ height: 14 }} />

            <View style={styles.fieldLabelRow}>
              <Text style={[styles.fieldLabel, { color: colors.subtext }]}>
                DESCRIPTION
              </Text>
              <TouchableOpacity
                style={[
                  styles.chapterBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={handleInsertChapter}
              >
                <Ionicons name="time-outline" size={12} color={colors.text} />
                <Text style={[styles.chapterBtnText, { color: colors.text }]}>
                  + Add Chapter ({formatTimeSec(currentPlaySec)})
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.descInputBox,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBg,
                  borderColor: colors.border,
                },
              ]}
              value={description}
              onChangeText={setDescription}
              placeholder="Tell viewers about your video..."
              placeholderTextColor={colors.subtext}
              multiline
            />

            <View style={{ height: 14 }} />

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.subtext, marginBottom: 6 },
              ]}
            >
              TAGS
            </Text>
            <TextInput
              style={[
                styles.tagsInputBox,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBg,
                  borderColor: colors.border,
                },
              ]}
              value={tagsText}
              onChangeText={setTagsText}
              placeholder="Add tags separated by commas..."
              placeholderTextColor={colors.subtext}
              autoCapitalize="none"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.smartTagsScroll}
            >
              {suggestedTags.map((t) => {
                const added = parsedTags
                  .map((p) => p.replace(/^#+/, '').toLowerCase())
                  .includes(t.toLowerCase());
                return (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.smartTagPill,
                      {
                        backgroundColor: added
                          ? colors.emeraldSoft
                          : colors.surface,
                      },
                    ]}
                    onPress={() => handleToggleSmartTag(t)}
                  >
                    <Text
                      style={[
                        styles.smartTagText,
                        { color: added ? colors.emerald : colors.subtext },
                      ]}
                    >
                      {added ? '✓ ' : ''}#{t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <Text style={[styles.sectionGroupTitle, { color: colors.subtext }]}>
            PUBLISHING & VISIBILITY
          </Text>
          <View
            style={[
              styles.rowsCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => setVisibilitySheetOpen(true)}
              activeOpacity={0.75}
            >
              <View
                style={[styles.rowIconBox, { backgroundColor: colors.surface }]}
              >
                <Ionicons
                  name={activeVisibilityMeta.icon}
                  size={18}
                  color={colors.text}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  Visibility
                </Text>
                <Text style={[styles.rowValue, { color: colors.text }]}>
                  {activeVisibilityMeta.label}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.subtext}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => setScheduleSheetOpen(true)}
              activeOpacity={0.75}
            >
              <View
                style={[styles.rowIconBox, { backgroundColor: colors.surface }]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={colors.text}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  Schedule & Premiere
                </Text>
                <Text style={[styles.rowValue, { color: colors.text }]}>
                  {scheduleDisplayLabel}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.subtext}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => setCategoryPlaylistSheetOpen(true)}
              activeOpacity={0.75}
            >
              <View
                style={[styles.rowIconBox, { backgroundColor: colors.surface }]}
              >
                <Ionicons
                  name={(category && CATEGORY_ICON[category]) || 'grid-outline'}
                  size={18}
                  color={colors.text}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  Category & Playlist (Optional)
                </Text>
                <Text
                  style={[
                    styles.rowValue,
                    {
                      color:
                        category || playlistName.trim()
                          ? colors.text
                          : colors.subtext,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {[category || null, playlistName.trim() || null]
                    .filter(Boolean)
                    .join(' · ') || 'None selected'}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.subtext}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => setLocationCollabSheetOpen(true)}
              activeOpacity={0.75}
            >
              <View
                style={[styles.rowIconBox, { backgroundColor: colors.surface }]}
              >
                <Ionicons
                  name="location-outline"
                  size={18}
                  color={colors.text}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  Location & Collaborators
                </Text>
                <Text
                  style={[
                    styles.rowValue,
                    {
                      color:
                        locationText.trim() || collaboratorsText.trim()
                          ? colors.text
                          : colors.subtext,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {[
                    locationText.trim() || null,
                    collaboratorsText.trim() || null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Add location or tag @creators'}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.subtext}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: colors.border }]}
              onPress={() => setPinnedCommentSheetOpen(true)}
              activeOpacity={0.75}
            >
              <View
                style={[styles.rowIconBox, { backgroundColor: colors.surface }]}
              >
                <Ionicons name="pin-outline" size={18} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  Pre-Set Pinned Comment
                </Text>
                <Text
                  style={[
                    styles.rowValue,
                    {
                      color: pinnedComment.trim()
                        ? colors.text
                        : colors.subtext,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {pinnedComment.trim() || 'Write a first pinned comment'}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.subtext}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, { borderBottomWidth: 0 }]}
              onPress={() => setSettingsSheetOpen(true)}
              activeOpacity={0.75}
            >
              <View
                style={[styles.rowIconBox, { backgroundColor: colors.surface }]}
              >
                <Ionicons
                  name="options-outline"
                  size={18}
                  color={colors.text}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  Advanced Settings
                </Text>
                <Text
                  style={[styles.rowValue, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {advancedSummary}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.subtext}
              />
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footerBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.borderStrong,
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}
        >
          {progressText ? (
            <View style={styles.footerProgressWrap}>
              <View style={styles.progressTop}>
                <Text
                  style={[styles.progressMsg, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {progressText}
                </Text>
                <Text style={styles.progressPct}>{publishPercent}%</Text>
              </View>
              <View
                style={[
                  styles.progressBarBg,
                  { backgroundColor: colors.surface },
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${publishPercent}%` },
                  ]}
                />
              </View>
            </View>
          ) : (
            <View style={styles.readinessRow}>
              {[
                { label: 'Video', ok: videoReady },
                { label: 'Title', ok: titleReady },
                { label: 'Thumbnail', ok: thumbReady },
              ].map((step) => (
                <View key={step.label} style={styles.readinessItem}>
                  <Ionicons
                    name={step.ok ? 'checkmark-circle' : 'ellipse-outline'}
                    size={13}
                    color={step.ok ? colors.emerald : colors.subtext}
                  />
                  <Text
                    style={[
                      styles.readinessText,
                      { color: step.ok ? colors.text : colors.subtext },
                    ]}
                  >
                    {step.label}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.publishBtn,
              {
                backgroundColor: isFormReady
                  ? '#10b981'
                  : isDark
                    ? '#27272a'
                    : '#e2e8f0',
              },
              isBusy && { opacity: 0.75 },
            ]}
            onPress={() => void handlePublish()}
            disabled={isBusy}
            activeOpacity={0.85}
          >
            {publishing ? (
              <View style={styles.publishBtnRow}>
                <ActivityIndicator size="small" color="#ffffff" />
                <Text style={[styles.publishBtnText, { color: '#ffffff' }]}>
                  Uploading {publishPercent}%
                </Text>
              </View>
            ) : (
              <Text
                style={[
                  styles.publishBtnText,
                  {
                    color: isFormReady ? '#ffffff' : colors.subtext,
                  },
                ]}
              >
                {scheduleOption === 'now' ? 'Publish Video' : 'Schedule Video'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* THUMBNAIL STUDIO SHEET */}
      <Modal
        visible={thumbSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setThumbSheetOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setThumbSheetOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 14,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Edit Thumbnail
                </Text>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  {abTestEnabled
                    ? `Editing Variant ${activeThumbVariant}`
                    : thumbMode === 'custom'
                      ? 'Custom 16:9 image selected'
                      : `Frame at ${formatTimeSec(selectedThumbSec)}`}
                </Text>
              </View>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <TouchableOpacity
                  style={[
                    styles.abTogglePill,
                    {
                      backgroundColor: abTestEnabled
                        ? colors.emeraldSoft
                        : colors.surface,
                    },
                  ]}
                  onPress={() => setAbTestEnabled((v) => !v)}
                >
                  <Text
                    style={[
                      styles.abToggleText,
                      {
                        color: abTestEnabled ? colors.emerald : colors.subtext,
                      },
                    ]}
                  >
                    A/B Test {abTestEnabled ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconCircleBtn,
                    { backgroundColor: colors.surface },
                  ]}
                  onPress={() => setThumbSheetOpen(false)}
                >
                  <Ionicons name="close" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {abTestEnabled && (
              <View style={styles.abVariantTabs}>
                {(['A', 'B'] as const).map((v) => {
                  const active = activeThumbVariant === v;
                  return (
                    <TouchableOpacity
                      key={v}
                      style={[
                        styles.abVariantBtn,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                        },
                      ]}
                      onPress={() => setActiveThumbVariant(v)}
                    >
                      <Text
                        style={[
                          styles.abVariantText,
                          { color: active ? colors.accentText : colors.text },
                        ]}
                      >
                        Variant {v}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <ThumbFrameLiveBox
              videoUri={mediaUri}
              seekSec={selectedThumbSec}
              imageUri={activeSheetPreviewImage}
              useLiveVideo={
                activeThumbVariant === 'A'
                  ? thumbMode !== 'custom'
                  : !variantBUri
              }
              extracting={extractingFrame || savingThumb}
              snapshotRef={snapshotRef}
            />

            {mediaUri ? (
              <View style={styles.filmstripSection}>
                <View style={styles.filmstripHeaderRow}>
                  <Text style={[styles.fieldLabel, { color: colors.subtext }]}>
                    DRAG TO CHOOSE FRAME
                  </Text>
                  <Text style={[styles.filmstripClock, { color: colors.text }]}>
                    {formatTimeSec(selectedThumbSec)} /{' '}
                    {formatTimeSec(videoDurationSec)}
                  </Text>
                </View>

                <View
                  style={styles.filmstripContainer}
                  onLayout={(e) => {
                    if (e.nativeEvent.layout.width > 0) {
                      filmstripWidthRef.current = e.nativeEvent.layout.width;
                    }
                  }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) => {
                    setThumbMode('video');
                    setIsDraggingThumb(true);
                    updateFilmstripScrub(e.nativeEvent.locationX);
                  }}
                  onResponderMove={(e) => {
                    updateFilmstripScrub(e.nativeEvent.locationX);
                  }}
                  onResponderRelease={() => {
                    setIsDraggingThumb(false);
                    const dur = videoDurationSec > 0 ? videoDurationSec : 12;
                    void captureFrameFromVideo(mediaUri, {
                      switchMode: true,
                      seekSec: thumbRatioRef.current * dur,
                    });
                  }}
                  onResponderTerminate={() => {
                    setIsDraggingThumb(false);
                  }}
                >
                  <View style={styles.filmstripRow} pointerEvents="none">
                    {FILMSTRIP_RATIOS.map((ratio, idx) => {
                      const frame = filmstripFrames[idx];
                      return (
                        <View key={ratio} style={styles.filmstripTile}>
                          {frame?.uri ? (
                            <Image
                              source={{ uri: frame.uri }}
                              style={styles.filmstripTileImg}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.filmstripPlaceholder}>
                              {loadingFilmstrip && idx === 0 ? (
                                <ActivityIndicator
                                  size="small"
                                  color="#71717a"
                                />
                              ) : null}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>

                  <View
                    pointerEvents="none"
                    style={[
                      styles.filmstripSelectorBox,
                      {
                        left: `${Math.min(84, Math.max(0, Math.round(thumbScrubRatio * 84)))}%`,
                        borderColor: isDraggingThumb ? '#10b981' : '#ffffff',
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.thumbSheetFooter}>
              <TouchableOpacity
                style={[
                  styles.customThumbBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderStrong,
                  },
                ]}
                onPress={pickCustomThumbnail}
                activeOpacity={0.8}
              >
                <Ionicons name="image-outline" size={17} color={colors.text} />
                <Text style={[styles.customThumbText, { color: colors.text }]}>
                  Custom
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.applyThumbBtn,
                  { backgroundColor: colors.accent },
                ]}
                onPress={async () => {
                  if (
                    mediaUri &&
                    thumbMode !== 'custom' &&
                    activeThumbVariant === 'A'
                  ) {
                    await captureFrameFromVideo(mediaUri, {
                      seekSec: selectedThumbSec,
                      commitAndSave: true,
                      fallbackUri: resolvedCoverImage,
                      silent: true,
                    });
                  }
                  setThumbSheetOpen(false);
                }}
                disabled={savingThumb}
              >
                {savingThumb ? (
                  <ActivityIndicator color={colors.accentText} />
                ) : (
                  <Text
                    style={[
                      styles.sheetPrimaryBtnText,
                      { color: colors.accentText },
                    ]}
                  >
                    Done
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* TITLE ENHANCER MODAL */}
      <Modal
        visible={titleEnhancerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTitleEnhancerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setTitleEnhancerOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              style={[
                styles.sheetTitle,
                { color: colors.text, marginBottom: 10 },
              ]}
            >
              Catchy Title Ideas
            </Text>
            {titleSuggestions.map((idea) => (
              <TouchableOpacity
                key={idea}
                style={[
                  styles.optionSheetRow,
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => {
                  setTitle(idea.slice(0, 100));
                  setTitleEnhancerOpen(false);
                }}
              >
                <Ionicons name="sparkles" size={16} color={colors.emerald} />
                <Text
                  style={[
                    styles.rowValue,
                    { color: colors.text, flex: 1, marginLeft: 10 },
                  ]}
                >
                  {idea}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* LIVE WATCH FEED PREVIEW MODAL */}
      <Modal
        visible={feedPreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFeedPreviewOpen(false)}
      >
        <View style={styles.previewBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setFeedPreviewOpen(false)}
          />
          <View style={[styles.previewCard, { backgroundColor: colors.card }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                Watch Feed Preview
              </Text>
              <TouchableOpacity onPress={() => setFeedPreviewOpen(false)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.previewThumbBox}>
              {resolvedCoverImage ? (
                <Image
                  source={{ uri: resolvedCoverImage }}
                  style={styles.thumbPreviewImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.emptyThumbBox}>
                  <Ionicons name="videocam-outline" size={28} color="#71717a" />
                </View>
              )}
              {paidPromotion && (
                <View style={styles.promoPreviewBadge}>
                  <Text style={styles.previewDurText}>
                    Includes paid promotion
                  </Text>
                </View>
              )}
              <View style={styles.previewDurBadge}>
                <Text style={styles.previewDurText}>
                  {videoDurationSec > 0
                    ? formatTimeSec(videoDurationSec)
                    : '0:00'}
                </Text>
              </View>
            </View>

            <View style={styles.previewMetaRow}>
              <View
                style={[
                  styles.previewAvatar,
                  { backgroundColor: colors.accent },
                ]}
              >
                <Text style={{ color: colors.accentText, fontWeight: '800' }}>
                  C
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.previewTitle, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {title.trim() || 'Your video title will appear here'}
                </Text>
                <Text style={[styles.previewSub, { color: colors.subtext }]}>
                  You · Just now{category ? ` · ${category}` : ''}
                  {locationText.trim() ? ` · ${locationText.trim()}` : ''}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* VISIBILITY SHEET */}
      <Modal
        visible={visibilitySheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setVisibilitySheetOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setVisibilitySheetOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              style={[
                styles.sheetTitle,
                { color: colors.text, marginBottom: 12 },
              ]}
            >
              Set Visibility
            </Text>
            {VISIBILITY_OPTIONS.map((opt) => {
              const active = visibility === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.optionSheetRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    setVisibility(opt.value);
                    setVisibilitySheetOpen(false);
                  }}
                >
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={active ? colors.emerald : colors.subtext}
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.rowValue, { color: colors.text }]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                      {opt.shortDesc}
                    </Text>
                  </View>
                  {active && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.emerald}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* CATEGORY & PLAYLIST SHEET */}
      <Modal
        visible={categoryPlaylistSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCategoryPlaylistSheetOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setCategoryPlaylistSheetOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              style={[
                styles.sheetTitle,
                { color: colors.text, marginBottom: 12 },
              ]}
            >
              Category & Playlist
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.subtext }]}>
              CATEGORY (OPTIONAL)
            </Text>
            <View style={styles.chipWrapRow}>
              <TouchableOpacity
                style={[
                  styles.selectChip,
                  {
                    backgroundColor: !category ? colors.accent : colors.surface,
                  },
                ]}
                onPress={() => setCategory('')}
              >
                <Text
                  style={[
                    styles.selectChipText,
                    { color: !category ? colors.accentText : colors.text },
                  ]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {VIDEO_CATEGORIES.map((cat) => {
                const active = category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.selectChip,
                      {
                        backgroundColor: active
                          ? colors.accent
                          : colors.surface,
                      },
                    ]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text
                      style={[
                        styles.selectChipText,
                        { color: active ? colors.accentText : colors.text },
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.subtext, marginTop: 14 },
              ]}
            >
              PLAYLIST / SERIES (OPTIONAL)
            </Text>
            <TextInput
              style={[
                styles.sheetInput,
                {
                  backgroundColor: colors.surface,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              value={playlistName}
              onChangeText={setPlaylistName}
              placeholder="e.g. Tech Reviews 2026"
              placeholderTextColor={colors.subtext}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.smartTagsScroll}
            >
              {SUGGESTED_PLAYLISTS.map((pl) => (
                <TouchableOpacity
                  key={pl}
                  style={[
                    styles.smartTagPill,
                    { backgroundColor: colors.surface },
                  ]}
                  onPress={() => setPlaylistName(pl)}
                >
                  <Text style={[styles.smartTagText, { color: colors.text }]}>
                    {pl}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.sheetPrimaryBtn,
                { backgroundColor: colors.accent, marginTop: 16 },
              ]}
              onPress={() => setCategoryPlaylistSheetOpen(false)}
            >
              <Text
                style={[
                  styles.sheetPrimaryBtnText,
                  { color: colors.accentText },
                ]}
              >
                Done
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SCHEDULE & PREMIERE SHEET */}
      <Modal
        visible={scheduleSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setScheduleSheetOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setScheduleSheetOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              style={[
                styles.sheetTitle,
                { color: colors.text, marginBottom: 12 },
              ]}
            >
              Publish Schedule
            </Text>

            {SCHEDULE_PRESETS.map((opt) => {
              const active = scheduleOption === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.optionSheetRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    setScheduleOption(opt.value);
                    if (opt.value === 'now') setIsPremiere(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowValue, { color: colors.text }]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                      {opt.sub}
                    </Text>
                  </View>
                  {active && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.emerald}
                    />
                  )}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[
                styles.optionSheetRow,
                { borderBottomColor: colors.border },
              ]}
              onPress={() => {
                setScheduleOption('custom');
                setNativePickerMode('date');
              }}
            >
              <Ionicons
                name="calendar-number-outline"
                size={20}
                color={
                  scheduleOption === 'custom' ? colors.emerald : colors.subtext
                }
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.rowValue, { color: colors.text }]}>
                  Custom Date & Time
                </Text>
                <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                  {scheduleOption === 'custom'
                    ? formatScheduleDateTime(customScheduleDate)
                    : 'Pick exact date and time'}
                </Text>
              </View>
              {scheduleOption === 'custom' ? (
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.emerald}
                />
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              )}
            </TouchableOpacity>

            {scheduleOption !== 'now' && (
              <View style={[styles.optionSheetRow, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowValue, { color: colors.text }]}>
                    Set as Premiere
                  </Text>
                  <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                    2-minute countdown & live chat before launch
                  </Text>
                </View>
                <Switch
                  value={isPremiere}
                  onValueChange={setIsPremiere}
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: '#10b981',
                  }}
                  thumbColor="#ffffff"
                />
              </View>
            )}

            {nativePickerMode && (
              <DateTimePicker
                value={customScheduleDate}
                mode={nativePickerMode}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={new Date()}
                onChange={(event, picked) => {
                  if (event.type === 'dismissed') {
                    setNativePickerMode(null);
                    return;
                  }
                  if (picked) {
                    const updated = new Date(customScheduleDate);
                    if (nativePickerMode === 'date') {
                      updated.setFullYear(
                        picked.getFullYear(),
                        picked.getMonth(),
                        picked.getDate()
                      );
                      setCustomScheduleDate(updated);
                      setNativePickerMode('time');
                    } else {
                      updated.setHours(
                        picked.getHours(),
                        picked.getMinutes(),
                        0,
                        0
                      );
                      setCustomScheduleDate(updated);
                      setScheduleOption('custom');
                      setNativePickerMode(null);
                    }
                  }
                }}
              />
            )}

            <TouchableOpacity
              style={[
                styles.sheetPrimaryBtn,
                { backgroundColor: colors.accent, marginTop: 10 },
              ]}
              onPress={() => setScheduleSheetOpen(false)}
            >
              <Text
                style={[
                  styles.sheetPrimaryBtnText,
                  { color: colors.accentText },
                ]}
              >
                Done
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* LOCATION & COLLABORATORS SHEET */}
      <Modal
        visible={locationCollabSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationCollabSheetOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setLocationCollabSheetOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              style={[
                styles.sheetTitle,
                { color: colors.text, marginBottom: 12 },
              ]}
            >
              Location & Collaborators
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.subtext }]}>
              LOCATION (OPTIONAL)
            </Text>
            <TextInput
              style={[
                styles.sheetInput,
                {
                  backgroundColor: colors.surface,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              value={locationText}
              onChangeText={setLocationText}
              placeholder="e.g. Jaipur, India"
              placeholderTextColor={colors.subtext}
            />

            <Text
              style={[
                styles.fieldLabel,
                { color: colors.subtext, marginTop: 14 },
              ]}
            >
              TAG COLLABORATORS (@USERNAME)
            </Text>
            <TextInput
              style={[
                styles.sheetInput,
                {
                  backgroundColor: colors.surface,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              value={collaboratorsText}
              onChangeText={setCollaboratorsText}
              placeholder="@creator1, @creator2"
              placeholderTextColor={colors.subtext}
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[
                styles.sheetPrimaryBtn,
                { backgroundColor: colors.accent, marginTop: 16 },
              ]}
              onPress={() => setLocationCollabSheetOpen(false)}
            >
              <Text
                style={[
                  styles.sheetPrimaryBtnText,
                  { color: colors.accentText },
                ]}
              >
                Save
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* PRE-SET PINNED COMMENT SHEET */}
      <Modal
        visible={pinnedCommentSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPinnedCommentSheetOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setPinnedCommentSheetOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              style={[
                styles.sheetTitle,
                { color: colors.text, marginBottom: 6 },
              ]}
            >
              Pre-Set Pinned Comment
            </Text>
            <Text
              style={[
                styles.rowLabel,
                { color: colors.subtext, marginBottom: 12 },
              ]}
            >
              Automatically pinned as the first comment when your video goes
              live.
            </Text>

            <TextInput
              style={[
                styles.sheetInput,
                {
                  height: 90,
                  textAlignVertical: 'top',
                  paddingTop: 12,
                  backgroundColor: colors.surface,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              value={pinnedComment}
              onChangeText={setPinnedComment}
              placeholder="Ask viewers a question or drop a link..."
              placeholderTextColor={colors.subtext}
              multiline
            />

            <TouchableOpacity
              style={[
                styles.sheetPrimaryBtn,
                { backgroundColor: colors.accent, marginTop: 16 },
              ]}
              onPress={() => setPinnedCommentSheetOpen(false)}
            >
              <Text
                style={[
                  styles.sheetPrimaryBtnText,
                  { color: colors.accentText },
                ]}
              >
                Save Pinned Comment
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ADVANCED SETTINGS SHEET */}
      <Modal
        visible={settingsSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsSheetOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSettingsSheetOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                maxHeight: '82%',
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              style={[
                styles.sheetTitle,
                { color: colors.text, marginBottom: 10 },
              ]}
            >
              Advanced Settings
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                {
                  label: 'Allow Comments',
                  sub: 'Viewers can post replies',
                  val: allowComments,
                  set: setAllowComments,
                },
                {
                  label: 'Enable Monetization',
                  sub: 'Earn from eligible Watch feed ads',
                  val: monetizeContent,
                  set: setMonetizeContent,
                },
                {
                  label: 'Auto-Captions / Subtitles',
                  sub: 'Generate captions automatically',
                  val: autoCaptions,
                  set: setAutoCaptions,
                },
                {
                  label: 'Includes Paid Promotion',
                  sub: 'Shows sponsored disclosure badge',
                  val: paidPromotion,
                  set: setPaidPromotion,
                },
                {
                  label: 'Allow Offline Save',
                  sub: 'Let viewers save for offline viewing',
                  val: allowDownloads,
                  set: setAllowDownloads,
                },
                {
                  label: 'Show View Count',
                  sub: 'Display total views publicly',
                  val: showViewsCount,
                  set: setShowViewsCount,
                },
                {
                  label: 'Show Like Count',
                  sub: 'Display total likes publicly',
                  val: showLikesCount,
                  set: setShowLikesCount,
                },
                {
                  label: 'Age-Restricted (18+)',
                  sub: 'Limit viewing to adult audiences',
                  val: ageRestricted,
                  set: (v: boolean) => {
                    setAgeRestricted(v);
                    if (v) setMadeForKids(false);
                  },
                },
                {
                  label: 'Made for Kids',
                  sub: 'Family-friendly content compliance',
                  val: madeForKids,
                  set: (v: boolean) => {
                    setMadeForKids(v);
                    if (v) setAgeRestricted(false);
                  },
                },
              ].map((item) => (
                <View
                  key={item.label}
                  style={[
                    styles.optionSheetRow,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.rowValue, { color: colors.text }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                      {item.sub}
                    </Text>
                  </View>
                  <Switch
                    value={item.val}
                    onValueChange={item.set}
                    trackColor={{
                      false: colors.switchTrackFalse,
                      true: '#10b981',
                    }}
                    thumbColor="#ffffff"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerSideLeft: { width: 96, alignItems: 'flex-start' },
  headerSideRight: {
    width: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  iconCircleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  draftPillBtn: {
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftPillText: { fontSize: 12.5, fontWeight: '700' },
  scrollBody: { paddingBottom: 24 },
  stageContainer: { width: '100%' },
  stageBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
    overflow: 'hidden',
  },
  playerWrap: { width: '100%', height: '100%', backgroundColor: '#09090b' },
  videoSurface: { width: '100%', height: '100%' },
  posterLayer: { ...StyleSheet.absoluteFill, zIndex: 2 },
  backdropPressLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 28,
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPlayBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomProgressWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 7,
    backgroundColor: 'rgba(9, 9, 11, 0.78)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scrubTouchArea: { flex: 1, height: 18, justifyContent: 'center' },
  progressTrack: {
    width: '100%',
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#10b981' },
  timeText: { color: '#ffffff', fontSize: 10.5, fontWeight: '700' },
  emptyHeroStage: {
    flex: 1,
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 8,
    borderRadius: 18,
    backgroundColor: '#141417',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 5,
  },
  emptyHeroIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyHeroTitle: { color: '#ffffff', fontSize: 15.5, fontWeight: '800' },
  emptyHeroDesc: { color: '#a1a1aa', fontSize: 12 },
  chooseHeroPill: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 999,
  },
  chooseHeroPillText: { color: '#09090b', fontSize: 12.5, fontWeight: '800' },
  emptyDashedBox: {
    flex: 1,
    margin: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 5,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyDesc: { fontSize: 12 },
  chooseVideoPill: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
  },
  chooseVideoPillText: { fontSize: 12.5, fontWeight: '800' },
  floatingThumbBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(9, 9, 11, 0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  floatingThumbText: { color: '#ffffff', fontSize: 11.5, fontWeight: '700' },
  floatingRightGroup: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  specsBadge: {
    backgroundColor: 'rgba(9, 9, 11, 0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
  },
  specsBadgeText: { color: '#ffffff', fontSize: 10.5, fontWeight: '700' },
  floatingRemoveBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(9, 9, 11, 0.76)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBarCard: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginTop: 6,
    padding: 8,
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  sourceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
  },
  sourceChipText: { fontSize: 12, fontWeight: '700' },
  urlInlineBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  urlInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13.5,
  },
  urlApplyBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlApplyBtnText: { fontSize: 13, fontWeight: '700' },
  editorBlockCard: {
    marginHorizontal: 14,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  editorBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  fieldLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.7 },
  titleMetaRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  enhanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 999,
  },
  enhanceBtnText: { fontSize: 11, fontWeight: '800', color: '#10b981' },
  charCount: { fontSize: 11, fontWeight: '600' },
  titleInputBox: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    lineHeight: 22,
  },
  titleInput: {
    fontSize: 17,
    fontWeight: '700',
    paddingVertical: 6,
    lineHeight: 23,
  },
  thinDivider: { height: 1, marginVertical: 12 },
  chapterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chapterBtnText: { fontSize: 11, fontWeight: '700' },
  descInputBox: {
    fontSize: 14,
    minHeight: 78,
    textAlignVertical: 'top',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    lineHeight: 20,
  },
  descInput: {
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
    paddingVertical: 4,
    lineHeight: 20,
  },
  tagsInputBox: {
    fontSize: 13.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  tagsInput: { fontSize: 14, paddingVertical: 6 },
  smartTagsScroll: { gap: 6, paddingTop: 8 },
  smartTagPill: {
    paddingHorizontal: 11,
    paddingVertical: 5.5,
    borderRadius: 999,
  },
  smartTagText: { fontSize: 11.5, fontWeight: '700' },
  sectionGroupTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginHorizontal: 18,
    marginTop: 16,
    marginBottom: 8,
  },
  rowsCard: {
    marginHorizontal: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  rowsSection: { paddingHorizontal: 16 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 11.5, fontWeight: '500' },
  rowValue: { fontSize: 14, fontWeight: '700', marginTop: 1 },
  footerBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 10,
  },
  readinessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  readinessItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readinessText: { fontSize: 11.5, fontWeight: '700' },
  footerProgressWrap: { gap: 5 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between' },
  progressMsg: { fontSize: 12, fontWeight: '600', flex: 1 },
  progressPct: { fontSize: 12, fontWeight: '800', color: '#10b981' },
  progressBarBg: { height: 5, borderRadius: 999, overflow: 'hidden' },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 999,
  },
  publishBtn: {
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  publishBtnText: { fontSize: 15, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  optionSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  sheetInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 14,
    marginTop: 6,
  },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  selectChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  selectChipText: { fontSize: 12.5, fontWeight: '700' },
  abTogglePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  abToggleText: { fontSize: 11, fontWeight: '800' },
  abVariantTabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  abVariantBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abVariantText: { fontSize: 12.5, fontWeight: '700' },
  thumbSheetPreviewFrame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#09090b',
    marginBottom: 14,
  },
  thumbSnapshotInner: { width: '100%', height: '100%' },
  thumbPreviewImage: { width: '100%', height: '100%' },
  emptyThumbBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyThumbText: { color: '#a1a1aa', fontSize: 12.5, fontWeight: '600' },
  thumbSpinnerOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(9, 9, 11, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filmstripSection: { marginBottom: 16, gap: 8 },
  filmstripHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filmstripClock: { fontSize: 11.5, fontWeight: '700' },
  filmstripContainer: {
    width: '100%',
    height: 54,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#18181b',
    position: 'relative',
  },
  filmstripRow: { flex: 1, flexDirection: 'row' },
  filmstripTile: {
    flex: 1,
    height: '100%',
    borderRightWidth: 0.5,
    borderRightColor: 'rgba(255,255,255,0.12)',
  },
  filmstripTileImg: { width: '100%', height: '100%' },
  filmstripPlaceholder: {
    flex: 1,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filmstripSelectorBox: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '16%',
    borderWidth: 2.5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  thumbSheetFooter: { flexDirection: 'row', gap: 10 },
  customThumbBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  customThumbText: { fontSize: 13.5, fontWeight: '700' },
  applyThumbBtn: {
    flex: 1.5,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryBtn: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryBtnText: { fontSize: 14.5, fontWeight: '800' },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.6)',
    justifyContent: 'center',
    padding: 18,
  },
  previewCard: { borderRadius: 20, padding: 16 },
  previewThumbBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#09090b',
    position: 'relative',
  },
  promoPreviewBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  previewDurBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  previewDurText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  previewMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
  },
  previewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  previewSub: { fontSize: 12, marginTop: 3 },
});