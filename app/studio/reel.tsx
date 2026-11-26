import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  FlatList,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
  Platform,
  Animated,
  DeviceEventEmitter,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TouchableOpacity } from '@/components/ui/Touchable';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  CATEGORIES,
  DEFAULT_COVER,
  MediaCategory,
  deleteStudioDraft,
  getStudioDrafts,
  isLikelyImageUri,
  parseTags,
  publishCreatorItem,
  saveStudioDraft,
} from '../../lib/creatorStudio';
import {
  searchPublicMusic,
  TRENDING_REELS_TRACKS,
  MUSIC_GENRES,
  MusicTrack,
} from '../../lib/musicService';
import { RecordProgressRing } from '@/components/studio/RecordProgressRing';
import { ReelCoverPicker, ReelCoverSelection } from '@/components/studio/ReelCoverPicker';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

type StudioStage = 'camera' | 'preview' | 'share';
type ReelVisibility = 'public' | 'followers' | 'private';
type CountdownTimer = 0 | 3 | 10;
type SpeedOption = 0.5 | 1 | 2;

const QUICK_HASHTAGS = [
  '#reels',
  '#shorts',
  '#trending',
  '#viral',
  '#foryou',
  '#vibes',
  '#creator',
  '#explore',
];

const REEL_CATEGORIES: MediaCategory[] = [
  'Travel',
  'Music',
  'Tech',
  'Fitness',
  'Live',
];

const VISIBILITY_OPTIONS: {
  id: ReelVisibility;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  desc: string;
}[] = [
  { id: 'public', label: 'Public', icon: 'globe-outline', desc: 'Anyone can watch and share' },
  { id: 'followers', label: 'Followers', icon: 'people-outline', desc: 'Only your followers' },
  { id: 'private', label: 'Only Me', icon: 'lock-closed-outline', desc: 'Visible only to you' },
];

/**
 * Fullscreen Video Preview Player with loop & volume
 */
function ReelVideoPlayer({
  uri,
  muted,
  volume = 1,
  onDuration,
}: {
  uri: string;
  muted: boolean;
  volume?: number;
  /** Called with the real video length (sec) once the source loads. */
  onDuration?: (durationSec: number) => void;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = muted;
    p.volume = volume;
    p.play();
  });

  useEffect(() => {
    if (!onDuration) return;
    const sub = player.addListener('sourceLoad', ({ duration }) => {
      if (Number.isFinite(duration) && duration > 0) onDuration(duration);
    });
    return () => sub.remove();
  }, [player, onDuration]);

  useEffect(() => {
    try {
      player.loop = true;
      player.muted = muted;
      player.volume = volume;
      if (uri) {
        player.replaceAsync?.(uri);
        player.play();
      }
    } catch {
      // ignore preview race
    }
  }, [player, uri, muted, volume]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

/**
 * Invisible Audio Preview Player for listening to Spotify / public tracks in the modal
 */
function TrackAudioStreamer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });

  useEffect(() => {
    try {
      if (uri) {
        player.replaceAsync?.(uri);
        player.play();
      }
    } catch {
      // ignore
    }
  }, [player, uri]);

  return (
    <VideoView
      player={player}
      style={styles.invisibleAudio}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

export default function VibeShortsReelScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const { draftId, remixOfId, remixAuthor, remixTitle, remixThumbnail } =
    useLocalSearchParams<{
      draftId?: string;
      remixOfId?: string;
      remixAuthor?: string;
      remixTitle?: string;
      remixThumbnail?: string;
    }>();
  const remixHandleClean = useMemo(() => {
    const raw = typeof remixAuthor === 'string' ? remixAuthor.trim() : '';
    if (!raw) return '';
    return raw.startsWith('@') ? raw : `@${raw}`;
  }, [remixAuthor]);

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const themeColors = useMemo(
    () => ({
      bg: isDark ? '#09090b' : '#f4f4f5',
      card: isDark ? '#141416' : '#ffffff',
      surface: isDark ? '#18181b' : '#f1f5f9',
      inputBg: isDark ? '#09090b' : '#f8fafc',
      surfaceAlt: isDark ? '#27272a' : '#e4e4e7',
      border: isDark ? '#27272a' : '#e2e8f0',
      text: isDark ? '#ffffff' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#64748b',
      accent: isDark ? '#ffffff' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
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

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(THEME_STORAGE_KEY)
        .then((saved) => {
          if (saved === 'light' || saved === 'dark' || saved === 'system') {
            setThemeMode(saved);
          }
        })
        .catch(() => {});
    }, [])
  );

  // Current stage: Camera -> Preview/Edit -> Share/Publish
  const [stage, setStage] = useState<StudioStage>('camera');

  // Camera & Device permissions
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [enableTorch, setEnableTorch] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);

  // Recording State & Durations
  const [isRecording, setIsRecording] = useState(false);
  const [recordedDurationSec, setRecordedDurationSec] = useState(0);
  const recordingTimerRef = useRef<any>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);

  // Active Music Track (Spotify / Public)
  const [selectedMusic, setSelectedMusic] = useState<MusicTrack | null>(null);

  // Duration Limit:
  // With Music: max 60s. Options: 15s, 30s, 60s.
  // Without Music: max 180s (3m). Options: 15s, 30s, 60s, 180s (3m).
  const [targetDurationSec, setTargetDurationSec] = useState<number>(60);

  // Floating Camera Controls
  const [speed, setSpeed] = useState<SpeedOption>(1);
  const [countdownTimer, setCountdownTimer] = useState<CountdownTimer>(0);
  const [activeCountdown, setActiveCountdown] = useState<number | null>(null);
  const [beautifyFilter, setBeautifyFilter] = useState(false);
  const [gridEnabled, setGridEnabled] = useState(false);

  // Video & Cover Assets
  const [mediaUri, setMediaUri] = useState('');
  const [mediaDurationSec, setMediaDurationSec] = useState<number>(0);
  const [coverUri, setCoverUri] = useState('');
  // Frame time (sec) when the cover comes from the video; null for a custom image.
  const [coverTimeSec, setCoverTimeSec] = useState<number | null>(null);
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);

  // Audio Mixer Volumes (0 to 1)
  const [voiceVolume, setVoiceVolume] = useState<number>(1);
  const [musicVolume, setMusicVolume] = useState<number>(0.8);
  const [isMixerOpen, setIsMixerOpen] = useState(false);

  // Music Picker Modal
  const [isMusicModalOpen, setIsMusicModalOpen] = useState(false);
  const [musicSearchQuery, setMusicSearchQuery] = useState('');
  const [musicGenre, setMusicGenre] = useState('All');
  const [musicResults, setMusicResults] = useState<MusicTrack[]>(TRENDING_REELS_TRACKS);
  const [isSearchingMusic, setIsSearchingMusic] = useState(false);
  const [playingPreviewTrackId, setPlayingPreviewTrackId] = useState<string | null>(null);

  // Reel Publishing Details
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tagsText, setTagsText] = useState('#reels #shorts #trending');
  const [category, setCategory] = useState<MediaCategory>('Travel');
  const [visibility, setVisibility] = useState<ReelVisibility>('public');
  const [allowComments, setAllowComments] = useState(true);
  const [allowRemix, setAllowRemix] = useState(true);
  const [highQualityUpload, setHighQualityUpload] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [reelUrlInput, setReelUrlInput] = useState('');

  // Load existing draft if draftId is supplied
  useEffect(() => {
    if (!draftId) return;
    getStudioDrafts().then((items) => {
      const found = items.find((d) => d.id === draftId);
      if (!found) return;
      setTitle(found.title);
      setCategory(found.category);
      setCaption(found.description);
      setTagsText(found.tagsText || '#reels #shorts');
      setMediaUri(found.mediaUri);
      setCoverUri(found.coverUri);
      setCoverTimeSec(found.coverTimeSec ?? null);
      setMediaDurationSec(found.mediaDurationSec ?? 0);
      if (found.mediaUri) {
        setStage('preview');
      }
    });
  }, [draftId]);

  // Toast Notification auto-dismiss
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  // Sync duration rule whenever music selection changes:
  // With Music -> Max 60s
  // Without Music -> Max 180s (3m)
  useEffect(() => {
    if (selectedMusic) {
      if (targetDurationSec > 60) {
        setTargetDurationSec(60);
      }
      if (mediaDurationSec > 60) {
        setMediaDurationSec(60);
        showToast('Music added! Reel duration limited to 60s.');
      } else {
        showToast(`Sound added: "${selectedMusic.title}" (Max 60s)`);
      }
    } else {
      showToast('Original sound active (Videos allowed up to 3m).');
    }
  }, [selectedMusic]);

  // Request permissions on mount
  useEffect(() => {
    if (!cameraPermission?.granted) {
      requestCameraPermission();
    }
    if (!micPermission?.granted) {
      requestMicPermission();
    }
  }, [cameraPermission, micPermission]);

  // Flip Camera
  const handleFlipCamera = () => {
    setFacing((prev) => (prev === 'front' ? 'back' : 'front'));
  };

  // Toggle Torch
  const handleToggleTorch = () => {
    setEnableTorch((prev) => !prev);
  };

  // Duration Options Cycling
  const handleCycleDuration = () => {
    if (selectedMusic) {
      // With Music: cycle 15s -> 30s -> 60s -> 15s
      if (targetDurationSec === 15) setTargetDurationSec(30);
      else if (targetDurationSec === 30) setTargetDurationSec(60);
      else setTargetDurationSec(15);
    } else {
      // Without Music: cycle 15s -> 30s -> 60s -> 180s (3m) -> 15s
      if (targetDurationSec === 15) setTargetDurationSec(30);
      else if (targetDurationSec === 30) setTargetDurationSec(60);
      else if (targetDurationSec === 60) setTargetDurationSec(180);
      else setTargetDurationSec(15);
    }
  };

  // Speed Cycling: 0.5x -> 1x -> 2x
  const handleCycleSpeed = () => {
    if (speed === 0.5) setSpeed(1);
    else if (speed === 1) setSpeed(2);
    else setSpeed(0.5);
  };

  // Timer Cycling: 0 (Off) -> 3s -> 10s -> 0
  const handleCycleTimer = () => {
    if (countdownTimer === 0) setCountdownTimer(3);
    else if (countdownTimer === 3) setCountdownTimer(10);
    else setCountdownTimer(0);
  };

  // Extract thumbnail from video
  const generateThumbnail = useCallback(async (videoUri: string) => {
    const cleanUri = videoUri.trim();
    if (!cleanUri) return;

    const tryExtract = async (sourceUri: string): Promise<string | null> => {
      for (const time of [500, 100, 0]) {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(sourceUri, {
            time,
            quality: 0.85,
          });
          if (uri) {
            setCoverUri(uri);
            setCoverTimeSec(time / 1000);
            return uri;
          }
        } catch {
          // retry with earlier frame timestamp
        }
      }
      return null;
    };

    const direct = await tryExtract(cleanUri);
    if (direct) return;

    if (cleanUri.startsWith('content://')) {
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (cacheDir) {
        const cachedVideo = `${cacheDir}thumb_src_${Date.now()}.mp4`;
        try {
          await FileSystem.copyAsync({ from: cleanUri, to: cachedVideo });
          await tryExtract(cachedVideo);
        } catch {
          // ignore
        } finally {
          void FileSystem.deleteAsync(cachedVideo, { idempotent: true }).catch(
            () => {}
          );
        }
      }
    }
  }, []);

  useEffect(() => {
    if (stage === 'share' && !coverUri.trim() && mediaUri.trim()) {
      void generateThumbnail(mediaUri);
    }
  }, [stage, coverUri, mediaUri, generateThumbnail]);

  // Pick Video From Gallery
  const handlePickFromGallery = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Needed', 'Please allow gallery access to pick a video.');
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });

      if (res.canceled || !res.assets?.[0]?.uri) return;

      const asset = res.assets[0];
      const rawDur =
        typeof asset.duration === 'number' && asset.duration > 0
          ? asset.duration > 1000
            ? asset.duration / 1000
            : asset.duration
          : 30;

      // Check user requirements:
      // With Music: max 60s.
      // Without Music: max 3 min (180s).
      let finalDur = Math.round(rawDur);

      if (selectedMusic && finalDur > 60) {
        Alert.alert(
          'Reels with Music Limit',
          `Reels with music are limited to 60 seconds. Your ${finalDur}s video has been trimmed to 60s.`,
          [{ text: 'OK' }]
        );
        finalDur = 60;
      } else if (!selectedMusic && finalDur > 180) {
        Alert.alert(
          'Reels 3-Minute Limit',
          `Reels without music can be up to 3 minutes (180s). Your video has been trimmed to 3 minutes.`,
          [{ text: 'OK' }]
        );
        finalDur = 180;
      }

      setMediaUri(asset.uri);
      setMediaDurationSec(finalDur);
      await generateThumbnail(asset.uri);
      setStage('preview');
    } catch (err: any) {
      Alert.alert('Gallery Error', err?.message || 'Unable to import video.');
    }
  }, [selectedMusic, generateThumbnail]);

  // Old drafts don't store the length; fill it from the player so the cover
  // picker's filmstrip covers the whole video. Known lengths are kept as-is.
  const handleVideoDuration = useCallback((durationSec: number) => {
    setMediaDurationSec((prev) => (prev > 0 ? prev : Math.round(durationSec)));
  }, []);

  // Open the Instagram-style cover picker (frame from video or custom photo)
  const handlePickCoverImage = useCallback(() => {
    setIsCoverPickerOpen(true);
  }, []);

  const handleCoverSelected = useCallback(
    (selection: ReelCoverSelection) => {
      setCoverUri(selection.uri);
      setCoverTimeSec(selection.timeSec);
      setIsCoverPickerOpen(false);
      showToast(
        selection.source === 'frame' ? 'Cover set from your video!' : 'Custom cover updated!'
      );
    },
    [showToast]
  );

  // Real Camera Video Recording Execution
  const executeRecording = async () => {
    if (!cameraRef.current || isRecording) return;

    try {
      setIsRecording(true);
      setRecordedDurationSec(0);

      // Start duration ticker
      let elapsed = 0;
      recordingTimerRef.current = setInterval(() => {
        elapsed += 1;
        setRecordedDurationSec(elapsed);

        // Auto-stop when reaching target duration
        if (elapsed >= targetDurationSec) {
          stopRecording();
        }
      }, 1000);

      const promise = cameraRef.current.recordAsync({
        maxDuration: targetDurationSec,
      });
      recordingPromiseRef.current = promise;
      const result = await promise;

      if (result?.uri) {
        setMediaUri(result.uri);
        setMediaDurationSec(elapsed || 5);
        await generateThumbnail(result.uri);
        setStage('preview');
      }
    } catch (err: any) {
      Alert.alert('Record Error', err?.message || 'Camera could not record video.');
    } finally {
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      recordingPromiseRef.current = null;
    }
  };

  // Trigger Record button with countdown support
  const handleRecordButtonPress = () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    if (countdownTimer > 0) {
      let count = countdownTimer;
      setActiveCountdown(count);
      const timer = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setActiveCountdown(count);
        } else {
          clearInterval(timer);
          setActiveCountdown(null);
          executeRecording();
        }
      }, 1000);
    } else {
      executeRecording();
    }
  };

  // Stop Recording
  const stopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    cameraRef.current?.stopRecording();
    setIsRecording(false);
  };

  // Search Music API
  const handleSearchMusic = useCallback(async (query: string, genre: string) => {
    setIsSearchingMusic(true);
    try {
      const results = await searchPublicMusic(query, genre);
      setMusicResults(results);
    } catch {
      setMusicResults(TRENDING_REELS_TRACKS);
    } finally {
      setIsSearchingMusic(false);
    }
  }, []);

  // Filter Music by genre chip
  const handleSelectGenre = (genre: string) => {
    setMusicGenre(genre);
    handleSearchMusic(musicSearchQuery, genre);
  };

  // Attach Track to Reel
  const handleAttachTrack = (track: MusicTrack) => {
    setSelectedMusic(track);
    setPlayingPreviewTrackId(null);
    setIsMusicModalOpen(false);
  };

  // Remove Track
  const handleRemoveTrack = () => {
    setSelectedMusic(null);
    setPlayingPreviewTrackId(null);
  };

  // Toggle Hashtag
  const handleToggleTag = (tag: string) => {
    const cleanTag = tag.trim().toLowerCase();
    const current = tagsText
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const exists = current.some((t) => t.toLowerCase() === cleanTag);
    if (exists) {
      setTagsText(current.filter((t) => t.toLowerCase() !== cleanTag).join(' '));
    } else {
      setTagsText([...current, tag].join(' '));
    }
  };

  // Save Reel to Drafts
  const handleSaveDraft = async () => {
    const cleanTitle = title.trim() || 'Untitled Vibe Short';
    await saveStudioDraft({
      id: draftId || `draft-${Date.now()}`,
      mode: 'reel',
      title: cleanTitle,
      category,
      description: caption.trim(),
      tagsText: tagsText.trim(),
      thumbnailMode: 'custom',
      musicTrackId: selectedMusic?.id || null,
      customAudioUri: selectedMusic?.previewUrl || '',
      mediaUri: mediaUri.trim(),
      coverUri: coverUri || '',
      coverTimeSec,
      mediaDurationSec,
      savedAt: 'Just now',
    });
    Alert.alert('Draft Saved', `"${cleanTitle}" has been saved to your drafts.`);
    router.back();
  };

  // Publish Reel to Supabase & Watch Feed
  const handlePublishReel = async () => {
    if (!title.trim()) {
      Alert.alert('Title Required', 'Please enter a title for your Reel.');
      return;
    }
    if (!mediaUri.trim()) {
      Alert.alert('Video Required', 'Please record or pick a video for your Reel.');
      return;
    }

    try {
      setPublishing(true);
      const musicLabel = selectedMusic
        ? `${selectedMusic.title} · ${selectedMusic.artist}`
        : 'Original Sound';

      let resolvedCoverUri = coverUri.trim();
      if (!resolvedCoverUri && mediaUri.trim()) {
        for (const time of [500, 100, 0]) {
          try {
            const thumb = await VideoThumbnails.getThumbnailAsync(mediaUri.trim(), {
              time,
              quality: 0.85,
            });
            if (thumb?.uri) {
              resolvedCoverUri = thumb.uri;
              setCoverUri(thumb.uri);
              break;
            }
          } catch {
            // continue fallback timestamps
          }
        }
      }

      const baseTags = parseTags(tagsText);
      const finalTags =
        remixHandleClean && !baseTags.includes('#remix')
          ? [...baseTags, '#remix']
          : baseTags;
      const remixMetaLine = remixHandleClean
        ? `[remix:${remixHandleClean}|${String(remixOfId || '').trim()}]`
        : '';
      const finalDescription = remixMetaLine
        ? `${remixMetaLine}${caption.trim() ? ` ${caption.trim()}` : ''}`
        : caption.trim();

      const published = await publishCreatorItem({
        mode: 'reel',
        title: title.trim(),
        description: finalDescription,
        category,
        tags: finalTags,
        thumbnailMode: 'custom',
        mediaUri: mediaUri.trim(),
        coverUri: resolvedCoverUri,
        visibility,
        musicTrack: musicLabel,
        customAudioUri: selectedMusic?.previewUrl || '',
        allowComments,
        monetize: false,
        totalSeconds: mediaDurationSec > 0 ? Math.round(mediaDurationSec) : undefined,
        onProgress: setProgressText,
      });

      if (draftId) {
        void deleteStudioDraft(draftId);
      }
      DeviceEventEmitter.emit('watch-media-created', published);

      Alert.alert('🎉 Reel Published!', 'Your Vibe Short is now live on VibeSphere Reels.', [
        { text: 'Done', onPress: () => router.back() },
        {
          text: 'Watch Reels',
          onPress: () => router.replace('/(tabs)/watch' as any),
        },
      ]);
    } catch (err: any) {
      Alert.alert('Publish Error', err?.message || 'Failed to upload and publish reel.');
    } finally {
      setPublishing(false);
      setProgressText('');
    }
  };

  // Playing track object for preview stream
  const activePreviewTrack = useMemo(() => {
    return (
      musicResults.find((t) => t.id === playingPreviewTrackId) ||
      TRENDING_REELS_TRACKS.find((t) => t.id === playingPreviewTrackId) ||
      null
    );
  }, [playingPreviewTrackId, musicResults]);

  // Format seconds to mm:ss
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* =========================================================================
          STAGE 1: INSTAGRAM REELS CAMERA SCREEN
         ========================================================================= */}
      {stage === 'camera' && (
        <View style={styles.fullscreen}>
          {cameraPermission?.granted ? (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              enableTorch={enableTorch}
              mute={isMicMuted}
              mode="video"
              videoQuality="1080p"
            />
          ) : (
            <View
              style={[
                styles.permissionFallback,
                { backgroundColor: themeColors.bg },
              ]}
            >
              <Ionicons
                name="camera-outline"
                size={48}
                color={themeColors.subtext}
              />
              <Text
                style={[styles.permissionTitle, { color: themeColors.text }]}
              >
                Camera Permission Required
              </Text>
              <Text
                style={[styles.permissionSub, { color: themeColors.subtext }]}
              >
                Allow camera and microphone access to record vertical Vibe Shorts.
              </Text>
              <TouchableOpacity
                style={styles.permissionBtn}
                onPress={() => {
                  requestCameraPermission();
                  requestMicPermission();
                }}
              >
                <Text style={styles.permissionBtnText}>Enable Access</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Grid Overlay if enabled */}
          {gridEnabled && (
            <View style={styles.gridOverlay} pointerEvents="none">
              <View style={styles.gridCol} />
              <View style={styles.gridCol} />
              <View style={styles.gridRow} />
              <View style={styles.gridRow} />
            </View>
          )}

          {/* Countdown Overlay (3... 2... 1...) */}
          {activeCountdown !== null && (
            <View style={styles.countdownCenterOverlay} pointerEvents="none">
              <Text style={styles.countdownNumber}>{activeCountdown}</Text>
            </View>
          )}

          {/* Remix Duet Reference Card */}
          {Boolean(remixHandleClean) && (
            <View style={styles.remixRefPill}>
              {typeof remixThumbnail === 'string' && remixThumbnail.trim() ? (
                <Image
                  source={{ uri: remixThumbnail.trim() }}
                  style={styles.remixRefThumb}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="repeat" size={16} color="#10b981" />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.remixRefLabel}>REMIXING</Text>
                <Text style={styles.remixRefTitle} numberOfLines={1}>
                  {remixHandleClean}
                  {typeof remixTitle === 'string' && remixTitle.trim()
                    ? ` · ${remixTitle.trim()}`
                    : ''}
                </Text>
              </View>
            </View>
          )}

          {/* Top Camera Bar */}
          <SafeAreaView style={styles.topCameraBar} edges={['top']}>
            <TouchableOpacity
              style={styles.iconCircleGlass}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <Feather name="x" size={20} color="#ffffff" />
            </TouchableOpacity>

            {/* Spotify / Music Selector Pill */}
            <TouchableOpacity
              style={[
                styles.musicSelectorPill,
                selectedMusic && styles.musicSelectorPillActive,
              ]}
              onPress={() => setIsMusicModalOpen(true)}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons
                name={selectedMusic ? 'music-note' : 'music-note-outline'}
                size={16}
                color={selectedMusic ? '#10b981' : '#ffffff'}
              />
              <Text style={styles.musicPillText} numberOfLines={1}>
                {selectedMusic
                  ? `${selectedMusic.title} · ${selectedMusic.artist}`
                  : 'Add Music'}
              </Text>
              {selectedMusic && (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    handleRemoveTrack();
                  }}
                  style={styles.removeMusicBtn}
                >
                  <Feather name="x" size={12} color="#ffffff" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <View style={styles.topRightIcons}>
              {/* Torch Toggle */}
              <TouchableOpacity
                style={[styles.iconCircleGlass, enableTorch && styles.iconCircleActive]}
                onPress={handleToggleTorch}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={enableTorch ? 'flash' : 'flash-outline'}
                  size={19}
                  color={enableTorch ? '#facc15' : '#ffffff'}
                />
              </TouchableOpacity>

              {/* Flip Camera */}
              <TouchableOpacity
                style={styles.iconCircleGlass}
                onPress={handleFlipCamera}
                activeOpacity={0.8}
              >
                <Ionicons name="camera-reverse-outline" size={21} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Right Floating Instagram Reel Dock */}
          <View style={styles.rightFloatDock}>
            {/* Music Trigger */}
            <TouchableOpacity
              style={[styles.dockIconItem, selectedMusic && styles.dockIconItemActive]}
              onPress={() => setIsMusicModalOpen(true)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="music" size={18} color="#ffffff" />
              <Text style={styles.dockIconLabel}>Music</Text>
            </TouchableOpacity>

            {/* Duration Mode (15s / 30s / 60s or 3m) */}
            <TouchableOpacity
              style={styles.dockIconItem}
              onPress={handleCycleDuration}
              activeOpacity={0.8}
            >
              <View style={styles.durationBadge}>
                <Text style={styles.durationBadgeText}>
                  {targetDurationSec >= 180 ? '3m' : `${targetDurationSec}s`}
                </Text>
              </View>
              <Text style={styles.dockIconLabel}>Length</Text>
            </TouchableOpacity>

            {/* Speed Toggle (0.5x, 1x, 2x) */}
            <TouchableOpacity
              style={styles.dockIconItem}
              onPress={handleCycleSpeed}
              activeOpacity={0.8}
            >
              <Text style={styles.speedText}>{speed}x</Text>
              <Text style={styles.dockIconLabel}>Speed</Text>
            </TouchableOpacity>

            {/* Timer Toggle (Off, 3s, 10s) */}
            <TouchableOpacity
              style={[styles.dockIconItem, countdownTimer > 0 && styles.dockIconItemActive]}
              onPress={handleCycleTimer}
              activeOpacity={0.8}
            >
              <Ionicons
                name={countdownTimer > 0 ? 'timer' : 'timer-outline'}
                size={18}
                color={countdownTimer > 0 ? '#10b981' : '#ffffff'}
              />
              <Text style={styles.dockIconLabel}>
                {countdownTimer > 0 ? `${countdownTimer}s` : 'Timer'}
              </Text>
            </TouchableOpacity>

            {/* Beauty / Glow Filter */}
            <TouchableOpacity
              style={[styles.dockIconItem, beautifyFilter && styles.dockIconItemActive]}
              onPress={() => setBeautifyFilter((v) => !v)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={beautifyFilter ? 'sparkles' : 'sparkles-outline'}
                size={18}
                color={beautifyFilter ? '#ec4899' : '#ffffff'}
              />
              <Text style={styles.dockIconLabel}>Glow</Text>
            </TouchableOpacity>

            {/* Grid Toggle */}
            <TouchableOpacity
              style={[styles.dockIconItem, gridEnabled && styles.dockIconItemActive]}
              onPress={() => setGridEnabled((v) => !v)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={gridEnabled ? 'grid' : 'grid-outline'}
                size={18}
                color={gridEnabled ? '#38bdf8' : '#ffffff'}
              />
              <Text style={styles.dockIconLabel}>Grid</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom Controls Bar */}
          <View
            style={[
              styles.bottomCameraDock,
              {
                paddingBottom:
                  Platform.OS === 'android'
                    ? Math.max(insets.bottom, 48) + 12
                    : Math.max(insets.bottom, 16) + 12,
              },
            ]}
          >
            {/* Gallery + URL Upload Buttons (Left) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                style={styles.galleryUploadBtn}
                onPress={handlePickFromGallery}
                activeOpacity={0.85}
              >
                <Ionicons name="images" size={22} color="#ffffff" />
                <Text style={styles.galleryBtnLabel}>Upload</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.galleryUploadBtn}
                onPress={() => {
                  setReelUrlInput('');
                  setUrlModalOpen(true);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="link" size={22} color="#ffffff" />
                <Text style={styles.galleryBtnLabel}>URL</Text>
              </TouchableOpacity>
            </View>

            {/* Giant Instagram Reel Record Button (Center) */}
            <TouchableOpacity
              style={[styles.recordBtnOuter, isRecording && styles.recordBtnOuterActive]}
              onPress={handleRecordButtonPress}
              activeOpacity={0.88}
            >
              <RecordProgressRing
                active={isRecording}
                durationSec={targetDurationSec}
                style={styles.recordProgressRing}
              />
              <View
                style={[
                  styles.recordBtnInner,
                  isRecording && styles.recordBtnInnerRecording,
                ]}
              />
              {isRecording && (
                <View style={styles.recordingTimerRing}>
                  <Text style={styles.recordingTimerText}>
                    {formatTime(recordedDurationSec)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Next / Proceed Button (Right, if video exists or draft loaded) */}
            {mediaUri ? (
              <TouchableOpacity
                style={styles.nextProceedBtn}
                onPress={() => setStage('preview')}
                activeOpacity={0.85}
              >
                <Text style={styles.nextProceedText}>Next</Text>
                <Feather name="chevron-right" size={18} color="#ffffff" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.micToggleBtn}
                onPress={() => setIsMicMuted((v) => !v)}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={isMicMuted ? 'mic-off' : 'mic'}
                  size={20}
                  color={isMicMuted ? '#ef4444' : '#ffffff'}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* =========================================================================
          STAGE 2: VIDEO PREVIEW & EDITING SCREEN
         ========================================================================= */}
      {stage === 'preview' && (
        <View style={styles.fullscreen}>
          {mediaUri ? (
            <ReelVideoPlayer
              uri={mediaUri}
              muted={previewMuted}
              volume={voiceVolume}
              onDuration={handleVideoDuration}
            />
          ) : (
            <Image
              source={{ uri: coverUri || DEFAULT_COVER[category] }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          )}

          {/* Top Preview Controls */}
          <SafeAreaView style={styles.topPreviewBar} edges={['top']}>
            <TouchableOpacity
              style={styles.iconCircleGlass}
              onPress={() => setStage('camera')}
              activeOpacity={0.8}
            >
              <Feather name="arrow-left" size={20} color="#ffffff" />
            </TouchableOpacity>

            <View style={styles.previewTopCenter}>
              {/* Sound Pill */}
              <TouchableOpacity
                style={styles.previewSoundPill}
                onPress={() => setIsMixerOpen(true)}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="volume-high" size={15} color="#ffffff" />
                <Text style={styles.previewSoundText} numberOfLines={1}>
                  {selectedMusic ? selectedMusic.title : 'Original Sound'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.previewTopRight}>
              {/* Audio Mixer Tool */}
              <TouchableOpacity
                style={styles.iconCircleGlass}
                onPress={() => setIsMixerOpen(true)}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="tune" size={20} color="#ffffff" />
              </TouchableOpacity>

              {/* Mute Preview Toggle */}
              <TouchableOpacity
                style={styles.iconCircleGlass}
                onPress={() => setPreviewMuted((m) => !m)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={previewMuted ? 'volume-mute' : 'volume-high'}
                  size={20}
                  color="#ffffff"
                />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Bottom Preview & Trim Bar */}
          <View
            style={[
              styles.bottomPreviewBar,
              {
                paddingBottom:
                  Platform.OS === 'android'
                    ? Math.max(insets.bottom, 48) + 12
                    : Math.max(insets.bottom, 16) + 12,
              },
            ]}
          >
            <View style={styles.durationPillContainer}>
              <View style={styles.durationPill}>
                <Ionicons name="film-outline" size={14} color="#38bdf8" />
                <Text style={styles.durationPillText}>
                  {formatTime(mediaDurationSec)} /{' '}
                  {selectedMusic ? '1:00 (Music)' : '3:00 (Max)'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.editCoverQuickBtn}
                onPress={handlePickCoverImage}
                activeOpacity={0.8}
              >
                <Ionicons name="image-outline" size={14} color="#ffffff" />
                <Text style={styles.editCoverQuickText}>Cover</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.previewActionRow}>
              <TouchableOpacity
                style={styles.retakeBtn}
                onPress={() => setStage('camera')}
                activeOpacity={0.8}
              >
                <Feather name="refresh-ccw" size={16} color="#ffffff" />
                <Text style={styles.retakeBtnText}>Retake</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.instagramNextBtn}
                onPress={() => setStage('share')}
                activeOpacity={0.88}
              >
                <Text style={styles.instagramNextText}>Next</Text>
                <Feather name="arrow-right" size={18} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* =========================================================================
          STAGE 3: SHARE / PUBLISH "NEW REEL" DETAILS SCREEN
         ========================================================================= */}
      {stage === 'share' && (
        <SafeAreaView
          style={[styles.shareScreen, { backgroundColor: themeColors.bg }]}
          edges={['top']}
        >
          <StatusBar style={isDark ? 'light' : 'dark'} />
          {/* Share Top Bar */}
          <View
            style={[
              styles.shareTopNav,
              {
                backgroundColor: themeColors.card,
                borderBottomColor: themeColors.border,
              },
            ]}
          >
            <TouchableOpacity
              style={styles.backNavBtn}
              onPress={() => setStage('preview')}
              activeOpacity={0.8}
            >
              <Feather name="chevron-left" size={24} color={themeColors.text} />
            </TouchableOpacity>
            <Text style={[styles.shareNavTitle, { color: themeColors.text }]}>
              New Reel
            </Text>
            <TouchableOpacity
              style={[styles.headerShareBtn, styles.headerSharePill]}
              onPress={handlePublishReel}
              disabled={publishing}
              activeOpacity={0.85}
            >
              {publishing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.headerShareBtnText}>Share</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.shareScrollView}
            contentContainerStyle={[
              styles.shareScrollContent,
              {
                paddingBottom: Math.max(insets.bottom, 16) + 92,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Top Reel Preview & Caption Row */}
            <View
              style={[
                styles.previewCaptionRow,
                {
                  backgroundColor: themeColors.card,
                  borderColor: themeColors.border,
                },
              ]}
            >
              {/* 9:16 Thumbnail with "Edit Cover" overlay */}
              <TouchableOpacity
                style={[
                  styles.thumbnailCoverBox,
                  { backgroundColor: themeColors.surfaceAlt },
                ]}
                onPress={handlePickCoverImage}
                activeOpacity={0.85}
              >
                <Image
                  source={
                    coverUri
                      ? { uri: coverUri }
                      : { uri: DEFAULT_COVER[category] }
                  }
                  style={styles.thumbnailImg}
                  resizeMode="cover"
                />
                <View style={styles.editCoverBadge}>
                  <Ionicons name="camera-outline" size={13} color="#ffffff" />
                  <Text style={styles.editCoverBadgeText}>Edit cover</Text>
                </View>
              </TouchableOpacity>

              {/* Title & Caption Inputs */}
              <View style={styles.captionInputsCol}>
                <TextInput
                  style={[
                    styles.titleInputField,
                    {
                      color: themeColors.text,
                      backgroundColor: themeColors.inputBg,
                      borderColor: themeColors.border,
                    },
                  ]}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Reel title / hook..."
                  placeholderTextColor={themeColors.subtext}
                  maxLength={80}
                />
                <TextInput
                  style={[
                    styles.captionInputField,
                    {
                      color: themeColors.text,
                      backgroundColor: themeColors.inputBg,
                      borderColor: themeColors.border,
                    },
                  ]}
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="Write a caption... share what this short is about"
                  placeholderTextColor={themeColors.subtext}
                  multiline
                  maxLength={500}
                />
              </View>
            </View>

            {/* Soundtrack Card */}
            <View
              style={[
                styles.soundtrackCard,
                {
                  backgroundColor: themeColors.card,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <View style={styles.soundtrackHeader}>
                <View style={styles.soundtrackLeft}>
                  <MaterialCommunityIcons
                    name="music-circle"
                    size={22}
                    color="#10b981"
                  />
                  <Text
                    style={[
                      styles.soundtrackCardTitle,
                      { color: themeColors.text },
                    ]}
                  >
                    Audio
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsMusicModalOpen(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.soundtrackActionText}>
                    {selectedMusic ? 'Change' : 'Add Music'}
                  </Text>
                </TouchableOpacity>
              </View>

              {selectedMusic ? (
                <View
                  style={[
                    styles.attachedMusicRow,
                    { backgroundColor: themeColors.surface },
                  ]}
                >
                  <Image
                    source={{ uri: selectedMusic.coverUrl }}
                    style={styles.attachedMusicCover}
                  />
                  <View style={styles.attachedMusicMeta}>
                    <Text
                      style={[
                        styles.attachedMusicTitle,
                        { color: themeColors.text },
                      ]}
                      numberOfLines={1}
                    >
                      {selectedMusic.title}
                    </Text>
                    <Text
                      style={[
                        styles.attachedMusicArtist,
                        { color: themeColors.subtext },
                      ]}
                      numberOfLines={1}
                    >
                      {selectedMusic.artist} · Spotify Preview
                    </Text>
                    <View style={styles.sixtySecPill}>
                      <Text style={styles.sixtySecText}>Max 60s limit with music</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={handleRemoveTrack}
                    style={styles.removeTrackCross}
                  >
                    <Feather name="x" size={16} color={themeColors.subtext} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.noMusicRow}>
                  <Ionicons
                    name="mic-outline"
                    size={18}
                    color={themeColors.subtext}
                  />
                  <Text
                    style={[styles.noMusicText, { color: themeColors.subtext }]}
                  >
                    Original Camera Sound (Up to 3 minutes allowed)
                  </Text>
                </View>
              )}
            </View>

            {/* Hashtag Suggestions */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: themeColors.card,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <Text
                style={[styles.sectionCardHeading, { color: themeColors.text }]}
              >
                Trending Hashtags
              </Text>
              <TextInput
                style={[
                  styles.tagInput,
                  {
                    backgroundColor: themeColors.inputBg,
                    borderColor: themeColors.border,
                    color: themeColors.text,
                  },
                ]}
                value={tagsText}
                onChangeText={setTagsText}
                placeholder="#reels #shorts"
                placeholderTextColor={themeColors.subtext}
                autoCapitalize="none"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.hashtagChipsRow}>
                  {QUICK_HASHTAGS.map((tag) => {
                    const active = tagsText.toLowerCase().includes(tag.toLowerCase());
                    return (
                      <TouchableOpacity
                        key={tag}
                        style={[
                          styles.tagChip,
                          { backgroundColor: themeColors.surface },
                          active && styles.tagChipActive,
                        ]}
                        onPress={() => handleToggleTag(tag)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.tagChipText,
                            { color: themeColors.text },
                            active && styles.tagChipTextActive,
                          ]}
                        >
                          {tag}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            {/* Category Selector */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: themeColors.card,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <Text
                style={[styles.sectionCardHeading, { color: themeColors.text }]}
              >
                Category
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.categoryRow}>
                  {REEL_CATEGORIES.map((cat) => {
                    const active = category === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[
                          styles.catPill,
                          { backgroundColor: themeColors.surface },
                          active && { backgroundColor: themeColors.accent },
                        ]}
                        onPress={() => setCategory(cat)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.catPillText,
                            { color: themeColors.subtext },
                            active && {
                              color: themeColors.accentText,
                              fontWeight: 'bold',
                            },
                          ]}
                        >
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            {/* Audience / Visibility */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: themeColors.card,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <Text
                style={[styles.sectionCardHeading, { color: themeColors.text }]}
              >
                Audience
              </Text>
              <View style={styles.visRow}>
                {VISIBILITY_OPTIONS.map((opt) => {
                  const active = visibility === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[
                        styles.visBtn,
                        { backgroundColor: themeColors.surface },
                        active && styles.visBtnActive,
                      ]}
                      onPress={() => setVisibility(opt.id)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={opt.icon}
                        size={17}
                        color={active ? '#10b981' : themeColors.subtext}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.visLabel,
                            { color: themeColors.text },
                            active && styles.visLabelActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <Text
                          style={[styles.visDesc, { color: themeColors.subtext }]}
                        >
                          {opt.desc}
                        </Text>
                      </View>
                      {active && (
                        <Ionicons name="checkmark-circle" size={18} color="#10b981" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Advanced Toggles */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: themeColors.card,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <Text
                style={[styles.sectionCardHeading, { color: themeColors.text }]}
              >
                Reel Settings
              </Text>

              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => setAllowComments((v) => !v)}
                activeOpacity={0.8}
              >
                <View style={styles.settingTextCol}>
                  <Text
                    style={[styles.settingTitle, { color: themeColors.text }]}
                  >
                    Allow Comments
                  </Text>
                  <Text
                    style={[
                      styles.settingSubtitle,
                      { color: themeColors.subtext },
                    ]}
                  >
                    Viewers can comment on this Vibe Short
                  </Text>
                </View>
                <Ionicons
                  name={allowComments ? 'toggle' : 'toggle-outline'}
                  size={30}
                  color={allowComments ? '#10b981' : themeColors.subtext}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => setAllowRemix((v) => !v)}
                activeOpacity={0.8}
              >
                <View style={styles.settingTextCol}>
                  <Text
                    style={[styles.settingTitle, { color: themeColors.text }]}
                  >
                    Allow Remixing & Duets
                  </Text>
                  <Text
                    style={[
                      styles.settingSubtitle,
                      { color: themeColors.subtext },
                    ]}
                  >
                    Anyone can create a reel with your original sound
                  </Text>
                </View>
                <Ionicons
                  name={allowRemix ? 'toggle' : 'toggle-outline'}
                  size={30}
                  color={allowRemix ? '#10b981' : themeColors.subtext}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => setHighQualityUpload((v) => !v)}
                activeOpacity={0.8}
              >
                <View style={styles.settingTextCol}>
                  <Text
                    style={[styles.settingTitle, { color: themeColors.text }]}
                  >
                    Upload at Highest Quality
                  </Text>
                  <Text
                    style={[
                      styles.settingSubtitle,
                      { color: themeColors.subtext },
                    ]}
                  >
                    Optimizes video quality for 1080p full HD
                  </Text>
                </View>
                <Ionicons
                  name={highQualityUpload ? 'toggle' : 'toggle-outline'}
                  size={30}
                  color={highQualityUpload ? '#10b981' : themeColors.subtext}
                />
              </TouchableOpacity>
            </View>

            {/* Publishing Progress Message */}
            {progressText ? (
              <View style={styles.publishingProgressBar}>
                <ActivityIndicator size="small" color="#38bdf8" />
                <Text style={styles.publishingProgressText}>{progressText}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Sticky Bottom Dock */}
          <View
            style={[
              styles.shareBottomDock,
              {
                backgroundColor: themeColors.bg,
                borderTopColor: themeColors.border,
                paddingBottom: Math.max(insets.bottom, 12) + 8,
              },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.saveDraftDockBtn,
                { backgroundColor: themeColors.surfaceAlt },
              ]}
              onPress={handleSaveDraft}
              disabled={publishing}
              activeOpacity={0.85}
            >
              <Feather name="bookmark" size={17} color={themeColors.text} />
              <Text
                style={[styles.saveDraftDockText, { color: themeColors.text }]}
              >
                Save Draft
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareReelDockBtn}
              onPress={handlePublishReel}
              disabled={publishing}
              activeOpacity={0.88}
            >
              {publishing ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="flash" size={18} color="#ffffff" />
                  <Text style={styles.shareReelDockText}>Share Reel</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* =========================================================================
          AUDIO MIXER BOTTOM SHEET MODAL
         ========================================================================= */}
      <Modal
        visible={isMixerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsMixerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.mixerSheetContainer,
              { backgroundColor: themeColors.surface },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: themeColors.surfaceAlt },
              ]}
            />
            <View style={styles.mixerHeaderRow}>
              <Text
                style={[styles.mixerSheetTitle, { color: themeColors.text }]}
              >
                Audio Mixer
              </Text>
              <TouchableOpacity
                onPress={() => setIsMixerOpen(false)}
                style={styles.mixerCloseBtn}
              >
                <Feather name="x" size={20} color={themeColors.text} />
              </TouchableOpacity>
            </View>

            {/* Voice Volume Slider */}
            <View
              style={[
                styles.volumeCard,
                { backgroundColor: themeColors.surfaceAlt },
              ]}
            >
              <View style={styles.volumeHeader}>
                <View style={styles.volumeLabelGroup}>
                  <Ionicons name="mic" size={18} color="#38bdf8" />
                  <Text
                    style={[styles.volumeLabel, { color: themeColors.text }]}
                  >
                    Camera Original Sound
                  </Text>
                </View>
                <Text style={styles.volumeValueText}>
                  {Math.round(voiceVolume * 100)}%
                </Text>
              </View>
              <View style={styles.sliderMockTrack}>
                <TouchableOpacity
                  style={[
                    styles.sliderOptionBtn,
                    { backgroundColor: themeColors.card },
                    voiceVolume === 0 && styles.sliderOptionActive,
                  ]}
                  onPress={() => setVoiceVolume(0)}
                >
                  <Text
                    style={[
                      styles.sliderOptionText,
                      { color: voiceVolume === 0 ? '#ffffff' : themeColors.text },
                    ]}
                  >
                    Mute
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sliderOptionBtn,
                    { backgroundColor: themeColors.card },
                    voiceVolume === 0.5 && styles.sliderOptionActive,
                  ]}
                  onPress={() => setVoiceVolume(0.5)}
                >
                  <Text
                    style={[
                      styles.sliderOptionText,
                      { color: voiceVolume === 0.5 ? '#ffffff' : themeColors.text },
                    ]}
                  >
                    50%
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sliderOptionBtn,
                    { backgroundColor: themeColors.card },
                    voiceVolume === 1 && styles.sliderOptionActive,
                  ]}
                  onPress={() => setVoiceVolume(1)}
                >
                  <Text
                    style={[
                      styles.sliderOptionText,
                      { color: voiceVolume === 1 ? '#ffffff' : themeColors.text },
                    ]}
                  >
                    100%
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Music Volume Slider */}
            <View
              style={[
                styles.volumeCard,
                { backgroundColor: themeColors.surfaceAlt },
              ]}
            >
              <View style={styles.volumeHeader}>
                <View style={styles.volumeLabelGroup}>
                  <MaterialCommunityIcons name="music" size={18} color="#10b981" />
                  <Text
                    style={[styles.volumeLabel, { color: themeColors.text }]}
                  >
                    Soundtrack Volume
                  </Text>
                </View>
                <Text style={styles.volumeValueText}>
                  {Math.round(musicVolume * 100)}%
                </Text>
              </View>
              <View style={styles.sliderMockTrack}>
                <TouchableOpacity
                  style={[
                    styles.sliderOptionBtn,
                    { backgroundColor: themeColors.card },
                    musicVolume === 0 && styles.sliderOptionActive,
                  ]}
                  onPress={() => setMusicVolume(0)}
                >
                  <Text
                    style={[
                      styles.sliderOptionText,
                      { color: musicVolume === 0 ? '#ffffff' : themeColors.text },
                    ]}
                  >
                    Mute
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sliderOptionBtn,
                    { backgroundColor: themeColors.card },
                    musicVolume === 0.5 && styles.sliderOptionActive,
                  ]}
                  onPress={() => setMusicVolume(0.5)}
                >
                  <Text
                    style={[
                      styles.sliderOptionText,
                      { color: musicVolume === 0.5 ? '#ffffff' : themeColors.text },
                    ]}
                  >
                    50%
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sliderOptionBtn,
                    { backgroundColor: themeColors.card },
                    musicVolume === 0.8 && styles.sliderOptionActive,
                  ]}
                  onPress={() => setMusicVolume(0.8)}
                >
                  <Text
                    style={[
                      styles.sliderOptionText,
                      { color: musicVolume === 0.8 ? '#ffffff' : themeColors.text },
                    ]}
                  >
                    80%
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sliderOptionBtn,
                    { backgroundColor: themeColors.card },
                    musicVolume === 1 && styles.sliderOptionActive,
                  ]}
                  onPress={() => setMusicVolume(1)}
                >
                  <Text
                    style={[
                      styles.sliderOptionText,
                      { color: musicVolume === 1 ? '#ffffff' : themeColors.text },
                    ]}
                  >
                    100%
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Change Music Action */}
            <TouchableOpacity
              style={styles.mixerChangeMusicBtn}
              onPress={() => {
                setIsMixerOpen(false);
                setIsMusicModalOpen(true);
              }}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="music-box" size={20} color="#10b981" />
              <Text style={styles.mixerChangeMusicText}>
                {selectedMusic ? 'Choose Different Music' : 'Add Background Music'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* =========================================================================
          SPOTIFY & PUBLIC MUSIC PICKER MODAL
         ========================================================================= */}
      <Modal
        visible={isMusicModalOpen}
        animationType="slide"
        transparent={false}
        onRequestClose={() => {
          setIsMusicModalOpen(false);
          setPlayingPreviewTrackId(null);
        }}
      >
        <SafeAreaView
          style={[
            styles.musicModalContainer,
            { backgroundColor: themeColors.bg },
          ]}
          edges={['top']}
        >
          {/* Hidden audio player for song snippet preview */}
          {activePreviewTrack?.previewUrl ? (
            <TrackAudioStreamer uri={activePreviewTrack.previewUrl} />
          ) : null}

          {/* Modal Header */}
          <View style={styles.musicModalHeader}>
            <TouchableOpacity
              onPress={() => {
                setIsMusicModalOpen(false);
                setPlayingPreviewTrackId(null);
              }}
              style={styles.musicModalCloseBtn}
            >
              <Feather name="x" size={22} color={themeColors.text} />
            </TouchableOpacity>
            <View style={styles.musicModalHeaderTitleGroup}>
              <MaterialCommunityIcons name="spotify" size={22} color="#10b981" />
              <Text
                style={[styles.musicModalTitle, { color: themeColors.text }]}
              >
                Add Music to Reel
              </Text>
            </View>
            <View style={{ width: 36 }} />
          </View>

          {/* Search Input */}
          <View
            style={[
              styles.musicSearchContainer,
              { backgroundColor: themeColors.surface },
            ]}
          >
            <Feather
              name="search"
              size={18}
              color={themeColors.subtext}
              style={{ marginLeft: 12 }}
            />
            <TextInput
              style={[styles.musicSearchInput, { color: themeColors.text }]}
              value={musicSearchQuery}
              onChangeText={(text) => {
                setMusicSearchQuery(text);
                handleSearchMusic(text, musicGenre);
              }}
              placeholder="Search songs, artists, Bollywood, Pop..."
              placeholderTextColor={themeColors.subtext}
              returnKeyType="search"
            />
            {musicSearchQuery ? (
              <TouchableOpacity
                onPress={() => {
                  setMusicSearchQuery('');
                  handleSearchMusic('', musicGenre);
                }}
                style={{ padding: 8 }}
              >
                <Feather name="x" size={16} color={themeColors.subtext} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Genre Category Chips */}
          <View style={styles.genreSectionWrapper}>
            <Text style={styles.genreSectionTitle}>BROWSE CATEGORIES</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.genreScrollView}
              contentContainerStyle={styles.genreScrollContent}
            >
              {MUSIC_GENRES.map((g) => {
                const active = musicGenre === g;
                return (
                  <TouchableOpacity
                    key={g}
                    style={[
                      styles.genrePill,
                      {
                        backgroundColor: themeColors.surface,
                        borderColor: themeColors.border,
                      },
                      active && styles.genrePillActive,
                    ]}
                    onPress={() => handleSelectGenre(g)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.genrePillText,
                        { color: themeColors.text },
                        active && styles.genrePillTextActive,
                      ]}
                    >
                      {g}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* 60-Second Policy Alert Note */}
          <View
            style={[
              styles.musicPolicyBanner,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.border,
              },
            ]}
          >
            <Ionicons name="sparkles" size={14} color="#facc15" />
            <Text
              style={[styles.musicPolicyText, { color: themeColors.subtext }]}
            >
              Attaching music sets reel limit to 60s (Instagram format).
            </Text>
          </View>

          {/* Track List */}
          {isSearchingMusic ? (
            <View style={styles.musicLoadingBox}>
              <ActivityIndicator size="large" color="#10b981" />
              <Text style={styles.musicLoadingText}>Searching tracks...</Text>
            </View>
          ) : (
            <FlatList
              data={musicResults}
              keyExtractor={(item) => item.id}
              ListHeaderComponent={
                <View style={styles.trackListHeader}>
                  <View style={styles.trackListHeaderLeft}>
                    <Ionicons name="flame" size={16} color="#f59e0b" />
                    <Text
                      style={[
                        styles.trackListHeaderTitle,
                        { color: themeColors.text },
                      ]}
                    >
                      {musicGenre === 'All' ? 'TRENDING REELS AUDIOS' : `${musicGenre.toUpperCase()} TRACKS`}
                    </Text>
                  </View>
                  <Text style={styles.trackListCountText}>{musicResults.length} tracks</Text>
                </View>
              }
              contentContainerStyle={[
                styles.trackListContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 20 },
              ]}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isPlaying = playingPreviewTrackId === item.id;
                const isSelected = selectedMusic?.id === item.id;

                return (
                  <View
                    style={[
                      styles.trackCard,
                      { backgroundColor: themeColors.surface },
                      isSelected && styles.trackCardSelected,
                    ]}
                  >
                    {/* Album Art with Play/Pause button */}
                    <TouchableOpacity
                      style={styles.trackArtContainer}
                      onPress={() => {
                        setPlayingPreviewTrackId(isPlaying ? null : item.id);
                      }}
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: item.coverUrl }} style={styles.trackCoverImg} />
                      <View style={styles.trackPlayOverlay}>
                        <Ionicons
                          name={isPlaying ? 'pause' : 'play'}
                          size={18}
                          color="#ffffff"
                        />
                      </View>
                    </TouchableOpacity>

                    {/* Title & Artist */}
                    <View style={styles.trackInfoCol}>
                      <Text
                        style={[
                          styles.trackTitleText,
                          { color: themeColors.text },
                        ]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={[
                          styles.trackArtistText,
                          { color: themeColors.subtext },
                        ]}
                        numberOfLines={1}
                      >
                        {item.artist} · {item.genre}
                      </Text>
                      {isPlaying && (
                        <View style={styles.playingBadge}>
                          <View style={styles.playingDot} />
                          <Text style={styles.playingText}>Playing preview...</Text>
                        </View>
                      )}
                    </View>

                    {/* Action Button: Use Audio */}
                    <TouchableOpacity
                      style={[
                        styles.useAudioBtn,
                        { backgroundColor: themeColors.surfaceAlt },
                        isSelected && styles.useAudioBtnSelected,
                      ]}
                      onPress={() => handleAttachTrack(item)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.useAudioBtnText,
                          { color: themeColors.text },
                          isSelected && styles.useAudioBtnTextSelected,
                        ]}
                      >
                        {isSelected ? 'Applied' : 'Use'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* Toast Notification Banner (shown on every stage) */}
      {toastMessage && (
        <View style={styles.toastBanner} pointerEvents="none">
          <MaterialCommunityIcons name="information" size={15} color="#10b981" />
          <Text style={styles.toastText} numberOfLines={1}>
            {toastMessage}
          </Text>
        </View>
      )}

      <ReelCoverPicker
        visible={isCoverPickerOpen}
        videoUri={mediaUri}
        durationSec={mediaDurationSec}
        currentCoverUri={coverUri}
        currentTimeSec={coverTimeSec}
        onClose={() => setIsCoverPickerOpen(false)}
        onConfirm={handleCoverSelected}
      />

      {/* PASTE VIDEO URL MODAL */}
      <Modal
        visible={urlModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setUrlModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.mixerSheetContainer,
              {
                backgroundColor: themeColors.card,
                paddingBottom: Math.max(insets.bottom, 20) + 12,
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.mixerHeaderRow}>
              <Text
                style={[styles.mixerSheetTitle, { color: themeColors.text }]}
              >
                Upload Reel from URL
              </Text>
              <TouchableOpacity
                onPress={() => setUrlModalOpen(false)}
                style={styles.mixerCloseBtn}
              >
                <Ionicons name="close" size={22} color={themeColors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.tagInput,
                {
                  backgroundColor: themeColors.inputBg,
                  borderColor: themeColors.border,
                  color: themeColors.text,
                  paddingVertical: 12,
                },
              ]}
              value={reelUrlInput}
              onChangeText={setReelUrlInput}
              placeholder="https://example.com/reel.mp4"
              placeholderTextColor={themeColors.subtext}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <TouchableOpacity
              style={styles.shareReelDockBtn}
              onPress={() => {
                const raw = reelUrlInput.trim();
                const match = raw.match(/https?:\/\/\S+/i);
                const clean = match
                  ? match[0]
                  : /^www\.|^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(raw)
                    ? `https://${raw}`
                    : raw;
                if (!clean || !/^https?:\/\//i.test(clean)) {
                  Alert.alert(
                    'Invalid URL',
                    'Please enter a valid http/https video link.'
                  );
                  return;
                }
                setMediaUri(clean);
                setMediaDurationSec(0);
                setCoverUri('');
                setUrlModalOpen(false);
                setStage('preview');
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark" size={18} color="#ffffff" />
              <Text style={styles.shareReelDockText}>Load Video URL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  fullscreen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  invisibleAudio: {
    width: 0,
    height: 0,
    opacity: 0,
  },

  /* CAMERA STAGE STYLES */
  permissionFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
  },
  permissionSub: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 20,
  },
  permissionBtn: {
    backgroundColor: '#38bdf8',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 8,
  },
  permissionBtnText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 14,
  },

  gridOverlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'stretch',
  },
  gridCol: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    height: '100%',
  },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },

  countdownCenterOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
  },
  countdownNumber: {
    fontSize: 120,
    fontWeight: '900',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 16,
  },

  topCameraBar: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 30,
  },
  iconCircleGlass: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  iconCircleActive: {
    backgroundColor: 'rgba(250, 204, 21, 0.25)',
    borderColor: '#facc15',
  },
  topRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  musicSelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    maxWidth: SCREEN_WIDTH * 0.5,
  },
  musicSelectorPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#10b981',
  },
  musicPillText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  removeMusicBtn: {
    padding: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 10,
  },

  toastBanner: {
    position: 'absolute',
    top: 96,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(17, 17, 19, 0.88)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    zIndex: 40,
  },
  toastText: {
    color: '#f4f4f5',
    fontSize: 12,
    fontWeight: '600',
  },

  rightFloatDock: {
    position: 'absolute',
    right: 4,
    top: SCREEN_HEIGHT * 0.22,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 16,
    zIndex: 25,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  dockIconItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dockIconItemActive: {
    opacity: 1,
  },
  dockIconLabel: {
    color: '#e4e4e7',
    fontSize: 10,
    fontWeight: '600',
  },
  durationBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  speedText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },

  bottomCameraDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    zIndex: 30,
  },
  galleryUploadBtn: {
    alignItems: 'center',
    gap: 4,
    width: 60,
  },
  galleryBtnLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },

  recordBtnOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnOuterActive: {
    // The circular progress ring draws the border while recording.
    borderColor: 'transparent',
  },
  recordProgressRing: {
    position: 'absolute',
    top: -4,
    left: -4,
  },
  recordBtnInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#ffffff',
  },
  recordBtnInnerRecording: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#ef4444',
  },
  recordingTimerRing: {
    position: 'absolute',
    top: -30,
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  recordingTimerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },

  nextProceedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#38bdf8',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    width: 72,
    justifyContent: 'center',
  },
  nextProceedText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  micToggleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },

  /* PREVIEW STAGE STYLES */
  topPreviewBar: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  previewTopCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  previewSoundPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    maxWidth: SCREEN_WIDTH * 0.5,
  },
  previewSoundText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  previewTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  bottomPreviewBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    gap: 12,
    zIndex: 20,
  },
  durationPillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  durationPillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  editCoverQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  editCoverQuickText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  previewActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(24, 24, 27, 0.85)',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 28,
  },
  retakeBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  instagramNextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e1306c',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
  },
  instagramNextText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },

  /* SHARE STAGE STYLES */
  shareScreen: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  shareTopNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 54,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b',
  },
  backNavBtn: {
    padding: 4,
  },
  shareNavTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerShareBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  headerSharePill: {
    backgroundColor: '#e1306c',
    borderRadius: 999,
  },
  headerShareBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '800',
  },

  shareScrollView: {
    flex: 1,
    width: '100%',
  },
  shareScrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 12,
    width: '100%',
  },

  previewCaptionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#141416',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#222226',
  },
  thumbnailCoverBox: {
    width: 92,
    height: 148,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#27272a',
    position: 'relative',
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
  },
  editCoverBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  editCoverBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },

  captionInputsCol: {
    flex: 1,
    gap: 8,
  },
  titleInputField: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  captionInputField: {
    color: '#d4d4d8',
    fontSize: 13.5,
    minHeight: 84,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    lineHeight: 19,
  },

  soundtrackCard: {
    width: '100%',
    backgroundColor: '#141416',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#222226',
    gap: 10,
  },
  soundtrackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  soundtrackLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soundtrackCardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  soundtrackActionText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: 'bold',
  },
  attachedMusicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#27272a',
    padding: 10,
    borderRadius: 12,
  },
  attachedMusicCover: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  attachedMusicMeta: {
    flex: 1,
    gap: 2,
  },
  attachedMusicTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  attachedMusicArtist: {
    color: '#a1a1aa',
    fontSize: 11,
  },
  sixtySecPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 2,
  },
  sixtySecText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: 'bold',
  },
  removeTrackCross: {
    padding: 6,
  },
  noMusicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  noMusicText: {
    color: '#a1a1aa',
    fontSize: 12,
  },

  sectionCard: {
    width: '100%',
    backgroundColor: '#141416',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#222226',
    gap: 10,
  },
  sectionCardHeading: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '800',
  },
  tagInput: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#ffffff',
    fontSize: 13.5,
  },
  hashtagChipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 4,
  },
  tagChip: {
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagChipActive: {
    backgroundColor: '#38bdf8',
  },
  tagChipText: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  tagChipTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },

  categoryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  catPill: {
    backgroundColor: '#27272a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  catPillActive: {
    backgroundColor: '#ffffff',
  },
  catPillText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
  },
  catPillTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },

  visRow: {
    gap: 8,
  },
  visBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#27272a',
    padding: 12,
    borderRadius: 12,
  },
  visBtnActive: {
    borderWidth: 1,
    borderColor: '#10b981',
  },
  visLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  visLabelActive: {
    color: '#10b981',
  },
  visDesc: {
    color: '#71717a',
    fontSize: 11,
  },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  settingTextCol: {
    flex: 1,
    paddingRight: 12,
    gap: 2,
  },
  settingTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  settingSubtitle: {
    color: '#71717a',
    fontSize: 11,
  },

  publishingProgressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  publishingProgressText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: 'bold',
  },

  shareBottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#09090b',
    borderTopWidth: 1,
    borderTopColor: '#18181b',
  },
  saveDraftDockBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#27272a',
  },
  saveDraftDockText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  shareReelDockBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#e1306c',
  },
  shareReelDockText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },

  /* AUDIO MIXER SHEET */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  mixerSheetContainer: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 16,
    paddingBottom: 36,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3f3f46',
    alignSelf: 'center',
    marginBottom: 4,
  },
  mixerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mixerSheetTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  mixerCloseBtn: {
    padding: 4,
  },
  volumeCard: {
    backgroundColor: '#27272a',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  volumeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  volumeLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  volumeLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  volumeValueText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: 'bold',
  },
  sliderMockTrack: {
    flexDirection: 'row',
    gap: 8,
  },
  sliderOptionBtn: {
    flex: 1,
    backgroundColor: '#18181b',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  sliderOptionActive: {
    backgroundColor: '#38bdf8',
  },
  sliderOptionText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  mixerChangeMusicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  mixerChangeMusicText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: 'bold',
  },

  /* MUSIC MODAL STYLES */
  musicModalContainer: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  musicModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  musicModalCloseBtn: {
    padding: 6,
  },
  musicModalHeaderTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  musicModalTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  musicSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    marginHorizontal: 12,
    borderRadius: 12,
    height: 44,
  },
  musicSearchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
    paddingHorizontal: 10,
  },
  genreSectionWrapper: {
    marginTop: 12,
    marginBottom: 4,
    width: '100%',
  },
  genreSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717a',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 14,
  },
  genreScrollView: {
    flexGrow: 0,
  },
  genreScrollContent: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
    paddingVertical: 4,
  },
  genrePill: {
    backgroundColor: '#1c1c20',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272a',
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  genrePillActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  genrePillText: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '600',
    includeFontPadding: false,
    textAlign: 'center',
  },
  genrePillTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },
  musicPolicyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#141416',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222226',
  },
  musicPolicyText: {
    color: '#a1a1aa',
    fontSize: 11.5,
    fontWeight: '500',
  },

  trackListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 10,
  },
  trackListHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trackListHeaderTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.6,
  },
  trackListCountText: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
  },

  musicLoadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  musicLoadingText: {
    color: '#a1a1aa',
    fontSize: 13,
  },
  trackListContent: {
    paddingHorizontal: 12,
    paddingTop: 4,
    gap: 10,
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#18181b',
    padding: 10,
    borderRadius: 14,
  },
  trackCardSelected: {
    borderWidth: 1,
    borderColor: '#10b981',
  },
  trackArtContainer: {
    width: 50,
    height: 50,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  trackCoverImg: {
    width: '100%',
    height: '100%',
  },
  trackPlayOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackInfoCol: {
    flex: 1,
    gap: 2,
  },
  trackTitleText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  trackArtistText: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  playingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  playingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  playingText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: 'bold',
  },
  useAudioBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
  },
  useAudioBtnSelected: {
    backgroundColor: '#10b981',
  },
  useAudioBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  useAudioBtnTextSelected: {
    color: '#000000',
    fontWeight: 'bold',
  },
  remixRefPill: {
    position: 'absolute',
    top: 102,
    left: 16,
    right: 78,
    zIndex: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(9,9,11,0.74)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.45)',
  },
  remixRefThumb: {
    width: 30,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#27272a',
  },
  remixRefLabel: {
    color: '#10b981',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  remixRefTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
