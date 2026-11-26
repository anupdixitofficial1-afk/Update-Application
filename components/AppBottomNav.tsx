import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  Image,
  Platform,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { backend } from '../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

export type AppNavTab = 'home' | 'watch' | 'create' | 'connect' | 'profile';

interface AppBottomNavProps {
  activeTab?: AppNavTab;
  avatarUrl?: string | null;
}

interface DockItemProps {
  active?: boolean;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
  pillBg: string;
  children?: React.ReactNode;
  iconName?: keyof typeof Ionicons.glyphMap;
  activeIconName?: keyof typeof Ionicons.glyphMap;
}

function DockTabButton({
  active = false,
  onPress,
  activeColor,
  inactiveColor,
  pillBg,
  children,
  iconName,
  activeIconName,
}: DockItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
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

export default function AppBottomNav({
  activeTab,
  avatarUrl,
}: AppBottomNavProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const bottomSafePad =
    Platform.OS === 'android' ? insets.bottom : Math.max(insets.bottom, 6);

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string | null>(
    avatarUrl ?? null
  );
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

  useEffect(() => {
    if (avatarUrl !== undefined) {
      setResolvedAvatarUrl(avatarUrl || null);
      return;
    }
    let mounted = true;
    backend.auth
      .getCurrentUser()
      .then((u) => {
        if (mounted && u?.avatarUrl) {
          setResolvedAvatarUrl(u.avatarUrl);
        }
      })
      .catch(() => { });
    return () => {
      mounted = false;
    };
  }, [avatarUrl]);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setThemeMode(saved);
        }
      })
      .catch(() => { });

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

  const goTo = (route: string) => {
    try {
      router.navigate(route as never);
    } catch {
      try {
        router.replace(route as never);
      } catch {
        // Route not mounted
      }
    }
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
          active={activeTab === 'home'}
          onPress={() => goTo('/(tabs)')}
          activeColor={palette.activeIcon}
          inactiveColor={palette.inactiveIcon}
          pillBg={palette.activePill}
          iconName="home-outline"
          activeIconName="home"
        />

        <DockTabButton
          active={activeTab === 'watch'}
          onPress={() => goTo('/(tabs)/watch')}
          activeColor={palette.activeIcon}
          inactiveColor={palette.inactiveIcon}
          pillBg={palette.activePill}
          iconName="play-circle-outline"
          activeIconName="play-circle"
        />

        <DockTabButton
          active={activeTab === 'create'}
          onPress={() => goTo('/(tabs)/create')}
          activeColor={palette.activeIcon}
          inactiveColor={palette.inactiveIcon}
          pillBg={palette.activePill}
          iconName="add-circle-outline"
          activeIconName="add-circle"
        />

        <DockTabButton
          active={activeTab === 'connect'}
          onPress={() => goTo('/(tabs)/connect')}
          activeColor={palette.activeIcon}
          inactiveColor={palette.inactiveIcon}
          pillBg={palette.activePill}
          iconName="people-outline"
          activeIconName="people"
        />

        <DockTabButton
          active={activeTab === 'profile'}
          onPress={() => {
            DeviceEventEmitter.emit('profile-tab-pressed');
            goTo('/(tabs)/profile');
          }}
          activeColor={palette.activeIcon}
          inactiveColor={palette.inactiveIcon}
          pillBg={palette.activePill}
          iconName="person-outline"
          activeIconName="person"
        >
          {resolvedAvatarUrl ? (
            <View
              style={[
                styles.avatarFrame,
                activeTab === 'profile' && {
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
                source={{ uri: resolvedAvatarUrl }}
                style={styles.avatarPic}
              />
            </View>
          ) : undefined}
        </DockTabButton>
      </View>
    </View>
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
  },
});