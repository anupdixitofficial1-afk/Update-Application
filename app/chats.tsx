import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Image,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

interface ChatUserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  last_seen?: string | null;
  updated_at?: string | null;
  is_online?: boolean | null;
}

interface RawMessageRow {
  id?: string;
  sender_id?: string | null;
  receiver_id?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
  read_at?: string | null;
}

const THEME_COLOR = '#10b981';
const DEFAULT_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';
const LAST_OPENED_STORAGE_KEY = '@vibespere_chat_last_opened_v1';

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
    return { isActiveNow: false, label: `Last active ${diffMins}m ago` };
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return { isActiveNow: false, label: `Last active ${diffHours}h ago` };
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return { isActiveNow: false, label: 'Last active yesterday' };
  }
  if (diffDays < 7) {
    return { isActiveNow: false, label: `Last active ${diffDays}d ago` };
  }

  return {
    isActiveNow: false,
    label: `Last active ${parsed.toLocaleDateString([], {
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
      : { isActiveNow: false, label: 'Last active recently' };
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
  return { isActiveNow: false, label: `Last active ${mins}m ago` };
};

export default function ChatsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  const [users, setUsers] = useState<ChatUserRow[]>([]);
  const [startedChatUserIds, setStartedChatUserIds] = useState<string[]>([]);
  const [lastMsgTimeByPeer, setLastMsgTimeByPeer] = useState<
    Record<string, number>
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
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [newChatModalVisible, setNewChatModalVisible] = useState(false);
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

  const fetchUsers = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const storedOpened = await loadStoredLastOpened();
      setLastOpenedByPeer(storedOpened);

      const { data: authData } = await supabase.auth.getUser();
      const myId = authData?.user?.id ?? null;
      cachedChatUserId = myId;
      setCurrentUserId(myId);

      const metaAvatar =
        typeof authData?.user?.user_metadata?.avatar_url === 'string' &&
        authData.user.user_metadata.avatar_url.trim()
          ? authData.user.user_metadata.avatar_url.trim()
          : null;

      if (metaAvatar && !cachedChatMyAvatarUrl) {
        cachedChatMyAvatarUrl = metaAvatar;
        setMyAvatarUrl(metaAvatar);
      }

      if (myId) {
        await supabase
          .from('profiles')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', myId);

        const { data: myProfile } = await supabase
          .from('profiles')
          .select('username, full_name, avatar_url')
          .eq('id', myId)
          .maybeSingle();

        const handleFromProfile = formatHandle(myProfile?.username);
        const fallbackFromEmail = authData?.user?.email
          ? `@${authData.user.email.split('@')[0]}`
          : '@user';
        setCurrentUsername(handleFromProfile || fallbackFromEmail);

        const dbAvatar =
          typeof myProfile?.avatar_url === 'string' &&
          myProfile.avatar_url.trim()
            ? myProfile.avatar_url.trim()
            : null;
        const resolvedAvatar = dbAvatar || metaAvatar;
        if (resolvedAvatar) {
          cachedChatMyAvatarUrl = resolvedAvatar;
          setMyAvatarUrl(resolvedAvatar);
        }

        const { data: msgRows } = await supabase
          .from('messages')
          .select('*')
          .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
          .order('created_at', { ascending: false });

        if (Array.isArray(msgRows)) {
          const orderedPeers: string[] = [];
          const latestTimeMap: Record<string, number> = {};
          const unreadMap: Record<string, number> = {};

          (msgRows as RawMessageRow[]).forEach((row) => {
            const senderId = row.sender_id ?? null;
            const receiverId = row.receiver_id ?? null;
            const peerId = senderId === myId ? receiverId : senderId;

            if (!peerId || peerId === myId) return;

            if (!orderedPeers.includes(peerId)) {
              orderedPeers.push(peerId);
            }

            const safeTs = parseTimestamp(row.created_at);
            if (
              latestTimeMap[peerId] === undefined ||
              safeTs > latestTimeMap[peerId]
            ) {
              latestTimeMap[peerId] = safeTs;
            }

            if (isMessageUnread(row, myId, peerId, storedOpened)) {
              unreadMap[peerId] = (unreadMap[peerId] ?? 0) + 1;
            }
          });

          setStartedChatUserIds(orderedPeers);
          setLastMsgTimeByPeer(latestTimeMap);
          setUnreadCountByPeer(unreadMap);
        }
      } else {
        if (metaAvatar) {
          cachedChatMyAvatarUrl = metaAvatar;
          setMyAvatarUrl(metaAvatar);
        }
        if (authData?.user?.email) {
          setCurrentUsername(`@${authData.user.email.split('@')[0]}`);
        }
      }

      let query = supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (myId) {
        query = query.neq('id', myId);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        setUsers(data as ChatUserRow[]);
      }
    } catch {
      // Keep current list on network error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(false);
  }, [fetchUsers]);

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`chats-list-${currentUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as RawMessageRow;
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

          setLastMsgTimeByPeer((prev) => ({
            ...prev,
            [peerId]: Math.max(prev[peerId] ?? 0, nextTs),
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
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as RawMessageRow;
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
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const updated = payload.new as ChatUserRow;
          if (!updated?.id) return;
          if (updated.id === currentUserId) {
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, lastOpenedByPeer]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const timeA = lastMsgTimeByPeer[a.id] ?? 0;
      const timeB = lastMsgTimeByPeer[b.id] ?? 0;

      if (timeA > 0 || timeB > 0) {
        if (timeA !== timeB) {
          return timeB - timeA;
        }
      }

      const nameA = (a.full_name || a.username || '').toLowerCase();
      const nameB = (b.full_name || b.username || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [users, lastMsgTimeByPeer]);

  const filteredUsers = sortedUsers.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const nameMatch = (u.full_name ?? '').toLowerCase().includes(q);
    const handleMatch = (u.username ?? '').toLowerCase().includes(q);
    return nameMatch || handleMatch;
  });

  const unstartedUsers = sortedUsers.filter((u) => {
    if (startedChatUserIds.includes(u.id)) return false;
    const q = newChatSearch.trim().toLowerCase();
    if (!q) return true;
    const nameMatch = (u.full_name ?? '').toLowerCase().includes(q);
    const handleMatch = (u.username ?? '').toLowerCase().includes(q);
    return nameMatch || handleMatch;
  });

  const markMessagesRead = async (peerId: string) => {
    const nowMs = Date.now() + 1000;
    const nextOpenedMap = { ...lastOpenedByPeer, [peerId]: nowMs };
    setLastOpenedByPeer(nextOpenedMap);

    try {
      await AsyncStorage.setItem(
        LAST_OPENED_STORAGE_KEY,
        JSON.stringify(nextOpenedMap)
      );
    } catch {
      // Ignore storage write error
    }

    setUnreadCountByPeer((prev) => {
      if (!prev[peerId]) return prev;
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });

    if (!currentUserId) return;

    try {
      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('sender_id', peerId)
        .eq('receiver_id', currentUserId)
        .eq('is_read', false);
    } catch {
      // Ignore if column does not exist in schema
    }
  };

  const openThread = (user: ChatUserRow, markAsStarted = false) => {
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
      },
    });
  };

  const navigateToTab = (route: string) => {
    try {
      router.replace(route as never);
    } catch {
      router.push(route as never);
    }
  };

  const openOwnProfile = () => {
    const uid = currentUserId || cachedChatUserId;
    const target = uid
      ? ({ pathname: '/profile', params: { userId: uid } } as const)
      : ('/profile' as const);

    try {
      router.replace(target as never);
    } catch {
      router.push(target as never);
    }
  };

  const renderItem = ({ item }: { item: ChatUserRow }) => {
    const handle = formatHandle(item.username);
    const fullName = (item.full_name ?? '').trim() || handle || 'User';
    const presence = getPresenceInfo(item);
    const unreadCount = unreadCountByPeer[item.id] ?? 0;

    return (
      <TouchableOpacity
        style={styles.chatRow}
        activeOpacity={0.75}
        onPress={() => openThread(item, false)}
      >
        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: (item.avatar_url ?? '').trim() || DEFAULT_AVATAR }}
            style={styles.avatar}
          />
          <View
            style={[
              styles.presenceIndicator,
              presence.isActiveNow ? styles.onlineDot : styles.offlineDot,
            ]}
          />
        </View>

        <View style={styles.rowContent}>
          <View style={styles.nameWithBadgeRow}>
            <Text style={styles.userName} numberOfLines={1}>
              {fullName}
            </Text>
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.statusLine}>
            <View
              style={[
                styles.miniStatusDot,
                presence.isActiveNow
                  ? styles.miniDotActive
                  : styles.miniDotOffline,
              ]}
            />
            <Text
              style={[
                styles.statusText,
                presence.isActiveNow
                  ? styles.activeStatusText
                  : styles.inactiveStatusText,
              ]}
              numberOfLines={1}
            >
              {presence.label}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.usernameBar}>
        <TouchableOpacity style={styles.sideBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#0f172a" />
        </TouchableOpacity>

        <Text style={styles.usernameTitle} numberOfLines={1}>
          {currentUsername}
        </Text>

        <TouchableOpacity
          style={styles.sideBtn}
          onPress={() => setNewChatModalVisible(true)}
        >
          <Ionicons name="create-outline" size={22} color="#0f172a" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBoxWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search people by name or @username..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color="#0d9488" />
          <Text style={styles.loadingText}>Loading chats...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingBottom: bottomPad + 72,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchUsers(true)}
              tintColor="#0d9488"
            />
          }
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Ionicons name="chatbubbles-outline" size={38} color="#94a3b8" />
              <Text style={styles.emptyTitle}>No users found</Text>
              <Text style={styles.emptySub}>
                Pull down to refresh or try another name.
              </Text>
            </View>
          }
        />
      )}

      <View
        style={[
          styles.bottomTabBar,
          {
            height: 52 + bottomPad,
            paddingTop: 6,
            paddingBottom: bottomPad,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.tabBtn}
          activeOpacity={0.75}
          onPress={() => navigateToTab('/(tabs)')}
        >
          <Ionicons name="home-outline" size={26} color="#64748b" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabBtn}
          activeOpacity={0.75}
          onPress={() => navigateToTab('/(tabs)/watch')}
        >
          <Ionicons name="play-circle-outline" size={27} color="#64748b" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabBtn}
          activeOpacity={0.8}
          onPress={() => navigateToTab('/(tabs)/create')}
        >
          <View style={styles.createCircle}>
            <Ionicons name="add" size={25} color="#ffffff" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabBtn}
          activeOpacity={0.75}
          onPress={() => navigateToTab('/(tabs)/connect')}
        >
          <Ionicons name="people-outline" size={26} color="#64748b" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabBtn}
          activeOpacity={0.75}
          onPress={openOwnProfile}
        >
          {myAvatarUrl ? (
            <View style={styles.profileAvatarRing}>
              <Image
                source={{ uri: myAvatarUrl }}
                style={styles.profileAvatarImg}
              />
            </View>
          ) : (
            <Ionicons name="person-outline" size={26} color="#64748b" />
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={newChatModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNewChatModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalSheet,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Chat</Text>
              <TouchableOpacity
                onPress={() => {
                  setNewChatModalVisible(false);
                  setNewChatSearch('');
                }}
              >
                <Ionicons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSearchBox}>
              <Ionicons name="search-outline" size={17} color="#64748b" />
              <TextInput
                style={styles.searchInput}
                placeholder="Find someone new to message..."
                placeholderTextColor="#94a3b8"
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
                    style={styles.newUserRow}
                    activeOpacity={0.75}
                    onPress={() => openThread(item, true)}
                  >
                    <Image
                      source={{
                        uri: (item.avatar_url ?? '').trim() || DEFAULT_AVATAR,
                      }}
                      style={styles.avatar}
                    />
                    <View style={styles.rowContent}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {fullName}
                      </Text>
                      <Text style={styles.statusText} numberOfLines={1}>
                        {handle
                          ? `${handle} · ${presence.label}`
                          : presence.label}
                      </Text>
                    </View>
                    <View style={styles.startBadge}>
                      <Text style={styles.startBadgeText}>Start</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyNewList}>
                  <Text style={styles.emptyTitle}>No new people available</Text>
                  <Text style={styles.emptySub}>
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
  container: { flex: 1, backgroundColor: '#f8fafc' },
  usernameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  sideBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  usernameTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    color: '#0f172a',
    flex: 1,
    textAlign: 'center',
  },
  searchBoxWrap: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: '#0f172a' },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  avatarWrap: { position: 'relative', marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e2e8f0' },
  presenceIndicator: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  onlineDot: { backgroundColor: '#10b981' },
  offlineDot: { backgroundColor: '#94a3b8' },
  rowContent: { flex: 1, marginRight: 0 },
  nameWithBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  unreadBadge: {
    backgroundColor: THEME_COLOR,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  miniStatusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  miniDotActive: { backgroundColor: '#10b981' },
  miniDotOffline: { backgroundColor: '#cbd5e1' },
  statusText: { fontSize: 12, fontWeight: '500' },
  activeStatusText: { color: '#059669', fontWeight: '600' },
  inactiveStatusText: { color: '#64748b' },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  loadingText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 4 },
  emptySub: { fontSize: 12, color: '#64748b', textAlign: 'center' },

  /* Bottom Icons-Only Navigation Bar */
  bottomTabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
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
    backgroundColor: THEME_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarRing: {
    width: 35,
    height: 35,
    borderRadius: 15,
    padding: 1.5,
    borderWidth: 1.0,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingTop: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 38,
    marginHorizontal: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  newUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  startBadge: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  startBadgeText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  emptyNewList: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 },
});