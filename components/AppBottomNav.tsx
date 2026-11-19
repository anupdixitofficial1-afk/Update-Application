import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export type AppNavTab = 'home' | 'watch' | 'create' | 'connect' | 'profile';

interface AppBottomNavProps {
  activeTab?: AppNavTab;
}

export default function AppBottomNav({ activeTab }: AppBottomNavProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  const navigateTo = (path: string) => {
    try {
      router.replace(path as never);
    } catch {
      // Ignore if route is not registered
    }
  };

  return (
    <View style={[styles.bar, { paddingBottom: bottomPad }]}>
      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.75}
        onPress={() => navigateTo('/')}
      >
        <Ionicons
          name={activeTab === 'home' ? 'home' : 'home-outline'}
          size={25}
          color={activeTab === 'home' ? '#0d9488' : '#64748b'}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.75}
        onPress={() => navigateTo('/watch')}
      >
        <Ionicons
          name={activeTab === 'watch' ? 'play-circle' : 'play-circle-outline'}
          size={26}
          color={activeTab === 'watch' ? '#0d9488' : '#64748b'}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.8}
        onPress={() => navigateTo('/create')}
      >
        <View style={styles.createCircle}>
          <Ionicons name="add" size={24} color="#ffffff" />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.75}
        onPress={() => navigateTo('/connect')}
      >
        <Ionicons
          name={activeTab === 'connect' ? 'people' : 'people-outline'}
          size={25}
          color={activeTab === 'connect' ? '#0d9488' : '#64748b'}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.75}
        onPress={() => navigateTo('/profile')}
      >
        <Ionicons
          name={activeTab === 'profile' ? 'person' : 'person-outline'}
          size={25}
          color={activeTab === 'profile' ? '#0d9488' : '#64748b'}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 9,
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 54,
    paddingVertical: 2,
  },
  createCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0d9488',
    alignItems: 'center',
    justifyContent: 'center',
  },
});