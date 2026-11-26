import React, { useEffect, useState, useRef } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  closeMiniPlayer,
  MiniPlayerSession,
  subscribeMiniPlayer,
  toggleMiniPlayerPlay,
} from '../lib/miniPlayerStore';

function MiniPlayerVideoPreview({
  uri,
  isPlaying,
}: {
  uri: string;
  isPlaying: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    if (isPlaying) p.play();
  });

  useEffect(() => {
    try {
      if (isPlaying) player.play();
      else player.pause();
    } catch {}
  }, [player, isPlaying]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

export function FloatingMiniPlayer() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';

  const [session, setSession] = useState<MiniPlayerSession | null>(null);
  const offsetY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return subscribeMiniPlayer(setSession);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 8,
      onPanResponderMove: (_evt, g) => {
        if (g.dy < 80 && g.dy > -260) {
          offsetY.setValue(g.dy);
        }
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > 45) {
          closeMiniPlayer();
          offsetY.setValue(0);
          return;
        }
        Animated.spring(offsetY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  // Hide automatically when on the target fullscreen player route or login/signup
  if (
    !session ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/messages'
  ) {
    return null;
  }

  const handleExpand = () => {
    const target = session;
    closeMiniPlayer();
    router.push({
      pathname: target.expandRoute as any,
      params: target.expandParams || {},
    });
  };

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.container,
        {
          bottom: Math.max(insets.bottom, 12) + 74,
          backgroundColor: isDark ? 'rgba(24,24,27,0.96)' : 'rgba(15,23,42,0.95)',
          borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.2)',
          transform: [{ translateY: offsetY }],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.thumbBox}
        onPress={handleExpand}
      >
        {session.mediaUrl ? (
          <MiniPlayerVideoPreview
            uri={session.mediaUrl}
            isPlaying={session.isPlaying}
          />
        ) : session.thumbnailUrl ? (
          <Image
            source={{ uri: session.thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.fallbackThumb}>
            <Ionicons name="play" size={18} color="#fff" />
          </View>
        )}
        {session.isLive && (
          <View style={styles.liveDotBadge}>
            <Text style={styles.liveDotText}>LIVE</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.metaCol}
        onPress={handleExpand}
      >
        <Text style={styles.title} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={styles.creator} numberOfLines={1}>
          {session.creatorName}
          {session.isLive ? ' · Live now' : ' · Tap to expand'}
        </Text>
      </TouchableOpacity>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={toggleMiniPlayerPlay}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={session.isPlaying ? 'pause' : 'play'}
            size={18}
            color="#ffffff"
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={closeMiniPlayer}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={19} color="#cbd5e1" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 62,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    gap: 10,
    zIndex: 999,
    elevation: 16,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  thumbBox: {
    width: 82,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#18181b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackThumb: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
  },
  liveDotBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: '#ef4444',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  liveDotText: {
    color: '#fff',
    fontSize: 8.5,
    fontWeight: '900',
  },
  metaCol: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  creator: {
    color: '#a1a1aa',
    fontSize: 11,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 4,
  },
  controlBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
