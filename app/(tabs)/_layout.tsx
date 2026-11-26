import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  StyleSheet,
  View,
  Image,
  TouchableOpacity,
  Animated,
  DeviceEventEmitter,
  Platform,
  useColorScheme,
} from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backend } from '../../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';
type TabRouteName = 'index' | 'watch' | 'create' | 'connect' | 'profile';

let cachedAvatarUrl: string | null = null;
let cachedUserId: string | null = null;

function DockTabButton({
  active,
  onPress,
  activeColor,
  inactiveColor,
  pillBg,
  iconName,
  activeIconName,
  children,
}: {
  active: boolean;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
  pillBg: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  activeIconName?: keyof typeof Ionicons.glyphMap;
  children?: React.ReactNode;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.88,
      useNativeDriver: true,
      speed: 35,
      bounciness: 6,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 28,
      bounciness: 8,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.tabSlot}
    >
      <Animated.View
        style={[
          styles.tabInner,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {children ??
          (iconName && (
            <Ionicons
              name={active && activeIconName ? activeIconName : iconName}
              size={27}
              color={active ? activeColor : inactiveColor}
            />
          ))}
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const bottomSafePad =
    Platform.OS === 'android' ? insets.bottom : Math.max(insets.bottom, 6);

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const palette = useMemo(
    () => ({
      dockBg: isDark ? '#09090b' : '#ffffff',
      dockBorder: isDark ? '#27272a' : '#e4e4e7',
      activeIcon: isDark ? '#fafafa' : '#09090b',
      inactiveIcon: isDark ? '#a1a1aa' : '#71717a',
      activePill: isDark ? '#27272a' : '#f4f4f5',
      ringBorder: isDark ? '#fafafa' : '#09090b',
      shadow: isDark ? '#000000' : '#09090b',
    }),
    [isDark]
  );

  const [avatarUrl, setAvatarUrl] = useState<string | null>(cachedAvatarUrl);
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    cachedUserId
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

  useEffect(() => {
    let active = true;

    const loadUserAvatar = async () => {
      try {
        const user = await backend.auth.getCurrentUser();
        if (!user || !active) return;

        cachedUserId = user.id;
        setCurrentUserId(user.id);

        const resolved =
          typeof user.avatarUrl === 'string' && user.avatarUrl.trim()
            ? user.avatarUrl.trim()
            : null;

        cachedAvatarUrl = resolved;
        setAvatarUrl(resolved);
      } catch {
        // Keep cached or fallback icon if fetch fails
      }
    };

    void loadUserAvatar();

    const avatarSub = DeviceEventEmitter.addListener(
      'profile-avatar-updated',
      (payload?: { avatarUrl?: string; userId?: string }) => {
        if (!active) return;
        const activeUid = currentUserId || cachedUserId;
        if (payload?.userId && activeUid && payload.userId !== activeUid) return;

        const nextUrl =
          typeof payload?.avatarUrl === 'string' && payload.avatarUrl.trim()
            ? payload.avatarUrl.trim()
            : null;

        cachedAvatarUrl = nextUrl;
        setAvatarUrl(nextUrl);
      }
    );

    const unsubscribeAuth = backend.auth.onAuthStateChange((isSignedIn) => {
      if (!isSignedIn) {
        cachedAvatarUrl = null;
        cachedUserId = null;
        if (active) {
          setAvatarUrl(null);
          setCurrentUserId(null);
        }
        return;
      }
      void loadUserAvatar();
    });

    return () => {
      active = false;
      avatarSub.remove();
      unsubscribeAuth();
    };
  }, [currentUserId]);

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => {
        const tabState = props?.state;
        const activeIndex =
          typeof tabState?.index === 'number' ? tabState.index : 0;
        const currentRoute =
          (tabState?.routes?.[activeIndex]?.name as TabRouteName | undefined) ??
          'index';

        const navigateToTab = (routeName: TabRouteName) => {
          const targetRoute = tabState?.routes?.find(
            (r) => r.name === routeName
          );
          if (targetRoute?.key && typeof props?.navigateToTab === 'function') {
            const event = props.emitter?.emit({
              type: 'tabPress',
              target: targetRoute.key,
              canPreventDefault: true,
            });
            if (!event?.defaultPrevented) {
              props.navigateToTab(targetRoute.key);
            }
            return;
          }
          const href =
            routeName === 'index'
              ? '/(tabs)'
              : (`/(tabs)/${routeName}` as const);
          router.navigate(href as never);
        };

        const handleOpenOwnProfile = () => {
          DeviceEventEmitter.emit('profile-tab-pressed');
          navigateToTab('profile');
        };

        return (
          <View
            pointerEvents="box-none"
            style={[styles.floatingWrapper, { bottom: 0 }]}
          >
            <View
              style={[
                styles.capsuleDock,
                {
                  backgroundColor: palette.dockBg,
                  borderTopColor: palette.dockBorder,
                  height: 58 + bottomSafePad,
                  paddingBottom: bottomSafePad,
                },
              ]}
            >
              <DockTabButton
                active={currentRoute === 'index'}
                onPress={() => navigateToTab('index')}
                activeColor={palette.activeIcon}
                inactiveColor={palette.inactiveIcon}
                pillBg={palette.activePill}
                iconName="home-outline"
                activeIconName="home"
              />

              <DockTabButton
                active={currentRoute === 'watch'}
                onPress={() => navigateToTab('watch')}
                activeColor={palette.activeIcon}
                inactiveColor={palette.inactiveIcon}
                pillBg={palette.activePill}
                iconName="play-circle-outline"
                activeIconName="play-circle"
              />

              <DockTabButton
                active={currentRoute === 'create'}
                onPress={() => navigateToTab('create')}
                activeColor={palette.activeIcon}
                inactiveColor={palette.inactiveIcon}
                pillBg={palette.activePill}
                iconName="add-circle-outline"
                activeIconName="add-circle"
              />

              <DockTabButton
                active={currentRoute === 'connect'}
                onPress={() => navigateToTab('connect')}
                activeColor={palette.activeIcon}
                inactiveColor={palette.inactiveIcon}
                pillBg={palette.activePill}
                iconName="people-outline"
                activeIconName="people"
              />

              <DockTabButton
                active={currentRoute === 'profile'}
                onPress={handleOpenOwnProfile}
                activeColor={palette.activeIcon}
                inactiveColor={palette.inactiveIcon}
                pillBg={palette.activePill}
                iconName="person-outline"
                activeIconName="person"
              >
                {avatarUrl ? (
                  <View
                    style={[
                      styles.avatarFrame,
                      currentRoute === 'profile' && {
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        borderWidth: 2,
                        padding: 1.5,
                        borderColor: palette.ringBorder,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: avatarUrl }}
                      style={styles.avatarPic}
                    />
                  </View>
                ) : undefined}
              </DockTabButton>
            </View>
          </View>
        );
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="watch" options={{ title: 'Watch' }} />
      <Tabs.Screen name="create" options={{ title: 'Create' }} />
      <Tabs.Screen name="connect" options={{ title: 'Connect' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  floatingWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  capsuleDock: {
    width: '100%',
    borderTopWidth: 1,
    paddingHorizontal: 6,
    paddingTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabSlot: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    width: 48,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFrame: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 0,
    overflow: 'hidden',
  },
  avatarPic: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
});