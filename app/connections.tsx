import React, { useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Image,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useNavigation, Stack } from 'expo-router';
import { supabase } from '../lib/supabase';

const FOLLOWS_UPDATED_EVENT = 'follows-updated';

type ConnectionTab = 'followers' | 'following' | 'subscriptions';

interface ConnectionUser {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  plan_name?: string | null;
  status?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
}

const MALE_CARTOON_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Leo&top=shortHairShortFlat&facialHair=beardLight&clothing=hoodie&backgroundColor=d1fae5';
const FEMALE_CARTOON_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Maya&top=longHairStraight&clothing=blazerAndShirt&backgroundColor=fce7f3';
const DEFAULT_CARTOON_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';

const getResolvedAvatarUri = (
  uploadedAvatar?: string | null,
  selectedGender?: string | null
): string => {
  const trimmedAvatar = (uploadedAvatar || '').trim();
  if (trimmedAvatar) return trimmedAvatar;

  const normalizedGender = (selectedGender || '').trim().toLowerCase();
  if (normalizedGender === 'female' || normalizedGender === 'f') {
    return FEMALE_CARTOON_AVATAR;
  }
  if (normalizedGender === 'male' || normalizedGender === 'm') {
    return MALE_CARTOON_AVATAR;
  }
  return DEFAULT_CARTOON_AVATAR;
};

const normalizeHandle = (raw: string): string => {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^@+/, '');
  return cleaned ? `@${cleaned}` : '';
};

const formatCompactCount = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(value);
};

export default function ConnectionsScreen() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    userId?: string;
    tab?: ConnectionTab;
    title?: string;
  }>();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
      title: '',
    });

    const parentNav = navigation.getParent?.();
    if (parentNav?.setOptions) {
      parentNav.setOptions({
        headerShown: false,
      });
    }
  }, [navigation]);

  const initialTab: ConnectionTab =
    params?.tab === 'following' || params?.tab === 'subscriptions'
      ? params.tab
      : 'followers';

  const [activeTab, setActiveTab] = useState<ConnectionTab>(initialTab);
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [userNameDisplay, setUserNameDisplay] = useState<string>(
    params?.title || 'User'
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [subscriptionsCount, setSubscriptionsCount] = useState(0);

  const [usersList, setUsersList] = useState<ConnectionUser[]>([]);
  const [myFollowingIds, setMyFollowingIds] = useState<string[]>([]);
  const [updatingFollowId, setUpdatingFollowId] = useState<string | null>(null);
  const [analysisUser, setAnalysisUser] = useState<ConnectionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSubscriptionMeta = async (
    profileId: string
  ): Promise<{ ids: string[]; metaById: Record<string, any> }> => {
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .or(`subscriber_id.eq.${profileId},user_id.eq.${profileId}`);

      if (error) return { ids: [], metaById: {} };

      const activeRows = (data || []).filter((row: any) => {
        const st = String(row?.status || 'active').toLowerCase();
        return st === 'active' || st === 'subscribed' || st === 'accepted';
      });

      const ids: string[] = [];
      const metaById: Record<string, any> = {};

      for (const row of activeRows) {
        const targetId = row.creator_id || row.channel_id || row.target_id;
        if (targetId && targetId !== profileId) {
          if (!metaById[targetId]) {
            ids.push(targetId);
            metaById[targetId] = row;
          }
        }
      }

      return { ids, metaById };
    } catch {
      return { ids: [], metaById: {} };
    }
  };

  const fetchProfilesByIds = async (
    ids: string[],
    metaById: Record<string, any> = {}
  ): Promise<ConnectionUser[]> => {
    if (!ids.length) return [];
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url, bio')
      .in('id', ids);

    if (error) throw error;

    const map = new Map((data || []).map((p: any) => [p.id, p]));
    return ids
      .map((id) => {
        const p = map.get(id);
        if (!p) return null;
        const subMeta = metaById[id] || {};
        return {
          ...p,
          plan_name: subMeta.plan_name || subMeta.tier || 'Active Plan',
          status: subMeta.status || 'active',
          expires_at: subMeta.expires_at || subMeta.ends_at || null,
          created_at: subMeta.created_at || null,
        } as ConnectionUser;
      })
      .filter(Boolean) as ConnectionUser[];
  };

  const loadCountsAndTabData = useCallback(
    async (profileId: string, tab: ConnectionTab, currentAuthId: string | null) => {
      setLoading(true);
      setUsersList([]);

      try {
        const [followersRes, followingRes, subData, myFollowingRes] =
          await Promise.all([
            supabase
              .from('follows')
              .select('follower_id')
              .eq('following_id', profileId)
              .or('status.eq.accepted,status.is.null'),
            supabase
              .from('follows')
              .select('following_id')
              .eq('follower_id', profileId)
              .or('status.eq.accepted,status.is.null'),
            fetchSubscriptionMeta(profileId),
            currentAuthId
              ? supabase
                  .from('follows')
                  .select('following_id')
                  .eq('follower_id', currentAuthId)
                  .or('status.eq.accepted,status.is.null')
              : Promise.resolve({ data: [] as any[] }),
          ]);

        const followerIds = Array.from(
          new Set(
            (followersRes.data || []).map((r: any) => r.follower_id).filter(Boolean)
          )
        );
        const followingIds = Array.from(
          new Set(
            (followingRes.data || [])
              .map((r: any) => r.following_id)
              .filter(Boolean)
          )
        );
        const myFollowIds = Array.from(
          new Set(
            ((myFollowingRes as any)?.data || [])
              .map((r: any) => r.following_id)
              .filter(Boolean)
          )
        );

        setMyFollowingIds(myFollowIds);
        setFollowersCount(followerIds.length);
        setFollowingCount(followingIds.length);
        setSubscriptionsCount(subData.ids.length);

        const targetIds =
          tab === 'followers'
            ? followerIds
            : tab === 'following'
              ? followingIds
              : subData.ids;

        const profiles = await fetchProfilesByIds(
          targetIds,
          tab === 'subscriptions' ? subData.metaById : {}
        );
        setUsersList(profiles);
      } catch (err) {
        console.error('Error loading connections:', err);
        setUsersList([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const authId = session?.user?.id ?? null;
      const paramId =
        typeof params?.userId === 'string' && params.userId.trim()
          ? params.userId.trim()
          : null;
      const effectiveId = paramId || authId;

      if (!mounted) return;
      setLoggedInUserId(authId);
      setTargetUserId(effectiveId);

      if (params?.title) {
        setUserNameDisplay(params.title);
      } else if (effectiveId) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, username')
          .eq('id', effectiveId)
          .maybeSingle();
        if (mounted && prof) {
          setUserNameDisplay(
            prof.full_name ||
              (prof.username ? normalizeHandle(prof.username) : 'User')
          );
        }
      }

      if (effectiveId) {
        await loadCountsAndTabData(effectiveId, activeTab, authId);
      } else if (mounted) {
        setLoading(false);
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [params?.userId, params?.title, activeTab, loadCountsAndTabData]);

  const handleSelectTab = (nextTab: ConnectionTab) => {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    if (targetUserId) {
      loadCountsAndTabData(targetUserId, nextTab, loggedInUserId);
    }
  };

  const handleFollowBack = async (targetId: string) => {
    if (!loggedInUserId || loggedInUserId === targetId || updatingFollowId) return;
    try {
      setUpdatingFollowId(targetId);
      setMyFollowingIds((prev) => Array.from(new Set([...prev, targetId])));

      const { error } = await supabase.from('follows').insert({
        follower_id: loggedInUserId,
        following_id: targetId,
        status: 'accepted',
      });
      if (error) throw error;

      if (targetUserId === loggedInUserId) {
        setFollowingCount((prev) => prev + 1);
      }

      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
        followerId: loggedInUserId,
        followingId: targetId,
        status: 'accepted',
      });
    } catch (err: any) {
      setMyFollowingIds((prev) => prev.filter((id) => id !== targetId));
      Alert.alert('Action Failed', err?.message || 'Could not follow back.');
    } finally {
      setUpdatingFollowId(null);
    }
  };

  const handleMessageUser = (user: ConnectionUser) => {
    router.push({
      pathname: '/chat',
      params: {
        userId: user.id,
        username: user.username || '',
        name: user.full_name || user.username || 'User',
      },
    } as any);
  };

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^@+/, '');
    if (!q) return usersList;
    return usersList.filter((u) => {
      const fullName = (u.full_name || '').toLowerCase();
      const uname = (u.username || '').toLowerCase().replace(/^@+/, '');
      return fullName.includes(q) || uname.includes(q);
    });
  }, [usersList, searchQuery]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, title: '' }} />

      {/* USER NAME BAR WITH BACK BUTTON ON LEFT */}
      <View style={styles.userBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/profile');
            }
          }}
          activeOpacity={0.75}
        >
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </TouchableOpacity>

        <Text style={styles.userNameText} numberOfLines={1}>
          {userNameDisplay}
        </Text>
      </View>

      {/* Tabs With Counts */}
      <View style={styles.tabsBar}>
        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'followers' && styles.tabBtnActive,
          ]}
          onPress={() => handleSelectTab('followers')}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'followers' && styles.tabTextActive,
            ]}
            numberOfLines={1}
          >
            Followers ({formatCompactCount(followersCount)})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'following' && styles.tabBtnActive,
          ]}
          onPress={() => handleSelectTab('following')}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'following' && styles.tabTextActive,
            ]}
            numberOfLines={1}
          >
            Following ({formatCompactCount(followingCount)})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'subscriptions' && styles.tabBtnActive,
          ]}
          onPress={() => handleSelectTab('subscriptions')}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'subscriptions' && styles.tabTextActive,
            ]}
            numberOfLines={1}
          >
            Subscriptions ({formatCompactCount(subscriptionsCount)})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name or username..."
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
          />
          {Boolean(searchQuery) && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#059669" />
        </View>
      ) : filteredUsers.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>
            {searchQuery.trim()
              ? 'No matching users found.'
              : activeTab === 'followers'
                ? 'No followers found yet.'
                : activeTab === 'following'
                  ? 'Not following anyone yet.'
                  : 'No subscriptions found yet.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        >
          {filteredUsers.map((user) => {
            const alreadyFollowing = myFollowingIds.includes(user.id);
            const isSelf = user.id === loggedInUserId;

            return (
              <View key={user.id} style={styles.userRow}>
                <TouchableOpacity
                  style={styles.userMainTouch}
                  activeOpacity={0.75}
                  onPress={() =>
                    router.push({
                      pathname: '/profile',
                      params: { userId: user.id, fromConnect: '1' },
                    })
                  }
                >
                  <Image
                    source={{ uri: getResolvedAvatarUri(user.avatar_url, null) }}
                    style={styles.avatar}
                  />
                  <View style={styles.userInfo}>
                    <Text style={styles.userName} numberOfLines={1}>
                      {user.full_name || user.username || 'VibeSphere User'}
                    </Text>
                    {Boolean(user.username) && (
                      <Text style={styles.userHandle} numberOfLines={1}>
                        {normalizeHandle(user.username || '')}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>

                {!isSelf && (
                  <View style={styles.actionButtonsRow}>
                    {activeTab === 'followers' && (
                      <>
                        {!alreadyFollowing && (
                          <TouchableOpacity
                            style={styles.followBackBtn}
                            onPress={() => handleFollowBack(user.id)}
                            disabled={updatingFollowId === user.id}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.followBackText}>Follow Back</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.messageBtn}
                          onPress={() => handleMessageUser(user)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.messageBtnText}>Message</Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {activeTab === 'following' && (
                      <TouchableOpacity
                        style={styles.messageBtn}
                        onPress={() => handleMessageUser(user)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.messageBtnText}>Message</Text>
                      </TouchableOpacity>
                    )}

                    {activeTab === 'subscriptions' && (
                      <>
                        <TouchableOpacity
                          style={styles.analysisBtn}
                          onPress={() => setAnalysisUser(user)}
                          activeOpacity={0.8}
                        >
                          <Ionicons
                            name="analytics-outline"
                            size={14}
                            color="#059669"
                          />
                          <Text style={styles.analysisBtnText}>Analysis</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.messageBtn}
                          onPress={() => handleMessageUser(user)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.messageBtnText}>Message</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* SUBSCRIPTION ANALYSIS MODAL */}
      <Modal
        visible={Boolean(analysisUser)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setAnalysisUser(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.analysisCard}>
            <View style={styles.analysisHeader}>
              <Text style={styles.analysisTitle}>Subscription Analysis</Text>
              <TouchableOpacity onPress={() => setAnalysisUser(null)}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {analysisUser && (
              <>
                <Text style={styles.analysisCreatorName}>
                  {analysisUser.full_name || analysisUser.username || 'Creator'}
                </Text>
                {Boolean(analysisUser.username) && (
                  <Text style={styles.analysisCreatorHandle}>
                    {normalizeHandle(analysisUser.username || '')}
                  </Text>
                )}

                <View style={styles.analysisStatsBox}>
                  <View style={styles.analysisRow}>
                    <Text style={styles.analysisLabel}>Status</Text>
                    <Text style={styles.analysisValue}>
                      {String(analysisUser.status || 'Active').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.analysisRow}>
                    <Text style={styles.analysisLabel}>Plan</Text>
                    <Text style={styles.analysisValue}>
                      {analysisUser.plan_name || 'Standard'}
                    </Text>
                  </View>
                  <View style={styles.analysisRow}>
                    <Text style={styles.analysisLabel}>Started</Text>
                    <Text style={styles.analysisValue}>
                      {analysisUser.created_at
                        ? new Date(analysisUser.created_at).toLocaleDateString()
                        : '—'}
                    </Text>
                  </View>
                  <View style={[styles.analysisRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.analysisLabel}>Renewal / Expiry</Text>
                    <Text style={styles.analysisValue}>
                      {analysisUser.expires_at
                        ? new Date(analysisUser.expires_at).toLocaleDateString()
                        : '—'}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.analysisCloseBtn}
                  onPress={() => setAnalysisUser(null)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.analysisCloseText}>Done</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  userBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  userNameText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  tabsBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: '#059669',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#059669',
    fontWeight: '800',
  },
  searchContainer: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 24,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 8,
  },
  userMainTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e2e8f0',
  },
  userInfo: {
    flex: 1,
    marginLeft: 10,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  userHandle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  followBackBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#059669',
  },
  followBackText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  messageBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  messageBtnText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700',
  },
  analysisBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  analysisBtnText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  analysisCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  analysisTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  analysisCreatorName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  analysisCreatorHandle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },
  analysisStatsBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
  },
  analysisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  analysisLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  analysisValue: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '700',
  },
  analysisCloseBtn: {
    marginTop: 14,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  analysisCloseText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});