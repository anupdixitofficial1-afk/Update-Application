import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

export interface ReelCoverSelection {
  uri: string;
  timeSec: number | null;
  source: 'frame' | 'custom';
}

interface ReelCoverPickerProps {
  visible: boolean;
  videoUri: string;
  durationSec?: number;
  currentCoverUri?: string;
  currentTimeSec?: number | null;
  onClose: () => void;
  onConfirm: (selection: ReelCoverSelection) => void;
}

const FRAME_RATIOS = [0.05, 0.22, 0.4, 0.58, 0.76, 0.92];

export function ReelCoverPicker({
  visible,
  videoUri,
  durationSec = 15,
  currentCoverUri,
  currentTimeSec = null,
  onClose,
  onConfirm,
}: ReelCoverPickerProps) {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const sheetColors = useMemo(
    () => ({
      sheetBg: isDark ? '#141416' : '#ffffff',
      border: isDark ? '#27272a' : '#e4e4e7',
      surface: isDark ? '#27272a' : '#f4f4f5',
      text: isDark ? '#ffffff' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#71717a',
      handle: isDark ? '#3f3f46' : '#d4d4d8',
    }),
    [isDark]
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

  const [frames, setFrames] = useState<{ uri: string; timeSec: number }[]>([]);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [selectedUri, setSelectedUri] = useState<string>(currentCoverUri || '');
  const [selectedTimeSec, setSelectedTimeSec] = useState<number | null>(
    currentTimeSec ?? null
  );
  const [source, setSource] = useState<'frame' | 'custom'>('frame');

  useEffect(() => {
    if (!visible) return;
    setSelectedUri(currentCoverUri || '');
    setSelectedTimeSec(currentTimeSec ?? null);
    setSource(currentTimeSec != null ? 'frame' : 'custom');

    if (!videoUri) {
      setFrames([]);
      return;
    }

    let cancelled = false;
    const totalSec = durationSec > 0 ? durationSec : 15;

    const loadFrames = async () => {
      setLoadingFrames(true);
      const nextFrames: { uri: string; timeSec: number }[] = [];

      for (const ratio of FRAME_RATIOS) {
        if (cancelled) return;
        const sec = Number((ratio * totalSec).toFixed(2));
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
            time: Math.max(0, Math.round(sec * 1000)),
            quality: 0.7,
          });
          if (uri) {
            nextFrames.push({ uri, timeSec: sec });
          }
        } catch {
          // ignore single frame error
        }
      }

      if (!cancelled) {
        setFrames(nextFrames);
        const hasRealCover =
          Boolean(currentCoverUri) &&
          !String(currentCoverUri).includes('images.unsplash.com');
        if (!hasRealCover && nextFrames.length > 0) {
          setSelectedUri(nextFrames[0].uri);
          setSelectedTimeSec(nextFrames[0].timeSec);
          setSource('frame');
        }
        setLoadingFrames(false);
      }
    };

    void loadFrames();
    return () => {
      cancelled = true;
    };
  }, [visible, videoUri, durationSec, currentCoverUri, currentTimeSec]);

  const handlePickCustomImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission Needed',
          'Please allow photo library access to pick a custom cover.'
        );
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.85,
      });

      if (!res.canceled && res.assets?.[0]?.uri) {
        setSelectedUri(res.assets[0].uri);
        setSelectedTimeSec(null);
        setSource('custom');
      }
    } catch {
      Alert.alert('Picker Error', 'Could not open photo library.');
    }
  };

  const handleConfirm = () => {
    if (!selectedUri) {
      onClose();
      return;
    }
    onConfirm({
      uri: selectedUri,
      timeSec: source === 'frame' ? selectedTimeSec : null,
      source,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetColors.sheetBg,
              borderColor: sheetColors.border,
              paddingBottom:
                Platform.OS === 'android'
                  ? Math.max(insets.bottom, 48) + 16
                  : Math.max(insets.bottom, 24) + 12,
            },
          ]}
        >
          <View
            style={[styles.handle, { backgroundColor: sheetColors.handle }]}
          />

          <View style={styles.header}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.iconBtn, { backgroundColor: sheetColors.surface }]}
            >
              <Feather name="x" size={20} color={sheetColors.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: sheetColors.text }]}>
              Choose Reel Cover
            </Text>
            <TouchableOpacity onPress={handleConfirm} style={styles.doneBtn}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.previewBox,
              {
                backgroundColor: sheetColors.surface,
                borderColor: sheetColors.border,
              },
            ]}
          >
            {selectedUri ? (
              <Image
                source={{ uri: selectedUri }}
                style={styles.previewImg}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.placeholderPreview}>
                <Ionicons name="image-outline" size={32} color="#71717a" />
                <Text style={styles.placeholderText}>No cover selected</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionLabel}>PICK A FRAME FROM VIDEO</Text>

          {loadingFrames ? (
            <View style={styles.framesLoader}>
              <ActivityIndicator size="small" color="#38bdf8" />
              <Text style={styles.placeholderText}>Extracting frames...</Text>
            </View>
          ) : frames.length > 0 ? (
            <View style={styles.framesRow}>
              {frames.map((frame, idx) => {
                const isSelected =
                  source === 'frame' && selectedUri === frame.uri;
                return (
                  <TouchableOpacity
                    key={`${frame.timeSec}-${idx}`}
                    style={[
                      styles.frameItem,
                      isSelected && styles.frameItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedUri(frame.uri);
                      setSelectedTimeSec(frame.timeSec);
                      setSource('frame');
                    }}
                    activeOpacity={0.85}
                  >
                    <Image
                      source={{ uri: frame.uri }}
                      style={styles.frameImg}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.placeholderText}>
              Select a custom image from your gallery below.
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.uploadBtn,
              {
                backgroundColor: sheetColors.surface,
                borderColor: sheetColors.border,
              },
            ]}
            onPress={() => void handlePickCustomImage()}
            activeOpacity={0.85}
          >
            <Ionicons name="image-outline" size={18} color={sheetColors.text} />
            <Text style={[styles.uploadBtnText, { color: sheetColors.text }]}>
              Upload Custom Cover Photo
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#141416',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 14,
    borderTopWidth: 1,
    borderColor: '#27272a',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3f3f46',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  doneBtn: {
    backgroundColor: '#e1306c',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  doneText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  previewBox: {
    width: 126,
    height: 200,
    borderRadius: 14,
    overflow: 'hidden',
    alignSelf: 'center',
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  previewImg: {
    width: '100%',
    height: '100%',
  },
  placeholderPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  placeholderText: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  sectionLabel: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  framesLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  framesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  frameItem: {
    flex: 1,
    height: 68,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#27272a',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  frameItemSelected: {
    borderColor: '#e1306c',
  },
  frameImg: {
    width: '100%',
    height: '100%',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#27272a',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  uploadBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
});

export default ReelCoverPicker;