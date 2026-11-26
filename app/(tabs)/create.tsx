import React, { useState, useCallback, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
  DeviceEventEmitter,
  Platform,
  useColorScheme,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  CreationModeKey,
  DraftItem,
  getStudioDrafts,
  deleteStudioDraft,
} from '../../lib/creatorStudio';
import { backend } from '../../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

interface CreationOption {
  id: string;
  mode: CreationModeKey;
  route: string;
  title: string;
  subtitle: string;
  spec: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
}

const CREATION_OPTIONS: CreationOption[] = [
  {
    id: 'video',
    mode: 'video',
    route: '/studio/video',
    title: 'Video',
    subtitle: 'Full-length videos, chapters & monetization',
    spec: '16:9 · Up to 4K',
    icon: 'videocam-outline',
    accent: '#10b981',
  },
  {
    id: 'reel',
    mode: 'reel',
    route: '/studio/reel',
    title: 'Shorts',
    subtitle: 'Fast vertical reels with music & teasers',
    spec: '9:16 · 60s',
    icon: 'flash-outline',
    accent: '#f59e0b',
  },
  {
    id: 'live',
    mode: 'live',
    route: '/studio/live',
    title: 'Go Live',
    subtitle: 'Real-time broadcast with interactive chat',
    spec: 'Live · Low Latency',
    icon: 'radio-outline',
    accent: '#ef4444',
  },
  {
    id: 'post',
    mode: 'post',
    route: '/studio/post',
    title: 'Photos',
    subtitle: 'Share photos, carousels & captions',
    spec: 'Feed · HD',
    icon: 'image-outline',
    accent: '#0ea5e9',
  },
];

const formatCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
};

export default function CreateScreen() {
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
      border: isDark ? '#27272a' : '#f1f5f9',
      borderStrong: isDark ? '#3f3f46' : '#e4e4e7',
      text: isDark ? '#fafafa' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#71717a',
      accent: isDark ? '#fafafa' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
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

  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [isDraftsModalOpen, setIsDraftsModalOpen] = useState(false);
  const [quickStats, setQuickStats] = useState({
    uploads: 0,
    followers: 0,
    views: 0,
  });

  const loadHubData = useCallback(async () => {
    getStudioDrafts().then(setDrafts).catch(() => {});

    try {
      const user = await backend.auth.getCurrentUser();
      if (!user?.id) return;

      const stats = await backend.studio.getCreatorQuickStats(user.id);
      setQuickStats(stats);
    } catch {
      // keep fallback zeros
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHubData();
    }, [loadHubData])
  );

  const handleOpenDraft = useCallback(
    (draft: DraftItem) => {
      setIsDraftsModalOpen(false);
      router.push({
        pathname: `/studio/${draft.mode}` as any,
        params: { draftId: draft.id },
      });
    },
    [router]
  );

  const handleRemoveDraft = useCallback(async (draftId: string) => {
    const updated = await deleteStudioDraft(draftId);
    setDrafts(updated);
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      {/* CLEAN EXECUTIVE HEADER */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Create
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.subtext }]}>
            Publish & manage your channel
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[
              styles.headerIconPill,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
              },
            ]}
            activeOpacity={0.8}
            onPress={() => setIsDraftsModalOpen(true)}
          >
            <Feather name="file-text" size={14} color={colors.text} />
            <Text style={[styles.headerPillText, { color: colors.text }]}>
              Drafts
            </Text>
            {drafts.length > 0 && (
              <View
                style={[styles.countDot, { backgroundColor: colors.accent }]}
              >
                <Text
                  style={[styles.countDotText, { color: colors.accentText }]}
                >
                  {drafts.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom:
              Platform.OS === 'android'
                ? Math.max(insets.bottom, 24) + 96
                : Math.max(insets.bottom, 16) + 96,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* DEDICATED CREATOR STUDIO ENTRY (THEME-AWARE & EDGE-TO-EDGE) */}
        <TouchableOpacity
          style={[
            styles.studioEntryCard,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
          activeOpacity={0.9}
          onPress={() => router.push('/creator-studio' as any)}
        >
          <View style={styles.studioEntryTop}>
            <View style={styles.studioIconWrap}>
              <Ionicons name="analytics" size={18} color="#10b981" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.studioEntryTitle, { color: colors.text }]}>
                Creator Studio
              </Text>
              <Text style={[styles.studioEntrySub, { color: colors.subtext }]}>
                Dashboard, analytics, edit uploads & comments
              </Text>
            </View>
            <View
              style={[
                styles.studioArrowCircle,
                { backgroundColor: colors.accent },
              ]}
            >
              <Ionicons
                name="arrow-forward"
                size={15}
                color={colors.accentText}
              />
            </View>
          </View>

          <View
            style={[
              styles.studioMiniStatsRow,
              { borderTopColor: colors.borderStrong },
            ]}
          >
            <View style={styles.studioMiniStat}>
              <Text style={[styles.studioMiniVal, { color: colors.text }]}>
                {formatCompact(quickStats.views)}
              </Text>
              <Text style={[styles.studioMiniLabel, { color: colors.subtext }]}>
                Views
              </Text>
            </View>
            <View
              style={[
                styles.studioMiniDivider,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <View style={styles.studioMiniStat}>
              <Text style={[styles.studioMiniVal, { color: colors.text }]}>
                {formatCompact(quickStats.followers)}
              </Text>
              <Text style={[styles.studioMiniLabel, { color: colors.subtext }]}>
                Followers
              </Text>
            </View>
            <View
              style={[
                styles.studioMiniDivider,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <View style={styles.studioMiniStat}>
              <Text style={[styles.studioMiniVal, { color: colors.text }]}>
                {quickStats.uploads}
              </Text>
              <Text style={[styles.studioMiniLabel, { color: colors.subtext }]}>
                Uploads
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* CREATION FORMATS LIST (EDGE-TO-EDGE) */}
        <Text style={[styles.sectionLabel, { color: colors.subtext }]}>
          NEW PUBLICATION
        </Text>

        <View
          style={[
            styles.optionsGroup,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {CREATION_OPTIONS.map((item, idx) => (
            <React.Fragment key={item.id}>
              <TouchableOpacity
                style={styles.optionRow}
                activeOpacity={0.75}
                onPress={() => router.push(item.route as any)}
              >
                <View
                  style={[
                    styles.optionIconBox,
                    { backgroundColor: colors.surface },
                  ]}
                >
                  <Ionicons name={item.icon} size={21} color={item.accent} />
                </View>

                <View style={styles.optionTextCol}>
                  <View style={styles.optionTitleRow}>
                    <Text style={[styles.optionTitle, { color: colors.text }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.optionSpec, { color: colors.subtext }]}>
                      {item.spec}
                    </Text>
                  </View>
                  <Text
                    style={[styles.optionSub, { color: colors.subtext }]}
                    numberOfLines={1}
                  >
                    {item.subtitle}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>
              {idx < CREATION_OPTIONS.length - 1 && (
                <View
                  style={[styles.rowDivider, { backgroundColor: colors.border }]}
                />
              )}
            </React.Fragment>
          ))}
        </View>

        {/* CONTINUE EDITING DRAFTS STRIP */}
        {drafts.length > 0 && (
          <View style={styles.draftsSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: colors.subtext }]}>
                CONTINUE EDITING
              </Text>
              <TouchableOpacity onPress={() => setIsDraftsModalOpen(true)}>
                <Text style={styles.seeAllLink}>See all</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.draftsScroll}
            >
              {drafts.slice(0, 6).map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[
                    styles.draftCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                  onPress={() => handleOpenDraft(d)}
                  activeOpacity={0.82}
                >
                  <Image
                    source={{ uri: d.coverUri }}
                    style={[
                      styles.draftCardThumb,
                      { backgroundColor: colors.surface },
                    ]}
                  />
                  <View style={styles.draftCardBody}>
                    <Text
                      style={[styles.draftCardTitle, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {d.title}
                    </Text>
                    <Text
                      style={[styles.draftCardMeta, { color: colors.subtext }]}
                      numberOfLines={1}
                    >
                      {d.mode.toUpperCase()} · {d.savedAt}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* QUICK SHORTCUT TO WATCH FEED */}
        <TouchableOpacity
          style={[
            styles.watchShortcutRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/watch' as any)}
        >
          <Ionicons name="play-circle-outline" size={20} color={colors.text} />
          <Text style={[styles.watchShortcutText, { color: colors.text }]}>
            Preview your published content on Watch
          </Text>
          <Ionicons name="arrow-forward" size={16} color={colors.subtext} />
        </TouchableOpacity>
      </ScrollView>

      {/* SAVED DRAFTS MODAL */}
      <Modal
        visible={isDraftsModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsDraftsModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsDraftsModalOpen(false)}
          />
          <View
            style={[
              styles.draftsSheet,
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
            <View
              style={[
                styles.sheetTopBar,
                { borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                Saved Drafts ({drafts.length})
              </Text>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setIsDraftsModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {drafts.length === 0 ? (
                <Text style={[styles.emptyDrafts, { color: colors.subtext }]}>
                  No saved drafts yet.
                </Text>
              ) : (
                drafts.map((d) => (
                  <View
                    key={d.id}
                    style={[
                      styles.draftRow,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.draftMainTouch}
                      onPress={() => handleOpenDraft(d)}
                    >
                      <Image
                        source={{ uri: d.coverUri }}
                        style={[
                          styles.draftThumb,
                          { backgroundColor: colors.surface },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.draftItemTitle, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {d.title}
                        </Text>
                        <Text
                          style={[
                            styles.draftItemMeta,
                            { color: colors.subtext },
                          ]}
                        >
                          {d.mode.toUpperCase()} · {d.category} · {d.savedAt}
                        </Text>
                      </View>
                      <Ionicons
                        name="create-outline"
                        size={18}
                        color={colors.text}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.deleteDraftBtn,
                        { backgroundColor: colors.dangerSoft },
                      ]}
                      onPress={() => handleRemoveDraft(d.id)}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={colors.danger}
                      />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  headerSubtitle: {
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 1,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIconPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
  },
  headerPillText: { fontSize: 12.5, fontWeight: '700' },
  countDot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countDotText: { fontSize: 10, fontWeight: '800' },

  scrollContent: { paddingHorizontal: 0, paddingTop: 0 },

  /* Creator Studio Entry (Edge-to-Edge) */
  studioEntryCard: {
    borderRadius: 0,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    marginBottom: 14,
  },
  studioEntryTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  studioIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  studioEntryTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  studioEntrySub: {
    fontSize: 12,
    marginTop: 2,
  },
  studioArrowCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studioMiniStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  studioMiniStat: { flex: 1, alignItems: 'center' },
  studioMiniVal: { fontSize: 16, fontWeight: '800' },
  studioMiniLabel: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  studioMiniDivider: {
    width: 1,
    height: 24,
  },

  /* Creation Options (Edge-to-Edge) */
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  optionsGroup: {
    borderRadius: 0,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  optionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextCol: { flex: 1 },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  optionTitle: { fontSize: 15, fontWeight: '700' },
  optionSpec: { fontSize: 11, fontWeight: '600' },
  optionSub: { fontSize: 12.5, marginTop: 2 },
  rowDivider: { height: 1, marginLeft: 72 },

  /* Drafts Strip */
  draftsSection: { marginBottom: 16 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingRight: 16,
  },
  seeAllLink: { fontSize: 12.5, fontWeight: '700', color: '#0095f6' },
  draftsScroll: { gap: 10, paddingHorizontal: 16 },
  draftCard: {
    width: 160,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  draftCardThumb: { width: '100%', height: 90 },
  draftCardBody: { padding: 10 },
  draftCardTitle: { fontSize: 13, fontWeight: '700' },
  draftCardMeta: { fontSize: 11, marginTop: 2 },

  /* Watch Shortcut */
  watchShortcutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 0,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  watchShortcutText: { flex: 1, fontSize: 13, fontWeight: '600' },

  /* Drafts Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  draftsSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '75%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDrafts: { textAlign: 'center', paddingVertical: 32, fontSize: 13.5 },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  draftMainTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  draftThumb: { width: 64, height: 42, borderRadius: 8 },
  draftItemTitle: { fontSize: 13.5, fontWeight: '700' },
  draftItemMeta: { fontSize: 11.5, marginTop: 2 },
  deleteDraftBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});