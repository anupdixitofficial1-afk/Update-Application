import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
  DeviceEventEmitter,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { backend } from '../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';

type ThemeMode = 'light' | 'dark' | 'system';
type StudioTab = 'dashboard' | 'content' | 'analytics' | 'comments';
type TimeRange = '7D' | '28D' | 'ALL';
type MediaVisibility = 'public' | 'subscribers' | 'private';

interface StudioMediaItem {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  format: 'video' | 'reel';
  visibility: MediaVisibility;
  allow_comments: boolean;
  views_count: number;
  likes_count: number;
  created_at: string;
}

interface StudioComment {
  id: string;
  media_id: string;
  media_title?: string;
  author: string;
  comment_text: string;
  created_at: string;
}

const formatCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
};

const formatRelative = (iso?: string): string => {
  if (!iso) return 'Recently';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function CreatorStudioScreen() {
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
      emeraldSoft: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
      blue: '#0095f6',
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

  const [activeTab, setActiveTab] = useState<StudioTab>('dashboard');
  const [timeRange, setTimeRange] = useState<TimeRange>('28D');
  const [contentFilter, setContentFilter] = useState<'all' | 'video' | 'reel'>('all');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [mediaList, setMediaList] = useState<StudioMediaItem[]>([]);
  const [commentsList, setCommentsList] = useState<StudioComment[]>([]);

  // Edit Media Modal State
  const [editingItem, setEditingItem] = useState<StudioMediaItem | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftVisibility, setDraftVisibility] = useState<MediaVisibility>('public');
  const [draftAllowComments, setDraftAllowComments] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  // Quick Reply State
  const [replyingComment, setReplyingComment] = useState<StudioComment | null>(null);
  const [replyText, setReplyText] = useState('');

  const loadStudioData = useCallback(async () => {
    try {
      const user = await backend.auth.getCurrentUser().catch(() => null);
      const uid = user?.id;
      if (!uid) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const dashboard = await backend.studio.getDashboardData(uid);
      setFollowersCount(dashboard.followersCount);

      const mappedMedia: StudioMediaItem[] = dashboard.media.map((r: any) => ({
        id: String(r.id),
        title: String(r.title || 'Untitled'),
        description: String(r.description || ''),
        thumbnail_url: String(r.thumbnail_url || r.cover_url || ''),
        format:
          r.format === 'reel' || r.orientation === 'vertical'
            ? 'reel'
            : 'video',
        visibility:
          r.visibility === 'private' || r.visibility === 'subscribers'
            ? r.visibility
            : 'public',
        allow_comments: r.allow_comments !== false,
        views_count: Number(r.views_count) || 0,
        likes_count: Number(r.likes_count) || 0,
        created_at: r.created_at || new Date().toISOString(),
      }));
      setMediaList(mappedMedia);

      const titleMap = new Map(mappedMedia.map((m) => [m.id, m.title]));
      setCommentsList(
        dashboard.comments.map((c: any) => ({
          id: String(c.id),
          media_id: String(c.media_id),
          media_title: titleMap.get(String(c.media_id)) || 'Video',
          author: String(c.author || 'Viewer'),
          comment_text: String(c.comment_text || ''),
          created_at: c.created_at || new Date().toISOString(),
        }))
      );
    } catch {
      // keep existing state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStudioData();
  }, [loadStudioData]);

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

  // Filtered by TimeRange
  const rangedMedia = useMemo(() => {
    if (timeRange === 'ALL') return mediaList;
    const days = timeRange === '7D' ? 7 : 28;
    const cutoff = Date.now() - days * 86400 * 1000;
    return mediaList.filter((m) => new Date(m.created_at).getTime() >= cutoff);
  }, [mediaList, timeRange]);

  const totalViews = useMemo(
    () => rangedMedia.reduce((s, m) => s + m.views_count, 0),
    [rangedMedia]
  );
  const totalLikes = useMemo(
    () => rangedMedia.reduce((s, m) => s + m.likes_count, 0),
    [rangedMedia]
  );

  const videoCount = useMemo(
    () => mediaList.filter((m) => m.format === 'video').length,
    [mediaList]
  );
  const reelCount = useMemo(
    () => mediaList.filter((m) => m.format === 'reel').length,
    [mediaList]
  );

  const filteredContent = useMemo(() => {
    if (contentFilter === 'all') return mediaList;
    return mediaList.filter((m) => m.format === contentFilter);
  }, [mediaList, contentFilter]);

  const topPerforming = useMemo(
    () => [...mediaList].sort((a, b) => b.views_count - a.views_count).slice(0, 5),
    [mediaList]
  );

  const openEditModal = (item: StudioMediaItem) => {
    setEditingItem(item);
    setDraftTitle(item.title);
    setDraftDesc(item.description);
    setDraftVisibility(item.visibility);
    setDraftAllowComments(item.allow_comments);
  };

  const handleSaveEdit = async () => {
    if (!editingItem || !draftTitle.trim()) {
      Alert.alert('Error', 'Title cannot be empty.');
      return;
    }
    try {
      setSavingEdit(true);
      await backend.studio.updateWatchMedia(editingItem.id, {
        title: draftTitle.trim(),
        description: draftDesc.trim(),
        visibility: draftVisibility,
        allow_comments: draftAllowComments,
      });

      setMediaList((prev) =>
        prev.map((m) =>
          m.id === editingItem.id
            ? {
                ...m,
                title: draftTitle.trim(),
                description: draftDesc.trim(),
                visibility: draftVisibility,
                allow_comments: draftAllowComments,
              }
            : m
        )
      );
      setEditingItem(null);
      Alert.alert('Saved', 'Content details updated.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update content.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteMedia = (item: StudioMediaItem) => {
    Alert.alert(
      'Delete Content',
      `Are you sure you want to permanently delete "${item.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await backend.studio.deleteWatchMedia(item.id);
              setMediaList((prev) => prev.filter((m) => m.id !== item.id));
              setEditingItem(null);
            } catch {
              Alert.alert('Error', 'Could not delete item.');
            }
          },
        },
      ]
    );
  };

  const handleSendReply = async () => {
    if (!replyingComment || !replyText.trim()) return;
    const newReply: StudioComment = {
      id: `c-${Date.now()}`,
      media_id: replyingComment.media_id,
      media_title: replyingComment.media_title,
      author: 'Creator (You)',
      comment_text: `@${replyingComment.author} ${replyText.trim()}`,
      created_at: new Date().toISOString(),
    };
    setCommentsList((prev) => [newReply, ...prev]);
    setReplyText('');
    setReplyingComment(null);

    try {
      await backend.watch.addComment({
        id: newReply.id,
        mediaId: newReply.media_id,
        author: newReply.author,
        text: newReply.comment_text,
      });
    } catch {
      // keep optimistic
    }
  };

  const handleDeleteComment = async (id: string) => {
    setCommentsList((prev) => prev.filter((c) => c.id !== id));
    try {
      await backend.studio.deleteWatchComment(id);
    } catch {
      // ignore
    }
  };

  const followerGoal = 1000;
  const followerProgress = Math.min(100, Math.round((followersCount / followerGoal) * 100));
  const viewsGoal = 10000;
  const viewsProgress = Math.min(100, Math.round((totalViews / viewsGoal) * 100));

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <Stack.Screen options={{ headerShown: false }} />
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
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Creator Studio
          </Text>
          <Text style={[styles.headerSub, { color: colors.subtext }]}>
            Channel dashboard & analytics
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.uploadQuickBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.push('/studio/video' as any)}
        >
          <Ionicons name="add" size={18} color={colors.accentText} />
        </TouchableOpacity>
      </View>

      {/* BODY */}
      {loading ? (
        <View style={styles.loaderBox}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollBody,
            {
              paddingBottom:
                Platform.OS === 'android'
                  ? Math.max(insets.bottom, 48) + 84
                  : Math.max(insets.bottom, 16) + 84,
            },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadStudioData();
              }}
              tintColor={colors.text}
            />
          }
        >
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <>
              <View
                style={[
                  styles.rangeHeaderRow,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Channel Overview
                </Text>
                <View
                  style={[
                    styles.rangeTrack,
                    { backgroundColor: colors.surface },
                  ]}
                >
                  {(['7D', '28D', 'ALL'] as TimeRange[]).map((r) => {
                    const active = timeRange === r;
                    return (
                      <TouchableOpacity
                        key={r}
                        style={[
                          styles.rangePill,
                          active && { backgroundColor: colors.accent },
                        ]}
                        onPress={() => setTimeRange(r)}
                      >
                        <Text
                          style={[
                            styles.rangeText,
                            {
                              color: active
                                ? colors.accentText
                                : colors.subtext,
                            },
                          ]}
                        >
                          {r}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View
                style={[
                  styles.metricsGrid,
                  { borderBottomColor: colors.border },
                ]}
              >
                {[
                  {
                    label: 'Total Views',
                    value: formatCompact(totalViews),
                    icon: 'eye-outline' as const,
                    color: '#10b981',
                  },
                  {
                    label: 'Followers',
                    value: formatCompact(followersCount),
                    icon: 'people-outline' as const,
                    color: '#0095f6',
                  },
                  {
                    label: 'Total Likes',
                    value: formatCompact(totalLikes),
                    icon: 'thumbs-up-outline' as const,
                    color: '#f59e0b',
                  },
                  {
                    label: 'Comments',
                    value: formatCompact(commentsList.length),
                    icon: 'chatbubble-outline' as const,
                    color: '#8b5cf6',
                  },
                ].map((m, idx) => (
                  <View
                    key={m.label}
                    style={[
                      styles.metricCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRightWidth: idx % 2 === 0 ? 1 : 0,
                        borderBottomWidth: idx < 2 ? 1 : 0,
                      },
                    ]}
                  >
                    <View style={styles.metricTopRow}>
                      <Ionicons name={m.icon} size={18} color={m.color} />
                      <Text
                        style={[styles.metricLabel, { color: colors.subtext }]}
                      >
                        {m.label}
                      </Text>
                    </View>
                    <Text style={[styles.metricValue, { color: colors.text }]}>
                      {m.value}
                    </Text>
                  </View>
                ))}
              </View>

              {/* LATEST UPLOAD PERFORMANCE */}
              {mediaList[0] && (
                <View
                  style={[
                    styles.cardBox,
                    {
                      backgroundColor: colors.card,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[styles.cardHeading, { color: colors.subtext }]}
                  >
                    LATEST UPLOAD
                  </Text>
                  <TouchableOpacity
                    style={styles.latestRow}
                    onPress={() => openEditModal(mediaList[0])}
                  >
                    {mediaList[0].thumbnail_url ? (
                      <Image
                        source={{ uri: mediaList[0].thumbnail_url }}
                        style={[
                          styles.latestThumb,
                          { backgroundColor: colors.surface },
                        ]}
                      />
                    ) : (
                      <View
                        style={[
                          styles.latestThumb,
                          {
                            backgroundColor: colors.surface,
                            alignItems: 'center',
                            justifyContent: 'center',
                          },
                        ]}
                      >
                        <Ionicons
                          name="videocam-outline"
                          size={20}
                          color={colors.subtext}
                        />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.latestTitle, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {mediaList[0].title}
                      </Text>
                      <Text
                        style={[styles.latestMeta, { color: colors.subtext }]}
                      >
                        {formatCompact(mediaList[0].views_count)} views ·{' '}
                        {formatCompact(mediaList[0].likes_count)} likes ·{' '}
                        {formatRelative(mediaList[0].created_at)}
                      </Text>
                    </View>
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color={colors.subtext}
                    />
                  </TouchableOpacity>
                </View>
              )}

              {/* CREATOR MILESTONES / MONETIZATION TRACKER */}
              <View
                style={[
                  styles.cardBox,
                  {
                    backgroundColor: colors.card,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.cardHeading, { color: colors.subtext }]}>
                  CREATOR MILESTONES
                </Text>

                <View style={styles.milestoneRow}>
                  <View style={styles.milestoneLabelRow}>
                    <Text
                      style={[styles.milestoneTitle, { color: colors.text }]}
                    >
                      Followers Goal
                    </Text>
                    <Text
                      style={[styles.milestoneVal, { color: colors.subtext }]}
                    >
                      {followersCount} / {followerGoal}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.progressTrack,
                      { backgroundColor: colors.surface },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${followerProgress}%`,
                          backgroundColor: '#0095f6',
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={[styles.milestoneRow, { marginTop: 14 }]}>
                  <View style={styles.milestoneLabelRow}>
                    <Text
                      style={[styles.milestoneTitle, { color: colors.text }]}
                    >
                      Views Milestone
                    </Text>
                    <Text
                      style={[styles.milestoneVal, { color: colors.subtext }]}
                    >
                      {formatCompact(totalViews)} / {formatCompact(viewsGoal)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.progressTrack,
                      { backgroundColor: colors.surface },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${viewsProgress}%`,
                          backgroundColor: '#10b981',
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
            </>
          )}

          {/* TAB 2: CONTENT MANAGER */}
          {activeTab === 'content' && (
            <>
              <View
                style={[
                  styles.filterPillsRow,
                  { borderBottomColor: colors.border },
                ]}
              >
                {(
                  [
                    { key: 'all', label: `All (${mediaList.length})` },
                    { key: 'video', label: `Videos (${videoCount})` },
                    { key: 'reel', label: `Shorts (${reelCount})` },
                  ] as const
                ).map((f) => {
                  const active = contentFilter === f.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[
                        styles.filterPill,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                        },
                      ]}
                      onPress={() => setContentFilter(f.key)}
                    >
                      <Text
                        style={[
                          styles.filterPillText,
                          {
                            color: active ? colors.accentText : colors.text,
                          },
                        ]}
                      >
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {filteredContent.length === 0 ? (
                <Text style={[styles.emptyMsg, { color: colors.subtext }]}>
                  No uploaded content yet.
                </Text>
              ) : (
                filteredContent.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.contentItemRow,
                      {
                        backgroundColor: colors.card,
                        borderBottomColor: colors.border,
                      },
                    ]}
                    onPress={() => openEditModal(item)}
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: item.thumbnail_url }}
                      style={[
                        styles.contentThumb,
                        { backgroundColor: colors.surface },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.contentTitle, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </Text>
                      <View style={styles.contentMetaRow}>
                        <Ionicons
                          name={
                            item.visibility === 'public'
                              ? 'globe-outline'
                              : item.visibility === 'subscribers'
                                ? 'people-outline'
                                : 'lock-closed-outline'
                          }
                          size={12}
                          color={colors.subtext}
                        />
                        <Text
                          style={[
                            styles.contentMetaText,
                            { color: colors.subtext },
                          ]}
                        >
                          {item.visibility} · {formatCompact(item.views_count)}{' '}
                          views
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color={colors.subtext}
                    />
                  </TouchableOpacity>
                ))
              )}
            </>
          )}

          {/* TAB 3: ANALYTICS */}
          {activeTab === 'analytics' && (
            <>
              <View
                style={[
                  styles.cardBox,
                  {
                    backgroundColor: colors.card,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.cardHeading, { color: colors.subtext }]}>
                  FORMAT BREAKDOWN
                </Text>
                <View style={styles.breakdownRow}>
                  <View style={styles.breakdownCol}>
                    <Text
                      style={[styles.breakdownVal, { color: colors.text }]}
                    >
                      {videoCount}
                    </Text>
                    <Text
                      style={[styles.breakdownLabel, { color: colors.subtext }]}
                    >
                      Long Videos
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.breakdownDivider,
                      { backgroundColor: colors.border },
                    ]}
                  />
                  <View style={styles.breakdownCol}>
                    <Text
                      style={[styles.breakdownVal, { color: colors.text }]}
                    >
                      {reelCount}
                    </Text>
                    <Text
                      style={[styles.breakdownLabel, { color: colors.subtext }]}
                    >
                      Vibe Shorts
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.breakdownDivider,
                      { backgroundColor: colors.border },
                    ]}
                  />
                  <View style={styles.breakdownCol}>
                    <Text
                      style={[styles.breakdownVal, { color: colors.emerald }]}
                    >
                      {totalViews > 0
                        ? `${Math.min(100, Math.round(((totalLikes + commentsList.length) / totalViews) * 100))}%`
                        : '0%'}
                    </Text>
                    <Text
                      style={[styles.breakdownLabel, { color: colors.subtext }]}
                    >
                      Engagement
                    </Text>
                  </View>
                </View>
              </View>

              <Text
                style={[
                  styles.sectionTitle,
                  {
                    color: colors.text,
                    paddingHorizontal: 16,
                    paddingTop: 14,
                    paddingBottom: 6,
                  },
                ]}
              >
                Top Performing Content
              </Text>
              {topPerforming.length === 0 ? (
                <Text style={[styles.emptyMsg, { color: colors.subtext }]}>
                  Upload videos or reels to see analytics.
                </Text>
              ) : (
                topPerforming.map((item, idx) => (
                  <View
                    key={item.id}
                    style={[
                      styles.topRow,
                      {
                        backgroundColor: colors.card,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.rankNum, { color: colors.subtext }]}>
                      #{idx + 1}
                    </Text>
                    <Image
                      source={{ uri: item.thumbnail_url }}
                      style={[
                        styles.topThumb,
                        { backgroundColor: colors.surface },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.contentTitle, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={[
                          styles.contentMetaText,
                          { color: colors.subtext },
                        ]}
                      >
                        {formatCompact(item.views_count)} views ·{' '}
                        {formatCompact(item.likes_count)} likes
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* TAB 4: COMMENTS INBOX (Borderless seamless rows) */}
          {activeTab === 'comments' && (
            <>
              <Text
                style={[
                  styles.sectionTitle,
                  {
                    color: colors.text,
                    paddingHorizontal: 16,
                    paddingTop: 14,
                    paddingBottom: 6,
                  },
                ]}
              >
                Recent Community Comments ({commentsList.length})
              </Text>
              {commentsList.length === 0 ? (
                <Text style={[styles.emptyMsg, { color: colors.subtext }]}>
                  No comments on your uploads yet.
                </Text>
              ) : (
                commentsList.map((c) => (
                  <View
                    key={c.id}
                    style={[styles.commentCard, { backgroundColor: colors.bg }]}
                  >
                    <View style={styles.commentTopRow}>
                      <Text
                        style={[styles.commentAuthor, { color: colors.text }]}
                      >
                        {c.author}
                      </Text>
                      <Text
                        style={[styles.commentTime, { color: colors.subtext }]}
                      >
                        {formatRelative(c.created_at)}
                      </Text>
                    </View>
                    <Text
                      style={[styles.commentVideoRef, { color: colors.subtext }]}
                      numberOfLines={1}
                    >
                      On: {c.media_title}
                    </Text>
                    <Text style={[styles.commentBody, { color: colors.text }]}>
                      {c.comment_text}
                    </Text>
                    <View style={styles.commentActionsRow}>
                      <TouchableOpacity
                        style={[
                          styles.commentActionPill,
                          { backgroundColor: colors.surface },
                        ]}
                        onPress={() => {
                          setReplyingComment(c);
                          setReplyText('');
                        }}
                      >
                        <Text
                          style={[
                            styles.commentActionText,
                            { color: colors.text },
                          ]}
                        >
                          Reply
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.commentActionPill,
                          { backgroundColor: colors.dangerSoft },
                        ]}
                        onPress={() => void handleDeleteComment(c.id)}
                      >
                        <Text
                          style={[
                            styles.commentActionText,
                            { color: colors.danger },
                          ]}
                        >
                          Delete
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* BOTTOM STUDIO NAVIGATION BAR */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.borderStrong,
            paddingBottom:
              Platform.OS === 'android'
                ? Math.max(insets.bottom, 48) + 8
                : Math.max(insets.bottom, 10),
          },
        ]}
      >
        {(
          [
            { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline' },
            { key: 'content', label: 'Content', icon: 'film-outline' },
            { key: 'analytics', label: 'Analytics', icon: 'bar-chart-outline' },
            { key: 'comments', label: 'Comments', icon: 'chatbubbles-outline' },
          ] as const
        ).map((t) => {
          const active = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.bottomTabBtn}
              onPress={() => setActiveTab(t.key)}
            >
              <Ionicons
                name={t.icon}
                size={20}
                color={active ? colors.text : colors.subtext}
              />
              <Text
                style={[
                  styles.bottomTabLabel,
                  { color: active ? colors.text : colors.subtext },
                  active && { fontWeight: '800' },
                ]}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* EDIT CONTENT MODAL */}
      <Modal
        visible={!!editingItem}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingItem(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setEditingItem(null)}
          />
          {editingItem && (
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.card,
                  paddingBottom:
                    Platform.OS === 'android'
                      ? Math.max(insets.bottom, 48) + 14
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
              <View style={styles.sheetHeader}>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Edit Content
                </Text>
                <TouchableOpacity onPress={() => setEditingItem(null)}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                TITLE
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    color: colors.text,
                    borderColor: colors.borderStrong,
                  },
                ]}
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder="Video title"
                placeholderTextColor={colors.subtext}
              />

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                DESCRIPTION
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    height: 80,
                    textAlignVertical: 'top',
                    backgroundColor: colors.surface,
                    color: colors.text,
                    borderColor: colors.borderStrong,
                  },
                ]}
                value={draftDesc}
                onChangeText={setDraftDesc}
                multiline
                placeholder="Add description..."
                placeholderTextColor={colors.subtext}
              />

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                VISIBILITY
              </Text>
              <View style={styles.visRow}>
                {(['public', 'subscribers', 'private'] as MediaVisibility[]).map(
                  (v) => {
                    const active = draftVisibility === v;
                    return (
                      <TouchableOpacity
                        key={v}
                        style={[
                          styles.visPill,
                          {
                            backgroundColor: active
                              ? colors.accent
                              : colors.surface,
                          },
                        ]}
                        onPress={() => setDraftVisibility(v)}
                      >
                        <Text
                          style={[
                            styles.visText,
                            {
                              color: active ? colors.accentText : colors.text,
                            },
                          ]}
                        >
                          {v}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>
                  Allow Comments
                </Text>
                <Switch
                  value={draftAllowComments}
                  onValueChange={setDraftAllowComments}
                  trackColor={{ false: colors.borderStrong, true: '#10b981' }}
                  thumbColor="#ffffff"
                />
              </View>

              <View style={styles.sheetActions}>
                <TouchableOpacity
                  style={[
                    styles.deleteBtn,
                    { backgroundColor: colors.dangerSoft },
                  ]}
                  onPress={() => handleDeleteMedia(editingItem)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={colors.danger}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.accent }]}
                  onPress={() => void handleSaveEdit()}
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator color={colors.accentText} />
                  ) : (
                    <Text
                      style={[
                        styles.saveBtnText,
                        { color: colors.accentText },
                      ]}
                    >
                      Save Changes
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* QUICK REPLY MODAL */}
      <Modal
        visible={!!replyingComment}
        transparent
        animationType="fade"
        onRequestClose={() => setReplyingComment(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setReplyingComment(null)}
          />
          {replyingComment && (
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.card,
                  paddingBottom:
                    Platform.OS === 'android'
                      ? Math.max(insets.bottom, 48) + 14
                      : Math.max(insets.bottom, 16) + 12,
                },
              ]}
            >
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                Reply to {replyingComment.author}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    marginTop: 12,
                    backgroundColor: colors.surface,
                    color: colors.text,
                    borderColor: colors.borderStrong,
                  },
                ]}
                value={replyText}
                onChangeText={setReplyText}
                placeholder="Write your reply..."
                placeholderTextColor={colors.subtext}
                autoFocus
              />
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  { backgroundColor: colors.accent, marginTop: 14 },
                ]}
                onPress={() => void handleSendReply()}
              >
                <Text
                  style={[styles.saveBtnText, { color: colors.accentText }]}
                >
                  Send Reply
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, marginTop: 1 },
  uploadQuickBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollBody: { paddingHorizontal: 0, paddingTop: 0 },

  rangeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  rangeTrack: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
    gap: 2,
  },
  rangePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  rangeText: { fontSize: 11, fontWeight: '700' },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderBottomWidth: 1,
  },
  metricCard: {
    width: '50%',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  metricTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metricValue: { fontSize: 22, fontWeight: '800', marginTop: 8 },
  metricLabel: { fontSize: 12, fontWeight: '600' },

  cardBox: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  cardHeading: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 12,
  },
  latestRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  latestThumb: { width: 96, height: 56, borderRadius: 10 },
  latestTitle: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  latestMeta: { fontSize: 11.5, marginTop: 4 },

  milestoneRow: { gap: 6 },
  milestoneLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  milestoneTitle: { fontSize: 13, fontWeight: '700' },
  milestoneVal: { fontSize: 12, fontWeight: '600' },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },

  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  filterPill: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999 },
  filterPillText: { fontSize: 12, fontWeight: '700' },

  contentItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  contentThumb: { width: 88, height: 52, borderRadius: 8 },
  contentTitle: { fontSize: 13.5, fontWeight: '700' },
  contentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  contentMetaText: { fontSize: 11.5, textTransform: 'capitalize' },

  breakdownRow: { flexDirection: 'row', alignItems: 'center' },
  breakdownCol: { flex: 1, alignItems: 'center' },
  breakdownVal: { fontSize: 20, fontWeight: '800' },
  breakdownLabel: { fontSize: 11.5, marginTop: 2, fontWeight: '600' },
  breakdownDivider: { width: 1, height: 30 },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rankNum: { fontSize: 13, fontWeight: '800', width: 24 },
  topThumb: { width: 64, height: 40, borderRadius: 8 },

  commentCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  commentTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentAuthor: { fontSize: 13.5, fontWeight: '700' },
  commentTime: { fontSize: 11 },
  commentVideoRef: { fontSize: 11.5, marginTop: 2 },
  commentBody: { fontSize: 13.5, marginTop: 6, lineHeight: 19 },
  commentActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  commentActionPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  commentActionText: { fontSize: 12, fontWeight: '700' },
  emptyMsg: { textAlign: 'center', paddingVertical: 40, fontSize: 13.5 },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 10,
  },
  bottomTabBtn: { flex: 1, alignItems: 'center', gap: 3 },
  bottomTabLabel: { fontSize: 10.5, fontWeight: '600' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 12,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  inputLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
  },
  visRow: { flexDirection: 'row', gap: 8 },
  visPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  visText: { fontSize: 12.5, fontWeight: '700', textTransform: 'capitalize' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  switchLabel: { fontSize: 14, fontWeight: '700' },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  deleteBtn: {
    width: 48,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '800' },
});