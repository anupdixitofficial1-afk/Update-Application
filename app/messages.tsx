import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
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
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ScreenCapture from 'expo-screen-capture';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';

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
  alertKind?: 'disappearing' | 'screenshot';
  alertSide?: 'left' | 'right';
  isCallLog?: boolean;
  callKind?: 'voice' | 'video';
  callOutcome?: 'calling' | 'connected' | 'missed' | 'not_connected';
  callDurationText?: string;
}

type CallStatus = 'idle' | 'ringing' | 'incoming' | 'connected';

interface CallState {
  active: boolean;
  status: CallStatus;
  callId: string | null;
  type: 'voice' | 'video';
  muted: boolean;
  speaker: boolean;
  cameraOff: boolean;
  seconds: number;
}

const DEFAULT_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';
const SEEN_COLOR = '#059669';
const UNSEEN_COLOR = '#94a3b8';
const MISSED_RED = '#ef4444';

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

const getRoomChannelName = (userA: string, userB: string) => {
  const sorted = [userA, userB].sort();
  return `chat-room-${sorted[0]}-${sorted[1]}`;
};

const isMissedOutcome = (outcome?: DbMessageRow['callOutcome']) =>
  outcome === 'missed' || outcome === 'not_connected';

const getMessageText = (row: DbMessageRow): string => {
  if (row.isCallLog) {
    const title = row.callKind === 'video' ? 'Video call' : 'Voice call';
    if (isMissedOutcome(row.callOutcome)) return `${title} · Missed`;
    if (row.callOutcome === 'connected') {
      return `${title} · ${row.callDurationText || '00:00'}`;
    }
    return `${title} · Calling...`;
  }

  const candidates = [row.content, row.body, row.message, row.text, row.msg];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
  }
  return '';
};

function SlidableToggle({
  value,
  onToggle,
}: {
  value: boolean;
  onToggle: () => void;
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
        value ? styles.toggleTrackOn : styles.toggleTrackOff,
      ]}
    >
      <Animated.View
        style={[styles.toggleThumb, { transform: [{ translateX }] }]}
      />
    </TouchableOpacity>
  );
}

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    userId?: string;
    name?: string;
    username?: string;
    avatarUrl?: string;
  }>();

  const flatListRef = useRef<FlatList<DbMessageRow>>(null);
  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  );
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStateRef = useRef<CallState>({
    active: false,
    status: 'idle',
    callId: null,
    type: 'voice',
    muted: false,
    speaker: true,
    cameraOff: false,
    seconds: 0,
  });

  const targetUserId =
    typeof params?.userId === 'string' && params.userId.trim()
      ? params.userId.trim()
      : '';

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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
  const [loadingPeer, setLoadingPeer] = useState(Boolean(targetUserId));
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const [messages, setMessages] = useState<DbMessageRow[]>([]);
  const [disappearingOn, setDisappearingOn] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [attachSheetVisible, setAttachSheetVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<DbMessageRow | null>(
    null
  );

  const [callState, setCallState] = useState<CallState>({
    active: false,
    status: 'idle',
    callId: null,
    type: 'voice',
    muted: false,
    speaker: true,
    cameraOff: false,
    seconds: 0,
  });

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearRingTimeout();
    };
  }, [clearRingTimeout]);

  const upsertCallLogInChat = useCallback(
    (
      callId: string,
      callKind: 'voice' | 'video',
      callOutcome: 'calling' | 'connected' | 'missed' | 'not_connected',
      callDurationText?: string
    ) => {
      if (!callId) return;
      const logId = `call-log-${callId}`;
      const title = callKind === 'video' ? 'Video call' : 'Voice call';
      const label = isMissedOutcome(callOutcome)
        ? `${title} · Missed`
        : callOutcome === 'connected'
          ? `${title} · ${callDurationText || '00:00'}`
          : `${title} · Calling...`;

      setMessages((prev) => {
        const exists = prev.some((m) => m.id === logId);
        if (exists) {
          return prev.map((m) =>
            m.id === logId
              ? {
                  ...m,
                  content: label,
                  callOutcome,
                  callDurationText: callDurationText ?? m.callDurationText,
                }
              : m
          );
        }
        const row: DbMessageRow = {
          id: logId,
          sender_id: currentUserId,
          receiver_id: targetUserId,
          content: label,
          created_at: new Date().toISOString(),
          is_read: false,
          seen_at: null,
          isCallLog: true,
          callKind,
          callOutcome,
          callDurationText,
        };
        return [...prev, row];
      });
    },
    [currentUserId, targetUserId]
  );

  const appendLocalAlert = useCallback(
    (
      text: string,
      alertKind: 'disappearing' | 'screenshot',
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
      setMessages((prev) => [...prev, alertRow]);
    },
    []
  );

  useEffect(() => {
    if (!callState.active || callState.status !== 'connected') return;
    const interval = setInterval(() => {
      setCallState((prev) => ({ ...prev, seconds: prev.seconds + 1 }));
    }, 1000);
    return () => clearInterval(interval);
  }, [callState.active, callState.status]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

    if (!targetUserId) {
      setLoadingPeer(false);
      return;
    }

    (async () => {
      try {
        setLoadingPeer(true);
        const { data } = await supabase
          .from('profiles')
          .select('full_name, username, avatar_url')
          .eq('id', targetUserId)
          .maybeSingle();

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
        if (data.avatar_url && !paramAvatar) {
          setPeerAvatar(String(data.avatar_url).trim());
        }
      } catch {
        // Keep param values if fetch fails
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
      if (!myId || !senderId) return;
      const seenIso = new Date().toISOString();

      setMessages((prev) =>
        prev.map((m) =>
          m.sender_id === senderId && m.receiver_id === myId && !m.is_read
            ? { ...m, is_read: true, seen_at: seenIso }
            : m
        )
      );

      try {
        await supabase
          .from('messages')
          .update({ is_read: true, seen_at: seenIso })
          .eq('sender_id', senderId)
          .eq('receiver_id', myId)
          .eq('is_read', false);
      } catch {
        // Ignore if schema columns differ
      }
    },
    []
  );

  const loadMessages = useCallback(async () => {
    if (!targetUserId) return;

    try {
      const { data: authData } = await supabase.auth.getUser();
      const myId = authData?.user?.id ?? null;
      setCurrentUserId(myId);

      if (!myId) return;

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${myId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${myId})`
        )
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        setMessages((prev) => {
          const localItems = prev.filter(
            (item) => item.isSystemAlert || item.isCallLog
          );
          return [...(data as DbMessageRow[]), ...localItems];
        });
      }

      await markIncomingSeen(myId, targetUserId);
    } catch {
      // Keep existing list on error
    }
  }, [targetUserId, markIncomingSeen]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!currentUserId || !targetUserId) return;

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void markIncomingSeen(currentUserId, targetUserId);
      }
    });

    const msgChannel = supabase
      .channel(`chat-thread-${currentUserId}-${targetUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as DbMessageRow;
          const matchesThread =
            (row.sender_id === currentUserId &&
              row.receiver_id === targetUserId) ||
            (row.sender_id === targetUserId &&
              row.receiver_id === currentUserId);

          if (!matchesThread) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });

          if (
            row.sender_id === targetUserId &&
            row.receiver_id === currentUserId
          ) {
            void markIncomingSeen(currentUserId, targetUserId);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const updated = payload.new as DbMessageRow;
          if (!updated?.id) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id
                ? {
                    ...m,
                    is_read: updated.is_read ?? m.is_read,
                    seen_at: updated.seen_at ?? m.seen_at,
                  }
                : m
            )
          );
        }
      )
      .subscribe();

    const roomName = getRoomChannelName(currentUserId, targetUserId);
    const roomChannel = supabase
      .channel(roomName)
      .on('broadcast', { event: 'screenshot_taken' }, ({ payload }) => {
        if (!payload || payload.actorId === currentUserId) return;
        appendLocalAlert(
          `${peerName} took a screenshot of this chat`,
          'screenshot',
          'left'
        );
      })
      .on('broadcast', { event: 'call_invite' }, ({ payload }) => {
        if (!payload || payload.callerId === currentUserId) return;
        setCallState({
          active: true,
          status: 'incoming',
          callId: String(payload.callId || Date.now()),
          type: payload.callType === 'video' ? 'video' : 'voice',
          muted: false,
          speaker: true,
          cameraOff: false,
          seconds: 0,
        });
      })
      .on('broadcast', { event: 'call_accept' }, ({ payload }) => {
        if (!payload || payload.responderId === currentUserId) return;
        clearRingTimeout();
        const activeCallId =
          String(payload.callId || callStateRef.current.callId || '');
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
            ? { ...prev, status: 'connected', seconds: 0 }
            : prev
        );
      })
      .on('broadcast', { event: 'call_reject' }, ({ payload }) => {
        if (!payload || payload.responderId === currentUserId) return;
        clearRingTimeout();
        const activeCallId =
          String(payload.callId || callStateRef.current.callId || '');
        if (activeCallId) {
          upsertCallLogInChat(
            activeCallId,
            callStateRef.current.type,
            'missed'
          );
        }
        setCallState({
          active: false,
          status: 'idle',
          callId: null,
          type: 'voice',
          muted: false,
          speaker: true,
          cameraOff: false,
          seconds: 0,
        });
      })
      .on('broadcast', { event: 'call_end' }, ({ payload }) => {
        if (!payload || payload.endedBy === currentUserId) return;
        clearRingTimeout();
        const activeCallId =
          String(payload.callId || callStateRef.current.callId || '');
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
        setCallState({
          active: false,
          status: 'idle',
          callId: null,
          type: 'voice',
          muted: false,
          speaker: true,
          cameraOff: false,
          seconds: 0,
        });
      })
      .subscribe();

    roomChannelRef.current = roomChannel;

    const screenshotSub = ScreenCapture.addScreenshotListener(() => {
      appendLocalAlert(
        'You took a screenshot of this chat',
        'screenshot',
        'right'
      );

      if (roomChannelRef.current) {
        void roomChannelRef.current.send({
          type: 'broadcast',
          event: 'screenshot_taken',
          payload: {
            actorId: currentUserId,
            targetUserId,
            at: new Date().toISOString(),
          },
        });
      }
    });

    return () => {
      appStateSub.remove();
      screenshotSub.remove();
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(roomChannel);
      roomChannelRef.current = null;
    };
  }, [
    currentUserId,
    targetUserId,
    peerName,
    markIncomingSeen,
    appendLocalAlert,
    clearRingTimeout,
    upsertCallLogInChat,
  ]);

  const sendMessageText = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || !currentUserId || !targetUserId || sending) return;

    const tempId = `temp-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const optimistic: DbMessageRow = {
      id: tempId,
      sender_id: currentUserId,
      receiver_id: targetUserId,
      content: trimmed,
      created_at: nowIso,
      is_read: false,
      seen_at: null,
    };

    setSending(true);
    setMessages((prev) => [...prev, optimistic]);

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          sender_id: currentUserId,
          receiver_id: targetUserId,
          content: trimmed,
          is_read: false,
          seen_at: null,
        })
        .select('*')
        .single();

      if (!error && data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? (data as DbMessageRow) : m))
        );
      }
    } catch {
      // Keep optimistic row on network issue
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

  const handleUnsendMessage = async () => {
    if (!selectedMessage) return;
    const targetId = selectedMessage.id;

    setMessages((prev) => prev.filter((m) => m.id !== targetId));
    setSelectedMessage(null);

    if (
      !targetId.startsWith('temp-') &&
      !selectedMessage.isSystemAlert &&
      !selectedMessage.isCallLog
    ) {
      try {
        await supabase.from('messages').delete().eq('id', targetId);
      } catch {
        // Ignore if delete restricted
      }
    }
  };

  const toggleDisappearingMessages = () => {
    const nextState = !disappearingOn;
    setDisappearingOn(nextState);

    appendLocalAlert(
      nextState
        ? 'You turned ON disappearing msg · 24h'
        : 'You turned OFF disappearing msg',
      'disappearing',
      'right'
    );
  };

  const startCall = (type: 'voice' | 'video') => {
    clearRingTimeout();
    const nextCallId = `call-${Date.now()}`;

    upsertCallLogInChat(nextCallId, type, 'calling');

    setCallState({
      active: true,
      status: 'ringing',
      callId: nextCallId,
      type,
      muted: false,
      speaker: true,
      cameraOff: false,
      seconds: 0,
    });

    if (roomChannelRef.current && currentUserId) {
      void roomChannelRef.current.send({
        type: 'broadcast',
        event: 'call_invite',
        payload: {
          callId: nextCallId,
          callerId: currentUserId,
          calleeId: targetUserId,
          callType: type,
        },
      });
    }

    ringTimeoutRef.current = setTimeout(() => {
      if (
        callStateRef.current.callId === nextCallId &&
        callStateRef.current.status === 'ringing'
      ) {
        upsertCallLogInChat(nextCallId, type, 'missed');
        setCallState({
          active: false,
          status: 'idle',
          callId: null,
          type: 'voice',
          muted: false,
          speaker: true,
          cameraOff: false,
          seconds: 0,
        });
      }
    }, 20000);
  };

  const acceptIncomingCall = () => {
    clearRingTimeout();
    setCallState((prev) => ({
      ...prev,
      active: true,
      status: 'connected',
      seconds: 0,
    }));

    if (roomChannelRef.current && currentUserId) {
      void roomChannelRef.current.send({
        type: 'broadcast',
        event: 'call_accept',
        payload: {
          callId: callState.callId,
          responderId: currentUserId,
        },
      });
    }
  };

  const rejectIncomingCall = () => {
    clearRingTimeout();
    if (roomChannelRef.current && currentUserId) {
      void roomChannelRef.current.send({
        type: 'broadcast',
        event: 'call_reject',
        payload: {
          callId: callState.callId,
          responderId: currentUserId,
        },
      });
    }

    setCallState({
      active: false,
      status: 'idle',
      callId: null,
      type: 'voice',
      muted: false,
      speaker: true,
      cameraOff: false,
      seconds: 0,
    });
  };

  const endCall = () => {
    clearRingTimeout();
    const currentCall = callStateRef.current;
    const activeCallId = currentCall.callId || `call-${Date.now()}`;
    const callKind = currentCall.type;
    const durationText = formatCallDuration(currentCall.seconds);

    const outcome: 'connected' | 'missed' =
      currentCall.status === 'connected' ? 'connected' : 'missed';

    upsertCallLogInChat(activeCallId, callKind, outcome, durationText);

    if (roomChannelRef.current && currentUserId) {
      void roomChannelRef.current.send({
        type: 'broadcast',
        event: outcome === 'connected' ? 'call_end' : 'call_reject',
        payload: {
          callId: activeCallId,
          endedBy: currentUserId,
        },
      });
    }

    setCallState({
      active: false,
      status: 'idle',
      callId: null,
      type: 'voice',
      muted: false,
      speaker: true,
      cameraOff: false,
      seconds: 0,
    });
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
          if (currentUserId && targetUserId) {
            try {
              await supabase
                .from('messages')
                .delete()
                .or(
                  `and(sender_id.eq.${currentUserId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${currentUserId})`
                );
            } catch {
              // Ignore if delete restricted
            }
          }
        },
      },
    ]);
  };

  const sendQuickAttachment = (label: string) => {
    setAttachSheetVisible(false);
    void sendMessageText(label);
  };

  const firstName =
    (peerName || peerHandle || 'User').replace(/^@/, '').split(' ')[0] ||
    'User';

  const bottomBarPadding = keyboardVisible
    ? 10
    : Math.max(insets.bottom, 12);

  const renderMessageRow = ({ item }: { item: DbMessageRow }) => {
    const textBody = getMessageText(item);

    if (item.isSystemAlert) {
      const isScreenshot = item.alertKind === 'screenshot';
      const isLeft = item.alertSide === 'left';

      return (
        <View
          style={[
            styles.systemAlertWrap,
            isLeft ? styles.alertAlignLeft : styles.alertAlignRight,
          ]}
        >
          <View
            style={[
              styles.systemAlertPill,
              isScreenshot
                ? styles.screenshotAlertPill
                : styles.disappearingAlertPill,
            ]}
          >
            {isScreenshot ? (
              <MaterialCommunityIcons
                name="camera-off-outline"
                size={13}
                color="#b45309"
                style={{ marginRight: 5 }}
              />
            ) : (
              <Ionicons
                name="timer-outline"
                size={13}
                color="#059669"
                style={{ marginRight: 5 }}
              />
            )}
            <Text
              style={[
                styles.systemAlertText,
                isScreenshot
                  ? styles.screenshotAlertText
                  : styles.disappearingAlertText,
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
        <View style={[styles.messageRow, styles.myMessageRow]}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => startCall(isVideo ? 'video' : 'voice')}
            style={[
              styles.callLogBubble,
              isMissed
                ? styles.missedCallBubble
                : isVideo
                  ? styles.videoCallBubble
                  : styles.voiceCallBubble,
            ]}
          >
            <View
              style={[
                styles.callLogBadge,
                {
                  backgroundColor: isMissed
                    ? MISSED_RED
                    : isVideo
                      ? '#2563eb'
                      : '#059669',
                },
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
                  styles.callLogText,
                  isMissed && { color: MISSED_RED },
                ]}
              >
                {textBody}
              </Text>
              <Text style={styles.callLogTime}>{timeLabel}</Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    const isMe = item.sender_id === currentUserId;
    const isSeen = Boolean(item.is_read) || Boolean(item.seen_at);
    const statusTint = isSeen ? SEEN_COLOR : UNSEEN_COLOR;
    const timeLabel = formatShortTime(item.created_at);

    return (
      <View
        style={[
          styles.messageRow,
          isMe ? styles.myMessageRow : styles.otherMessageRow,
        ]}
      >
        <TouchableOpacity
          activeOpacity={isMe ? 0.85 : 1}
          disabled={!isMe}
          onLongPress={() => {
            if (isMe) setSelectedMessage(item);
          }}
          style={[
            styles.bubbleContainer,
            isMe ? styles.myBubble : styles.otherBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isMe ? styles.myMessageText : styles.otherMessageText,
            ]}
          >
            {textBody || '(Empty message)'}
          </Text>
          <View style={styles.bubbleFooter}>
            <Text
              style={[
                styles.timeText,
                isMe ? styles.myTimeText : styles.otherTimeText,
              ]}
            >
              {timeLabel}
            </Text>
            {isMe && (
              <View style={styles.tickRow}>
                <Ionicons
                  name={isSeen ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={statusTint}
                  style={{ marginLeft: 4 }}
                />
                {isSeen && (
                  <Text style={[styles.seenLabel, { color: statusTint }]}>
                    Seen
                  </Text>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* HEADER */}
      <View style={styles.headerContainer}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={24} color="#0f172a" />
          </TouchableOpacity>
          <Image
            source={{ uri: peerAvatar || DEFAULT_AVATAR }}
            style={styles.profileAvatar}
          />
          <View style={styles.profileMeta}>
            <Text style={styles.profileName} numberOfLines={1}>
              {peerName}
            </Text>
            <View style={styles.statusRow}>
              <View style={styles.greenDot} />
              <Text style={styles.statusText} numberOfLines={1}>
                {peerHandle ? `${peerHandle} · Active` : 'Active'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => startCall('voice')}
          >
            <Ionicons name="call-outline" size={20} color="#0f172a" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => startCall('video')}
          >
            <Ionicons name="videocam-outline" size={22} color="#0f172a" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setMenuVisible(true)}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#0f172a" />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
      >
        {loadingPeer ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#059669" />
            <Text style={styles.loadingText}>Opening chat...</Text>
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
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: true })
            }
            ListEmptyComponent={
              <View style={styles.emptyChatBox}>
                <Text style={styles.emptyChatTitle}>
                  Start a conversation with {peerName}
                </Text>
                <Text style={styles.emptyChatSub}>
                  Messages sent here only appear in this chat with {peerName}.
                </Text>
              </View>
            }
          />
        )}

        {/* BOTTOM CHAT INPUT BAR */}
        <View
          style={[
            styles.inputContainer,
            { paddingBottom: bottomBarPadding },
          ]}
        >
          <TouchableOpacity
            style={styles.inputIconLeft}
            onPress={() => setAttachSheetVisible(true)}
          >
            <Ionicons name="add-circle-outline" size={24} color="#64748b" />
          </TouchableOpacity>

          <TextInput
            style={styles.textInputBox}
            placeholder={`Message ${firstName}...`}
            placeholderTextColor="#94a3b8"
            value={inputText}
            onChangeText={setInputText}
          />

          {inputText.trim().length > 0 ? (
            <TouchableOpacity style={styles.sendActiveBtn} onPress={sendMessage}>
              <Ionicons name="send" size={15} color="#ffffff" />
            </TouchableOpacity>
          ) : (
            <View style={styles.inputIconsRightGroup}>
              <TouchableOpacity
                style={{ marginRight: 10 }}
                onPress={() => sendQuickAttachment('🎤 Voice note (0:05)')}
              >
                <Ionicons name="mic-outline" size={22} color="#64748b" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => sendQuickAttachment('📷 Shared a photo')}
              >
                <Ionicons name="image-outline" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* MESSAGE UNSEND MODAL */}
      <Modal
        visible={Boolean(selectedMessage)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMessage(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdropBottom}
          activeOpacity={1}
          onPress={() => setSelectedMessage(null)}
        >
          <View style={styles.unsendSheet}>
            <Text style={styles.unsendPreview} numberOfLines={2}>
              {selectedMessage ? getMessageText(selectedMessage) : ''}
            </Text>
            <TouchableOpacity
              style={styles.unsendActionBtn}
              onPress={handleUnsendMessage}
            >
              <Ionicons
                name="arrow-undo-outline"
                size={18}
                color="#dc2626"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.unsendActionText}>Unsend Message</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelActionBtn}
              onPress={() => setSelectedMessage(null)}
            >
              <Text style={styles.cancelActionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MORE OPTIONS MODAL (4 OPTIONS WITH SLIDABLE DISAPPEARING TOGGLE) */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuCard}>
            <View style={styles.menuToggleRow}>
              <View style={styles.menuToggleLeft}>
                <Ionicons
                  name="timer-outline"
                  size={18}
                  color="#059669"
                  style={{ marginRight: 10 }}
                />
                <Text style={styles.menuItemText}>Disappearing Msg</Text>
              </View>
              <SlidableToggle
                value={disappearingOn}
                onToggle={toggleDisappearingMessages}
              />
            </View>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                startCall('voice');
              }}
            >
              <Ionicons
                name="call-outline"
                size={18}
                color="#0f172a"
                style={{ marginRight: 10 }}
              />
              <Text style={styles.menuItemText}>Voice Call</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                startCall('video');
              }}
            >
              <Ionicons
                name="videocam-outline"
                size={18}
                color="#0f172a"
                style={{ marginRight: 10 }}
              />
              <Text style={styles.menuItemText}>Video Call</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, { borderBottomWidth: 0 }]}
              onPress={handleClearChat}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color="#dc2626"
                style={{ marginRight: 10 }}
              />
              <Text style={[styles.menuItemText, { color: '#dc2626' }]}>
                Clear Chat
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ATTACHMENT OPTIONS MODAL */}
      <Modal
        visible={attachSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdropBottom}
          activeOpacity={1}
          onPress={() => setAttachSheetVisible(false)}
        >
          <View style={styles.attachSheet}>
            <Text style={styles.attachTitle}>Share with {firstName}</Text>
            <View style={styles.attachGrid}>
              <TouchableOpacity
                style={styles.attachBtn}
                onPress={() => sendQuickAttachment('📷 Photo attachment')}
              >
                <Ionicons name="image" size={22} color="#059669" />
                <Text style={styles.attachLabel}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachBtn}
                onPress={() => sendQuickAttachment('📍 Shared current location')}
              >
                <Ionicons name="location" size={22} color="#059669" />
                <Text style={styles.attachLabel}>Location</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachBtn}
                onPress={() => sendQuickAttachment('📎 Shared a document')}
              >
                <Ionicons name="document" size={22} color="#059669" />
                <Text style={styles.attachLabel}>File</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* VOICE / VIDEO CALL MODAL */}
      <Modal
        visible={callState.active}
        transparent={false}
        animationType="slide"
        onRequestClose={endCall}
      >
        <View style={styles.callScreen}>
          <Text style={styles.callModeBadge}>
            {callState.type === 'video' ? 'VIDEO CALL' : 'VOICE CALL'}
          </Text>

          <Image
            source={{ uri: peerAvatar || DEFAULT_AVATAR }}
            style={[
              styles.callAvatar,
              callState.type === 'video' &&
                callState.cameraOff && { opacity: 0.4 },
            ]}
          />

          <Text style={styles.callName}>{peerName}</Text>
          <Text style={styles.callTimer}>
            {callState.status === 'ringing'
              ? 'Calling...'
              : callState.status === 'incoming'
                ? 'Incoming call...'
                : formatCallDuration(callState.seconds)}
          </Text>

          {callState.status === 'incoming' ? (
            <View style={styles.incomingActionsRow}>
              <TouchableOpacity
                style={styles.rejectCallBtn}
                onPress={rejectIncomingCall}
              >
                <Ionicons name="close" size={26} color="#ffffff" />
                <Text style={styles.callControlText}>Decline</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.acceptCallBtn}
                onPress={acceptIncomingCall}
              >
                <Ionicons name="call" size={26} color="#ffffff" />
                <Text style={styles.callControlText}>Accept</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.callControlsRow}>
                <TouchableOpacity
                  style={[
                    styles.callControlBtn,
                    callState.muted && styles.callControlActive,
                  ]}
                  onPress={() =>
                    setCallState((prev) => ({ ...prev, muted: !prev.muted }))
                  }
                >
                  <Ionicons
                    name={callState.muted ? 'mic-off' : 'mic'}
                    size={22}
                    color="#ffffff"
                  />
                  <Text style={styles.callControlText}>
                    {callState.muted ? 'Unmute' : 'Mute'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.callControlBtn,
                    callState.speaker && styles.callControlActive,
                  ]}
                  onPress={() =>
                    setCallState((prev) => ({
                      ...prev,
                      speaker: !prev.speaker,
                    }))
                  }
                >
                  <Ionicons
                    name={callState.speaker ? 'volume-high' : 'volume-mute'}
                    size={22}
                    color="#ffffff"
                  />
                  <Text style={styles.callControlText}>Speaker</Text>
                </TouchableOpacity>

                {callState.type === 'video' && (
                  <TouchableOpacity
                    style={[
                      styles.callControlBtn,
                      callState.cameraOff && styles.callControlActive,
                    ]}
                    onPress={() =>
                      setCallState((prev) => ({
                        ...prev,
                        cameraOff: !prev.cameraOff,
                      }))
                    }
                  >
                    <Ionicons
                      name={callState.cameraOff ? 'videocam-off' : 'videocam'}
                      size={22}
                      color="#ffffff"
                    />
                    <Text style={styles.callControlText}>
                      {callState.cameraOff ? 'Cam Off' : 'Camera'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity style={styles.endCallBtn} onPress={endCall}>
                <Ionicons name="call" size={26} color="#ffffff" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  keyboardWrapper: { flex: 1 },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  backButton: { padding: 4, marginRight: 4 },
  profileAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 10,
    backgroundColor: '#e2e8f0',
  },
  profileMeta: { justifyContent: 'center', flex: 1 },
  profileName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  greenDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10b981',
    marginRight: 5,
  },
  statusText: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerIconBtn: { padding: 7, marginLeft: 2 },

  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },

  chatScrollContent: { paddingHorizontal: 16, paddingVertical: 14, flexGrow: 1 },

  emptyChatBox: {
    marginTop: 48,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyChatTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  emptyChatSub: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },

  systemAlertWrap: {
    marginBottom: 10,
  },
  alertAlignLeft: {
    alignItems: 'flex-start',
  },
  alertAlignRight: {
    alignItems: 'flex-end',
  },
  systemAlertPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    maxWidth: '82%',
    borderWidth: 1,
  },
  disappearingAlertPill: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  screenshotAlertPill: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  systemAlertText: {
    fontSize: 11,
    fontWeight: '600',
  },
  disappearingAlertText: {
    color: '#059669',
  },
  screenshotAlertText: {
    color: '#b45309',
  },

  callLogBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: '78%',
  },
  voiceCallBubble: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  videoCallBubble: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  missedCallBubble: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  callLogBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  callLogText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  callLogTime: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '600',
  },

  messageRow: { marginBottom: 12, flexDirection: 'row' },
  myMessageRow: { justifyContent: 'flex-end' },
  otherMessageRow: { justifyContent: 'flex-start' },

  bubbleContainer: {
    maxWidth: '75%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  myBubble: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#eff6ff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },

  messageText: { fontSize: 14, lineHeight: 20 },
  myMessageText: { color: '#0f172a', fontWeight: '500' },
  otherMessageText: { color: '#0f172a' },

  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timeText: { fontSize: 9 },
  myTimeText: { color: '#64748b' },
  otherTimeText: { color: '#64748b' },
  tickRow: { flexDirection: 'row', alignItems: 'center' },
  seenLabel: {
    fontSize: 9,
    fontWeight: '700',
    marginLeft: 3,
  },

  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  inputIconLeft: { marginRight: 8 },
  textInputBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  inputIconsRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  sendActiveBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },

  unsendSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
  },
  unsendPreview: {
    fontSize: 13,
    color: '#475569',
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  unsendActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    marginBottom: 8,
  },
  unsendActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#dc2626',
  },
  cancelActionBtn: {
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  cancelActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 58,
    paddingRight: 12,
  },
  menuCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 6,
    minWidth: 230,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  menuToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  menuToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  toggleTrack: {
    width: 42,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: '#10b981',
  },
  toggleTrackOff: {
    backgroundColor: '#cbd5e1',
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  menuItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },

  modalBackdropBottom: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  attachSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
  },
  attachTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 14,
  },
  attachGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  attachBtn: {
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    minWidth: 92,
  },
  attachLabel: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#065f46',
  },

  callScreen: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  callModeBadge: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 24,
  },
  callAvatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: '#10b981',
    marginBottom: 18,
  },
  callName: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  callTimer: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 6,
    fontWeight: '600',
  },
  incomingActionsRow: {
    flexDirection: 'row',
    gap: 32,
    marginTop: 42,
  },
  rejectCallBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptCallBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callControlsRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 38,
  },
  callControlBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callControlActive: {
    backgroundColor: '#059669',
  },
  callControlText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  endCallBtn: {
    marginTop: 46,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
});