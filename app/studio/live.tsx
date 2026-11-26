import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  DeviceEventEmitter,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { TouchableOpacity } from '@/components/ui/Touchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Feather, Ionicons } from '@expo/vector-icons';
import { backend, LiveRoomChannel } from '../../lib/backend';
import {
  DEFAULT_COVER,
  deleteStudioDraft,
  getStudioDrafts,
  isLikelyImageUri,
  parseTags,
  publishCreatorItem,
  saveStudioDraft,
} from '../../lib/creatorStudio';
import { openMiniPlayer } from '../../lib/miniPlayerStore';
import { scheduleUpcomingLive } from '../../lib/growthFeatures';
import {
  FloatingReactionItem,
  LiveFloatingReactions,
} from '@/components/studio/LiveFloatingReactions';
import {
  LiveAnalyticsViewersSheet,
  LiveGiftOption,
  LiveGiftSuperchatSheet,
  LiveGuestsManagerSheet,
  LiveJoinRequestEntry,
  LivePresenceViewer,
  LiveStudioSettingsSheet,
  LiveStudioSettingsState,
  LiveSuperchatOption,
} from '@/components/studio/LiveStudioSheets';

type Mode = 'host' | 'viewer';
type StudioStage = 'setup' | 'countdown' | 'live' | 'ending' | 'summary';
type ChatKind = 'normal' | 'gift' | 'superchat' | 'system';

export type LiveHostProfile = {
  name: string;
  avatarUri?: string;
  followersCount: number | string;
};

type ChatMessageItem = {
  id: string;
  username: string;
  message: string;
  color: string;
  kind?: ChatKind;
};

type GiftBannerState = {
  id: string;
  sender: string;
  title: string;
  subtitle: string;
  color: string;
};

type Props = {
  streamId?: string;
  mode?: Mode;
  viewerName?: string;
  host?: LiveHostProfile;
  streamTitle?: string;
  startImmediately?: boolean;
  onStartLive?: (payload: { title: string; streamId?: string }) => void;
  onRecordingSaved?: (recordingUrl: string) => void;
  onClose?: () => void;
};

const FALLBACK_HOST: LiveHostProfile = {
  name: 'Creator Studio',
  followersCount: 0,
};

const DEFAULT_STUDIO_SETTINGS: LiveStudioSettingsState = {
  category: 'Live',
  description: '',
  tagsText: '#live #community',
  visibility: 'public',
  autoRecordReplay: true,
  publishReplayToWatch: true,
  monetizeEnabled: true,
  chatEnabled: true,
  allowJoinRequests: true,
  slowModeSec: 0,
};

const ZOOM_STEPS = [0, 0.15, 0.35] as const;

function formatFollowers(count: number | string): string {
  if (typeof count === 'string') return count;
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return count.toLocaleString();
}

function formatDuration(totalSeconds: number): string {
  const safeSec = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

function inferMessageKind(message: string): ChatKind {
  if (
    message.startsWith('⭐ Superchat') ||
    message.startsWith('💎 Superchat') ||
    message.includes('Superchat ₹')
  ) {
    return 'superchat';
  }
  if (message.startsWith('Sent ')) {
    return 'gift';
  }
  return 'normal';
}

function StudioIconButton({
  children,
  onPress,
  style,
  active = false,
  badgeCount = 0,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
  active?: boolean;
  badgeCount?: number;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={onPress}
      style={[styles.iconButton, active && styles.iconButtonActive, style]}
    >
      {children}
      {badgeCount > 0 ? (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>
            {badgeCount > 9 ? '9+' : badgeCount}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function PermissionGateCard({
  cameraGranted,
  micGranted,
  canAskCamera,
  canAskMic,
  onRequestPermissions,
  onContinueAudioOnly,
}: {
  cameraGranted: boolean;
  micGranted: boolean;
  canAskCamera: boolean;
  canAskMic: boolean;
  onRequestPermissions: () => void;
  onContinueAudioOnly: () => void;
}) {
  const blockedPermanently =
    (!cameraGranted && !canAskCamera) || (!micGranted && !canAskMic);

  return (
    <View style={styles.permissionOverlay}>
      <View style={styles.permissionCard}>
        <View style={styles.permissionIconCircle}>
          <Ionicons name="videocam" size={28} color="#f43f5e" />
        </View>
        <Text style={styles.permissionTitle}>Camera & Microphone Access</Text>
        <Text style={styles.permissionDesc}>
          Enable camera and microphone permissions to preview your live broadcast
          and record replays.
        </Text>

        <TouchableOpacity
          style={styles.permissionPrimaryBtn}
          onPress={
            blockedPermanently
              ? () => void Linking.openSettings()
              : onRequestPermissions
          }
        >
          <Text style={styles.permissionPrimaryText}>
            {blockedPermanently
              ? 'Open Device Settings'
              : 'Grant Camera & Mic Access'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.permissionSecondaryBtn}
          onPress={onContinueAudioOnly}
        >
          <Text style={styles.permissionSecondaryText}>
            Continue Without Camera
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CountdownOverlay({
  count,
  onCancel,
}: {
  count: number;
  onCancel: () => void;
}) {
  return (
    <View style={styles.countdownOverlay}>
      <View style={styles.countdownCircle}>
        <Text style={styles.countdownNumber}>{count > 0 ? count : 'LIVE'}</Text>
      </View>
      <Text style={styles.countdownHint}>Starting broadcast...</Text>
      <TouchableOpacity style={styles.countdownCancelBtn} onPress={onCancel}>
        <Text style={styles.countdownCancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

function PostLiveSummaryView({
  title,
  durationSeconds,
  peakViewers,
  messagesCount,
  reactionsCount,
  earningsInr,
  replayUrl,
  localRecordingUri,
  publishedToWatch,
  isPublishingToWatch,
  isSavingToDevice,
  savedToDevice,
  onSaveToDevice,
  onPublishToWatch,
  onShareReplay,
  onOpenWatch,
  onGoLiveAgain,
  onDone,
  topInset,
  bottomInset,
}: {
  title: string;
  durationSeconds: number;
  peakViewers: number;
  messagesCount: number;
  reactionsCount: number;
  earningsInr: number;
  replayUrl: string | null;
  localRecordingUri: string | null;
  publishedToWatch: boolean;
  isPublishingToWatch: boolean;
  isSavingToDevice: boolean;
  savedToDevice: boolean;
  onSaveToDevice: () => void;
  onPublishToWatch: () => void;
  onShareReplay: () => void;
  onOpenWatch: () => void;
  onGoLiveAgain: () => void;
  onDone: () => void;
  topInset: number;
  bottomInset: number;
}) {
  return (
    <View
      style={[
        styles.summaryScreen,
        {
          paddingTop: Math.max(topInset, 24) + 12,
          paddingBottom: Math.max(bottomInset, 20) + 12,
        },
      ]}
    >
      <View style={styles.summaryTopRow}>
        <View style={styles.summaryBadge}>
          <Ionicons name="checkmark-circle" size={16} color="#34d399" />
          <Text style={styles.summaryBadgeText}>BROADCAST ENDED</Text>
        </View>
        <TouchableOpacity style={styles.closeButton} onPress={onDone}>
          <Feather name="x" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <Text style={styles.summaryTitle} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.summarySubtitle}>
        Here is your Live Creator Studio performance summary.
      </Text>

      <View style={styles.summaryStatsGrid}>
        <View style={styles.summaryStatCard}>
          <Ionicons name="time-outline" size={20} color="#38bdf8" />
          <Text style={styles.summaryStatVal}>
            {formatDuration(durationSeconds)}
          </Text>
          <Text style={styles.summaryStatLabel}>Duration</Text>
        </View>
        <View style={styles.summaryStatCard}>
          <Feather name="users" size={20} color="#f43f5e" />
          <Text style={styles.summaryStatVal}>{peakViewers}</Text>
          <Text style={styles.summaryStatLabel}>Peak Viewers</Text>
        </View>
        <View style={styles.summaryStatCard}>
          <Feather name="message-circle" size={20} color="#a855f7" />
          <Text style={styles.summaryStatVal}>{messagesCount}</Text>
          <Text style={styles.summaryStatLabel}>Comments</Text>
        </View>
        <View style={styles.summaryStatCard}>
          <Ionicons name="heart" size={20} color="#fb7185" />
          <Text style={styles.summaryStatVal}>{reactionsCount}</Text>
          <Text style={styles.summaryStatLabel}>Reactions</Text>
        </View>
        <View
          style={[
            styles.summaryStatCard,
            {
              width: '100%',
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: 18,
            },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="sparkles" size={20} color="#fbbf24" />
            <Text style={styles.summaryStatLabel}>Gifts & Superchats</Text>
          </View>
          <Text style={[styles.summaryStatVal, { color: '#fbbf24' }]}>
            ₹{earningsInr}
          </Text>
        </View>
      </View>

      <View style={styles.summaryReplayCard}>
        <View style={styles.summaryReplayHeader}>
          <Ionicons
            name={replayUrl ? 'cloud-done-outline' : 'videocam-off-outline'}
            size={20}
            color={replayUrl ? '#34d399' : '#94a3b8'}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryReplayTitle}>
              {replayUrl ? 'Cloud Replay Saved' : 'No Replay Video Uploaded'}
            </Text>
            <Text style={styles.summaryReplaySub}>
              {replayUrl
                ? publishedToWatch
                  ? 'Replay is published and ready in Watch.'
                  : 'Replay is uploaded to cloud storage.'
                : 'Streams under ~3 seconds or without camera do not produce a replay file.'}
            </Text>
          </View>
        </View>

        <View style={styles.summaryActionChips}>
          {localRecordingUri ? (
            <TouchableOpacity
              style={[
                styles.summaryChipBtn,
                savedToDevice && styles.summaryChipBtnSuccess,
              ]}
              onPress={onSaveToDevice}
              disabled={isSavingToDevice || savedToDevice}
            >
              <Feather
                name={savedToDevice ? 'check' : 'download'}
                size={14}
                color="#fff"
              />
              <Text style={styles.summaryChipText}>
                {isSavingToDevice
                  ? 'Saving...'
                  : savedToDevice
                    ? 'Saved to Gallery'
                    : 'Save Video'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {replayUrl && !publishedToWatch ? (
            <TouchableOpacity
              style={styles.summaryChipBtn}
              onPress={onPublishToWatch}
              disabled={isPublishingToWatch}
            >
              <Ionicons name="cloud-upload-outline" size={14} color="#fff" />
              <Text style={styles.summaryChipText}>
                {isPublishingToWatch ? 'Publishing...' : 'Publish to Watch'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {replayUrl ? (
            <TouchableOpacity
              style={styles.summaryChipBtn}
              onPress={onShareReplay}
            >
              <Feather name="share-2" size={14} color="#fff" />
              <Text style={styles.summaryChipText}>Share</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.summaryFooter}>
        {publishedToWatch ? (
          <TouchableOpacity
            style={styles.summaryPrimaryBtn}
            onPress={onOpenWatch}
          >
            <Ionicons name="play-circle" size={18} color="#fff" />
            <Text style={styles.summaryPrimaryText}>View in Watch</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.summarySecondaryRow}>
          <TouchableOpacity
            style={styles.summaryOutlineBtn}
            onPress={onGoLiveAgain}
          >
            <Feather name="radio" size={16} color="#f8fafc" />
            <Text style={styles.summaryOutlineText}>Go Live Again</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.summaryDoneBtn} onPress={onDone}>
            <Text style={styles.summaryDoneText}>Back to Studio</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function LiveStreamingScreen({
  streamId: initialStreamId,
  mode: initialMode,
  viewerName: initialViewerName,
  host: initialHostProp,
  streamTitle: initialTitle = '',
  startImmediately = false,
  onStartLive,
  onRecordingSaved,
  onClose,
}: Props) {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{
    streamId?: string;
    mode?: Mode;
    draftId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const commentInputRef = useRef<any>(null);
  const chatListRef = useRef<FlatList<ChatMessageItem>>(null);
  const channelRef = useRef<LiveRoomChannel | null>(null);
  const recordingPromiseRef = useRef<Promise<
    { uri: string } | undefined
  > | null>(null);
  const liveStartedAtRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStageTapRef = useRef<number>(0);
  const lastSentCommentAtRef = useRef<number>(0);

  const effectiveMode: Mode = initialMode || searchParams.mode || 'host';
  const isHost = effectiveMode === 'host';
  const draftId = searchParams.draftId;

  const [resolvedHost, setResolvedHost] = useState<LiveHostProfile>(
    initialHostProp || FALLBACK_HOST
  );
  const [resolvedViewerName, setResolvedViewerName] = useState<string>(
    initialViewerName?.trim() || 'Viewer'
  );
  const [currentUserId, setCurrentUserId] = useState<string>('anon');

  const hostProfile = initialHostProp || resolvedHost;
  const hostName = hostProfile.name?.trim() || 'Creator Studio';
  const hostInitial = hostName.charAt(0).toUpperCase() || 'C';
  const formattedFollowers = formatFollowers(hostProfile.followersCount);

  const [activeStreamId, setActiveStreamId] = useState<string | undefined>(
    initialStreamId || searchParams.streamId
  );
  const [stage, setStage] = useState<StudioStage>(
    startImmediately ? 'live' : 'setup'
  );
  const isLiveStarted = stage === 'live';

  const [countdownValue, setCountdownValue] = useState(3);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [endingStatusText, setEndingStatusText] = useState(
    'Ending Live Stream...'
  );

  const [titleText, setTitleText] = useState(initialTitle);
  const [coverUri, setCoverUri] = useState<string>('');
  const [settings, setSettings] = useState<LiveStudioSettingsState>(
    DEFAULT_STUDIO_SETTINGS
  );
  const [skipPermissionGate, setSkipPermissionGate] = useState(false);

  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isMirrored, setIsMirrored] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(0);
  const zoomLevel = ZOOM_STEPS[zoomIndex];

  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [comment, setComment] = useState('');
  const [isCommenting, setIsCommenting] = useState(false);
  const [chatVisible, setChatVisible] = useState(true);
  const [pinnedMessage, setPinnedMessage] = useState<string | null>(null);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);

  // Live Battle (PK Mode) & Schedule Live
  const [battleActive, setBattleActive] = useState(false);
  const [battleSecondsLeft, setBattleSecondsLeft] = useState(180);
  const [battleHostScore, setBattleHostScore] = useState(0);
  const [battleOpponentScore, setBattleOpponentScore] = useState(0);
  const [battleOpponentName, setBattleOpponentName] = useState('Challenger');
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleOffsetMin, setScheduleOffsetMin] = useState<number>(60);
  const [slowModeWaitSec, setSlowModeWaitSec] = useState(0);

  const [following, setFollowing] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [presenceViewers, setPresenceViewers] = useState<LivePresenceViewer[]>(
    []
  );
  const [reactionsCount, setReactionsCount] = useState(0);
  const [earningsInr, setEarningsInr] = useState(0);
  const [floatingReactions, setFloatingReactions] = useState<
    FloatingReactionItem[]
  >([]);
  const [giftBanner, setGiftBanner] = useState<GiftBannerState | null>(null);

  const [joinRequestSent, setJoinRequestSent] = useState(false);
  const [myJoinRequestId, setMyJoinRequestId] = useState<string | null>(null);
  const [joinedCall, setJoinedCall] = useState(false);
  const [joinRequests, setJoinRequests] = useState<LiveJoinRequestEntry[]>([]);
  const [activeCoHosts, setActiveCoHosts] = useState<string[]>([]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [giftSheetTab, setGiftSheetTab] = useState<'gift' | 'superchat' | null>(
    null
  );
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isGuestsOpen, setIsGuestsOpen] = useState(false);

  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [localRecordingUri, setLocalRecordingUri] = useState<string | null>(
    null
  );
  const [publishedToWatch, setPublishedToWatch] = useState(false);
  const [isPublishingToWatch, setIsPublishingToWatch] = useState(false);
  const [isSavingToDevice, setIsSavingToDevice] = useState(false);
  const [savedToDevice, setSavedToDevice] = useState(false);

  const [livePulseAnim] = useState(() => new Animated.Value(1));

  const handleExit = useCallback(() => {
    if (onClose) {
      onClose();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/create');
    }
  }, [onClose, router]);

  // Load logged-in creator/viewer profile via backend
  useEffect(() => {
    let active = true;
    backend.live.getCurrentUserLiveProfile().then((profile) => {
      if (!active || !profile) return;
      if (profile.userId) setCurrentUserId(profile.userId);
      if (!initialHostProp) {
        setResolvedHost({
          name: profile.name,
          avatarUri: profile.avatarUri,
          followersCount: profile.followersCount,
        });
      }
      if (!initialViewerName) {
        setResolvedViewerName(profile.name);
      }
    });
    return () => {
      active = false;
    };
  }, [initialHostProp, initialViewerName]);

  useEffect(() => {
    if (!draftId) return;
    getStudioDrafts().then((items) => {
      const found = items.find((d) => d.id === draftId);
      if (!found) return;
      if (found.title) setTitleText(found.title);
      if (found.coverUri && isLikelyImageUri(found.coverUri)) {
        setCoverUri(found.coverUri);
      }
      setSettings((prev) => ({
        ...prev,
        category: found.category || prev.category,
        description: found.description || '',
        tagsText: found.tagsText || prev.tagsText,
      }));
    });
  }, [draftId]);

  useEffect(() => {
    if (!permission) {
      void requestPermission();
    }
    if (!micPermission) {
      void requestMicPermission();
    }
  }, [permission, requestPermission, micPermission, requestMicPermission]);

  useEffect(() => {
    if (!isLiveStarted) {
      livePulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulseAnim, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(livePulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLiveStarted, livePulseAnim]);

  useEffect(() => {
    if (!isLiveStarted) {
      liveStartedAtRef.current = null;
      return;
    }
    if (!liveStartedAtRef.current) {
      liveStartedAtRef.current = Date.now();
    }
    const interval = setInterval(() => {
      if (liveStartedAtRef.current) {
        setLiveSeconds(
          Math.floor((Date.now() - liveStartedAtRef.current) / 1000)
        );
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isLiveStarted]);

  useEffect(() => {
    if (!battleActive) return;
    const timer = setInterval(() => {
      setBattleSecondsLeft((prev) => {
        if (prev <= 1) {
          setBattleActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [battleActive]);

  const handleToggleBattleMode = () => {
    const nextActive = !battleActive;
    const nextOpponent = activeCoHosts[0] || 'Challenger';
    setBattleActive(nextActive);
    setBattleOpponentName(nextOpponent);
    if (nextActive) {
      setBattleSecondsLeft(180);
      setBattleHostScore(0);
      setBattleOpponentScore(0);
    }
    channelRef.current?.send({
      type: 'broadcast',
      event: 'live_battle_update',
      payload: {
        active: nextActive,
        secondsLeft: nextActive ? 180 : 0,
        hostScore: 0,
        opponentScore: 0,
        opponentName: nextOpponent,
      },
    });
  };

  const handleBoostBattleSide = (side: 'host' | 'opponent') => {
    const nextHost = side === 'host' ? battleHostScore + 10 : battleHostScore;
    const nextOpp =
      side === 'opponent' ? battleOpponentScore + 10 : battleOpponentScore;
    setBattleHostScore(nextHost);
    setBattleOpponentScore(nextOpp);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'live_battle_update',
      payload: {
        active: true,
        secondsLeft: battleSecondsLeft,
        hostScore: nextHost,
        opponentScore: nextOpp,
        opponentName: battleOpponentName,
      },
    });
  };

  const handleSaveScheduledLive = async () => {
    const finalTitle =
      titleText.trim() || `${hostName}'s Upcoming Live Session`;
    await scheduleUpcomingLive({
      hostId: currentUserId,
      hostName,
      hostHandle: `@${hostName.toLowerCase().replace(/\s+/g, '') || 'creator'}`,
      hostAvatar: hostProfile.avatarUri,
      title: finalTitle,
      category: settings.category,
      scheduledAtMs: Date.now() + scheduleOffsetMin * 60 * 1000,
    });
    setIsScheduleModalOpen(false);
    Alert.alert(
      'Live Scheduled',
      `"${finalTitle}" countdown is now visible on Home & Watch with Remind Me alerts.`
    );
  };

  useEffect(() => {
    if (slowModeWaitSec <= 0) return;
    const t = setInterval(() => {
      setSlowModeWaitSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [slowModeWaitSec]);

  const spawnFloatingReaction = useCallback(
    (emoji: string, color = '#fb7185') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setFloatingReactions((prev) => [...prev.slice(-18), { id, emoji, color }]);
      setReactionsCount((c) => c + 1);
    },
    []
  );

  const removeFloatingReaction = useCallback((id: string) => {
    setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const showTemporaryGiftBanner = useCallback((banner: GiftBannerState) => {
    setGiftBanner(banner);
    setTimeout(() => {
      setGiftBanner((curr) => (curr?.id === banner.id ? null : curr));
    }, 3600);
  }, []);

  const broadcastStudioState = useCallback(
    (patch: {
      pinnedMessage?: string | null;
      chatEnabled?: boolean;
      slowModeSec?: 0 | 5 | 15;
      allowJoinRequests?: boolean;
      activeCoHosts?: string[];
      mutedUsers?: string[];
      title?: string;
    }) => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'live_studio_state',
        payload: patch,
      });
    },
    []
  );

  const handleUpdateSettings = useCallback(
    (patch: Partial<LiveStudioSettingsState>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        if (isLiveStarted && isHost) {
          broadcastStudioState({
            chatEnabled: next.chatEnabled,
            slowModeSec: next.slowModeSec,
            allowJoinRequests: next.allowJoinRequests,
          });
        }
        return next;
      });
    },
    [isLiveStarted, isHost, broadcastStudioState]
  );

  const startCameraRecording = useCallback(async () => {
    if (
      !isHost ||
      !settings.autoRecordReplay ||
      !cameraRef.current ||
      !cameraEnabled ||
      !permission?.granted
    ) {
      return;
    }
    if (recordingPromiseRef.current) return;

    if (!micPermission?.granted) {
      await requestMicPermission();
    }

    try {
      setIsRecording(true);
      const promise = cameraRef.current.recordAsync({
        maxDuration: 60 * 60,
      });
      recordingPromiseRef.current = promise;
      await promise;
    } catch {
      setIsRecording(false);
      recordingPromiseRef.current = null;
    }
  }, [
    isHost,
    settings.autoRecordReplay,
    cameraEnabled,
    permission?.granted,
    micPermission?.granted,
    requestMicPermission,
  ]);

  const stopAndCaptureRecordingUri =
    useCallback(async (): Promise<string | null> => {
      if (!recordingPromiseRef.current) return null;
      try {
        cameraRef.current?.stopRecording();
        await new Promise((resolve) => setTimeout(resolve, 450));
        const result = await recordingPromiseRef.current;
        return result?.uri || null;
      } catch {
        return null;
      } finally {
        setIsRecording(false);
        recordingPromiseRef.current = null;
      }
    }, []);

  // Realtime live room via backend adapter
  useEffect(() => {
    if (!activeStreamId) return;

    let isMounted = true;

    const loadInitialStreamData = async () => {
      const bundle = await backend.live.getRoomBundle(activeStreamId, isHost);
      if (!isMounted) return;

      if (bundle.stream) {
        if (bundle.stream.title) setTitleText(bundle.stream.title);
        if (typeof bundle.stream.viewer_count === 'number') {
          setViewerCount(bundle.stream.viewer_count);
          setPeakViewers((p) => Math.max(p, bundle.stream?.viewer_count || 0));
        }
        if (bundle.stream.is_live && !isHost) {
          setStage('live');
        }
      }

      setMessages(
        bundle.messages.map((m) => ({
          ...m,
          kind: inferMessageKind(m.message),
        }))
      );

      if (isHost) {
        setJoinRequests(bundle.pendingRequests);
      }
    };

    void loadInitialStreamData();

    const presenceKey = `${currentUserId}-${isHost ? 'host' : 'viewer'}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    const channel = backend.live.joinLiveRoom(activeStreamId, presenceKey, {
      onMessageInsert: (row) => {
        setMessages((prev) =>
          prev.some((m) => m.id === row.id)
            ? prev
            : [...prev, { ...row, kind: inferMessageKind(row.message) }]
        );
      },
      onMessageDelete: (oldId) => {
        setMessages((prev) => prev.filter((m) => m.id !== oldId));
      },
      onJoinRequestInsert: (row) => {
        if (row.status === 'pending' && isHost) {
          setJoinRequests((prev) =>
            prev.some((r) => r.id === row.id)
              ? prev
              : [...prev, { id: row.id, username: row.username }]
          );
        }
      },
      onJoinRequestUpdate: (row) => {
        if (
          !isHost &&
          (row.id === myJoinRequestId || row.username === resolvedViewerName)
        ) {
          if (row.status === 'accepted') {
            setJoinedCall(true);
            setJoinRequestSent(false);
            Alert.alert(
              'Accepted!',
              `${hostName} accepted your request to join on stage.`
            );
          } else if (row.status === 'declined') {
            setJoinedCall(false);
            setJoinRequestSent(false);
          }
        }
      },
      onStreamUpdate: (row) => {
        if (typeof row.viewer_count === 'number') {
          setViewerCount(row.viewer_count);
          setPeakViewers((p) => Math.max(p, row.viewer_count || 0));
        }
        if (row.title) {
          setTitleText(row.title);
        }
        if (row.is_live === false && !isHost) {
          Alert.alert('Live Ended', `${hostName} ended the live broadcast.`);
          handleExit();
        }
      },
      onBroadcast: (event, payload) => {
        if (event === 'live_reaction' && payload?.emoji) {
          spawnFloatingReaction(payload.emoji, payload.color || '#fb7185');
        } else if (event === 'live_gift_banner' && payload?.title) {
          showTemporaryGiftBanner({
            id: `${Date.now()}`,
            sender: payload.sender || 'Supporter',
            title: payload.title,
            subtitle: payload.subtitle || '',
            color: payload.color || '#fbbf24',
          });
          if (typeof payload.amount === 'number') {
            setEarningsInr((prev) => prev + payload.amount);
          }
        } else if (event === 'live_studio_state' && payload) {
          if ('pinnedMessage' in payload)
            setPinnedMessage(payload.pinnedMessage);
          if (typeof payload.chatEnabled === 'boolean') {
            setSettings((prev) => ({
              ...prev,
              chatEnabled: payload.chatEnabled,
            }));
          }
          if (typeof payload.slowModeSec === 'number') {
            setSettings((prev) => ({
              ...prev,
              slowModeSec: payload.slowModeSec,
            }));
          }
          if (typeof payload.allowJoinRequests === 'boolean') {
            setSettings((prev) => ({
              ...prev,
              allowJoinRequests: payload.allowJoinRequests,
            }));
          }
          if (Array.isArray(payload.activeCoHosts)) {
            setActiveCoHosts(payload.activeCoHosts);
          }
          if (Array.isArray(payload.mutedUsers)) {
            setMutedUsers(payload.mutedUsers);
          }
        } else if (event === 'live_battle_update' && payload) {
          if (typeof payload.active === 'boolean') setBattleActive(payload.active);
          if (typeof payload.hostScore === 'number')
            setBattleHostScore(payload.hostScore);
          if (typeof payload.opponentScore === 'number')
            setBattleOpponentScore(payload.opponentScore);
          if (typeof payload.secondsLeft === 'number')
            setBattleSecondsLeft(payload.secondsLeft);
          if (typeof payload.opponentName === 'string')
            setBattleOpponentName(payload.opponentName);
          if (typeof payload.title === 'string' && payload.title.trim()) {
            setTitleText(payload.title);
          }
        }
      },
      onPresenceSync: (list) => {
        const count = Math.max(1, list.length);
        setPresenceViewers(list);
        setViewerCount(count);
        setPeakViewers((p) => Math.max(p, count));
        if (isHost) {
          void backend.live
            .updateStreamStatus(activeStreamId, { viewer_count: count })
            .catch(() => {});
        }
      },
      onSubscribed: () => {
        channel.track({
          name: isHost ? hostName : resolvedViewerName,
          role: isHost ? 'host' : joinedCall ? 'cohost' : 'viewer',
          joinedAt: new Date().toISOString(),
        });
      },
    });

    channelRef.current = channel;

    return () => {
      isMounted = false;
      channelRef.current = null;
      channel.unsubscribe();
    };
  }, [
    activeStreamId,
    isHost,
    hostName,
    resolvedViewerName,
    currentUserId,
    joinedCall,
    myJoinRequestId,
    handleExit,
    spawnFloatingReaction,
    showTemporaryGiftBanner,
  ]);

  useEffect(() => {
    if (chatVisible && messages.length > 0) {
      const t = setTimeout(() => {
        chatListRef.current?.scrollToEnd({ animated: true });
      }, 60);
      return () => clearTimeout(t);
    }
  }, [messages.length, chatVisible]);

  const hideRightOptions = isCommenting || comment.trim().length > 0;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isCommenting || comment.length > 0) {
        setComment('');
        setIsCommenting(false);
        commentInputRef.current?.blur();
        Keyboard.dismiss();
        return true;
      }
      if (stage === 'countdown' || stage === 'live' || stage === 'ending') {
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [isCommenting, comment, stage]);

  const handleFlipCamera = () => {
    setFacing((prev) => {
      const next = prev === 'front' ? 'back' : 'front';
      if (next === 'front') setTorchEnabled(false);
      return next;
    });
  };

  const handleCycleZoom = () => {
    setZoomIndex((prev) => (prev + 1) % ZOOM_STEPS.length);
  };

  const handleCaptureCoverFrame = async () => {
    if (
      !cameraRef.current ||
      !cameraReady ||
      !cameraEnabled ||
      !permission?.granted
    ) {
      Alert.alert(
        'Camera Unavailable',
        'Enable the camera preview to capture a cover photo.'
      );
      return;
    }
    try {
      const pic = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        shutterSound: false,
      });
      if (pic?.uri) {
        setCoverUri(pic.uri);
      }
    } catch {
      Alert.alert(
        'Snapshot Failed',
        'Could not capture frame from camera.'
      );
    }
  };

  const handlePickCoverImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission Needed',
        'Allow photo library access to select a stream cover.'
      );
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      setCoverUri(res.assets[0].uri);
    }
  };

  const handleSaveDraft = async () => {
    const cleanTitle = titleText.trim() || 'Untitled Live Stream';
    await saveStudioDraft({
      id: draftId || `draft-${Date.now()}`,
      mode: 'live',
      title: cleanTitle,
      category: settings.category,
      description: settings.description.trim(),
      tagsText: settings.tagsText.trim(),
      thumbnailMode: 'custom',
      musicTrackId: null,
      customAudioUri: '',
      mediaUri: '',
      coverUri: isLikelyImageUri(coverUri)
        ? coverUri
        : DEFAULT_COVER[settings.category],
      savedAt: 'Just now',
    });
    Alert.alert(
      'Draft Saved',
      `"${cleanTitle}" saved to Creator Studio Drafts.`
    );
    handleExit();
  };

  const beginLiveBroadcastNow = useCallback(async () => {
    const cleanTitle = titleText.trim();
    setTitleText(cleanTitle);
    liveStartedAtRef.current = Date.now();
    setLiveSeconds(0);
    setViewerCount(1);
    setPeakViewers(1);
    setStage('live');

    setMessages([]);

    let createdId = activeStreamId;
    try {
      const created = await backend.live.createStreamSession({
        hostName,
        title: cleanTitle || `${hostName} Live`,
      });
      if (created?.id) {
        createdId = created.id;
        setActiveStreamId(created.id);
      }
    } catch (err: any) {
      Alert.alert(
        'Stream Create Warning',
        `${err?.message || 'Unable to sync stream'} — running in local studio mode.`
      );
    }

    if (draftId) {
      void deleteStudioDraft(draftId);
    }

    setTimeout(() => {
      void startCameraRecording();
    }, 350);

    onStartLive?.({ title: cleanTitle, streamId: createdId });
  }, [titleText, activeStreamId, hostName, draftId, startCameraRecording, onStartLive]);

  const handleGoLiveWithCountdown = () => {
    if (stage !== 'setup') return;
    if (!titleText.trim()) {
      Alert.alert('Stream Title Required', 'Enter a title before going live.');
      return;
    }

    setCountdownValue(3);
    setStage('countdown');

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    let remaining = 3;
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCountdownValue(remaining);
      } else {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        void beginLiveBroadcastNow();
      }
    }, 900);
  };

  const handleCancelCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setStage('setup');
  };

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  const appendAndPersistMessage = useCallback(
    async (
      senderName: string,
      text: string,
      color = '#FFFFFF',
      kind: ChatKind = 'normal'
    ) => {
      const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const optimisticMsg: ChatMessageItem = {
        id: tempId,
        username: senderName,
        message: text,
        color,
        kind,
      };

      if (!chatVisible) {
        setChatVisible(true);
      }

      setMessages((previous) => [...previous, optimisticMsg]);

      if (activeStreamId) {
        try {
          const data = await backend.live.sendChatMessage({
            streamId: activeStreamId,
            username: senderName,
            message: text,
            color,
          });

          if (data) {
            setMessages((prev) =>
              prev.map((item) =>
                item.id === tempId
                  ? {
                      id: data.id,
                      username: data.username,
                      message: data.message,
                      color: data.color,
                      kind,
                    }
                  : item
              )
            );
          }
        } catch {
          // keep optimistic message
        }
      }
    },
    [activeStreamId, chatVisible]
  );

  const sendComment = async () => {
    const text = comment.trim();
    if (!text) return;

    const senderName = isHost ? hostName : resolvedViewerName;

    if (!isHost) {
      if (!settings.chatEnabled) {
        Alert.alert(
          'Chat Paused',
          'The host has paused comments for this live stream.'
        );
        return;
      }
      if (mutedUsers.includes(senderName)) {
        Alert.alert(
          'Muted',
          'You have been muted by the host in this live session.'
        );
        return;
      }
      if (settings.slowModeSec > 0) {
        const elapsed = (Date.now() - lastSentCommentAtRef.current) / 1000;
        if (elapsed < settings.slowModeSec) {
          const wait = Math.ceil(settings.slowModeSec - elapsed);
          setSlowModeWaitSec(wait);
          Alert.alert(
            'Slow Mode Active',
            `Please wait ${wait}s before sending another message.`
          );
          return;
        }
      }
    }

    lastSentCommentAtRef.current = Date.now();
    if (!isHost && settings.slowModeSec > 0) {
      setSlowModeWaitSec(settings.slowModeSec);
    }

    setComment('');
    setIsCommenting(false);
    commentInputRef.current?.blur();
    Keyboard.dismiss();

    await appendAndPersistMessage(
      senderName,
      text,
      isHost ? '#fb7185' : '#FFFFFF',
      'normal'
    );
  };

  const handleSendReaction = (emoji = '❤️', color = '#fb7185') => {
    spawnFloatingReaction(emoji, color);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'live_reaction',
      payload: { emoji, color },
    });
  };

  const handleStageDoubleTap = () => {
    if (!isLiveStarted) return;
    const now = Date.now();
    if (now - lastStageTapRef.current < 280) {
      handleSendReaction('❤️', '#fb7185');
      lastStageTapRef.current = 0;
    } else {
      lastStageTapRef.current = now;
    }
  };

  const handleSendGift = (gift: LiveGiftOption) => {
    const senderName = isHost ? hostName : resolvedViewerName;
    const message = `Sent ${gift.emoji} ${gift.label} (₹${gift.amount})`;
    void appendAndPersistMessage(senderName, message, gift.color, 'gift');
    setEarningsInr((prev) => prev + gift.amount);
    spawnFloatingReaction(gift.emoji, gift.color);

    const banner: GiftBannerState = {
      id: `${Date.now()}`,
      sender: senderName,
      title: `${gift.emoji} ${gift.label} · ₹${gift.amount}`,
      subtitle: `from ${senderName}`,
      color: gift.color,
    };
    showTemporaryGiftBanner(banner);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'live_reaction',
      payload: { emoji: gift.emoji, color: gift.color },
    });
    channelRef.current?.send({
      type: 'broadcast',
      event: 'live_gift_banner',
      payload: {
        sender: senderName,
        title: banner.title,
        subtitle: banner.subtitle,
        color: gift.color,
        amount: gift.amount,
      },
    });
  };

  const handleSendSuperchat = (option: LiveSuperchatOption, note: string) => {
    const senderName = isHost ? hostName : resolvedViewerName;
    const text = note
      ? `${option.badge} Superchat ₹${option.amount}: ${note}`
      : `${option.badge} Superchat ₹${option.amount}!`;
    void appendAndPersistMessage(senderName, text, option.color, 'superchat');
    setEarningsInr((prev) => prev + option.amount);
    spawnFloatingReaction(option.badge, option.color);

    const banner: GiftBannerState = {
      id: `${Date.now()}`,
      sender: senderName,
      title: `${option.badge} Superchat ₹${option.amount}`,
      subtitle: note || `Supported ${hostName}`,
      color: option.color,
    };
    showTemporaryGiftBanner(banner);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'live_gift_banner',
      payload: {
        sender: senderName,
        title: banner.title,
        subtitle: banner.subtitle,
        color: option.color,
        amount: option.amount,
      },
    });
  };

  const handlePinMessage = (text: string) => {
    setPinnedMessage(text);
    broadcastStudioState({ pinnedMessage: text });
  };

  const handleUnpinMessage = () => {
    setPinnedMessage(null);
    broadcastStudioState({ pinnedMessage: null });
  };

  const handleHostModerateMessage = (item: ChatMessageItem) => {
    if (!isHost || item.kind === 'system') return;
    Alert.alert(item.username, item.message, [
      {
        text: '📌 Pin Message',
        onPress: () => handlePinMessage(`${item.username}: ${item.message}`),
      },
      {
        text: '🗑️ Delete Message',
        style: 'destructive',
        onPress: () => {
          setMessages((prev) => prev.filter((m) => m.id !== item.id));
          void backend.live.deleteChatMessage(item.id).catch(() => {});
        },
      },
      ...(item.username !== hostName
        ? [
            {
              text: mutedUsers.includes(item.username)
                ? '🔊 Unmute User'
                : '🔇 Mute User',
              onPress: () => {
                setMutedUsers((prev) => {
                  const next = prev.includes(item.username)
                    ? prev.filter((u) => u !== item.username)
                    : [...prev, item.username];
                  broadcastStudioState({ mutedUsers: next });
                  return next;
                });
              },
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleCommitLiveTitle = async (nextTitle: string) => {
    const clean = nextTitle.trim();
    if (!clean) return;
    setTitleText(clean);
    broadcastStudioState({ title: clean });
    if (activeStreamId) {
      await backend.live
        .updateStreamStatus(activeStreamId, { title: clean })
        .catch(() => {});
    }
    Alert.alert('Updated', 'Live stream title updated.');
  };

  const handleRequestToJoin = async () => {
    if (!settings.allowJoinRequests && !joinedCall && !joinRequestSent) {
      Alert.alert(
        'Requests Disabled',
        'The host is not accepting guest requests right now.'
      );
      return;
    }

    if (joinedCall) {
      setJoinedCall(false);
      setJoinRequestSent(false);
      setActiveCoHosts((prev) => {
        const next = prev.filter((u) => u !== resolvedViewerName);
        broadcastStudioState({ activeCoHosts: next });
        return next;
      });
      return;
    }

    if (joinRequestSent) {
      setJoinRequestSent(false);
      setJoinRequests((prev) =>
        prev.filter((item) => item.id !== 'viewer-self-request')
      );
      return;
    }

    setJoinRequestSent(true);

    if (activeStreamId) {
      try {
        const created = await backend.live.createJoinRequest({
          streamId: activeStreamId,
          username: resolvedViewerName,
        });
        if (created?.id) {
          setMyJoinRequestId(created.id);
        }
      } catch {}
    } else {
      setJoinRequests((prev) => [
        { id: 'viewer-self-request', username: resolvedViewerName },
        ...prev.filter((item) => item.id !== 'viewer-self-request'),
      ]);
    }

    Alert.alert(
      'Request Sent',
      'Your request to join on stage has been sent to the host.'
    );
  };

  const handleAcceptJoin = async (requestId: string, username: string) => {
    setJoinRequests((prev) => prev.filter((item) => item.id !== requestId));
    if (requestId === 'viewer-self-request') {
      setJoinedCall(true);
    } else {
      await backend.live
        .updateJoinRequestStatus(requestId, 'accepted')
        .catch(() => {});
    }

    setActiveCoHosts((prev) => {
      const next = prev.includes(username) ? prev : [...prev, username];
      broadcastStudioState({ activeCoHosts: next });
      return next;
    });

    void appendAndPersistMessage(
      'Studio',
      `${username} joined the live stage!`,
      '#34d399',
      'system'
    );
  };

  const handleDeclineJoin = async (requestId: string) => {
    setJoinRequests((prev) => prev.filter((item) => item.id !== requestId));
    if (requestId === 'viewer-self-request') {
      setJoinRequestSent(false);
    } else {
      await backend.live
        .updateJoinRequestStatus(requestId, 'declined')
        .catch(() => {});
    }
  };

  const handleRemoveCoHost = (username: string) => {
    setActiveCoHosts((prev) => {
      const next = prev.filter((u) => u !== username);
      broadcastStudioState({ activeCoHosts: next });
      return next;
    });
  };

  const handleShareStream = async () => {
    try {
      await Share.share({
        message: `🔴 Watch ${hostName} Live on VibeSphere: "${titleText}"`,
      });
    } catch {
      // ignore cancel
    }
  };

  const publishReplayToWatchFeed = useCallback(
    async (
      videoUrl: string,
      localUriForThumb: string | null,
      durationSec: number
    ) => {
      let resolvedCover = isLikelyImageUri(coverUri)
        ? coverUri
        : DEFAULT_COVER[settings.category];

      if (!isLikelyImageUri(coverUri) && localUriForThumb) {
        try {
          const thumb = await VideoThumbnails.getThumbnailAsync(
            localUriForThumb,
            {
              time: 1000,
            }
          );
          if (thumb?.uri) {
            resolvedCover = thumb.uri;
          }
        } catch {
          // keep default cover
        }
      }

      const payload = await publishCreatorItem({
        mode: 'live',
        title: titleText.trim() || 'Live Broadcast Replay',
        description:
          settings.description.trim() ||
          `Live stream replay by ${hostName} (${formatDuration(durationSec)}).`,
        category: settings.category,
        tags: parseTags(settings.tagsText),
        thumbnailMode: 'custom',
        mediaUri: videoUrl,
        coverUri: resolvedCover,
        allowComments: settings.chatEnabled,
        monetize: settings.monetizeEnabled,
      });

      DeviceEventEmitter.emit('watch-media-created', {
        ...payload,
        total_seconds: durationSec,
        visibility: settings.visibility,
      });
      setPublishedToWatch(true);
    },
    [coverUri, settings, titleText, hostName]
  );

  const finalizeAndEndHostLive = async () => {
    const finalDuration = liveSeconds;
    setStage('ending');
    setEndingStatusText('Finalizing broadcast recording...');

    let uploadedUrl: string | null = null;
    let capturedLocalUri: string | null = null;

    try {
      capturedLocalUri = await stopAndCaptureRecordingUri();
      if (capturedLocalUri) {
        setLocalRecordingUri(capturedLocalUri);
        setEndingStatusText('Uploading replay to cloud storage...');
        const url = await backend.live.uploadRecordingReplay(
          capturedLocalUri,
          activeStreamId
        );
        if (url) {
          uploadedUrl = url;
          setReplayUrl(url);
          onRecordingSaved?.(url);
        }
      }

      if (activeStreamId) {
        setEndingStatusText('Closing live room...');
        await backend.live
          .updateStreamStatus(activeStreamId, {
            is_live: false,
            viewer_count: viewerCount,
          })
          .catch(() => {});
      }

      if (uploadedUrl && settings.publishReplayToWatch) {
        setEndingStatusText('Publishing replay to Watch...');
        try {
          await publishReplayToWatchFeed(
            uploadedUrl,
            capturedLocalUri,
            finalDuration
          );
        } catch {
          // allow manual retry on summary screen
        }
      }
    } finally {
      setStage('summary');
    }
  };

  const handleEndLive = () => {
    if (stage === 'setup') {
      handleExit();
      return;
    }
    if (stage === 'countdown') {
      handleCancelCountdown();
      return;
    }
    if (stage === 'ending') return;

    if (!isHost) {
      handleExit();
      return;
    }

    Alert.alert(
      'End Live Stream?',
      settings.autoRecordReplay
        ? 'Your live broadcast will end and your replay will be saved.'
        : 'Are you sure you want to end this live broadcast?',
      [
        { text: 'Keep Streaming', style: 'cancel' },
        {
          text: 'End Live',
          style: 'destructive',
          onPress: () => void finalizeAndEndHostLive(),
        },
      ]
    );
  };

  const handleSaveReplayToDevice = async () => {
    if (!localRecordingUri) return;
    try {
      setIsSavingToDevice(true);
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert(
          'Permission Required',
          'Allow media library permission to save the video.'
        );
        return;
      }
      await MediaLibrary.Asset.create(localRecordingUri);
      setSavedToDevice(true);
      Alert.alert(
        'Saved!',
        'Your live stream replay has been saved to your device gallery.'
      );
    } catch (err: any) {
      Alert.alert(
        'Save Failed',
        err?.message || 'Unable to save video to gallery.'
      );
    } finally {
      setIsSavingToDevice(false);
    }
  };

  const handleManualPublishToWatch = async () => {
    if (!replayUrl) return;
    try {
      setIsPublishingToWatch(true);
      await publishReplayToWatchFeed(replayUrl, localRecordingUri, liveSeconds);
      Alert.alert(
        'Published!',
        'Your live replay is now available in the Watch feed.'
      );
    } catch (err: any) {
      Alert.alert(
        'Publish Failed',
        err?.message || 'Could not publish replay to Watch.'
      );
    } finally {
      setIsPublishingToWatch(false);
    }
  };

  const handleResetToSetup = () => {
    setActiveStreamId(undefined);
    setMessages([]);
    setJoinRequests([]);
    setActiveCoHosts([]);
    setPinnedMessage(null);
    setReplayUrl(null);
    setLocalRecordingUri(null);
    setPublishedToWatch(false);
    setSavedToDevice(false);
    setLiveSeconds(0);
    setReactionsCount(0);
    setEarningsInr(0);
    setViewerCount(0);
    setPeakViewers(0);
    setStage('setup');
  };

  const needsPermissionGate =
    isHost &&
    !skipPermissionGate &&
    permission !== null &&
    micPermission !== null &&
    (!permission.granted || !micPermission.granted);

  const previewBannerUri = useMemo(() => {
    if (isLikelyImageUri(coverUri)) return coverUri;
    return DEFAULT_COVER[settings.category];
  }, [coverUri, settings.category]);

  const topPad = Math.max(insets.top, 20) + 8;
  const bottomPad = Math.max(insets.bottom, 16) + 10;

  if (stage === 'summary') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <PostLiveSummaryView
          title={titleText}
          durationSeconds={liveSeconds}
          peakViewers={peakViewers}
          messagesCount={messages.filter((m) => m.kind !== 'system').length}
          reactionsCount={reactionsCount}
          earningsInr={earningsInr}
          replayUrl={replayUrl}
          localRecordingUri={localRecordingUri}
          publishedToWatch={publishedToWatch}
          isPublishingToWatch={isPublishingToWatch}
          isSavingToDevice={isSavingToDevice}
          savedToDevice={savedToDevice}
          onSaveToDevice={handleSaveReplayToDevice}
          onPublishToWatch={handleManualPublishToWatch}
          onShareReplay={handleShareStream}
          onOpenWatch={() => router.replace('/(tabs)/watch' as any)}
          onGoLiveAgain={handleResetToSetup}
          onDone={handleExit}
          topInset={insets.top}
          bottomInset={insets.bottom}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {(cameraEnabled || isRecording) && permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="video"
          videoQuality="1080p"
          enableTorch={facing === 'back' && torchEnabled}
          mirror={facing === 'front' && isMirrored}
          zoom={zoomLevel}
          mute={!micEnabled || !micPermission?.granted}
          onCameraReady={() => setCameraReady(true)}
        />
      ) : (
        <View style={styles.cameraFallback} />
      )}

      {!cameraEnabled && (
        <View style={styles.cameraOffSlate}>
          {hostProfile.avatarUri ? (
            <Image
              source={{ uri: hostProfile.avatarUri }}
              style={styles.slateAvatar}
            />
          ) : (
            <View style={styles.slateAvatarFallback}>
              <Text style={styles.slateAvatarInitial}>{hostInitial}</Text>
            </View>
          )}
          <Text style={styles.slateTitle}>Camera is Off</Text>
          <Text style={styles.slateSubtitle}>
            {micEnabled
              ? 'Audio-only broadcast mode active'
              : 'Camera & Microphone muted'}
          </Text>
        </View>
      )}

      {isLiveStarted && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleStageDoubleTap}
        />
      )}

      <View style={styles.screenContent} pointerEvents="box-none">
        <View pointerEvents="box-none">
          <View style={[styles.topHeader, { paddingTop: topPad }]}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.hostInfo}
              onPress={() =>
                router.push({
                  pathname: '/profile',
                  params: {
                    ...(currentUserId && currentUserId !== 'anon'
                      ? { userId: currentUserId }
                      : {}),
                    ...(hostName ? { displayName: hostName } : {}),
                    fromLive: '1',
                  },
                } as any)
              }
            >
              <View
                style={[
                  styles.avatarRing,
                  isLiveStarted && styles.avatarRingLive,
                ]}
              >
                {hostProfile.avatarUri ? (
                  <Image
                    source={{ uri: hostProfile.avatarUri }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{hostInitial}</Text>
                  </View>
                )}
              </View>

              <View style={styles.hostDetails}>
                <Text style={styles.hostName} numberOfLines={1}>
                  {hostName}
                </Text>
                <Text style={styles.followers} numberOfLines={1}>
                  {following
                    ? `Following · ${formattedFollowers} followers`
                    : `${formattedFollowers} followers`}
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.headerRight}>
              {isLiveStarted ? (
                <>
                  <View style={styles.liveBadge}>
                    <Animated.View
                      style={[styles.liveDot, { opacity: livePulseAnim }]}
                    />
                    <Text style={styles.liveText}>
                      {`LIVE · ${formatDuration(liveSeconds)}`}
                    </Text>
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setIsAnalyticsOpen(true)}
                    style={styles.viewerBadge}
                  >
                    <Feather name="users" size={13} color="#fff" />
                    <Text style={styles.viewerText}>
                      {viewerCount.toLocaleString()}
                    </Text>
                  </TouchableOpacity>

                  <StudioIconButton onPress={handleShareStream}>
                    <Feather name="share-2" size={16} color="#fff" />
                  </StudioIconButton>

                  <StudioIconButton
                    onPress={() => {
                      openMiniPlayer({
                        id: activeStreamId || 'live-session',
                        kind: 'live',
                        title: titleText.trim() || `${hostName} Live`,
                        creatorName: hostName,
                        thumbnailUrl:
                          previewBannerUri || hostProfile.avatarUri || undefined,
                        isLive: true,
                        isPlaying: true,
                        expandRoute: '/studio/live',
                        expandParams: {
                          mode: effectiveMode,
                          ...(activeStreamId ? { streamId: activeStreamId } : {}),
                          ...(titleText ? { title: titleText } : {}),
                        },
                      });
                      router.back();
                    }}
                  >
                    <Ionicons name="albums-outline" size={16} color="#fff" />
                  </StudioIconButton>
                </>
              ) : (
                <>
                  {isHost && (
                    <TouchableOpacity
                      style={styles.draftSavePill}
                      onPress={handleSaveDraft}
                      activeOpacity={0.8}
                    >
                      <Feather name="bookmark" size={13} color="#e2e8f0" />
                      <Text style={styles.draftSaveText}>Draft</Text>
                    </TouchableOpacity>
                  )}
                  <View style={styles.previewBadge}>
                    <Text style={styles.previewBadgeText}>STUDIO</Text>
                  </View>
                </>
              )}

              <StudioIconButton
                onPress={handleEndLive}
                style={styles.closeButton}
              >
                <Feather name="x" size={18} color="#fff" />
              </StudioIconButton>
            </View>
          </View>

          {isLiveStarted && (
            <View style={styles.liveMetaSection} pointerEvents="box-none">
              <View style={styles.titleAndRequestsRow} pointerEvents="box-none">
                <TouchableOpacity
                  activeOpacity={isHost ? 0.75 : 1}
                  onPress={() => isHost && setIsSettingsOpen(true)}
                  style={styles.liveTitleWrap}
                >
                  {titleText ? (
                    <Text style={styles.streamTitle} numberOfLines={2}>
                      {titleText}
                    </Text>
                  ) : null}
                  <Text style={styles.streamCategorySub}>
                    {settings.category} · {settings.visibility.toUpperCase()}
                    {settings.slowModeSec > 0
                      ? ` · Slow ${settings.slowModeSec}s`
                      : ''}
                  </Text>
                </TouchableOpacity>

                {isHost && joinRequests.length > 0 && (
                  <View style={styles.joinRequestsRightColumn}>
                    {joinRequests.slice(0, 2).map((req) => (
                      <View key={req.id} style={styles.joinRequestCard}>
                        <Text style={styles.joinRequestLabel}>JOIN REQUEST</Text>
                        <Text style={styles.joinRequestName} numberOfLines={1}>
                          {req.username}
                        </Text>
                        <View style={styles.joinRequestActions}>
                          <TouchableOpacity
                            activeOpacity={0.8}
                            onPress={() =>
                              void handleAcceptJoin(req.id, req.username)
                            }
                            style={styles.acceptBtn}
                          >
                            <Feather name="check" color="#fff" size={13} />
                            <Text style={styles.actionBtnText}>Accept</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            activeOpacity={0.8}
                            onPress={() => void handleDeclineJoin(req.id)}
                            style={styles.declineBtn}
                          >
                            <Feather name="x" color="#e2e8f0" size={13} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {battleActive ? (
                <View style={styles.battleCard}>
                  <View style={styles.battleTopRow}>
                    <Text style={styles.battleTeamLabel}>
                      {hostName} · {battleHostScore}
                    </Text>
                    <View style={styles.battleTimerPill}>
                      <Ionicons name="flash" size={11} color="#fbbf24" />
                      <Text style={styles.battleTimerText}>
                        PK · {formatDuration(battleSecondsLeft)}
                      </Text>
                    </View>
                    <Text style={styles.battleTeamLabel}>
                      {battleOpponentScore} · {battleOpponentName}
                    </Text>
                  </View>
                  <View style={styles.battleTrack}>
                    <View
                      style={[
                        styles.battleFillLeft,
                        {
                          flex: Math.max(1, battleHostScore + 10),
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.battleFillRight,
                        {
                          flex: Math.max(1, battleOpponentScore + 10),
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.battleBoostRow}>
                    <TouchableOpacity
                      style={styles.battleBoostLeftBtn}
                      onPress={() => handleBoostBattleSide('host')}
                    >
                      <Text style={styles.battleBoostText}>+10 Team {hostName.split(' ')[0]}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.battleBoostRightBtn}
                      onPress={() => handleBoostBattleSide('opponent')}
                    >
                      <Text style={styles.battleBoostText}>+10 {battleOpponentName}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {pinnedMessage ? (
                <View style={styles.pinnedBanner}>
                  <Ionicons name="pin" size={14} color="#38bdf8" />
                  <Text style={styles.pinnedBannerText} numberOfLines={2}>
                    {pinnedMessage}
                  </Text>
                  {isHost && (
                    <TouchableOpacity onPress={handleUnpinMessage}>
                      <Feather name="x" size={14} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>
              ) : null}

              {(activeCoHosts.length > 0 || joinedCall) && (
                <View style={styles.coHostRow}>
                  <View style={styles.coHostPill}>
                    <View style={styles.coHostDot} />
                    <Text style={styles.coHostText}>
                      {joinedCall
                        ? 'You are on stage with host'
                        : `On stage: ${activeCoHosts.join(', ')}`}
                    </Text>
                    {joinedCall && (
                      <TouchableOpacity onPress={() => void handleRequestToJoin()}>
                        <Text style={styles.leaveStageText}>Leave</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {giftBanner ? (
                <View
                  style={[styles.giftToast, { borderColor: giftBanner.color }]}
                >
                  <Text
                    style={[styles.giftToastTitle, { color: giftBanner.color }]}
                  >
                    {giftBanner.title}
                  </Text>
                  <Text style={styles.giftToastSub}>{giftBanner.subtitle}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {stage === 'setup' ? (
          <View style={styles.preLiveOuter} pointerEvents="box-none">
            {isHost && (
              <View style={styles.rightToolRail}>
                <TouchableOpacity
                  style={styles.railBtn}
                  onPress={handleFlipCamera}
                >
                  <Feather name="refresh-cw" size={19} color="#fff" />
                  <Text style={styles.railLabel}>Flip</Text>
                </TouchableOpacity>

                {facing === 'back' ? (
                  <TouchableOpacity
                    style={[
                      styles.railBtn,
                      torchEnabled && styles.railBtnActive,
                    ]}
                    onPress={() => setTorchEnabled((v) => !v)}
                  >
                    <Ionicons
                      name={torchEnabled ? 'flash' : 'flash-off'}
                      size={19}
                      color={torchEnabled ? '#fbbf24' : '#fff'}
                    />
                    <Text style={styles.railLabel}>Flash</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.railBtn,
                      isMirrored && styles.railBtnActive,
                    ]}
                    onPress={() => setIsMirrored((v) => !v)}
                  >
                    <Ionicons name="swap-horizontal" size={19} color="#fff" />
                    <Text style={styles.railLabel}>Mirror</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.railBtn}
                  onPress={handleCycleZoom}
                >
                  <Text style={styles.zoomBadgeText}>
                    {zoomLevel === 0
                      ? '1x'
                      : zoomLevel === 0.15
                        ? '1.5x'
                        : '2x'}
                  </Text>
                  <Text style={styles.railLabel}>Zoom</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.railBtn}
                  onPress={handleCaptureCoverFrame}
                >
                  <Ionicons name="camera-outline" size={20} color="#fff" />
                  <Text style={styles.railLabel}>Snap</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.railBtn}
                  onPress={() => setIsSettingsOpen(true)}
                >
                  <Ionicons name="options-outline" size={20} color="#fff" />
                  <Text style={styles.railLabel}>Setup</Text>
                </TouchableOpacity>
              </View>
            )}

            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={[styles.preLiveContainer, { paddingBottom: bottomPad }]}
            >
              <View style={styles.preLiveCard}>
                <View style={styles.preLiveTopRow}>
                  <TouchableOpacity
                    style={styles.coverPickerBox}
                    onPress={handlePickCoverImage}
                    activeOpacity={0.85}
                  >
                    <Image
                      source={{ uri: previewBannerUri }}
                      style={styles.coverThumb}
                    />
                    <View style={styles.coverOverlayBadge}>
                      <Ionicons name="image-outline" size={12} color="#fff" />
                      <Text style={styles.coverOverlayText}>Cover</Text>
                    </View>
                  </TouchableOpacity>

                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={styles.preLiveHeaderRow}>
                      <Text style={styles.preLiveLabel}>STREAM TITLE</Text>
                      <Text style={styles.charCounter}>
                        {titleText.length}/100
                      </Text>
                    </View>
                    <TextInput
                      value={titleText}
                      onChangeText={setTitleText}
                      placeholder="What are you streaming today?"
                      placeholderTextColor="#94a3b8"
                      style={styles.preLiveInput}
                      maxLength={100}
                    />
                  </View>
                </View>

                <View style={styles.preLiveMetaRow}>
                  <TouchableOpacity
                    style={styles.metaChip}
                    onPress={() => setIsSettingsOpen(true)}
                  >
                    <Ionicons
                      name="pricetag-outline"
                      size={13}
                      color="#38bdf8"
                    />
                    <Text style={styles.metaChipText}>
                      {settings.category}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.metaChip}
                    onPress={() => setIsSettingsOpen(true)}
                  >
                    <Ionicons
                      name={
                        settings.visibility === 'private'
                          ? 'lock-closed-outline'
                          : settings.visibility === 'subscribers'
                            ? 'people-outline'
                            : 'globe-outline'
                      }
                      size={13}
                      color="#a855f7"
                    />
                    <Text style={styles.metaChipText}>
                      {settings.visibility.charAt(0).toUpperCase() +
                        settings.visibility.slice(1)}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.metaChip}
                    onPress={() => setIsSettingsOpen(true)}
                  >
                    <Ionicons
                      name={
                        settings.autoRecordReplay
                          ? 'recording-outline'
                          : 'ban-outline'
                      }
                      size={13}
                      color={settings.autoRecordReplay ? '#34d399' : '#94a3b8'}
                    />
                    <Text style={styles.metaChipText}>
                      {settings.autoRecordReplay ? 'Replay On' : 'No Replay'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.preLiveToggles}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setMicEnabled((v) => !v)}
                    style={[
                      styles.preLiveChip,
                      !micEnabled && styles.preLiveChipOff,
                    ]}
                  >
                    {micEnabled ? (
                      <Feather name="mic" color="#fff" size={15} />
                    ) : (
                      <Feather name="mic-off" color="#fb7185" size={15} />
                    )}
                    <Text style={styles.preLiveChipText}>
                      {micEnabled ? 'Mic On' : 'Mic Off'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setCameraEnabled((v) => !v)}
                    style={[
                      styles.preLiveChip,
                      !cameraEnabled && styles.preLiveChipOff,
                    ]}
                  >
                    {cameraEnabled ? (
                      <Feather name="video" color="#fff" size={15} />
                    ) : (
                      <Feather name="video-off" color="#fb7185" size={15} />
                    )}
                    <Text style={styles.preLiveChipText}>
                      {cameraEnabled ? 'Camera On' : 'Camera Off'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setIsSettingsOpen(true)}
                    style={styles.preLiveChip}
                  >
                    <Ionicons name="settings-outline" color="#fff" size={15} />
                    <Text style={styles.preLiveChipText}>More</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setIsScheduleModalOpen(true)}
                  style={styles.schedulePreBtn}
                >
                  <Ionicons name="calendar-outline" color="#fff" size={18} />
                  <Text style={styles.schedulePreBtnText}>Schedule</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleGoLiveWithCountdown}
                  style={[styles.goLiveButton, { flex: 1 }]}
                >
                  <Feather name="radio" color="#fff" size={20} />
                  <Text style={styles.goLiveText}>Go Live</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        ) : stage === 'live' ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.lowerSection}
            pointerEvents="box-none"
          >
            <View style={styles.chatAndHeartsRow} pointerEvents="box-none">
              <View style={styles.chatContainer} pointerEvents="box-none">
                <View style={styles.chatToolbarRow}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setChatVisible((v) => !v)}
                    style={styles.chatToggleChip}
                  >
                    {chatVisible ? (
                      <>
                        <Feather name="eye-off" color="#e2e8f0" size={13} />
                        <Text style={styles.chatToggleText}>Hide Chat</Text>
                      </>
                    ) : (
                      <>
                        <Feather name="eye" color="#38bdf8" size={13} />
                        <Text style={styles.chatToggleText}>Show Chat</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {isHost && earningsInr > 0 ? (
                    <View style={styles.earningsChip}>
                      <Ionicons name="sparkles" size={12} color="#fbbf24" />
                      <Text style={styles.earningsChipText}>
                        ₹{earningsInr}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {chatVisible && messages.length > 0 && (
                  <FlatList
                    ref={chatListRef}
                    data={messages}
                    keyExtractor={(item) => item.id}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.chatList}
                    renderItem={({ item }) => {
                      const isSuper = item.kind === 'superchat';
                      const isGift = item.kind === 'gift';
                      const isSys = item.kind === 'system';

                      return (
                        <TouchableOpacity
                          activeOpacity={isHost && !isSys ? 0.75 : 1}
                          onLongPress={() => handleHostModerateMessage(item)}
                          onPress={() =>
                            isHost && !isSys && handleHostModerateMessage(item)
                          }
                          style={[
                            styles.chatItem,
                            isSuper && [
                              styles.chatItemSuperchat,
                              { borderColor: item.color },
                            ],
                            isGift && styles.chatItemGift,
                            isSys && styles.chatItemSystem,
                          ]}
                        >
                          <Text
                            style={[styles.chatUsername, { color: item.color }]}
                          >
                            {item.username}
                          </Text>
                          <Text style={styles.chatMessage}>{item.message}</Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}
              </View>

              <View style={styles.rightChatColumn} pointerEvents="box-none">
                <LiveFloatingReactions
                  reactions={floatingReactions}
                  onComplete={removeFloatingReaction}
                />

                {!isHost && !following && !hideRightOptions && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setFollowing(true)}
                    style={styles.followAlignedButton}
                  >
                    <Text style={styles.followAlignedText}>Follow</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={[styles.bottomSection, { paddingBottom: bottomPad }]}>
              <View style={styles.composerRow}>
                <View
                  style={[
                    styles.inputContainer,
                    hideRightOptions && styles.inputContainerExpanded,
                  ]}
                >
                  <TextInput
                    ref={commentInputRef}
                    value={comment}
                    onChangeText={setComment}
                    onFocus={() => setIsCommenting(true)}
                    onBlur={() => setIsCommenting(false)}
                    editable={isHost || settings.chatEnabled}
                    placeholder={
                      !isHost && !settings.chatEnabled
                        ? 'Comments paused by host'
                        : slowModeWaitSec > 0
                          ? `Slow mode: wait ${slowModeWaitSec}s...`
                          : isHost
                            ? 'Comment or tap msg to pin...'
                            : 'Add a comment...'
                    }
                    placeholderTextColor="#94a3b8"
                    style={styles.commentInput}
                    returnKeyType="send"
                    onSubmitEditing={() => void sendComment()}
                    maxLength={300}
                  />

                  <TouchableOpacity
                    onPress={() => void sendComment()}
                    style={styles.sendButton}
                  >
                    <Feather name="send" color="#fff" size={17} />
                  </TouchableOpacity>
                </View>

                {!hideRightOptions && (
                  <View style={styles.rightActions}>
                    {isHost ? (
                      <>
                        <StudioIconButton
                          style={styles.hostAction}
                          onPress={() => setMicEnabled((v) => !v)}
                        >
                          {micEnabled ? (
                            <Feather name="mic" color="#fff" size={17} />
                          ) : (
                            <Feather
                              name="mic-off"
                              color="#fb7185"
                              size={17}
                            />
                          )}
                        </StudioIconButton>

                        <StudioIconButton
                          style={styles.hostAction}
                          onPress={() => setCameraEnabled((v) => !v)}
                        >
                          {cameraEnabled ? (
                            <Feather name="video" color="#fff" size={17} />
                          ) : (
                            <Feather
                              name="video-off"
                              color="#fb7185"
                              size={17}
                            />
                          )}
                        </StudioIconButton>

                        <StudioIconButton
                          style={styles.hostAction}
                          onPress={handleFlipCamera}
                        >
                          <Feather name="refresh-cw" color="#fff" size={17} />
                        </StudioIconButton>

                        <StudioIconButton
                          style={styles.hostAction}
                          badgeCount={joinRequests.length}
                          onPress={() => setIsGuestsOpen(true)}
                        >
                          <Feather name="user-plus" color="#fff" size={17} />
                        </StudioIconButton>

                        <StudioIconButton
                          active={battleActive}
                          style={styles.hostAction}
                          onPress={handleToggleBattleMode}
                        >
                          <Ionicons
                            name="flash"
                            color={battleActive ? '#fbbf24' : '#fff'}
                            size={17}
                          />
                        </StudioIconButton>

                        <StudioIconButton
                          style={styles.hostAction}
                          onPress={() => setIsSettingsOpen(true)}
                        >
                          <Ionicons
                            name="options-outline"
                            color="#fff"
                            size={18}
                          />
                        </StudioIconButton>

                        <StudioIconButton
                          style={styles.heartBtn}
                          onPress={() => handleSendReaction('❤️', '#fb7185')}
                        >
                          <Ionicons name="heart" color="#fff" size={17} />
                        </StudioIconButton>
                      </>
                    ) : (
                      <>
                        {settings.monetizeEnabled && (
                          <>
                            <StudioIconButton
                              onPress={() => setGiftSheetTab('superchat')}
                            >
                              <Ionicons
                                name="sparkles"
                                color="#fbbf24"
                                size={17}
                              />
                            </StudioIconButton>

                            <StudioIconButton
                              onPress={() => setGiftSheetTab('gift')}
                            >
                              <Feather name="gift" color="#fff" size={17} />
                            </StudioIconButton>
                          </>
                        )}

                        <StudioIconButton
                          active={joinRequestSent || joinedCall}
                          onPress={() => void handleRequestToJoin()}
                        >
                          {joinedCall ? (
                            <Feather name="check" color="#34d399" size={17} />
                          ) : (
                            <Feather
                              name="user-plus"
                              color={joinRequestSent ? '#38bdf8' : '#fff'}
                              size={17}
                            />
                          )}
                        </StudioIconButton>

                        <StudioIconButton
                          style={styles.heartBtn}
                          onPress={() => handleSendReaction('❤️', '#fb7185')}
                        >
                          <Ionicons name="heart" color="#fff" size={17} />
                        </StudioIconButton>
                      </>
                    )}
                  </View>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        ) : null}
      </View>

      {needsPermissionGate && stage === 'setup' && (
        <PermissionGateCard
          cameraGranted={Boolean(permission?.granted)}
          micGranted={Boolean(micPermission?.granted)}
          canAskCamera={permission?.canAskAgain !== false}
          canAskMic={micPermission?.canAskAgain !== false}
          onRequestPermissions={() => {
            void requestPermission();
            void requestMicPermission();
          }}
          onContinueAudioOnly={() => {
            setSkipPermissionGate(true);
            setCameraEnabled(false);
          }}
        />
      )}

      {stage === 'countdown' && (
        <CountdownOverlay
          count={countdownValue}
          onCancel={handleCancelCountdown}
        />
      )}

      {stage === 'ending' && (
        <View style={styles.endingOverlay}>
          <ActivityIndicator size="large" color="#f43f5e" />
          <Text style={styles.endingTitle}>Wrapping Up Broadcast</Text>
          <Text style={styles.endingSubtitle}>{endingStatusText}</Text>
        </View>
      )}

      <LiveStudioSettingsSheet
        visible={isSettingsOpen}
        isLiveStarted={isLiveStarted}
        titleText={titleText}
        onChangeTitle={setTitleText}
        onCommitLiveTitle={handleCommitLiveTitle}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        pinnedMessage={pinnedMessage}
        onPinCustomMessage={handlePinMessage}
        onUnpinMessage={handleUnpinMessage}
        bottomInset={insets.bottom}
        onClose={() => setIsSettingsOpen(false)}
      />

      <LiveGiftSuperchatSheet
        visible={giftSheetTab !== null}
        initialTab={giftSheetTab || 'gift'}
        onSendGift={handleSendGift}
        onSendSuperchat={handleSendSuperchat}
        bottomInset={insets.bottom}
        onClose={() => setGiftSheetTab(null)}
      />

      <LiveAnalyticsViewersSheet
        visible={isAnalyticsOpen}
        viewerCount={viewerCount}
        peakViewers={peakViewers}
        liveDurationLabel={formatDuration(liveSeconds)}
        messagesCount={messages.filter((m) => m.kind !== 'system').length}
        reactionsCount={reactionsCount}
        earningsInr={earningsInr}
        viewers={presenceViewers}
        bottomInset={insets.bottom}
        onClose={() => setIsAnalyticsOpen(false)}
      />

      <LiveGuestsManagerSheet
        visible={isGuestsOpen}
        joinRequests={joinRequests}
        activeCoHosts={activeCoHosts}
        allowJoinRequests={settings.allowJoinRequests}
        onToggleAllowJoin={(val) =>
          handleUpdateSettings({ allowJoinRequests: val })
        }
        onAcceptRequest={handleAcceptJoin}
        onDeclineRequest={handleDeclineJoin}
        onRemoveCoHost={handleRemoveCoHost}
        bottomInset={insets.bottom}
        onClose={() => setIsGuestsOpen(false)}
      />

      {/* SCHEDULE UPCOMING LIVE MODAL */}
      <Modal
        visible={isScheduleModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsScheduleModalOpen(false)}
      >
        <View style={styles.schedBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsScheduleModalOpen(false)}
          />
          <View style={styles.schedSheet}>
            <View style={styles.schedHandle} />
            <Text style={styles.schedSheetTitle}>Schedule Upcoming Live</Text>
            <Text style={styles.schedSheetSub}>
              Followers and Watch visitors see a countdown card with a one-tap
              Remind Me notification.
            </Text>

            <View style={styles.schedChipsRow}>
              {[
                { mins: 15, label: 'In 15 mins' },
                { mins: 60, label: 'In 1 hour' },
                { mins: 180, label: 'In 3 hours' },
                { mins: 1440, label: 'Tomorrow' },
              ].map((opt) => {
                const active = scheduleOffsetMin === opt.mins;
                return (
                  <TouchableOpacity
                    key={opt.mins}
                    style={[
                      styles.schedTimeChip,
                      active && styles.schedTimeChipActive,
                    ]}
                    onPress={() => setScheduleOffsetMin(opt.mins)}
                  >
                    <Text
                      style={[
                        styles.schedTimeChipText,
                        active && { color: '#052e16', fontWeight: '800' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.schedConfirmBtn}
              onPress={() => void handleSaveScheduledLive()}
            >
              <Ionicons name="calendar" size={17} color="#052e16" />
              <Text style={styles.schedConfirmText}>
                Publish Countdown Card
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050814' },
  cameraFallback: { ...StyleSheet.absoluteFill, backgroundColor: '#050814' },
  cameraOffSlate: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0b1120',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  slateAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: '#f43f5e',
  },
  slateAvatarFallback: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#be185d',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#f43f5e',
  },
  slateAvatarInitial: { color: '#fff', fontSize: 34, fontWeight: '800' },
  slateTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  slateSubtitle: { color: '#94a3b8', fontSize: 13 },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 150,
    backgroundColor: 'rgba(2, 6, 23, 0.34)',
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 280,
    backgroundColor: 'rgba(2, 6, 23, 0.4)',
  },
  screenContent: { flex: 1, justifyContent: 'space-between' },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    gap: 8,
  },
  hostInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarRingLive: { borderColor: '#f43f5e' },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e293b',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#D45C8A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  hostDetails: { marginLeft: 9, flexShrink: 1 },
  hostName: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
  followers: { color: '#cbd5e1', fontSize: 10.5, marginTop: 1 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F52B51',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    backgroundColor: '#fff',
    borderRadius: 3,
    marginRight: 5,
  },
  liveText: {
    color: '#fff',
    fontSize: 10.5,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  draftSavePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  draftSaveText: { color: '#f8fafc', fontSize: 11, fontWeight: '700' },
  previewBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.8)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  previewBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  viewerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  viewerText: { color: '#fff', fontSize: 10.5, fontWeight: '700' },
  iconButton: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  iconButtonActive: { backgroundColor: 'rgba(56, 189, 248, 0.28)' },
  iconBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  iconBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  closeButton: { backgroundColor: 'rgba(0, 0, 0, 0.68)' },
  liveMetaSection: { paddingHorizontal: 14, marginTop: 8, gap: 8 },
  titleAndRequestsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  liveTitleWrap: { flex: 1, paddingLeft: 2 },
  streamTitle: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '800' },
  streamCategorySub: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  joinRequestsRightColumn: { alignItems: 'flex-end', gap: 6 },
  joinRequestCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 132,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  joinRequestLabel: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  joinRequestName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  joinRequestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  acceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#16a34a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  declineBtn: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    padding: 4,
    borderRadius: 8,
  },
  actionBtnText: { color: '#fff', fontSize: 10.5, fontWeight: 'bold' },
  pinnedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pinnedBannerText: {
    color: '#e0f2fe',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  coHostRow: { flexDirection: 'row' },
  coHostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(5, 150, 105, 0.85)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  coHostDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#fff',
  },
  coHostText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  leaveStageText: {
    color: '#fecaca',
    fontSize: 11.5,
    fontWeight: '800',
    marginLeft: 4,
  },
  giftToast: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  giftToastTitle: { fontSize: 13, fontWeight: '800' },
  giftToastSub: { color: '#e2e8f0', fontSize: 11, marginTop: 1 },
  preLiveOuter: { flex: 1, justifyContent: 'flex-end' },
  rightToolRail: {
    position: 'absolute',
    right: 12,
    top: 16,
    gap: 12,
    alignItems: 'center',
  },
  railBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  railBtnActive: {
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
  },
  railLabel: { color: '#e2e8f0', fontSize: 9, fontWeight: '700' },
  zoomBadgeText: { color: '#fff', fontSize: 12.5, fontWeight: '900' },
  preLiveContainer: { paddingHorizontal: 14, gap: 12 },
  preLiveCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 20,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  preLiveTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coverPickerBox: {
    width: 72,
    height: 72,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1e293b',
  },
  coverThumb: { width: '100%', height: '100%' },
  coverOverlayBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 3,
  },
  coverOverlayText: { color: '#fff', fontSize: 9.5, fontWeight: '700' },
  preLiveHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  preLiveLabel: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  charCounter: { color: '#64748b', fontSize: 10, fontWeight: '600' },
  preLiveInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#fff',
    fontSize: 13.5,
  },
  preLiveMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  metaChipText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  preLiveToggles: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  preLiveChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 9,
    borderRadius: 12,
  },
  preLiveChipOff: { backgroundColor: 'rgba(244, 63, 94, 0.18)' },
  preLiveChipText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  goLiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F52B51',
    paddingVertical: 15,
    borderRadius: 28,
  },
  goLiveText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  lowerSection: { flex: 1, justifyContent: 'flex-end' },
  chatAndHeartsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 10,
    maxHeight: 255,
  },
  chatContainer: { flex: 1, paddingRight: 8 },
  chatToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  chatToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  chatToggleText: { color: '#f8fafc', fontSize: 11, fontWeight: '600' },
  earningsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.45)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
  },
  earningsChipText: { color: '#fbbf24', fontSize: 11, fontWeight: '800' },
  chatList: { paddingVertical: 4, gap: 4 },
  chatItem: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    marginVertical: 2,
    maxWidth: '100%',
  },
  chatItemSuperchat: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1.5,
  },
  chatItemGift: { backgroundColor: 'rgba(131, 24, 67, 0.65)' },
  chatItemSystem: { backgroundColor: 'rgba(15, 23, 42, 0.72)' },
  chatUsername: { fontSize: 12, fontWeight: 'bold', marginRight: 6 },
  chatMessage: { color: '#fff', fontSize: 12, flexShrink: 1 },
  rightChatColumn: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingBottom: 4,
    width: 82,
    height: 240,
  },
  followAlignedButton: {
    backgroundColor: '#F52B51',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
  },
  followAlignedText: { color: '#fff', fontSize: 11.5, fontWeight: 'bold' },
  bottomSection: { paddingHorizontal: 14, paddingTop: 6 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 24,
    paddingHorizontal: 12,
    height: 42,
  },
  inputContainerExpanded: {
    width: '100%',
    height: 46,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
  },
  commentInput: { flex: 1, color: '#fff', fontSize: 12.5, paddingVertical: 8 },
  sendButton: { paddingLeft: 6, paddingVertical: 4 },
  hostAction: { backgroundColor: 'rgba(30, 41, 59, 0.88)' },
  heartBtn: { backgroundColor: '#F52B51' },

  permissionOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  permissionCard: {
    width: '100%',
    backgroundColor: '#0f172a',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
  },
  permissionIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(244, 63, 94, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  permissionDesc: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  permissionPrimaryBtn: {
    width: '100%',
    backgroundColor: '#f43f5e',
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  permissionPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  permissionSecondaryBtn: { paddingVertical: 8 },
  permissionSecondaryText: {
    color: '#94a3b8',
    fontWeight: '700',
    fontSize: 12.5,
  },

  countdownOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  countdownCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(245, 43, 81, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  countdownNumber: { color: '#fff', fontSize: 44, fontWeight: '900' },
  countdownHint: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  countdownCancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 20,
  },
  countdownCancelText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  endingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  endingTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  endingSubtitle: { color: '#94a3b8', fontSize: 13, textAlign: 'center' },

  summaryScreen: {
    flex: 1,
    backgroundColor: '#050814',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(52, 211, 153, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  summaryBadgeText: { color: '#34d399', fontSize: 11, fontWeight: '800' },
  summaryTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 12,
  },
  summarySubtitle: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
  summaryStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  summaryStatCard: {
    width: '48.3%',
    backgroundColor: '#0f172a',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.16)',
  },
  summaryStatVal: { color: '#f8fafc', fontSize: 20, fontWeight: '900' },
  summaryStatLabel: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  summaryReplayCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
  },
  summaryReplayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryReplayTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  summaryReplaySub: {
    color: '#94a3b8',
    fontSize: 11.5,
    marginTop: 2,
    lineHeight: 16,
  },
  summaryActionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  summaryChipBtnSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.25)' },
  summaryChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  summaryFooter: { gap: 10, marginTop: 12 },
  summaryPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f43f5e',
    paddingVertical: 14,
    borderRadius: 16,
  },
  summaryPrimaryText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  summarySecondaryRow: { flexDirection: 'row', gap: 10 },
  summaryOutlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.28)',
    paddingVertical: 13,
    borderRadius: 16,
  },
  summaryOutlineText: { color: '#f8fafc', fontSize: 13.5, fontWeight: '700' },
  summaryDoneBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 16,
  },
  summaryDoneText: { color: '#e2e8f0', fontSize: 13.5, fontWeight: '700' },
  schedulePreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(15,23,42,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  schedulePreBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  battleCard: {
    marginTop: 8,
    backgroundColor: 'rgba(9,9,11,0.75)',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    gap: 6,
  },
  battleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  battleTeamLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  battleTimerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(251,191,36,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  battleTimerText: {
    color: '#fbbf24',
    fontSize: 10.5,
    fontWeight: '900',
  },
  battleTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: '#1e293b',
  },
  battleFillLeft: {
    backgroundColor: '#10b981',
  },
  battleFillRight: {
    backgroundColor: '#f43f5e',
  },
  battleBoostRow: {
    flexDirection: 'row',
    gap: 8,
  },
  battleBoostLeftBtn: {
    flex: 1,
    backgroundColor: 'rgba(16,185,129,0.22)',
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
  },
  battleBoostRightBtn: {
    flex: 1,
    backgroundColor: 'rgba(244,63,94,0.22)',
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
  },
  battleBoostText: {
    color: '#fff',
    fontSize: 10.5,
    fontWeight: '700',
  },
  schedBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  schedSheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  schedHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  schedSheetTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  schedSheetSub: {
    color: '#94a3b8',
    fontSize: 12.5,
    marginTop: 4,
    lineHeight: 18,
  },
  schedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  schedTimeChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#1e293b',
  },
  schedTimeChipActive: {
    backgroundColor: '#10b981',
  },
  schedTimeChipText: {
    color: '#e2e8f0',
    fontSize: 12.5,
    fontWeight: '600',
  },
  schedConfirmBtn: {
    marginTop: 18,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  schedConfirmText: {
    color: '#052e16',
    fontSize: 14,
    fontWeight: '800',
  },
});