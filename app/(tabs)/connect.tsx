import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Alert,
  Switch,
  PanResponder,
  Animated,
  Modal,
  ScrollView,
  DeviceEventEmitter,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';

export const FOLLOWS_UPDATED_EVENT = 'follows-updated';

type ConnectTab = 'nearby' | 'requests' | 'explore';
type GenderFilter = 'all' | 'Male' | 'Female' | 'Other';
type AgeFilter = 'all' | 'under-18' | '18-24' | '25-34' | '35+';

interface FollowUser {
  id: string;
  full_name: string | null;
  username: string | null;
  city: string | null;
  country?: string | null;
  bio: string | null;
  gender?: string | null;
  age?: number | null;
  dob?: string | null;
  avatar_url: string | null;
  is_private?: boolean | null;
  distanceKm?: number;
}

interface FollowRequestItem {
  id: string;
  requester_id: string;
  profile: FollowUser;
}

const GENDER_OPTIONS: { value: GenderFilter; label: string }[] = [
  { value: 'all', label: 'All Genders' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

const AGE_OPTIONS: { value: AgeFilter; label: string }[] = [
  { value: 'all', label: 'All Ages' },
  { value: 'under-18', label: 'Below 18' },
  { value: '18-24', label: '18–24' },
  { value: '25-34', label: '25–34' },
  { value: '35+', label: '35+' },
];

const QUICK_SUGGESTED_LOCATIONS: string[] = [
  'Jaipur, India',
  'Jaisalmer, India',
  'Jalandhar, India',
  'New Delhi, India',
  'Mumbai, India',
  'Bengaluru, India',
  'Gurugram, India',
  'Hyderabad, India',
  'Pune, India',
  'Dubai, United Arab Emirates',
  'London, United Kingdom',
  'New York, United States',
];

const suggestionCache = new Map<string, string[]>();

const withTimeout = async <T,>(promise: Promise<T>, ms = 4500, fallback?: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback as T), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const detectCurrentCountryName = (): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz.includes('Kolkata') || tz.includes('Calcutta')) return 'India';
    if (tz.includes('Dubai')) return 'United Arab Emirates';
    if (tz.includes('London')) return 'United Kingdom';
    if (tz.includes('New_York') || tz.includes('Los_Angeles') || tz.includes('Chicago')) {
      return 'United States';
    }
    if (tz.includes('Singapore')) return 'Singapore';

    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const regionCode = locale.split('-')[1]?.toUpperCase();
    if (
      regionCode &&
      typeof Intl !== 'undefined' &&
      typeof (Intl as any).DisplayNames === 'function'
    ) {
      const regionNames = new (Intl as any).DisplayNames(['en'], { type: 'region' });
      const resolved = regionNames.of(regionCode);
      if (typeof resolved === 'string' && resolved.trim().length > 0) {
        return resolved.trim();
      }
    }
  } catch {
    // ignore locale resolution errors
  }
  return 'India';
};

const orderLocationsByCurrentCountry = (
  items: string[],
  currentCountry: string
): string[] => {
  const unique = Array.from(new Set(items.map((x) => x.trim()).filter(Boolean)));
  const currentLower = currentCountry.toLowerCase();

  const currentCountryItems: string[] = [];
  const otherCountryItems: string[] = [];

  for (const entry of unique) {
    const parts = entry.split(',');
    const countryPart = (parts[parts.length - 1] || '').trim().toLowerCase();
    if (
      countryPart === currentLower ||
      countryPart.includes(currentLower) ||
      (currentLower === 'india' && countryPart === 'india')
    ) {
      currentCountryItems.push(entry);
    } else {
      otherCountryItems.push(entry);
    }
  }

  currentCountryItems.sort((a, b) => a.localeCompare(b));
  otherCountryItems.sort((a, b) => a.localeCompare(b));

  return [...currentCountryItems, ...otherCountryItems];
};

const fetchSuggestedCitiesWithCountry = async (
  query: string,
  currentCountry: string
): Promise<string[]> => {
  const trimmed = query.trim();
  const cacheKey = `${currentCountry.toLowerCase()}::${trimmed.toLowerCase()}`;

  if (suggestionCache.has(cacheKey)) {
    return suggestionCache.get(cacheKey)!;
  }

  if (trimmed.length < 2) {
    const base = orderLocationsByCurrentCountry(QUICK_SUGGESTED_LOCATIONS, currentCountry);
    return base.slice(0, 12);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      trimmed
    )}&count=25&language=en&format=json`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      const results: { name?: string; country?: string; admin1?: string }[] = Array.isArray(
        json?.results
      )
        ? json.results
        : [];

      const formatted = results
        .map((r) => {
          const cityName = (r.name || '').trim();
          const countryName = (r.country || '').trim();
          if (!cityName) return '';
          return countryName ? `${cityName}, ${countryName}` : cityName;
        })
        .filter((item): item is string => item.length > 0);

      if (formatted.length > 0) {
        const ordered = orderLocationsByCurrentCountry(formatted, currentCountry);
        suggestionCache.set(cacheKey, ordered);
        return ordered;
      }
    }
  } catch {
    clearTimeout(timeoutId);
  }

  const fallbackMatches = QUICK_SUGGESTED_LOCATIONS.filter((loc) =>
    loc.toLowerCase().includes(trimmed.toLowerCase())
  );
  return orderLocationsByCurrentCountry(fallbackMatches, currentCountry);
};

const RADAR_KNOB_SIZE = 24;
const RADAR_MIN_KM = 1;
const RADAR_MAX_KM = 50;

const formatCityWithCountry = (
  city?: string | null,
  country?: string | null,
  defaultCountry = 'India'
): string => {
  const cleanCity = (city || '').trim();
  const cleanCountry = (country || '').trim();

  if (cleanCity && cleanCountry) {
    if (cleanCity.toLowerCase().includes(cleanCountry.toLowerCase())) {
      return cleanCity;
    }
    return `${cleanCity}, ${cleanCountry}`;
  }
  if (cleanCity) {
    return cleanCity.includes(',') ? cleanCity : `${cleanCity}, ${defaultCountry}`;
  }
  if (cleanCountry) {
    return cleanCountry;
  }
  return '';
};

const getApproxDistanceKm = (userId: string): number => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 1000;
  }
  return 1 + (hash % 49);
};

const resolveUserAge = (user: FollowUser): number | null => {
  if (typeof user.age === 'number' && user.age > 0) return user.age;
  if (user.dob) {
    const parsed = new Date(user.dob);
    if (!Number.isNaN(parsed.getTime())) {
      const today = new Date();
      let years = today.getFullYear() - parsed.getFullYear();
      const monthDiff = today.getMonth() - parsed.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) {
        years--;
      }
      if (years >= 1 && years <= 100) return years;
    }
  }
  return null;
};

const matchesAgeRange = (age: number | null, filter: AgeFilter): boolean => {
  if (filter === 'all') return true;
  if (age === null) return false;
  if (filter === 'under-18') return age < 18;
  if (filter === '18-24') return age >= 18 && age <= 24;
  if (filter === '25-34') return age >= 25 && age <= 34;
  if (filter === '35+') return age >= 35;
  return true;
};

const syncProfileFollowCounters = async (userId: string) => {
  try {
    const [{ count: followersCount }, { count: followingCount }] = await Promise.all([
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', userId)
        .or('status.eq.accepted,status.is.null'),
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', userId)
        .or('status.eq.accepted,status.is.null'),
    ]);

    if (typeof followersCount === 'number' && typeof followingCount === 'number') {
      await supabase
        .from('profiles')
        .update({
          followers_count: followersCount,
          following_count: followingCount,
        })
        .eq('id', userId);
    }
  } catch {
    // ignore if profiles columns or status filter differ
  }
};

export default function ConnectScreen() {
  const [currentCountry] = useState<string>(() => detectCurrentCountryName());
  const [suggestedCities, setSuggestedCities] = useState<string[]>(() =>
    orderLocationsByCurrentCountry(QUICK_SUGGESTED_LOCATIONS, currentCountry).slice(0, 12)
  );
  const [searchingCities, setSearchingCities] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ConnectTab>('nearby');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all');

  const [cityModalOpen, setCityModalOpen] = useState<boolean>(false);
  const [genderModalOpen, setGenderModalOpen] = useState<boolean>(false);
  const [ageModalOpen, setAgeModalOpen] = useState<boolean>(false);
  const [citySearchQuery, setCitySearchQuery] = useState<string>('');

  const [nearbyEnabled, setNearbyEnabled] = useState<boolean>(true);
  const [radarRadiusKm, setRadarRadiusKm] = useState<number>(25);
  const [trackWidthPx, setTrackWidthPx] = useState<number>(320);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<FollowUser[]>([]);
  const [followingIds, setFollowingIds] = useState<Record<string, boolean>>({});
  const [requestedIds, setRequestedIds] = useState<Record<string, boolean>>({});
  const [incomingRequests, setIncomingRequests] = useState<FollowRequestItem[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Record<string, boolean>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [initialSyncing, setInitialSyncing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const openUserProfile = useCallback((user: FollowUser) => {
    const cleanHandle = (user.username || '').replace(/^@/, '').trim();
    router.push({
      pathname: '/profile',
      params: {
        userId: user.id,
        ...(cleanHandle ? { username: cleanHandle } : {}),
      },
    } as any);
  }, []);

  const maxDragX = Math.max(1, trackWidthPx - RADAR_KNOB_SIZE);
  const maxDragXRef = useRef(maxDragX);
  maxDragXRef.current = maxDragX;

  const initialDragX = Math.round(
    ((25 - RADAR_MIN_KM) / (RADAR_MAX_KM - RADAR_MIN_KM)) * maxDragX
  );
  const knobX = useRef(new Animated.Value(initialDragX)).current;
  const knobOffsetX = useRef(initialDragX);
  const [fillWidthPx, setFillWidthPx] = useState<number>(initialDragX + RADAR_KNOB_SIZE / 2);

  const clampHorizontalDrag = (x: number) => Math.max(0, Math.min(maxDragXRef.current, x));

  const updateRadiusFromDragX = useCallback((x: number) => {
    const limit = maxDragXRef.current;
    const clamped = Math.max(0, Math.min(limit, x));
    const ratio = clamped / limit;
    const km = Math.max(
      RADAR_MIN_KM,
      Math.round(RADAR_MIN_KM + ratio * (RADAR_MAX_KM - RADAR_MIN_KM))
    );
    setRadarRadiusKm(km);
    setFillWidthPx(clamped + RADAR_KNOB_SIZE / 2);
  }, []);

  useEffect(() => {
    const ratio = (radarRadiusKm - RADAR_MIN_KM) / (RADAR_MAX_KM - RADAR_MIN_KM);
    const nextX = Math.round(ratio * maxDragX);
    knobOffsetX.current = nextX;
    knobX.setOffset(0);
    knobX.setValue(nextX);
    setFillWidthPx(nextX + RADAR_KNOB_SIZE / 2);
  }, [maxDragX]);

  const horizontalRadarPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        knobX.setOffset(knobOffsetX.current);
        knobX.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        const nextX = clampHorizontalDrag(knobOffsetX.current + gestureState.dx);
        knobX.setOffset(0);
        knobX.setValue(nextX);
        updateRadiusFromDragX(nextX);
      },
      onPanResponderRelease: (_, gestureState) => {
        const finalX = clampHorizontalDrag(knobOffsetX.current + gestureState.dx);
        knobOffsetX.current = finalX;
        knobX.setOffset(0);
        knobX.setValue(finalX);
        updateRadiusFromDragX(finalX);
      },
    })
  ).current;

  useEffect(() => {
    if (!cityModalOpen) return;

    const trimmed = citySearchQuery.trim();
    const profileMatches = allUsers
      .map((u) => formatCityWithCountry(u.city, u.country, currentCountry))
      .filter(
        (loc) => loc.length > 0 && (!trimmed || loc.toLowerCase().includes(trimmed.toLowerCase()))
      );

    if (trimmed.length < 2) {
      const quick = orderLocationsByCurrentCountry(
        [...profileMatches, ...QUICK_SUGGESTED_LOCATIONS],
        currentCountry
      ).slice(0, 12);
      setSuggestedCities(quick);
      setSearchingCities(false);
      return;
    }

    let active = true;
    setSearchingCities(true);
    const timer = setTimeout(async () => {
      try {
        const remoteSuggestions = await fetchSuggestedCitiesWithCountry(trimmed, currentCountry);
        if (active) {
          const merged = orderLocationsByCurrentCountry(
            [...profileMatches, ...remoteSuggestions],
            currentCountry
          );
          setSuggestedCities(merged);
        }
      } catch {
        if (active) {
          setSuggestedCities(orderLocationsByCurrentCountry(profileMatches, currentCountry));
        }
      } finally {
        if (active) setSearchingCities(false);
      }
    }, 280);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cityModalOpen, citySearchQuery, allUsers, currentCountry]);

  const loadFollowData = useCallback(async () => {
    try {
      const sessionRes = await withTimeout(
        supabase.auth.getSession(),
        4000,
        { data: { session: null } } as any
      );
      const myId = sessionRes?.data?.session?.user?.id ?? null;
      setCurrentUserId(myId);

      let profilesQuery = supabase
        .from('profiles')
        .select('id, full_name, username, city, country, bio, gender, avatar_url')
        .limit(60);

      if (myId) {
        profilesQuery = profilesQuery.neq('id', myId);
      }

      const profilesPromise = withTimeout(profilesQuery as any, 4500, { data: [], error: null } as any);

      const followsPromise = myId
        ? Promise.all([
            withTimeout(
              supabase.from('follows').select('following_id, status').eq('follower_id', myId) as any,
              4000,
              { data: [] } as any
            ),
            withTimeout(
              supabase
                .from('follows')
                .select('id, follower_id, status')
                .eq('following_id', myId)
                .eq('status', 'pending') as any,
              4000,
              { data: [] } as any
            ),
          ])
        : Promise.resolve([{ data: [] }, { data: [] }]);

      const [profilesRes, [outgoingRes, incomingRes]] = await Promise.all([
        profilesPromise,
        followsPromise,
      ]);

      let profilesData = profilesRes?.data;
      if (profilesRes?.error) {
        let fallbackQuery = supabase
          .from('profiles')
          .select('id, full_name, username, city, bio, avatar_url')
          .limit(60);
        if (myId) {
          fallbackQuery = fallbackQuery.neq('id', myId);
        }
        const fallbackRes = await withTimeout(fallbackQuery as any, 4500, { data: [] } as any);
        profilesData = fallbackRes?.data ?? [];
      }

      const profilesList: FollowUser[] = (Array.isArray(profilesData) ? profilesData : []).map(
        (p: FollowUser) => ({
          ...p,
          distanceKm: getApproxDistanceKm(p.id),
        })
      );

      setAllUsers(profilesList);

      if (myId) {
        const outgoingData = outgoingRes?.data;
        const nextFollowing: Record<string, boolean> = {};
        const nextRequested: Record<string, boolean> = {};

        (Array.isArray(outgoingData) ? outgoingData : []).forEach(
          (row: { following_id: string; status?: string | null }) => {
            if (row.status === 'pending') {
              nextRequested[row.following_id] = true;
            } else {
              nextFollowing[row.following_id] = true;
            }
          }
        );

        setFollowingIds(nextFollowing);
        setRequestedIds(nextRequested);

        const incomingData = incomingRes?.data;
        const profileMap = new Map<string, FollowUser>();
        profilesList.forEach((p) => profileMap.set(p.id, p));

        const formattedRequests: FollowRequestItem[] = (
          Array.isArray(incomingData) ? incomingData : []
        )
          .map((req: { id: string; follower_id: string }) => {
            const prof = profileMap.get(req.follower_id);
            if (!prof) return null;
            return {
              id: req.id,
              requester_id: req.follower_id,
              profile: prof,
            };
          })
          .filter(Boolean) as FollowRequestItem[];

        setIncomingRequests(formattedRequests);
      }
    } catch (err: any) {
      console.error('Discover People load error:', err?.message || err);
    } finally {
      setInitialSyncing(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFollowData();
  }, [loadFollowData]);

  const toggleCitySelection = (cityItem: string) => {
    const clean = cityItem.trim();
    if (!clean) return;
    setSelectedCities((prev) => {
      const exists = prev.some((c) => c.toLowerCase() === clean.toLowerCase());
      if (exists) {
        return prev.filter((c) => c.toLowerCase() !== clean.toLowerCase());
      }
      return [...prev, clean];
    });
  };

  const handleFollowToggle = async (targetUser: FollowUser) => {
    if (!currentUserId) {
      Alert.alert('Login Required', 'Please log in to follow users.');
      return;
    }

    const targetId = targetUser.id;
    const isFollowing = !!followingIds[targetId];
    const isRequested = !!requestedIds[targetId];

    try {
      if (isFollowing || isRequested) {
        setFollowingIds((prev) => ({ ...prev, [targetId]: false }));
        setRequestedIds((prev) => ({ ...prev, [targetId]: false }));

        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', currentUserId)
          .eq('following_id', targetId);

        if (error) throw error;

        await Promise.all([
          syncProfileFollowCounters(currentUserId),
          syncProfileFollowCounters(targetId),
        ]);

        DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
          followerId: currentUserId,
          followingId: targetId,
          status: 'removed',
        });
      } else {
        const nextStatus = targetUser?.is_private ? 'pending' : 'accepted';

        if (nextStatus === 'pending') {
          setRequestedIds((prev) => ({ ...prev, [targetId]: true }));
        } else {
          setFollowingIds((prev) => ({ ...prev, [targetId]: true }));
        }

        const { error } = await supabase
          .from('follows')
          .insert({
            follower_id: currentUserId,
            following_id: targetId,
            status: nextStatus,
          });

        let finalStatus = nextStatus;

        if (error && error.message?.toLowerCase().includes('status')) {
          const { error: fallbackError } = await supabase
            .from('follows')
            .insert({
              follower_id: currentUserId,
              following_id: targetId,
            });
          if (fallbackError) throw fallbackError;
          setRequestedIds((prev) => ({ ...prev, [targetId]: false }));
          setFollowingIds((prev) => ({ ...prev, [targetId]: true }));
          finalStatus = 'accepted';
        } else if (error) {
          throw error;
        }

        await Promise.all([
          syncProfileFollowCounters(currentUserId),
          syncProfileFollowCounters(targetId),
        ]);

        DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
          followerId: currentUserId,
          followingId: targetId,
          status: finalStatus,
        });
      }
    } catch (err: any) {
      Alert.alert('Action Failed', err?.message || 'Could not update follow status.');
      loadFollowData();
    }
  };

  const handleAcceptRequest = async (reqItem: FollowRequestItem) => {
    if (!currentUserId) return;
    setIncomingRequests((prev) => prev.filter((r) => r.id !== reqItem.id));

    const { error } = await supabase
      .from('follows')
      .update({ status: 'accepted' })
      .eq('id', reqItem.id);

    if (error) {
      Alert.alert('Error', error.message || 'Could not accept follow request.');
      loadFollowData();
      return;
    }

    await Promise.all([
      syncProfileFollowCounters(currentUserId),
      syncProfileFollowCounters(reqItem.requester_id),
    ]);

    DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
      followerId: reqItem.requester_id,
      followingId: currentUserId,
      status: 'accepted',
    });
  };

  const handleDeclineRequest = async (reqItem: FollowRequestItem) => {
    if (!currentUserId) return;
    setIncomingRequests((prev) => prev.filter((r) => r.id !== reqItem.id));

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('id', reqItem.id);

    if (error) {
      Alert.alert('Error', error.message || 'Could not decline follow request.');
      loadFollowData();
      return;
    }

    await Promise.all([
      syncProfileFollowCounters(currentUserId),
      syncProfileFollowCounters(reqItem.requester_id),
    ]);

    DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
      followerId: reqItem.requester_id,
      followingId: currentUserId,
      status: 'removed',
    });
  };

  const matchesCommonFilters = (user: FollowUser) => {
    const userLocation = formatCityWithCountry(user.city, user.country, currentCountry);
    const q = activeTab === 'nearby' ? '' : searchQuery.trim().toLowerCase();
    const matchesText =
      !q ||
      (user.full_name || '').toLowerCase().includes(q) ||
      (user.username || '').toLowerCase().includes(q) ||
      userLocation.toLowerCase().includes(q) ||
      (user.bio || '').toLowerCase().includes(q);

    if (!matchesText) return false;

    if (genderFilter !== 'all') {
      const userGender = (user.gender || '').trim().toLowerCase();
      if (userGender !== genderFilter.toLowerCase()) return false;
    }

    if (activeTab !== 'nearby' && selectedCities.length > 0) {
      const userLocLower = userLocation.toLowerCase();
      const userCityLower = (user.city || '').trim().toLowerCase();

      const matchesAnySelectedCity = selectedCities.some((sel) => {
        const selectedLower = sel.trim().toLowerCase();
        const cityPart = selectedLower.split(',')[0]?.trim() || selectedLower;
        return (
          userLocLower.includes(selectedLower) ||
          (userCityLower.length > 0 && userCityLower.includes(cityPart))
        );
      });

      if (!matchesAnySelectedCity) return false;
    }

    if (ageFilter !== 'all') {
      const resolvedAge = resolveUserAge(user);
      if (!matchesAgeRange(resolvedAge, ageFilter)) return false;
    }

    return true;
  };

  const nearbyDisplayList = !nearbyEnabled
    ? []
    : allUsers
        .filter((u) => {
          if (!matchesCommonFilters(u)) return false;
          const dist = u.distanceKm ?? 20;
          return dist <= radarRadiusKm;
        })
        .sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));

  const exploreSuggestions = allUsers.filter((u) => {
    if (dismissedSuggestions[u.id]) return false;
    if (followingIds[u.id] || requestedIds[u.id]) return false;
    return matchesCommonFilters(u);
  });

  const cityChipLabel =
    selectedCities.length === 0
      ? 'City'
      : selectedCities.length === 1
      ? selectedCities[0]
      : `${selectedCities.length} Cities`;

  const renderUserCard = ({
    item,
    showSuggestionBadge = false,
    showDistance = false,
  }: {
    item: FollowUser;
    showSuggestionBadge?: boolean;
    showDistance?: boolean;
  }) => {
    const isFollowing = !!followingIds[item.id];
    const isRequested = !!requestedIds[item.id];
    const isActiveState = isFollowing || isRequested;
    const displayName = item.full_name || 'VibeSphere User';
    const displayHandle = item.username
      ? (item.username.startsWith('@') ? item.username : `@${item.username}`)
      : '@user';
    const userAge = resolveUserAge(item);
    const locationLabel = formatCityWithCountry(item.city, item.country, currentCountry);

    const followButtonText = isFollowing ? 'Following' : isRequested ? 'Requested' : 'Follow';

    return (
      <View style={styles.cleanUserRow}>
        <TouchableOpacity
          style={styles.avatarRing}
          onPress={() => openUserProfile(item)}
          activeOpacity={0.8}
        >
          <Image
            source={{
              uri: item.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
            }}
            style={styles.avatar}
          />
        </TouchableOpacity>

        <View style={styles.userInfo}>
          <View style={styles.nameBadgeRow}>
            <TouchableOpacity
              style={{ flexShrink: 1 }}
              onPress={() => openUserProfile(item)}
              activeOpacity={0.75}
            >
              <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
            </TouchableOpacity>
            {showSuggestionBadge && (
              <View style={styles.suggestedPill}>
                <Text style={styles.suggestedPillText}>Suggested</Text>
              </View>
            )}
            {showDistance && typeof item.distanceKm === 'number' && (
              <View style={styles.distancePill}>
                <Text style={styles.distancePillText}>{item.distanceKm} km</Text>
              </View>
            )}
          </View>

          <Text style={styles.userHandle} numberOfLines={1}>
            {displayHandle}
            {locationLabel ? ` • ${locationLabel}` : ''}
            {item.gender ? ` • ${item.gender}` : ''}
            {userAge ? ` • ${userAge}y` : ''}
          </Text>

          {item.bio ? (
            <Text style={styles.userBio} numberOfLines={2}>{item.bio}</Text>
          ) : null}
        </View>

        <View style={styles.actionsColumn}>
          <TouchableOpacity
            style={[styles.followBtn, isActiveState && styles.followingBtn]}
            onPress={() => handleFollowToggle(item)}
            activeOpacity={0.8}
          >
            <Text style={[styles.followBtnText, isActiveState && styles.followingBtnText]}>
              {followButtonText}
            </Text>
          </TouchableOpacity>

          {showSuggestionBadge ? (
            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={() => setDismissedSuggestions((prev) => ({ ...prev, [item.id]: true }))}
              activeOpacity={0.75}
            >
              <Ionicons name="close" size={16} color="#64748b" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.msgBtn}
              onPress={() => router.push('/messages')}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#059669" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderRequestCard = ({ item }: { item: FollowRequestItem }) => {
    const prof = item.profile;
    const displayName = prof.full_name || 'VibeSphere User';
    const displayHandle = prof.username
      ? (prof.username.startsWith('@') ? prof.username : `@${prof.username}`)
      : '@user';

    return (
      <View style={styles.cleanUserRow}>
        <TouchableOpacity
          style={styles.avatarRing}
          onPress={() => openUserProfile(prof)}
          activeOpacity={0.8}
        >
          <Image
            source={{
              uri: prof.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
            }}
            style={styles.avatar}
          />
        </TouchableOpacity>

        <View style={styles.userInfo}>
          <TouchableOpacity onPress={() => openUserProfile(prof)} activeOpacity={0.75}>
            <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
          </TouchableOpacity>
          <Text style={styles.userHandle} numberOfLines={1}>{displayHandle}</Text>
          <Text style={styles.requestSub}>Requested to follow you</Text>
        </View>

        <View style={styles.requestActions}>
          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={() => handleAcceptRequest(item)}
            activeOpacity={0.8}
          >
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.declineBtn}
            onPress={() => handleDeclineRequest(item)}
            activeOpacity={0.8}
          >
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderInlineEmpty = (text: string) => {
    if (initialSyncing && allUsers.length === 0) {
      return (
        <View style={styles.inlineSyncBox}>
          <ActivityIndicator size="small" color="#059669" />
          <Text style={styles.inlineSyncText}>Loading people...</Text>
        </View>
      );
    }
    return <Text style={styles.emptyText}>{text}</Text>;
  };

  const showFilterRow =
    activeTab === 'explore' || (activeTab === 'nearby' && nearbyEnabled);

  return (
    <SafeAreaView style={styles.cleanScreen} edges={['top']}>
      {/* HEADER WITH NEARBY TOGGLE LEFT OF COUNT (ONLY IN NEARBY TAB) */}
      <View style={styles.header}>
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitle}>Discover People</Text>
          <Text style={styles.headerSubtitle}>
            {activeTab === 'nearby'
              ? (!nearbyEnabled
                  ? 'Nearby is turned off'
                  : `Range: up to ${radarRadiusKm} km`)
              : activeTab === 'requests'
              ? 'Manage incoming follow requests'
              : 'Suggested friends & creators'}
          </Text>
        </View>

        <View style={styles.headerRightGroup}>
          {activeTab === 'nearby' && (
            <View style={styles.headerNearbySwitchBox}>
              <Ionicons
                name="radio-outline"
                size={15}
                color={nearbyEnabled ? '#059669' : '#64748b'}
              />
              <Switch
                value={nearbyEnabled}
                onValueChange={setNearbyEnabled}
                trackColor={{ false: '#cbd5e1', true: '#a7f3d0' }}
                thumbColor={nearbyEnabled ? '#059669' : '#ffffff'}
                style={styles.miniSwitch}
              />
            </View>
          )}

          <View style={styles.headerStatPill}>
            <Ionicons name="people" size={14} color="#059669" />
            <Text style={styles.headerStatText}>{allUsers.length}</Text>
          </View>
        </View>
      </View>

      {/* 3 TABS: NEARBY | REQUESTS | EXPLORE */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'nearby' && styles.activeTabBtn]}
          onPress={() => setActiveTab('nearby')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="location-outline"
            size={15}
            color={activeTab === 'nearby' ? '#059669' : '#64748b'}
          />
          <Text style={[styles.tabText, activeTab === 'nearby' && styles.activeTabText]}>
            Nearby
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'requests' && styles.activeTabBtn]}
          onPress={() => setActiveTab('requests')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="person-add-outline"
            size={15}
            color={activeTab === 'requests' ? '#059669' : '#64748b'}
          />
          <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
            Requests
          </Text>
          {incomingRequests.length > 0 && (
            <View style={styles.reqBadge}>
              <Text style={styles.reqBadgeText}>{incomingRequests.length}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'explore' && styles.activeTabBtn]}
          onPress={() => setActiveTab('explore')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="compass-outline"
            size={16}
            color={activeTab === 'explore' ? '#059669' : '#64748b'}
          />
          <Text style={[styles.tabText, activeTab === 'explore' && styles.activeTabText]}>
            Explore
          </Text>
        </TouchableOpacity>
      </View>

      {/* EXPLORE SEARCH + CONDITIONAL FILTERS (NEARBY: ONLY WHEN TOGGLE ON & NO CITY; EXPLORE: GENDER | CITY | AGE) */}
      {(activeTab === 'explore' || showFilterRow) && (
        <View style={styles.controlsBlock}>
          {activeTab === 'explore' && (
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color="#64748b" />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search suggested friends & creators..."
                placeholderTextColor="#94a3b8"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={17} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {showFilterRow && (
            <View style={styles.singleLineFiltersRow}>
              <TouchableOpacity
                style={[styles.filterChip, genderFilter !== 'all' && styles.activeFilterChip]}
                onPress={() => setGenderModalOpen(true)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="person-outline"
                  size={12}
                  color={genderFilter !== 'all' ? '#059669' : '#64748b'}
                />
                <Text
                  style={[styles.filterChipText, genderFilter !== 'all' && styles.activeFilterChipText]}
                  numberOfLines={1}
                >
                  {genderFilter === 'all' ? 'Gender' : genderFilter}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={genderFilter !== 'all' ? '#059669' : '#94a3b8'}
                />
              </TouchableOpacity>

              {activeTab === 'explore' && (
                <TouchableOpacity
                  style={[styles.filterChip, selectedCities.length > 0 && styles.activeFilterChip]}
                  onPress={() => setCityModalOpen(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="location-outline"
                    size={12}
                    color={selectedCities.length > 0 ? '#059669' : '#64748b'}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      selectedCities.length > 0 && styles.activeFilterChipText,
                    ]}
                    numberOfLines={1}
                  >
                    {cityChipLabel}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={12}
                    color={selectedCities.length > 0 ? '#059669' : '#94a3b8'}
                  />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.filterChip, ageFilter !== 'all' && styles.activeFilterChip]}
                onPress={() => setAgeModalOpen(true)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="calendar-outline"
                  size={12}
                  color={ageFilter !== 'all' ? '#059669' : '#64748b'}
                />
                <Text
                  style={[styles.filterChipText, ageFilter !== 'all' && styles.activeFilterChipText]}
                  numberOfLines={1}
                >
                  {ageFilter === 'all'
                    ? 'Age'
                    : ageFilter === 'under-18'
                    ? 'Below 18'
                    : ageFilter}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={ageFilter !== 'all' ? '#059669' : '#94a3b8'}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* NEARBY TAB WITH FULL-WIDTH EDGE-TO-EDGE HORIZONTAL LINE RADAR (NO CARDS) */}
      {activeTab === 'nearby' && (
        <FlatList
          style={styles.cleanScreen}
          data={nearbyDisplayList}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            nearbyEnabled ? (
              <View style={styles.radarLineSection}>
                <View style={styles.radarTopRow}>
                  <View style={styles.radarLabelGroup}>
                    <Ionicons name="radio-outline" size={16} color="#059669" />
                    <Text style={styles.radarTitle}>Radar Range</Text>
                  </View>
                  <View style={styles.radiusBadge}>
                    <Text style={styles.radiusBadgeText}>{radarRadiusKm} km</Text>
                  </View>
                </View>

                <View
                  style={styles.horizontalTrackWrapper}
                  onLayout={(e) => {
                    const width = e.nativeEvent.layout.width;
                    if (width > RADAR_KNOB_SIZE) {
                      setTrackWidthPx(width);
                    }
                  }}
                >
                  <View style={styles.horizontalLineTrack}>
                    <View style={[styles.horizontalLineFill, { width: fillWidthPx }]} />
                    <Animated.View
                      {...horizontalRadarPanResponder.panHandlers}
                      style={[
                        styles.horizontalLineKnob,
                        { transform: [{ translateX: knobX }] },
                      ]}
                    >
                      <View style={styles.horizontalKnobInnerDot} />
                    </Animated.View>
                  </View>
                </View>

                <View style={styles.radarScaleRow}>
                  <Text style={styles.radarScaleText}>{RADAR_MIN_KM} km</Text>
                  <Text style={styles.radarCountText}>
                    {nearbyDisplayList.length} {nearbyDisplayList.length === 1 ? 'person' : 'people'}
                  </Text>
                  <Text style={styles.radarScaleText}>{RADAR_MAX_KM} km</Text>
                </View>
              </View>
            ) : (
              <View style={styles.radarOffCleanSection}>
                <Ionicons name="radio-outline" size={18} color="#64748b" />
                <Text style={styles.radarOffText}>
                  Nearby is OFF. Turn on the toggle next to the count badge to use the radar range.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) =>
            renderUserCard({ item, showSuggestionBadge: false, showDistance: true })
          }
          contentContainerStyle={styles.cleanListContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadFollowData();
              }}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            nearbyEnabled ? renderInlineEmpty(`No people found within ${radarRadiusKm} km.`) : null
          }
        />
      )}

      {/* REQUESTS TAB: CLEAN WHITE ROWS (NO CARDS) */}
      {activeTab === 'requests' && (
        <FlatList
          style={styles.cleanScreen}
          data={incomingRequests}
          keyExtractor={(item) => item.id}
          renderItem={renderRequestCard}
          contentContainerStyle={styles.cleanListContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadFollowData();
              }}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={renderInlineEmpty('No pending follow requests.')}
        />
      )}

      {/* EXPLORE TAB: CLEAN WHITE ROWS (NO CARDS) */}
      {activeTab === 'explore' && (
        <FlatList
          style={styles.cleanScreen}
          data={exploreSuggestions}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={styles.exploreCleanHeader}>
              <View style={styles.exploreBannerIcon}>
                <Ionicons name="sparkles" size={16} color="#059669" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.exploreSectionTitle}>Suggested for you</Text>
                <Text style={styles.exploreSectionSub}>People you may know on VibeSphere</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => renderUserCard({ item, showSuggestionBadge: true, showDistance: false })}
          contentContainerStyle={styles.cleanListContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadFollowData();
              }}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={renderInlineEmpty('No new friend suggestions right now.')}
        />
      )}

      {/* GENDER SELECTOR BOTTOM MODAL */}
      <Modal
        visible={genderModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGenderModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.optionSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Gender</Text>
              <TouchableOpacity onPress={() => setGenderModalOpen(false)}>
                <Ionicons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            {GENDER_OPTIONS.map((opt) => {
              const isSelected = genderFilter === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.cityItemRow, isSelected && styles.selectedCityRow]}
                  onPress={() => {
                    setGenderFilter(opt.value);
                    setGenderModalOpen(false);
                  }}
                >
                  <Text style={[styles.cityItemText, isSelected && styles.selectedCityText]}>
                    {opt.label}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color="#059669" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* MULTI-SELECT ALL CITIES + SEARCHABLE SUGGESTED CITIES WITH COUNTRY MODAL */}
      <Modal
        visible={cityModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCityModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.optionSheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Select Cities</Text>
                <Text style={styles.sheetSubHint}>
                  {selectedCities.length > 0
                    ? `${selectedCities.length} ${selectedCities.length === 1 ? 'city' : 'cities'} selected`
                    : `Select one or multiple cities (${currentCountry} first)`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setCityModalOpen(false)}>
                <Ionicons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            <View style={styles.sheetSearchBox}>
              <Ionicons name="search-outline" size={17} color="#64748b" />
              <TextInput
                style={styles.sheetSearchInput}
                value={citySearchQuery}
                onChangeText={setCitySearchQuery}
                placeholder="Type city e.g. Jai..."
                placeholderTextColor="#94a3b8"
              />
              {citySearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setCitySearchQuery('')}>
                  <Ionicons name="close-circle" size={17} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {/* SELECTED CITIES CHIPS BAR */}
            {selectedCities.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedChipsRow}
              >
                {selectedCities.map((sel) => (
                  <TouchableOpacity
                    key={sel}
                    style={styles.selectedCityTag}
                    onPress={() => toggleCitySelection(sel)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.selectedCityTagText}>{sel}</Text>
                    <Ionicons name="close" size={13} color="#059669" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* ALL CITIES OPTION ALWAYS AVAILABLE */}
            <TouchableOpacity
              style={[styles.cityItemRow, selectedCities.length === 0 && styles.selectedCityRow]}
              onPress={() => {
                setSelectedCities([]);
                setCitySearchQuery('');
              }}
            >
              <Text
                style={[
                  styles.cityItemText,
                  selectedCities.length === 0 && styles.selectedCityText,
                ]}
              >
                All Cities
              </Text>
              {selectedCities.length === 0 && (
                <Ionicons name="checkmark" size={18} color="#059669" />
              )}
            </TouchableOpacity>

            <View style={styles.suggestSectionHeaderRow}>
              <Text style={styles.suggestSectionLabel}>
                {searchingCities ? 'Finding suggestions...' : 'Suggested Cities (Tap to multi-select)'}
              </Text>
              {searchingCities && <ActivityIndicator size="small" color="#059669" />}
            </View>

            <FlatList
              data={suggestedCities}
              keyExtractor={(city, idx) => `${city}-${idx}`}
              style={{ maxHeight: 270 }}
              renderItem={({ item: city }) => {
                const isSelected = selectedCities.some(
                  (c) => c.toLowerCase() === city.toLowerCase()
                );
                return (
                  <TouchableOpacity
                    style={[styles.cityItemRow, isSelected && styles.selectedCityRow]}
                    onPress={() => toggleCitySelection(city)}
                  >
                    <Text style={[styles.cityItemText, isSelected && styles.selectedCityText]}>
                      {city}
                    </Text>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={isSelected ? '#059669' : '#94a3b8'}
                    />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyCityText}>
                  {searchingCities ? 'Searching matching cities...' : 'No suggested cities found.'}
                </Text>
              }
            />

            <TouchableOpacity
              style={styles.applyCitiesBtn}
              onPress={() => {
                setCitySearchQuery('');
                setCityModalOpen(false);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.applyCitiesBtnText}>
                {selectedCities.length > 0
                  ? `Apply (${selectedCities.length} ${selectedCities.length === 1 ? 'City' : 'Cities'})`
                  : 'Done (All Cities)'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AGE SELECTOR BOTTOM MODAL */}
      <Modal
        visible={ageModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAgeModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.optionSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Age Range</Text>
              <TouchableOpacity onPress={() => setAgeModalOpen(false)}>
                <Ionicons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            {AGE_OPTIONS.map((opt) => {
              const isSelected = ageFilter === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.cityItemRow, isSelected && styles.selectedCityRow]}
                  onPress={() => {
                    setAgeFilter(opt.value);
                    setAgeModalOpen(false);
                  }}
                >
                  <Text style={[styles.cityItemText, isSelected && styles.selectedCityText]}>
                    {opt.label}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color="#059669" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cleanScreen: { flex: 1, backgroundColor: '#ffffff' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitleCol: { flex: 1, marginRight: 10 },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#0f172a', letterSpacing: -0.2 },
  headerSubtitle: { fontSize: 12, color: '#64748b', marginTop: 1 },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerNearbySwitchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  headerStatText: { fontSize: 12, fontWeight: '800', color: '#059669' },
  miniSwitch: { transform: [{ scaleX: 0.78 }, { scaleY: 0.78 }] },

  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    gap: 5,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: { borderBottomColor: '#059669' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  activeTabText: { color: '#059669', fontWeight: '700' },
  reqBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },

  controlsBlock: { paddingTop: 10, paddingBottom: 8, gap: 8, backgroundColor: '#ffffff' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 14, color: '#0f172a' },

  singleLineFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    gap: 8,
  },
  filterChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  activeFilterChip: {
    backgroundColor: '#ecfdf5',
    borderColor: '#059669',
  },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#475569', flexShrink: 1 },
  activeFilterChipText: { color: '#059669', fontWeight: '700' },

  radarLineSection: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  radarTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  radarLabelGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  radarTitle: { fontSize: 13.5, fontWeight: '800', color: '#0f172a' },
  radiusBadge: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  radiusBadgeText: { fontSize: 11.5, fontWeight: '800', color: '#059669' },

  horizontalTrackWrapper: {
    width: '100%',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  horizontalLineTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    position: 'relative',
  },
  horizontalLineFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  horizontalLineKnob: {
    position: 'absolute',
    left: 0,
    width: RADAR_KNOB_SIZE,
    height: RADAR_KNOB_SIZE,
    borderRadius: RADAR_KNOB_SIZE / 2,
    backgroundColor: '#059669',
    borderWidth: 2.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  horizontalKnobInnerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },

  radarScaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  radarScaleText: { fontSize: 11, fontWeight: '600', color: '#94a3b8' },
  radarCountText: { fontSize: 11.5, fontWeight: '700', color: '#059669' },

  radarOffCleanSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  radarOffText: { flex: 1, fontSize: 12.5, color: '#64748b', lineHeight: 18 },

  exploreCleanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  exploreBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exploreSectionTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  exploreSectionSub: { fontSize: 12, color: '#64748b', marginTop: 1 },

  cleanListContent: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 100, backgroundColor: '#ffffff' },
  cleanUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  avatarRing: {
    padding: 2,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: '#d1fae5',
    marginRight: 12,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#e2e8f0' },
  userInfo: { flex: 1, marginRight: 8 },
  nameBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userName: { fontSize: 14, fontWeight: '700', color: '#0f172a', flexShrink: 1 },
  suggestedPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  suggestedPillText: { fontSize: 10, fontWeight: '700', color: '#059669' },
  distancePill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  distancePillText: { fontSize: 10, fontWeight: '700', color: '#475569' },
  userHandle: { fontSize: 12, color: '#64748b', marginTop: 1 },
  userBio: { fontSize: 12, color: '#475569', marginTop: 4, lineHeight: 16 },
  requestSub: { fontSize: 11.5, color: '#059669', fontWeight: '600', marginTop: 3 },

  actionsColumn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
  },
  followingBtn: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#059669',
  },
  followBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  followingBtnText: { color: '#059669' },
  msgBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  dismissBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  requestActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  acceptBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
  },
  acceptBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  declineBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  declineBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },

  inlineSyncBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 28,
  },
  inlineSyncText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#64748b', marginTop: 32, fontSize: 14 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  optionSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  sheetSubHint: { fontSize: 11.5, color: '#64748b', marginTop: 2 },
  sheetSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  sheetSearchInput: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontSize: 14,
    color: '#0f172a',
  },
  selectedChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
  },
  selectedCityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
  },
  selectedCityTagText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#059669',
  },
  suggestSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  suggestSectionLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cityItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  selectedCityRow: { backgroundColor: '#ecfdf5', borderRadius: 10 },
  cityItemText: { fontSize: 14, color: '#1e293b', fontWeight: '500', flex: 1, marginRight: 8 },
  selectedCityText: { color: '#059669', fontWeight: '700' },
  emptyCityText: { textAlign: 'center', color: '#64748b', paddingVertical: 20, fontSize: 13 },
  applyCitiesBtn: {
    marginTop: 12,
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyCitiesBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});