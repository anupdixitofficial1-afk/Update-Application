import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ScrollView,
  Image,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Modal,
  Alert,
  Animated,
  AppState,
  Vibration,
  StatusBar,
  DeviceEventEmitter,
  Linking,
  useColorScheme,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ScreenCapture from 'expo-screen-capture';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  AudioPlayer,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { backend, ChatRoomChannel } from '../lib/backend';
import {
  applyCallAudioMode,
  startCallRingAudio,
  stopCallRingAudio,
} from '../lib/callAudio';
import { setActiveChatPeerId } from '../lib/activeChatRef';
import { useWebRtcCall } from '../hooks/useWebRtcCall';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

type DisappearingTimer = 'off' | 'after_seen' | '24h' | '7d';
type CaptureProtectionMode = 'notify' | 'block';

let NotificationsMod: any = null;
try {
  NotificationsMod = require('expo-notifications');
  NotificationsMod?.setNotificationHandler?.({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  NotificationsMod = null;
}

let LocalAuthMod: any = null;
try {
  LocalAuthMod = require('expo-local-authentication');
} catch {
  LocalAuthMod = null;
}

let CameraViewComp: any = null;
let useCameraPermissionsHook: any = null;
try {
  const camModule = require('expo-camera');
  CameraViewComp = camModule?.CameraView ?? null;
  useCameraPermissionsHook = camModule?.useCameraPermissions ?? null;
} catch {
  CameraViewComp = null;
  useCameraPermissionsHook = null;
}

let RTCViewComp: any = null;
try {
  RTCViewComp = require('react-native-webrtc')?.RTCView ?? null;
} catch {
  RTCViewComp = null;
}

interface DbMessageRow {
  id: string;
  sender_id?: string | null;
  receiver_id?: string | null;
  content?: string | null;
  body?: string | null;
  message?: string | null;
  text?: string | null;
  msg?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
  seen_at?: string | null;
  isSystemAlert?: boolean;
  alertKind?: 'disappearing' | 'screenshot' | 'privacy';
  alertSide?: 'left' | 'right';
  isCallLog?: boolean;
  callKind?: 'voice' | 'video';
  callOutcome?:
    | 'connecting'
    | 'calling'
    | 'ringing'
    | 'connected'
    | 'missed'
    | 'not_connected';
  callDurationText?: string;
  replyToText?: string | null;
  replyToAuthor?: string | null;
  reaction?: string | null;
  isViewOnce?: boolean;
  viewOnceKind?: 'photo' | 'voice';
  viewOnceOpened?: boolean;
  viewOnceUrl?: string;
  mediaKind?: 'photo' | 'video' | 'voice' | 'location';
  mediaUrl?: string;
  locationLat?: number;
  locationLng?: number;
  locationLabel?: string;
  voiceDurationLabel?: string;
}

type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'incoming'
  | 'connected';

interface CallState {
  active: boolean;
  direction: 'outgoing' | 'incoming' | null;
  status: CallStatus;
  callId: string | null;
  type: 'voice' | 'video';
  muted: boolean;
  speaker: boolean;
  cameraOff: boolean;
  seconds: number;
  remoteName: string;
  remoteAvatar: string;
}

const DEFAULT_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';
const MISSED_RED = '#ef4444';
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '🔥'];

const DISAPPEARING_OPTIONS: { key: DisappearingTimer; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'after_seen', label: 'After Seen' },
  { key: '24h', label: '24 Hours' },
  { key: '7d', label: '7 Days' },
];

const IDLE_CALL_STATE: CallState = {
  active: false,
  direction: null,
  status: 'idle',
  callId: null,
  type: 'voice',
  muted: false,
  speaker: false,
  cameraOff: true,
  seconds: 0,
  remoteName: 'User',
  remoteAvatar: DEFAULT_AVATAR,
};

const formatShortTime = (iso?: string | null) => {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatCallDuration = (totalSec: number) => {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const isMissedOutcome = (outcome?: DbMessageRow['callOutcome']) =>
  outcome === 'missed' || outcome === 'not_connected';

const getCallStatusLabel = (
  status: CallStatus,
  seconds: number,
  callType: 'voice' | 'video'
): string => {
  const prefix = callType === 'video' ? 'Video Call' : 'Voice Call';
  if (status === 'connecting') return `${prefix} · Connecting...`;
  if (status === 'ringing') return `${prefix} · Ringing...`;
  if (status === 'incoming') return `Incoming ${prefix}...`;
  if (status === 'connected') return formatCallDuration(seconds);
  return prefix;
};

const SCREENSHOT_DB_MARKER = '📸 Screenshot taken of this chat';
const VIEW_ONCE_OPENED_MARKER = '👁️ View-Once Opened';

const serializeCallLogText = (
  callKind: 'voice' | 'video',
  callOutcome: NonNullable<DbMessageRow['callOutcome']>,
  callDurationText?: string
): string => {
  const prefix = callKind === 'video' ? '📹 Video Call' : '📞 Voice Call';
  if (isMissedOutcome(callOutcome)) return `${prefix} · Missed`;
  if (callOutcome === 'connected') {
    return `${prefix} · ${callDurationText || '00:00'}`;
  }
  if (callOutcome === 'ringing') return `${prefix} · Ringing...`;
  return `${prefix} · Connecting...`;
};

const hydrateDbMessageRow = (row: DbMessageRow): DbMessageRow => {
  if (!row || row.isCallLog || row.isSystemAlert) return row;
  const raw = String(
    row.content ?? row.body ?? row.message ?? row.text ?? row.msg ?? ''
  ).trim();

  if (raw === SCREENSHOT_DB_MARKER) {
    return {
      ...row,
      isSystemAlert: true,
      alertKind: 'screenshot',
    };
  }

  if (raw === VIEW_ONCE_OPENED_MARKER) {
    return {
      ...row,
      isViewOnce: true,
      viewOnceOpened: true,
    };
  }

  if (raw.startsWith('👁️ View-Once Photo::')) {
    return {
      ...row,
      isViewOnce: true,
      viewOnceKind: 'photo',
      viewOnceUrl: raw.slice('👁️ View-Once Photo::'.length).trim(),
      viewOnceOpened: false,
    };
  }

  if (raw.startsWith('👁️ View-Once Voice')) {
    const sepIdx = raw.indexOf('::');
    if (sepIdx > 0) {
      const durMatch = raw.slice(0, sepIdx).match(/\(([^)]+)\)/);
      return {
        ...row,
        isViewOnce: true,
        viewOnceKind: 'voice',
        voiceDurationLabel: durMatch?.[1] || '0:05',
        viewOnceUrl: raw.slice(sepIdx + 2).trim(),
        viewOnceOpened: false,
      };
    }
  }

  if (raw.startsWith('📷 Photo::')) {
    return {
      ...row,
      mediaKind: 'photo',
      mediaUrl: raw.slice('📷 Photo::'.length).trim(),
    };
  }

  if (raw.startsWith('🎥 Video::')) {
    return {
      ...row,
      mediaKind: 'video',
      mediaUrl: raw.slice('🎥 Video::'.length).trim(),
    };
  }

  if (raw.startsWith('🎤 Voice Note')) {
    const sepIdx = raw.indexOf('::');
    if (sepIdx > 0) {
      const durMatch = raw.slice(0, sepIdx).match(/\(([^)]+)\)/);
      return {
        ...row,
        mediaKind: 'voice',
        voiceDurationLabel: durMatch?.[1] || '0:05',
        mediaUrl: raw.slice(sepIdx + 2).trim(),
      };
    }
  }

  if (raw.startsWith('📍 Location::')) {
    const parts = raw.slice('📍 Location::'.length).split('::');
    const [latStr, lngStr] = (parts[0] || '').split(',');
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        ...row,
        mediaKind: 'location',
        locationLat: lat,
        locationLng: lng,
        locationLabel: parts.slice(1).join('::').trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      };
    }
  }

  if (raw.startsWith('📞 Voice Call') || raw.startsWith('📹 Video Call')) {
    const callKind: 'voice' | 'video' = raw.startsWith('📹 Video Call')
      ? 'video'
      : 'voice';
    const detail = raw.split(' · ').slice(1).join(' · ').trim();
    let callOutcome: NonNullable<DbMessageRow['callOutcome']> = 'connected';
    let callDurationText: string | undefined;
    if (detail === 'Missed') callOutcome = 'missed';
    else if (detail === 'Ringing...') callOutcome = 'ringing';
    else if (detail === 'Connecting...') callOutcome = 'connecting';
    else if (/^\d{2}:\d{2}$/.test(detail)) {
      callOutcome = 'connected';
      callDurationText = detail;
    }
    return {
      ...row,
      isCallLog: true,
      callKind,
      callOutcome,
      callDurationText,
    };
  }
  return row;
};

const getMessageText = (
  row: DbMessageRow,
  isMeCall = false,
  peerLabel = 'Peer'
): string => {
  const hydrated =
    row.mediaKind || row.isViewOnce || row.isCallLog || row.isSystemAlert
      ? row
      : hydrateDbMessageRow(row);

  if (hydrated.isSystemAlert && hydrated.alertKind === 'screenshot') {
    const raw = String(hydrated.content ?? hydrated.text ?? '').trim();
    if (raw === SCREENSHOT_DB_MARKER) {
      return isMeCall
        ? 'You took a screenshot of this chat'
        : `${peerLabel} took a screenshot of this chat`;
    }
  }
  if (hydrated.mediaKind === 'photo') return '📷 Photo';
  if (hydrated.mediaKind === 'video') return '🎥 Video';
  if (hydrated.mediaKind === 'voice') {
    return `🎤 Voice Note (${hydrated.voiceDurationLabel || '0:05'})`;
  }
  if (hydrated.mediaKind === 'location') {
    return `📍 ${hydrated.locationLabel || 'Shared Location'}`;
  }
  if (hydrated.isViewOnce) {
    if (hydrated.viewOnceOpened) return 'Opened · Expired';
    return hydrated.viewOnceKind === 'voice'
      ? 'View-Once Voice Note'
      : 'View-Once Photo';
  }
  if (hydrated.isCallLog) {
    const title = isMeCall ? 'Outgoing Call' : 'Incoming Call';
    if (isMissedOutcome(hydrated.callOutcome)) return `${title} · Missed`;
    if (hydrated.callOutcome === 'connected') {
      return `${title} · ${hydrated.callDurationText || '00:00'}`;
    }
    if (hydrated.callOutcome === 'ringing') return `${title} · Ringing...`;
    if (hydrated.callOutcome === 'connecting') return `${title} · Connecting...`;
    return `${title} · Calling...`;
  }

  const candidates = [
    hydrated.content,
    hydrated.body,
    hydrated.message,
    hydrated.text,
    hydrated.msg,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().length > 0) return val;
  }
  return '';
};

const dedupeMessages = (list: DbMessageRow[]): DbMessageRow[] => {
  const map = new Map<string, DbMessageRow>();
  for (const item of list) {
    if (item?.id) map.set(item.id, item);
  }
  return Array.from(map.values());
};

const resolveStreamUrl = (streamOrUrl: any): string | null => {
  if (!streamOrUrl) return null;
  if (typeof streamOrUrl === 'string') {
    return streamOrUrl.trim().length > 0 ? streamOrUrl : null;
  }
  if (typeof streamOrUrl.toURL === 'function') {
    try {
      const url = streamOrUrl.toURL();
      return typeof url === 'string' && url.length > 0 ? url : null;
    } catch {
      return null;
    }
  }
  return null;
};

function SlidableToggle({
  value,
  onToggle,
  trackOffColor,
}: {
  value: boolean;
  onToggle: () => void;
  trackOffColor: string;
}) {
  const slideAnim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: value ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [value, slideAnim]);

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 20],
  });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onToggle}
      style={[
        styles.toggleTrack,
        { backgroundColor: value ? '#10b981' : trackOffColor },
      ]}
    >
      <Animated.View
        style={[styles.toggleThumb, { transform: [{ translateX }] }]}
      />
    </TouchableOpacity>
  );
}

function ChatVideoViewer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '82%' }}
      contentFit="contain"
      nativeControls
    />
  );
}

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const voiceRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voicePlayerRef = useRef<AudioPlayer | null>(null);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordSec, setVoiceRecordSec] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceSpeed, setVoiceSpeed] = useState<1 | 1.5 | 2>(1);
  const [mediaViewerItem, setMediaViewerItem] = useState<{
    kind: 'photo' | 'video';
    url: string;
  } | null>(null);
  const [chatUrlModalVisible, setChatUrlModalVisible] = useState(false);
  const [chatUrlInput, setChatUrlInput] = useState('');

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
      myBubbleBg: isDark ? '#fafafa' : '#09090b',
      myBubbleText: isDark ? '#09090b' : '#ffffff',
      myBubbleMeta: isDark
        ? 'rgba(9, 9, 11, 0.55)'
        : 'rgba(255, 255, 255, 0.65)',
      otherBubbleBg: isDark ? '#18181b' : '#f4f4f5',
      otherBubbleText: isDark ? '#fafafa' : '#09090b',
      emerald: '#10b981',
      emeraldSoft: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
      amber: '#f59e0b',
      amberSoft: isDark ? 'rgba(245, 158, 11, 0.16)' : '#fffbeb',
      danger: '#ef4444',
      dangerSoft: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fef2f2',
      toggleOff: isDark ? '#3f3f46' : '#d4d4d8',
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

  const [cameraPermission, requestCameraPermission] =
    typeof useCameraPermissionsHook === 'function'
      ? useCameraPermissionsHook()
      : [{ granted: false }, async () => ({ granted: false })];

  const params = useLocalSearchParams<{
    userId?: string;
    name?: string;
    username?: string;
    avatarUrl?: string;
    incomingCallId?: string;
    incomingCallType?: string;
  }>();

  const flatListRef = useRef<FlatList<DbMessageRow>>(null);
  const roomChannelRef = useRef<ChatRoomChannel | null>(null);
  const [activeRoomChannel, setActiveRoomChannel] =
    useState<ChatRoomChannel | null>(null);

  const pendingOfferRef = useRef<{
    sdp: any;
    callType: 'voice' | 'video';
  } | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScreenshotSentRef = useRef<number>(0);
  const prevMsgCountRef = useRef<number>(0);
  const persistedCallRowMapRef = useRef<Map<string, string>>(new Map());
  const persistingCallSetRef = useRef<Set<string>>(new Set());
  const latestCallPayloadRef = useRef<Map<string, string>>(new Map());

  const targetUserId =
    typeof params?.userId === 'string' && params.userId.trim()
      ? params.userId.trim()
      : '';

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [myDisplayName, setMyDisplayName] = useState<string>('Someone');
  const [myAvatarUrl, setMyAvatarUrl] = useState<string>(DEFAULT_AVATAR);
  const [peerName, setPeerName] = useState(
    typeof params?.name === 'string' && params.name.trim()
      ? params.name.trim()
      : typeof params?.username === 'string' && params.username.trim()
        ? params.username.trim()
        : 'User'
  );
  const [peerHandle, setPeerHandle] = useState(
    typeof params?.username === 'string' ? params.username.trim() : ''
  );
  const [peerAvatar, setPeerAvatar] = useState(
    typeof params?.avatarUrl === 'string' && params.avatarUrl.trim()
      ? params.avatarUrl.trim()
      : DEFAULT_AVATAR
  );

  const [captureMode, setCaptureMode] =
    useState<CaptureProtectionMode>('notify');
  const [disappearingTimer, setDisappearingTimer] =
    useState<DisappearingTimer>('24h');
  const [readReceiptsOn, setReadReceiptsOn] = useState(true);
  const [showActiveStatus, setShowActiveStatus] = useState(true);
  const [chatLockEnabled, setChatLockEnabled] = useState(false);
  const [isChatLockedOverlay, setIsChatLockedOverlay] = useState(false);

  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const [replyingTo, setReplyingTo] = useState<DbMessageRow | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<DbMessageRow | null>(null);
  const [viewOncePreview, setViewOncePreview] = useState<DbMessageRow | null>(
    null
  );

  const [callState, setCallState] = useState<CallState>(IDLE_CALL_STATE);
  const callStateRef = useRef<CallState>(IDLE_CALL_STATE);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [cameraReady, setCameraReady] = useState(false);

  const [canCall, setCanCall] = useState(false);
  const [loadingPeer, setLoadingPeer] = useState(Boolean(targetUserId));
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const [messages, setMessages] = useState<DbMessageRow[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [attachSheetVisible, setAttachSheetVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<DbMessageRow | null>(
    null
  );
  const [editingMessage, setEditingMessage] = useState<DbMessageRow | null>(
    null
  );
  const [editDraftText, setEditDraftText] = useState('');
  const [callCaptureAlert, setCallCaptureAlert] = useState<string | null>(null);

  const peerInfoRef = useRef({ peerName, peerAvatar });
  useEffect(() => {
    peerInfoRef.current = { peerName, peerAvatar };
  }, [peerName, peerAvatar]);

  const myProfileRef = useRef({ name: myDisplayName, avatar: myAvatarUrl });
  useEffect(() => {
    myProfileRef.current = { name: myDisplayName, avatar: myAvatarUrl };
  }, [myDisplayName, myAvatarUrl]);

  useEffect(() => {
    setActiveChatPeerId(targetUserId || null);
    return () => {
      setActiveChatPeerId(null);
    };
  }, [targetUserId]);

  useEffect(() => {
    if (captureMode === 'block') {
      ScreenCapture.preventScreenCaptureAsync?.().catch(() => {});
    } else {
      ScreenCapture.allowScreenCaptureAsync?.().catch(() => {});
    }
    return () => {
      ScreenCapture.allowScreenCaptureAsync?.().catch(() => {});
    };
  }, [captureMode]);

  const rtcHook: any = useWebRtcCall(
    activeRoomChannel,
    currentUserId,
    targetUserId
  );

  const localStreamUrl = rtcHook?.localStreamUrl ?? null;
  const remoteStreamUrl = rtcHook?.remoteStreamUrl ?? null;
  const beginOutgoingCall = rtcHook?.beginOutgoingCall;
  const handleIncomingOffer = rtcHook?.handleIncomingOffer;
  const handleIncomingAnswer = rtcHook?.handleIncomingAnswer;
  const handleIncomingIce = rtcHook?.handleIncomingIce;
  const setMicMuted = rtcHook?.setMicMuted;
  const setVideoEnabled = rtcHook?.setVideoEnabled;
  const switchRtcCamera = rtcHook?.switchCamera ?? rtcHook?.flipCamera;
  const setRtcSpeaker = rtcHook?.setSpeakerOn ?? rtcHook?.setSpeaker;
  const startRingtone = rtcHook?.startRingtone;
  const stopRingtone = rtcHook?.stopRingtone;
  const cleanupPeer = rtcHook?.cleanupPeer;

  const resolvedLocalUrl = resolveStreamUrl(localStreamUrl);
  const resolvedRemoteUrl = resolveStreamUrl(remoteStreamUrl);

  const webrtcRef = useRef({
    beginOutgoingCall: async (isVid: boolean) => {
      if (typeof beginOutgoingCall === 'function') {
        try {
          return await beginOutgoingCall(isVid, cameraFacing);
        } catch {
          try {
            return await beginOutgoingCall(isVid);
          } catch {
            return null;
          }
        }
      }
      return null;
    },
    handleIncomingOffer: async (sdp: any, isVid: boolean) => {
      if (typeof handleIncomingOffer === 'function') {
        try {
          return await handleIncomingOffer(sdp, isVid);
        } catch {
          return null;
        }
      }
      return null;
    },
    handleIncomingAnswer: async (sdp: any) => {
      if (typeof handleIncomingAnswer === 'function') {
        try {
          return await handleIncomingAnswer(sdp);
        } catch {
          return null;
        }
      }
      return null;
    },
    handleIncomingIce: async (candidate: any) => {
      if (typeof handleIncomingIce === 'function') {
        try {
          return await handleIncomingIce(candidate);
        } catch {
          return null;
        }
      }
      return null;
    },
    cleanupPeer: () => {
      if (typeof cleanupPeer === 'function') {
        try {
          cleanupPeer();
        } catch {}
      }
    },
  });

  useEffect(() => {
    webrtcRef.current = {
      beginOutgoingCall: async (isVid: boolean) => {
        if (typeof beginOutgoingCall === 'function') {
          try {
            return await beginOutgoingCall(isVid, cameraFacing);
          } catch {
            try {
              return await beginOutgoingCall(isVid);
            } catch {
              return null;
            }
          }
        }
        return null;
      },
      handleIncomingOffer: async (sdp: any, isVid: boolean) => {
        if (typeof handleIncomingOffer === 'function') {
          try {
            return await handleIncomingOffer(sdp, isVid);
          } catch {
            return null;
          }
        }
        return null;
      },
      handleIncomingAnswer: async (sdp: any) => {
        if (typeof handleIncomingAnswer === 'function') {
          try {
            return await handleIncomingAnswer(sdp);
          } catch {
            return null;
          }
        }
        return null;
      },
      handleIncomingIce: async (candidate: any) => {
        if (typeof handleIncomingIce === 'function') {
          try {
            return await handleIncomingIce(candidate);
          } catch {
            return null;
          }
        }
        return null;
      },
      cleanupPeer: () => {
        if (typeof cleanupPeer === 'function') {
          try {
            cleanupPeer();
          } catch {}
        }
      },
    };
  }, [
    beginOutgoingCall,
    handleIncomingOffer,
    handleIncomingAnswer,
    handleIncomingIce,
    cleanupPeer,
    cameraFacing,
  ]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    if (typeof setMicMuted === 'function') {
      try {
        setMicMuted(callState.muted);
      } catch {}
    }
  }, [callState.muted, setMicMuted]);

  useEffect(() => {
    if (typeof setVideoEnabled === 'function') {
      try {
        setVideoEnabled(callState.type === 'video' && !callState.cameraOff);
      } catch {}
    }
  }, [callState.cameraOff, callState.type, setVideoEnabled]);

  useEffect(() => {
    if (typeof setRtcSpeaker === 'function') {
      try {
        setRtcSpeaker(callState.speaker);
      } catch {}
    }
  }, [callState.speaker, setRtcSpeaker]);

  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      prevMsgCountRef.current = messages.length;
      const timer = setTimeout(() => {
        try {
          flatListRef.current?.scrollToEnd({ animated: false });
        } catch {}
      }, 60);
      return () => clearTimeout(timer);
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  const ensureCameraAccess = useCallback(async () => {
    if (!CameraViewComp && !RTCViewComp) return false;
    try {
      if (typeof requestCameraPermission === 'function') {
        if (cameraPermission?.granted) {
          setCameraReady(true);
          return true;
        }
        const res = await requestCameraPermission();
        const ok = Boolean(res?.granted);
        setCameraReady(ok);
        return ok;
      }
      setCameraReady(true);
      return true;
    } catch {
      return false;
    }
  }, [cameraPermission?.granted, requestCameraPermission]);

  const vibrateOnce = useCallback(() => {
    try {
      Vibration.cancel();
      Vibration.vibrate(140);
    } catch {}
  }, []);

  const stopRingVibration = useCallback(() => {
    stopCallRingAudio();
    try {
      Vibration.cancel();
    } catch {}
    if (typeof stopRingtone === 'function') {
      try {
        stopRingtone();
      } catch {}
    }
  }, [stopRingtone]);

  const startRingVibration = useCallback(
    (forCaller = false) => {
      if (!forCaller) {
        try {
          Vibration.vibrate([0, 700, 400, 700], true);
        } catch {}
      } else {
        try {
          Vibration.cancel();
        } catch {}
      }
      void startCallRingAudio({
        isOutgoing: forCaller,
        speaker: callStateRef.current.speaker,
      });
      if (typeof startRingtone === 'function') {
        try {
          startRingtone(callStateRef.current.type === 'video', forCaller);
        } catch {}
      }
    },
    [startRingtone]
  );

  useEffect(() => {
    const shouldRing =
      callState.active &&
      (callState.status === 'connecting' ||
        callState.status === 'ringing' ||
        callState.status === 'incoming');

    if (shouldRing) {
      startRingVibration(callState.direction === 'outgoing');
    } else {
      stopRingVibration();
    }
    return () => stopRingVibration();
  }, [
    callState.active,
    callState.direction,
    callState.status,
    startRingVibration,
    stopRingVibration,
  ]);

  useEffect(() => {
    if (!callState.active) return;
    void applyCallAudioMode({
      speaker: callState.speaker,
      allowsRecording: callState.status === 'connected' || !callState.speaker,
    });
  }, [callState.active, callState.speaker, callState.status]);

  const triggerIncomingCallUi = useCallback(
    async (
      incomingId: string,
      kind: 'voice' | 'video',
      callerName?: string | null,
      callerAvatar?: string | null
    ) => {
      const isVid = kind === 'video';
      if (isVid) await ensureCameraAccess();
      const cleanCallerName =
        typeof callerName === 'string' && callerName.trim()
          ? callerName.trim()
          : peerInfoRef.current.peerName || 'User';
      const cleanCallerAvatar =
        typeof callerAvatar === 'string' && callerAvatar.trim()
          ? callerAvatar.trim()
          : peerInfoRef.current.peerAvatar || DEFAULT_AVATAR;

      setCameraFacing('front');
      setCallState({
        active: true,
        direction: 'incoming',
        status: 'incoming',
        callId: incomingId || `call-${Date.now()}`,
        type: kind,
        muted: false,
        speaker: isVid,
        cameraOff: !isVid,
        seconds: 0,
        remoteName: cleanCallerName,
        remoteAvatar: cleanCallerAvatar,
      });
    },
    [ensureCameraAccess]
  );

  useEffect(() => {
    if (!currentUserId || !Device?.isDevice || !NotificationsMod) return;
    let active = true;
    (async () => {
      try {
        const { status: existingStatus } =
          await NotificationsMod.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await NotificationsMod.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted' || !active) return;

        if (Platform.OS === 'android') {
          await NotificationsMod.setNotificationChannelAsync('incoming-calls', {
            name: 'Incoming Calls',
            importance: NotificationsMod.AndroidImportance?.MAX ?? 5,
            vibrationPattern: [0, 700, 400, 700],
            lockscreenVisibility:
              NotificationsMod.AndroidNotificationVisibility?.PUBLIC ?? 1,
          });
        }

        const tokenResp = await NotificationsMod.getExpoPushTokenAsync();
        const token = tokenResp?.data;
        if (token && active) {
          await backend.messages.savePushToken(currentUserId, token);
        }
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!NotificationsMod) return;

    const handleNotificationData = (
      data: Record<string, unknown> | undefined
    ) => {
      if (!data || data.type !== 'incoming_call') return;
      const kind: 'voice' | 'video' =
        data.callType === 'video' ? 'video' : 'voice';
      const callId = String(data.callId || `call-${Date.now()}`);
      const callerName =
        typeof data.callerName === 'string' ? data.callerName : null;
      const callerAvatar =
        typeof data.callerAvatar === 'string' ? data.callerAvatar : null;
      const callerId =
        typeof data.callerId === 'string' ? data.callerId : null;

      if (callerId && targetUserId && callerId !== targetUserId) {
        router.replace({
          pathname: '/messages',
          params: {
            userId: callerId,
            name: callerName || 'User',
            avatarUrl: callerAvatar || DEFAULT_AVATAR,
            incomingCallId: callId,
            incomingCallType: kind,
          },
        });
        return;
      }

      void triggerIncomingCallUi(callId, kind, callerName, callerAvatar);
    };

    let receivedSub: any = null;
    let responseSub: any = null;

    try {
      receivedSub = NotificationsMod.addNotificationReceivedListener(
        (notification: any) => {
          handleNotificationData(
            notification?.request?.content?.data as Record<string, unknown>
          );
        }
      );
      responseSub = NotificationsMod.addNotificationResponseReceivedListener(
        (response: any) => {
          handleNotificationData(
            response?.notification?.request?.content?.data as Record<
              string,
              unknown
            >
          );
        }
      );
    } catch {}

    return () => {
      try {
        receivedSub?.remove?.();
        responseSub?.remove?.();
      } catch {}
    };
  }, [router, targetUserId, triggerIncomingCallUi]);

  useEffect(() => {
    if (
      typeof params?.incomingCallId === 'string' &&
      params.incomingCallId.trim()
    ) {
      const kind: 'voice' | 'video' =
        params.incomingCallType === 'video' ? 'video' : 'voice';
      void triggerIncomingCallUi(params.incomingCallId.trim(), kind);
    }
  }, [params?.incomingCallId, params?.incomingCallType, triggerIncomingCallUi]);

  const showCallCardAlert = useCallback((msg: string) => {
    setCallCaptureAlert(msg);
    if (callAlertTimerRef.current) clearTimeout(callAlertTimerRef.current);
    callAlertTimerRef.current = setTimeout(() => {
      setCallCaptureAlert(null);
    }, 5000);
  }, []);

  const clearCallTimers = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearCallTimers();
      stopRingVibration();
      webrtcRef.current.cleanupPeer();
      if (callAlertTimerRef.current) clearTimeout(callAlertTimerRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [clearCallTimers, stopRingVibration]);

  const appendLocalAlert = useCallback(
    (
      text: string,
      alertKind: 'disappearing' | 'screenshot' | 'privacy',
      alertSide: 'left' | 'right'
    ) => {
      const alertRow: DbMessageRow = {
        id: `sys-${alertKind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: text,
        created_at: new Date().toISOString(),
        isSystemAlert: true,
        alertKind,
        alertSide,
      };
      setMessages((prev) => dedupeMessages([...prev, alertRow]));
    },
    []
  );

  const sendScreenshotAlertToPeer = useCallback(
    (actorId: string, recipientId: string) => {
      if (!actorId || !recipientId || actorId === recipientId) return;
      const now = Date.now();
      if (now - lastScreenshotSentRef.current < 1500) return;
      lastScreenshotSentRef.current = now;

      appendLocalAlert(
        'You took a screenshot of this chat',
        'screenshot',
        'right'
      );

      const alertPayload = {
        actorId,
        recipientId,
        actorName: myProfileRef.current.name || 'Someone',
        at: new Date().toISOString(),
      };

      try {
        if (roomChannelRef.current) {
          void roomChannelRef.current.send({
            type: 'broadcast',
            event: 'screenshot_taken',
            payload: alertPayload,
          });
        }
      } catch {}

      void backend.messages
        .sendDirectAlert(recipientId, 'screenshot_taken', alertPayload)
        .catch(() => {});

      void backend.profile
        .sendNotification({
          userId: recipientId,
          actorId,
          type: 'screenshot',
          message: 'took a screenshot of this chat.',
        })
        .catch(() => {});

      void backend.messages
        .sendMessage({
          senderId: actorId,
          receiverId: recipientId,
          content: SCREENSHOT_DB_MARKER,
        })
        .then((saved) => {
          if (saved?.id) {
            const hydrated = hydrateDbMessageRow(saved as DbMessageRow);
            setMessages((prev) => dedupeMessages([...prev, hydrated]));
          }
        })
        .catch(() => {});
    },
    [appendLocalAlert]
  );

  useEffect(() => {
    if (!callState.active) {
      setCallCaptureAlert(null);
      return;
    }

    let mounted = true;
    let sub: any = null;
    try {
      sub = ScreenCapture.addScreenshotListener(() => {
        if (!mounted) return;
        showCallCardAlert('Screenshot detected! Video paused for privacy.');
        if (callStateRef.current.type === 'video') {
          setCallState((prev) => ({ ...prev, cameraOff: true }));
        }
        if (currentUserId && targetUserId) {
          void backend.profile
            .sendNotification({
              userId: targetUserId,
              actorId: currentUserId,
              type: 'screenshot',
              message: 'took a screenshot during your call.',
            })
            .catch(() => {});
        }
        if (roomChannelRef.current && currentUserId) {
          void roomChannelRef.current.send({
            type: 'broadcast',
            event: 'call_capture_attempt',
            payload: {
              callId: callStateRef.current.callId,
              actorId: currentUserId,
              at: new Date().toISOString(),
            },
          });
        }
      });
    } catch {
      sub = null;
    }

    return () => {
      mounted = false;
      try {
        sub?.remove?.();
      } catch {}
    };
  }, [callState.active, currentUserId, showCallCardAlert]);

  const upsertCallLogInChat = useCallback(
    (
      callId: string,
      callKind: 'voice' | 'video',
      callOutcome: NonNullable<DbMessageRow['callOutcome']>,
      callDurationText?: string,
      senderOverride?: string | null,
      receiverOverride?: string | null
    ) => {
      if (!callId) return;
      const persistedId = persistedCallRowMapRef.current.get(callId);
      const localLogId = persistedId || `call-log-${callId}`;
      const senderId = senderOverride ?? currentUserId;
      const receiverId = receiverOverride ?? targetUserId;
      const isOutgoing = Boolean(senderId && senderId === currentUserId);
      const title = isOutgoing ? 'Outgoing Call' : 'Incoming Call';
      const label = isMissedOutcome(callOutcome)
        ? `${title} · Missed`
        : callOutcome === 'connected'
          ? `${title} · ${callDurationText || '00:00'}`
          : callOutcome === 'ringing'
            ? `${title} · Ringing...`
            : `${title} · Connecting...`;

      setMessages((prev) => {
        const exists = prev.some(
          (m) => m.id === localLogId || m.id === `call-log-${callId}`
        );
        if (exists) {
          return dedupeMessages(
            prev.map((m) =>
              m.id === localLogId || m.id === `call-log-${callId}`
                ? {
                    ...m,
                    id: persistedId || m.id,
                    sender_id: m.sender_id ?? senderId,
                    receiver_id: m.receiver_id ?? receiverId,
                    content: label,
                    callKind,
                    callOutcome,
                    callDurationText: callDurationText ?? m.callDurationText,
                  }
                : m
            )
          );
        }
        const row: DbMessageRow = {
          id: localLogId,
          sender_id: senderId,
          receiver_id: receiverId,
          content: label,
          created_at: new Date().toISOString(),
          is_read: false,
          seen_at: null,
          isCallLog: true,
          callKind,
          callOutcome,
          callDurationText,
        };
        return dedupeMessages([...prev, row]);
      });

      if (isOutgoing && senderId && receiverId) {
        const dbText = serializeCallLogText(
          callKind,
          callOutcome,
          callDurationText
        );
        latestCallPayloadRef.current.set(callId, dbText);

        if (callOutcome === 'missed') {
          void backend.profile
            .sendNotification({
              userId: receiverId,
              actorId: senderId,
              type: 'missed_call',
              message: `missed a ${callKind} call with you.`,
            })
            .catch(() => {});
        }

        if (persistedId) {
          void backend.messages
            .updateMessageText(persistedId, dbText)
            .catch(() => {});
        } else if (!persistingCallSetRef.current.has(callId)) {
          persistingCallSetRef.current.add(callId);
          void backend.messages
            .sendMessage({
              senderId,
              receiverId,
              content: dbText,
            })
            .then((saved) => {
              if (!saved?.id) return;
              persistedCallRowMapRef.current.set(callId, saved.id);
              setMessages((prev) =>
                dedupeMessages(
                  prev.map((m) =>
                    m.id === `call-log-${callId}` ? { ...m, id: saved.id } : m
                  )
                )
              );
              const latest = latestCallPayloadRef.current.get(callId);
              if (latest && latest !== dbText) {
                void backend.messages
                  .updateMessageText(saved.id, latest)
                  .catch(() => {});
              }
            })
            .catch(() => {})
            .finally(() => {
              persistingCallSetRef.current.delete(callId);
            });
        }
      }
    },
    [currentUserId, targetUserId]
  );

  useEffect(() => {
    if (!callState.active || callState.status !== 'connected') return;
    const interval = setInterval(() => {
      setCallState((prev) => ({ ...prev, seconds: prev.seconds + 1 }));
    }, 1000);
    return () => clearInterval(interval);
  }, [callState.active, callState.status]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const checkMutualFollow = useCallback(
    async (meId: string, peerId: string) => {
      if (!meId || !peerId || meId === peerId) {
        setCanCall(false);
        return;
      }
      try {
        const isMutual = await backend.messages.areMutualFollowers(
          meId,
          peerId
        );
        setCanCall(isMutual);
      } catch {
        setCanCall(false);
      }
    },
    []
  );

  useEffect(() => {
    if (currentUserId && targetUserId) {
      void checkMutualFollow(currentUserId, targetUserId);
    } else {
      setCanCall(false);
    }
  }, [currentUserId, targetUserId, checkMutualFollow]);

  useEffect(() => {
    let active = true;
    const paramName =
      typeof params?.name === 'string' ? params.name.trim() : '';
    const paramHandle =
      typeof params?.username === 'string' ? params.username.trim() : '';
    const paramAvatar =
      typeof params?.avatarUrl === 'string' ? params.avatarUrl.trim() : '';

    if (paramName) setPeerName(paramName);
    if (paramHandle) setPeerHandle(paramHandle);
    if (paramAvatar) setPeerAvatar(paramAvatar);

    (async () => {
      try {
        const me = await backend.auth.getCurrentUser().catch(() => null);
        if (me?.id && active) {
          setCurrentUserId(me.id);
          const nameVal = me.fullName || me.username || 'Someone';
          setMyDisplayName(String(nameVal).trim());
          if (me.avatarUrl) {
            setMyAvatarUrl(String(me.avatarUrl).trim());
          }
        }
      } catch {}
    })();

    if (!targetUserId) {
      setLoadingPeer(false);
      return;
    }

    (async () => {
      try {
        setLoadingPeer(true);
        const data = await backend.profile.getProfileById(targetUserId);

        if (!active || !data) return;
        if (data.full_name) setPeerName(String(data.full_name).trim());
        if (data.username) {
          const cleanHandle = String(data.username).trim();
          setPeerHandle(
            cleanHandle.startsWith('@') ? cleanHandle : `@${cleanHandle}`
          );
          if (!data.full_name && !paramName) {
            setPeerName(
              cleanHandle.startsWith('@') ? cleanHandle : `@${cleanHandle}`
            );
          }
        }
        if (data.avatar_url) {
          setPeerAvatar(String(data.avatar_url).trim());
        } else if (!paramAvatar) {
          setPeerAvatar(DEFAULT_AVATAR);
        }
      } catch {
        // Keep param values
      } finally {
        if (active) setLoadingPeer(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [targetUserId, params?.name, params?.username, params?.avatarUrl]);

  const markIncomingSeen = useCallback(
    async (myId: string, senderId: string) => {
      if (!myId || !senderId || !readReceiptsOn) return;
      const seenIso = new Date().toISOString();

      setMessages((prev) =>
        prev.map((m) =>
          m.sender_id === senderId && m.receiver_id === myId && !m.is_read
            ? { ...m, is_read: true, seen_at: seenIso }
            : m
        )
      );

      try {
        await backend.messages.markMessagesSeen(myId, senderId, seenIso);
      } catch {}
    },
    [readReceiptsOn]
  );

  const loadMessages = useCallback(async () => {
    if (!targetUserId) return;
    try {
      const me = await backend.auth.getCurrentUser().catch(() => null);
      const myId = me?.id ?? null;
      setCurrentUserId(myId);
      if (!myId) return;

      const rows = await backend.messages.getThreadMessages(myId, targetUserId);
      const hydratedRows = (rows as DbMessageRow[]).map(hydrateDbMessageRow);
      setMessages((prev) => {
        const localItems = prev.filter(
          (item) => item.isSystemAlert || item.isCallLog || item.isViewOnce
        );
        return dedupeMessages([...hydratedRows, ...localItems]);
      });

      await markIncomingSeen(myId, targetUserId);
    } catch {}
  }, [targetUserId, markIncomingSeen]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!currentUserId || !targetUserId) return;

    const attachScreenshotSub = () => {
      try {
        return ScreenCapture.addScreenshotListener(() => {
          if (callStateRef.current.active) return;
          sendScreenshotAlertToPeer(currentUserId, targetUserId);
        });
      } catch {
        return null;
      }
    };

    let screenshotSub = attachScreenshotSub();

    void ScreenCapture.getPermissionsAsync?.()
      .then(async (perm) => {
        if (!perm?.granted) {
          const req = await ScreenCapture.requestPermissionsAsync?.();
          if (req?.granted) {
            try {
              screenshotSub?.remove?.();
            } catch {}
            screenshotSub = attachScreenshotSub();
          }
        }
      })
      .catch(() => {});

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void markIncomingSeen(currentUserId, targetUserId);
        void checkMutualFollow(currentUserId, targetUserId);
        try {
          screenshotSub?.remove?.();
        } catch {}
        screenshotSub = attachScreenshotSub();
      }
    });

    const unsubDb = backend.messages.subscribeThreadMessages(
      currentUserId,
      targetUserId,
      {
        onInsert: (row) => {
          const hydrated = hydrateDbMessageRow(row);
          setMessages((prev) => {
            if (prev.some((m) => m.id === hydrated.id)) return prev;
            return dedupeMessages([...prev, hydrated]);
          });

          if (
            row.sender_id === targetUserId &&
            row.receiver_id === currentUserId
          ) {
            setPeerIsTyping(false);
            void markIncomingSeen(currentUserId, targetUserId);
          }
        },
        onUpdate: (updated) => {
          if (!updated?.id) return;
          const hydratedUpdate = hydrateDbMessageRow(updated);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === hydratedUpdate.id
                ? {
                    ...m,
                    content: hydratedUpdate.content ?? m.content,
                    text: hydratedUpdate.text ?? m.text,
                    is_read: hydratedUpdate.is_read ?? m.is_read,
                    seen_at: hydratedUpdate.seen_at ?? m.seen_at,
                    isCallLog: hydratedUpdate.isCallLog ?? m.isCallLog,
                    callKind: hydratedUpdate.callKind ?? m.callKind,
                    callOutcome: hydratedUpdate.callOutcome ?? m.callOutcome,
                    callDurationText:
                      hydratedUpdate.callDurationText ?? m.callDurationText,
                  }
                : m
            )
          );
        },
      }
    );

    const roomChannel = backend.messages.joinRoomChannel(
      currentUserId,
      targetUserId,
      (event, payload) => {
        if (event === 'typing') {
          if (!payload || payload.senderId === currentUserId) return;
          setPeerIsTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setPeerIsTyping(false);
          }, 2800);
        } else if (event === 'screenshot_taken') {
          if (!payload || payload.actorId === currentUserId) return;
          const who = payload.actorName
            ? String(payload.actorName)
            : peerInfoRef.current.peerName;
          appendLocalAlert(
            `${who} took a screenshot of this chat`,
            'screenshot',
            'left'
          );
          try {
            void NotificationsMod?.scheduleNotificationAsync?.({
              content: {
                title: 'Screenshot Alert',
                body: `${who} took a screenshot of this chat`,
              },
              trigger: null,
            });
          } catch {}
        } else if (event === 'call_capture_attempt') {
          if (!payload || payload.actorId === currentUserId) return;
          showCallCardAlert(
            `${peerInfoRef.current.peerName} tried to screenshot/record the call!`
          );
          if (callStateRef.current.type === 'video') {
            setCallState((prev) => ({ ...prev, cameraOff: true }));
          }
        } else if (event === 'call_type_switch') {
          if (!payload || payload.actorId === currentUserId) return;
          const nextType: 'voice' | 'video' =
            payload.callType === 'video' ? 'video' : 'voice';
          const isNextVideo = nextType === 'video';
          if (isNextVideo) void ensureCameraAccess();
          setCallState((prev) =>
            prev.active
              ? {
                  ...prev,
                  type: nextType,
                  cameraOff: !isNextVideo,
                  speaker: isNextVideo,
                }
              : prev
          );
          if (callStateRef.current.status === 'connected') {
            void webrtcRef.current.beginOutgoingCall(isNextVideo);
          }
        } else if (event === 'call_invite') {
          if (!payload || payload.callerId === currentUserId) return;
          const incomingId = String(payload.callId || Date.now());
          const kind: 'voice' | 'video' =
            payload.callType === 'video' ? 'video' : 'voice';
          const callerName =
            typeof payload.callerName === 'string' ? payload.callerName : null;
          const callerAvatar =
            typeof payload.callerAvatar === 'string'
              ? payload.callerAvatar
              : null;

          upsertCallLogInChat(
            incomingId,
            kind,
            'ringing',
            undefined,
            targetUserId,
            currentUserId
          );

          try {
            void roomChannel.send({
              type: 'broadcast',
              event: 'call_ringing',
              payload: {
                callId: incomingId,
                calleeId: currentUserId,
                callerId: payload.callerId,
              },
            });
          } catch {}

          void triggerIncomingCallUi(incomingId, kind, callerName, callerAvatar);
        } else if (event === 'call_ringing') {
          if (!payload || payload.calleeId === currentUserId) return;
          const activeCall = callStateRef.current;
          if (!activeCall.active || activeCall.direction !== 'outgoing') return;
          if (
            payload.callId &&
            activeCall.callId &&
            payload.callId !== activeCall.callId
          ) {
            return;
          }
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          const activeCallId = activeCall.callId || String(payload.callId);
          upsertCallLogInChat(activeCallId, activeCall.type, 'ringing');
          setCallState((prev) =>
            prev.active && prev.status === 'connecting'
              ? { ...prev, status: 'ringing' }
              : prev
          );
        } else if (event === 'call_accept') {
          if (!payload || payload.responderId === currentUserId) return;
          stopRingVibration();
          vibrateOnce();
          clearCallTimers();
          const activeCallId = String(
            payload.callId || callStateRef.current.callId || ''
          );
          const isVid = callStateRef.current.type === 'video';
          if (activeCallId) {
            upsertCallLogInChat(
              activeCallId,
              callStateRef.current.type,
              'connected',
              '00:00'
            );
          }
          setCallState((prev) =>
            prev.active
              ? {
                  ...prev,
                  status: 'connected',
                  seconds: 0,
                  remoteName: peerInfoRef.current.peerName,
                  remoteAvatar:
                    peerInfoRef.current.peerAvatar || DEFAULT_AVATAR,
                }
              : prev
          );
          void webrtcRef.current.beginOutgoingCall(isVid);
        } else if (event === 'call_reject') {
          if (!payload || payload.responderId === currentUserId) return;
          stopRingVibration();
          clearCallTimers();
          pendingOfferRef.current = null;
          webrtcRef.current.cleanupPeer();
          const activeCallId = String(
            payload.callId || callStateRef.current.callId || ''
          );
          if (activeCallId) {
            upsertCallLogInChat(
              activeCallId,
              callStateRef.current.type,
              'missed'
            );
          }
          setCallState(IDLE_CALL_STATE);
        } else if (event === 'call_end') {
          if (!payload || payload.endedBy === currentUserId) return;
          stopRingVibration();
          clearCallTimers();
          pendingOfferRef.current = null;
          webrtcRef.current.cleanupPeer();
          const activeCallId = String(
            payload.callId || callStateRef.current.callId || ''
          );
          if (activeCallId) {
            upsertCallLogInChat(
              activeCallId,
              callStateRef.current.type,
              callStateRef.current.status === 'connected'
                ? 'connected'
                : 'missed',
              formatCallDuration(callStateRef.current.seconds)
            );
          }
          setCallState(IDLE_CALL_STATE);
        } else if (event === 'webrtc_offer') {
          if (!payload || payload.senderId === currentUserId || !payload.sdp) {
            return;
          }
          const kind: 'voice' | 'video' =
            payload.callType === 'video' ? 'video' : 'voice';
          pendingOfferRef.current = { sdp: payload.sdp, callType: kind };
          if (callStateRef.current.status === 'connected') {
            stopRingVibration();
            pendingOfferRef.current = null;
            void webrtcRef.current.handleIncomingOffer(
              payload.sdp,
              kind === 'video'
            );
          }
        } else if (event === 'webrtc_answer') {
          if (!payload || payload.senderId === currentUserId || !payload.sdp) {
            return;
          }
          stopRingVibration();
          void webrtcRef.current.handleIncomingAnswer(payload.sdp);
        } else if (event === 'webrtc_ice') {
          if (
            !payload ||
            payload.senderId === currentUserId ||
            !payload.candidate
          ) {
            return;
          }
          void webrtcRef.current.handleIncomingIce(payload.candidate);
        }
      }
    );

    roomChannelRef.current = roomChannel;
    setActiveRoomChannel(roomChannel);

    return () => {
      appStateSub.remove();
      try {
        screenshotSub?.remove?.();
      } catch {}
      unsubDb();
      roomChannel.unsubscribe();
      roomChannelRef.current = null;
      setActiveRoomChannel(null);
    };
  }, [
    currentUserId,
    targetUserId,
    markIncomingSeen,
    checkMutualFollow,
    appendLocalAlert,
    clearCallTimers,
    stopRingVibration,
    vibrateOnce,
    upsertCallLogInChat,
    showCallCardAlert,
    sendScreenshotAlertToPeer,
    ensureCameraAccess,
    triggerIncomingCallUi,
  ]);

  const broadcastTyping = useCallback(() => {
    if (!roomChannelRef.current || !currentUserId) return;
    try {
      void roomChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { senderId: currentUserId },
      });
    } catch {}
  }, [currentUserId]);

  const sendMessageText = async (
    rawText: string,
    options?: { isViewOnce?: boolean; viewOnceKind?: 'photo' | 'voice' }
  ) => {
    const trimmed = rawText.trim();
    if (!trimmed || sending) return;

    let senderId = currentUserId;
    if (!senderId) {
      const me = await backend.auth.getCurrentUser().catch(() => null);
      senderId = me?.id ?? null;
      if (senderId) setCurrentUserId(senderId);
    }

    if (!senderId || !targetUserId) {
      Alert.alert('Unable to Send', 'User session or chat recipient missing.');
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const replyQuote = replyingTo ? getMessageText(replyingTo) : null;
    const replyAuthor = replyingTo
      ? replyingTo.sender_id === currentUserId
        ? 'You'
        : peerName
      : null;

    const baseOptimistic = hydrateDbMessageRow({
      id: tempId,
      sender_id: senderId,
      receiver_id: targetUserId,
      content: trimmed,
      text: trimmed,
      created_at: nowIso,
      is_read: false,
      seen_at: null,
      replyToText: replyQuote,
      replyToAuthor: replyAuthor,
    });
    const optimistic: DbMessageRow = {
      ...baseOptimistic,
      isViewOnce: baseOptimistic.isViewOnce ?? options?.isViewOnce,
      viewOnceKind: baseOptimistic.viewOnceKind ?? options?.viewOnceKind,
      viewOnceOpened: baseOptimistic.viewOnceOpened ?? false,
    };

    setReplyingTo(null);
    setSending(true);
    setMessages((prev) => dedupeMessages([...prev, optimistic]));

    try {
      const data = await backend.messages.sendMessage({
        senderId,
        receiverId: targetUserId,
        content: trimmed,
      });

      if (data) {
        const hydratedData = hydrateDbMessageRow({
          ...(data as DbMessageRow),
          replyToText: replyQuote,
          replyToAuthor: replyAuthor,
        });
        const finalRow: DbMessageRow = {
          ...hydratedData,
          isViewOnce: hydratedData.isViewOnce ?? options?.isViewOnce,
          viewOnceKind: hydratedData.viewOnceKind ?? options?.viewOnceKind,
          viewOnceOpened: hydratedData.viewOnceOpened ?? false,
        };
        setMessages((prev) =>
          dedupeMessages(
            prev.map((m) => (m.id === tempId ? finalRow : m))
          )
        );
      }
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Message Not Sent', err?.message || 'Network error.');
    } finally {
      setSending(false);
    }
  };

  const sendMessage = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    setInputText('');
    void sendMessageText(trimmed);
  };

  const handleReactToMessage = (emoji: string) => {
    if (!selectedMessage) return;
    const targetId = selectedMessage.id;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === targetId
          ? { ...m, reaction: m.reaction === emoji ? null : emoji }
          : m
      )
    );
    setSelectedMessage(null);
  };

  const handleOpenViewOnce = (msg: DbMessageRow) => {
    if (msg.viewOnceOpened) return;
    setViewOncePreview(msg);
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, viewOnceOpened: true } : m))
    );
    if (msg.viewOnceKind === 'voice' && msg.viewOnceUrl) {
      void toggleVoicePlayback(`viewonce-${msg.id}`, msg.viewOnceUrl);
    }
    if (msg.id && !msg.id.startsWith('temp-')) {
      void backend.messages
        .updateMessageText(msg.id, VIEW_ONCE_OPENED_MARKER)
        .catch(() => {});
    }
  };

  const verifyBiometricOrDeviceAuth = useCallback(
    async (promptMessage: string): Promise<boolean> => {
      if (!LocalAuthMod?.authenticateAsync) {
        Alert.alert(
          'Biometric Lock Unavailable',
          'Biometric authentication is not supported in this build.'
        );
        return false;
      }
      try {
        const [hasHardware, isEnrolled, enrolledLevel] = await Promise.all([
          LocalAuthMod.hasHardwareAsync?.() ?? Promise.resolve(false),
          LocalAuthMod.isEnrolledAsync?.() ?? Promise.resolve(false),
          LocalAuthMod.getEnrolledLevelAsync?.() ?? Promise.resolve(0),
        ]);

        if (!hasHardware && enrolledLevel === 0) {
          Alert.alert(
            'Biometric Lock Unavailable',
            'Enable Face ID, Fingerprint, or a device screen lock in your phone settings.'
          );
          return false;
        }
        if (!isEnrolled && enrolledLevel === 0) {
          Alert.alert(
            'No Biometrics Enrolled',
            'Please register Face ID, Fingerprint, or a PIN in your device settings first.'
          );
          return false;
        }

        const res = await LocalAuthMod.authenticateAsync({
          promptMessage,
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
          biometricsSecurityLevel: 'weak',
          requireConfirmation: false,
        });
        return Boolean(res?.success);
      } catch {
        return false;
      }
    },
    []
  );

  const handleToggleChatLock = async () => {
    const next = !chatLockEnabled;
    const verified = await verifyBiometricOrDeviceAuth(
      next ? 'Enable Chat Lock with Face ID or Fingerprint' : 'Verify to disable Chat Lock'
    );
    if (!verified) return;

    setChatLockEnabled(next);
    if (currentUserId && targetUserId) {
      void AsyncStorage.setItem(
        `chat_lock_pref_${currentUserId}_${targetUserId}`,
        next ? '1' : '0'
      ).catch(() => {});
    }
    appendLocalAlert(
      next ? 'Chat Lock enabled' : 'Chat Lock disabled',
      'privacy',
      'right'
    );
  };

  const handleUnlockChat = useCallback(async () => {
    const verified = await verifyBiometricOrDeviceAuth(
      `Unlock chat with ${peerName}`
    );
    if (verified) {
      setIsChatLockedOverlay(false);
    }
  }, [peerName, verifyBiometricOrDeviceAuth]);

  useEffect(() => {
    if (!currentUserId || !targetUserId) return;
    let active = true;
    AsyncStorage.getItem(`chat_lock_pref_${currentUserId}_${targetUserId}`)
      .then((val) => {
        if (!active || val !== '1') return;
        setChatLockEnabled(true);
        setIsChatLockedOverlay(true);
        void verifyBiometricOrDeviceAuth(`Unlock chat with ${peerName}`).then(
          (ok) => {
            if (active && ok) setIsChatLockedOverlay(false);
          }
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentUserId, targetUserId, peerName, verifyBiometricOrDeviceAuth]);

  const openEditForMessage = () => {
    if (!selectedMessage || selectedMessage.isCallLog) return;
    setEditingMessage(selectedMessage);
    setEditDraftText(getMessageText(selectedMessage));
    setSelectedMessage(null);
  };

  const saveEditedMessage = async () => {
    if (!editingMessage || editingMessage.isCallLog) return;
    const updatedText = editDraftText.trim();
    if (!updatedText) return;

    const targetId = editingMessage.id;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === targetId
          ? { ...m, content: updatedText, text: updatedText }
          : m
      )
    );
    setEditingMessage(null);
    setEditDraftText('');

    if (!targetId.startsWith('temp-')) {
      try {
        await backend.messages.updateMessageText(targetId, updatedText);
      } catch {}
    }
  };

  const handleUnsendMessage = async () => {
    if (!selectedMessage) return;
    const targetId = selectedMessage.id;
    if (pinnedMessage?.id === targetId) setPinnedMessage(null);
    setMessages((prev) => prev.filter((m) => m.id !== targetId));
    setSelectedMessage(null);

    if (
      !targetId.startsWith('temp-') &&
      !selectedMessage.isSystemAlert &&
      !selectedMessage.isCallLog
    ) {
      try {
        await backend.messages.deleteMessageById(targetId);
      } catch {}
    }
  };

  const handleSelectDisappearingTimer = (timer: DisappearingTimer) => {
    setDisappearingTimer(timer);
    const label =
      DISAPPEARING_OPTIONS.find((o) => o.key === timer)?.label || 'Off';
    appendLocalAlert(
      timer === 'off'
        ? 'Disappearing messages turned OFF'
        : `Disappearing messages set to ${label}`,
      'disappearing',
      'right'
    );
  };

  const handleToggleCaptureMode = (mode: CaptureProtectionMode) => {
    setCaptureMode(mode);
    appendLocalAlert(
      mode === 'block'
        ? 'Strict Shield ON · Screenshots & recording blocked'
        : 'Screenshot Notify Mode ON',
      'privacy',
      'right'
    );
  };

  const switchCallType = async (forcedType?: 'voice' | 'video') => {
    const nextType: 'voice' | 'video' =
      forcedType ?? (callState.type === 'voice' ? 'video' : 'voice');
    const isNextVideo = nextType === 'video';
    if (isNextVideo) {
      setCameraFacing('front');
      await ensureCameraAccess();
    }
    setCallState((prev) => ({
      ...prev,
      type: nextType,
      cameraOff: !isNextVideo,
      speaker: isNextVideo,
    }));
    if (callState.callId) {
      upsertCallLogInChat(
        callState.callId,
        nextType,
        callState.status === 'connected' ? 'connected' : 'ringing',
        formatCallDuration(callState.seconds)
      );
    }
    if (callState.status === 'connected') {
      void webrtcRef.current.beginOutgoingCall(isNextVideo);
    }
    if (roomChannelRef.current && currentUserId) {
      try {
        void roomChannelRef.current.send({
          type: 'broadcast',
          event: 'call_type_switch',
          payload: {
            callId: callState.callId,
            actorId: currentUserId,
            callType: nextType,
          },
        });
      } catch {}
    }
  };

  const confirmSwitchToVideo = () => {
    Alert.alert('Switch to Video Call?', 'Turn on your camera for video?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch', onPress: () => void switchCallType('video') },
    ]);
  };

  const toggleCameraFacing = async () => {
    const hasAccess = cameraReady || (await ensureCameraAccess());
    if (!hasAccess) return;
    const nextFacing = cameraFacing === 'front' ? 'back' : 'front';
    setCameraFacing(nextFacing);
    setCallState((prev) => ({ ...prev, cameraOff: false }));
    if (typeof switchRtcCamera === 'function') {
      try {
        await switchRtcCamera(nextFacing);
      } catch {}
    }
  };

  const startCall = async (type: 'voice' | 'video') => {
    if (!canCall) {
      Alert.alert(
        'Mutual Follow Required',
        'Voice aur video call tabhi available hai jab aap dono ne ek dusre ko follow kiya ho.'
      );
      return;
    }

    stopRingVibration();
    clearCallTimers();
    pendingOfferRef.current = null;
    webrtcRef.current.cleanupPeer();
    setCallCaptureAlert(null);
    setCameraFacing('front');

    const isVid = type === 'video';
    if (isVid) await ensureCameraAccess();

    const nextCallId = `call-${Date.now()}`;
    const calleeName = peerInfoRef.current.peerName || 'User';
    const calleeAvatar = peerInfoRef.current.peerAvatar || DEFAULT_AVATAR;

    upsertCallLogInChat(
      nextCallId,
      type,
      'connecting',
      undefined,
      currentUserId,
      targetUserId
    );

    setCallState({
      active: true,
      direction: 'outgoing',
      status: 'connecting',
      callId: nextCallId,
      type,
      muted: false,
      speaker: isVid,
      cameraOff: !isVid,
      seconds: 0,
      remoteName: calleeName,
      remoteAvatar: calleeAvatar,
    });

    const invitePayload = {
      callId: nextCallId,
      callerId: currentUserId,
      callerName: myProfileRef.current.name,
      callerAvatar: myProfileRef.current.avatar,
      calleeId: targetUserId,
      callType: type,
    };

    try {
      if (roomChannelRef.current && currentUserId) {
        void roomChannelRef.current.send({
          type: 'broadcast',
          event: 'call_invite',
          payload: invitePayload,
        });
      }
    } catch {}

    if (targetUserId && currentUserId) {
      void backend.messages
        .sendDirectAlert(targetUserId, 'call_invite', invitePayload)
        .catch(() => {});

      void backend.messages
        .triggerCallPush({
          calleeId: targetUserId,
          callerId: currentUserId,
          callerName: myProfileRef.current.name,
          callerAvatar: myProfileRef.current.avatar,
          callId: nextCallId,
          callType: type,
        })
        .catch(() => {});
    }

    connectTimeoutRef.current = setTimeout(() => {
      if (
        callStateRef.current.callId === nextCallId &&
        callStateRef.current.status === 'connecting'
      ) {
        upsertCallLogInChat(nextCallId, type, 'ringing');
        setCallState((prev) =>
          prev.active ? { ...prev, status: 'ringing' } : prev
        );
      }
    }, 6000);

    ringTimeoutRef.current = setTimeout(() => {
      if (
        callStateRef.current.callId === nextCallId &&
        (callStateRef.current.status === 'ringing' ||
          callStateRef.current.status === 'connecting')
      ) {
        stopRingVibration();
        webrtcRef.current.cleanupPeer();
        upsertCallLogInChat(nextCallId, type, 'missed');
        setCallState(IDLE_CALL_STATE);
      }
    }, 24000);
  };

  const acceptIncomingCall = async () => {
    stopRingVibration();
    vibrateOnce();
    clearCallTimers();
    const isVid = callState.type === 'video';
    if (isVid) await ensureCameraAccess();
    setCallState((prev) => ({
      ...prev,
      active: true,
      status: 'connected',
      cameraOff: !isVid,
      speaker: isVid,
      seconds: 0,
    }));

    if (pendingOfferRef.current) {
      const { sdp, callType } = pendingOfferRef.current;
      pendingOfferRef.current = null;
      void webrtcRef.current.handleIncomingOffer(sdp, callType === 'video');
    }

    if (roomChannelRef.current && currentUserId) {
      try {
        void roomChannelRef.current.send({
          type: 'broadcast',
          event: 'call_accept',
          payload: {
            callId: callState.callId,
            responderId: currentUserId,
          },
        });
      } catch {}
    }
  };

  const rejectIncomingCall = () => {
    stopRingVibration();
    clearCallTimers();
    pendingOfferRef.current = null;
    webrtcRef.current.cleanupPeer();
    if (roomChannelRef.current && currentUserId) {
      try {
        void roomChannelRef.current.send({
          type: 'broadcast',
          event: 'call_reject',
          payload: {
            callId: callState.callId,
            responderId: currentUserId,
          },
        });
      } catch {}
    }
    setCallState(IDLE_CALL_STATE);
  };

  const endCall = () => {
    stopRingVibration();
    clearCallTimers();
    pendingOfferRef.current = null;
    webrtcRef.current.cleanupPeer();
    const currentCall = callStateRef.current;
    const activeCallId = currentCall.callId || `call-${Date.now()}`;
    const callKind = currentCall.type;
    const durationText = formatCallDuration(currentCall.seconds);

    const outcome: 'connected' | 'missed' =
      currentCall.status === 'connected' ? 'connected' : 'missed';

    upsertCallLogInChat(activeCallId, callKind, outcome, durationText);

    if (roomChannelRef.current && currentUserId) {
      try {
        void roomChannelRef.current.send({
          type: 'broadcast',
          event: outcome === 'connected' ? 'call_end' : 'call_reject',
          payload: {
            callId: activeCallId,
            endedBy: currentUserId,
          },
        });
      } catch {}
    }

    setCallState(IDLE_CALL_STATE);
  };

  const handleClearChat = () => {
    setMenuVisible(false);
    Alert.alert('Clear Chat', `Clear all messages with ${peerName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          setMessages([]);
          setPinnedMessage(null);
          if (currentUserId && targetUserId) {
            try {
              await backend.chats.deleteConversation(
                currentUserId,
                targetUserId
              );
            } catch {}
          }
        },
      },
    ]);
  };

  const toggleVoicePlayback = useCallback(
    async (msgId: string, audioUrl?: string) => {
      if (!audioUrl) return;
      if (playingVoiceId === msgId) {
        try {
          voicePlayerRef.current?.pause?.();
        } catch {}
        setPlayingVoiceId(null);
        return;
      }
      if (voicePlayerRef.current) {
        try {
          voicePlayerRef.current.pause();
          voicePlayerRef.current.remove();
        } catch {}
        voicePlayerRef.current = null;
      }
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
          shouldRouteThroughEarpiece: false,
        });
        const player = createAudioPlayer({ uri: audioUrl });
        voicePlayerRef.current = player;
        try {
          player.setPlaybackRate?.(voiceSpeed);
        } catch {}
        setPlayingVoiceId(msgId);
        player.addListener('playbackStatusUpdate', (st: any) => {
          if (st?.didJustFinish) {
            setPlayingVoiceId((curr) => (curr === msgId ? null : curr));
          }
        });
        player.play();
      } catch {
        setPlayingVoiceId(null);
        Alert.alert('Playback Error', 'Unable to play this voice note.');
      }
    },
    [playingVoiceId, voiceSpeed]
  );

  const cycleVoicePlaybackSpeed = () => {
    const next: 1 | 1.5 | 2 =
      voiceSpeed === 1 ? 1.5 : voiceSpeed === 1.5 ? 2 : 1;
    setVoiceSpeed(next);
    try {
      voicePlayerRef.current?.setPlaybackRate?.(next);
    } catch {}
  };

  const pickChatMedia = async (mode: 'library' | 'camera' | 'viewOnce') => {
    setAttachSheetVisible(false);
    try {
      if (mode === 'camera') {
        const camPerm = await ImagePicker.requestCameraPermissionsAsync();
        if (!camPerm.granted) {
          Alert.alert(
            'Camera Permission Needed',
            'Please allow camera access to capture photos or videos.'
          );
          return;
        }
      } else {
        const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libPerm.granted) {
          Alert.alert(
            'Media Permission Needed',
            'Please allow photo library access to upload media.'
          );
          return;
        }
      }

      const pickerRes =
        mode === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['images', 'videos'],
              quality: 0.85,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: mode === 'viewOnce' ? ['images'] : ['images', 'videos'],
              quality: 0.85,
            });

      if (pickerRes.canceled || !pickerRes.assets?.[0]?.uri) return;
      const asset = pickerRes.assets[0];
      const isVideo = asset.type === 'video';

      setUploadingMedia(true);
      const uploadedUrl = await backend.storage.uploadMedia(
        asset.uri,
        'chat-media'
      );

      if (mode === 'viewOnce') {
        await sendMessageText(`👁️ View-Once Photo::${uploadedUrl}`, {
          isViewOnce: true,
          viewOnceKind: 'photo',
        });
      } else if (isVideo) {
        await sendMessageText(`🎥 Video::${uploadedUrl}`);
      } else {
        await sendMessageText(`📷 Photo::${uploadedUrl}`);
      }
    } catch (err: any) {
      Alert.alert(
        'Upload Failed',
        err?.message || 'Unable to upload media to chat.'
      );
    } finally {
      setUploadingMedia(false);
    }
  };

  const shareCurrentLocation = async () => {
    setAttachSheetVisible(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission Needed',
          'Allow location permission to share your current location in chat.'
        );
        return;
      }

      setUploadingMedia(true);
      let pos = await Location.getLastKnownPositionAsync({});
      if (!pos) {
        pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      let placeLabel = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: lat,
          longitude: lng,
        });
        const first = places?.[0];
        if (first) {
          const parts = [
            first.name,
            first.street,
            first.city || first.subregion,
            first.region,
          ]
            .filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i);
          if (parts.length > 0) placeLabel = parts.slice(0, 3).join(', ');
        }
      } catch {
        // Fallback to coordinate label
      }

      await sendMessageText(`📍 Location::${lat},${lng}::${placeLabel}`);
    } catch (err: any) {
      Alert.alert(
        'Location Failed',
        err?.message || 'Unable to fetch your current location.'
      );
    } finally {
      setUploadingMedia(false);
    }
  };

  const startVoiceRecording = async () => {
    setAttachSheetVisible(false);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Microphone Permission Needed',
          'Allow microphone permission to record voice notes.'
        );
        return;
      }

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      await voiceRecorder.prepareToRecordAsync();
      voiceRecorder.record();
      setVoiceRecordSec(0);
      setIsRecordingVoice(true);

      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = setInterval(() => {
        setVoiceRecordSec((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      Alert.alert(
        'Voice Recording Error',
        err?.message || 'Could not start voice recording.'
      );
      setIsRecordingVoice(false);
    }
  };

  const cancelVoiceRecording = async () => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    setIsRecordingVoice(false);
    setVoiceRecordSec(0);
    try {
      await voiceRecorder.stop();
    } catch {}
  };

  const stopAndSendVoiceRecording = async (asViewOnce = false) => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    const durLabel = formatCallDuration(Math.max(1, voiceRecordSec));
    setIsRecordingVoice(false);
    setVoiceRecordSec(0);

    try {
      await voiceRecorder.stop();
      const recordedUri = voiceRecorder.uri;
      if (!recordedUri) {
        Alert.alert('Voice Note Empty', 'No audio was captured.');
        return;
      }
      setUploadingMedia(true);
      const uploadedUrl = await backend.storage.uploadMedia(
        recordedUri,
        'chat-voice'
      );
      if (asViewOnce) {
        await sendMessageText(
          `👁️ View-Once Voice (${durLabel})::${uploadedUrl}`,
          { isViewOnce: true, viewOnceKind: 'voice' }
        );
      } else {
        await sendMessageText(`🎤 Voice Note (${durLabel})::${uploadedUrl}`);
      }
    } catch (err: any) {
      Alert.alert(
        'Voice Note Failed',
        err?.message || 'Unable to send voice note.'
      );
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleSendMediaUrl = async () => {
    const raw = chatUrlInput.trim();
    const match = raw.match(/https?:\/\/\S+/i);
    const clean = match
      ? match[0]
      : /^www\.|^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(raw)
        ? `https://${raw}`
        : raw;
    if (!clean || !/^https?:\/\//i.test(clean)) {
      Alert.alert('Invalid URL', 'Enter a valid http/https image or video URL.');
      return;
    }
    setChatUrlModalVisible(false);
    setChatUrlInput('');
    const isVid = /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(clean);
    await sendMessageText(isVid ? `🎥 Video::${clean}` : `📷 Photo::${clean}`);
  };

  const firstName =
    (peerName || peerHandle || 'User').replace(/^@/, '').split(' ')[0] ||
    'User';

  const bottomBarPadding = keyboardVisible ? 8 : Math.max(insets.bottom, 12);
  const sheetBottomPadding = Math.max(insets.bottom, 18) + 10;
  const callTopSafePadding = Math.max(insets.top, 24);
  const callBottomSafePadding = Math.max(insets.bottom, 22) + 10;

  const activeCallDisplayName =
    callState.direction === 'incoming'
      ? callState.remoteName || peerName
      : peerName;

  const activeCallDisplayAvatar =
    callState.direction === 'incoming'
      ? callState.remoteAvatar || peerAvatar || DEFAULT_AVATAR
      : peerAvatar || DEFAULT_AVATAR;

  const renderMessageRow = ({ item }: { item: DbMessageRow }) => {
    const isMe = item.sender_id === currentUserId;
    const textBody = getMessageText(item, isMe, peerName);

    if (item.isSystemAlert) {
      const isScreenshot = item.alertKind === 'screenshot';
      return (
        <View style={styles.systemAlertCenter}>
          <View
            style={[
              styles.systemAlertPill,
              {
                backgroundColor: isScreenshot
                  ? colors.amberSoft
                  : colors.surface,
              },
            ]}
          >
            {isScreenshot ? (
              <MaterialCommunityIcons
                name="camera-off-outline"
                size={13}
                color={colors.amber}
              />
            ) : (
              <Ionicons
                name={
                  item.alertKind === 'privacy'
                    ? 'shield-checkmark-outline'
                    : 'timer-outline'
                }
                size={13}
                color={colors.emerald}
              />
            )}
            <Text
              style={[
                styles.systemAlertText,
                { color: isScreenshot ? colors.amber : colors.subtext },
              ]}
            >
              {textBody}
            </Text>
          </View>
        </View>
      );
    }

    if (item.isCallLog) {
      const isVideo = item.callKind === 'video';
      const isMissed = isMissedOutcome(item.callOutcome);
      const timeLabel = formatShortTime(item.created_at);

      return (
        <View
          style={[
            styles.messageRow,
            isMe ? styles.myMessageRow : styles.otherMessageRow,
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => void startCall(isVideo ? 'video' : 'voice')}
            onLongPress={() => setSelectedMessage(item)}
            style={[
              styles.callLogCard,
              {
                backgroundColor: isMissed ? colors.dangerSoft : colors.surface,
                borderColor: isMissed
                  ? 'rgba(239,68,68,0.25)'
                  : colors.borderStrong,
              },
            ]}
          >
            <View
              style={[
                styles.callLogIconCircle,
                { backgroundColor: isMissed ? MISSED_RED : colors.emerald },
              ]}
            >
              <Ionicons
                name={isVideo ? 'videocam' : 'call'}
                size={15}
                color="#ffffff"
              />
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text
                style={[
                  styles.callLogTitle,
                  { color: isMissed ? MISSED_RED : colors.text },
                ]}
              >
                {textBody}
              </Text>
              <Text style={[styles.callLogTime, { color: colors.subtext }]}>
                {timeLabel} · Tap to call back
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    if (item.isViewOnce) {
      return (
        <View
          style={[
            styles.messageRow,
            isMe ? styles.myMessageRow : styles.otherMessageRow,
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={item.viewOnceOpened}
            onPress={() => handleOpenViewOnce(item)}
            onLongPress={() => setSelectedMessage(item)}
            style={[
              styles.viewOnceBubble,
              {
                backgroundColor: item.viewOnceOpened
                  ? colors.surface
                  : colors.emeraldSoft,
                borderColor: item.viewOnceOpened
                  ? colors.borderStrong
                  : colors.emerald,
              },
            ]}
          >
            <Ionicons
              name={
                item.viewOnceOpened
                  ? 'checkmark-circle-outline'
                  : item.viewOnceKind === 'voice'
                    ? 'mic-outline'
                    : 'eye-outline'
              }
              size={18}
              color={item.viewOnceOpened ? colors.subtext : colors.emerald}
            />
            <View>
              <Text
                style={[
                  styles.viewOnceTitle,
                  { color: item.viewOnceOpened ? colors.subtext : colors.text },
                ]}
              >
                {item.viewOnceOpened
                  ? 'Opened · Expired'
                  : item.viewOnceKind === 'voice'
                    ? 'View-Once Voice Note'
                    : 'View-Once Photo'}
              </Text>
              <Text style={{ fontSize: 10, color: colors.subtext }}>
                {formatShortTime(item.created_at)}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    const isSeen = Boolean(item.is_read) || Boolean(item.seen_at);
    const timeLabel = formatShortTime(item.created_at);

    return (
      <View
        style={[
          styles.messageRow,
          isMe ? styles.myMessageRow : styles.otherMessageRow,
        ]}
      >
        <View style={{ maxWidth: '80%' }}>
          <TouchableOpacity
            activeOpacity={0.85}
            onLongPress={() => setSelectedMessage(item)}
            style={[
              styles.bubble,
              isMe
                ? [styles.myBubble, { backgroundColor: colors.myBubbleBg }]
                : [
                    styles.otherBubble,
                    { backgroundColor: colors.otherBubbleBg },
                  ],
            ]}
          >
            {item.replyToText ? (
              <View
                style={[
                  styles.replyQuoteBox,
                  {
                    backgroundColor: isMe
                      ? 'rgba(128,128,128,0.18)'
                      : colors.card,
                    borderLeftColor: colors.emerald,
                  },
                ]}
              >
                <Text
                  style={[styles.replyQuoteAuthor, { color: colors.emerald }]}
                >
                  {item.replyToAuthor || 'Reply'}
                </Text>
                <Text
                  style={[
                    styles.replyQuoteText,
                    {
                      color: isMe ? colors.myBubbleText : colors.subtext,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {item.replyToText}
                </Text>
              </View>
            ) : null}

            {item.mediaKind === 'photo' && item.mediaUrl ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() =>
                  setMediaViewerItem({ kind: 'photo', url: item.mediaUrl! })
                }
              >
                <Image
                  source={{ uri: item.mediaUrl }}
                  style={styles.chatPhotoMedia}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ) : item.mediaKind === 'video' && item.mediaUrl ? (
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.chatVideoCard}
                onPress={() =>
                  setMediaViewerItem({ kind: 'video', url: item.mediaUrl! })
                }
              >
                <View style={styles.chatVideoPlayCircle}>
                  <Ionicons name="play" size={20} color="#ffffff" />
                </View>
                <Text
                  style={[
                    styles.messageText,
                    { color: isMe ? colors.myBubbleText : colors.otherBubbleText },
                  ]}
                >
                  Video Clip · Tap to watch
                </Text>
              </TouchableOpacity>
            ) : item.mediaKind === 'voice' && item.mediaUrl ? (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.voiceBubbleRow}
                onPress={() => void toggleVoicePlayback(item.id, item.mediaUrl)}
              >
                <View
                  style={[
                    styles.voicePlayCircle,
                    {
                      backgroundColor: isMe
                        ? 'rgba(16, 185, 129, 0.24)'
                        : colors.emeraldSoft,
                    },
                  ]}
                >
                  <Ionicons
                    name={playingVoiceId === item.id ? 'pause' : 'play'}
                    size={16}
                    color={colors.emerald}
                  />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.waveformBarsRow}>
                    {[8, 14, 10, 18, 12, 20, 15, 9, 17, 13, 19, 11, 16, 10, 14, 9].map(
                      (barH, barIdx) => {
                        const isPlayingThis = playingVoiceId === item.id;
                        const activeWave = isPlayingThis && barIdx % 2 === 0;
                        return (
                          <View
                            key={barIdx}
                            style={[
                              styles.waveformBar,
                              {
                                height: activeWave ? Math.min(22, barH + 3) : barH,
                                backgroundColor: isPlayingThis
                                  ? colors.emerald
                                  : isMe
                                    ? colors.myBubbleMeta
                                    : colors.subtext,
                              },
                            ]}
                          />
                        );
                      }
                    )}
                  </View>
                  <View style={styles.voiceMetaRow}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '600',
                        color: isMe ? colors.myBubbleMeta : colors.subtext,
                      }}
                    >
                      {item.voiceDurationLabel || '0:05'} ·{' '}
                      {playingVoiceId === item.id ? 'Playing' : 'Voice'}
                    </Text>
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation?.();
                        cycleVoicePlaybackSpeed();
                      }}
                      style={[
                        styles.voiceSpeedChip,
                        {
                          backgroundColor: isMe
                            ? 'rgba(16, 185, 129, 0.2)'
                            : colors.card,
                        },
                      ]}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text
                        style={[
                          styles.voiceSpeedText,
                          { color: colors.emerald },
                        ]}
                      >
                        {voiceSpeed}x
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            ) : item.mediaKind === 'location' &&
              typeof item.locationLat === 'number' &&
              typeof item.locationLng === 'number' ? (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.locationBubbleCard}
                onPress={() => {
                  const url = `https://maps.google.com/?q=${item.locationLat},${item.locationLng}`;
                  void Linking.openURL(url).catch(() => {});
                }}
              >
                <View style={styles.locationPinBadge}>
                  <Ionicons name="location" size={18} color="#ffffff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.messageText,
                      {
                        fontWeight: '700',
                        color: isMe
                          ? colors.myBubbleText
                          : colors.otherBubbleText,
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {item.locationLabel || 'Shared Location'}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      color: isMe ? colors.myBubbleMeta : colors.subtext,
                      marginTop: 2,
                    }}
                  >
                    Tap to open in Maps
                  </Text>
                </View>
              </TouchableOpacity>
            ) : (
              <Text
                style={[
                  styles.messageText,
                  { color: isMe ? colors.myBubbleText : colors.otherBubbleText },
                ]}
              >
                {textBody || '(Empty message)'}
              </Text>
            )}

            <View style={styles.bubbleFooter}>
              <Text
                style={[
                  styles.timeText,
                  { color: isMe ? colors.myBubbleMeta : colors.subtext },
                ]}
              >
                {timeLabel}
              </Text>
              {isMe && readReceiptsOn && (
                <Ionicons
                  name={isSeen ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={isSeen ? colors.emerald : colors.myBubbleMeta}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          </TouchableOpacity>

          {item.reaction ? (
            <View
              style={[
                styles.reactionPill,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.borderStrong,
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                },
              ]}
            >
              <Text style={{ fontSize: 12 }}>{item.reaction}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const isVideoCall = callState.type === 'video';
  const isVideoIconOn = isVideoCall && !callState.cameraOff;
  const hasAnyRtcStream = Boolean(resolvedRemoteUrl || resolvedLocalUrl);
  const showFallbackCamera =
    isVideoCall &&
    !callState.cameraOff &&
    !hasAnyRtcStream &&
    Boolean(CameraViewComp);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* EDGE-TO-EDGE MODERN HEADER WITH ALWAYS-VISIBLE CALL BUTTONS */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.headerProfileTouch}
            onPress={() => {
              if (!targetUserId) return;
              const cleanHandle = peerHandle.replace(/^@/, '').trim();
              router.push({
                pathname: '/profile',
                params: {
                  userId: targetUserId,
                  ...(cleanHandle ? { username: cleanHandle } : {}),
                  fromChat: '1',
                },
              } as any);
            }}
          >
            <View style={styles.avatarWrap}>
              <Image
                source={{ uri: peerAvatar || DEFAULT_AVATAR }}
                style={styles.profileAvatar}
              />
              {showActiveStatus && (
                <View style={[styles.onlineDot, { borderColor: colors.bg }]} />
              )}
            </View>

            <View style={styles.profileMeta}>
              <Text
                style={[styles.profileName, { color: colors.text }]}
                numberOfLines={1}
              >
                {peerName}
              </Text>
              <Text
                style={[
                  styles.statusText,
                  { color: peerIsTyping ? colors.emerald : colors.subtext },
                ]}
                numberOfLines={1}
              >
                {peerIsTyping
                  ? 'Typing...'
                  : showActiveStatus
                    ? peerHandle
                      ? `${peerHandle} · Active`
                      : 'Active now'
                    : peerHandle || 'Private chat'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.headerCircleBtn, { backgroundColor: colors.surface }]}
            onPress={() => void startCall('voice')}
          >
            <Ionicons name="call-outline" size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerCircleBtn, { backgroundColor: colors.surface }]}
            onPress={() => void startCall('video')}
          >
            <Ionicons name="videocam-outline" size={19} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerCircleBtn, { backgroundColor: colors.surface }]}
            onPress={() => setMenuVisible(true)}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={18}
              color={colors.emerald}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* PINNED MESSAGE BANNER */}
      {pinnedMessage && (
        <View
          style={[
            styles.pinnedBar,
            { backgroundColor: colors.surface, borderBottomColor: colors.border },
          ]}
        >
          <Ionicons name="pin" size={14} color={colors.emerald} />
          <Text
            style={[styles.pinnedText, { color: colors.text }]}
            numberOfLines={1}
          >
            {getMessageText(
              pinnedMessage,
              pinnedMessage.sender_id === currentUserId,
              peerName
            )}
          </Text>
          <TouchableOpacity onPress={() => setPinnedMessage(null)}>
            <Ionicons name="close" size={16} color={colors.subtext} />
          </TouchableOpacity>
        </View>
      )}

      {/* CHAT LOCK OVERLAY */}
      {isChatLockedOverlay ? (
        <View style={styles.lockedScreen}>
          <View
            style={[styles.lockCircle, { backgroundColor: colors.emeraldSoft }]}
          >
            <Ionicons name="lock-closed" size={28} color={colors.emerald} />
          </View>
          <Text style={[styles.emptyChatTitle, { color: colors.text }]}>
            Chat Locked
          </Text>
          <Text style={[styles.emptyChatSub, { color: colors.subtext }]}>
            Verify your identity to view messages with {peerName}.
          </Text>
          <TouchableOpacity
            style={[styles.unlockBtn, { backgroundColor: colors.myBubbleBg }]}
            onPress={() => void handleUnlockChat()}
          >
            <Text style={{ color: colors.myBubbleText, fontWeight: '800' }}>
              Unlock Chat
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
        >
          {loadingPeer ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={colors.emerald} />
              <Text style={[styles.loadingText, { color: colors.subtext }]}>
                Opening chat...
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessageRow}
              contentContainerStyle={styles.chatScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.emptyChatBox}>
                  <Image
                    source={{ uri: peerAvatar || DEFAULT_AVATAR }}
                    style={styles.emptyAvatar}
                  />
                  <Text style={[styles.emptyChatTitle, { color: colors.text }]}>
                    {peerName}
                  </Text>
                  <Text style={[styles.emptyChatSub, { color: colors.subtext }]}>
                    {captureMode === 'block'
                      ? 'Strict Shield ON · Screenshots blocked'
                      : 'Screenshot alerts enabled · End-to-end private chat'}
                  </Text>
                </View>
              }
            />
          )}

          {/* REPLY PREVIEW BAR */}
          {replyingTo && (
            <View
              style={[
                styles.replyComposerBar,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '800',
                    color: colors.emerald,
                  }}
                >
                  Replying to{' '}
                  {replyingTo.sender_id === currentUserId
                    ? 'yourself'
                    : peerName}
                </Text>
                <Text
                  style={{ fontSize: 12.5, color: colors.subtext }}
                  numberOfLines={1}
                >
                  {getMessageText(replyingTo)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyingTo(null)}>
                <Ionicons name="close" size={18} color={colors.subtext} />
              </TouchableOpacity>
            </View>
          )}

          {/* MODERN FLOATING PILL COMPOSER */}
          <View
            style={[
              styles.composerOuter,
              {
                backgroundColor: colors.bg,
                borderTopColor: colors.border,
                paddingBottom: bottomBarPadding,
              },
            ]}
          >
            {uploadingMedia && (
              <View style={styles.uploadingBanner}>
                <ActivityIndicator size="small" color={colors.emerald} />
                <Text style={{ fontSize: 12, color: colors.subtext, fontWeight: '600' }}>
                  Sending attachment...
                </Text>
              </View>
            )}

            {isRecordingVoice ? (
              <View
                style={[styles.composerPill, { backgroundColor: colors.surface }]}
              >
                <TouchableOpacity
                  style={styles.composerLeftBtn}
                  onPress={() => void cancelVoiceRecording()}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </TouchableOpacity>

                <View style={styles.recordingStatusRow}>
                  <View style={styles.recordingPulseDot} />
                  <Text style={[styles.recordingTimerLabel, { color: colors.text }]}>
                    Recording · {formatCallDuration(voiceRecordSec)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.viewOnceMiniSendBtn, { backgroundColor: colors.emeraldSoft }]}
                  onPress={() => void stopAndSendVoiceRecording(true)}
                >
                  <Text style={{ fontSize: 11, fontWeight: '800', color: colors.emerald }}>
                    1x
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: colors.emerald, marginLeft: 6 }]}
                  onPress={() => void stopAndSendVoiceRecording(false)}
                >
                  <Ionicons name="arrow-up" size={18} color="#ffffff" />
                </TouchableOpacity>
              </View>
            ) : (
              <View
                style={[styles.composerPill, { backgroundColor: colors.surface }]}
              >
                <TouchableOpacity
                  style={styles.composerLeftBtn}
                  onPress={() => setAttachSheetVisible(true)}
                  disabled={uploadingMedia}
                >
                  <Ionicons name="add" size={22} color={colors.text} />
                </TouchableOpacity>

                <TextInput
                  style={[styles.textInputBox, { color: colors.text }]}
                  placeholder={`Message ${firstName}...`}
                  placeholderTextColor={colors.subtext}
                  value={inputText}
                  onChangeText={(val) => {
                    setInputText(val);
                    if (val.trim().length > 0) broadcastTyping();
                  }}
                  onSubmitEditing={sendMessage}
                  returnKeyType="send"
                  multiline
                />

                {inputText.trim().length > 0 ? (
                  <TouchableOpacity
                    style={[styles.sendBtn, { backgroundColor: colors.myBubbleBg }]}
                    onPress={sendMessage}
                  >
                    <Ionicons
                      name="arrow-up"
                      size={18}
                      color={colors.myBubbleText}
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.composerRightIcons}>
                    <TouchableOpacity
                      style={styles.composerMiniBtn}
                      onPress={() => void startVoiceRecording()}
                      disabled={uploadingMedia}
                    >
                      <Ionicons
                        name="mic-outline"
                        size={21}
                        color={colors.subtext}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.composerMiniBtn}
                      onPress={() => void pickChatMedia('library')}
                      disabled={uploadingMedia}
                    >
                      <Ionicons
                        name="image-outline"
                        size={21}
                        color={colors.subtext}
                      />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      )}

      {/* MESSAGE ACTIONS + EMOJI REACTIONS SHEET */}
      <Modal
        visible={Boolean(selectedMessage)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedMessage(null)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSelectedMessage(null)}
          />
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />

            <View style={styles.reactionBar}>
              {QUICK_REACTIONS.map((em) => (
                <TouchableOpacity
                  key={em}
                  style={[
                    styles.reactionBarBtn,
                    { backgroundColor: colors.surface },
                  ]}
                  onPress={() => handleReactToMessage(em)}
                >
                  <Text style={{ fontSize: 20 }}>{em}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.sheetOptionRow, { borderTopColor: colors.border }]}
              onPress={() => {
                setReplyingTo(selectedMessage);
                setSelectedMessage(null);
              }}
            >
              <Ionicons
                name="arrow-undo-outline"
                size={19}
                color={colors.text}
              />
              <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                Reply
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetOptionRow, { borderTopColor: colors.border }]}
              onPress={() => {
                setPinnedMessage(selectedMessage);
                setSelectedMessage(null);
              }}
            >
              <Ionicons name="pin-outline" size={19} color={colors.text} />
              <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                Pin to Top
              </Text>
            </TouchableOpacity>

            {selectedMessage?.sender_id === currentUserId &&
              !selectedMessage?.isCallLog &&
              !selectedMessage?.isSystemAlert &&
              !selectedMessage?.mediaKind &&
              !selectedMessage?.isViewOnce && (
                <TouchableOpacity
                  style={[
                    styles.sheetOptionRow,
                    { borderTopColor: colors.border },
                  ]}
                  onPress={openEditForMessage}
                >
                  <Ionicons
                    name="create-outline"
                    size={19}
                    color={colors.text}
                  />
                  <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                    Edit Message
                  </Text>
                </TouchableOpacity>
              )}

            {selectedMessage?.sender_id === currentUserId && (
              <TouchableOpacity
                style={[
                  styles.sheetOptionRow,
                  { borderTopColor: colors.border },
                ]}
                onPress={() => void handleUnsendMessage()}
              >
                <Ionicons
                  name="trash-outline"
                  size={19}
                  color={colors.danger}
                />
                <Text style={[styles.sheetOptionText, { color: colors.danger }]}>
                  Unsend Message
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* EDIT MESSAGE SHEET */}
      <Modal
        visible={Boolean(editingMessage)}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingMessage(null)}
      >
        <KeyboardAvoidingView
          style={styles.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setEditingMessage(null)}
          />
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              Edit Message
            </Text>
            <TextInput
              style={[
                styles.editInput,
                {
                  backgroundColor: colors.surface,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              value={editDraftText}
              onChangeText={setEditDraftText}
              placeholder="Update message..."
              placeholderTextColor={colors.subtext}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[
                  styles.sheetCancelBtn,
                  { flex: 1, marginTop: 0, backgroundColor: colors.surface },
                ]}
                onPress={() => setEditingMessage(null)}
              >
                <Text style={[styles.sheetCancelText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.sheetCancelBtn,
                  { flex: 1, marginTop: 0, backgroundColor: colors.myBubbleBg },
                ]}
                onPress={() => void saveEditedMessage()}
              >
                <Text
                  style={[
                    styles.sheetCancelText,
                    { color: colors.myBubbleText },
                  ]}
                >
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* GROUPED SETTINGS-STYLE CHAT PRIVACY SHEET */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          />
          <View
            style={[
              styles.privacySheetCard,
              {
                backgroundColor: colors.bg,
                paddingBottom: sheetBottomPadding,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />

            <View style={styles.privacySheetHeader}>
              <View>
                <Text style={[styles.privacySheetTitle, { color: colors.text }]}>
                  Chat Privacy
                </Text>
                <Text style={{ fontSize: 12, color: colors.subtext }}>
                  Controls for your chat with {firstName}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.sheetCloseCircle,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setMenuVisible(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 16, paddingBottom: 8 }}
            >
              <View>
                <Text style={[styles.groupHeading, { color: colors.subtext }]}>
                  SCREEN PROTECTION
                </Text>
                <View
                  style={[
                    styles.groupCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.groupBlockPad}>
                    <View style={styles.rowTitleWithIcon}>
                      <View
                        style={[
                          styles.settingIconBox,
                          { backgroundColor: colors.emeraldSoft },
                        ]}
                      >
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={17}
                          color={colors.emerald}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.settingTitle, { color: colors.text }]}
                        >
                          Screenshot & Recording
                        </Text>
                        <Text
                          style={[styles.settingSub, { color: colors.subtext }]}
                        >
                          {captureMode === 'block'
                            ? 'Screenshots & screen recording are blocked'
                            : 'Sends an alert in chat if someone takes a screenshot'}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.segRow, { marginTop: 12 }]}>
                      {(
                        [
                          { key: 'notify', label: 'Notify in Chat' },
                          { key: 'block', label: 'Strict Block' },
                        ] as const
                      ).map((opt) => {
                        const active = captureMode === opt.key;
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[
                              styles.segPill,
                              {
                                backgroundColor: active
                                  ? colors.myBubbleBg
                                  : colors.surface,
                              },
                            ]}
                            onPress={() => handleToggleCaptureMode(opt.key)}
                          >
                            <Text
                              style={{
                                fontSize: 12.5,
                                fontWeight: '700',
                                color: active
                                  ? colors.myBubbleText
                                  : colors.text,
                              }}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </View>

              <View>
                <Text style={[styles.groupHeading, { color: colors.subtext }]}>
                  MESSAGE PRIVACY
                </Text>
                <View
                  style={[
                    styles.groupCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.groupBlockPad,
                      {
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.rowTitleWithIcon}>
                      <View
                        style={[
                          styles.settingIconBox,
                          { backgroundColor: colors.surface },
                        ]}
                      >
                        <Ionicons
                          name="timer-outline"
                          size={17}
                          color={colors.text}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.settingTitle, { color: colors.text }]}
                        >
                          Disappearing Messages
                        </Text>
                        <Text
                          style={[styles.settingSub, { color: colors.subtext }]}
                        >
                          Auto-delete new messages after selected time
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.segRow, { marginTop: 12 }]}>
                      {DISAPPEARING_OPTIONS.map((opt) => {
                        const active = disappearingTimer === opt.key;
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[
                              styles.segPill,
                              {
                                backgroundColor: active
                                  ? colors.myBubbleBg
                                  : colors.surface,
                              },
                            ]}
                            onPress={() =>
                              handleSelectDisappearingTimer(opt.key)
                            }
                          >
                            <Text
                              style={{
                                fontSize: 11.5,
                                fontWeight: '700',
                                color: active
                                  ? colors.myBubbleText
                                  : colors.text,
                              }}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <View
                    style={[
                      styles.groupToggleRow,
                      {
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.settingIconBox,
                        { backgroundColor: colors.surface },
                      ]}
                    >
                      <Ionicons
                        name="checkmark-done-outline"
                        size={17}
                        color={colors.text}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.settingTitle, { color: colors.text }]}
                      >
                        Read Receipts
                      </Text>
                      <Text
                        style={[styles.settingSub, { color: colors.subtext }]}
                      >
                        Show seen ticks when you read messages
                      </Text>
                    </View>
                    <SlidableToggle
                      value={readReceiptsOn}
                      onToggle={() => setReadReceiptsOn((v) => !v)}
                      trackOffColor={colors.toggleOff}
                    />
                  </View>

                  <View style={styles.groupToggleRow}>
                    <View
                      style={[
                        styles.settingIconBox,
                        { backgroundColor: colors.surface },
                      ]}
                    >
                      <Ionicons
                        name="radio-button-on-outline"
                        size={17}
                        color={colors.emerald}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.settingTitle, { color: colors.text }]}
                      >
                        Active Status
                      </Text>
                      <Text
                        style={[styles.settingSub, { color: colors.subtext }]}
                      >
                        Show green dot when you are online here
                      </Text>
                    </View>
                    <SlidableToggle
                      value={showActiveStatus}
                      onToggle={() => setShowActiveStatus((v) => !v)}
                      trackOffColor={colors.toggleOff}
                    />
                  </View>
                </View>
              </View>

              <View>
                <Text style={[styles.groupHeading, { color: colors.subtext }]}>
                  SECURITY & ACTIONS
                </Text>
                <View
                  style={[
                    styles.groupCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.groupToggleRow,
                      {
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.settingIconBox,
                        { backgroundColor: colors.surface },
                      ]}
                    >
                      <Ionicons
                        name="lock-closed-outline"
                        size={17}
                        color={colors.text}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.settingTitle, { color: colors.text }]}
                      >
                        Chat Lock
                      </Text>
                      <Text
                        style={[styles.settingSub, { color: colors.subtext }]}
                      >
                        Require FaceID or Fingerprint to open
                      </Text>
                    </View>
                    <SlidableToggle
                      value={chatLockEnabled}
                      onToggle={() => void handleToggleChatLock()}
                      trackOffColor={colors.toggleOff}
                    />
                  </View>

                  {chatLockEnabled && (
                    <TouchableOpacity
                      style={[
                        styles.groupToggleRow,
                        {
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                        },
                      ]}
                      onPress={() => {
                        setMenuVisible(false);
                        setIsChatLockedOverlay(true);
                      }}
                    >
                      <View
                        style={[
                          styles.settingIconBox,
                          { backgroundColor: colors.emeraldSoft },
                        ]}
                      >
                        <Ionicons
                          name="key-outline"
                          size={17}
                          color={colors.emerald}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.settingTitle,
                            { color: colors.emerald },
                          ]}
                        >
                          Lock This Chat Now
                        </Text>
                        <Text
                          style={[styles.settingSub, { color: colors.subtext }]}
                        >
                          Immediately hide messages behind lock screen
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.subtext}
                      />
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.groupToggleRow}
                    onPress={handleClearChat}
                  >
                    <View
                      style={[
                        styles.settingIconBox,
                        { backgroundColor: colors.dangerSoft },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={17}
                        color={colors.danger}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.settingTitle, { color: colors.danger }]}
                      >
                        Clear Chat History
                      </Text>
                      <Text
                        style={[styles.settingSub, { color: colors.subtext }]}
                      >
                        Delete all messages in this conversation
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ATTACHMENTS & VIEW-ONCE SHEET */}
      <Modal
        visible={attachSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachSheetVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setAttachSheetVisible(false)}
          />
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              Share with {firstName}
            </Text>
            <View style={styles.attachGrid}>
              <TouchableOpacity
                style={[styles.attachTile, { backgroundColor: colors.surface }]}
                onPress={() => void pickChatMedia('library')}
              >
                <Ionicons name="images-outline" size={22} color={colors.text} />
                <Text style={[styles.attachLabel, { color: colors.text }]}>
                  Upload
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.attachTile, { backgroundColor: colors.surface }]}
                onPress={() => void pickChatMedia('camera')}
              >
                <Ionicons name="camera-outline" size={22} color={colors.text} />
                <Text style={[styles.attachLabel, { color: colors.text }]}>
                  Camera
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.attachTile, { backgroundColor: colors.surface }]}
                onPress={() => void pickChatMedia('viewOnce')}
              >
                <Ionicons name="eye-outline" size={22} color={colors.emerald} />
                <Text style={[styles.attachLabel, { color: colors.text }]}>
                  View-Once
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.attachTile, { backgroundColor: colors.surface }]}
                onPress={() => void startVoiceRecording()}
              >
                <Ionicons name="mic-outline" size={22} color={colors.emerald} />
                <Text style={[styles.attachLabel, { color: colors.text }]}>
                  Voice Note
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.attachTile, { backgroundColor: colors.surface }]}
                onPress={() => void shareCurrentLocation()}
              >
                <Ionicons
                  name="location-outline"
                  size={22}
                  color={colors.amber}
                />
                <Text style={[styles.attachLabel, { color: colors.text }]}>
                  Location
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.attachTile, { backgroundColor: colors.surface }]}
                onPress={() => {
                  setAttachSheetVisible(false);
                  setChatUrlInput('');
                  setChatUrlModalVisible(true);
                }}
              >
                <Ionicons name="link-outline" size={22} color={colors.text} />
                <Text style={[styles.attachLabel, { color: colors.text }]}>
                  Media URL
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SEND MEDIA BY URL MODAL */}
      <Modal
        visible={chatUrlModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setChatUrlModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setChatUrlModalVisible(false)}
          />
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              Share Photo or Video URL
            </Text>
            <TextInput
              style={[
                styles.editInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderStrong,
                  color: colors.text,
                },
              ]}
              value={chatUrlInput}
              onChangeText={setChatUrlInput}
              placeholder="https://example.com/media.jpg"
              placeholderTextColor={colors.subtext}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.unlockBtn, { backgroundColor: colors.myBubbleBg }]}
              onPress={() => void handleSendMediaUrl()}
            >
              <Text
                style={{
                  color: colors.myBubbleText,
                  fontWeight: '800',
                  textAlign: 'center',
                }}
              >
                Send Media
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FULLSCREEN PHOTO / VIDEO VIEWER */}
      <Modal
        visible={Boolean(mediaViewerItem)}
        transparent
        animationType="fade"
        onRequestClose={() => setMediaViewerItem(null)}
      >
        <View style={styles.viewOnceModalBg}>
          <TouchableOpacity
            style={{ position: 'absolute', top: 52, right: 20, zIndex: 10 }}
            onPress={() => setMediaViewerItem(null)}
          >
            <Ionicons name="close-circle" size={34} color="#ffffff" />
          </TouchableOpacity>
          {mediaViewerItem?.kind === 'video' ? (
            <ChatVideoViewer uri={mediaViewerItem.url} />
          ) : mediaViewerItem?.url ? (
            <Image
              source={{ uri: mediaViewerItem.url }}
              style={{ width: '100%', height: '82%' }}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>

      {/* VIEW-ONCE PREVIEW MODAL */}
      <Modal
        visible={Boolean(viewOncePreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setViewOncePreview(null)}
      >
        <View style={styles.viewOnceModalBg}>
          {viewOncePreview?.viewOnceKind === 'photo' &&
          viewOncePreview?.viewOnceUrl ? (
            <Image
              source={{ uri: viewOncePreview.viewOnceUrl }}
              style={{ width: '100%', height: '65%', borderRadius: 16 }}
              resizeMode="contain"
            />
          ) : (
            <Ionicons
              name={
                viewOncePreview?.viewOnceKind === 'voice'
                  ? 'mic-circle-outline'
                  : 'image-outline'
              }
              size={64}
              color="#10b981"
            />
          )}
          <Text style={styles.viewOnceModalTitle}>
            {viewOncePreview?.viewOnceKind === 'voice'
              ? 'Playing View-Once Voice Note...'
              : 'Viewing Protected Photo'}
          </Text>
          <Text style={styles.viewOnceModalSub}>
            This media expires as soon as you close it.
          </Text>
          <TouchableOpacity
            style={styles.viewOnceCloseBtn}
            onPress={() => {
              if (voicePlayerRef.current) {
                try {
                  voicePlayerRef.current.pause();
                } catch {}
              }
              setViewOncePreview(null);
            }}
          >
            <Text style={{ color: '#09090b', fontWeight: '800' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* GLASSMORPHIC FULL-SCREEN VOICE & VIDEO CALL MODAL */}
      <Modal
        visible={callState.active}
        transparent={false}
        animationType="fade"
        onRequestClose={endCall}
      >
        <View
          style={[
            styles.callScreen,
            {
              backgroundColor: '#09090b',
              paddingTop: callTopSafePadding,
              paddingBottom: callBottomSafePadding,
            },
          ]}
        >
          <StatusBar barStyle="light-content" />

          {callCaptureAlert && (
            <View style={styles.callAlertBanner}>
              <MaterialCommunityIcons
                name="camera-off-outline"
                size={16}
                color="#fef3c7"
              />
              <Text style={styles.callAlertText}>{callCaptureAlert}</Text>
            </View>
          )}

          {isVideoCall ? (
            <View style={styles.videoFullScreen}>
              <View style={styles.videoMediaLayer}>
                {resolvedRemoteUrl && RTCViewComp ? (
                  <RTCViewComp
                    key={`remote-${resolvedRemoteUrl}`}
                    streamURL={resolvedRemoteUrl}
                    style={StyleSheet.absoluteFill}
                    objectFit="cover"
                  />
                ) : resolvedLocalUrl && RTCViewComp && !callState.cameraOff ? (
                  <RTCViewComp
                    key={`local-${resolvedLocalUrl}`}
                    streamURL={resolvedLocalUrl}
                    style={StyleSheet.absoluteFill}
                    objectFit="cover"
                    mirror={cameraFacing === 'front'}
                  />
                ) : showFallbackCamera ? (
                  <CameraViewComp
                    key="fallback-call-camera"
                    style={StyleSheet.absoluteFill}
                    facing={cameraFacing}
                    onCameraReady={() => setCameraReady(true)}
                  />
                ) : (
                  <View style={styles.cameraFallbackBox}>
                    <Image
                      source={{ uri: activeCallDisplayAvatar }}
                      style={styles.videoPeerImage}
                    />
                    {!cameraReady && !callState.cameraOff && (
                      <TouchableOpacity
                        style={styles.enableCamBtn}
                        onPress={() => void ensureCameraAccess()}
                      >
                        <Ionicons name="videocam" size={16} color="#ffffff" />
                        <Text style={styles.enableCamText}>Enable Camera</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {resolvedRemoteUrl &&
                resolvedLocalUrl &&
                RTCViewComp &&
                !callState.cameraOff && (
                  <View style={styles.localPipBox}>
                    <RTCViewComp
                      key={`pip-rtc-${resolvedLocalUrl}`}
                      streamURL={resolvedLocalUrl}
                      style={StyleSheet.absoluteFill}
                      objectFit="cover"
                      mirror={cameraFacing === 'front'}
                    />
                  </View>
                )}

              <View style={styles.videoTopOverlay}>
                <View style={styles.glassCallHeader}>
                  <Text style={styles.videoHeaderName} numberOfLines={1}>
                    {activeCallDisplayName}
                  </Text>
                  <Text style={styles.videoHeaderSub} numberOfLines={1}>
                    {getCallStatusLabel(
                      callState.status,
                      callState.seconds,
                      'video'
                    )}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.glassCircleBtn}
                  onPress={() => void toggleCameraFacing()}
                >
                  <Ionicons
                    name="camera-reverse-outline"
                    size={20}
                    color="#ffffff"
                  />
                </TouchableOpacity>
              </View>

              {callState.status === 'incoming' ? (
                <View style={styles.incomingActionsRow}>
                  <TouchableOpacity
                    style={styles.rejectCallBtn}
                    onPress={rejectIncomingCall}
                  >
                    <Ionicons name="close" size={28} color="#ffffff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.acceptCallBtn}
                    onPress={() => void acceptIncomingCall()}
                  >
                    <Ionicons name="videocam" size={26} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.glassControlDock}>
                  <TouchableOpacity
                    style={[
                      styles.dockBtn,
                      isVideoIconOn && styles.dockBtnActive,
                    ]}
                    onPress={() => void switchCallType('voice')}
                  >
                    <Ionicons
                      name={isVideoIconOn ? 'videocam' : 'videocam-off'}
                      size={21}
                      color={isVideoIconOn ? '#09090b' : '#ffffff'}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.dockBtn,
                      callState.speaker && styles.dockBtnActive,
                    ]}
                    onPress={() => {
                      const nextSpeaker = !callState.speaker;
                      setCallState((prev) => ({
                        ...prev,
                        speaker: nextSpeaker,
                      }));
                      void applyCallAudioMode({
                        speaker: nextSpeaker,
                        allowsRecording:
                          callState.status === 'connected' || !nextSpeaker,
                      });
                      if (typeof setRtcSpeaker === 'function') {
                        try {
                          setRtcSpeaker(nextSpeaker);
                        } catch {}
                      }
                    }}
                  >
                    <Ionicons
                      name={callState.speaker ? 'volume-high' : 'volume-mute'}
                      size={21}
                      color={callState.speaker ? '#09090b' : '#ffffff'}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.dockBtn,
                      callState.muted && styles.dockBtnActive,
                    ]}
                    onPress={() =>
                      setCallState((prev) => ({ ...prev, muted: !prev.muted }))
                    }
                  >
                    <Ionicons
                      name={callState.muted ? 'mic-off' : 'mic'}
                      size={21}
                      color={callState.muted ? '#09090b' : '#ffffff'}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.dockEndBtn} onPress={endCall}>
                    <Ionicons name="call" size={22} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.voiceFullContainer}>
              <View style={styles.voiceTopRow}>
                <View style={styles.voiceBadgePill}>
                  <View style={styles.voiceLiveDot} />
                  <Text style={styles.voiceBadgeText}>VOICE CALL</Text>
                </View>
              </View>

              <View style={styles.voiceCenterBlock}>
                <View style={styles.callAvatarRing}>
                  <Image
                    source={{ uri: activeCallDisplayAvatar }}
                    style={styles.callAvatar}
                  />
                </View>
                <Text style={styles.callName}>{activeCallDisplayName}</Text>
                <Text style={styles.callTimer}>
                  {getCallStatusLabel(
                    callState.status,
                    callState.seconds,
                    'voice'
                  )}
                </Text>
              </View>

              {callState.status === 'incoming' ? (
                <View style={styles.incomingActionsRow}>
                  <TouchableOpacity
                    style={styles.rejectCallBtn}
                    onPress={rejectIncomingCall}
                  >
                    <Ionicons name="close" size={28} color="#ffffff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.acceptCallBtn}
                    onPress={() => void acceptIncomingCall()}
                  >
                    <Ionicons name="call" size={26} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.glassControlDock}>
                  <TouchableOpacity
                    style={styles.dockBtn}
                    onPress={confirmSwitchToVideo}
                  >
                    <Ionicons name="videocam-off" size={21} color="#ffffff" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.dockBtn,
                      callState.speaker && styles.dockBtnActive,
                    ]}
                    onPress={() => {
                      const nextSpeaker = !callState.speaker;
                      setCallState((prev) => ({
                        ...prev,
                        speaker: nextSpeaker,
                      }));
                      void applyCallAudioMode({
                        speaker: nextSpeaker,
                        allowsRecording:
                          callState.status === 'connected' || !nextSpeaker,
                      });
                      if (typeof setRtcSpeaker === 'function') {
                        try {
                          setRtcSpeaker(nextSpeaker);
                        } catch {}
                      }
                    }}
                  >
                    <Ionicons
                      name={callState.speaker ? 'volume-high' : 'volume-mute'}
                      size={21}
                      color={callState.speaker ? '#09090b' : '#ffffff'}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.dockBtn,
                      callState.muted && styles.dockBtnActive,
                    ]}
                    onPress={() =>
                      setCallState((prev) => ({ ...prev, muted: !prev.muted }))
                    }
                  >
                    <Ionicons
                      name={callState.muted ? 'mic-off' : 'mic'}
                      size={21}
                      color={callState.muted ? '#09090b' : '#ffffff'}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.dockEndBtn} onPress={endCall}>
                    <Ionicons name="call" size={22} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  backBtn: { padding: 4, marginRight: 4 },
  avatarWrap: { position: 'relative', marginRight: 10 },
  profileAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#27272a',
  },
  onlineDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#10b981',
    borderWidth: 2,
  },
  profileMeta: { flex: 1, marginRight: 8 },
  headerProfileTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileName: { fontSize: 15.5, fontWeight: '700', letterSpacing: -0.2 },
  statusText: { fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerCircleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pinnedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  pinnedText: { flex: 1, fontSize: 12.5, fontWeight: '600' },

  lockedScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  lockCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },

  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: { fontSize: 12.5, fontWeight: '600' },

  chatScrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexGrow: 1,
  },
  emptyChatBox: {
    marginTop: 56,
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 6,
  },
  emptyAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    marginBottom: 4,
    backgroundColor: '#27272a',
  },
  emptyChatTitle: { fontSize: 16.5, fontWeight: '800' },
  emptyChatSub: { fontSize: 12.5, textAlign: 'center', lineHeight: 18 },

  systemAlertCenter: { alignItems: 'center', marginVertical: 8 },
  systemAlertPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  systemAlertText: { fontSize: 11.5, fontWeight: '600' },

  callLogCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: '80%',
  },
  callLogIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callLogTitle: { fontSize: 13.5, fontWeight: '700' },
  callLogTime: { fontSize: 11, fontWeight: '500', marginTop: 2 },

  viewOnceBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  viewOnceTitle: { fontSize: 13.5, fontWeight: '700' },

  messageRow: { marginBottom: 8, flexDirection: 'row' },
  myMessageRow: { justifyContent: 'flex-end' },
  otherMessageRow: { justifyContent: 'flex-start' },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  myBubble: { borderBottomRightRadius: 6 },
  otherBubble: { borderBottomLeftRadius: 6 },
  replyQuoteBox: {
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
  },
  replyQuoteAuthor: { fontSize: 10.5, fontWeight: '800' },
  replyQuoteText: { fontSize: 12, marginTop: 1 },
  messageText: { fontSize: 14.5, lineHeight: 20, fontWeight: '500' },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timeText: { fontSize: 10, fontWeight: '600' },
  reactionPill: {
    marginTop: -6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },

  replyComposerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 10,
  },
  composerOuter: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  composerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 26,
    paddingHorizontal: 6,
    paddingVertical: 5,
    minHeight: 46,
  },
  composerLeftBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInputBox: {
    flex: 1,
    fontSize: 14.5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxHeight: 100,
  },
  composerRightIcons: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  composerMiniBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
  sheetTitle: { fontSize: 16.5, fontWeight: '800', marginBottom: 12 },
  segRow: { flexDirection: 'row', gap: 6 },
  segPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  reactionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  reactionBarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  sheetOptionText: { fontSize: 14.5, fontWeight: '600' },
  sheetCancelBtn: {
    marginTop: 10,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelText: { fontSize: 14.5, fontWeight: '700' },
  editInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14.5,
    marginBottom: 14,
  },
  toggleTrack: {
    width: 42,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
  },
  attachGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  attachTile: {
    width: '31%',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    gap: 6,
  },
  attachLabel: { fontSize: 12, fontWeight: '700' },
  chatPhotoMedia: {
    width: 210,
    height: 210,
    borderRadius: 12,
    backgroundColor: '#27272a',
  },
  chatVideoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  chatVideoPlayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 205,
  },
  waveformBarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    height: 22,
  },
  waveformBar: {
    width: 2.5,
    borderRadius: 2,
  },
  voiceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  voiceSpeedChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  voiceSpeedText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  voicePlayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationBubbleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 195,
  },
  locationPinBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  recordingStatusRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  recordingPulseDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#ef4444',
  },
  recordingTimerLabel: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  viewOnceMiniSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  privacySheetCard: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: '84%',
  },
  privacySheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  privacySheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sheetCloseCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupHeading: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 7,
    marginLeft: 4,
  },
  groupCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  groupBlockPad: {
    padding: 14,
  },
  rowTitleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  groupToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  settingIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingTitle: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  settingSub: {
    fontSize: 11.5,
    marginTop: 2,
    lineHeight: 15,
  },

  viewOnceModalBg: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  viewOnceModalTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  viewOnceModalSub: { color: '#a1a1aa', fontSize: 13, textAlign: 'center' },
  viewOnceCloseBtn: {
    marginTop: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 26,
    paddingVertical: 11,
    borderRadius: 999,
  },

  callScreen: { flex: 1, justifyContent: 'space-between' },
  videoFullScreen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  videoMediaLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#09090b',
  },
  cameraFallbackBox: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181b',
  },
  videoPeerImage: { width: '100%', height: '100%', opacity: 0.7 },
  enableCamBtn: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  enableCamText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  localPipBox: {
    position: 'absolute',
    bottom: 104,
    right: 16,
    width: 96,
    height: 136,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#18181b',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    zIndex: 7,
  },
  videoTopOverlay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    zIndex: 8,
  },
  glassCallHeader: {
    backgroundColor: 'rgba(9, 9, 11, 0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    maxWidth: '72%',
  },
  videoHeaderName: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  videoHeaderSub: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  glassCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceFullContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  voiceTopRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  voiceLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10b981',
  },
  voiceBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  voiceCenterBlock: { alignItems: 'center' },
  callAvatarRing: {
    padding: 5,
    borderRadius: 72,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  callAvatar: { width: 124, height: 124, borderRadius: 62 },
  callName: { color: '#ffffff', fontSize: 23, fontWeight: '800', marginTop: 16 },
  callTimer: { color: '#a1a1aa', fontSize: 14, fontWeight: '600', marginTop: 6 },
  callAlertBanner: {
    position: 'absolute',
    top: 64,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#92400e',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 12,
  },
  callAlertText: { color: '#fef3c7', fontSize: 12, fontWeight: '700', flex: 1 },
  incomingActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 44,
    zIndex: 9,
  },
  rejectCallBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptCallBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassControlDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    backgroundColor: 'rgba(24, 24, 27, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
    width: '100%',
    zIndex: 9,
  },
  dockBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockBtnActive: { backgroundColor: '#ffffff' },
  dockEndBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
});