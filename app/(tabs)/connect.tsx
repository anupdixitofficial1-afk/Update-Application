import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  LayoutAnimation,
  Keyboard,
  Platform,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { backend } from '../../lib/backend';

export const FOLLOWS_UPDATED_EVENT = 'follows-updated';
const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
const RECENT_SEARCHES_KEY = 'connect_recent_searches_v1';

type ThemeMode = 'light' | 'dark' | 'system';
type ConnectTab = 'explore' | 'requests';
type GenderFilter = 'all' | 'Male' | 'Female' | 'Other';
type AgeFilter = 'all' | 'under-18' | '18-24' | '25-34' | '35+';
type SortMode = 'match' | 'nearest' | 'mutuals';

interface FollowUser {
  id: string;
  full_name: string | null;
  username: string | null;
  city: string | null;
  country?: string | null;
  bio?: string | null;
  gender?: string | null;
  age?: number | null;
  dob?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  avatar_url?: string | null;
  is_private?: boolean | null;
  distanceKm?: number;
  interests?: string[] | string | null;
  mutualCount?: number;
  vibeMatch?: number;
  intentTag?: string;
}

interface FollowRequestItem {
  id: string;
  requester_id: string;
  profile: FollowUser;
}

interface ToastState {
  message: string;
  undoUserId?: string;
}

const INTEREST_TOPICS: string[] = [
  'Travel',
  'Photography',
  'Tech',
  'Cricket',
  'Music',
  'Startups',
  'Fitness',
  'Books',
  'Art',
];

const INTENT_OPTIONS: string[] = [
  'Collab',
  'Travel Buddy',
  'Tech Talk',
  'Coffee',
];

const GENDER_OPTIONS: { value: GenderFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

const AGE_OPTIONS: { value: AgeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
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

const detectCurrentCountryName = (): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz.includes('Kolkata') || tz.includes('Calcutta')) return 'India';
    if (tz.includes('Dubai')) return 'United Arab Emirates';
    if (tz.includes('London')) return 'United Kingdom';
    if (
      tz.includes('New_York') ||
      tz.includes('Los_Angeles') ||
      tz.includes('Chicago')
    ) {
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
      const regionNames = new (Intl as any).DisplayNames(['en'], {
        type: 'region',
      });
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
  const unique = Array.from(
    new Set(items.map((x) => x.trim()).filter(Boolean))
  );
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
    const base = orderLocationsByCurrentCountry(
      QUICK_SUGGESTED_LOCATIONS,
      currentCountry
    );
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
      const results: { name?: string; country?: string; admin1?: string }[] =
        Array.isArray(json?.results) ? json.results : [];

      const formatted = results
        .map((r) => {
          const cityName = (r.name || '').trim();
          const countryName = (r.country || '').trim();
          if (!cityName) return '';
          return countryName ? `${cityName}, ${countryName}` : cityName;
        })
        .filter((item): item is string => item.length > 0);

      if (formatted.length > 0) {
        const ordered = orderLocationsByCurrentCountry(
          formatted,
          currentCountry
        );
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

const RADAR_KNOB_SIZE = 22;
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
    return cleanCity.includes(',')
      ? cleanCity
      : `${cleanCity}, ${defaultCountry}`;
  }
  if (cleanCountry) {
    return cleanCountry;
  }
  return '';
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % 10000;
  }
  return hash;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;

const calculateDistanceKm = (
  lat1?: number | null,
  lon1?: number | null,
  lat2?: number | null,
  lon2?: number | null
): number | null => {
  if (
    typeof lat1 !== 'number' ||
    typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lon2 !== 'number' ||
    Number.isNaN(lat1) ||
    Number.isNaN(lon1) ||
    Number.isNaN(lat2) ||
    Number.isNaN(lon2)
  ) {
    return null;
  }

  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = Math.round(earthRadiusKm * c);
  return Math.max(0, km);
};

const getFallbackDistanceKm = (userId: string): number => {
  return 1 + (hashString(userId) % 49);
};

const resolveUserInterests = (user: FollowUser): string[] => {
  if (Array.isArray(user.interests) && user.interests.length > 0) {
    return user.interests
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof user.interests === 'string' && user.interests.trim().length > 0) {
    return user.interests
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const bioLower = (user.bio || '').toLowerCase();
  const matched = INTEREST_TOPICS.filter((topic) =>
    bioLower.includes(topic.toLowerCase())
  );
  if (matched.length > 0) return matched.slice(0, 3);

  const seed = hashString(user.id);
  const first = INTEREST_TOPICS[seed % INTEREST_TOPICS.length];
  const second = INTEREST_TOPICS[(seed + 3) % INTEREST_TOPICS.length];
  return first === second ? [first] : [first, second];
};

const deriveMutualCount = (userId: string): number => {
  const seed = hashString(`${userId}-mutual`);
  return seed % 7;
};

const deriveVibeMatch = (userId: string, mutuals: number): number => {
  const base = 68 + (hashString(`${userId}-vibe`) % 28);
  return Math.min(99, base + Math.min(4, mutuals));
};

const deriveIntentTag = (userId: string): string => {
  return INTENT_OPTIONS[hashString(`${userId}-intent`) % INTENT_OPTIONS.length];
};

const resolveUserAge = (user: FollowUser): number | null => {
  if (typeof user.age === 'number' && user.age > 0) return user.age;
  if (user.dob) {
    const parsed = new Date(user.dob);
    if (!Number.isNaN(parsed.getTime())) {
      const today = new Date();
      let years = today.getFullYear() - parsed.getFullYear();
      const monthDiff = today.getMonth() - parsed.getMonth();
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < parsed.getDate())
      ) {
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

const normalizeToken = (value?: string | null): string =>
  (value || '').toLowerCase().replace(/^@+/, '').replace(/\s+/g, '');

const matchesSearchTerm = (user: FollowUser, rawTerm: string): boolean => {
  const qLower = rawTerm.trim().replace(/^@+/, '').toLowerCase();
  const qCompact = normalizeToken(rawTerm);
  if (!qLower && !qCompact) return true;

  const fullName = (user.full_name || '').toLowerCase();
  const fullNameCompact = normalizeToken(user.full_name);
  const username = (user.username || '').toLowerCase();
  const usernameCompact = normalizeToken(user.username);
  const city = (user.city || '').toLowerCase();
  const bio = (user.bio || '').toLowerCase();

  return (
    fullName.includes(qLower) ||
    fullNameCompact.includes(qCompact) ||
    username.includes(qLower) ||
    usernameCompact.includes(qCompact) ||
    city.includes(qLower) ||
    bio.includes(qLower)
  );
};

export default function ConnectScreen() {
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
      igBlue: '#0095f6',
      emerald: '#10b981',
      emeraldSoft: isDark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
      emeraldBorder: isDark ? 'rgba(16, 185, 129, 0.35)' : '#a7f3d0',
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

  const [currentCountry] = useState<string>(() => detectCurrentCountryName());
  const [suggestedCities, setSuggestedCities] = useState<string[]>(() =>
    orderLocationsByCurrentCountry(
      QUICK_SUGGESTED_LOCATIONS,
      currentCountry
    ).slice(0, 12)
  );
  const [searchingCities, setSearchingCities] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ConnectTab>('explore');
  const [sortMode, setSortMode] = useState<SortMode>('match');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [selectedIntent, setSelectedIntent] = useState<string>('all');
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all');

  const [filterSheetOpen, setFilterSheetOpen] = useState<boolean>(false);
  const [cityModalOpen, setCityModalOpen] = useState<boolean>(false);
  const [safetyUser, setSafetyUser] = useState<FollowUser | null>(null);
  const [quickPeekUser, setQuickPeekUser] = useState<FollowUser | null>(null);
  const [citySearchQuery, setCitySearchQuery] = useState<string>('');

  const [radarEnabled, setRadarEnabled] = useState<boolean>(false);
  const [ghostMode, setGhostMode] = useState<boolean>(false);
  const [radarRadiusKm, setRadarRadiusKm] = useState<number>(25);
  const [trackWidthPx, setTrackWidthPx] = useState<number>(340);

  const [wavedIds, setWavedIds] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [recentSearches, setRecentSearches] = useState<FollowUser[]>([]);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [myCoords, setMyCoords] = useState<{
    lat: number | null;
    lng: number | null;
  }>({ lat: null, lng: null });
  const [allUsers, setAllUsers] = useState<FollowUser[]>([]);
  const [remoteSearchUsers, setRemoteSearchUsers] = useState<FollowUser[]>([]);
  const [loadingSearch, setLoadingSearch] = useState<boolean>(false);
  const [followingIds, setFollowingIds] = useState<Record<string, boolean>>({});
  const [requestedIds, setRequestedIds] = useState<Record<string, boolean>>({});
  const [incomingRequests, setIncomingRequests] = useState<
    FollowRequestItem[]
  >([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<
    Record<string, boolean>
  >({});
  const [mutedUserIds, setMutedUserIds] = useState<Record<string, boolean>>({});
  const [blockedUserIds, setBlockedUserIds] = useState<Record<string, boolean>>(
    {}
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [initialSyncing, setInitialSyncing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setRecentSearches(parsed);
        }
      })
      .catch(() => {});
  }, []);

  const showToast = useCallback((next: ToastState) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const saveRecentSearch = useCallback((user: FollowUser) => {
    setRecentSearches((prev) => {
      const filtered = prev.filter((item) => item.id !== user.id);
      const next = [user, ...filtered].slice(0, 6);
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(
        () => {}
      );
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    AsyncStorage.removeItem(RECENT_SEARCHES_KEY).catch(() => {});
  }, []);

  const handleToggleRadar = useCallback((nextValue: boolean) => {
    setRadarEnabled(nextValue);
    if (nextValue) {
      setSearchQuery('');
      setRemoteSearchUsers([]);
      setSearchFocused(false);
      Keyboard.dismiss();
    }
  }, []);

  const openUserProfile = useCallback(
    (user: FollowUser, recordRecent = false) => {
      if (recordRecent) saveRecentSearch(user);
      const cleanHandle = (user.username || '').replace(/^@/, '').trim();
      setSearchFocused(false);
      setQuickPeekUser(null);
      Keyboard.dismiss();
      router.push({
        pathname: '/profile',
        params: {
          userId: user.id,
          ...(cleanHandle ? { username: cleanHandle } : {}),
          fromConnect: '1',
        },
      } as any);
    },
    [saveRecentSearch]
  );

  const handleSkipSuggestion = useCallback(
    (user: FollowUser) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setDismissedSuggestions((prev) => ({
        ...prev,
        [user.id]: true,
      }));
      showToast({
        message: `Hid ${user.full_name || 'suggestion'}`,
        undoUserId: user.id,
      });
    },
    [showToast]
  );

  const handleUndoHide = useCallback((userId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDismissedSuggestions((prev) => {
      const copy = { ...prev };
      delete copy[userId];
      return copy;
    });
    setToast(null);
  }, []);

  const handleWaveUser = useCallback(
    async (target: FollowUser) => {
      if (wavedIds[target.id]) return;
      setWavedIds((prev) => ({ ...prev, [target.id]: true }));
      showToast({
        message: `Waved 👋 at ${target.full_name || target.username || 'member'}!`,
      });

      if (currentUserId) {
        try {
          await backend.connect.sendWave(currentUserId, target.id);
        } catch {
          // ignore if notifications table schema differs
        }
      }
    },
    [wavedIds, currentUserId, showToast]
  );

  // Radar Slider Logic
  const maxDragX = Math.max(1, trackWidthPx - RADAR_KNOB_SIZE);
  const maxDragXRef = useRef(maxDragX);
  maxDragXRef.current = maxDragX;

  const initialDragX = Math.round(
    ((25 - RADAR_MIN_KM) / (RADAR_MAX_KM - RADAR_MIN_KM)) * maxDragX
  );
  const knobX = useRef(new Animated.Value(initialDragX)).current;
  const knobOffsetX = useRef(initialDragX);
  const [fillWidthPx, setFillWidthPx] = useState<number>(
    initialDragX + RADAR_KNOB_SIZE / 2
  );

  const clampHorizontalDrag = (x: number) =>
    Math.max(0, Math.min(maxDragXRef.current, x));

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
        (loc) =>
          loc.length > 0 &&
          (!trimmed || loc.toLowerCase().includes(trimmed.toLowerCase()))
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
        const remoteSuggestions = await fetchSuggestedCitiesWithCountry(
          trimmed,
          currentCountry
        );
        if (active) {
          const merged = orderLocationsByCurrentCountry(
            [...profileMatches, ...remoteSuggestions],
            currentCountry
          );
          setSuggestedCities(merged);
        }
      } catch {
        if (active) {
          setSuggestedCities(
            orderLocationsByCurrentCountry(profileMatches, currentCountry)
          );
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

  useEffect(() => {
    if (radarEnabled) {
      setRemoteSearchUsers([]);
      setLoadingSearch(false);
      return;
    }

    const cleaned = searchQuery.trim().replace(/^@+/, '');
    if (!cleaned) {
      setRemoteSearchUsers([]);
      setLoadingSearch(false);
      return;
    }

    let active = true;
    setLoadingSearch(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await backend.connect.getProfiles(
          currentUserId,
          `%${cleaned}%`
        );
        if (!active) return;

        const mapped: FollowUser[] = rows.map((p: FollowUser) => {
          const realKm = calculateDistanceKm(
            myCoords.lat,
            myCoords.lng,
            p.latitude,
            p.longitude
          );
          const mutuals = deriveMutualCount(p.id);
          return {
            ...p,
            distanceKm:
              typeof realKm === 'number'
                ? realKm
                : getFallbackDistanceKm(p.id),
            interests: resolveUserInterests(p),
            mutualCount: mutuals,
            vibeMatch: deriveVibeMatch(p.id, mutuals),
            intentTag: deriveIntentTag(p.id),
          };
        });

        setRemoteSearchUsers(mapped);
      } catch {
        if (active) setRemoteSearchUsers([]);
      } finally {
        if (active) setLoadingSearch(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, radarEnabled, currentUserId, myCoords.lat, myCoords.lng]);

  const loadFollowData = useCallback(async () => {
    try {
      const currentUser = await backend.auth.getCurrentUser().catch(() => null);
      const myId = currentUser?.id ?? null;
      setCurrentUserId(myId);

      const coords = myId
        ? await backend.connect.getMyCoordinates(myId).catch(() => ({
            lat: null,
            lng: null,
          }))
        : { lat: null, lng: null };
      setMyCoords(coords);

      const [profilesData, relations] = await Promise.all([
        backend.connect.getProfiles(myId),
        myId
          ? backend.connect.getRelations(myId)
          : Promise.resolve({
              followingIds: [] as string[],
              requestedIds: [] as string[],
              blockedIds: [] as string[],
              mutedIds: [] as string[],
              incomingRequests: [] as { id: string; follower_id: string }[],
            }),
      ]);

      const profilesList: FollowUser[] = profilesData.map((p: FollowUser) => {
        const realKm = calculateDistanceKm(
          coords.lat,
          coords.lng,
          p.latitude,
          p.longitude
        );
        const mutuals = deriveMutualCount(p.id);
        return {
          ...p,
          distanceKm:
            typeof realKm === 'number' ? realKm : getFallbackDistanceKm(p.id),
          interests: resolveUserInterests(p),
          mutualCount: mutuals,
          vibeMatch: deriveVibeMatch(p.id, mutuals),
          intentTag: deriveIntentTag(p.id),
        };
      });

      setAllUsers(profilesList);

      if (myId) {
        const nextFollowing: Record<string, boolean> = {};
        relations.followingIds.forEach((id) => {
          nextFollowing[id] = true;
        });
        setFollowingIds(nextFollowing);

        const nextRequested: Record<string, boolean> = {};
        relations.requestedIds.forEach((id) => {
          nextRequested[id] = true;
        });
        setRequestedIds(nextRequested);

        const nextBlocked: Record<string, boolean> = {};
        relations.blockedIds.forEach((id) => {
          nextBlocked[id] = true;
        });
        setBlockedUserIds(nextBlocked);

        const nextMuted: Record<string, boolean> = {};
        relations.mutedIds.forEach((id) => {
          nextMuted[id] = true;
        });
        setMutedUserIds(nextMuted);

        const profileMap = new Map<string, FollowUser>();
        profilesList.forEach((p) => profileMap.set(p.id, p));

        const formattedRequests: FollowRequestItem[] = relations.incomingRequests
          .map((req) => {
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
      console.error('Connect screen load error:', err?.message || err);
    } finally {
      setInitialSyncing(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFollowData();

    const eventSub = DeviceEventEmitter.addListener(
      FOLLOWS_UPDATED_EVENT,
      () => {
        void loadFollowData();
      }
    );

    return () => {
      eventSub.remove();
    };
  }, [loadFollowData]);

  useFocusEffect(
    useCallback(() => {
      void loadFollowData();
    }, [loadFollowData])
  );

  // Realtime follow updates via backend adapter
  useEffect(() => {
    if (!currentUserId) return;
    const unsubscribe = backend.connect.subscribeFollowChanges(
      currentUserId,
      () => {
        void loadFollowData();
      }
    );
    return () => {
      unsubscribe();
    };
  }, [currentUserId, loadFollowData]);

  const toggleCitySelection = (cityItem: string) => {
    const clean = cityItem.trim();
    if (!clean) return;
    setSelectedCities((prev) => {
      const exists = prev.some(
        (c) => c.toLowerCase() === clean.toLowerCase()
      );
      if (exists) {
        return prev.filter((c) => c.toLowerCase() !== clean.toLowerCase());
      }
      return [...prev, clean];
    });
  };

  const handleFollowToggle = async (targetUser: FollowUser) => {
    if (!currentUserId) {
      Alert.alert('Login Required', 'Please log in to follow members.');
      return;
    }

    const targetId = targetUser.id;
    const isFollowing = !!followingIds[targetId];
    const isRequested = !!requestedIds[targetId];

    try {
      if (isFollowing || isRequested) {
        setFollowingIds((prev) => ({ ...prev, [targetId]: false }));
        setRequestedIds((prev) => ({ ...prev, [targetId]: false }));

        await backend.connect.unfollowUser(currentUserId, targetId);

        DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
          followerId: currentUserId,
          followingId: targetId,
          status: 'removed',
        });
      } else {
        const isPrivate = Boolean(targetUser?.is_private);
        if (isPrivate) {
          setRequestedIds((prev) => ({ ...prev, [targetId]: true }));
        } else {
          setFollowingIds((prev) => ({ ...prev, [targetId]: true }));
        }

        const finalStatus = await backend.connect.followUser(
          currentUserId,
          targetId,
          isPrivate
        );

        if (finalStatus === 'accepted') {
          setRequestedIds((prev) => ({ ...prev, [targetId]: false }));
          setFollowingIds((prev) => ({ ...prev, [targetId]: true }));
        }

        DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
          followerId: currentUserId,
          followingId: targetId,
          status: finalStatus,
        });
      }
    } catch (err: any) {
      Alert.alert(
        'Action Failed',
        err?.message || 'Could not update follow status.'
      );
      void loadFollowData();
    }
  };

  const handleAcceptRequest = async (reqItem: FollowRequestItem) => {
    if (!currentUserId) return;
    setIncomingRequests((prev) => prev.filter((r) => r.id !== reqItem.id));

    try {
      await backend.connect.acceptFollowRequest(
        reqItem.id,
        currentUserId,
        reqItem.requester_id
      );

      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
        followerId: reqItem.requester_id,
        followingId: currentUserId,
        status: 'accepted',
      });
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.message || 'Could not accept follow request.'
      );
      void loadFollowData();
    }
  };

  const handleAcceptAllRequests = async () => {
    if (!currentUserId || visibleRequests.length === 0) return;
    const toAccept = [...visibleRequests];
    setIncomingRequests([]);
    showToast({ message: `Accepted ${toAccept.length} requests` });

    try {
      const ids = toAccept.map((r) => r.id);
      await backend.connect.acceptAllFollowRequests(ids, currentUserId);
      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, { status: 'accepted' });
    } catch {
      void loadFollowData();
    }
  };

  const handleDeclineRequest = async (reqItem: FollowRequestItem) => {
    if (!currentUserId) return;
    setIncomingRequests((prev) => prev.filter((r) => r.id !== reqItem.id));

    try {
      await backend.connect.declineFollowRequest(
        reqItem.id,
        currentUserId,
        reqItem.requester_id
      );

      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
        followerId: reqItem.requester_id,
        followingId: currentUserId,
        status: 'removed',
      });
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.message || 'Could not decline follow request.'
      );
      void loadFollowData();
    }
  };

  const handleToggleMuteUser = async (target: FollowUser) => {
    const nextMuted = !mutedUserIds[target.id];
    setMutedUserIds((prev) => ({ ...prev, [target.id]: nextMuted }));
    setSafetyUser(null);

    if (currentUserId) {
      try {
        await backend.connect.setUserMuted(currentUserId, target.id, nextMuted);
      } catch {
        // fallback stays applied in local state
      }
    }

    showToast({
      message: nextMuted
        ? `Muted ${target.full_name || 'member'}`
        : `Unmuted ${target.full_name || 'member'}`,
    });
  };

  const handleBlockUser = async (target: FollowUser) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBlockedUserIds((prev) => ({ ...prev, [target.id]: true }));
    setFollowingIds((prev) => ({ ...prev, [target.id]: false }));
    setRequestedIds((prev) => ({ ...prev, [target.id]: false }));
    setSafetyUser(null);
    setQuickPeekUser(null);

    if (currentUserId) {
      try {
        await backend.connect.blockAndUnfollow(currentUserId, target.id);
        DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
          followerId: currentUserId,
          followingId: target.id,
          status: 'blocked',
        });
      } catch {
        // fallback stays applied in local state
      }
    }

    showToast({ message: `Blocked ${target.full_name || 'member'}` });
  };

  const resetActiveFilters = () => {
    setSearchQuery('');
    setRemoteSearchUsers([]);
    setSearchFocused(false);
    setGenderFilter('all');
    setSelectedCities([]);
    setSelectedTopic('all');
    setSelectedIntent('all');
    setAgeFilter('all');
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedIntent !== 'all') count++;
    if (selectedTopic !== 'all') count++;
    if (selectedCities.length > 0) count++;
    if (genderFilter !== 'all') count++;
    if (ageFilter !== 'all') count++;
    return count;
  }, [selectedIntent, selectedTopic, selectedCities, genderFilter, ageFilter]);

  const combinedUsersPool = useMemo(() => {
    const map = new Map<string, FollowUser>();
    allUsers.forEach((u) => {
      if (u?.id && !blockedUserIds[u.id]) {
        map.set(u.id, u);
      }
    });
    remoteSearchUsers.forEach((u) => {
      if (u?.id && !blockedUserIds[u.id] && !map.has(u.id)) {
        map.set(u.id, u);
      }
    });
    return Array.from(map.values());
  }, [allUsers, remoteSearchUsers, blockedUserIds]);

  const hasActiveSearchQuery = !radarEnabled && searchQuery.trim().length > 0;

  const searchSuggestions = useMemo(() => {
    if (radarEnabled) return [];
    const trimmed = searchQuery.trim();
    if (!trimmed) return [];

    return combinedUsersPool.filter((u) => {
      if (blockedUserIds[u.id]) return false;
      return matchesSearchTerm(u, trimmed);
    });
  }, [combinedUsersPool, blockedUserIds, searchQuery, radarEnabled]);

  const showRecentSearchesDropdown =
    activeTab === 'explore' &&
    !radarEnabled &&
    searchFocused &&
    !hasActiveSearchQuery &&
    recentSearches.length > 0;

  const showSearchSuggestionBox =
    activeTab === 'explore' && !radarEnabled && hasActiveSearchQuery;

  const matchesExploreFilters = (user: FollowUser) => {
    if (blockedUserIds[user.id]) return false;

    const userLocation = formatCityWithCountry(
      user.city,
      user.country,
      currentCountry
    );
    const interests = resolveUserInterests(user);

    const q = !radarEnabled ? searchQuery.trim() : '';
    const matchesText =
      !q ||
      matchesSearchTerm(user, q) ||
      userLocation.toLowerCase().includes(q.toLowerCase()) ||
      interests.some((t) => t.toLowerCase().includes(q.toLowerCase()));

    if (!matchesText) return false;

    if (selectedTopic !== 'all') {
      const hasTopic = interests.some(
        (t) => t.toLowerCase() === selectedTopic.toLowerCase()
      );
      if (!hasTopic) return false;
    }

    if (selectedIntent !== 'all') {
      const userIntent = user.intentTag || deriveIntentTag(user.id);
      if (userIntent.toLowerCase() !== selectedIntent.toLowerCase()) {
        return false;
      }
    }

    if (genderFilter !== 'all') {
      const userGender = (user.gender || '').trim().toLowerCase();
      if (userGender !== genderFilter.toLowerCase()) return false;
    }

    if (selectedCities.length > 0) {
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

    if (radarEnabled) {
      const dist =
        typeof user.distanceKm === 'number'
          ? user.distanceKm
          : (calculateDistanceKm(
                myCoords.lat,
                myCoords.lng,
                user.latitude,
                user.longitude
              ) ?? 20);
      if (dist > radarRadiusKm) return false;
    }

    return true;
  };

  const exploreProfiles = useMemo(() => {
    return combinedUsersPool
      .filter((u) => {
        if (blockedUserIds[u.id]) return false;
        if (!hasActiveSearchQuery && !radarEnabled && dismissedSuggestions[u.id]) {
          return false;
        }
        if (
          !hasActiveSearchQuery &&
          (followingIds[u.id] || requestedIds[u.id])
        ) {
          return false;
        }
        return matchesExploreFilters(u);
      })
      .sort((a, b) => {
        const aMuted = mutedUserIds[a.id] ? 1 : 0;
        const bMuted = mutedUserIds[b.id] ? 1 : 0;
        if (aMuted !== bMuted) return aMuted - bMuted;

        if (radarEnabled || sortMode === 'nearest') {
          return (a.distanceKm ?? 99) - (b.distanceKm ?? 99);
        }
        if (sortMode === 'mutuals') {
          return (b.mutualCount ?? 0) - (a.mutualCount ?? 0);
        }
        return (b.vibeMatch ?? 0) - (a.vibeMatch ?? 0);
      });
  }, [
    combinedUsersPool,
    blockedUserIds,
    hasActiveSearchQuery,
    radarEnabled,
    dismissedSuggestions,
    followingIds,
    requestedIds,
    mutedUserIds,
    sortMode,
    searchQuery,
    selectedTopic,
    selectedIntent,
    genderFilter,
    selectedCities,
    ageFilter,
    radarRadiusKm,
  ]);

  const activeNearbyStoryUsers = useMemo(() => {
    return [...exploreProfiles]
      .sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99))
      .slice(0, 10);
  }, [exploreProfiles]);

  const visibleRequests = incomingRequests.filter(
    (req) => !blockedUserIds[req.requester_id]
  );

  const handleSurpriseMe = useCallback(() => {
    if (exploreProfiles.length === 0) {
      showToast({ message: 'No profiles available to shuffle right now.' });
      return;
    }
    const topPool = exploreProfiles.slice(0, Math.min(8, exploreProfiles.length));
    const pick = topPool[Math.floor(Math.random() * topPool.length)];
    if (pick) {
      setQuickPeekUser(pick);
    }
  }, [exploreProfiles, showToast]);

  const hasAnyActiveFilter =
    activeFilterCount > 0 || (!radarEnabled && searchQuery.trim().length > 0);

  const bottomNavClearance = Math.max(insets.bottom, 16) + 96;

  const renderUserCard = ({ item }: { item: FollowUser }) => {
    const isFollowing = !!followingIds[item.id];
    const isRequested = !!requestedIds[item.id];
    const isActiveState = isFollowing || isRequested;
    const isMuted = !!mutedUserIds[item.id];
    const isWaved = !!wavedIds[item.id];

    const displayName = item.full_name || 'VibeSphere Member';
    const displayHandle = item.username
      ? item.username.startsWith('@')
        ? item.username
        : `@${item.username}`
      : '@member';
    const interests = resolveUserInterests(item).slice(0, 2);
    const vibeMatch = item.vibeMatch ?? 82;
    const mutualCount = item.mutualCount ?? 0;

    const followButtonText = isFollowing
      ? 'Following'
      : isRequested
        ? 'Requested'
        : 'Follow';

    return (
      <View
        style={[
          styles.personRow,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={() => openUserProfile(item)}
          activeOpacity={0.82}
        >
          <Image
            source={{
              uri:
                item.avatar_url ||
                'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
            }}
            style={[
              styles.avatar,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
              },
            ]}
          />
          {radarEnabled && typeof item.distanceKm === 'number' && (
            <View
              style={[
                styles.avatarDistanceBadge,
                { backgroundColor: colors.accent },
              ]}
            >
              <Text
                style={[
                  styles.avatarDistanceText,
                  { color: colors.accentText },
                ]}
              >
                {item.distanceKm}km
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.userInfo}
          onPress={() => setQuickPeekUser(item)}
          activeOpacity={0.75}
        >
          <View style={styles.nameBadgeRow}>
            <Text
              style={[styles.userName, { color: colors.text }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <View
              style={[
                styles.matchPill,
                { backgroundColor: colors.emeraldSoft },
              ]}
            >
              <Text style={styles.matchPillText}>{vibeMatch}%</Text>
            </View>
          </View>

          <Text
            style={[styles.userHandle, { color: colors.subtext }]}
            numberOfLines={1}
          >
            {displayHandle}
            {mutualCount > 0 ? ` · ${mutualCount} mutual` : ''}
          </Text>

          <View style={styles.tagsRow}>
            {interests.map((tag) => (
              <View
                key={tag}
                style={[styles.miniTag, { backgroundColor: colors.surface }]}
              >
                <Text style={[styles.miniTagText, { color: colors.subtext }]}>
                  #{tag}
                </Text>
              </View>
            ))}
            {isMuted && (
              <Text style={[styles.mutedNote, { color: colors.subtext }]}>
                Muted
              </Text>
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.actionsColumn}>
          <TouchableOpacity
            style={[
              styles.waveBtn,
              { backgroundColor: colors.surface },
              isWaved && { backgroundColor: colors.emeraldSoft },
            ]}
            onPress={() => void handleWaveUser(item)}
            activeOpacity={0.75}
          >
            <Text style={styles.waveEmoji}>{isWaved ? '✓' : '👋'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.followBtn,
              { backgroundColor: colors.igBlue },
              isActiveState && { backgroundColor: colors.surface },
            ]}
            onPress={() => void handleFollowToggle(item)}
            activeOpacity={0.82}
          >
            <Text
              style={[
                styles.followBtnText,
                isActiveState && { color: colors.text },
              ]}
            >
              {followButtonText}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.moreDotsBtn}
            onPress={() => setSafetyUser(item)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
          >
            <Ionicons
              name="ellipsis-vertical"
              size={15}
              color={colors.subtext}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderRequestCard = ({ item }: { item: FollowRequestItem }) => {
    const prof = item.profile;
    const displayName = prof.full_name || 'VibeSphere Member';
    const displayHandle = prof.username
      ? prof.username.startsWith('@')
        ? prof.username
        : `@${prof.username}`
      : '@member';

    return (
      <View
        style={[
          styles.personRow,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={() => openUserProfile(prof)}
          activeOpacity={0.82}
        >
          <Image
            source={{
              uri:
                prof.avatar_url ||
                'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
            }}
            style={[
              styles.avatar,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
              },
            ]}
          />
        </TouchableOpacity>

        <View style={styles.userInfo}>
          <TouchableOpacity
            onPress={() => openUserProfile(prof)}
            activeOpacity={0.75}
          >
            <Text
              style={[styles.userName, { color: colors.text }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
          </TouchableOpacity>
          <Text
            style={[styles.userHandle, { color: colors.subtext }]}
            numberOfLines={1}
          >
            {displayHandle}
          </Text>
          <Text style={[styles.requestSub, { color: colors.igBlue }]}>
            Requested to follow you
          </Text>
        </View>

        <View style={styles.requestActions}>
          <TouchableOpacity
            style={[styles.acceptBtn, { backgroundColor: colors.igBlue }]}
            onPress={() => void handleAcceptRequest(item)}
            activeOpacity={0.82}
          >
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.declineBtn, { backgroundColor: colors.surface }]}
            onPress={() => void handleDeclineRequest(item)}
            activeOpacity={0.82}
          >
            <Text style={[styles.declineBtnText, { color: colors.text }]}>
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderInlineEmpty = (text: string) => {
    if (initialSyncing && allUsers.length === 0) {
      return (
        <View style={styles.inlineSyncBox}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text style={[styles.inlineSyncText, { color: colors.subtext }]}>
            Loading people...
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyBox}>
        <View
          style={[styles.emptyIconCircle, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="people-outline" size={26} color={colors.subtext} />
        </View>
        <Text style={[styles.emptyText, { color: colors.subtext }]}>{text}</Text>
        {hasAnyActiveFilter && (
          <TouchableOpacity
            style={[
              styles.resetFilterBtn,
              { backgroundColor: colors.accent },
            ]}
            onPress={resetActiveFilters}
            activeOpacity={0.82}
          >
            <Text
              style={[styles.resetFilterBtnText, { color: colors.accentText }]}
            >
              Clear Filters
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      {/* EDGE-TO-EDGE HEADER */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <View style={styles.headerTitleCol}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Connect
          </Text>
        </View>

        <View style={styles.headerRightGroup}>
          {activeTab === 'explore' && (
            <>
              <TouchableOpacity
                style={[
                  styles.shuffleHeaderBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={handleSurpriseMe}
                activeOpacity={0.8}
              >
                <Ionicons name="dice-outline" size={16} color={colors.text} />
                <Text style={[styles.shuffleText, { color: colors.text }]}>
                  Shuffle
                </Text>
              </TouchableOpacity>

              <View
                style={[
                  styles.radarRoundToggle,
                  radarEnabled
                    ? {
                        backgroundColor: colors.emeraldSoft,
                        borderColor: colors.emeraldBorder,
                      }
                    : {
                        backgroundColor: colors.surface,
                        borderColor: colors.borderStrong,
                      },
                ]}
              >
                <Ionicons
                  name="radio-outline"
                  size={15}
                  color={radarEnabled ? colors.emerald : colors.subtext}
                />
                <Switch
                  value={radarEnabled}
                  onValueChange={handleToggleRadar}
                  trackColor={{
                    false: isDark ? '#3f3f46' : '#d4d4d8',
                    true: '#a7f3d0',
                  }}
                  thumbColor={radarEnabled ? '#10b981' : '#ffffff'}
                  style={styles.miniSwitch}
                />
              </View>
            </>
          )}
        </View>
      </View>

      {/* EDGE-TO-EDGE UNDERLINE TABS */}
      <View
        style={[
          styles.underlineTabsBar,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.underlineTabItem,
            activeTab === 'explore' && { borderBottomColor: colors.text },
          ]}
          onPress={() => setActiveTab('explore')}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.underlineTabText,
              {
                color: activeTab === 'explore' ? colors.text : colors.subtext,
              },
              activeTab === 'explore' && { fontWeight: '800' },
            ]}
          >
            Explore
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.underlineTabItem,
            activeTab === 'requests' && { borderBottomColor: colors.text },
          ]}
          onPress={() => {
            setActiveTab('requests');
            setSearchFocused(false);
          }}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.underlineTabText,
              {
                color: activeTab === 'requests' ? colors.text : colors.subtext,
              },
              activeTab === 'requests' && { fontWeight: '800' },
            ]}
          >
            Requests
          </Text>
          {visibleRequests.length > 0 && (
            <View style={styles.reqBadge}>
              <Text style={styles.reqBadgeText}>{visibleRequests.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* SEARCH BAR + SINGLE FILTER ICON */}
      {activeTab === 'explore' && !radarEnabled && (
        <View
          style={[
            styles.controlsBlock,
            { backgroundColor: colors.bg, borderBottomColor: colors.border },
          ]}
        >
          <View style={styles.searchFilterRow}>
            <View
              style={[styles.igSearchBar, { backgroundColor: colors.surface }]}
            >
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.subtext}
              />
              <TextInput
                style={[styles.igSearchInput, { color: colors.text }]}
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  setSearchFocused(true);
                }}
                onFocus={() => setSearchFocused(true)}
                placeholder="Search people, handles, cities..."
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {loadingSearch && (
                <ActivityIndicator size="small" color={colors.subtext} />
              )}
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setSearchQuery('');
                    setRemoteSearchUsers([]);
                  }}
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.subtext}
                  />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.filterIconBtn,
                {
                  backgroundColor:
                    activeFilterCount > 0 ? colors.accent : colors.surface,
                },
              ]}
              onPress={() => {
                Keyboard.dismiss();
                setSearchFocused(false);
                setFilterSheetOpen(true);
              }}
              activeOpacity={0.82}
              accessibilityLabel="Open filters"
            >
              <Ionicons
                name="options-outline"
                size={20}
                color={
                  activeFilterCount > 0 ? colors.accentText : colors.text
                }
              />
              {activeFilterCount > 0 && (
                <View style={styles.filterCountDot}>
                  <Text style={styles.filterCountText}>
                    {activeFilterCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {showRecentSearchesDropdown && (
            <View
              style={[
                styles.edgeDropdown,
                {
                  backgroundColor: colors.bg,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={styles.recentHeaderRow}>
                <Text style={[styles.recentTitle, { color: colors.subtext }]}>
                  Recent
                </Text>
                <TouchableOpacity onPress={clearRecentSearches}>
                  <Text style={[styles.clearAllText, { color: colors.igBlue }]}>
                    Clear all
                  </Text>
                </TouchableOpacity>
              </View>
              {recentSearches.map((person) => (
                <TouchableOpacity
                  key={person.id}
                  style={styles.igSuggestionRow}
                  onPress={() => openUserProfile(person, true)}
                >
                  <Image
                    source={{
                      uri:
                        person.avatar_url ||
                        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
                    }}
                    style={[
                      styles.igSuggestionAvatar,
                      { backgroundColor: colors.surface },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.igSuggestionUsername,
                        { color: colors.text },
                      ]}
                      numberOfLines={1}
                    >
                      {person.full_name || person.username || 'Member'}
                    </Text>
                    <Text
                      style={[
                        styles.igSuggestionSubtitle,
                        { color: colors.subtext },
                      ]}
                      numberOfLines={1}
                    >
                      {person.username || '@member'}
                    </Text>
                  </View>
                  <Ionicons
                    name="arrow-up-outline"
                    size={16}
                    color={colors.subtext}
                    style={{ transform: [{ rotate: '45deg' }] }}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {showSearchSuggestionBox && (
            <View
              style={[
                styles.edgeDropdown,
                {
                  backgroundColor: colors.bg,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <ScrollView
                style={{ maxHeight: 240 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {searchSuggestions.length === 0 && !loadingSearch ? (
                  <View style={styles.igEmptyRow}>
                    <Text
                      style={[styles.igEmptyText, { color: colors.subtext }]}
                    >
                      No accounts found for "{searchQuery.trim()}"
                    </Text>
                  </View>
                ) : (
                  searchSuggestions.map((person) => (
                    <TouchableOpacity
                      key={person.id}
                      style={styles.igSuggestionRow}
                      onPress={() => openUserProfile(person, true)}
                    >
                      <Image
                        source={{
                          uri:
                            person.avatar_url ||
                            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
                        }}
                        style={[
                          styles.igSuggestionAvatar,
                          { backgroundColor: colors.surface },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.igSuggestionUsername,
                            { color: colors.text },
                          ]}
                          numberOfLines={1}
                        >
                          {(person.username || '').replace(/^@+/, '') ||
                            'member'}
                        </Text>
                        <Text
                          style={[
                            styles.igSuggestionSubtitle,
                            { color: colors.subtext },
                          ]}
                          numberOfLines={1}
                        >
                          {person.full_name || ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* REQUESTS TAB */}
      {activeTab === 'requests' && (
        <FlatList
          style={[styles.screen, { backgroundColor: colors.bg }]}
          data={visibleRequests}
          keyExtractor={(item) => item.id}
          renderItem={renderRequestCard}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            visibleRequests.length >= 2 ? (
              <View
                style={[
                  styles.acceptAllStrip,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.acceptAllLabel, { color: colors.subtext }]}
                >
                  {visibleRequests.length} pending requests
                </Text>
                <TouchableOpacity onPress={() => void handleAcceptAllRequests()}>
                  <Text
                    style={[styles.acceptAllBtnText, { color: colors.igBlue }]}
                  >
                    Accept All
                  </Text>
                </TouchableOpacity>
              </View>
            ) : undefined
          }
          contentContainerStyle={[
            styles.listContent,
            { backgroundColor: colors.bg, paddingBottom: bottomNavClearance },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadFollowData();
              }}
              tintColor={colors.text}
            />
          }
          ListEmptyComponent={renderInlineEmpty('No pending follow requests.')}
        />
      )}

      {/* EXPLORE TAB */}
      {activeTab === 'explore' && (
        <FlatList
          style={[styles.screen, { backgroundColor: colors.bg }]}
          data={exploreProfiles}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {radarEnabled && (
                <View
                  style={[
                    styles.edgeRadarStrip,
                    {
                      backgroundColor: colors.surface,
                      borderBottomColor: colors.borderStrong,
                    },
                  ]}
                >
                  <View style={styles.radarTopRow}>
                    <View style={styles.radarLabelGroup}>
                      <View style={styles.radarPulseDot} />
                      <Text
                        style={[styles.radarTitle, { color: colors.text }]}
                      >
                        Live Radar · {radarRadiusKm} km
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.ghostPill,
                        {
                          backgroundColor: ghostMode
                            ? colors.accent
                            : colors.bg,
                          borderColor: colors.borderStrong,
                        },
                      ]}
                      onPress={() => {
                        setGhostMode((g) => {
                          showToast({
                            message: !g
                              ? 'Ghost Mode ON — your distance is hidden'
                              : 'Ghost Mode OFF',
                          });
                          return !g;
                        });
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={ghostMode ? 'eye-off' : 'eye-off-outline'}
                        size={13}
                        color={ghostMode ? colors.accentText : colors.subtext}
                      />
                      <Text
                        style={[
                          styles.ghostPillText,
                          {
                            color: ghostMode
                              ? colors.accentText
                              : colors.subtext,
                          },
                        ]}
                      >
                        Ghost
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View
                    style={styles.horizontalTrackWrapper}
                    onLayout={(e) => {
                      const w = e.nativeEvent.layout.width;
                      if (w > RADAR_KNOB_SIZE) setTrackWidthPx(w);
                    }}
                  >
                    <View
                      style={[
                        styles.horizontalLineTrack,
                        { backgroundColor: colors.borderStrong },
                      ]}
                    >
                      <View
                        style={[
                          styles.horizontalLineFill,
                          { width: fillWidthPx },
                        ]}
                      />
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
                    <Text
                      style={[styles.radarScaleText, { color: colors.subtext }]}
                    >
                      {RADAR_MIN_KM} km
                    </Text>
                    <Text style={styles.radarCountText}>
                      {exploreProfiles.length}{' '}
                      {exploreProfiles.length === 1 ? 'person' : 'people'}{' '}
                      nearby
                    </Text>
                    <Text
                      style={[styles.radarScaleText, { color: colors.subtext }]}
                    >
                      {RADAR_MAX_KM} km
                    </Text>
                  </View>
                </View>
              )}

              {activeNearbyStoryUsers.length > 0 && !hasActiveSearchQuery && (
                <View
                  style={[
                    styles.nearbyStripContainer,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.stripLabel, { color: colors.subtext }]}
                  >
                    ACTIVE NEARBY
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.nearbyScrollContent}
                  >
                    {activeNearbyStoryUsers.map((person) => (
                      <TouchableOpacity
                        key={`nearby-${person.id}`}
                        style={styles.nearbyAvatarCard}
                        onPress={() => openUserProfile(person)}
                        activeOpacity={0.8}
                      >
                        <View
                          style={[
                            styles.nearbyRing,
                            { borderColor: colors.emerald },
                          ]}
                        >
                          <Image
                            source={{
                              uri:
                                person.avatar_url ||
                                'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
                            }}
                            style={[
                              styles.nearbyAvatar,
                              { backgroundColor: colors.surface },
                            ]}
                          />
                          <View
                            style={[
                              styles.onlineDot,
                              { borderColor: colors.bg },
                            ]}
                          />
                        </View>
                        <Text
                          style={[styles.nearbyName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {(person.full_name || 'Member').split(' ')[0]}
                        </Text>
                        <Text
                          style={[
                            styles.nearbyDist,
                            { color: colors.subtext },
                          ]}
                        >
                          {person.distanceKm ?? 5} km
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View
                style={[
                  styles.sortStrip,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.sortLabel, { color: colors.subtext }]}>
                  PEOPLE
                </Text>
                <View style={styles.sortPillsRow}>
                  {(
                    [
                      { key: 'match', label: 'Best Match' },
                      { key: 'nearest', label: 'Nearest' },
                      { key: 'mutuals', label: 'Mutuals' },
                    ] as const
                  ).map((opt) => {
                    const active = sortMode === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[
                          styles.sortPill,
                          {
                            backgroundColor: active
                              ? colors.accent
                              : colors.surface,
                          },
                        ]}
                        onPress={() => setSortMode(opt.key)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.sortPillText,
                            {
                              color: active
                                ? colors.accentText
                                : colors.subtext,
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => renderUserCard({ item })}
          contentContainerStyle={[
            styles.listContent,
            { backgroundColor: colors.bg, paddingBottom: bottomNavClearance },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadFollowData();
              }}
              tintColor={colors.text}
            />
          }
          ListEmptyComponent={renderInlineEmpty(
            radarEnabled
              ? `No people found within ${radarRadiusKm} km.`
              : 'No matching people found right now.'
          )}
        />
      )}

      {/* FLOATING UNDO / WAVE TOAST */}
      {toast && (
        <View
          style={[
            styles.toastBar,
            {
              backgroundColor: colors.accent,
              bottom: Math.max(insets.bottom, 16) + 74,
            },
          ]}
        >
          <Text
            style={[styles.toastText, { color: colors.accentText }]}
            numberOfLines={1}
          >
            {toast.message}
          </Text>
          {toast.undoUserId && (
            <TouchableOpacity
              onPress={() => handleUndoHide(toast.undoUserId!)}
              style={styles.toastUndoBtn}
            >
              <Text style={[styles.toastUndoText, { color: colors.igBlue }]}>
                Undo
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ALL-IN-ONE FILTER BOTTOM SHEET */}
      <Modal
        visible={filterSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterSheetOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setFilterSheetOpen(false)}
          />
          <View
            style={[
              styles.optionSheet,
              {
                backgroundColor: colors.card,
                maxHeight: '84%',
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
              <View>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Filters
                </Text>
                <Text style={[styles.sheetSubHint, { color: colors.subtext }]}>
                  Refine who you discover on Connect
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setFilterSheetOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.filterSecTitle, { color: colors.subtext }]}>
                OPEN TO
              </Text>
              <View style={styles.filterWrapRow}>
                {['all', ...INTENT_OPTIONS].map((opt) => {
                  const active = selectedIntent === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[
                        styles.sheetChip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                        },
                      ]}
                      onPress={() => setSelectedIntent(opt)}
                    >
                      <Text
                        style={[
                          styles.sheetChipText,
                          {
                            color: active ? colors.accentText : colors.text,
                          },
                        ]}
                      >
                        {opt === 'all' ? 'All Vibes' : opt}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.filterSecTitle, { color: colors.subtext }]}>
                INTERESTS
              </Text>
              <View style={styles.filterWrapRow}>
                {['all', ...INTEREST_TOPICS].map((topic) => {
                  const active = selectedTopic === topic;
                  return (
                    <TouchableOpacity
                      key={topic}
                      style={[
                        styles.sheetChip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                        },
                      ]}
                      onPress={() => setSelectedTopic(topic)}
                    >
                      <Text
                        style={[
                          styles.sheetChipText,
                          {
                            color: active ? colors.accentText : colors.text,
                          },
                        ]}
                      >
                        {topic === 'all' ? 'All' : `#${topic}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.filterSecTitle, { color: colors.subtext }]}>
                CITIES
              </Text>
              <TouchableOpacity
                style={[
                  styles.cityPickerRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderStrong,
                  },
                ]}
                onPress={() => {
                  setFilterSheetOpen(false);
                  setTimeout(() => setCityModalOpen(true), 220);
                }}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Ionicons
                    name="location-outline"
                    size={17}
                    color={colors.text}
                  />
                  <Text
                    style={[styles.cityPickerText, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {selectedCities.length === 0
                      ? 'Any City (Tap to search)'
                      : selectedCities.join(', ')}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>

              <Text style={[styles.filterSecTitle, { color: colors.subtext }]}>
                GENDER
              </Text>
              <View style={styles.filterWrapRow}>
                {GENDER_OPTIONS.map((opt) => {
                  const active = genderFilter === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.sheetChip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                        },
                      ]}
                      onPress={() => setGenderFilter(opt.value)}
                    >
                      <Text
                        style={[
                          styles.sheetChipText,
                          {
                            color: active ? colors.accentText : colors.text,
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.filterSecTitle, { color: colors.subtext }]}>
                AGE RANGE
              </Text>
              <View style={styles.filterWrapRow}>
                {AGE_OPTIONS.map((opt) => {
                  const active = ageFilter === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.sheetChip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                        },
                      ]}
                      onPress={() => setAgeFilter(opt.value)}
                    >
                      <Text
                        style={[
                          styles.sheetChipText,
                          {
                            color: active ? colors.accentText : colors.text,
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.filterSheetFooter}>
              <TouchableOpacity
                style={[
                  styles.filterResetBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={resetActiveFilters}
              >
                <Text
                  style={[styles.filterResetText, { color: colors.subtext }]}
                >
                  Reset
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.filterApplyBtn,
                  { backgroundColor: colors.accent },
                ]}
                onPress={() => setFilterSheetOpen(false)}
              >
                <Text
                  style={[styles.filterApplyText, { color: colors.accentText }]}
                >
                  Show {exploreProfiles.length} People
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QUICK PEEK PREVIEW SHEET */}
      <Modal
        visible={!!quickPeekUser}
        transparent
        animationType="slide"
        onRequestClose={() => setQuickPeekUser(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setQuickPeekUser(null)}
          />
          {quickPeekUser && (
            <View
              style={[
                styles.optionSheet,
                {
                  backgroundColor: colors.card,
                  paddingBottom:
                    Platform.OS === 'android'
                      ? Math.max(insets.bottom, 48) + 16
                      : Math.max(insets.bottom, 16) + 14,
                },
              ]}
            >
              <View
                style={[
                  styles.sheetHandle,
                  { backgroundColor: colors.borderStrong },
                ]}
              />

              <View style={styles.peekHeader}>
                <Image
                  source={{
                    uri:
                      quickPeekUser.avatar_url ||
                      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
                  }}
                  style={[
                    styles.peekAvatar,
                    { backgroundColor: colors.surface },
                  ]}
                />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <View style={styles.nameBadgeRow}>
                    <Text
                      style={[styles.peekName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {quickPeekUser.full_name || 'VibeSphere Member'}
                    </Text>
                    <View
                      style={[
                        styles.matchPill,
                        { backgroundColor: colors.emeraldSoft },
                      ]}
                    >
                      <Text style={styles.matchPillText}>
                        {quickPeekUser.vibeMatch ?? 85}% Match
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.peekHandle, { color: colors.subtext }]}>
                    {quickPeekUser.username || '@member'} ·{' '}
                    {formatCityWithCountry(
                      quickPeekUser.city,
                      quickPeekUser.country,
                      currentCountry
                    ) || `${quickPeekUser.distanceKm ?? 5} km away`}
                  </Text>
                  <View
                    style={[
                      styles.intentBadge,
                      { backgroundColor: colors.surface },
                    ]}
                  >
                    <Ionicons
                      name="flash"
                      size={11}
                      color={colors.emerald}
                    />
                    <Text
                      style={[styles.intentBadgeText, { color: colors.text }]}
                    >
                      Open to{' '}
                      {quickPeekUser.intentTag ||
                        deriveIntentTag(quickPeekUser.id)}
                    </Text>
                  </View>
                </View>
              </View>

              {quickPeekUser.bio ? (
                <Text style={[styles.peekBio, { color: colors.subtext }]}>
                  {quickPeekUser.bio}
                </Text>
              ) : null}

              <View style={styles.peekTagsRow}>
                {resolveUserInterests(quickPeekUser).map((t) => (
                  <View
                    key={t}
                    style={[
                      styles.peekTag,
                      { backgroundColor: colors.surface },
                    ]}
                  >
                    <Text style={[styles.peekTagText, { color: colors.text }]}>
                      #{t}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.peekActionsRow}>
                <TouchableOpacity
                  style={[
                    styles.peekBtnPrimary,
                    { backgroundColor: colors.igBlue },
                  ]}
                  onPress={() => openUserProfile(quickPeekUser, true)}
                >
                  <Text style={styles.peekBtnPrimaryText}>View Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.peekBtnSecondary,
                    { backgroundColor: colors.surface },
                  ]}
                  onPress={() => void handleWaveUser(quickPeekUser)}
                >
                  <Text
                    style={[
                      styles.peekBtnSecondaryText,
                      { color: colors.text },
                    ]}
                  >
                    {wavedIds[quickPeekUser.id] ? 'Waved ✓' : 'Wave 👋'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* MULTI-SELECT CITY MODAL */}
      <Modal
        visible={cityModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCityModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setCityModalOpen(false)}
          />
          <View
            style={[
              styles.optionSheet,
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
              <View>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Select Cities
                </Text>
                <Text style={[styles.sheetSubHint, { color: colors.subtext }]}>
                  {selectedCities.length > 0
                    ? `${selectedCities.length} selected`
                    : `${currentCountry} prioritized`}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setCityModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.sheetSearchBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={17}
                color={colors.subtext}
              />
              <TextInput
                style={[styles.sheetSearchInput, { color: colors.text }]}
                value={citySearchQuery}
                onChangeText={setCitySearchQuery}
                placeholder="Search city e.g. Jaipur, Delhi..."
                placeholderTextColor={colors.subtext}
              />
              {citySearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setCitySearchQuery('')}>
                  <Ionicons
                    name="close-circle"
                    size={17}
                    color={colors.subtext}
                  />
                </TouchableOpacity>
              )}
            </View>

            {selectedCities.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedChipsRow}
              >
                {selectedCities.map((sel) => (
                  <TouchableOpacity
                    key={sel}
                    style={[
                      styles.selectedCityTag,
                      { backgroundColor: colors.accent },
                    ]}
                    onPress={() => toggleCitySelection(sel)}
                  >
                    <Text
                      style={[
                        styles.selectedCityTagText,
                        { color: colors.accentText },
                      ]}
                    >
                      {sel}
                    </Text>
                    <Ionicons
                      name="close"
                      size={13}
                      color={colors.accentText}
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <FlatList
              data={suggestedCities}
              keyExtractor={(city, idx) => `${city}-${idx}`}
              style={{ maxHeight: 250 }}
              renderItem={({ item: city }) => {
                const isSelected = selectedCities.some(
                  (c) => c.toLowerCase() === city.toLowerCase()
                );
                return (
                  <TouchableOpacity
                    style={[
                      styles.cityItemRow,
                      { borderBottomColor: colors.border },
                      isSelected && {
                        backgroundColor: colors.surface,
                        borderRadius: 12,
                      },
                    ]}
                    onPress={() => toggleCitySelection(city)}
                  >
                    <Text
                      style={[
                        styles.cityItemText,
                        { color: colors.text },
                        isSelected && { fontWeight: '700' },
                      ]}
                    >
                      {city}
                    </Text>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={isSelected ? colors.igBlue : colors.subtext}
                    />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text
                  style={[styles.emptyCityText, { color: colors.subtext }]}
                >
                  {searchingCities
                    ? 'Searching matching cities...'
                    : 'No matching cities found.'}
                </Text>
              }
            />

            <TouchableOpacity
              style={[
                styles.applyCitiesBtn,
                { backgroundColor: colors.accent },
              ]}
              onPress={() => {
                setCitySearchQuery('');
                setCityModalOpen(false);
                setTimeout(() => setFilterSheetOpen(true), 200);
              }}
            >
              <Text
                style={[
                  styles.applyCitiesBtnText,
                  { color: colors.accentText },
                ]}
              >
                {selectedCities.length > 0
                  ? `Apply (${selectedCities.length})`
                  : 'Done'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SAFETY / OPTIONS MODAL */}
      <Modal
        visible={!!safetyUser}
        transparent
        animationType="fade"
        onRequestClose={() => setSafetyUser(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSafetyUser(null)}
          />
          <View
            style={[
              styles.optionSheet,
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
              <View>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  {safetyUser?.full_name || 'Member Options'}
                </Text>
                <Text style={[styles.sheetSubHint, { color: colors.subtext }]}>
                  Quick actions & safety
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setSafetyUser(null)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {safetyUser && (
              <>
                <TouchableOpacity
                  style={[
                    styles.cityItemRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    const target = safetyUser;
                    setSafetyUser(null);
                    setQuickPeekUser(target);
                  }}
                >
                  <Text style={[styles.cityItemText, { color: colors.text }]}>
                    Quick Peek Profile
                  </Text>
                  <Ionicons
                    name="sparkles-outline"
                    size={18}
                    color={colors.subtext}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.cityItemRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => void handleToggleMuteUser(safetyUser)}
                >
                  <Text style={[styles.cityItemText, { color: colors.text }]}>
                    {mutedUserIds[safetyUser.id]
                      ? 'Unmute in Suggestions'
                      : 'Mute in Suggestions'}
                  </Text>
                  <Ionicons
                    name="volume-mute-outline"
                    size={18}
                    color={colors.subtext}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.cityItemRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    const target = safetyUser;
                    setSafetyUser(null);
                    handleSkipSuggestion(target);
                  }}
                >
                  <Text style={[styles.cityItemText, { color: colors.text }]}>
                    Hide Suggestion
                  </Text>
                  <Ionicons
                    name="eye-off-outline"
                    size={18}
                    color={colors.subtext}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.cityItemRow, { borderBottomWidth: 0 }]}
                  onPress={() => void handleBlockUser(safetyUser)}
                >
                  <Text style={[styles.cityItemText, { color: colors.danger }]}>
                    Block Member
                  </Text>
                  <Ionicons
                    name="ban-outline"
                    size={18}
                    color={colors.danger}
                  />
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
  screen: { flex: 1 },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTitleCol: { flex: 1 },
  headerTitle: {
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shuffleHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    height: 32,
    borderRadius: 999,
  },
  shuffleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  radarRoundToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 9,
    paddingRight: 2,
    height: 32,
  },
  miniSwitch: { transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }] },

  /* Edge-to-Edge Underline Tabs */
  underlineTabsBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  underlineTabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  underlineTabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  reqBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },

  /* Search + Single Filter Icon */
  controlsBlock: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  igSearchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    height: 42,
    borderRadius: 12,
    gap: 8,
  },
  igSearchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 0,
  },
  filterIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterCountDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0095f6',
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  filterCountText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
  },

  edgeDropdown: {
    marginTop: 8,
    borderBottomWidth: 1,
    paddingBottom: 4,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  recentTitle: { fontSize: 12, fontWeight: '700' },
  clearAllText: { fontSize: 12, fontWeight: '700' },
  igSuggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  igSuggestionAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  igSuggestionUsername: { fontSize: 14, fontWeight: '700' },
  igSuggestionSubtitle: { fontSize: 12, marginTop: 1 },
  igEmptyRow: { paddingVertical: 16, alignItems: 'center' },
  igEmptyText: { fontSize: 13 },

  /* All-in-One Filter Sheet */
  filterSecTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginTop: 14,
    marginBottom: 8,
  },
  filterWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sheetChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
  },
  sheetChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  cityPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  cityPickerText: {
    fontSize: 13.5,
    fontWeight: '600',
    flex: 1,
  },
  filterSheetFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  filterResetBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterResetText: { fontSize: 14, fontWeight: '700' },
  filterApplyBtn: {
    flex: 1.6,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterApplyText: { fontSize: 14, fontWeight: '800' },

  /* Edge-to-Edge Live Radar Strip */
  edgeRadarStrip: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  radarTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  radarLabelGroup: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  radarPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  radarTitle: { fontSize: 13.5, fontWeight: '800' },
  ghostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  ghostPillText: { fontSize: 11.5, fontWeight: '700' },
  horizontalTrackWrapper: {
    width: '100%',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  horizontalLineTrack: {
    width: '100%',
    height: 5,
    borderRadius: 2.5,
    justifyContent: 'center',
    position: 'relative',
  },
  horizontalLineFill: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#10b981',
  },
  horizontalLineKnob: {
    position: 'absolute',
    left: 0,
    width: RADAR_KNOB_SIZE,
    height: RADAR_KNOB_SIZE,
    borderRadius: RADAR_KNOB_SIZE / 2,
    backgroundColor: '#10b981',
    borderWidth: 2.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  horizontalKnobInnerDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#ffffff',
  },
  radarScaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  radarScaleText: { fontSize: 11, fontWeight: '600' },
  radarCountText: { fontSize: 11.5, fontWeight: '700', color: '#10b981' },

  /* Active Nearby Horizontal Story Strip */
  nearbyStripContainer: {
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  stripLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  nearbyScrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },
  nearbyAvatarCard: {
    alignItems: 'center',
    width: 62,
  },
  nearbyRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    padding: 2.5,
    borderWidth: 2,
    position: 'relative',
  },
  nearbyAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#10b981',
    borderWidth: 2,
  },
  nearbyName: {
    fontSize: 11.5,
    fontWeight: '700',
    marginTop: 5,
  },
  nearbyDist: {
    fontSize: 10,
    fontWeight: '500',
  },

  /* Smart Sort Strip */
  sortStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  sortLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  sortPillsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  sortPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  sortPillText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* Requests Accept All Strip */
  acceptAllStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  acceptAllLabel: { fontSize: 12.5, fontWeight: '600' },
  acceptAllBtnText: { fontSize: 13, fontWeight: '800' },

  /* Seamless Edge-to-Edge People Rows */
  listContent: { paddingBottom: 120 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
  },
  avatarDistanceBadge: {
    position: 'absolute',
    bottom: -4,
    alignSelf: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999,
  },
  avatarDistanceText: { fontSize: 9.5, fontWeight: '800' },
  userInfo: { flex: 1, marginRight: 8 },
  nameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: { fontSize: 14.5, fontWeight: '700', flexShrink: 1 },
  matchPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  matchPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10b981',
  },
  userHandle: { fontSize: 12, marginTop: 1, fontWeight: '500' },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  miniTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniTagText: { fontSize: 10.5, fontWeight: '600' },
  mutedNote: { fontSize: 10.5, fontWeight: '600', marginLeft: 4 },
  requestSub: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },

  actionsColumn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waveBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveEmoji: { fontSize: 14 },
  followBtn: {
    paddingHorizontal: 13,
    paddingVertical: 7.5,
    borderRadius: 10,
  },
  followBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  moreDotsBtn: {
    paddingVertical: 6,
    paddingLeft: 2,
  },

  requestActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  acceptBtn: {
    paddingHorizontal: 13,
    paddingVertical: 7.5,
    borderRadius: 10,
  },
  acceptBtnText: { color: '#ffffff', fontSize: 12.5, fontWeight: '700' },
  declineBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7.5,
    borderRadius: 10,
  },
  declineBtnText: { fontSize: 12.5, fontWeight: '700' },

  /* Floating Toast */
  toastBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: { fontSize: 13, fontWeight: '700', flex: 1 },
  toastUndoBtn: { marginLeft: 12 },
  toastUndoText: { fontSize: 13, fontWeight: '800' },

  /* Quick Peek Sheet */
  peekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  peekAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  peekName: { fontSize: 18, fontWeight: '800', flexShrink: 1 },
  peekHandle: { fontSize: 12.5, marginTop: 2, fontWeight: '500' },
  intentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 999,
    marginTop: 6,
  },
  intentBadgeText: { fontSize: 11, fontWeight: '700' },
  peekBio: { fontSize: 13.5, lineHeight: 19, marginBottom: 12 },
  peekTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  peekTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  peekTagText: { fontSize: 12, fontWeight: '600' },
  peekActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  peekBtnPrimary: {
    flex: 1.4,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekBtnPrimaryText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  peekBtnSecondary: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekBtnSecondaryText: { fontSize: 14, fontWeight: '700' },

  /* Empty & Loading */
  inlineSyncBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 40,
  },
  inlineSyncText: { fontSize: 13.5, fontWeight: '600' },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 56,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13.5,
    fontWeight: '500',
    lineHeight: 20,
  },
  resetFilterBtn: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
  },
  resetFilterBtnText: { fontSize: 12.5, fontWeight: '700' },

  /* Modals */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  optionSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  sheetSubHint: { fontSize: 12, marginTop: 2 },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  sheetSearchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 14,
  },
  selectedChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 10,
  },
  selectedCityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  selectedCityTagText: { fontSize: 12, fontWeight: '700' },
  cityItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  cityItemText: { fontSize: 14, fontWeight: '500', flex: 1, marginRight: 8 },
  emptyCityText: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  applyCitiesBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyCitiesBtnText: { fontSize: 14, fontWeight: '800' },
});