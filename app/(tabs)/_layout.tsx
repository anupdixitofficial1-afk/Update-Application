import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Image } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

const THEME_COLOR = '#10b981';

let cachedAvatarUrl: string | null = null;
let cachedUserId: string | null = null;

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(cachedAvatarUrl);
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    cachedUserId
  );

  useEffect(() => {
    let active = true;

    const loadUserAvatar = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user || !active) return;

        cachedUserId = user.id;
        setCurrentUserId(user.id);

        const metaAvatar =
          typeof user.user_metadata?.avatar_url === 'string' &&
          user.user_metadata.avatar_url.trim()
            ? user.user_metadata.avatar_url.trim()
            : null;

        if (metaAvatar && !cachedAvatarUrl && active) {
          cachedAvatarUrl = metaAvatar;
          setAvatarUrl(metaAvatar);
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', user.id)
          .maybeSingle();

        if (!active) return;

        const dbAvatar =
          typeof profile?.avatar_url === 'string' && profile.avatar_url.trim()
            ? profile.avatar_url.trim()
            : null;

        const resolved = dbAvatar || metaAvatar;
        if (resolved) {
          cachedAvatarUrl = resolved;
          setAvatarUrl(resolved);
        }
      } catch {
        // Keep cached or fallback icon if fetch fails
      }
    };

    void loadUserAvatar();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) {
          cachedAvatarUrl = null;
          cachedUserId = null;
          if (active) {
            setAvatarUrl(null);
            setCurrentUserId(null);
          }
          return;
        }
        void loadUserAvatar();
      }
    );

    return () => {
      active = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const openOwnProfile = () => {
    const uid = currentUserId || cachedUserId;
    const target = uid
      ? ({ pathname: '/profile', params: { userId: uid } } as const)
      : ('/profile' as const);

    try {
      router.replace(target as never);
    } catch {
      router.push(target as never);
    }
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: THEME_COLOR,
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#e2e8f0',
          height: 52 + bottomPad,
          paddingTop: 6,
          paddingBottom: bottomPad,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={26}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="watch"
        options={{
          title: 'Watch',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'play-circle' : 'play-circle-outline'}
              size={27}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: () => (
            <View style={styles.createCircle}>
              <Ionicons name="add" size={25} color="#ffffff" />
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="connect"
        options={{
          title: 'Connect',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={26}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            openOwnProfile();
          },
        }}
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) =>
            avatarUrl ? (
              <View
                style={[
                  styles.profileAvatarRing,
                  focused && styles.profileAvatarRingActive,
                ]}
              >
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.profileAvatarImg}
                />
              </View>
            ) : (
              <Ionicons
                name={focused ? 'person' : 'person-outline'}
                size={26}
                color={color}
              />
            ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  createCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: THEME_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarRing: {
    width: 35,
    height: 35,
    borderRadius: 15,
    padding: 1.5,
    borderWidth: 1.0,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarRingActive: {
    borderColor: THEME_COLOR,
    borderWidth: 1,
  },
  profileAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },
});