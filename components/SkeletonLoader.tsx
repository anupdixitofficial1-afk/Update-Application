import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

export function SkeletonBox({
  width,
  height,
  borderRadius = 8,
  isDark = false,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  isDark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: isDark ? '#27272a' : '#e4e4e7',
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

export function FeedSkeletonList({ isDark }: { isDark: boolean }) {
  return (
    <View style={styles.container}>
      {[0, 1].map((idx) => (
        <View key={idx} style={styles.card}>
          <View style={styles.row}>
            <SkeletonBox width={38} height={38} borderRadius={19} isDark={isDark} />
            <View style={{ flex: 1, gap: 6 }}>
              <SkeletonBox width="45%" height={13} isDark={isDark} />
              <SkeletonBox width="28%" height={10} isDark={isDark} />
            </View>
          </View>
          <SkeletonBox width="88%" height={12} isDark={isDark} style={{ marginTop: 10 }} />
          <SkeletonBox
            width="100%"
            height={220}
            borderRadius={12}
            isDark={isDark}
            style={{ marginTop: 10 }}
          />
        </View>
      ))}
    </View>
  );
}

export function WatchGridSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <View style={styles.container}>
      {[0, 1].map((idx) => (
        <View key={idx} style={styles.card}>
          <SkeletonBox width="100%" height={205} borderRadius={14} isDark={isDark} />
          <View style={[styles.row, { marginTop: 10 }]}>
            <SkeletonBox width={36} height={36} borderRadius={18} isDark={isDark} />
            <View style={{ flex: 1, gap: 6 }}>
              <SkeletonBox width="75%" height={14} isDark={isDark} />
              <SkeletonBox width="45%" height={11} isDark={isDark} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

export function ChatListSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <View style={styles.container}>
      {[0, 1, 2, 3, 4].map((idx) => (
        <View key={idx} style={[styles.row, { paddingVertical: 12 }]}>
          <SkeletonBox width={50} height={50} borderRadius={25} isDark={isDark} />
          <View style={{ flex: 1, gap: 7 }}>
            <SkeletonBox width="50%" height={14} isDark={isDark} />
            <SkeletonBox width="78%" height={11} isDark={isDark} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ProfileSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <View style={[styles.container, { paddingTop: 24 }]}>
      <View style={styles.row}>
        <SkeletonBox width={82} height={82} borderRadius={41} isDark={isDark} />
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
          <SkeletonBox width={46} height={32} isDark={isDark} />
          <SkeletonBox width={46} height={32} isDark={isDark} />
          <SkeletonBox width={46} height={32} isDark={isDark} />
        </View>
      </View>
      <SkeletonBox width="48%" height={16} isDark={isDark} style={{ marginTop: 16 }} />
      <SkeletonBox width="76%" height={12} isDark={isDark} style={{ marginTop: 8 }} />
      <View style={[styles.row, { marginTop: 18 }]}>
        <SkeletonBox width="48%" height={36} borderRadius={10} isDark={isDark} />
        <SkeletonBox width="48%" height={36} borderRadius={10} isDark={isDark} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 14,
  },
  card: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
