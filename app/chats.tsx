import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ScrollView,
  Image,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  DeviceEventEmitter,
  StatusBar,
  Platform,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { backend, ChatMessageRecord, ChatUserProfile } from '../lib/backend';
import AppBottomNav from '../components/AppBottomNav';
import { ChatListSkeleton } from '../components/SkeletonLoader';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
const LAST_OPENED_STORAGE_KEY = '@vibespere_chat_last_opened_v1';
const CHAT_PREFS_STORAGE_KEY = '@vibespere_chat_inbox_prefs_v1';

type ThemeMode = 'light' | 'dark' | 'system';
type InboxFilter = 'all' | 'unread' | 'pinned' | 'locked';

let LocalAuthMod: any = null;
try {
  LocalAuthMod = require('expo-local-authentication');
} catch {
  LocalAuthMod = null;
}

type ChatUserRow = ChatUserProfile;
type RawMessageRow = ChatMessageRecord;

interface LastMessageMeta {
  text: string;
  timeMs: number;
  isFromMe: boolean;
}

interface InboxPrefs {
  pinnedIds: string[];
  mutedIds: string[];
  lockedIds: string[];
  archivedIds: string[];
}

const DEFAULT_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';

let cachedChatMyAvatarUrl: string | null = null;
let cachedChatUserId: string | null = null;

const formatHandle = (raw?: string | null) => {
  const clean = (raw ?? '').trim();
  if (!clean) return '';
  return clean.startsWith('@') ? clean : `@${clean}`;
};

const parseTimestamp = (iso?: string | null) => {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const extractMessagePreview = (row: RawMessageRow): string => {
  const candidates = [row.content, row.body, row.message, row.text, row.msg];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().length > 0) {
      const trimmed = val.trim();
      if (trimmed === '📸 Screenshot taken of this chat') {
        return '📸 Screenshot alert';
      }
      if (trimmed === '👁️ View-Once Opened') {
        return '👁️ Opened';
      }
      if (trimmed.startsWith('👁️ View-Once Photo::')) {
        return '👁️ View-Once Photo';
      }
      if (trimmed.startsWith('👁️ View-Once Voice')) {
        const sepIdx = trimmed.indexOf('::');
        const label = sepIdx > 0 ? trimmed.slice(0, sepIdx).trim() : trimmed;
        return label.replace('👁️ ', '👁️ ') || '👁️ View-Once Voice';
      }
      if (trimmed.startsWith('📷 Photo::')) {
        return '📷 Photo';
      }
      if (trimmed.startsWith('🎥 Video::')) {
        return '🎥 Video';
      }
      if (trimmed.startsWith('🎤 Voice Note')) {
        const sepIdx = trimmed.indexOf('::');
        return sepIdx > 0 ? trimmed.slice(0, sepIdx).trim() : '🎤 Voice Note';
      }
      if (trimmed.startsWith('📍 Location::')) {
        const parts = trimmed.slice('📍 Location::'.length).split('::');
        const place = parts.slice(1).join('::').trim();
        return place ? `📍 ${place}` : '📍 Shared Location';
      }
      if (trimmed.includes('::http://') || trimmed.includes('::https://')) {
        return trimmed.split('::http')[0].trim() || 'Attachment';
      }
      return trimmed;
    }
  }
  return '';
};

const formatCompactMsgTime = (ms: number): string => {
  if (!ms || ms <= 0) return '';
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - ms;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays <= 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
};

const isMessageUnread = (
  row: RawMessageRow,
  myId: string,
  peerId: string,
  lastOpenedMap: Record<string, number>
) => {
  if (row.sender_id !== peerId || row.receiver_id !== myId) return false;

  if (typeof row.is_read === 'boolean') {
    return row.is_read === false;
  }
  if ('read_at' in row) {
    return row.read_at == null;
  }

  const msgTime = parseTimestamp(row.created_at);
  const openedTime = lastOpenedMap[peerId] ?? 0;
  return msgTime > openedTime;
};

const formatLastActive = (isoDate?: string | null) => {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;

  const diffMs = Date.now() - parsed.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 2) {
    return { isActiveNow: true, label: 'Active now' };
  }
  if (diffMins < 60) {
    return { isActiveNow: false, label: `Active ${diffMins}m ago` };
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return { isActiveNow: false, label: `Active ${diffHours}h ago` };
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return { isActiveNow: false, label: 'Active yesterday' };
  }
  if (diffDays < 7) {
    return { isActiveNow: false, label: `Active ${diffDays}d ago` };
  }

  return {
    isActiveNow: false,
    label: `Active ${parsed.toLocaleDateString([], {
      day: '2-digit',
      month: 'short',
    })}`,
  };
};

const getPresenceInfo = (user: ChatUserRow) => {
  if (typeof user.is_online === 'boolean') {
    if (user.is_online) {
      return { isActiveNow: true, label: 'Active now' };
    }
    const timestamp = user.last_seen || user.updated_at;
    const formatted = formatLastActive(timestamp);
    return formatted && !formatted.isActiveNow
      ? formatted
      : { isActiveNow: false, label: 'Active recently' };
  }

  const timestamp = user.last_seen || user.updated_at;
  const formatted = formatLastActive(timestamp);
  if (formatted) return formatted;

  let hash = 0;
  for (let i = 0; i < user.id.length; i += 1) {
    hash = (hash * 31 + user.id.charCodeAt(i)) % 1000;
  }

  if (hash % 3 === 0) {
    return { isActiveNow: true, label: 'Active now' };
  }
  const mins = (hash % 45) + 5;
  return { isActiveNow: false, label: `Active ${mins}m ago` };
};

export default function ChatsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const bottomPad =
    Platform.OS === 'android'
      ? Math.max(insets.bottom, 24)
      : Math.max(insets.bottom, 10);

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
      emeraldSoft: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
      danger: '#ef4444',
      dangerSoft: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fef2f2',
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

  const [users, setUsers] = useState<ChatUserRow[]>([]);
  const [startedChatUserIds, setStartedChatUserIds] = useState<string[]>([]);
  const [lastMsgByPeer, setLastMsgByPeer] = useState<
    Record<string, LastMessageMeta>
  >({});
  const [lastOpenedByPeer, setLastOpenedByPeer] = useState<
    Record<string, number>
  >({});
  const [unreadCountByPeer, setUnreadCountByPeer] = useState<
    Record<string, number>
  >({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    cachedChatUserId
  );
  const [currentUsername, setCurrentUsername] = useState('@user');
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(
    cachedChatMyAvatarUrl
  );

  const [activeFilter, setActiveFilter] = useState<InboxFilter>('all');
  const [lockedUnlocked, setLockedUnlocked] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [newChatModalVisible, setNewChatModalVisible] = useState(false);
  const [selectedUserForMenu, setSelectedUserForMenu] =
    useState<ChatUserRow | null>(null);

  const [prefs, setPrefs] = useState<InboxPrefs>({
    pinnedIds: [],
    mutedIds: [],
    lockedIds: [],
    archivedIds: [],
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStoredLastOpened = async () => {
    try {
      const raw = await AsyncStorage.getItem(LAST_OPENED_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, number>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const loadInboxPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(CHAT_PREFS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<InboxPrefs>;
      setPrefs({
        pinnedIds: Array.isArray(parsed.pinnedIds) ? parsed.pinnedIds : [],
        mutedIds: Array.isArray(parsed.mutedIds) ? parsed.mutedIds : [],
        lockedIds: Array.isArray(parsed.lockedIds) ? parsed.lockedIds : [],
        archivedIds: Array.isArray(parsed.archivedIds)
          ? parsed.archivedIds
          : [],
      });
    } catch {
      // Ignore storage read error
    }
  }, []);

  const updateInboxPrefs = useCallback(
    (updater: (prev: InboxPrefs) => InboxPrefs) => {
      setPrefs((prev) => {
        const next = updater(prev);
        AsyncStorage.setItem(
          CHAT_PREFS_STORAGE_KEY,
          JSON.stringify(next)
        ).catch(() => {});
        return next;
      });
    },
    []
  );

  useEffect(() => {
    void loadInboxPrefs();
  }, [loadInboxPrefs]);

  const fetchUsers = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const storedOpened = await loadStoredLastOpened();
      setLastOpenedByPeer(storedOpened);

      const currentUser = await backend.auth.getCurrentUser().catch(() => null);
      const myId = currentUser?.id ?? null;
      cachedChatUserId = myId;
      setCurrentUserId(myId);

      if (currentUser?.avatarUrl && !cachedChatMyAvatarUrl) {
        cachedChatMyAvatarUrl = currentUser.avatarUrl;
        setMyAvatarUrl(currentUser.avatarUrl);
      }

      if (myId) {
        void backend.chats.touchLastSeen(myId).catch(() => {});

        const handleFromProfile = formatHandle(currentUser?.username);
        const fallbackFromEmail = currentUser?.email
          ? `@${currentUser.email.split('@')[0]}`
          : '@user';
        setCurrentUsername(handleFromProfile || fallbackFromEmail);

        if (currentUser?.avatarUrl) {
          cachedChatMyAvatarUrl = currentUser.avatarUrl;
          setMyAvatarUrl(currentUser.avatarUrl);
        }

        const msgRows = await backend.chats.getConversationMessages(myId);
        if (Array.isArray(msgRows)) {
          const orderedPeers: string[] = [];
          const latestMap: Record<string, LastMessageMeta> = {};
          const unreadMap: Record<string, number> = {};

          msgRows.forEach((row) => {
            const senderId = row.sender_id ?? null;
            const receiverId = row.receiver_id ?? null;
            const peerId = senderId === myId ? receiverId : senderId;

            if (!peerId || peerId === myId) return;

            if (!orderedPeers.includes(peerId)) {
              orderedPeers.push(peerId);
            }

            const safeTs = parseTimestamp(row.created_at);
            if (!latestMap[peerId] || safeTs > latestMap[peerId].timeMs) {
              latestMap[peerId] = {
                text: extractMessagePreview(row),
                timeMs: safeTs,
                isFromMe: senderId === myId,
              };
            }

            if (isMessageUnread(row, myId, peerId, storedOpened)) {
              unreadMap[peerId] = (unreadMap[peerId] ?? 0) + 1;
            }
          });

          setStartedChatUserIds(orderedPeers);
          setLastMsgByPeer(latestMap);
          setUnreadCountByPeer(unreadMap);
        }
      } else if (currentUser?.email) {
        setCurrentUsername(`@${currentUser.email.split('@')[0]}`);
      }

      const peerProfiles = await backend.chats.getPeerProfiles(myId);
      setUsers(peerProfiles);
    } catch {
      // Keep current list on network error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers(false);
  }, [fetchUsers]);

  useFocusEffect(
    useCallback(() => {
      void fetchUsers(true);
    }, [fetchUsers])
  );

  // Realtime chat inbox updates via backend adapter
  useEffect(() => {
    if (!currentUserId) return;

    const unsubscribe = backend.chats.subscribeInboxEvents(currentUserId, {
      onMessageInsert: (row) => {
        const senderId = row.sender_id ?? null;
        const receiverId = row.receiver_id ?? null;

        if (senderId !== currentUserId && receiverId !== currentUserId) {
          return;
        }

        const peerId = senderId === currentUserId ? receiverId : senderId;
        if (!peerId || peerId === currentUserId) return;

        const parsedTs = parseTimestamp(row.created_at);
        const nextTs = parsedTs > 0 ? parsedTs : Date.now();

        setStartedChatUserIds((prev) => [
          peerId,
          ...prev.filter((id) => id !== peerId),
        ]);

        setLastMsgByPeer((prev) => ({
          ...prev,
          [peerId]: {
            text: extractMessagePreview(row),
            timeMs: Math.max(prev[peerId]?.timeMs ?? 0, nextTs),
            isFromMe: senderId === currentUserId,
          },
        }));

        const normalizedRow: RawMessageRow = {
          ...row,
          created_at: row.created_at || new Date(nextTs).toISOString(),
        };

        if (
          isMessageUnread(
            normalizedRow,
            currentUserId,
            peerId,
            lastOpenedByPeer
          )
        ) {
          setUnreadCountByPeer((prev) => ({
            ...prev,
            [peerId]: (prev[peerId] ?? 0) + 1,
          }));
        }
      },
      onMessageUpdate: (row) => {
        const senderId = row.sender_id ?? null;
        const receiverId = row.receiver_id ?? null;

        if (
          receiverId === currentUserId &&
          senderId &&
          senderId !== currentUserId
        ) {
          const stillUnread = isMessageUnread(
            row,
            currentUserId,
            senderId,
            lastOpenedByPeer
          );
          if (!stillUnread) {
            setUnreadCountByPeer((prev) => {
              const current = prev[senderId] ?? 0;
              if (current <= 0) return prev;
              return { ...prev, [senderId]: Math.max(0, current - 1) };
            });
          }
        }
      },
      onProfileUpdate: (updated) => {
        if (!updated?.id) return;
        if (updated.id === currentUserId) {
          const nextHandle = formatHandle(updated.username);
          if (nextHandle) setCurrentUsername(nextHandle);
          if (
            typeof updated.avatar_url === 'string' &&
            updated.avatar_url.trim()
          ) {
            const nextAvatar = updated.avatar_url.trim();
            cachedChatMyAvatarUrl = nextAvatar;
            setMyAvatarUrl(nextAvatar);
          }
          return;
        }
        setUsers((prev) =>
          prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u))
        );
      },
    });

    return () => {
      unsubscribe();
    };
  }, [currentUserId, lastOpenedByPeer]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const pinA = prefs.pinnedIds.includes(a.id) ? 1 : 0;
      const pinB = prefs.pinnedIds.includes(b.id) ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;

      const timeA = lastMsgByPeer[a.id]?.timeMs ?? 0;
      const timeB = lastMsgByPeer[b.id]?.timeMs ?? 0;
      if (timeA !== timeB) return timeB - timeA;

      const nameA = (a.full_name || a.username || '').toLowerCase();
      const nameB = (b.full_name || b.username || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [users, lastMsgByPeer, prefs.pinnedIds]);

  const activeNowUsers = useMemo(
    () =>
      sortedUsers.filter(
        (u) =>
          !prefs.archivedIds.includes(u.id) &&
          !prefs.lockedIds.includes(u.id) &&
          getPresenceInfo(u).isActiveNow
      ),
    [sortedUsers, prefs.archivedIds, prefs.lockedIds]
  );

  const totalUnreadChats = useMemo(
    () =>
      Object.entries(unreadCountByPeer).filter(
        ([id, count]) =>
          count > 0 &&
          !prefs.archivedIds.includes(id) &&
          !prefs.lockedIds.includes(id)
      ).length,
    [unreadCountByPeer, prefs.archivedIds, prefs.lockedIds]
  );

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedUsers.filter((u) => {
      if (prefs.archivedIds.includes(u.id)) return false;

      const isLocked = prefs.lockedIds.includes(u.id);
      if (activeFilter === 'locked') {
        if (!isLocked) return false;
      } else {
        if (isLocked) return false;
      }

      if (activeFilter === 'unread' && (unreadCountByPeer[u.id] ?? 0) <= 0) {
        return false;
      }
      if (activeFilter === 'pinned' && !prefs.pinnedIds.includes(u.id)) {
        return false;
      }

      if (!q) return true;
      const nameMatch = (u.full_name ?? '').toLowerCase().includes(q);
      const handleMatch = (u.username ?? '').toLowerCase().includes(q);
      return nameMatch || handleMatch;
    });
  }, [
    sortedUsers,
    searchQuery,
    activeFilter,
    prefs.archivedIds,
    prefs.lockedIds,
    prefs.pinnedIds,
    unreadCountByPeer,
  ]);

  const unstartedUsers = useMemo(() => {
    const q = newChatSearch.trim().toLowerCase();
    return sortedUsers.filter((u) => {
      if (startedChatUserIds.includes(u.id)) return false;
      if (!q) return true;
      const nameMatch = (u.full_name ?? '').toLowerCase().includes(q);
      const handleMatch = (u.username ?? '').toLowerCase().includes(q);
      return nameMatch || handleMatch;
    });
  }, [sortedUsers, startedChatUserIds, newChatSearch]);

  const handleSelectFilter = async (next: InboxFilter) => {
    if (next === 'locked' && !lockedUnlocked) {
      if (LocalAuthMod?.authenticateAsync) {
        try {
          const res = await LocalAuthMod.authenticateAsync({
            promptMessage: 'Unlock Locked Chats',
          });
          if (!res?.success) return;
        } catch {}
      }
      setLockedUnlocked(true);
    }
    setActiveFilter(next);
  };

  const markMessagesRead = async (peerId: string) => {
    const nowMs = Date.now() + 1000;
    const nextOpenedMap = { ...lastOpenedByPeer, [peerId]: nowMs };
    setLastOpenedByPeer(nextOpenedMap);

    try {
      await AsyncStorage.setItem(
        LAST_OPENED_STORAGE_KEY,
        JSON.stringify(nextOpenedMap)
      );
    } catch {}

    setUnreadCountByPeer((prev) => {
      if (!prev[peerId]) return prev;
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });

    if (!currentUserId) return;
    try {
      await backend.chats.markThreadRead(currentUserId, peerId);
    } catch {}
  };

  const openThread = (
    user: ChatUserRow,
    markAsStarted = false,
    autoCallType?: 'voice' | 'video'
  ) => {
    if (markAsStarted) {
      setStartedChatUserIds((prev) =>
        prev.includes(user.id) ? prev : [...prev, user.id]
      );
      setNewChatModalVisible(false);
      setNewChatSearch('');
    }

    void markMessagesRead(user.id);

    const formattedHandle = formatHandle(user.username);
    const displayName =
      (user.full_name ?? '').trim() || formattedHandle || 'User';

    router.push({
      pathname: '/messages',
      params: {
        userId: user.id,
        name: displayName,
        username: formattedHandle,
        avatarUrl: (user.avatar_url ?? '').trim() || DEFAULT_AVATAR,
        ...(autoCallType ? { incomingCallType: autoCallType } : {}),
      },
    });
  };

  const handleTogglePin = (peerId: string) => {
    updateInboxPrefs((prev) => ({
      ...prev,
      pinnedIds: prev.pinnedIds.includes(peerId)
        ? prev.pinnedIds.filter((id) => id !== peerId)
        : [peerId, ...prev.pinnedIds],
    }));
    setSelectedUserForMenu(null);
  };

  const handleToggleMute = (peerId: string) => {
    updateInboxPrefs((prev) => ({
      ...prev,
      mutedIds: prev.mutedIds.includes(peerId)
        ? prev.mutedIds.filter((id) => id !== peerId)
        : [...prev.mutedIds, peerId],
    }));
    setSelectedUserForMenu(null);
  };

  const handleToggleLock = (peerId: string) => {
    updateInboxPrefs((prev) => ({
      ...prev,
      lockedIds: prev.lockedIds.includes(peerId)
        ? prev.lockedIds.filter((id) => id !== peerId)
        : [...prev.lockedIds, peerId],
    }));
    setSelectedUserForMenu(null);
  };

  const handleToggleMarkUnread = (peerId: string) => {
    setUnreadCountByPeer((prev) => ({
      ...prev,
      [peerId]: (prev[peerId] ?? 0) > 0 ? 0 : 1,
    }));
    setSelectedUserForMenu(null);
  };

  const handleArchiveChat = (peerId: string) => {
    updateInboxPrefs((prev) => ({
      ...prev,
      archivedIds: prev.archivedIds.includes(peerId)
        ? prev.archivedIds
        : [...prev.archivedIds, peerId],
    }));
    setSelectedUserForMenu(null);
  };

  const handleDeleteChat = (user: ChatUserRow) => {
    setSelectedUserForMenu(null);
    const name =
      (user.full_name ?? '').trim() || formatHandle(user.username) || 'User';
    Alert.alert('Delete Chat', `Delete all messages with ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setLastMsgByPeer((prev) => {
            const copy = { ...prev };
            delete copy[user.id];
            return copy;
          });
          setUnreadCountByPeer((prev) => {
            const copy = { ...prev };
            delete copy[user.id];
            return copy;
          });
          if (currentUserId) {
            try {
              await backend.chats.deleteConversation(currentUserId, user.id);
            } catch {}
          }
        },
      },
    ]);
  };

  const navigateToTab = (route: string) => {
    try {
      router.navigate(route as never);
    } catch {
      router.replace(route as never);
    }
  };

  const openOwnProfile = () => {
    DeviceEventEmitter.emit('profile-tab-pressed');
    const uid = currentUserId || cachedChatUserId;
    const target = uid
      ? ({ pathname: '/(tabs)/profile', params: { userId: uid } } as const)
      : ('/(tabs)/profile' as const);

    try {
      router.navigate(target as never);
    } catch {
      router.replace(target as never);
    }
  };

  const renderItem = ({ item }: { item: ChatUserRow }) => {
    const handle = formatHandle(item.username);
    const fullName = (item.full_name ?? '').trim() || handle || 'User';
    const presence = getPresenceInfo(item);
    const unreadCount = unreadCountByPeer[item.id] ?? 0;
    const lastMeta = lastMsgByPeer[item.id];
    const isPinned = prefs.pinnedIds.includes(item.id);
    const isMuted = prefs.mutedIds.includes(item.id);

    const previewLine = lastMeta?.text
      ? lastMeta.isFromMe
        ? `You: ${lastMeta.text}`
        : lastMeta.text
      : presence.label;

    const timeLabel = lastMeta?.timeMs
      ? formatCompactMsgTime(lastMeta.timeMs)
      : '';

    return (
      <TouchableOpacity
        style={[
          styles.chatRow,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
        activeOpacity={0.78}
        onPress={() => openThread(item, false)}
        onLongPress={() => setSelectedUserForMenu(item)}
      >
        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: (item.avatar_url ?? '').trim() || DEFAULT_AVATAR }}
            style={[styles.avatar, { backgroundColor: colors.surface }]}
          />
          {presence.isActiveNow && (
            <View style={[styles.onlineDot, { borderColor: colors.bg }]} />
          )}
        </View>

        <View style={styles.rowContent}>
          <View style={styles.rowTopLine}>
            <View style={styles.nameRowLeft}>
              <Text
                style={[
                  styles.userName,
                  { color: colors.text },
                  unreadCount > 0 && { fontWeight: '800' },
                ]}
                numberOfLines={1}
              >
                {fullName}
              </Text>
              {isPinned && (
                <Ionicons
                  name="pin"
                  size={12}
                  color={colors.subtext}
                  style={{ marginLeft: 4 }}
                />
              )}
              {isMuted && (
                <Ionicons
                  name="notifications-off-outline"
                  size={13}
                  color={colors.subtext}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>

            {timeLabel ? (
              <Text
                style={[
                  styles.timeText,
                  { color: unreadCount > 0 ? colors.emerald : colors.subtext },
                ]}
              >
                {timeLabel}
              </Text>
            ) : null}
          </View>

          <View style={styles.rowBottomLine}>
            <Text
              style={[
                styles.previewText,
                {
                  color:
                    unreadCount > 0
                      ? colors.text
                      : !lastMeta?.text && presence.isActiveNow
                        ? colors.emerald
                        : colors.subtext,
                  fontWeight: unreadCount > 0 ? '700' : '500',
                },
              ]}
              numberOfLines={1}
            >
              {previewLine}
            </Text>

            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* EDGE-TO-EDGE MINIMAL HEADER */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
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
              placeholder="Search name or @username..."
              placeholderTextColor={colors.subtext}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                setSearchOpen(false);
              }}
            >
              <Ionicons name="close" size={19} color={colors.text} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.headerLeft}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => router.back()}
              >
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text
                style={[styles.headerTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {currentUsername}
              </Text>
            </View>

            <View style={styles.headerRight}>
              <TouchableOpacity
                style={[
                  styles.headerCircleBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setSearchOpen(true)}
              >
                <Ionicons name="search-outline" size={18} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.headerCircleBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setNewChatModalVisible(true)}
              >
                <Ionicons name="create-outline" size={19} color={colors.text} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* FILTER PILLS */}
      <View
        style={[
          styles.filterBar,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          {(
            [
              { key: 'all', label: 'All' },
              {
                key: 'unread',
                label:
                  totalUnreadChats > 0 ? `Unread (${totalUnreadChats})` : 'Unread',
              },
              { key: 'pinned', label: 'Pinned' },
              {
                key: 'locked',
                label:
                  prefs.lockedIds.length > 0
                    ? `Locked (${prefs.lockedIds.length})`
                    : 'Locked',
              },
            ] as { key: InboxFilter; label: string }[]
          ).map((tab) => {
            const active = activeFilter === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: active ? colors.accent : colors.surface,
                  },
                ]}
                onPress={() => void handleSelectFilter(tab.key)}
                activeOpacity={0.8}
              >
                {tab.key === 'locked' && (
                  <Ionicons
                    name="lock-closed-outline"
                    size={12}
                    color={active ? colors.accentText : colors.subtext}
                  />
                )}
                <Text
                  style={[
                    styles.filterPillText,
                    { color: active ? colors.accentText : colors.subtext },
                    active && { fontWeight: '700' },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <ChatListSkeleton isDark={isDark} />
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: bottomPad + 86,
            flexGrow: 1,
          }}
          ListHeaderComponent={
            activeFilter === 'all' &&
            !searchQuery.trim() &&
            activeNowUsers.length > 0 ? (
              <View
                style={[
                  styles.activeTray,
                  {
                    backgroundColor: colors.bg,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.activeTrayContent}
                >
                  {activeNowUsers.map((u) => {
                    const first = (
                      (u.full_name ?? '').trim() ||
                      formatHandle(u.username) ||
                      'User'
                    )
                      .replace(/^@/, '')
                      .split(' ')[0];
                    return (
                      <TouchableOpacity
                        key={`active-${u.id}`}
                        style={styles.activeUserItem}
                        onPress={() => openThread(u, false)}
                        activeOpacity={0.8}
                      >
                        <View
                          style={[
                            styles.activeRing,
                            { borderColor: colors.emerald },
                          ]}
                        >
                          <Image
                            source={{
                              uri: (u.avatar_url ?? '').trim() || DEFAULT_AVATAR,
                            }}
                            style={styles.activeAvatar}
                          />
                        </View>
                        <Text
                          style={[styles.activeName, { color: colors.subtext }]}
                          numberOfLines={1}
                        >
                          {first}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : undefined
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void fetchUsers(true)}
              tintColor={colors.text}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Ionicons
                name={
                  activeFilter === 'locked'
                    ? 'lock-closed-outline'
                    : 'chatbubbles-outline'
                }
                size={36}
                color={colors.subtext}
              />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {activeFilter === 'locked'
                  ? 'No locked chats'
                  : activeFilter === 'unread'
                    ? 'All caught up'
                    : activeFilter === 'pinned'
                      ? 'No pinned chats'
                      : 'No conversations found'}
              </Text>
              <Text style={[styles.emptySub, { color: colors.subtext }]}>
                {activeFilter === 'all'
                  ? 'Tap the compose button to start a new chat.'
                  : 'Long-press any chat to pin, lock, or manage it.'}
              </Text>
            </View>
          }
        />
      )}

      {/* FLOATING DOCK NAVIGATION BAR (MATCHING ALL OTHER SCREENS) */}
      <AppBottomNav avatarUrl={myAvatarUrl} />

      {/* LONG-PRESS QUICK ACTIONS SHEET */}
      <Modal
        visible={Boolean(selectedUserForMenu)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedUserForMenu(null)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSelectedUserForMenu(null)}
          />
          {selectedUserForMenu && (
            <View
              style={[
                styles.actionSheet,
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
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {(selectedUserForMenu.full_name ?? '').trim() ||
                  formatHandle(selectedUserForMenu.username) ||
                  'User'}
              </Text>

              <TouchableOpacity
                style={[styles.sheetRow, { borderTopColor: colors.border }]}
                onPress={() => handleTogglePin(selectedUserForMenu.id)}
              >
                <Ionicons name="pin-outline" size={19} color={colors.text} />
                <Text style={[styles.sheetRowText, { color: colors.text }]}>
                  {prefs.pinnedIds.includes(selectedUserForMenu.id)
                    ? 'Unpin Chat'
                    : 'Pin to Top'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetRow, { borderTopColor: colors.border }]}
                onPress={() => handleToggleMute(selectedUserForMenu.id)}
              >
                <Ionicons
                  name="notifications-off-outline"
                  size={19}
                  color={colors.text}
                />
                <Text style={[styles.sheetRowText, { color: colors.text }]}>
                  {prefs.mutedIds.includes(selectedUserForMenu.id)
                    ? 'Unmute Notifications'
                    : 'Mute Notifications'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetRow, { borderTopColor: colors.border }]}
                onPress={() => handleToggleMarkUnread(selectedUserForMenu.id)}
              >
                <Ionicons
                  name="mail-unread-outline"
                  size={19}
                  color={colors.text}
                />
                <Text style={[styles.sheetRowText, { color: colors.text }]}>
                  {(unreadCountByPeer[selectedUserForMenu.id] ?? 0) > 0
                    ? 'Mark as Read'
                    : 'Mark as Unread'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetRow, { borderTopColor: colors.border }]}
                onPress={() => handleToggleLock(selectedUserForMenu.id)}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={19}
                  color={colors.emerald}
                />
                <Text style={[styles.sheetRowText, { color: colors.text }]}>
                  {prefs.lockedIds.includes(selectedUserForMenu.id)
                    ? 'Remove from Locked Chats'
                    : 'Move to Locked Chats'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetRow, { borderTopColor: colors.border }]}
                onPress={() => handleArchiveChat(selectedUserForMenu.id)}
              >
                <Ionicons
                  name="archive-outline"
                  size={19}
                  color={colors.text}
                />
                <Text style={[styles.sheetRowText, { color: colors.text }]}>
                  Archive Chat
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetRow, { borderTopColor: colors.border }]}
                onPress={() => handleDeleteChat(selectedUserForMenu)}
              >
                <Ionicons
                  name="trash-outline"
                  size={19}
                  color={colors.danger}
                />
                <Text style={[styles.sheetRowText, { color: colors.danger }]}>
                  Delete Chat
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* NEW CHAT MODAL */}
      <Modal
        visible={newChatModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNewChatModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => {
              setNewChatModalVisible(false);
              setNewChatSearch('');
            }}
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16),
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
                styles.modalHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                New Chat
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setNewChatModalVisible(false);
                  setNewChatSearch('');
                }}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.modalSearchBox,
                { backgroundColor: colors.surface },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={17}
                color={colors.subtext}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Find someone new to message..."
                placeholderTextColor={colors.subtext}
                value={newChatSearch}
                onChangeText={setNewChatSearch}
              />
            </View>

            <FlatList
              data={unstartedUsers}
              keyExtractor={(item) => `new-${item.id}`}
              renderItem={({ item }) => {
                const handle = formatHandle(item.username);
                const fullName =
                  (item.full_name ?? '').trim() || handle || 'User';
                const presence = getPresenceInfo(item);

                return (
                  <TouchableOpacity
                    style={[
                      styles.newUserRow,
                      { borderBottomColor: colors.border },
                    ]}
                    activeOpacity={0.75}
                    onPress={() => openThread(item, true)}
                  >
                    <Image
                      source={{
                        uri: (item.avatar_url ?? '').trim() || DEFAULT_AVATAR,
                      }}
                      style={[styles.avatar, { marginRight: 12 }]}
                    />
                    <View style={styles.rowContent}>
                      <Text
                        style={[styles.userName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {fullName}
                      </Text>
                      <Text
                        style={[styles.previewText, { color: colors.subtext }]}
                        numberOfLines={1}
                      >
                        {handle
                          ? `${handle} · ${presence.label}`
                          : presence.label}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.startBadge,
                        { backgroundColor: colors.surface },
                      ]}
                    >
                      <Text
                        style={[styles.startBadgeText, { color: colors.text }]}
                      >
                        Message
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyNewList}>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    No new people available
                  </Text>
                  <Text style={[styles.emptySub, { color: colors.subtext }]}>
                    You have already started chats with all available users.
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    height: 54,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  backBtn: { padding: 4, marginRight: 6 },
  headerTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerCircleBtn: {
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
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },

  /* Filter Bar */
  filterBar: { paddingVertical: 9, borderBottomWidth: 1 },
  filterContent: { paddingHorizontal: 14, gap: 8 },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 6.5,
    borderRadius: 999,
  },
  filterPillText: { fontSize: 12.5, fontWeight: '600' },

  /* Active Now Tray */
  activeTray: { paddingVertical: 12, borderBottomWidth: 1 },
  activeTrayContent: { paddingHorizontal: 14, gap: 14 },
  activeUserItem: { alignItems: 'center', width: 58 },
  activeRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeAvatar: { width: 46, height: 46, borderRadius: 23 },
  activeName: { fontSize: 11, fontWeight: '600', marginTop: 5 },

  /* Chat Rows */
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  avatarWrap: { position: 'relative', marginRight: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#10b981',
    borderWidth: 2,
  },
  rowContent: { flex: 1 },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  userName: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  timeText: { fontSize: 11.5, fontWeight: '600' },
  rowBottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
    gap: 8,
  },
  previewText: { fontSize: 13, flex: 1 },
  unreadBadge: {
    backgroundColor: '#10b981',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },

  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 6,
  },
  loadingText: { fontSize: 12.5, fontWeight: '600' },
  emptyTitle: { fontSize: 15.5, fontWeight: '700', marginTop: 4 },
  emptySub: { fontSize: 12.5, textAlign: 'center', lineHeight: 18 },

  /* Bottom Tab Bar */
  bottomTabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  createCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    padding: 1.5,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },

  /* Sheets */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  actionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sheetTitle: { fontSize: 16.5, fontWeight: '800', marginBottom: 10 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  sheetRowText: { fontSize: 14.5, fontWeight: '600' },

  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingTop: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 16.5, fontWeight: '800' },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    marginHorizontal: 14,
    marginVertical: 10,
    gap: 8,
  },
  newUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  startBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  startBadgeText: { fontSize: 12, fontWeight: '700' },
  emptyNewList: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 4,
  },
});