import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '../lib/supabase';
import { backend } from '../lib/backend';
import {
  configureDeviceNotificationsHandler,
  ensureDeviceNotificationChannelsAndToken,
  triggerPhoneMessageNotification,
} from '../lib/deviceNotifications';
import { recordDailyVibeActivity } from '../lib/growthFeatures';
import { FloatingMiniPlayer } from '../components/FloatingMiniPlayer';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();

  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session ?? null);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession ?? null);
      }
    });

    return () => {
      active = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session === undefined) return;

    const firstSegment = segments[0];
    const isAuthRoute = firstSegment === 'login' || firstSegment === 'signup';

    if (!session && !isAuthRoute) {
      router.replace('/login' as never);
    } else if (session && isAuthRoute) {
      router.replace('/(tabs)' as never);
    }
  }, [session, segments, router]);

  useEffect(() => {
    configureDeviceNotificationsHandler();
    const tapSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response?.notification?.request?.content?.data as
          | Record<string, any>
          | undefined;
        if (data?.route === 'messages' && data?.userId) {
          router.push({
            pathname: '/messages',
            params: {
              userId: String(data.userId),
              name: String(data.name || 'Chat'),
              avatarUrl: String(data.avatarUrl || ''),
            },
          } as any);
        } else if (data?.route === 'live') {
          router.push({
            pathname: '/studio/live',
            params: {
              mode: 'viewer',
              streamId: data?.streamId ? String(data.streamId) : undefined,
              title: data?.title ? String(data.title) : undefined,
            },
          } as any);
        }
      }
    );
    return () => {
      tapSub.remove();
    };
  }, [router]);

  useEffect(() => {
    const uid = session?.user?.id || null;
    if (!uid) return;
    void ensureDeviceNotificationChannelsAndToken(uid);
    void recordDailyVibeActivity(uid);

    const unsubscribeInbox = backend.chats.subscribeInboxEvents(uid, {
      onMessageInsert: (row) => {
        if (row?.receiver_id === uid && row?.sender_id && row.sender_id !== uid) {
          void triggerPhoneMessageNotification({
            messageId: row.id,
            senderId: String(row.sender_id),
            rawContent:
              row.content ?? row.body ?? row.message ?? row.text ?? row.msg ?? '',
          });
        }
      },
      onMessageUpdate: () => {},
      onProfileUpdate: () => {},
    });
    return () => {
      unsubscribeInbox();
    };
  }, [session?.user?.id]);

  if (session === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="messages" options={{ headerShown: false }} />
        <Stack.Screen name="chats" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="connections" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="creator-studio" options={{ headerShown: false }} />
        <Stack.Screen name="media/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="studio/drafts" options={{ headerShown: false }} />
        <Stack.Screen name="studio/video" options={{ headerShown: false }} />
        <Stack.Screen name="studio/reel" options={{ headerShown: false }} />
        <Stack.Screen name="studio/live" options={{ headerShown: false }} />
        <Stack.Screen name="studio/post" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      <FloatingMiniPlayer />
    </ThemeProvider>
  );
}