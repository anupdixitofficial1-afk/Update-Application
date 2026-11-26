import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  DeviceEventEmitter,
  useColorScheme,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { backend, VerificationRequestRecord } from '../lib/backend';

export type ThemeMode = 'light' | 'dark' | 'system';
type PrivacyLevel = 'all' | 'followers' | 'none';

export const THEME_STORAGE_KEY = 'app_theme_mode_v1';
export const THEME_CHANGED_EVENT = 'app-theme-changed';
const NOTIFICATION_PREFS_KEY = '@app_notification_settings_v1';

let ExpoNotificationsMod: any = null;
try {
  ExpoNotificationsMod = require('expo-notifications');
} catch {
  ExpoNotificationsMod = null;
}

interface PrivacySettingsPayload {
  profileVisibilityEnabled: boolean;
  bio: PrivacyLevel;
  location: PrivacyLevel;
  phone: PrivacyLevel;
  gender: PrivacyLevel;
  followers: PrivacyLevel;
  dobDay: PrivacyLevel;
  dobMonth: PrivacyLevel;
  dobYear: PrivacyLevel;
  whoCanMessage: PrivacyLevel;
  showPosts: boolean;
  showVideos: boolean;
  showLive: boolean;
  activityStatus: boolean;
  screenshotAlerts: boolean;
  preventScreenshots: boolean;
  profileViewAlerts: boolean;
}

interface BlockedUserItem {
  id: string;
  blocked_id: string;
  name: string;
  handle: string;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();

  // Theme State
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
      subtext: isDark ? '#a1a1aa' : '#71717a',
      accent: isDark ? '#fafafa' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
      inputBg: isDark ? '#27272a' : '#f4f4f5',
      dangerBg: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fef2f2',
      danger: '#ef4444',
      switchTrackFalse: isDark ? '#3f3f46' : '#d4d4d8',
      switchTrackTrue: '#10b981',
    }),
    [isDark]
  );

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Notification States
  const [pushNotifications, setPushNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(false);
  const [directMessages, setDirectMessages] = useState(true);

  // Privacy States
  const [profileVisibilityEnabled, setProfileVisibilityEnabled] = useState(true);
  const [bioPrivacy, setBioPrivacy] = useState<PrivacyLevel>('all');
  const [locationPrivacy, setLocationPrivacy] = useState<PrivacyLevel>('all');
  const [phonePrivacy, setPhonePrivacy] = useState<PrivacyLevel>('none');
  const [genderPrivacy, setGenderPrivacy] = useState<PrivacyLevel>('all');
  const [followersPrivacy, setFollowersPrivacy] = useState<PrivacyLevel>('all');
  const [dobDayPrivacy, setDobDayPrivacy] = useState<PrivacyLevel>('all');
  const [dobMonthPrivacy, setDobMonthPrivacy] = useState<PrivacyLevel>('all');
  const [dobYearPrivacy, setDobYearPrivacy] = useState<PrivacyLevel>('all');
  const [whoCanMessage, setWhoCanMessage] = useState<PrivacyLevel>('all');
  const [showPosts, setShowPosts] = useState(true);
  const [showVideos, setShowVideos] = useState(true);
  const [showLive, setShowLive] = useState(true);
  const [activityStatus, setActivityStatus] = useState(true);
  const [screenshotAlerts, setScreenshotAlerts] = useState(true);
  const [preventScreenshots, setPreventScreenshots] = useState(false);
  const [profileViewAlerts, setProfileViewAlerts] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  // Modals States
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [isSessionsModalOpen, setIsSessionsModalOpen] = useState(false);
  const [isVerifModalOpen, setIsVerifModalOpen] = useState(false);

  // Blue Tick Verification States
  const [isVerified, setIsVerified] = useState(false);
  const [latestVerifReq, setLatestVerifReq] =
    useState<VerificationRequestRecord | null>(null);
  const [verifCategory, setVerifCategory] = useState('Creator');
  const [verifReason, setVerifReason] = useState('');
  const [verifDocUrl, setVerifDocUrl] = useState('');
  const [submittingVerif, setSubmittingVerif] = useState(false);

  // Password States
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Blocked Users & Session States
  const [blockedUsersList, setBlockedUsersList] = useState<BlockedUserItem[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [sessionEmail, setSessionEmail] = useState('');
  const [lastSignIn, setLastSignIn] = useState('');

  useEffect(() => {
    void loadSavedTheme();
    void loadNotificationPrefs();
    void loadPrivacySettings();
    void loadBlockedUsers();
    void loadSessionInfo();
    void loadVerificationStatus();
  }, []);

  const loadVerificationStatus = async () => {
    try {
      const user = await backend.auth.getCurrentUser().catch(() => null);
      if (!user?.id) return;
      const status = await backend.profile.getVerificationStatus(user.id);
      setIsVerified(status.isVerified);
      setLatestVerifReq(status.latestRequest);
    } catch {
      // ignore
    }
  };

  const handleSubmitVerificationRequest = async () => {
    const cleanReason = verifReason.trim();
    if (cleanReason.length < 10) {
      Alert.alert(
        'More Details Needed',
        'Please briefly explain why you are requesting a Blue Tick (at least 10 characters).'
      );
      return;
    }

    try {
      setSubmittingVerif(true);
      const user = await backend.auth.getCurrentUser();
      if (!user?.id) {
        Alert.alert('Sign In Required', 'Please sign in first.');
        return;
      }

      const submitted = await backend.profile.submitVerificationRequest({
        userId: user.id,
        fullName: user.fullName || user.email.split('@')[0] || 'User',
        username: user.username || undefined,
        category: verifCategory,
        reason: cleanReason,
        documentUrl: verifDocUrl.trim() || undefined,
      });

      setLatestVerifReq(submitted);
      setVerifReason('');
      setVerifDocUrl('');
      Alert.alert(
        'Request Submitted',
        'Your Blue Tick verification request is pending review. You will receive the Blue Tick once your request is approved.'
      );
    } catch (err: any) {
      Alert.alert(
        'Verification Error',
        err?.message || 'Unable to submit request.'
      );
    } finally {
      setSubmittingVerif(false);
    }
  };

  const loadNotificationPrefs = async () => {
    try {
      const raw = await AsyncStorage.getItem(NOTIFICATION_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.pushNotifications === 'boolean') {
        setPushNotifications(parsed.pushNotifications);
      }
      if (typeof parsed.emailAlerts === 'boolean') {
        setEmailAlerts(parsed.emailAlerts);
      }
      if (typeof parsed.directMessages === 'boolean') {
        setDirectMessages(parsed.directMessages);
      }
    } catch {
      // ignore
    }
  };

  const updateNotificationPref = async (
    key: 'pushNotifications' | 'emailAlerts' | 'directMessages',
    nextVal: boolean
  ) => {
    const nextState = {
      pushNotifications: key === 'pushNotifications' ? nextVal : pushNotifications,
      emailAlerts: key === 'emailAlerts' ? nextVal : emailAlerts,
      directMessages: key === 'directMessages' ? nextVal : directMessages,
    };

    if (key === 'pushNotifications') setPushNotifications(nextVal);
    if (key === 'emailAlerts') setEmailAlerts(nextVal);
    if (key === 'directMessages') setDirectMessages(nextVal);

    if (key === 'pushNotifications' && nextVal && ExpoNotificationsMod) {
      try {
        const perm = await ExpoNotificationsMod.getPermissionsAsync?.();
        if (perm?.status !== 'granted') {
          await ExpoNotificationsMod.requestPermissionsAsync?.();
        }
      } catch {
        // ignore if unsupported in current runtime
      }
    }

    try {
      await AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(nextState));
    } catch {
      // ignore
    }
  };

  const loadSavedTheme = async () => {
    try {
      const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setThemeMode(saved);
      }
    } catch {
      // ignore
    }
  };

  const handleSelectTheme = async (mode: ThemeMode) => {
    setThemeMode(mode);
    DeviceEventEmitter.emit(THEME_CHANGED_EVENT, mode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const loadSessionInfo = async () => {
    try {
      const info = await backend.auth.getSessionInfo();
      if (info) {
        setSessionEmail(info.email || 'Signed in account');
        setLastSignIn(
          info.lastSignInAt
            ? new Date(info.lastSignInAt).toLocaleString()
            : 'Active now'
        );
      }
    } catch {
      // ignore
    }
  };

  const loadBlockedUsers = async () => {
    try {
      setLoadingBlocked(true);
      const user = await backend.auth.getCurrentUser().catch(() => null);
      if (!user?.id) return;

      const list = await backend.settings.getBlockedUsers(user.id);
      setBlockedUsersList(list);
    } catch {
      // keep existing
    } finally {
      setLoadingBlocked(false);
    }
  };

  const buildCurrentPayload = (
    overrides?: Partial<PrivacySettingsPayload>
  ): PrivacySettingsPayload => ({
    profileVisibilityEnabled,
    bio: bioPrivacy,
    location: locationPrivacy,
    phone: phonePrivacy,
    gender: genderPrivacy,
    followers: followersPrivacy,
    dobDay: dobDayPrivacy,
    dobMonth: dobMonthPrivacy,
    dobYear: dobYearPrivacy,
    whoCanMessage,
    showPosts,
    showVideos,
    showLive,
    activityStatus,
    screenshotAlerts,
    preventScreenshots,
    profileViewAlerts,
    ...overrides,
  });

  const persistPrivacySettings = async (nextPayload: PrivacySettingsPayload) => {
    try {
      setSavingPrivacy(true);
      const user = await backend.auth.getCurrentUser().catch(() => null);
      if (!user?.id) return;

      const showLocationBool =
        nextPayload.profileVisibilityEnabled && nextPayload.location !== 'none';
      const showPhoneBool =
        nextPayload.profileVisibilityEnabled && nextPayload.phone !== 'none';
      const showDobBool =
        nextPayload.profileVisibilityEnabled &&
        (nextPayload.dobDay !== 'none' ||
          nextPayload.dobMonth !== 'none' ||
          nextPayload.dobYear !== 'none');

      await backend.settings.savePrivacySettings(user.id, nextPayload, {
        show_location: showLocationBool,
        show_phone: showPhoneBool,
        show_dob: showDobBool,
        show_posts: nextPayload.showPosts,
        show_videos: nextPayload.showVideos,
        show_live: nextPayload.showLive,
      });

      DeviceEventEmitter.emit('profile-privacy-updated', {
        showLocation: showLocationBool,
        showPhone: showPhoneBool,
        showDob: showDobBool,
        showPosts: nextPayload.showPosts,
        showVideos: nextPayload.showVideos,
        showLive: nextPayload.showLive,
        privacy_settings: nextPayload,
      });
    } finally {
      setSavingPrivacy(false);
    }
  };

  const loadPrivacySettings = async () => {
    try {
      const user = await backend.auth.getCurrentUser().catch(() => null);
      if (!user?.id) return;

      const p = (await backend.settings.getPrivacySettings(
        user.id
      )) as Partial<PrivacySettingsPayload> | null;

      if (p) {
        if (typeof p.profileVisibilityEnabled === 'boolean')
          setProfileVisibilityEnabled(p.profileVisibilityEnabled);
        if (p.bio) setBioPrivacy(p.bio);
        if (p.location) setLocationPrivacy(p.location);
        if (p.phone) setPhonePrivacy(p.phone);
        if (p.gender) setGenderPrivacy(p.gender);
        if (p.followers) setFollowersPrivacy(p.followers);
        if (p.dobDay) setDobDayPrivacy(p.dobDay);
        if (p.dobMonth) setDobMonthPrivacy(p.dobMonth);
        if (p.dobYear) setDobYearPrivacy(p.dobYear);
        if (p.whoCanMessage) setWhoCanMessage(p.whoCanMessage);
        if (typeof p.showPosts === 'boolean') setShowPosts(p.showPosts);
        if (typeof p.showVideos === 'boolean') setShowVideos(p.showVideos);
        if (typeof p.showLive === 'boolean') setShowLive(p.showLive);
        if (typeof p.activityStatus === 'boolean')
          setActivityStatus(p.activityStatus);
        if (typeof p.screenshotAlerts === 'boolean')
          setScreenshotAlerts(p.screenshotAlerts);
        if (typeof p.preventScreenshots === 'boolean')
          setPreventScreenshots(p.preventScreenshots);
        if (typeof p.profileViewAlerts === 'boolean')
          setProfileViewAlerts(p.profileViewAlerts);
      }
    } catch (err) {
      console.error('Load privacy error:', err);
    }
  };

  const handleToggleMasterVisibility = async (enabled: boolean) => {
    setProfileVisibilityEnabled(enabled);
    const targetLevel: PrivacyLevel = enabled ? 'all' : 'none';
    setBioPrivacy(targetLevel);
    setLocationPrivacy(targetLevel);
    setPhonePrivacy(enabled ? 'followers' : 'none');
    setGenderPrivacy(targetLevel);
    setFollowersPrivacy(targetLevel);
    setDobDayPrivacy(targetLevel);
    setDobMonthPrivacy(targetLevel);
    setDobYearPrivacy(targetLevel);

    await persistPrivacySettings(
      buildCurrentPayload({
        profileVisibilityEnabled: enabled,
        bio: targetLevel,
        location: targetLevel,
        phone: enabled ? 'followers' : 'none',
        gender: targetLevel,
        followers: targetLevel,
        dobDay: targetLevel,
        dobMonth: targetLevel,
        dobYear: targetLevel,
      })
    );
  };

  const handleSelectPrivacyLevel = async (
    key:
      | 'bio'
      | 'location'
      | 'phone'
      | 'gender'
      | 'followers'
      | 'dobDay'
      | 'dobMonth'
      | 'dobYear'
      | 'whoCanMessage',
    level: PrivacyLevel
  ) => {
    if (key !== 'whoCanMessage' && !profileVisibilityEnabled) return;

    if (key === 'bio') setBioPrivacy(level);
    if (key === 'location') setLocationPrivacy(level);
    if (key === 'phone') setPhonePrivacy(level);
    if (key === 'gender') setGenderPrivacy(level);
    if (key === 'followers') setFollowersPrivacy(level);
    if (key === 'dobDay') setDobDayPrivacy(level);
    if (key === 'dobMonth') setDobMonthPrivacy(level);
    if (key === 'dobYear') setDobYearPrivacy(level);
    if (key === 'whoCanMessage') setWhoCanMessage(level);

    await persistPrivacySettings(buildCurrentPayload({ [key]: level }));
  };

  const handleToggleBooleanPrivacy = async (
    key:
      | 'showPosts'
      | 'showVideos'
      | 'showLive'
      | 'activityStatus'
      | 'screenshotAlerts'
      | 'preventScreenshots'
      | 'profileViewAlerts',
    val: boolean
  ) => {
    if (key === 'showPosts') setShowPosts(val);
    if (key === 'showVideos') setShowVideos(val);
    if (key === 'showLive') setShowLive(val);
    if (key === 'activityStatus') setActivityStatus(val);
    if (key === 'screenshotAlerts') setScreenshotAlerts(val);
    if (key === 'preventScreenshots') setPreventScreenshots(val);
    if (key === 'profileViewAlerts') setProfileViewAlerts(val);

    await persistPrivacySettings(buildCurrentPayload({ [key]: val }));
  };

  const renderPrivacyButtons = (
    currentValue: PrivacyLevel,
    onSelect: (level: PrivacyLevel) => void,
    disabled = false
  ) => (
    <View
      style={[
        styles.segmentedControl,
        { backgroundColor: colors.inputBg },
        disabled && { opacity: 0.4 },
      ]}
    >
      {(['all', 'followers', 'none'] as PrivacyLevel[]).map((level) => {
        const isActive = currentValue === level;
        return (
          <TouchableOpacity
            key={level}
            disabled={disabled || savingPrivacy}
            style={[
              styles.segmentBtn,
              isActive && { backgroundColor: colors.accent },
            ]}
            onPress={() => onSelect(level)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={
                level === 'all'
                  ? 'globe-outline'
                  : level === 'followers'
                    ? 'people-outline'
                    : 'lock-closed-outline'
              }
              size={14}
              color={isActive ? colors.accentText : colors.subtext}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const handleUpdatePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in new password fields.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match.');
      return;
    }
    try {
      setUpdatingPassword(true);
      await backend.auth.updatePassword(newPassword);

      Alert.alert('Success', 'Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordModalOpen(false);
    } catch (err: any) {
      Alert.alert('Update Failed', err?.message || 'Could not update password.');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleUnblockUser = (item: BlockedUserItem) => {
    Alert.alert(
      'Unblock User',
      `Are you sure you want to unblock ${item.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              const user = await backend.auth.getCurrentUser().catch(() => null);
              if (user?.id) {
                await backend.profile.unblockUser(user.id, item.blocked_id);
              }
              setBlockedUsersList((prev) =>
                prev.filter((u) => u.id !== item.id)
              );
              DeviceEventEmitter.emit('follows-updated', {
                status: 'unblocked',
              });
            } catch {
              Alert.alert('Error', 'Could not unblock user.');
            }
          },
        },
      ]
    );
  };

  const handleSignOutAllOtherDevices = async () => {
    try {
      await backend.auth.signOutOtherDevices();
      Alert.alert('Done', 'Signed out from all other devices.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not sign out other sessions.');
    }
  };

  const handleDeactivateAccount = () => {
    Alert.alert(
      'Deactivate Account',
      'Your account will be temporarily disabled. You can reactivate anytime by logging back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            await backend.auth.signOut();
            Alert.alert('Deactivated', 'Your account has been deactivated.');
            router.replace('/login' as any);
          },
        },
      ]
    );
  };

  const q = searchQuery.trim().toLowerCase();
  const matches = (keywords: string) =>
    !q || keywords.toLowerCase().includes(q);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.bg, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface }]}
          activeOpacity={0.75}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Settings & Privacy
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 20) + 24 },
        ]}
      >
        {/* SEARCH BAR */}
        <View style={[styles.searchBox, { backgroundColor: colors.surface }]}>
          <Ionicons name="search-outline" size={18} color={colors.subtext} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search settings, privacy, theme..."
            placeholderTextColor={colors.subtext}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.subtext} />
            </TouchableOpacity>
          )}
        </View>

        {/* APPEARANCE (LIGHT / DARK / SYSTEM) */}
        {matches('appearance theme dark light mode system') && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.subtext }]}>
              APPEARANCE
            </Text>
            <View
              style={[
                styles.cardContainer,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.themeBlock}>
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#27272a' : '#f4f4f5' },
                    ]}
                  >
                    <Ionicons
                      name={isDark ? 'moon' : 'sunny'}
                      size={17}
                      color={colors.text}
                    />
                  </View>
                  <View>
                    <Text style={[styles.menuText, { color: colors.text }]}>
                      App Theme
                    </Text>
                    <Text style={[styles.menuSub, { color: colors.subtext }]}>
                      Switch between Light, Dark, or System
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.themeSegmentTrack,
                    { backgroundColor: colors.inputBg },
                  ]}
                >
                  {(
                    [
                      { key: 'light', label: 'Light', icon: 'sunny-outline' },
                      { key: 'dark', label: 'Dark', icon: 'moon-outline' },
                      {
                        key: 'system',
                        label: 'System',
                        icon: 'phone-portrait-outline',
                      },
                    ] as const
                  ).map((item) => {
                    const active = themeMode === item.key;
                    return (
                      <TouchableOpacity
                        key={item.key}
                        style={[
                          styles.themeSegmentBtn,
                          active && { backgroundColor: colors.accent },
                        ]}
                        onPress={() => void handleSelectTheme(item.key)}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={item.icon}
                          size={14}
                          color={active ? colors.accentText : colors.subtext}
                        />
                        <Text
                          style={[
                            styles.themeSegmentText,
                            {
                              color: active
                                ? colors.accentText
                                : colors.subtext,
                            },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          </>
        )}

        {/* PRIVACY & SAFETY ALERTS */}
        {matches(
          'privacy visibility screenshot alert prevent profile view online activity status'
        ) && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.subtext }]}>
              PRIVACY & SAFETY ALERTS
            </Text>
            <View
              style={[
                styles.cardContainer,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.menuRow}
                activeOpacity={0.75}
                onPress={() => setIsPrivacyModalOpen(true)}
              >
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#0c4a6e' : '#e0f2fe' },
                    ]}
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={17}
                      color={isDark ? '#7dd3fc' : '#0284c7'}
                    />
                  </View>
                  <View>
                    <Text style={[styles.menuText, { color: colors.text }]}>
                      Profile Visibility & Tabs
                    </Text>
                    <Text style={[styles.menuSub, { color: colors.subtext }]}>
                      Bio, Location, Phone, DOB, Posts & Messages
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.menuRow}>
                <View style={[styles.menuLeft, { flex: 1, paddingRight: 10 }]}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#451a03' : '#fef3c7' },
                    ]}
                  >
                    <Ionicons
                      name="camera-outline"
                      size={17}
                      color={isDark ? '#fcd34d' : '#d97706'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.menuText, { color: colors.text }]}>
                      Screenshot Alerts
                    </Text>
                    <Text style={[styles.menuSub, { color: colors.subtext }]}>
                      Notify me if someone screenshots my profile
                    </Text>
                  </View>
                </View>
                <Switch
                  value={screenshotAlerts}
                  onValueChange={(v) =>
                    void handleToggleBooleanPrivacy('screenshotAlerts', v)
                  }
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: colors.switchTrackTrue,
                  }}
                  thumbColor="#ffffff"
                />
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.menuRow}>
                <View style={[styles.menuLeft, { flex: 1, paddingRight: 10 }]}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#3b0764' : '#f3e8ff' },
                    ]}
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={17}
                      color={isDark ? '#d8b4fe' : '#9333ea'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.menuText, { color: colors.text }]}>
                      Prevent Screenshots
                    </Text>
                    <Text style={[styles.menuSub, { color: colors.subtext }]}>
                      Block screen capture when others view profile
                    </Text>
                  </View>
                </View>
                <Switch
                  value={preventScreenshots}
                  onValueChange={(v) =>
                    void handleToggleBooleanPrivacy('preventScreenshots', v)
                  }
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: colors.switchTrackTrue,
                  }}
                  thumbColor="#ffffff"
                />
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.menuRow}>
                <View style={[styles.menuLeft, { flex: 1, paddingRight: 10 }]}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#064e3b' : '#d1fae5' },
                    ]}
                  >
                    <Ionicons
                      name="eye-outline"
                      size={17}
                      color={isDark ? '#6ee7b7' : '#059669'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.menuText, { color: colors.text }]}>
                      Profile View Alerts
                    </Text>
                    <Text style={[styles.menuSub, { color: colors.subtext }]}>
                      Get notified when someone visits your profile
                    </Text>
                  </View>
                </View>
                <Switch
                  value={profileViewAlerts}
                  onValueChange={(v) =>
                    void handleToggleBooleanPrivacy('profileViewAlerts', v)
                  }
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: colors.switchTrackTrue,
                  }}
                  thumbColor="#ffffff"
                />
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.menuRow}>
                <View style={[styles.menuLeft, { flex: 1, paddingRight: 10 }]}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#1e3a8a' : '#dbeafe' },
                    ]}
                  >
                    <Ionicons
                      name="radio-button-on-outline"
                      size={17}
                      color={isDark ? '#93c5fd' : '#2563eb'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.menuText, { color: colors.text }]}>
                      Activity Status
                    </Text>
                    <Text style={[styles.menuSub, { color: colors.subtext }]}>
                      Show when you are online or recently active
                    </Text>
                  </View>
                </View>
                <Switch
                  value={activityStatus}
                  onValueChange={(v) =>
                    void handleToggleBooleanPrivacy('activityStatus', v)
                  }
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: colors.switchTrackTrue,
                  }}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </>
        )}

        {/* ACCOUNT & SECURITY */}
        {matches('account security password blocked users sessions login') && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.subtext }]}>
              ACCOUNT & SECURITY
            </Text>
            <View
              style={[
                styles.cardContainer,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.menuRow}
                activeOpacity={0.75}
                onPress={() => setIsPasswordModalOpen(true)}
              >
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#064e3b' : '#e6f7f0' },
                    ]}
                  >
                    <Ionicons
                      name="key-outline"
                      size={17}
                      color={isDark ? '#6ee7b7' : '#059669'}
                    />
                  </View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    Change Password
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <TouchableOpacity
                style={styles.menuRow}
                activeOpacity={0.75}
                onPress={() => {
                  void loadSessionInfo();
                  setIsSessionsModalOpen(true);
                }}
              >
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#1e3a8a' : '#dbeafe' },
                    ]}
                  >
                    <Ionicons
                      name="phone-portrait-outline"
                      size={17}
                      color={isDark ? '#93c5fd' : '#2563eb'}
                    />
                  </View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    Login Activity & Sessions
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <TouchableOpacity
                style={styles.menuRow}
                activeOpacity={0.75}
                onPress={() => {
                  void loadVerificationStatus();
                  setIsVerifModalOpen(true);
                }}
              >
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#0c4a6e' : '#e0f2fe' },
                    ]}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={17}
                      color="#0095f6"
                    />
                  </View>
                  <View>
                    <Text style={[styles.menuText, { color: colors.text }]}>
                      Blue Tick Verification
                    </Text>
                    <Text style={[styles.menuSub, { color: colors.subtext }]}>
                      {isVerified
                        ? 'Verified account'
                        : latestVerifReq?.status === 'pending'
                          ? 'Request pending approval'
                          : latestVerifReq?.status === 'rejected'
                            ? 'Request rejected · Tap to reapply'
                            : 'Apply for verified badge'}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <TouchableOpacity
                style={styles.menuRow}
                activeOpacity={0.75}
                onPress={() => {
                  void loadBlockedUsers();
                  setIsBlockedModalOpen(true);
                }}
              >
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: colors.dangerBg },
                    ]}
                  >
                    <Ionicons
                      name="ban-outline"
                      size={17}
                      color={colors.danger}
                    />
                  </View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    Blocked Users
                  </Text>
                </View>
                <View style={styles.badgeCountBox}>
                  <Text
                    style={[styles.badgeCountText, { color: colors.subtext }]}
                  >
                    {blockedUsersList.length}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.subtext}
                    style={{ marginLeft: 4 }}
                  />
                </View>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* NOTIFICATIONS */}
        {matches('notifications push email direct messages alerts') && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.subtext }]}>
              NOTIFICATIONS
            </Text>
            <View
              style={[
                styles.cardContainer,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.menuRow}>
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#3b0764' : '#f3e8ff' },
                    ]}
                  >
                    <Ionicons
                      name="notifications-outline"
                      size={17}
                      color={isDark ? '#d8b4fe' : '#9333ea'}
                    />
                  </View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    Push Notifications
                  </Text>
                </View>
                <Switch
                  value={pushNotifications}
                  onValueChange={(v) =>
                    void updateNotificationPref('pushNotifications', v)
                  }
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: colors.switchTrackTrue,
                  }}
                  thumbColor="#ffffff"
                />
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.menuRow}>
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#1e3a8a' : '#dbeafe' },
                    ]}
                  >
                    <Ionicons
                      name="mail-outline"
                      size={17}
                      color={isDark ? '#93c5fd' : '#2563eb'}
                    />
                  </View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    Email Digest & Alerts
                  </Text>
                </View>
                <Switch
                  value={emailAlerts}
                  onValueChange={(v) =>
                    void updateNotificationPref('emailAlerts', v)
                  }
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: colors.switchTrackTrue,
                  }}
                  thumbColor="#ffffff"
                />
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.menuRow}>
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: isDark ? '#451a03' : '#fef3c7' },
                    ]}
                  >
                    <Ionicons
                      name="chatbubbles-outline"
                      size={17}
                      color={isDark ? '#fcd34d' : '#d97706'}
                    />
                  </View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    Direct Messages Alerts
                  </Text>
                </View>
                <Switch
                  value={directMessages}
                  onValueChange={(v) =>
                    void updateNotificationPref('directMessages', v)
                  }
                  trackColor={{
                    false: colors.switchTrackFalse,
                    true: colors.switchTrackTrue,
                  }}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </>
        )}

        {/* ACCOUNT MANAGEMENT */}
        {matches('deactivate account delete management') && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.subtext }]}>
              ACCOUNT MANAGEMENT
            </Text>
            <View
              style={[
                styles.cardContainer,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.menuRow}
                activeOpacity={0.75}
                onPress={handleDeactivateAccount}
              >
                <View style={styles.menuLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: colors.dangerBg },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="account-off-outline"
                      size={18}
                      color={colors.danger}
                    />
                  </View>
                  <Text style={[styles.menuText, { color: colors.danger }]}>
                    Deactivate Account
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.subtext}
                />
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {/* PRIVACY & VISIBILITY MODAL */}
      <Modal
        visible={isPrivacyModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsPrivacyModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsPrivacyModalOpen(false)}
          />
          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                maxHeight: '88%',
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Privacy & Visibility
                </Text>
                <Text style={[styles.sheetSubTitle, { color: colors.subtext }]}>
                  Globe = Everyone · People = Followers · Lock = Only Me
                </Text>
              </View>
              {savingPrivacy && (
                <ActivityIndicator
                  size="small"
                  color={colors.text}
                  style={{ marginRight: 10 }}
                />
              )}
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setIsPrivacyModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.masterToggleRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.privacyRowTitle, { color: colors.text }]}>
                  Profile Visibility
                </Text>
                <Text
                  style={[styles.masterToggleSub, { color: colors.subtext }]}
                >
                  {profileVisibilityEnabled
                    ? 'Enabled — customize individual fields below'
                    : 'Disabled — all profile details hidden'}
                </Text>
              </View>
              <Switch
                value={profileVisibilityEnabled}
                onValueChange={(v) => void handleToggleMasterVisibility(v)}
                trackColor={{
                  false: colors.switchTrackFalse,
                  true: colors.switchTrackTrue,
                }}
                thumbColor="#ffffff"
              />
            </View>

            <View
              style={[styles.dividerFull, { backgroundColor: colors.border }]}
            />

            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                { key: 'bio' as const, title: 'Bio', value: bioPrivacy },
                {
                  key: 'location' as const,
                  title: 'Location Icon',
                  value: locationPrivacy,
                },
                {
                  key: 'phone' as const,
                  title: 'Phone / Call Icon',
                  value: phonePrivacy,
                },
                {
                  key: 'gender' as const,
                  title: 'Gender',
                  value: genderPrivacy,
                },
                {
                  key: 'followers' as const,
                  title: 'Followers / Following',
                  value: followersPrivacy,
                },
              ].map((item) => (
                <React.Fragment key={item.key}>
                  <View style={styles.privacyRow}>
                    <Text
                      style={[
                        styles.privacyRowTitle,
                        { color: colors.text },
                        !profileVisibilityEnabled && { opacity: 0.45 },
                      ]}
                    >
                      {item.title}
                    </Text>
                    {renderPrivacyButtons(
                      item.value,
                      (level) => void handleSelectPrivacyLevel(item.key, level),
                      !profileVisibilityEnabled
                    )}
                  </View>
                  <View
                    style={[
                      styles.dividerFull,
                      { backgroundColor: colors.border },
                    ]}
                  />
                </React.Fragment>
              ))}

              {/* WHO CAN MESSAGE ME */}
              <View style={styles.privacyRow}>
                <Text style={[styles.privacyRowTitle, { color: colors.text }]}>
                  Who Can Message Me
                </Text>
                {renderPrivacyButtons(whoCanMessage, (level) =>
                  void handleSelectPrivacyLevel('whoCanMessage', level)
                )}
              </View>
              <View
                style={[styles.dividerFull, { backgroundColor: colors.border }]}
              />

              {/* PROFILE TABS VISIBILITY */}
              <View style={{ paddingVertical: 10 }}>
                <Text
                  style={[
                    styles.privacyRowTitle,
                    { color: colors.text, marginBottom: 8 },
                  ]}
                >
                  Visible Profile Tabs
                </Text>
                {(
                  [
                    { key: 'showPosts', label: 'Posts Tab', val: showPosts },
                    { key: 'showVideos', label: 'Videos Tab', val: showVideos },
                    { key: 'showLive', label: 'Live Tab', val: showLive },
                  ] as const
                ).map((tab) => (
                  <View key={tab.key} style={styles.tabToggleRow}>
                    <Text style={[styles.dobSubLabel, { color: colors.subtext }]}>
                      {tab.label}
                    </Text>
                    <Switch
                      value={tab.val}
                      onValueChange={(v) =>
                        void handleToggleBooleanPrivacy(tab.key, v)
                      }
                      trackColor={{
                        false: colors.switchTrackFalse,
                        true: colors.switchTrackTrue,
                      }}
                      thumbColor="#ffffff"
                    />
                  </View>
                ))}
              </View>

              <View
                style={[styles.dividerFull, { backgroundColor: colors.border }]}
              />

              {/* DATE OF BIRTH VISIBILITY */}
              <View style={{ paddingVertical: 10 }}>
                <Text
                  style={[
                    styles.privacyRowTitle,
                    { color: colors.text },
                    !profileVisibilityEnabled && { opacity: 0.45 },
                  ]}
                >
                  Date of Birth Visibility
                </Text>

                {[
                  {
                    key: 'dobDay' as const,
                    label: 'Date (Day)',
                    value: dobDayPrivacy,
                  },
                  {
                    key: 'dobMonth' as const,
                    label: 'Month',
                    value: dobMonthPrivacy,
                  },
                  {
                    key: 'dobYear' as const,
                    label: 'Year',
                    value: dobYearPrivacy,
                  },
                ].map((d) => (
                  <View
                    key={d.key}
                    style={[
                      styles.dobSubRow,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.dobSubLabel, { color: colors.subtext }]}>
                      • {d.label}
                    </Text>
                    {renderPrivacyButtons(
                      d.value,
                      (level) => void handleSelectPrivacyLevel(d.key, level),
                      !profileVisibilityEnabled
                    )}
                  </View>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.accent }]}
              onPress={() => setIsPrivacyModalOpen(false)}
              activeOpacity={0.85}
            >
              <Text style={[styles.actionBtnText, { color: colors.accentText }]}>
                Done
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* CHANGE PASSWORD MODAL */}
      <Modal
        visible={isPasswordModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsPasswordModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsPasswordModalOpen(false)}
          />
          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
                Change Password
              </Text>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setIsPasswordModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.subtext }]}>
              CURRENT PASSWORD (OPTIONAL)
            </Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.inputBg,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              placeholderTextColor={colors.subtext}
            />

            <Text style={[styles.inputLabel, { color: colors.subtext }]}>
              NEW PASSWORD
            </Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.inputBg,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Min 6 characters"
              placeholderTextColor={colors.subtext}
            />

            <Text style={[styles.inputLabel, { color: colors.subtext }]}>
              CONFIRM NEW PASSWORD
            </Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.inputBg,
                  color: colors.text,
                  borderColor: colors.borderStrong,
                },
              ]}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter new password"
              placeholderTextColor={colors.subtext}
            />

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.accent }]}
              onPress={() => void handleUpdatePassword()}
              disabled={updatingPassword}
              activeOpacity={0.85}
            >
              {updatingPassword ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text
                  style={[styles.actionBtnText, { color: colors.accentText }]}
                >
                  Update Password
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* LOGIN ACTIVITY / SESSIONS MODAL */}
      <Modal
        visible={isSessionsModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsSessionsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsSessionsModalOpen(false)}
          />
          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
                Login Activity
              </Text>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setIsSessionsModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.sessionCard,
                { backgroundColor: colors.inputBg },
              ]}
            >
              <Ionicons
                name={Platform.OS === 'ios' ? 'logo-apple' : 'logo-android'}
                size={24}
                color={colors.text}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.menuText, { color: colors.text }]}>
                  This Device ({Platform.OS.toUpperCase()})
                </Text>
                <Text style={[styles.menuSub, { color: colors.subtext }]}>
                  {sessionEmail} · Active now
                </Text>
                <Text style={[styles.menuSub, { color: colors.subtext }]}>
                  Last sign-in: {lastSignIn}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: colors.dangerBg },
              ]}
              onPress={() => void handleSignOutAllOtherDevices()}
              activeOpacity={0.85}
            >
              <Text style={[styles.actionBtnText, { color: colors.danger }]}>
                Log Out All Other Devices
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* BLOCKED USERS MODAL */}
      <Modal
        visible={isBlockedModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsBlockedModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsBlockedModalOpen(false)}
          />
          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                maxHeight: '70%',
                paddingBottom: Math.max(insets.bottom, 16) + 12,
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
                Blocked Users
              </Text>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setIsBlockedModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {loadingBlocked ? (
              <ActivityIndicator
                size="small"
                color={colors.text}
                style={{ paddingVertical: 24 }}
              />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {blockedUsersList.length === 0 ? (
                  <Text style={[styles.emptyText, { color: colors.subtext }]}>
                    No blocked users found.
                  </Text>
                ) : (
                  blockedUsersList.map((user) => (
                    <View
                      key={user.id}
                      style={[
                        styles.blockedUserRow,
                        { borderBottomColor: colors.border },
                      ]}
                    >
                      <View>
                        <Text
                          style={[
                            styles.blockedUserName,
                            { color: colors.text },
                          ]}
                        >
                          {user.name}
                        </Text>
                        <Text
                          style={[
                            styles.blockedUserHandle,
                            { color: colors.subtext },
                          ]}
                        >
                          {user.handle}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.unblockBtn,
                          { backgroundColor: colors.dangerBg },
                        ]}
                        onPress={() => handleUnblockUser(user)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.unblockBtnText,
                            { color: colors.danger },
                          ]}
                        >
                          Unblock
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* BLUE TICK VERIFICATION MODAL */}
      <Modal
        visible={isVerifModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsVerifModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsVerifModalOpen(false)}
          />
          <View
            style={[
              styles.bottomSheet,
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-circle" size={20} color="#0095f6" />
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Blue Tick Verification
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.sheetCloseBtn,
                  { backgroundColor: colors.surface },
                ]}
                onPress={() => setIsVerifModalOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {isVerified ? (
              <View style={{ paddingVertical: 16, gap: 10 }}>
                <Text style={[styles.menuText, { color: colors.text }]}>
                  Your account is verified!
                </Text>
                <Text style={[styles.menuSub, { color: colors.subtext }]}>
                  Your Blue Tick badge is active on your profile.
                </Text>
              </View>
            ) : latestVerifReq?.status === 'pending' ? (
              <View style={{ paddingVertical: 14, gap: 8 }}>
                <Text style={[styles.menuText, { color: colors.text }]}>
                  Request Pending Approval
                </Text>
                <Text style={[styles.menuSub, { color: colors.subtext }]}>
                  Your application ({latestVerifReq.category || 'Creator'}) has been submitted and is waiting for approval. Your Blue Tick will appear automatically once approved.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10, paddingTop: 6 }}>
                {latestVerifReq?.status === 'rejected' && (
                  <Text style={{ color: colors.danger, fontSize: 12.5, fontWeight: '600' }}>
                    Previous request was not approved
                    {latestVerifReq.reviewer_note
                      ? `: ${latestVerifReq.reviewer_note}`
                      : '. You can submit a new request below.'}
                  </Text>
                )}

                <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                  CATEGORY
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['Creator', 'Artist', 'Public Figure', 'Brand'].map((cat) => {
                    const active = verifCategory === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 999,
                          backgroundColor: active ? colors.accent : colors.inputBg,
                        }}
                        onPress={() => setVerifCategory(cat)}
                      >
                        <Text
                          style={{
                            fontSize: 12.5,
                            fontWeight: '700',
                            color: active ? colors.accentText : colors.text,
                          }}
                        >
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                  WHY SHOULD YOU BE VERIFIED?
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      height: 82,
                      textAlignVertical: 'top',
                      backgroundColor: colors.inputBg,
                      color: colors.text,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                  multiline
                  value={verifReason}
                  onChangeText={setVerifReason}
                  placeholder="Share your creator work, channel highlights, or notable presence..."
                  placeholderTextColor={colors.subtext}
                />

                <Text style={[styles.inputLabel, { color: colors.subtext }]}>
                  PORTFOLIO / REFERENCE LINK (OPTIONAL)
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: colors.inputBg,
                      color: colors.text,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                  value={verifDocUrl}
                  onChangeText={setVerifDocUrl}
                  placeholder="https://..."
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                />

                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    { backgroundColor: colors.accent, marginTop: 6 },
                  ]}
                  onPress={() => void handleSubmitVerificationRequest()}
                  disabled={submittingVerif}
                  activeOpacity={0.85}
                >
                  {submittingVerif ? (
                    <ActivityIndicator color={colors.accentText} />
                  ) : (
                    <Text
                      style={[styles.actionBtnText, { color: colors.accentText }]}
                    >
                      Submit Blue Tick Request
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
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
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  scrollContent: { padding: 16 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 14,
    gap: 8,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 18,
    marginLeft: 4,
  },
  cardContainer: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  themeBlock: {
    padding: 14,
    gap: 12,
  },
  themeSegmentTrack: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    gap: 4,
  },
  themeSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  themeSegmentText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuText: { fontSize: 14, fontWeight: '700' },
  menuSub: { fontSize: 11.5, marginTop: 2, fontWeight: '500' },
  divider: { height: 1, marginLeft: 60 },
  dividerFull: { height: 1 },
  badgeCountBox: { flexDirection: 'row', alignItems: 'center' },
  badgeCountText: { fontSize: 12.5, fontWeight: '700' },
  masterToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 4,
  },
  masterToggleSub: { fontSize: 11.5, marginTop: 2 },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  privacyRowTitle: { fontSize: 13.5, fontWeight: '700' },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segmentBtn: {
    width: 32,
    height: 28,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  dobSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderBottomWidth: 1,
    paddingBottom: 6,
  },
  dobSubLabel: { fontSize: 12.5, fontWeight: '600', marginLeft: 4 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
  },
  bottomSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
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
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  sheetSubTitle: { fontSize: 11.5, marginTop: 3, fontWeight: '500' },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
  },
  actionBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  actionBtnText: { fontSize: 14, fontWeight: '800' },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    marginTop: 6,
  },
  blockedUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  blockedUserName: { fontSize: 14, fontWeight: '700' },
  blockedUserHandle: { fontSize: 12, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  unblockBtnText: { fontSize: 12, fontWeight: '700' },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 28,
    fontSize: 13.5,
    fontWeight: '500',
  },
});