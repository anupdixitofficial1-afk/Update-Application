import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  KeyboardAvoidingView,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import CountryPicker, {
  type Country,
  type CountryCode,
} from 'react-native-country-picker-modal';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';
import { backend } from '../../lib/backend';
import { useProfileAvatar } from '../../lib/profileAvatar';
import { ProfileSkeleton } from '../../components/SkeletonLoader';
import {
  BrandedShareModal,
  ShareCardPayload,
} from '../../components/BrandedShareModal';
import {
  buildInviteUrl,
  COLLECTIONS_UPDATED_EVENT,
  getReferralState,
  getVibeCollections,
  getVibeStreak,
  GROWTH_UPDATED_EVENT,
  incrementReferralProgress,
  ReferralState,
  VibeCollection,
} from '../../lib/growthFeatures';

let ScreenCapture: any = null;
try {
  ScreenCapture = require('expo-screen-capture');
} catch {
  ScreenCapture = null;
}

const FOLLOWS_UPDATED_EVENT = 'follows-updated';
const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';

type ThemeMode = 'light' | 'dark' | 'system';

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
  const phoneIso = matchedIso || 'IN';
  const iso: CountryCode = phoneIso as CountryCode;
  return {
    code: `+${getCountryCallingCode(phoneIso)}`,
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

  const nestedVisibility =
    row.visibility && typeof row.visibility === 'object'
      ? row.visibility
      : row.privacy_settings && typeof row.privacy_settings === 'object'
        ? row.privacy_settings
        : null;

  for (const key of keys) {
    const val = row[key] !== undefined ? row[key] : nestedVisibility?.[key];
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      if (
        lower === 'true' ||
        lower === '1' ||
        lower === 'yes' ||
        lower === 'public' ||
        lower === 'visible' ||
        lower === 'all' ||
        lower === 'followers'
      ) {
        return true;
      }
      if (
        lower === 'false' ||
        lower === '0' ||
        lower === 'no' ||
        lower === 'private' ||
        lower === 'hidden' ||
        lower === 'none'
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

interface MediaPost {
  id: string;
  title: string;
  views?: string;
  duration?: string;
  thumbnail: string;
  type: 'post' | 'video' | 'short';
  uploadDate?: string;
}

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
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const { setAvatarUri: setSharedAvatarUri } = useProfileAvatar();
  const params = useLocalSearchParams<{
    userId?: string;
    username?: string;
    fromConnect?: string;
  }>();

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const colors = useMemo(
    () => ({
      bg: isDark ? '#09090b' : '#ffffff',
      surface: isDark ? '#18181b' : '#f4f4f5',
      card: isDark ? '#18181b' : '#ffffff',
      border: isDark ? '#27272a' : '#f4f4f5',
      borderStrong: isDark ? '#3f3f46' : '#e4e4e7',
      text: isDark ? '#fafafa' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#52525b',
      muted: isDark ? '#71717a' : '#71717a',
      accent: isDark ? '#fafafa' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
      inputBg: isDark ? '#27272a' : '#f4f4f5',
      dangerBg: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fef2f2',
      danger: '#ef4444',
      igBlue: '#0095f6',
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

  const [forceOwnMode, setForceOwnMode] = useState(false);

  const [activeTab, setActiveTab] = useState<'posts' | 'videos' | 'live'>('posts');
  const [postsContent, setPostsContent] = useState<MediaPost[]>([]);
  const [videosContent, setVideosContent] = useState<MediaPost[]>([]);
  const [liveContent, setLiveContent] = useState<MediaPost[]>([]);
  const [showPostsTab, setShowPostsTab] = useState(true);
  const [showVideosTab, setShowVideosTab] = useState(true);
  const [showLiveTab, setShowLiveTab] = useState(true);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [vibeStreakDays, setVibeStreakDays] = useState(1);
  const [referralState, setReferralState] = useState<ReferralState>({
    invitedCount: 0,
    tierLabel: 'New Member',
    nextTarget: 1,
  });
  const [collections, setCollections] = useState<VibeCollection[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isCollectionsModalOpen, setIsCollectionsModalOpen] = useState(false);
  const [shareProfileCard, setShareProfileCard] =
    useState<ShareCardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
  const [isFollowingTarget, setIsFollowingTarget] = useState(false);
  const [isFollowedByTarget, setIsFollowedByTarget] = useState(false);
  const [isBlockedByMe, setIsBlockedByMe] = useState(false);
  const [isBlockingMe, setIsBlockingMe] = useState(false);
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

  const sheetBottomPadding = Math.max(insets.bottom + 14, 26);

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

  // Screenshot Alert + Screenshot Protection + Profile View Alert via backend
  useEffect(() => {
    if (isOwnProfile || !targetProfileId || !currentUserId) return;

    let screenshotSub: any = null;
    let prevented = false;
    let active = true;

    (async () => {
      try {
        const privacy = await backend.profile.getPrivacySettings(targetProfileId);
        if (!active || !privacy) return;

        if (privacy.profileViewAlerts) {
          void backend.profile
            .sendNotification({
              userId: targetProfileId,
              actorId: currentUserId,
              type: 'profile_view',
              message: 'viewed your profile.',
            })
            .catch(() => {});
        }

        if (
          privacy.preventScreenshots &&
          ScreenCapture?.preventScreenCaptureAsync
        ) {
          prevented = true;
          ScreenCapture.preventScreenCaptureAsync().catch(() => {});
        }

        if (
          privacy.screenshotAlerts &&
          ScreenCapture?.addScreenshotListener
        ) {
          screenshotSub = ScreenCapture.addScreenshotListener(() => {
            void backend.profile
              .sendNotification({
                userId: targetProfileId,
                actorId: currentUserId,
                type: 'profile_screenshot',
                message: 'took a screenshot of your profile.',
              })
              .catch(() => {});
          });
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      active = false;
      screenshotSub?.remove?.();
      if (prevented && ScreenCapture?.allowScreenCaptureAsync) {
        ScreenCapture.allowScreenCaptureAsync().catch(() => {});
      }
    };
  }, [isOwnProfile, targetProfileId, currentUserId]);

  const canShowLocationIcon = Boolean(city.trim()) && showLocation;
  const canShowBirthdayIcon = Boolean(dob.trim()) && showDob;
  const canShowCallIcon =
    Boolean(sanitizeMobileDigits(mobileNumber)) && showPhone;
  const birthdayActiveToday = isBirthdayToday(dob);

  const visibleTabs = useMemo(() => {
    const list: Array<'posts' | 'videos' | 'live'> = [];
    if (isOwnProfile || showPostsTab) list.push('posts');
    if (isOwnProfile || showVideosTab) list.push('videos');
    if (isOwnProfile || showLiveTab) list.push('live');
    return list;
  }, [isOwnProfile, showPostsTab, showVideosTab, showLiveTab]);

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [visibleTabs, activeTab]);

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
        const rel = await backend.profile.getFollowRelationship(
          activeViewer,
          activeViewed
        );
        setIsFollowingTarget(rel.isFollowing);
        setIsFollowedByTarget(rel.isFollowedBy);
      } catch {
        // Keep current state on transient network error
      }
    },
    [currentUserId, targetProfileId]
  );

  const syncBlockStatus = useCallback(
    async (viewerId?: string | null, viewedId?: string | null) => {
      const activeViewer = viewerId ?? currentUserId;
      const activeViewed = viewedId ?? targetProfileId;

      if (!activeViewer || !activeViewed || activeViewer === activeViewed) {
        setIsBlockedByMe(false);
        setIsBlockingMe(false);
        return;
      }

      try {
        const status = await backend.profile.getBlockStatus(
          activeViewer,
          activeViewed
        );
        setIsBlockedByMe(status.isBlockedByMe);
        setIsBlockingMe(status.isBlockingMe);
      } catch {
        // Keep current state on transient error
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
        const counts = await backend.profile.getProfileCounts(effectiveId);

        if (typeof counts.followersCount === 'number') {
          setFollowersDisplay(formatCompactCount(counts.followersCount, '0'));
        } else if (fallbackFollowers !== undefined) {
          setFollowersDisplay(formatCompactCount(fallbackFollowers, '0'));
        }

        if (typeof counts.followingCount === 'number') {
          setFollowingDisplay(formatCompactCount(counts.followingCount, '0'));
        } else if (fallbackFollowing !== undefined) {
          setFollowingDisplay(formatCompactCount(fallbackFollowing, '0'));
        }

        setSubscriptionsDisplay(
          formatCompactCount(counts.subscriptionsCount, '0')
        );
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
        [
          'show_city',
          'show_location',
          'location_visible',
          'is_city_visible',
          'location',
        ],
        defaultFlag
      );
      const dobVisible = parseVisibilityFlag(
        data,
        [
          'show_dob',
          'dob_visible',
          'is_dob_visible',
          'show_birthday',
          'dobDay',
        ],
        defaultFlag
      );
      const phoneVisible = parseVisibilityFlag(
        data,
        [
          'show_phone',
          'show_mobile',
          'phone_visible',
          'mobile_visible',
          'phone',
        ],
        defaultFlag
      );

      const postsVisible = parseVisibilityFlag(
        data,
        ['show_posts', 'showPosts', 'posts_visible', 'show_grid', 'show_shorts'],
        true
      );
      const videosVisible = parseVisibilityFlag(
        data,
        ['show_videos', 'showVideos', 'videos_visible', 'show_reels'],
        true
      );
      const liveVisible = parseVisibilityFlag(
        data,
        ['show_live', 'showLive', 'live_visible', 'show_stream'],
        true
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
      setShowPostsTab(postsVisible);
      setShowVideosTab(videosVisible);
      setShowLiveTab(liveVisible);

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
        const currentUser = await backend.auth.getCurrentUser().catch(() => null);
        const loggedInId = currentUser?.id ?? null;
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

          const [data, content, verifStatus, streakRes, refRes, colsRes] =
            await Promise.all([
              backend.profile.getProfileById(requestedId),
              backend.profile
                .getProfileContent(requestedId, loggedInId)
                .catch(() => ({ posts: [], videos: [], live: [] })),
              backend.profile
                .getVerificationStatus(requestedId)
                .catch(() => ({ isVerified: false, latestRequest: null })),
              getVibeStreak(requestedId),
              getReferralState(requestedId),
              getVibeCollections(requestedId),
            ]);

          setIsVerified(Boolean(verifStatus?.isVerified));
          setVibeStreakDays(streakRes.streakDays || 1);
          setReferralState(refRes);
          setCollections(colsRes);

          setPostsContent(content.posts);
          setVideosContent(content.videos);
          setLiveContent(content.live);

          if (loggedInId && requestedId !== loggedInId) {
            await Promise.all([
              syncFollowRelationship(loggedInId, requestedId),
              syncBlockStatus(loggedInId, requestedId),
            ]);
          } else {
            setIsFollowingTarget(false);
            setIsFollowedByTarget(false);
            setIsBlockedByMe(false);
            setIsBlockingMe(false);
          }

          if (data) {
            applyProfileRecord(data, isSelf);
            await refreshFollowCounts(
              requestedId,
              data.followers_count,
              data.following_count
            );
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
      syncBlockStatus,
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
    void fetchUserProfile(false);
  }, [fetchUserProfile]);

  useEffect(() => {
    if (!targetProfileId) return;

    const unsubscribe = backend.profile.subscribeProfileRow(
      targetProfileId,
      (nextRow) => {
        if (nextRow) {
          const isSelf = Boolean(
            currentUserId && targetProfileId === currentUserId
          );
          applyProfileRecord(nextRow, isSelf);
          void backend.profile
            .getVerificationStatus(targetProfileId)
            .then((s) => setIsVerified(Boolean(s?.isVerified)))
            .catch(() => {});
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [targetProfileId, currentUserId, applyProfileRecord]);

  useFocusEffect(
    useCallback(() => {
      if (forceOwnMode) {
        void fetchUserProfile(true);
        return;
      }

      if (paramUserId) {
        void fetchUserProfile(false);
        return;
      }

      if (params?.fromConnect === '1') {
        router.setParams({ fromConnect: undefined } as any);
        return;
      }

      void fetchUserProfile(true);
    }, [paramUserId, params?.fromConnect, forceOwnMode, fetchUserProfile])
  );

  useEffect(() => {
    const followsSub = DeviceEventEmitter.addListener(
      FOLLOWS_UPDATED_EVENT,
      (payload?: {
        followerId?: string;
        followingId?: string;
        status?: string;
      }) => {
        const activeTarget = targetProfileId || paramUserId || currentUserId;
        if (activeTarget) {
          void refreshFollowCounts(activeTarget);
        }
        if (currentUserId && activeTarget && currentUserId !== activeTarget) {
          void syncFollowRelationship(currentUserId, activeTarget);
          void syncBlockStatus(currentUserId, activeTarget);
        }
        if (
          currentUserId &&
          activeTarget === currentUserId &&
          (payload?.followerId === currentUserId ||
            payload?.followingId === currentUserId)
        ) {
          void refreshFollowCounts(currentUserId);
        }
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
          setIsBlockedByMe(false);
          setIsBlockingMe(false);
        }
        void fetchUserProfile(true);
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
        if (typeof payload.showPosts === 'boolean')
          setShowPostsTab(payload.showPosts);
        if (typeof payload.showVideos === 'boolean')
          setShowVideosTab(payload.showVideos);
        if (typeof payload.showLive === 'boolean')
          setShowLiveTab(payload.showLive);
      }
      void fetchUserProfile(false);
    };

    const privacySub1 = DeviceEventEmitter.addListener(
      'profile-privacy-updated',
      handlePrivacyEvent
    );
    const privacySub2 = DeviceEventEmitter.addListener(
      'privacy-settings-updated',
      handlePrivacyEvent
    );
    const mediaSub = DeviceEventEmitter.addListener(
      'watch-media-created',
      () => {
        void fetchUserProfile(false);
      }
    );

    return () => {
      followsSub.remove();
      profileTabSub.remove();
      privacySub1.remove();
      privacySub2.remove();
      mediaSub.remove();
    };
  }, [
    currentUserId,
    targetProfileId,
    paramUserId,
    refreshFollowCounts,
    syncFollowRelationship,
    syncBlockStatus,
    fetchUserProfile,
  ]);

  const handleShareProfile = async () => {
    setShareProfileCard({
      id: targetProfileId || currentUserId || 'profile',
      kind: 'profile',
      title: name || handle || 'VibeSphere Creator',
      creatorHandle: handle || '@user',
      thumbnailUrl: avatarUri || undefined,
    });
  };

  useEffect(() => {
    const uid = targetProfileId || currentUserId;
    const subCol = DeviceEventEmitter.addListener(
      COLLECTIONS_UPDATED_EVENT,
      () => {
        void getVibeCollections(uid).then(setCollections);
      }
    );
    const subGrowth = DeviceEventEmitter.addListener(GROWTH_UPDATED_EVENT, () => {
      void getVibeStreak(uid).then((s) => setVibeStreakDays(s.streakDays || 1));
      void getReferralState(uid).then(setReferralState);
    });
    return () => {
      subCol.remove();
      subGrowth.remove();
    };
  }, [targetProfileId, currentUserId]);

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
            await backend.auth.signOut();
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
    if (
      isOwnProfile ||
      !currentUserId ||
      !targetProfileId ||
      updatingFollow ||
      isBlockedByMe ||
      isBlockingMe
    )
      return;

    const willFollow = !isFollowingTarget;

    try {
      setUpdatingFollow(true);
      setIsFollowingTarget(willFollow);

      if (!willFollow) {
        await backend.connect.unfollowUser(currentUserId, targetProfileId);
      } else {
        await backend.connect.followUser(currentUserId, targetProfileId, false);
      }

      await Promise.all([
        refreshFollowCounts(targetProfileId),
        refreshFollowCounts(currentUserId),
        syncFollowRelationship(currentUserId, targetProfileId),
      ]);

      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
        followerId: currentUserId,
        followingId: targetProfileId,
        status: willFollow ? 'accepted' : 'removed',
      });
    } catch (err: any) {
      setIsFollowingTarget(!willFollow);
      Alert.alert(
        'Action Failed',
        err?.message || 'Could not update follow status.'
      );
      void fetchUserProfile(false);
    } finally {
      setUpdatingFollow(false);
    }
  };

  const handleUnblockOnProfile = async () => {
    if (!currentUserId || !targetProfileId || updatingFollow) return;
    try {
      setUpdatingFollow(true);
      await backend.profile.unblockUser(currentUserId, targetProfileId);

      setIsBlockedByMe(false);
      await Promise.all([
        refreshFollowCounts(targetProfileId),
        refreshFollowCounts(currentUserId),
        syncFollowRelationship(currentUserId, targetProfileId),
      ]);
      DeviceEventEmitter.emit(FOLLOWS_UPDATED_EVENT, {
        followerId: currentUserId,
        followingId: targetProfileId,
        status: 'unblocked',
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not unblock member.');
    } finally {
      setUpdatingFollow(false);
    }
  };

  const handleMessageUser = () => {
    if (isOwnProfile || !targetProfileId || isBlockedByMe || isBlockingMe) return;
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

  const handleOpenDialpad = async (overrideNumber?: string) => {
    const cleanDigits = sanitizeMobileDigits(mobileNumber);
    const cleanCode = (countryCode || '+91').replace(/[^\d+]/g, '');
    const dialNumber =
      (overrideNumber || (cleanCode ? `${cleanCode}${cleanDigits}` : cleanDigits)).replace(
        /\s+/g,
        ''
      );
    if (!dialNumber) return;
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

    const user = await backend.auth.getCurrentUser();
    const userId = user?.id || currentUserId;
    if (!userId || userId !== targetProfileId) {
      throw new Error('You can only update your own profile photo.');
    }

    const resolvedUsername = buildFallbackUsername(handle, user?.email, userId);

    await backend.profile.upsertProfile(userId, {
      username: resolvedUsername,
      avatar_url: newAvatarUrl,
    });

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

  const uploadAvatar = async (localUri: string) => {
    if (!isOwnProfile) return;
    try {
      setUploadingAvatar(true);

      const user = await backend.auth.getCurrentUser();
      const userId = user?.id || currentUserId;
      if (!userId || userId !== targetProfileId) {
        Alert.alert(
          'Not Allowed',
          'You can only update your own profile photo.'
        );
        return;
      }

      const newAvatarUrl = await backend.storage.uploadAvatar(userId, localUri);
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
      await uploadAvatar(result.assets[0].uri);
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
      await uploadAvatar(result.assets[0].uri);
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
      try {
        const available = await backend.profile.isUsernameAvailableForUser(
          plainDraft,
          currentUserId
        );
        setUsernameError(
          available ? '' : 'This username is already registered.'
        );
      } catch {
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
      const user = await backend.auth.getCurrentUser();
      const userId = user?.id || currentUserId;

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

      await backend.profile.upsertProfile(userId, updatedFields);

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
      ? postsContent
      : activeTab === 'videos'
        ? videosContent
        : liveContent;

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bg }]}
        edges={['top']}
      >
        <ProfileSkeleton isDark={isDark} />
      </SafeAreaView>
    );
  }

  const displayedAvatarUri = getResolvedAvatarUri(avatarUri);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      {/* INSTAGRAM-STYLE TOP HEADER */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
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
                  void fetchUserProfile(true);
                }
              }}
              activeOpacity={0.75}
            >
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </TouchableOpacity>
          )}
          <Text
            style={[styles.headerHandle, { color: colors.text }]}
            numberOfLines={1}
          >
            {handle || '@user'}
          </Text>
          {isVerified && (
            <Ionicons
              name="checkmark-circle"
              size={16}
              color={colors.igBlue}
              style={{ marginLeft: 4 }}
            />
          )}
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => void handleShareProfile()}
            activeOpacity={0.7}
          >
            <Ionicons
              name="share-social-outline"
              size={20}
              color={colors.text}
            />
          </TouchableOpacity>

          {isOwnProfile && (
            <>
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={() => router.push('/settings' as any)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="settings-outline"
                  size={20}
                  color={colors.text}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.headerIconBtn,
                  { backgroundColor: colors.dangerBg },
                ]}
                onPress={() => void handleLogout()}
                disabled={loggingOut}
                activeOpacity={0.7}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Ionicons
                    name="log-out-outline"
                    size={20}
                    color={colors.danger}
                  />
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom:
              Platform.OS === 'android'
                ? Math.max(insets.bottom, 24) + 96
                : Math.max(insets.bottom, 16) + 96,
          },
        ]}
      >
        {/* INSTAGRAM PROFILE HEADER SECTION */}
        <View style={[styles.profileSection, { backgroundColor: colors.bg }]}>
          <View style={styles.profileTopRow}>
            <View
              style={[styles.avatarRing, { borderColor: colors.borderStrong }]}
            >
              <Image
                source={{ uri: displayedAvatarUri }}
                style={[styles.avatar, { backgroundColor: colors.surface }]}
              />
              {isOwnProfile && (
                <TouchableOpacity
                  style={[
                    styles.avatarCameraBadge,
                    { borderColor: colors.bg },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (!isOwnProfile) return;
                    setUrlInput('');
                    setIsAvatarModalOpen(true);
                  }}
                >
                  <Ionicons name="add" size={15} color="#ffffff" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.statsContainer}>
              <TouchableOpacity
                style={styles.statBox}
                onPress={() => openConnectionsScreen('followers')}
                activeOpacity={0.7}
              >
                <Text style={[styles.statNumber, { color: colors.text }]}>
                  {followersDisplay}
                </Text>
                <Text style={[styles.statLabel, { color: colors.subtext }]}>
                  Followers
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.statBox}
                onPress={() => openConnectionsScreen('following')}
                activeOpacity={0.7}
              >
                <Text style={[styles.statNumber, { color: colors.text }]}>
                  {followingDisplay}
                </Text>
                <Text style={[styles.statLabel, { color: colors.subtext }]}>
                  Following
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.statBox}
                onPress={() => openConnectionsScreen('subscriptions')}
                activeOpacity={0.7}
              >
                <Text style={[styles.statNumber, { color: colors.text }]}>
                  {subscriptionsDisplay}
                </Text>
                <Text style={[styles.statLabel, { color: colors.subtext }]}>
                  Subscribed
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Name + Verified Badge + Bio */}
          <View style={styles.bioSection}>
            <View style={styles.nameRow}>
              <View style={styles.nameTitleLeft}>
                <Text
                  style={[styles.fullName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {name || 'VibeSphere User'}
                </Text>
                {isVerified && (
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color="#0095f6"
                    style={{ marginLeft: 5 }}
                  />
                )}
              </View>
            </View>

            {bio ? (
              <Text style={[styles.bioText, { color: colors.subtext }]}>
                {bio}
              </Text>
            ) : null}
          </View>

          {/* INSTAGRAM-STYLE ACTION BUTTONS */}
          {isOwnProfile ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.igSecondaryBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={openEditModal}
                activeOpacity={0.8}
              >
                <Text
                  style={[styles.igSecondaryBtnText, { color: colors.text }]}
                >
                  Edit profile
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.igSecondaryBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => void handleShareProfile()}
                activeOpacity={0.8}
              >
                <Text
                  style={[styles.igSecondaryBtnText, { color: colors.text }]}
                >
                  Share profile
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionIconSquareBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setIsDetailsSheetOpen(true)}
                activeOpacity={0.8}
                accessibilityLabel="View details"
              >
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={colors.text}
                />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actionRow}>
              {isBlockedByMe ? (
                <TouchableOpacity
                  style={[
                    styles.unblockActionBtn,
                    { backgroundColor: colors.dangerBg },
                  ]}
                  onPress={() => void handleUnblockOnProfile()}
                  disabled={updatingFollow}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.unblockActionText, { color: colors.danger }]}
                  >
                    Unblock
                  </Text>
                </TouchableOpacity>
              ) : isBlockingMe ? (
                <View
                  style={[
                    styles.restrictedActionBanner,
                    { backgroundColor: colors.surface },
                  ]}
                >
                  <Ionicons
                    name="ban-outline"
                    size={15}
                    color={colors.subtext}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.restrictedActionText,
                      { color: colors.subtext },
                    ]}
                  >
                    Actions unavailable for this profile
                  </Text>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.igPrimaryBtn,
                      isFollowingTarget && { backgroundColor: colors.surface },
                    ]}
                    onPress={() => void handleToggleFollowOnProfile()}
                    disabled={updatingFollow}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.igPrimaryBtnText,
                        isFollowingTarget && { color: colors.text },
                      ]}
                    >
                      {followButtonLabel}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.igSecondaryBtn,
                      { backgroundColor: colors.surface },
                    ]}
                    onPress={handleMessageUser}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[styles.igSecondaryBtnText, { color: colors.text }]}
                    >
                      Message
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.actionIconSquareBtn,
                      { backgroundColor: colors.surface },
                    ]}
                    onPress={() => void handleShareProfile()}
                    activeOpacity={0.8}
                    accessibilityLabel="Share profile"
                  >
                    <Ionicons
                      name="share-outline"
                      size={18}
                      color={colors.text}
                    />
                  </TouchableOpacity>

                  {(canShowLocationIcon ||
                    canShowBirthdayIcon ||
                    canShowCallIcon) && (
                    <TouchableOpacity
                      style={[
                        styles.actionIconSquareBtn,
                        { backgroundColor: colors.surface },
                      ]}
                      onPress={() => setIsDetailsSheetOpen(true)}
                      activeOpacity={0.8}
                      accessibilityLabel="View details"
                    >
                      <Ionicons
                        name="information-circle-outline"
                        size={20}
                        color={colors.text}
                      />
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}

          {isOwnProfile && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 12 }}
              contentContainerStyle={styles.vibePerksRow}
            >
              <View
                style={[
                  styles.vibePerkChip,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name="flame" size={14} color="#f97316" />
                <Text style={[styles.vibePerkText, { color: colors.text }]}>
                  {vibeStreakDays}d Streak
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.vibePerkChip,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setIsInviteModalOpen(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="gift-outline" size={14} color="#10b981" />
                <Text style={[styles.vibePerkText, { color: colors.text }]}>
                  {referralState.tierLabel} · Invite
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.vibePerkChip,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setIsCollectionsModalOpen(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="folder-open-outline" size={14} color="#38bdf8" />
                <Text style={[styles.vibePerkText, { color: colors.text }]}>
                  {collections.length} Vibe Lists
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>

        {/* INSTAGRAM-STYLE ICON TABS */}
        {visibleTabs.length > 0 && (
          <View
            style={[
              styles.tabsContainer,
              { backgroundColor: colors.bg, borderColor: colors.border },
            ]}
          >
            {visibleTabs.includes('posts') && (
              <TouchableOpacity
                style={[
                  styles.tabItem,
                  activeTab === 'posts' && { borderBottomColor: colors.text },
                ]}
                onPress={() => setActiveTab('posts')}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={activeTab === 'posts' ? 'grid' : 'grid-outline'}
                  size={21}
                  color={activeTab === 'posts' ? colors.text : colors.muted}
                />
              </TouchableOpacity>
            )}
            {visibleTabs.includes('videos') && (
              <TouchableOpacity
                style={[
                  styles.tabItem,
                  activeTab === 'videos' && { borderBottomColor: colors.text },
                ]}
                onPress={() => setActiveTab('videos')}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={
                    activeTab === 'videos' ? 'videocam' : 'videocam-outline'
                  }
                  size={23}
                  color={activeTab === 'videos' ? colors.text : colors.muted}
                />
              </TouchableOpacity>
            )}
            {visibleTabs.includes('live') && (
              <TouchableOpacity
                style={[
                  styles.tabItem,
                  activeTab === 'live' && { borderBottomColor: colors.text },
                ]}
                onPress={() => setActiveTab('live')}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={activeTab === 'live' ? 'radio' : 'radio-outline'}
                  size={23}
                  color={activeTab === 'live' ? colors.text : colors.muted}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* CONTENT FEED */}
        {visibleTabs.length === 0 ? (
          <View style={styles.emptySectionBox}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.surface },
              ]}
            >
              <Ionicons
                name="lock-closed-outline"
                size={24}
                color={colors.subtext}
              />
            </View>
            <Text style={[styles.emptySectionTitle, { color: colors.text }]}>
              Private Content
            </Text>
            <Text style={[styles.emptySectionText, { color: colors.subtext }]}>
              No public tabs are visible on this profile.
            </Text>
          </View>
        ) : currentData.length === 0 ? (
          <View style={styles.emptySectionBox}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.surface },
              ]}
            >
              <Ionicons
                name={
                  activeTab === 'posts'
                    ? 'images-outline'
                    : activeTab === 'videos'
                      ? 'videocam-outline'
                      : 'radio-outline'
                }
                size={24}
                color={colors.subtext}
              />
            </View>
            <Text style={[styles.emptySectionTitle, { color: colors.text }]}>
              No {activeTab} yet
            </Text>
            <Text style={[styles.emptySectionText, { color: colors.subtext }]}>
              {isOwnProfile
                ? `Content you publish in ${activeTab} will appear here.`
                : `This creator hasn't shared any ${activeTab} yet.`}
            </Text>
          </View>
        ) : activeTab === 'posts' ? (
          <View style={[styles.gridContainer, { backgroundColor: colors.bg }]}>
            {currentData.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.gridCard}
                onPress={() => router.push(`/media/${item.id}`)}
                activeOpacity={0.88}
              >
                <Image
                  source={{ uri: item.thumbnail }}
                  style={styles.gridThumb}
                />
                <View style={styles.gridOverlay} />
                {item.type === 'short' && (
                  <View style={styles.gridShortBadge}>
                    <Ionicons name="sparkles" size={11} color="#ffffff" />
                  </View>
                )}
                {Boolean(item.views) && (
                  <View style={styles.gridFooter}>
                    <View style={styles.viewsRow}>
                      <Ionicons
                        name="play"
                        size={10}
                        color="#ffffff"
                        style={{ marginRight: 3 }}
                      />
                      <Text style={styles.gridViews}>{item.views}</Text>
                    </View>
                  </View>
                )}
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
                  { borderBottomColor: colors.border },
                  idx === currentData.length - 1 && styles.lastRowItem,
                ]}
                onPress={() => router.push(`/media/${item.id}`)}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.listThumbWrap,
                    { backgroundColor: colors.surface },
                  ]}
                >
                  {activeTab === 'live' &&
                  (!item.thumbnail ||
                    item.thumbnail.includes('images.unsplash.com')) ? (
                    <View style={styles.liveFallbackThumb}>
                      <Image
                        source={{ uri: displayedAvatarUri }}
                        style={styles.liveFallbackAvatar}
                      />
                      <Text style={styles.liveFallbackName} numberOfLines={1}>
                        {name || handle.replace(/^@/, '') || 'Live'}
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: item.thumbnail }}
                      style={styles.listThumbImage}
                      resizeMode="cover"
                    />
                  )}
                  {activeTab === 'live' ? (
                    <View style={[styles.listDurationPill, styles.liveBadge]}>
                      <Text style={styles.listDurationText}>LIVE</Text>
                    </View>
                  ) : item.duration ? (
                    <View style={styles.listDurationPill}>
                      <Text style={styles.listDurationText}>
                        {item.duration}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.listDetailsBox}>
                  <Text
                    style={[styles.listTitle, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <View style={styles.listMetaRow}>
                    <Text
                      style={[styles.listViewsText, { color: colors.subtext }]}
                    >
                      {item.views || '0'} views
                    </Text>
                    {Boolean(item.uploadDate) && (
                      <>
                        <Text style={styles.listDot}>•</Text>
                        <Text
                          style={[
                            styles.listDateText,
                            { color: colors.subtext },
                          ]}
                        >
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

      {/* PROFILE DETAILS BOTTOM SHEET (LOCATION, BIRTHDAY & PHONE) */}
      <Modal
        visible={isDetailsSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsDetailsSheetOpen(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsDetailsSheetOpen(false)}
          />
          <View
            style={[
              styles.detailsBottomSheet,
              {
                backgroundColor: colors.card,
                paddingBottom:
                  Platform.OS === 'android'
                    ? Math.max(insets.bottom, 48) + 14
                    : Math.max(insets.bottom, 20) + 12,
              },
            ]}
          >
            <View
              style={[
                styles.detailsHandle,
                { backgroundColor: colors.borderStrong },
              ]}
            />
            <View
              style={[
                styles.detailsHeaderRow,
                { borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.detailsHeaderTitle, { color: colors.text }]}>
                Profile Details
              </Text>
              <TouchableOpacity
                onPress={() => setIsDetailsSheetOpen(false)}
                style={[
                  styles.detailsCloseCircle,
                  { backgroundColor: colors.surface },
                ]}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {!canShowLocationIcon && !canShowBirthdayIcon && !canShowCallIcon ? (
              <View style={styles.detailsEmptyWrap}>
                <Ionicons
                  name="lock-closed-outline"
                  size={24}
                  color={colors.subtext}
                />
                <Text style={[styles.detailsEmptyText, { color: colors.subtext }]}>
                  No contact or personal details shared publicly.
                </Text>
              </View>
            ) : null}

            {canShowLocationIcon && (
              <View
                style={[styles.detailsRow, { borderBottomColor: colors.border }]}
              >
                <Ionicons
                  name="location-outline"
                  size={20}
                  color={colors.text}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.detailsRowLabel, { color: colors.subtext }]}
                  >
                    Location
                  </Text>
                  <Text
                    style={[styles.detailsRowValue, { color: colors.text }]}
                  >
                    {city.trim()}
                  </Text>
                </View>
              </View>
            )}

            {canShowBirthdayIcon && (
              <View
                style={[styles.detailsRow, { borderBottomColor: colors.border }]}
              >
                <Ionicons
                  name="gift-outline"
                  size={20}
                  color={birthdayActiveToday ? '#d97706' : colors.text}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.detailsRowLabel, { color: colors.subtext }]}
                  >
                    {birthdayActiveToday ? 'Birthday Today' : 'Birthday'}
                  </Text>
                  <Text
                    style={[
                      styles.detailsRowValue,
                      {
                        color: birthdayActiveToday ? '#d97706' : colors.text,
                      },
                    ]}
                  >
                    {dob.trim()}
                  </Text>
                </View>
              </View>
            )}

            {canShowCallIcon && (
              <View
                style={[styles.detailsRow, { borderBottomColor: colors.border }]}
              >
                <Ionicons name="call-outline" size={20} color={colors.text} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.detailsRowLabel, { color: colors.subtext }]}
                  >
                    Phone
                  </Text>
                  <Text
                    style={[styles.detailsRowValue, { color: colors.text }]}
                  >
                    {(countryCode || '+91').replace(/[^\d+]/g, '')}{' '}
                    {sanitizeMobileDigits(mobileNumber)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.detailsCallPill,
                    { backgroundColor: colors.accent },
                  ]}
                  onPress={() => {
                    setIsDetailsSheetOpen(false);
                    void handleOpenDialpad();
                  }}
                >
                  <Ionicons
                    name="call"
                    size={13}
                    color={colors.accentText}
                  />
                  <Text
                    style={[
                      styles.detailsCallPillText,
                      { color: colors.accentText },
                    ]}
                  >
                    Call
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {isOwnProfile && (
              <TouchableOpacity
                style={[
                  styles.detailsRow,
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => {
                  setIsDetailsSheetOpen(false);
                  router.push('/settings' as any);
                }}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={20}
                  color={isVerified ? '#0095f6' : colors.text}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.detailsRowLabel, { color: colors.subtext }]}
                  >
                    Verification
                  </Text>
                  <Text
                    style={[styles.detailsRowValue, { color: colors.text }]}
                  >
                    {isVerified
                      ? 'Verified Account (Blue Tick)'
                      : 'Apply for Blue Tick in Settings'}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* CHANGE PROFILE PICTURE MODAL (OWN PROFILE ONLY) */}
      <Modal
        visible={isOwnProfile && isAvatarModalOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsAvatarModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => !uploadingAvatar && setIsAvatarModalOpen(false)}
          />

          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
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
                Change Profile Photo
              </Text>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => !uploadingAvatar && setIsAvatarModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {uploadingAvatar ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.text} />
                <Text
                  style={{
                    marginTop: 12,
                    color: colors.text,
                    fontWeight: '700',
                  }}
                >
                  Uploading photo...
                </Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={[
                    styles.photoOptionRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => void pickFromGallery()}
                  activeOpacity={0.75}
                >
                  <View
                    style={[
                      styles.photoOptionIcon,
                      { backgroundColor: colors.surface },
                    ]}
                  >
                    <Ionicons
                      name="images-outline"
                      size={20}
                      color={colors.text}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.photoOptionTitle, { color: colors.text }]}
                    >
                      Choose from Gallery
                    </Text>
                    <Text
                      style={[styles.photoOptionSub, { color: colors.subtext }]}
                    >
                      Select a photo from your device
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.subtext}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.photoOptionRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => void takePhotoWithCamera()}
                  activeOpacity={0.75}
                >
                  <View
                    style={[
                      styles.photoOptionIcon,
                      { backgroundColor: colors.surface },
                    ]}
                  >
                    <Ionicons
                      name="camera-outline"
                      size={20}
                      color={colors.text}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.photoOptionTitle, { color: colors.text }]}
                    >
                      Take a Photo
                    </Text>
                    <Text
                      style={[styles.photoOptionSub, { color: colors.subtext }]}
                    >
                      Capture a new photo with your camera
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.subtext}
                  />
                </TouchableOpacity>

                <Text
                  style={[
                    styles.inputLabel,
                    { marginTop: 16, color: colors.subtext },
                  ]}
                >
                  OR PASTE IMAGE URL
                </Text>
                <View style={styles.urlRow}>
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        flex: 1,
                        backgroundColor: colors.inputBg,
                        borderColor: colors.borderStrong,
                        color: colors.text,
                      },
                    ]}
                    value={urlInput}
                    onChangeText={setUrlInput}
                    placeholder="https://example.com/photo.jpg"
                    placeholderTextColor={colors.subtext}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={[
                      styles.urlSaveBtn,
                      { backgroundColor: colors.accent },
                    ]}
                    onPress={() => void saveAvatarFromUrl()}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.urlSaveText, { color: colors.accentText }]}
                    >
                      Apply
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT PROFILE MODAL (OWN PROFILE ONLY) */}
      <Modal
        visible={isOwnProfile && isEditModalOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!savingProfile) setIsEditModalOpen(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
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
                Edit Profile
              </Text>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => !savingProfile && setIsEditModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 560 }}
              contentContainerStyle={{ paddingBottom: 8 }}
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

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                FULL NAME
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.borderStrong,
                    color: colors.text,
                  },
                ]}
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Enter your name"
                placeholderTextColor={colors.subtext}
              />

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                USERNAME
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.borderStrong,
                    color: colors.text,
                  },
                  usernameError ? styles.inputErrorBorder : null,
                ]}
                value={draftHandle}
                onChangeText={(text) => void handleUsernameChange(text)}
                placeholder="@username"
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
              />
              {Boolean(usernameError) && (
                <Text style={styles.errorText}>{usernameError}</Text>
              )}

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                CITY
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.borderStrong,
                    color: colors.text,
                  },
                ]}
                value={draftCity}
                onChangeText={handleCitySearch}
                placeholder="Type city name to search..."
                placeholderTextColor={colors.subtext}
              />
              {searchingCities && (
                <View style={styles.suggestionLoadingRow}>
                  <ActivityIndicator size="small" color={colors.text} />
                  <Text
                    style={[
                      styles.suggestionLoadingText,
                      { color: colors.subtext },
                    ]}
                  >
                    Searching cities...
                  </Text>
                </View>
              )}
              {citySuggestions.length > 0 && (
                <View
                  style={[
                    styles.suggestionBox,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  {citySuggestions.map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[
                        styles.suggestionItem,
                        { borderBottomColor: colors.border },
                      ]}
                      onPress={() => selectCitySuggestion(item)}
                    >
                      <Ionicons
                        name="location-outline"
                        size={14}
                        color={colors.text}
                        style={{ marginRight: 8 }}
                      />
                      <Text
                        style={[styles.suggestionText, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                MOBILE NUMBER
              </Text>
              <View style={styles.phoneRow}>
                <TouchableOpacity
                  style={[
                    styles.countryBtn,
                    {
                      backgroundColor: colors.inputBg,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                  onPress={() => setIsCountryModalOpen(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.countryFlagText}>
                    {draftCountry.flag}
                  </Text>
                  <Text
                    style={[styles.countryCodeText, { color: colors.text }]}
                  >
                    {draftCountry.code}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={14}
                    color={colors.subtext}
                  />
                </TouchableOpacity>

                <TextInput
                  style={[
                    styles.textInput,
                    {
                      flex: 1,
                      backgroundColor: colors.inputBg,
                      borderColor: colors.borderStrong,
                      color: colors.text,
                    },
                    mobileError ? styles.inputErrorBorder : null,
                  ]}
                  value={draftMobile}
                  onChangeText={(text) => {
                    const digits = sanitizeMobileDigits(text);
                    setDraftMobile(digits);
                    if (mobileError) setMobileError('');
                  }}
                  placeholder="Enter mobile number"
                  placeholderTextColor={colors.subtext}
                  keyboardType="phone-pad"
                  maxLength={draftCountry.maxDigits}
                />
              </View>
              {Boolean(mobileError) && (
                <Text style={styles.errorText}>{mobileError}</Text>
              )}

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                DATE OF BIRTH
              </Text>
              <TouchableOpacity
                style={[
                  styles.dobBox,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.borderStrong,
                  },
                ]}
                onPress={() => setIsDatePickerVisible(true)}
              >
                <Text style={[styles.dobText, { color: colors.text }]}>
                  {formatDOB(selectedDate)}
                </Text>
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={colors.subtext}
                />
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

              <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                BIO
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  styles.bioInput,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.borderStrong,
                    color: colors.text,
                  },
                ]}
                value={draftBio}
                onChangeText={setDraftBio}
                placeholder="Write something about yourself..."
                placeholderTextColor={colors.subtext}
                multiline
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.surface }]}
                onPress={() => setIsEditModalOpen(false)}
                disabled={savingProfile}
              >
                <Text style={[styles.cancelBtnText, { color: colors.subtext }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  { backgroundColor: colors.accent },
                  savingProfile && { opacity: 0.7 },
                ]}
                onPress={() => void saveProfileChanges()}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator color={colors.accentText} />
                ) : (
                  <Text
                    style={[styles.saveBtnText, { color: colors.accentText }]}
                  >
                    Save Changes
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* INVITE FRIENDS & CREATOR MILESTONES MODAL */}
      <Modal
        visible={isInviteModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsInviteModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsInviteModalOpen(false)}
          />
          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
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
                Invite Friends & Milestones
              </Text>
              <TouchableOpacity
                style={[styles.sheetCloseBtn, { backgroundColor: colors.surface }]}
                onPress={() => setIsInviteModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.inviteTierBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.inviteTierBadge, { color: '#10b981' }]}>
                CURRENT TIER · {referralState.tierLabel.toUpperCase()}
              </Text>
              <Text style={[styles.inviteCountBig, { color: colors.text }]}>
                {referralState.invitedCount} / {referralState.nextTarget} Invites
              </Text>
              <Text style={[styles.inviteHint, { color: colors.subtext }]}>
                Unlock Early Supporter (1+), Rising Creator (3+), and Founder
                Circle (5+) profile perks when friends join with your link.
              </Text>
            </View>

            <View
              style={[
                styles.inviteLinkPill,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Ionicons name="link" size={16} color="#10b981" />
              <Text
                style={[styles.inviteLinkText, { color: colors.text }]}
                selectable
                numberOfLines={1}
              >
                {buildInviteUrl(handle, currentUserId)}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.inviteShareCta}
              onPress={async () => {
                const inviteUrl = buildInviteUrl(handle, currentUserId);
                try {
                  const res = await Share.share({
                    title: 'Join me on VibeSphere',
                    message: `Join me on VibeSphere! Watch Reels, go Live & chat together:\n${inviteUrl}`,
                    url: inviteUrl,
                  });
                  if (res.action === Share.sharedAction) {
                    const next = await incrementReferralProgress(currentUserId);
                    setReferralState(next);
                  }
                } catch {}
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="share-social" size={18} color="#052e16" />
              <Text style={styles.inviteShareCtaText}>Share Invite Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* COLLABORATIVE VIBE COLLECTIONS MODAL */}
      <Modal
        visible={isCollectionsModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsCollectionsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsCollectionsModalOpen(false)}
          />
          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: sheetBottomPadding,
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
                Shared Vibe Collections
              </Text>
              <TouchableOpacity
                style={[styles.sheetCloseBtn, { backgroundColor: colors.surface }]}
                onPress={() => setIsCollectionsModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {collections.map((col) => (
                <View
                  key={col.id}
                  style={[
                    styles.collectionCardRow,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.colRowTitle, { color: colors.text }]}>
                      {col.title}
                    </Text>
                    <Text style={[styles.colRowSub, { color: colors.subtext }]}>
                      {col.items.length} saved · {col.description}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.colShareBtn}
                    onPress={async () => {
                      const previewLines = col.items
                        .slice(0, 3)
                        .map((i) => `• ${i.title} (${i.author})`)
                        .join('\n');
                      try {
                        await Share.share({
                          message: `Check out my VibeSphere collection "${col.title}" (${col.items.length} items):\n${previewLines || col.description}`,
                        });
                      } catch {}
                    }}
                  >
                    <Ionicons name="send" size={14} color="#052e16" />
                    <Text style={styles.colShareBtnText}>Share</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <BrandedShareModal
        visible={!!shareProfileCard}
        item={shareProfileCard}
        onClose={() => setShareProfileCard(null)}
      />

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

const GRID_GAP = 1.5;
const GRID_ITEM_WIDTH = (width - GRID_GAP * 2) / 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingText: {
    marginTop: 12,
    fontWeight: '600',
    fontSize: 13.5,
  },

  /* Instagram Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    marginRight: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerHandle: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  /* Instagram Profile Section */
  profileSection: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 16,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarRing: {
    width: 86,
    height: 86,
    borderRadius: 43,
    padding: 2,
    borderWidth: 1,
    position: 'relative',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 41,
  },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0095f6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  statsContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginLeft: 14,
  },
  statBox: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  statLabel: {
    fontSize: 12.5,
    marginTop: 1,
    fontWeight: '500',
  },

  /* Name, Icon-Only Options & Bio */
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
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  infoIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconSquareBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.5)',
    justifyContent: 'flex-end',
  },
  detailsBottomSheet: {
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
  },
  detailsHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  detailsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  detailsHeaderTitle: {
    fontSize: 16.5,
    fontWeight: '800',
  },
  detailsCloseCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  detailsRowLabel: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  detailsRowValue: {
    fontSize: 14.5,
    fontWeight: '700',
    marginTop: 2,
  },
  detailsCallPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  detailsCallPillText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  detailsEmptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  detailsEmptyText: {
    fontSize: 13.5,
    textAlign: 'center',
  },
  liveFallbackThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#18181b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  liveFallbackAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  liveFallbackName: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '700',
  },
  infoIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayTodayIconBtn: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  bioText: {
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 4,
  },

  /* Instagram Action Buttons */
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  igPrimaryBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0095f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  igPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  igSecondaryBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  igSecondaryBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  unblockActionBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockActionText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  restrictedActionBanner: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  restrictedActionText: {
    fontSize: 12.5,
    fontWeight: '600',
  },

  /* Instagram Icon Tabs */
  tabsContainer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1.5,
    borderBottomColor: 'transparent',
  },

  /* Empty State */
  emptySectionBox: {
    paddingVertical: 56,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptySectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptySectionText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },

  /* Instagram 3-Column Grid */
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  gridCard: {
    width: GRID_ITEM_WIDTH,
    height: GRID_ITEM_WIDTH * 1.25,
    position: 'relative',
    backgroundColor: '#18181b',
  },
  gridThumb: {
    width: '100%',
    height: '100%',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(9, 9, 11, 0.14)',
  },
  gridShortBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
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
  },
  gridViews: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  /* Videos & Live List */
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  videoRowItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  lastRowItem: {
    borderBottomWidth: 0,
  },
  listThumbWrap: {
    width: 136,
    aspectRatio: 16 / 9,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  listThumbImage: {
    width: '100%',
    height: '100%',
  },
  listDurationPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(9, 9, 11, 0.82)',
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  liveBadge: {
    backgroundColor: '#dc2626',
  },
  listDurationText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '700',
  },
  listDetailsBox: {
    flex: 1,
    marginLeft: 12,
    paddingTop: 2,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  listMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  listViewsText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listDot: {
    marginHorizontal: 6,
    color: '#a1a1aa',
  },
  listDateText: {
    fontSize: 12,
  },

  /* Info Popup */
  infoPopupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  infoPopupCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 22,
  },
  infoPopupTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  infoPopupBadge: {
    width: 46,
    height: 46,
    borderRadius: 15,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPopupTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  infoPopupSubtitle: {
    fontSize: 12.5,
    marginTop: 3,
  },
  infoPopupValueBox: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  infoPopupBirthdayBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  infoPopupValueText: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  infoPopupBirthdayText: {
    color: '#92400e',
  },
  infoPopupDoneBtn: {
    marginTop: 16,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPopupBirthdayBtn: {
    backgroundColor: '#d97706',
  },
  infoPopupDoneText: {
    fontSize: 14,
    fontWeight: '700',
  },

  /* Bottom Sheets */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: '90%',
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
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  photoOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  photoOptionTitle: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  photoOptionSub: {
    fontSize: 12,
    marginTop: 2,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  urlSaveBtn: {
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlSaveText: {
    fontWeight: '700',
    fontSize: 13.5,
  },
  editWelcomeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  editWelcomeText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#065f46',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  textInput: {
    height: 46,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 14,
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
    fontWeight: '500',
  },
  suggestionBox: {
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 6,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  suggestionText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countryBtn: {
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  countryFlagText: {
    fontSize: 16,
  },
  countryCodeText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  dobBox: {
    height: 46,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dobText: {
    fontSize: 14,
    fontWeight: '600',
  },
  bioInput: {
    height: 82,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 1.3,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  vibePerksRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 2,
  },
  vibePerkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  vibePerkText: {
    fontSize: 12,
    fontWeight: '700',
  },
  inviteTierBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
    marginTop: 6,
  },
  inviteTierBadge: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  inviteCountBig: {
    fontSize: 20,
    fontWeight: '800',
  },
  inviteHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  inviteLinkPill: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inviteLinkText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  inviteShareCta: {
    marginTop: 14,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  inviteShareCtaText: {
    color: '#052e16',
    fontSize: 14,
    fontWeight: '800',
  },
  collectionCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  colRowTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  colRowSub: {
    fontSize: 11.5,
    marginTop: 2,
  },
  colShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#10b981',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
  },
  colShareBtnText: {
    color: '#052e16',
    fontSize: 12,
    fontWeight: '800',
  },
});