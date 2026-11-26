import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export function triggerHeartHaptic() {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Ignore on unsupported devices
  }
}

export function DoubleTapHeartBurst({ triggerKey }: { triggerKey: number }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (triggerKey <= 0) return;
    scale.setValue(0.4);
    opacity.setValue(1);
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 1.2,
        speed: 28,
        bounciness: 12,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 280,
        delay: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [triggerKey, scale, opacity]);

  if (triggerKey <= 0) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <Ionicons name="heart" size={78} color="#f43f5e" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
  },
});
