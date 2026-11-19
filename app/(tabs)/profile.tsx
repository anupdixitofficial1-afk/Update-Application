import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Image,
  TouchableOpacity,
  Modal,
  TextInput,
  Dimensions,
  Alert,
  ActivityIndicator,
  Platform,
  DeviceEventEmitter,
  Linking,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import CountryPicker, { type Country, type CountryCode } from 'react-native-country-picker-modal';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';
import { supabase } from '../../lib/supabase';
import { useProfileAvatar } from '../../lib/profileAvatar';

const FOLLOWS_UPDATED_EVENT = 'follows-updated';

const { width } = Dimensions.get('window');

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DEFAULT_CARTOON_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';

const getResolvedAvatarUri = (uploadedAvatar?: string | null): string => {
  const trimmedAvatar = (uploadedAvatar || '').trim();
  if (trimmedAvatar) {
    return trimmedAvatar;
  }
  return DEFAULT_CARTOON_AVATAR;
};

interface CountryCodeItem {
  code: string;
  country: string;
  flag: string;
  minDigits: number;
  maxDigits: number;
  iso2: string;
}

interface InfoPopupState {
  type: 'location' | 'birthday';
  title: string;
  subtitle: string;
  value: string;
  icon: 'location-outline' | 'gift-outline';
  isBirthdayToday?: boolean;
}

const getCountryFlag = (iso: string): string => {
  const code = (iso || '').toUpperCase();
  if (code.length !== 2) return '🌍';
  const c1 = code.charCodeAt(0);
  const c2 = code.charCodeAt(1);
  if (c1 < 65 || c1 > 90 || c2 < 65 || c2 > 90) return '🌍';
  return (
    String.fromCharCode(0xd83c, 0xdde6 + (c1 - 65)) +
    String.fromCharCode(0xd83c, 0xdde6 + (c2 - 65))
  );
};

const getCountryName = (iso: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(iso) || iso;
  } catch {
    return iso;
  }
};

const findCountryByCode = (code?: string | null): CountryCodeItem => {
  const cleaned = (code || '+91').trim();
  const matchedIso = getCountries().find(
    (country) => `+${getCountryCallingCode(country)}` === cleaned
  );
  const iso: CountryCode = (matchedIso || 'IN') as CountryCode;
  return {
    code: `+${getCountryCallingCode(iso)}`,
    country: getCountryName(iso),
    flag: getCountryFlag(iso),
    minDigits: 7,
    maxDigits: 15,
    iso2: iso,
  };
};

const sanitizeMobileDigits = (raw: string): string => raw.replace(/\D/g, '');

const normalizeHandle = (raw: string): string => {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^@+/, '');
  return cleaned ? `@${cleaned}` : '';
};

const buildFallbackUsername = (
  currentHandle?: string | null,
  email?: string | null,
  userId?: string | null
): string => {
  const normalizedCurrent = normalizeHandle(currentHandle || '');
  if (normalizedCurrent) return normalizedCurrent;

  const emailPrefix =
    (email || '').split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '') || '';
  if (emailPrefix.length >= 6) {
    return normalizeHandle(emailPrefix);
  }

  const shortId = (userId || 'user').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `@user_${shortId || 'member'}`;
};

const parseDOB = (value?: string | null): Date => {
  const match = (value || '')
    .trim()
    .match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const monthText = match[2].slice(0, 3).toLowerCase();
    const month = SHORT_MONTHS.findIndex(
      (item) => item.toLowerCase() === monthText
    );
    const year = Number(match[3]);
    if (month >= 0 && year >= 1950 && year <= new Date().getFullYear()) {
      const date = new Date(year, month, day);
      if (
        date.getFullYear() === year &&
        date.getMonth() === month &&
        date.getDate() === day
      ) {
        return date;
      }
    }
  }
  return new Date(1995, 0, 1);
};

const formatDOB = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}-${SHORT_MONTHS[date.getMonth()]}-${date.getFullYear()}`;

const isBirthdayToday = (dobValue?: string | null): boolean => {
  const raw = (dobValue || '').trim();
  if (!raw) return false;

  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();

  const namedMatch = raw.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})$/);
  if (namedMatch) {
    const day = Number(namedMatch[1]);
    const monthIndex = SHORT_MONTHS.findIndex(
      (m) => m.toLowerCase() === namedMatch[2].slice(0, 3).toLowerCase()
    );
    return day === todayDay && monthIndex === todayMonth;
  }

  const numericMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const monthIndex = Number(numericMatch[2]) - 1;
    return day === todayDay && monthIndex === todayMonth;
  }

  return false;
};

const parseVisibilityFlag = (
  row: any,
  keys: string[],
  defaultWhenMissing: boolean
): boolean => {
  if (!row || typeof row !== 'object') return defaultWhenMissing;
  for (const key of keys) {
    const val = row[key];
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      if (
        lower === 'true' ||
        lower === '1' ||
        lower === 'yes' ||
        lower === 'public'
      ) {
        return true;
      }
      if (
        lower === 'false' ||
        lower === '0' ||
        lower === 'no' ||
        lower === 'private'
      ) {
        return false;
      }
    }
    if (typeof val === 'number') {
      return val !== 0;
    }
  }
  return defaultWhenMissing;
};

const fetchSubscriptionCount = async (profileId: string): Promise<number> => {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('creator_id, channel_id, target_id, status')
      .or(`subscriber_id.eq.${profileId},user_id.eq.${profileId}`);

    if (error) return 0;

    const activeRows = (data || []).filter((row: any) => {
      const st = String(row?.status || 'active').toLowerCase();
      return st === 'active' || st === 'subscribed' || st === 'accepted';
    });

    const uniqueIds = new Set(
      activeRows
        .map((row: any) => row.creator_id || row.channel_id || row.target_id)
        .filter((id: any) => Boolean(id) && id !== profileId)
    );

    return uniqueIds.size;
  } catch {
    return 0;
  }
};

interface MediaPost {
  id: string;
  title: string;
  views?: string;
  duration?: string;
  thumbnail: string;
  type: 'post' | 'video' | 'short';
  uploadDate?: string;
}

const POST_ITEMS: MediaPost[] = [
  {
    id: 'p1',
    title: 'New setup update announcement 🚀',
    thumbnail:
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&q=80&w=400',
    type: 'post',
  },
  {
    id: 'p2',
    title: 'Exploring weekend trails and outdoor vibes 🌲',
    thumbnail:
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&q=80&w=400',
    type: 'post',
  },
  {
    id: 'p3',
    title: 'Minimalist workspace essentials 💻',
    thumbnail:
      'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&q=80&w=400',
    type: 'post',
  },
];

const MY_VIDEOS: MediaPost[] = [
  {
    id: 'v1',
    title: '5 Real Time Travel Cases Explained & Practical Solutions',
    views: '1.9M',
    duration: '30:41',
    thumbnail: 'https://img.youtube.com/vi/Ww84NpNpRfo/hqdefault.jpg',
    type: 'video',
    uploadDate: '3 weeks ago',
  },
  {
    id: 'v2',
    title: 'Building High-Throughput Desktop Tools in Python & PySide6',
    views: '420K',
    duration: '14:20',
    thumbnail:
      'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&q=80&w=600',
    type: 'video',
    uploadDate: '1 month ago',
  },
  {
    id: 'v3',
    title: 'Ladakh Solo Ride Cinematic Vlog - Hidden Passes Explored',
    views: '890K',
    duration: '22:15',
    thumbnail:
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&q=80&w=600',
    type: 'video',
    uploadDate: '2 months ago',
  },
];

const MY_SHORTS: MediaPost[] = [
  {
    id: 's1',
    title: 'Xiaomi 17 Pro Camera Test 🔥',
    views: '2.4M',
    thumbnail:
      'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&q=80&w=400',
    type: 'short',
  },
  {
    id: 's2',
    title: 'Morning Coffee & Desk Setup',
    views: '610K',
    thumbnail:
      'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&q=80&w=400',
    type: 'short',
  },
];

const LIVE_ITEMS: MediaPost[] = [
  {
    id: 'l1',
    title: 'Q&A Live Session: Future of Tech & Vlogging in 2026',
    views: '45K',
    thumbnail:
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=600',
    type: 'video',
    uploadDate: 'Streamed 5 days ago',
  },
];

const MERGED_POSTS_AND_SHORTS: MediaPost[] = [...POST_ITEMS, ...MY_SHORTS];

const formatCompactCount = (
  value: number | string | null | undefined,
  fallback = '0'
) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' && /[KMB]$/i.test(value.trim()))
    return value.trim();

  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  if (num >= 1_000_000)
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(num);
};

export default function ProfileScreen() {
  const { setAvatarUri: setSharedAvatarUri } = useProfileAvatar();
  const params = useLocalSearchParams<{
    userId?: string;
    username?: string;
    fromConnect?: string;
  }>();

  const [forceOwnMode, setForceOwnMode] = useState(false);

  const [activeTab, setActiveTab] = useState<'posts' | 'videos' | 'live'>('posts');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [infoPopup, setInfoPopup] = useState<InfoPopupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
  const [isFollowingTarget, setIsFollowingTarget] = useState(false);
  const [isFollowedByTarget, setIsFollowedByTarget] = useState(false);
  const [updatingFollow, setUpdatingFollow] = useState(false);

  const [name, setName] = useState('Anup Dixit');
  const [handle, setHandle] = useState('@anupdixit2024');
  const [city, setCity] = useState('');
  const [showLocation, setShowLocation] = useState(false);
  const [countryCode, setCountryCode] = useState('+91');
  const [mobileNumber, setMobileNumber] = useState('');
  const [showPhone, setShowPhone] = useState(false);
  const [dob, setDob] = useState('');
  const [showDob, setShowDob] = useState(false);
  const [bio, setBio] = useState(
    'Building modern software tools, travel vlogs & tech insights.'
  );
  const [avatarUri, setAvatarUri] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [isProfileCompleted, setIsProfileCompleted] = useState(true);

  const [followersDisplay, setFollowersDisplay] = useState('0');
  const [followingDisplay, setFollowingDisplay] = useState('0');
  const [subscriptionsDisplay, setSubscriptionsDisplay] = useState('0');

  const [draftName, setDraftName] = useState(name);
  const [draftHandle, setDraftHandle] = useState(handle);
  const [draftCity, setDraftCity] = useState(city);
  const [draftCountry, setDraftCountry] = useState<CountryCodeItem>(
    findCountryByCode('+91')
  );
  const [draftCountryISO, setDraftCountryISO] = useState<CountryCode>('IN');
  const [draftMobile, setDraftMobile] = useState('');
  const [mobileError, setMobileError] = useState('');
  const [isCountryModalOpen, setIsCountryModalOpen] = useState(false);
  const [draftBio, setDraftBio] = useState(bio);
  const [usernameError, setUsernameError] = useState('');

  const [selectedDate, setSelectedDate] = useState<Date>(new Date(2024, 7, 8));
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
  const [searchingCities, setSearchingCities] = useState(false);
  const citySearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cityAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (citySearchTimerRef.current) clearTimeout(citySearchTimerRef.current);
      if (cityAbortControllerRef.current) cityAbortControllerRef.current.abort();
    };
  }, []);

  const paramUserId =
    typeof params?.userId === 'string' && params.userId.trim()
      ? params.userId.trim()
      : null;

  const isOwnProfile = Boolean(
    currentUserId &&
      targetProfileId &&
      currentUserId === targetProfileId &&
      (forceOwnMode || !paramUserId || paramUserId === currentUserId)
  );

  const canShowLocationIcon = Boolean(city.trim()) && showLocation;
  const canShowBirthdayIcon = Boolean(dob.trim()) && showDob;
  const canShowCallIcon =
    Boolean(sanitizeMobileDigits(mobileNumber)) && showPhone;
  const birthdayActiveToday = isBirthdayToday(dob);

  const syncFollowRelationship = useCallback(
    async (viewerId?: string | null, viewedId?: string | null) => {
      const activeViewer = viewerId ?? currentUserId;
      const activeViewed = viewedId ?? targetProfileId;

      if (!activeViewer || !activeViewed || activeViewer === activeViewed) {
        setIsFollowingTarget(false);
        setIsFollowedByTarget(false);
        return;
      }

      try {
        const [{ data: outgoingRow }, { data: incomingRow }] =
          await Promise.all([
            supabase
              .from('follows')
              .select('id, status')
              .eq('follower_id', activeViewer)
              .eq('following_id', activeViewed)
              .maybeSingle(),
            supabase
              .from('follows')
              .select('id, status')
              .eq('follower_id', activeViewed)
              .eq('following_id', activeViewer)
              .maybeSingle(),
          ]);

        const isAcceptedOrNull = (row: any) =>
          Boolean(row) &&
          (!row.status ||
            ['accepted', 'active', 'following'].includes(
              String(row.status).toLowerCase()
            ));

        setIsFollowingTarget(isAcceptedOrNull(outgoingRow));
        setIsFollowedByTarget(isAcceptedOrNull(incomingRow));
      } catch {
        // Keep current state on transient network error
      }
    },
    [currentUserId, targetProfileId]
  );

  const refreshFollowCounts = useCallback(
    async (
      profileId?: string | null,
      fallbackFollowers?: any,
      fallbackFollowing?: any
    ) => {
      const effectiveId = profileId || targetProfileId || currentUserId;
      if (!effectiveId) return;

      try {
        const [
          { count: followersCount, error: fErr },
          { count: followingCount, error: gErr },
          subCount,
        ] = await Promise.all([
          supabase
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('following_id', effectiveId)
            .or('status.eq.accepted,status.is.null'),
          supabase
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('follower_id', effectiveId)
            .or('status.eq.accepted,status.is.null'),
          fetchSubscriptionCount(effectiveId),
        ]);

        if (!fErr && typeof followersCount === 'number') {
          setFollowersDisplay(formatCompactCount(followersCount, '0'));
        } else if (fallbackFollowers !== undefined) {
          setFollowersDisplay(formatCompactCount(fallbackFollowers, '0'));
        }

        if (!gErr && typeof followingCount === 'number') {
          setFollowingDisplay(formatCompactCount(followingCount, '0'));
        } else if (fallbackFollowing !== undefined) {
          setFollowingDisplay(formatCompactCount(fallbackFollowing, '0'));
        }

        setSubscriptionsDisplay(formatCompactCount(subCount, '0'));
      } catch {
        if (fallbackFollowers !== undefined) {
          setFollowersDisplay(formatCompactCount(fallbackFollowers, '0'));
        }
        if (fallbackFollowing !== undefined) {
          setFollowingDisplay(formatCompactCount(fallbackFollowing, '0'));
        }
        setSubscriptionsDisplay('0');
      }
    },
    [targetProfileId, currentUserId]
  );

  const openConnectionsScreen = (
    tab: 'followers' | 'following' | 'subscriptions'
  ) => {
    const effectiveId = targetProfileId || paramUserId || currentUserId;
    router.push({
      pathname: '/connections',
      params: {
        ...(effectiveId ? { userId: effectiveId } : {}),
        tab,
        title: name || handle || 'Connections',
      },
    });
  };

  const applyProfileRecord = useCallback(
    (data: any, isSelf: boolean) => {
      if (!data) return;

      const loadedName = data.full_name || '';
      const loadedHandle = data.username ? normalizeHandle(data.username) : '';
      const loadedCity = data.city
        ? String(data.city).trim()
        : data.location
          ? String(data.location).trim()
          : '';
      const loadedCode = (data.country_code || '+91').trim();
      const loadedDigits = sanitizeMobileDigits(
        data.mobile_number || data.phone || ''
      );
      const loadedDob = data.dob
        ? String(data.dob).trim()
        : data.date_of_birth
          ? String(data.date_of_birth).trim()
          : '';
      const loadedBio = data.bio || '';
      const loadedAvatar = data.avatar_url ? String(data.avatar_url).trim() : '';
      const completed = !isSelf ? true : data.is_profile_completed === true;

      const defaultFlag = !isSelf;
      const cityVisible = parseVisibilityFlag(
        data,
        ['show_city', 'show_location', 'location_visible', 'is_city_visible'],
        defaultFlag
      );
      const dobVisible = parseVisibilityFlag(
        data,
        ['show_dob', 'dob_visible', 'is_dob_visible', 'show_birthday'],
        defaultFlag
      );
      const phoneVisible = parseVisibilityFlag(
        data,
        ['show_phone', 'show_mobile', 'phone_visible', 'mobile_visible'],
        defaultFlag
      );

      setName(loadedName);
      setHandle(loadedHandle);
      setCity(loadedCity);
      setShowLocation(cityVisible);
      setCountryCode(loadedCode || '+91');
      setMobileNumber(loadedDigits);
      setShowPhone(phoneVisible);
      setDob(loadedDob);
      setShowDob(dobVisible);
      setBio(loadedBio);
      setAvatarUri(loadedAvatar);
      if (isSelf) {
        setSharedAvatarUri(getResolvedAvatarUri(loadedAvatar));
      }
      setIsProfileCompleted(completed);

      setFollowersDisplay(formatCompactCount(data.followers_count, '0'));
      setFollowingDisplay(formatCompactCount(data.following_count, '0'));
      setSubscriptionsDisplay(
        formatCompactCount(data.subscriptions_count, '0')
      );

      if (!completed && isSelf) {
        setDraftName(loadedName);
        setDraftHandle(loadedHandle);
        setDraftCity(loadedCity);
        const initialCountry = findCountryByCode(loadedCode || '+91');
        setDraftCountry(initialCountry);
        setDraftCountryISO(initialCountry.iso2 as CountryCode);
        setDraftMobile(loadedDigits);
        setDraftBio(loadedBio);
        setSelectedDate(parseDOB(loadedDob));
        setIsEditModalOpen(true);
      }
    },
    [setSharedAvatarUri]
  );

  const fetchUserProfile = useCallback(
    async (forceOwnProfile = false) => {
      try {
        setLoading(true);
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const loggedInId = session?.user?.id ?? null;
        setCurrentUserId(loggedInId);

        const shouldForceOwn = forceOwnProfile || forceOwnMode;

        const activeParamId = shouldForceOwn
          ? null
          : typeof params?.userId === 'string' && params.userId.trim()
            ? params.userId.trim()
            : null;

        const requestedId = shouldForceOwn
          ? loggedInId
          : activeParamId || loggedInId;

        if (requestedId) {
          setTargetProfileId(requestedId);

          const isSelf = Boolean(loggedInId && requestedId === loggedInId);
          if (!isSelf) {
            setIsEditModalOpen(false);
            setIsAvatarModalOpen(false);
          }

          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', requestedId)
            .maybeSingle();

          if (loggedInId && requestedId !== loggedInId) {
            await syncFollowRelationship(loggedInId, requestedId);
          } else {
            setIsFollowingTarget(false);
            setIsFollowedByTarget(false);
          }

          if (data) {
            applyProfileRecord(data, isSelf);
            await refreshFollowCounts(
              requestedId,
              data.followers_count,
              data.following_count
            );
          } else if (error) {
            console.log('Profile fetch note:', error.message);
          }
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      } finally {
        setLoading(false);
      }
    },
    [
      params?.userId,
      forceOwnMode,
      applyProfileRecord,
      refreshFollowCounts,
      syncFollowRelationship,
    ]
  );

  useEffect(() => {
    const incomingId =
      typeof params?.userId === 'string' && params.userId.trim()
        ? params.userId.trim()
        : null;

    if (incomingId && (!currentUserId || incomingId !== currentUserId)) {
      setForceOwnMode(false);
    }
  }, [params?.userId, currentUserId]);

  useEffect(() => {
    fetchUserProfile(false);
  }, [fetchUserProfile]);

  useEffect(() => {
    if (!targetProfileId) return;

    let isCancelled = false;
    const channelName = `profile-row-${targetProfileId}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${targetProfileId}`,
        },
        (payload) => {
          if (isCancelled) return;
          const nextRow = payload.new as any;
          if (nextRow) {
            const isSelf = Boolean(
              currentUserId && targetProfileId === currentUserId
            );
            applyProfileRecord(nextRow, isSelf);
          }
        }
      )
      .subscribe();

    return () => {
      isCancelled = true;
      supabase.removeChannel(channel).catch(() => {});
    };
  }, [targetProfileId, currentUserId, applyProfileRecord]);

  useFocusEffect(
    useCallback(() => {
      if (forceOwnMode) {
        fetchUserProfile(true);
        return;
      }

      if (paramUserId) {
        fetchUserProfile(false);
        return;
      }

      if (params?.fromConnect === '1') {
        router.setParams({ fromConnect: undefined } as any);
        return;
      }

      fetchUserProfile(true);
    }, [paramUserId, params?.fromConnect, forceOwnMode, fetchUserProfile])
  );

  useEffect(() => {
    const followsSub = DeviceEventEmitter.addListener(
      FOLLOWS_UPDATED_EVENT,
      () => {
        refreshFollowCounts();
        syncFollowRelationship();
      }
    );

    const profileTabSub = DeviceEventEmitter.addListener(
      'profile-tab-pressed',
      () => {
        setForceOwnMode(true);
        if (currentUserId) {
          setTargetProfileId(currentUserId);
          setIsFollowingTarget(false);
          setIsFollowedByTarget(false);
        }
        fetchUserProfile(true);
      }
    );

    const handlePrivacyEvent = (payload?: any) => {
      if (payload && typeof payload === 'object') {
        if (typeof payload.showLocation === 'boolean')
          setShowLocation(payload.showLocation);
        if (typeof payload.show_location === 'boolean')
          setShowLocation(payload.show_location);
        if (typeof payload.show_city === 'boolean')
          setShowLocation(payload.show_city);
        if (typeof payload.showDob === 'boolean') setShowDob(payload.showDob);
        if (typeof payload.show_dob === 'boolean')
          setShowDob(payload.show_dob);
        if (typeof payload.showPhone === 'boolean')
          setShowPhone(payload.showPhone);
        if (typeof payload.show_phone === 'boolean')
          setShowPhone(payload.show_phone);
        if (typeof payload.show_mobile === 'boolean')
          setShowPhone(payload.show_mobile);
      }
      fetchUserProfile(false);
    };

    const privacySub1 = DeviceEventEmitter.addListener(
      'profile-privacy-updated',
      handlePrivacyEvent
    );
    const privacySub2 = DeviceEventEmitter.addListener(
      'privacy-settings-updated',
      handlePrivacyEvent
    );

    return () => {
      followsSub.remove();
      profileTabSub.remove();
      privacySub1.remove();
      privacySub2.remove();
    };
  }, [
    currentUserId,
    refreshFollowCounts,
    syncFollowRelationship,
    fetchUserProfile,
  ]);

  const handleShareProfile = async () => {
    try {
      const shareTitle = name || handle || 'Profile';
      const shareMessage = `${shareTitle} (${handle || '@user'}) on VibeSphere`;
      await Share.share({
        message: shareMessage,
        title: shareTitle,
      });
    } catch {
      Alert.alert('Share Failed', 'Could not share profile.');
    }
  };

  const handleLogout = async () => {
    if (!isOwnProfile || loggingOut) return;
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            setLoggingOut(true);
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            router.replace('/login' as any);
          } catch (err: any) {
            Alert.alert('Logout Failed', err?.message || 'Unable to log out.');
          } finally {
            setLoggingOut(false);
          }
        },
      },
    ]);
  };

  const handleToggleFollowOnProfile = async () => {
    if (isOwnProfile || !currentUserId || !targetProfileId || updatingFollow)
      return;
    try {
      setUpdatingFollow(true);
      if (isFollowingTarget) {
        setIsFollowingTarget(false);
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', currentUserId)
          .eq('following_id', targetProfileId);
        if (error) throw error;
      } else {
        setIsFollowingTarget(true);
        const { error } = await supabase.from('follows').insert({
          follower_id: currentUserId,
          following_id: targetProfileId,
          status: 'accepted',
        });
        if (error) throw error;
      }
      await refreshFollowCounts(targetProfileId);
      await syncFollowRelationship(currentUserId, targetProfileId);
      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
        followerId: currentUserId,
        followingId: targetProfileId,
        status: isFollowingTarget ? 'removed' : 'accepted',
      });
    } catch (err: any) {
      Alert.alert(
        'Action Failed',
        err?.message || 'Could not update follow status.'
      );
      fetchUserProfile(false);
    } finally {
      setUpdatingFollow(false);
    }
  };

  const handleMessageUser = () => {
    if (isOwnProfile || !targetProfileId) return;
    router.push({
      pathname: '/messages' as any,
      params: {
        userId: targetProfileId,
        username: handle || '@user',
        name: name || handle || 'User',
        avatarUrl: getResolvedAvatarUri(avatarUri),
      },
    });
  };

  const handleOpenLocationPopup = () => {
    if (!canShowLocationIcon) return;
    setInfoPopup({
      type: 'location',
      title: 'Current Location',
      subtitle: `${name || handle || 'Member'}'s visible location`,
      value: city.trim(),
      icon: 'location-outline',
    });
  };

  const handleOpenBirthdayPopup = () => {
    if (!canShowBirthdayIcon) return;
    const isBday = isBirthdayToday(dob);
    setInfoPopup({
      type: 'birthday',
      title: isBday ? 'Happy Birthday Today!' : 'Date of Birth',
      subtitle: isBday
        ? `Celebrating ${name || handle || 'Member'}'s special day`
        : `${name || handle || 'Member'}'s birthday`,
      value: isBday ? `${dob.trim()}  •  Birthday Special` : dob.trim(),
      icon: 'gift-outline',
      isBirthdayToday: isBday,
    });
  };

  const handleOpenDialpad = async () => {
    if (!canShowCallIcon) return;
    const cleanDigits = sanitizeMobileDigits(mobileNumber);
    const cleanCode = (countryCode || '+91').replace(/[^\d+]/g, '');
    const dialNumber = cleanCode ? `${cleanCode}${cleanDigits}` : cleanDigits;
    const telUrl = `tel:${dialNumber}`;

    try {
      const supported = await Linking.canOpenURL(telUrl);
      if (!supported) {
        Alert.alert(
          'Dialpad Unavailable',
          'Phone dialer is not supported on this device.'
        );
        return;
      }
      await Linking.openURL(telUrl);
    } catch {
      Alert.alert('Error', 'Unable to open phone dialpad.');
    }
  };

  const persistAvatarToProfile = async (newAvatarUrl: string) => {
    if (!isOwnProfile) {
      Alert.alert('Not Allowed', 'You can only update your own profile photo.');
      return;
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    const user = session?.user;
    const userId = user?.id || currentUserId;
    if (!userId || userId !== targetProfileId) {
      throw new Error('You can only update your own profile photo.');
    }

    const resolvedUsername = buildFallbackUsername(handle, user?.email, userId);

    const { data: updatedRows, error: updateError } = await supabase
      .from('profiles')
      .update({
        username: resolvedUsername,
        avatar_url: newAvatarUrl,
      })
      .eq('id', userId)
      .select('id');

    if (updateError) throw updateError;

    if (!updatedRows || updatedRows.length === 0) {
      const { error: insertError } = await supabase.from('profiles').insert({
        id: userId,
        username: resolvedUsername,
        avatar_url: newAvatarUrl,
      });

      if (insertError) throw insertError;
    }

    if (!handle) {
      setHandle(resolvedUsername);
    }
    setAvatarUri(newAvatarUrl);
    setSharedAvatarUri(getResolvedAvatarUri(newAvatarUrl));
    DeviceEventEmitter.emit('profile-avatar-updated', {
      avatarUrl: newAvatarUrl,
      userId,
    });
  };

  const uploadAvatarToSupabase = async (localUri: string) => {
    if (!isOwnProfile) return;
    try {
      setUploadingAvatar(true);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const userId = sessionData.session?.user?.id || currentUserId;
      if (!userId || userId !== targetProfileId) {
        Alert.alert(
          'Not Allowed',
          'You can only update your own profile photo.'
        );
        return;
      }

      const base64Image = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!base64Image) {
        throw new Error('Selected image is empty or could not be read.');
      }

      const arrayBuffer = decode(base64Image);
      const fileName = `avatar_${Date.now()}.jpg`;
      const filePath = `${userId}/${fileName}`;

      const { data, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(data.path);

      const newAvatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      await persistAvatarToProfile(newAvatarUrl);

      setIsAvatarModalOpen(false);
      Alert.alert('Success', 'Profile photo updated successfully!');
    } catch (error: any) {
      console.error('AVATAR UPLOAD ERROR:', error);
      Alert.alert(
        'Upload Failed',
        error?.message || 'Something went wrong while uploading photo.'
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const pickFromGallery = async () => {
    if (!isOwnProfile) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission Required',
        'Please allow gallery access to select a photo.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      await uploadAvatarToSupabase(result.assets[0].uri);
    }
  };

  const takePhotoWithCamera = async () => {
    if (!isOwnProfile) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission Required',
        'Please allow camera access to take a photo.'
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      await uploadAvatarToSupabase(result.assets[0].uri);
    }
  };

  const saveAvatarFromUrl = async () => {
    if (!isOwnProfile) return;
    const cleanUrl = urlInput.trim();
    if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
      Alert.alert('Error', 'Please paste a valid http/https image URL.');
      return;
    }

    try {
      setUploadingAvatar(true);
      await persistAvatarToProfile(cleanUrl);
      setUrlInput('');
      setIsAvatarModalOpen(false);
      Alert.alert('Success', 'Profile picture updated!');
    } catch (error: any) {
      console.error('AVATAR URL ERROR:', error);
      Alert.alert(
        'Update Failed',
        error?.message || 'Could not update image URL.'
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const validateMobileDraft = (
    digitsRaw: string,
    country: CountryCodeItem
  ): boolean => {
    const digits = sanitizeMobileDigits(digitsRaw);
    if (!digits) {
      setMobileError('');
      return true;
    }
    if (digits.length < 7 || digits.length > 15) {
      setMobileError(
        `Enter a valid mobile number for ${country.country} (7–15 digits).`
      );
      return false;
    }
    setMobileError('');
    return true;
  };

  const openEditModal = () => {
    if (!isOwnProfile) return;
    setDraftName(name);
    setDraftHandle(handle);
    setDraftCity(city);
    const initialCountry = findCountryByCode(countryCode);
    setDraftCountry(initialCountry);
    setDraftCountryISO(initialCountry.iso2 as CountryCode);
    setDraftMobile(mobileNumber);
    setMobileError('');
    setDraftBio(bio);
    setUsernameError('');

    setSelectedDate(parseDOB(dob));
    setIsDatePickerVisible(false);
    setCitySuggestions([]);
    setSearchingCities(false);
    setIsEditModalOpen(true);
  };

  const handleUsernameChange = async (text: string) => {
    const formatted = normalizeHandle(text);
    setDraftHandle(formatted);

    const plainDraft = formatted.replace(/^@+/, '');
    const plainCurrent = handle.replace(/^@+/, '');

    if (plainDraft.length > 0 && plainDraft.length < 6) {
      setUsernameError('Username must be at least 6 characters.');
      return;
    }

    if (plainDraft && plainDraft !== plainCurrent) {
      const { data } = await supabase
        .from('profiles')
        .select('id, username')
        .or(`username.ilike.${plainDraft},username.ilike.@${plainDraft}`)
        .limit(5);

      const takenByOther = (data || []).some(
        (row) => row.id !== currentUserId
      );

      if (takenByOther) {
        setUsernameError('This username is already registered.');
      } else {
        setUsernameError('');
      }
    } else {
      setUsernameError('');
    }
  };

  const saveProfileChanges = async () => {
    if (!isOwnProfile || savingProfile) return;

    if (usernameError) {
      Alert.alert('Error', 'Please fix the username error before saving.');
      return;
    }

    const formattedHandle = normalizeHandle(draftHandle);
    const plainDraft = formattedHandle.replace(/^@+/, '');
    if (plainDraft && plainDraft.length < 6) {
      setUsernameError('Username must be at least 6 characters.');
      return;
    }

    const cleanDigits = sanitizeMobileDigits(draftMobile);
    if (!validateMobileDraft(cleanDigits, draftCountry)) {
      return;
    }

    try {
      setSavingProfile(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id || currentUserId;

      if (!userId || userId !== targetProfileId) {
        Alert.alert('Not Allowed', 'You can only edit your own profile.');
        return;
      }

      const finalDob = formatDOB(selectedDate);
      const cleanName = draftName.trim();
      const cleanCity = draftCity.trim();
      const cleanBio = draftBio.trim();

      const updatedFields = {
        full_name: cleanName,
        username: formattedHandle,
        city: cleanCity,
        country_code: draftCountry.code,
        mobile_number: cleanDigits || null,
        dob: finalDob,
        bio: cleanBio,
        is_profile_completed: true,
      };

      const { data: updatedRows, error: updateError } = await supabase
        .from('profiles')
        .update(updatedFields)
        .eq('id', userId)
        .select('id');

      if (updateError) throw updateError;

      if (!updatedRows || updatedRows.length === 0) {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({ id: userId, ...updatedFields });

        if (insertError) throw insertError;
      }

      setName(cleanName);
      setHandle(formattedHandle);
      setCity(cleanCity);
      setCountryCode(draftCountry.code);
      setMobileNumber(cleanDigits);
      setDob(finalDob);
      setBio(cleanBio);
      setSharedAvatarUri(getResolvedAvatarUri(avatarUri));
      setIsProfileCompleted(true);

      setIsEditModalOpen(false);
      Alert.alert('Success', 'Profile updated successfully!');
    } catch (error: any) {
      Alert.alert(
        'Update Failed',
        error?.message || 'Could not update profile.'
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCitySearch = (text: string) => {
    setDraftCity(text);

    if (citySearchTimerRef.current) {
      clearTimeout(citySearchTimerRef.current);
      citySearchTimerRef.current = null;
    }
    if (cityAbortControllerRef.current) {
      cityAbortControllerRef.current.abort();
      cityAbortControllerRef.current = null;
    }

    const query = text.trim();
    if (query.length < 2) {
      setCitySuggestions([]);
      setSearchingCities(false);
      return;
    }

    setSearchingCities(true);
    citySearchTimerRef.current = setTimeout(async () => {
      try {
        const controller = new AbortController();
        cityAbortControllerRef.current = controller;

        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${encodeURIComponent(
          query
        )}`;
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'VibeSphereApp/1.0 (contact@vibesphere.app)',
          },
        });

        if (!response.ok) {
          setCitySuggestions([]);
          return;
        }

        const places = (await response.json()) as any[];
        const formattedSuggestions: string[] = [];
        const seen = new Set<string>();

        for (const place of Array.isArray(places) ? places : []) {
          const addr = place?.address || {};
          const cityName =
            addr.city ||
            addr.town ||
            addr.village ||
            addr.municipality ||
            addr.county ||
            (typeof place?.display_name === 'string'
              ? place.display_name.split(',')[0]?.trim()
              : '');
          const countryName = addr.country ? String(addr.country).trim() : '';

          const label =
            cityName && countryName
              ? `${cityName}, ${countryName}`
              : typeof place?.display_name === 'string'
                ? place.display_name
                    .split(',')
                    .map((part: string) => part.trim())
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(', ')
                : '';

          if (label && !seen.has(label.toLowerCase())) {
            seen.add(label.toLowerCase());
            formattedSuggestions.push(label);
          }
        }

        setCitySuggestions(formattedSuggestions);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setCitySuggestions([]);
        }
      } finally {
        setSearchingCities(false);
      }
    }, 350);
  };

  const selectCitySuggestion = (selectedCity: string) => {
    if (citySearchTimerRef.current) {
      clearTimeout(citySearchTimerRef.current);
      citySearchTimerRef.current = null;
    }
    setDraftCity(selectedCity);
    setCitySuggestions([]);
    setSearchingCities(false);
  };

  const followButtonLabel = isFollowingTarget
    ? 'Following'
    : isFollowedByTarget
      ? 'Follow Back'
      : 'Follow';

  const currentData =
    activeTab === 'posts'
      ? MERGED_POSTS_AND_SHORTS
      : activeTab === 'videos'
        ? MY_VIDEOS
        : LIVE_ITEMS;

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: 'center', alignItems: 'center' },
        ]}
      >
        <ActivityIndicator size="large" color="#059669" />
        <Text style={{ marginTop: 10, color: '#64748b', fontWeight: '600' }}>
          Loading profile...
        </Text>
      </View>
    );
  }

  const displayedAvatarUri = getResolvedAvatarUri(avatarUri);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* TOP HEADER */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!isOwnProfile && (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => {
                setForceOwnMode(false);
                if (router.canGoBack()) {
                  router.back();
                } else {
                  setForceOwnMode(true);
                  fetchUserProfile(true);
                }
              }}
              activeOpacity={0.75}
            >
              <Ionicons name="arrow-back" size={18} color="#0f172a" />
            </TouchableOpacity>
          )}
          <Text style={styles.headerHandle}>{handle || '@user'}</Text>
          <Ionicons
            name="checkmark-circle"
            size={14}
            color="#059669"
            style={{ marginLeft: 4 }}
          />
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={handleShareProfile}
            activeOpacity={0.75}
          >
            <Ionicons name="share-social-outline" size={18} color="#0f172a" />
          </TouchableOpacity>

          {isOwnProfile && (
            <>
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={() => router.push('/settings' as any)}
                activeOpacity={0.75}
              >
                <Ionicons name="settings-outline" size={18} color="#0f172a" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.headerIconBtn, styles.logoutIconBtn]}
                onPress={handleLogout}
                disabled={loggingOut}
                activeOpacity={0.75}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color="#dc2626" />
                ) : (
                  <Ionicons name="log-out-outline" size={18} color="#dc2626" />
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* PROFILE IDENTITY CARD */}
        <View style={styles.profileCard}>
          <View style={styles.profileTopRow}>
            <View style={styles.avatarContainer}>
              <Image source={{ uri: displayedAvatarUri }} style={styles.avatar} />
              {isOwnProfile && (
                <TouchableOpacity
                  style={styles.avatarCameraBadge}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (!isOwnProfile) return;
                    setUrlInput('');
                    setIsAvatarModalOpen(true);
                  }}
                >
                  <Ionicons name="camera" size={12} color="#ffffff" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.statsContainer}>
              <TouchableOpacity
                style={styles.statBox}
                onPress={() => openConnectionsScreen('followers')}
                activeOpacity={0.75}
              >
                <Text style={styles.statNumber}>{followersDisplay}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.statBox}
                onPress={() => openConnectionsScreen('following')}
                activeOpacity={0.75}
              >
                <Text style={styles.statNumber}>{followingDisplay}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.statBox}
                onPress={() => openConnectionsScreen('subscriptions')}
                activeOpacity={0.75}
              >
                <Text style={styles.statNumber}>{subscriptionsDisplay}</Text>
                <Text style={styles.statLabel}>Subscriptions</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* BIO & ICON OPTIONS SECTION */}
          <View style={styles.bioSection}>
            <View style={styles.nameRow}>
              <View style={styles.nameTitleLeft}>
                <Text style={styles.fullName} numberOfLines={1}>
                  {name || 'VibeSphere User'}
                </Text>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color="#059669"
                  style={{ marginLeft: 5 }}
                />
              </View>

              <View style={styles.nameActionIcons}>
                {canShowLocationIcon && (
                  <TouchableOpacity
                    style={styles.nameActionIconBtn}
                    onPress={handleOpenLocationPopup}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name="location-outline"
                      size={17}
                      color="#059669"
                    />
                  </TouchableOpacity>
                )}

                {canShowBirthdayIcon && (
                  <TouchableOpacity
                    style={[
                      styles.nameActionIconBtn,
                      birthdayActiveToday && styles.birthdayTodayIconBtn,
                    ]}
                    onPress={handleOpenBirthdayPopup}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name="gift-outline"
                      size={17}
                      color={birthdayActiveToday ? '#d97706' : '#059669'}
                    />
                  </TouchableOpacity>
                )}

                {canShowCallIcon && (
                  <TouchableOpacity
                    style={styles.nameActionIconBtn}
                    onPress={handleOpenDialpad}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="call-outline" size={17} color="#059669" />
                  </TouchableOpacity>
                )}

                {isOwnProfile && (
                  <TouchableOpacity
                    style={styles.nameActionIconBtn}
                    onPress={openEditModal}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="create-outline" size={18} color="#059669" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {bio ? <Text style={styles.bioText}>{bio}</Text> : null}
          </View>

          {/* OTHER USER FOLLOW & MESSAGE ACTIONS */}
          {!isOwnProfile && (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.primaryActionBtn,
                  isFollowingTarget && styles.followingStateBtn,
                ]}
                onPress={handleToggleFollowOnProfile}
                disabled={updatingFollow}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.primaryActionText,
                    isFollowingTarget && styles.followingStateText,
                  ]}
                >
                  {followButtonLabel}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.messageActionBtn}
                onPress={handleMessageUser}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={16}
                  color="#059669"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.messageActionText}>Message</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* CONTENT TABS */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[
              styles.tabItem,
              activeTab === 'posts' && styles.activeTabItem,
            ]}
            onPress={() => setActiveTab('posts')}
          >
            <Ionicons
              name="grid-outline"
              size={18}
              color={activeTab === 'posts' ? '#059669' : '#64748b'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tabItem,
              activeTab === 'videos' && styles.activeTabItem,
            ]}
            onPress={() => setActiveTab('videos')}
          >
            <Ionicons
              name="videocam-outline"
              size={20}
              color={activeTab === 'videos' ? '#059669' : '#64748b'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tabItem,
              activeTab === 'live' && styles.activeTabItem,
            ]}
            onPress={() => setActiveTab('live')}
          >
            <Ionicons
              name="radio-outline"
              size={20}
              color={activeTab === 'live' ? '#059669' : '#64748b'}
            />
          </TouchableOpacity>
        </View>

        {/* CONTENT FEED */}
        {activeTab === 'posts' ? (
          <View style={styles.gridContainer}>
            {currentData.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.gridCard}
                onPress={() => router.push(`/media/${item.id}`)}
                activeOpacity={0.85}
              >
                <Image
                  source={{ uri: item.thumbnail }}
                  style={styles.gridThumb}
                />
                <View style={styles.gridOverlay} />
                <View style={styles.gridFooter}>
                  {Boolean(item.views) && (
                    <View style={styles.viewsRow}>
                      <Ionicons
                        name="play"
                        size={9}
                        color="#ffffff"
                        style={{ marginRight: 3 }}
                      />
                      <Text style={styles.gridViews}>{item.views}</Text>
                    </View>
                  )}
                  <Text style={styles.gridTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.listContainer}>
            {currentData.map((item, idx) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.videoRowItem,
                  idx === currentData.length - 1 && styles.lastRowItem,
                ]}
                onPress={() => router.push(`/media/${item.id}`)}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: item.thumbnail }}
                  style={styles.listThumbImage}
                  resizeMode="cover"
                />
                <View style={styles.listDetailsBox}>
                  <Text style={styles.listTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View style={styles.listMetaRow}>
                    <Text style={styles.listViewsText}>
                      {item.views || '0'} views
                    </Text>
                    {Boolean(item.uploadDate) && (
                      <>
                        <Text style={styles.listDot}>•</Text>
                        <Text style={styles.listDateText}>
                          {item.uploadDate}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* INFO POPUP MODAL (VISIBLE LOCATION & BIRTHDAY) */}
      <Modal
        visible={Boolean(infoPopup)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setInfoPopup(null)}
      >
        <View style={styles.infoPopupBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setInfoPopup(null)}
          />
          {infoPopup && (
            <View style={styles.infoPopupCard}>
              <View style={styles.infoPopupTopRow}>
                <View
                  style={[
                    styles.infoPopupBadge,
                    infoPopup.isBirthdayToday && styles.infoPopupBirthdayBadge,
                  ]}
                >
                  <Ionicons
                    name={infoPopup.icon}
                    size={22}
                    color={infoPopup.isBirthdayToday ? '#d97706' : '#059669'}
                  />
                </View>
                <TouchableOpacity
                  style={styles.infoPopupCloseBtn}
                  onPress={() => setInfoPopup(null)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="close" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>

              <Text style={styles.infoPopupTitle}>{infoPopup.title}</Text>
              <Text style={styles.infoPopupSubtitle}>{infoPopup.subtitle}</Text>

              <View
                style={[
                  styles.infoPopupValueBox,
                  infoPopup.isBirthdayToday && styles.infoPopupBirthdayBox,
                ]}
              >
                <Text
                  style={[
                    styles.infoPopupValueText,
                    infoPopup.isBirthdayToday && styles.infoPopupBirthdayText,
                  ]}
                >
                  {infoPopup.value}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.infoPopupDoneBtn,
                  infoPopup.isBirthdayToday && styles.infoPopupBirthdayBtn,
                ]}
                onPress={() => setInfoPopup(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.infoPopupDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* CHANGE PROFILE PICTURE MODAL (OWN PROFILE ONLY) */}
      <Modal
        visible={isOwnProfile && isAvatarModalOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsAvatarModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => !uploadingAvatar && setIsAvatarModalOpen(false)}
          />

          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Change Profile Photo</Text>
              <TouchableOpacity
                onPress={() => !uploadingAvatar && setIsAvatarModalOpen(false)}
              >
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {uploadingAvatar ? (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#059669" />
                <Text
                  style={{ marginTop: 12, color: '#0f172a', fontWeight: '700' }}
                >
                  Uploading photo...
                </Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.photoOptionRow}
                  onPress={pickFromGallery}
                  activeOpacity={0.75}
                >
                  <View style={styles.photoOptionIcon}>
                    <Ionicons
                      name="images-outline"
                      size={20}
                      color="#059669"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.photoOptionTitle}>
                      Choose from Gallery
                    </Text>
                    <Text style={styles.photoOptionSub}>
                      Select a photo from your device
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.photoOptionRow}
                  onPress={takePhotoWithCamera}
                  activeOpacity={0.75}
                >
                  <View style={styles.photoOptionIcon}>
                    <Ionicons
                      name="camera-outline"
                      size={20}
                      color="#059669"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.photoOptionTitle}>Take a Photo</Text>
                    <Text style={styles.photoOptionSub}>
                      Capture a new photo with your camera
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </TouchableOpacity>

                <Text style={[styles.inputLabel, { marginTop: 14 }]}>
                  OR PASTE IMAGE URL FROM BROWSER
                </Text>
                <View style={styles.urlRow}>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={urlInput}
                    onChangeText={setUrlInput}
                    placeholder="https://example.com/photo.jpg"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.urlSaveBtn}
                    onPress={saveAvatarFromUrl}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.urlSaveText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* EDIT PROFILE MODAL (OWN PROFILE ONLY) */}
      <Modal
        visible={isOwnProfile && isEditModalOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => !savingProfile && setIsEditModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Edit Profile</Text>
              <TouchableOpacity
                onPress={() => !savingProfile && setIsEditModalOpen(false)}
              >
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 460 }}
            >
              {!isProfileCompleted && (
                <View style={styles.editWelcomeBanner}>
                  <Ionicons
                    name="sparkles-outline"
                    size={16}
                    color="#059669"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.editWelcomeText}>
                    Welcome! Complete your profile details to finish setup.
                  </Text>
                </View>
              )}

              <Text style={styles.inputLabel}>FULL NAME</Text>
              <TextInput
                style={styles.textInput}
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Enter your name"
                placeholderTextColor="#94a3b8"
              />

              <Text style={styles.inputLabel}>USERNAME</Text>
              <TextInput
                style={[
                  styles.textInput,
                  usernameError ? styles.inputErrorBorder : null,
                ]}
                value={draftHandle}
                onChangeText={handleUsernameChange}
                placeholder="@username"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
              />
              {Boolean(usernameError) && (
                <Text style={styles.errorText}>{usernameError}</Text>
              )}

              <Text style={styles.inputLabel}>CITY</Text>
              <TextInput
                style={styles.textInput}
                value={draftCity}
                onChangeText={handleCitySearch}
                placeholder="Type city name to search..."
                placeholderTextColor="#94a3b8"
              />
              {searchingCities && (
                <View style={styles.suggestionLoadingRow}>
                  <ActivityIndicator size="small" color="#059669" />
                  <Text style={styles.suggestionLoadingText}>
                    Searching cities...
                  </Text>
                </View>
              )}
              {citySuggestions.length > 0 && (
                <View style={styles.suggestionBox}>
                  {citySuggestions.map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={styles.suggestionItem}
                      onPress={() => selectCitySuggestion(item)}
                    >
                      <Ionicons
                        name="location-outline"
                        size={14}
                        color="#059669"
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.suggestionText} numberOfLines={1}>
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.inputLabel}>MOBILE NUMBER</Text>
              <View style={styles.phoneRow}>
                <TouchableOpacity
                  style={styles.countryBtn}
                  onPress={() => setIsCountryModalOpen(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.countryFlagText}>
                    {draftCountry.flag}
                  </Text>
                  <Text style={styles.countryCodeText}>
                    {draftCountry.code}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color="#475569" />
                </TouchableOpacity>

                <TextInput
                  style={[
                    styles.textInput,
                    { flex: 1 },
                    mobileError ? styles.inputErrorBorder : null,
                  ]}
                  value={draftMobile}
                  onChangeText={(text) => {
                    const digits = sanitizeMobileDigits(text);
                    setDraftMobile(digits);
                    if (mobileError) setMobileError('');
                  }}
                  placeholder="Enter mobile number"
                  placeholderTextColor="#94a3b8"
                  keyboardType="phone-pad"
                  maxLength={draftCountry.maxDigits}
                />
              </View>
              {Boolean(mobileError) && (
                <Text style={styles.errorText}>{mobileError}</Text>
              )}

              <Text style={styles.inputLabel}>DATE OF BIRTH</Text>
              <TouchableOpacity
                style={styles.dobBox}
                onPress={() => setIsDatePickerVisible(true)}
              >
                <Text style={styles.dobText}>{formatDOB(selectedDate)}</Text>
                <Ionicons name="calendar-outline" size={18} color="#059669" />
              </TouchableOpacity>

              {isDatePickerVisible && (
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={new Date()}
                  onChange={(_, date) => {
                    setIsDatePickerVisible(false);
                    if (date) {
                      setSelectedDate(date);
                    }
                  }}
                />
              )}

              <Text style={styles.inputLabel}>BIO</Text>
              <TextInput
                style={[styles.textInput, styles.bioInput]}
                value={draftBio}
                onChangeText={setDraftBio}
                placeholder="Write something about yourself..."
                placeholderTextColor="#94a3b8"
                multiline
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsEditModalOpen(false)}
                disabled={savingProfile}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, savingProfile && { opacity: 0.7 }]}
                onPress={saveProfileChanges}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* COUNTRY PICKER */}
      {isOwnProfile && isCountryModalOpen && (
        <CountryPicker
          visible={isCountryModalOpen}
          withFilter
          withFlag
          withCallingCode
          withCountryNameButton={false}
          countryCode={draftCountryISO}
          onClose={() => setIsCountryModalOpen(false)}
          onSelect={(country: Country) => {
            const calling =
              country.callingCode && country.callingCode[0]
                ? `+${country.callingCode[0]}`
                : '+91';
            const iso = country.cca2 as CountryCode;
            const nextCountry: CountryCodeItem = {
              code: calling,
              country: getCountryName(iso),
              flag: getCountryFlag(iso),
              minDigits: 7,
              maxDigits: 15,
              iso2: iso,
            };
            setDraftCountry(nextCountry);
            setDraftCountryISO(iso);
            setIsCountryModalOpen(false);
            if (draftMobile) {
              validateMobileDraft(draftMobile, nextCountry);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
}

const GRID_GAP = 1;
const GRID_ITEM_WIDTH = (width - GRID_GAP * 2) / 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIconBtn: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  backBtn: {
    marginRight: 8,
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerHandle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  profileCard: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#e2e8f0',
    borderWidth: 2,
    borderColor: '#059669',
  },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  statsContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginLeft: 12,
  },
  statBox: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '500',
  },
  bioSection: {
    marginTop: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  fullName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  nameActionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nameActionIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayTodayIconBtn: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  bioText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  primaryActionBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followingStateBtn: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#059669',
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  followingStateText: {
    color: '#059669',
  },
  messageActionBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageActionText: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '700',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabItem: {
    borderBottomColor: '#059669',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    backgroundColor: '#ffffff',
  },
  gridCard: {
    width: GRID_ITEM_WIDTH,
    height: GRID_ITEM_WIDTH * 1.25,
    position: 'relative',
    backgroundColor: '#e2e8f0',
  },
  gridThumb: {
    width: '100%',
    height: '100%',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
  },
  gridFooter: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
  },
  viewsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  gridViews: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  gridTitle: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  listContainer: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
  },
  videoRowItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  lastRowItem: {
    borderBottomWidth: 0,
  },
  listThumbImage: {
    width: 118,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  listDetailsBox: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  listTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 18,
  },
  listMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  listViewsText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  listDot: {
    marginHorizontal: 6,
    color: '#94a3b8',
  },
  listDateText: {
    fontSize: 12,
    color: '#64748b',
  },
  infoPopupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  infoPopupCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  infoPopupTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  infoPopupBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPopupBirthdayBadge: {
    backgroundColor: '#fffbeb',
  },
  infoPopupCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPopupTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  infoPopupSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 3,
  },
  infoPopupValueBox: {
    marginTop: 14,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  infoPopupBirthdayBox: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  infoPopupValueText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#065f46',
  },
  infoPopupBirthdayText: {
    color: '#92400e',
  },
  infoPopupDoneBtn: {
    marginTop: 16,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPopupBirthdayBtn: {
    backgroundColor: '#d97706',
  },
  infoPopupDoneText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  photoOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  photoOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  photoOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  photoOptionSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  urlSaveBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlSaveText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  editWelcomeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  editWelcomeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#065f46',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 10,
    marginBottom: 5,
    letterSpacing: 0.4,
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  inputErrorBorder: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  suggestionLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  suggestionLoadingText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  suggestionBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    marginTop: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  suggestionText: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countryBtn: {
    height: 44,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  countryFlagText: {
    fontSize: 16,
  },
  countryCodeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  dobBox: {
    height: 44,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dobText: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '600',
  },
  bioInput: {
    height: 76,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  saveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});