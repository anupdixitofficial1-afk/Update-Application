import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export interface FloatingReactionItem {
  id: string;
  emoji: string;

  color?: string;
}

function FloatingBubble({
  item,
  onComplete,
}: {
  item: FloatingReactionItem;
  onComplete: (id: string) => void;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(
    new Animated.Value((Math.random() - 0.5) * 28)
  ).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -170,
        duration: 1400,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 1400,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1.15,
        friction: 5,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        onComplete(item.id);
      }
    });
  }, [item.id, onComplete, opacity, scale, translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bubble,
        {
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
        },
      ]}
    >
      <Text style={styles.emoji}>{item.emoji}</Text>
    </Animated.View>
  );
}

export function LiveFloatingReactions({
  reactions,
  onComplete,
}: {
  reactions: FloatingReactionItem[];
  onComplete: (id: string) => void;
}) {
  if (!reactions.length) return null;

  return (
    <View pointerEvents="none" style={styles.container}>
      {reactions.map((item) => (
        <FloatingBubble key={item.id} item={item} onComplete={onComplete} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'visible',
  },
  bubble: {
    position: 'absolute',
    bottom: 24,
  },
  emoji: {
    fontSize: 26,
  },
});

export default LiveFloatingReactions;