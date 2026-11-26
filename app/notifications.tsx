import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  DeviceEventEmitter,
  StatusBar,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { backend } from '../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';
type NotificationFilter = 'all' | 'unread' | 'follows' | 'activity';

interface NotificationItem {
  id: string;
  user_id: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_username?: string | null;
  actor_avatar?: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  target_id?: string | null;
}

const DEFAULT_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';

const formatRelativeTime = (iso?: string | null): string => {
  if (!iso) return 'Just now';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], { day: '2-digit', month: 'short' });
};

const getTypeMeta = (
  type: string
): {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
} => {
  const t = (type || '').toLowerCase();
  if (t.includes('follow')) return { icon: 'person-add', color: '#0095f6' };
  if (t.includes('like')) return { icon: 'heart', color: '#ef4444' };
  if (t.includes('comment')) return { icon: 'chatbubble', color: '#8b5cf6' };
  if (t.includes('wave')) return { icon: 'hand-left', color: '#f59e0b' };
  if (t.includes('screenshot')) return { icon: 'camera', color: '#f59e0b' };
  if (t.includes('call')) return { icon: 'call', color: '#ef4444' };
  if (t.includes('view')) return { icon: 'eye', color: '#10b981' };
  if (t.includes('live')) return { icon: 'radio', color: '#f43f5e' };
  return { icon: 'notifications', color: '#10b981' };
};

export default function NotificationsScreen() {
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
      unreadBg: isDark ? 'rgba(16, 185, 129, 0.08)' : '#f0fdf4',
      border: isDark ? '#27272a' : '#f1f5f9',
      borderStrong: isDark ? '#3f3f46' : '#e4e4e7',
      text: isDark ? '#fafafa' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#71717a',
      accent: isDark ? '#fafafa' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
      emerald: '#10b981',
      danger: '#ef4444',
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

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const user = await backend.auth.getCurrentUser().catch(() => null);
      if (!user?.id) {
        setCurrentUserId(null);
        setNotifications([]);
        return;
      }

      setCurrentUserId(user.id);
      const list = await backend.notifications.getNotifications(user.id);
      const nonMessageList = (list as NotificationItem[]).filter(
        (n) => !(n.type || '').toLowerCase().includes('message')
      );
      setNotifications(nonMessageList);
    } catch {
      // Keep existing list on network error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications(false);
  }, [loadNotifications]);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications(true);
    }, [loadNotifications])
  );

  // Realtime new notifications
  useEffect(() => {
    if (!currentUserId) return;

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = backend.notifications.subscribeNotifications(
        currentUserId,
        (incoming) => {
          if (!incoming) return;
          if ((incoming.type || '').toLowerCase().includes('message')) return;
          setNotifications((prev) => {
            if (prev.some((n) => n.id === incoming.id)) return prev;
            return [incoming as NotificationItem, ...prev];
          });
        }
      );
    } catch {
      unsubscribe = null;
    }

    return () => {
      try {
        unsubscribe?.();
      } catch {}
    };
  }, [currentUserId]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (activeFilter === 'unread') return !n.is_read;
      if (activeFilter === 'follows') {
        return (n.type || '').toLowerCase().includes('follow');
      }
      if (activeFilter === 'activity') {
        return !(n.type || '').toLowerCase().includes('follow');
      }
      return true;
    });
  }, [notifications, activeFilter]);

  const handleMarkAllRead = async () => {
    if (!currentUserId || unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await backend.notifications.markAllAsRead(currentUserId);
      DeviceEventEmitter.emit('notifications-updated');
    } catch {
      // Keep optimistic state
    }
  };

  const handlePressNotification = async (item: NotificationItem) => {
    if (!item.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
      );
      void backend.notifications
        .markAsRead(item.id)
        .then(() => DeviceEventEmitter.emit('notifications-updated'))
        .catch(() => {});
    }

    const t = (item.type || '').toLowerCase();
    if (
      (t.includes('message') ||
        t.includes('call') ||
        t.includes('screenshot')) &&
      item.actor_id
    ) {
      router.push({
        pathname: '/messages',
        params: {
          userId: item.actor_id,
          name: item.actor_name || item.actor_username || 'User',
          username: item.actor_username || '',
          avatarUrl: item.actor_avatar || DEFAULT_AVATAR,
        },
      } as any);
      return;
    }

    if (
      item.target_id &&
      (t.includes('like') ||
        t.includes('comment') ||
        t.includes('live') ||
        t.includes('view'))
    ) {
      router.push(`/media/${item.target_id}` as any);
      return;
    }

    if (item.actor_id) {
      router.push({
        pathname: '/profile',
        params: { userId: item.actor_id },
      } as any);
    }
  };

  const handleDeleteNotification = (item: NotificationItem) => {
    Alert.alert('Remove Notification', 'Delete this notification?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setNotifications((prev) => prev.filter((n) => n.id !== item.id));
          try {
            await backend.notifications.deleteNotification(item.id);
          } catch {
            // ignore
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const meta = getTypeMeta(item.type);
    const avatarUri = (item.actor_avatar || '').trim() || DEFAULT_AVATAR;

    return (
      <TouchableOpacity
        style={[
          styles.row,
          {
            backgroundColor: item.is_read ? colors.bg : colors.unreadBg,
            borderBottomColor: colors.border,
          },
        ]}
        activeOpacity={0.78}
        onPress={() => void handlePressNotification(item)}
        onLongPress={() => handleDeleteNotification(item)}
      >
        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: avatarUri }}
            style={[styles.avatar, { backgroundColor: colors.surface }]}
          />
          <View
            style={[
              styles.typeBadge,
              { backgroundColor: meta.color, borderColor: colors.bg },
            ]}
          >
            <Ionicons name={meta.icon} size={10} color="#ffffff" />
          </View>
        </View>

        <View style={styles.rowBody}>
          <Text
            style={[
              styles.messageText,
              { color: colors.text },
              !item.is_read && { fontWeight: '700' },
            ]}
            numberOfLines={3}
          >
            {item.actor_name ? (
              <Text style={{ fontWeight: '800' }}>{item.actor_name} </Text>
            ) : null}
            {item.message}
          </Text>
          <Text style={[styles.timeText, { color: colors.subtext }]}>
            {formatRelativeTime(item.created_at)}
          </Text>
        </View>

        {!item.is_read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* HEADER */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.surface }]}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)' as any);
          }}
          activeOpacity={0.75}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Notifications
        </Text>

        <TouchableOpacity
          style={[
            styles.markAllBtn,
            { backgroundColor: colors.surface },
            unreadCount === 0 && { opacity: 0.45 },
          ]}
          onPress={() => void handleMarkAllRead()}
          disabled={unreadCount === 0}
          activeOpacity={0.75}
        >
          <Ionicons
            name="checkmark-done-outline"
            size={17}
            color={colors.text}
          />
        </TouchableOpacity>
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
                label: unreadCount > 0 ? `Unread (${unreadCount})` : 'Unread',
              },
              { key: 'follows', label: 'Follows' },
              { key: 'activity', label: 'Activity' },
            ] as { key: NotificationFilter; label: string }[]
          ).map((tab) => {
            const active = activeFilter === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.filterPill,
                  { backgroundColor: active ? colors.accent : colors.surface },
                ]}
                onPress={() => setActiveFilter(tab.key)}
                activeOpacity={0.8}
              >
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

      {/* LIST */}
      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color={colors.emerald} />
          <Text style={[styles.subText, { color: colors.subtext }]}>
            Loading notifications...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          keyExtractor={(item, idx) => String(item.id || idx)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 16) + 20,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadNotifications(true)}
              tintColor={colors.text}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Ionicons
                name="notifications-off-outline"
                size={38}
                color={colors.subtext}
              />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {activeFilter === 'unread'
                  ? 'All caught up'
                  : 'No notifications yet'}
              </Text>
              <Text style={[styles.subText, { color: colors.subtext }]}>
                Follows, likes, comments, waves, and alerts will show up here.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  backBtn: {
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
  },
  markAllBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBar: { paddingVertical: 9, borderBottomWidth: 1 },
  filterContent: { paddingHorizontal: 14, gap: 8 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6.5,
    borderRadius: 999,
  },
  filterPillText: { fontSize: 12.5, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  typeBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  messageText: { fontSize: 13.5, lineHeight: 19 },
  timeText: { fontSize: 11.5, fontWeight: '600' },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 6,
  },
  emptyTitle: { fontSize: 15.5, fontWeight: '800', marginTop: 4 },
  subText: { fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
});