import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, ViewStyle } from 'react-native';

interface RecordProgressRingProps {
  active: boolean;
  durationSec?: number;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

export function RecordProgressRing({
  active,
  durationSec = 60,
  size = 86,
  color = '#ef4444',
  style,
}: RecordProgressRingProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.stopAnimation();
    if (!active) {
      progress.setValue(0);
      return;
    }

    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(1000, durationSec * 1000),
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [active, durationSec, progress]);

  if (!active) return null;

  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const pulseScale = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.06, 1],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
          transform: [{ rotate }, { scale: pulseScale }],
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 4,
    borderTopColor: '#ffffff',
    borderRightColor: 'rgba(255, 255, 255, 0.35)',
  },
});

export default RecordProgressRing;