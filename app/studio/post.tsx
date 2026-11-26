import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  DeviceEventEmitter,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { backend } from '../../lib/backend';
import {
  MediaCategory,
  deleteStudioDraft,
  getStudioDrafts,
  parseTags,
  publishCreatorItem,
  saveStudioDraft,
} from '../../lib/creatorStudio';

let MediaLibraryMod: any = null;
try {
  MediaLibraryMod = require('expo-media-library');
} catch {
  MediaLibraryMod = null;
}

let ImageManipulatorMod: any = null;
try {
  ImageManipulatorMod = require('expo-image-manipulator');
} catch {
  ImageManipulatorMod = null;
}

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

type FlowStep = 'gallery' | 'edit' | 'share';
type EditorTool = 'none' | 'filter' | 'audio' | 'text' | 'overlay' | 'edit';
type AspectPreset = '1:1' | '4:5' | '16:9';
type FilterId = 'normal' | 'clarendon' | 'gingham' | 'moon' | 'lark' | 'warm';
type AudienceType = 'Public' | 'Followers' | 'Close Friends';
type SchedulePreset = 'now' | '1h' | 'tonight' | 'tomorrow';
type TextBgStyle = 'solid' | 'glass' | 'clean';

interface FilterPreset {
  id: FilterId;
  name: string;
  rgb: string;
  veil: string;
  maxAlpha: number;
}

interface SlideEditState {
  filterId: FilterId;
  filterStrength: number;
  brightness: number;
  contrast: number;
  warmth: number;
  vignette: number;
  rotation: number;
  flipped: boolean;
}

interface PhotoTagPin {
  id: string;
  username: string;
  xPct: number;
  yPct: number;
}

interface AudioTrack {
  id: string;
  artist: string;
  title: string;
  durationSec: number;
  cover: string;
}

const DEFAULT_SLIDE_EDIT: SlideEditState = {
  filterId: 'normal',
  filterStrength: 0.8,
  brightness: 0,
  contrast: 0,
  warmth: 0,
  vignette: 0,
  rotation: 0,
  flipped: false,
};

const IG_BLUE = '#4f5ff5';

const FILTER_PRESETS: FilterPreset[] = [
  { id: 'normal', name: 'Normal', rgb: '0,0,0', veil: 'transparent', maxAlpha: 0 },
  { id: 'clarendon', name: 'Clarendon', rgb: '56, 189, 248', veil: 'rgba(15, 23, 42, 0.14)', maxAlpha: 0.24 },
  { id: 'gingham', name: 'Gingham', rgb: '254, 243, 199', veil: 'rgba(255, 255, 255, 0.12)', maxAlpha: 0.30 },
  { id: 'moon', name: 'Moon', rgb: '24, 24, 27', veil: 'rgba(0, 0, 0, 0.25)', maxAlpha: 0.52 },
  { id: 'lark', name: 'Lark', rgb: '253, 224, 71', veil: 'rgba(255, 255, 255, 0.10)', maxAlpha: 0.22 },
  { id: 'warm', name: 'Warm', rgb: '249, 115, 22', veil: 'rgba(124, 45, 18, 0.14)', maxAlpha: 0.25 },
];

const TEXT_COLORS = ['#ffffff', '#09090b', '#facc15', '#f43f5e', '#38bdf8', '#10b981'];

const SUGGESTED_AUDIOS: AudioTrack[] = [
  {
    id: 'aud-1',
    artist: 'Rahat Fateh Ali Khan, Suzanne Demello',
    title: 'Rishte Naate',
    durationSec: 180,
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=120&q=80',
  },
  {
    id: 'aud-2',
    artist: 'Arijit Singh',
    title: 'It’s a Nice Day',
    durationSec: 210,
    cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=120&q=80',
  },
  {
    id: 'aud-3',
    artist: 'Lo-Fi Studio',
    title: 'Golden Hour Chill',
    durationSec: 150,
    cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=120&q=80',
  },
];

const ASPECT_VAL: Record<AspectPreset, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
};

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

function TouchSlider({
  label,
  value,
  min = 0,
  max = 1,
  onChange,
  valueText,
  textColor,
  subtextColor,
  trackColor,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (val: number) => void;
  valueText?: string;
  textColor: string;
  subtextColor: string;
  trackColor: string;
}) {
  const [width, setWidth] = useState(240);
  const ratio = Math.min(1, Math.max(0, (value - min) / Math.max(0.001, max - min)));

  const handleTouch = (x: number) => {
    const r = Math.min(1, Math.max(0, x / Math.max(1, width)));
    onChange(Number((min + r * (max - min)).toFixed(2)));
  };

  return (
    <View style={styles.sliderBlock}>
      <View style={styles.sliderLabelRow}>
        <Text style={[styles.sliderLabel, { color: subtextColor }]}>{label}</Text>
        <Text style={[styles.sliderValText, { color: textColor }]}>
          {valueText ?? `${Math.round(ratio * 100)}%`}
        </Text>
      </View>
      <View
        style={styles.sliderHit}
        onLayout={(e: LayoutChangeEvent) => {
          if (e.nativeEvent.layout.width > 0) setWidth(e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => handleTouch(e.nativeEvent.locationX)}
        onResponderMove={(e) => handleTouch(e.nativeEvent.locationX)}
      >
        <View style={[styles.sliderTrack, { backgroundColor: trackColor }]}>
          <View style={[styles.sliderFill, { width: `${Math.round(ratio * 100)}%` }]} />
        </View>
        <View
          style={[
            styles.sliderKnob,
            { left: `${Math.round(ratio * 100)}%`, backgroundColor: textColor },
          ]}
        />
      </View>
    </View>
  );
}

export default function NewPhotoPostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const colors = useMemo(
    () => ({
      bg: isDark ? '#09090b' : '#f4f4f5',
      surface: isDark ? '#18181b' : '#f1f5f9',
      inputBg: isDark ? '#09090b' : '#f8fafc',
      surfaceAlt: isDark ? '#27272a' : '#e4e4e7',
      card: isDark ? '#18181b' : '#ffffff',
      border: isDark ? '#27272a' : '#e2e8f0',
      text: isDark ? '#fafafa' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#64748b',
      gridGap: isDark ? '#09090b' : '#ffffff',
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

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(THEME_STORAGE_KEY)
        .then((saved) => {
          if (saved === 'light' || saved === 'dark' || saved === 'system') {
            setThemeMode(saved);
          }
        })
        .catch(() => { });
    }, [])
  );

  const [step, setStep] = useState<FlowStep>('gallery');

  const [recentPhotos, setRecentPhotos] = useState<string[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [multiSelect, setMultiSelect] = useState(false);
  const [aspect, setAspect] = useState<AspectPreset>('1:1');

  const [slideEdits, setSlideEdits] = useState<Record<string, SlideEditState>>({});
  const [activeTool, setActiveTool] = useState<EditorTool>('none');
  const [comparingOriginal, setComparingOriginal] = useState(false);

  const [overlayText, setOverlayText] = useState('');
  const [overlayTextColor, setOverlayTextColor] = useState('#ffffff');
  const [overlayBgStyle, setOverlayBgStyle] = useState<TextBgStyle>('glass');
  const textPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const textPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        textPan.extractOffset();
      },
      onPanResponderMove: Animated.event(
        [null, { dx: textPan.x, dy: textPan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        textPan.flattenOffset();
      },
    })
  ).current;

  const [stickerUri, setStickerUri] = useState<string | null>(null);
  const stickerPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const stickerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        stickerPan.extractOffset();
      },
      onPanResponderMove: Animated.event(
        [null, { dx: stickerPan.x, dy: stickerPan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        stickerPan.flattenOffset();
      },
    })
  ).current;

  const [selectedAudio, setSelectedAudio] = useState<AudioTrack | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioClipStart, setAudioClipStart] = useState(15);
  const [audioPlayPos, setAudioPlayPos] = useState(0);

  const [caption, setCaption] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOpt1, setPollOpt1] = useState('');
  const [pollOpt2, setPollOpt2] = useState('');
  const [promptText, setPromptText] = useState('');
  const [taggedPeople, setTaggedPeople] = useState('');
  const [photoTags, setPhotoTags] = useState<PhotoTagPin[]>([]);
  const [pendingPinCoords, setPendingPinCoords] = useState<{
    xPct: number;
    yPct: number;
  } | null>(null);
  const [pinUsernameInput, setPinUsernameInput] = useState('');
  const [productTag, setProductTag] = useState('');
  const [locationText, setLocationText] = useState('');
  const [audience, setAudience] = useState<AudienceType>('Public');
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('now');
  const [allowComments, setAllowComments] = useState(true);
  const [hideLikes, setHideLikes] = useState(false);
  const [photoUrlInput, setPhotoUrlInput] = useState('');

  const [activeModal, setActiveModal] = useState<
    | 'poll'
    | 'prompt'
    | 'audio'
    | 'tag'
    | 'pinTag'
    | 'products'
    | 'location'
    | 'audience'
    | 'schedule'
    | 'advanced'
    | 'photoUrl'
    | null
  >(null);
  const [publishing, setPublishing] = useState(false);

  const loadRecentGallery = useCallback(async () => {
    setGalleryLoading(true);
    if (!MediaLibraryMod) {
      setGalleryLoading(false);
      return;
    }
    try {
      const existing = await MediaLibraryMod.getPermissionsAsync();
      let granted = Boolean(existing?.granted);
      if (!granted) {
        const req = await MediaLibraryMod.requestPermissionsAsync();
        granted = Boolean(req?.granted);
      }
      if (!granted) {
        setGalleryLoading(false);
        return;
      }

      const mediaPhotoType = MediaLibraryMod.MediaType?.photo ?? 'photo';
      const creationSort = MediaLibraryMod.SortBy?.creationTime ?? 'creationTime';

      const assets = await MediaLibraryMod.getAssetsAsync({
        first: 48,
        mediaType: [mediaPhotoType],
        sortBy: [[creationSort, false]],
      });

      const uris: string[] = (assets?.assets || [])
        .map((a: any) => a?.localUri || a?.uri)
        .filter((u: any) => typeof u === 'string' && u.length > 0);

      setRecentPhotos(uris);
      if (uris.length > 0) {
        setSelectedPhotos((prev) => (prev.length > 0 ? prev : [uris[0]]));
      }
    } catch {
      // Fallback to manual ImagePicker
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRecentGallery();
    }, [loadRecentGallery])
  );

  useEffect(() => {
    if (!audioPlaying || !selectedAudio) {
      setAudioPlayPos(0);
      return;
    }
    const timer = setInterval(() => {
      setAudioPlayPos((p) => (p >= 30 ? 0 : p + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [audioPlaying, selectedAudio]);

  useEffect(() => {
    if (!draftId) return;
    getStudioDrafts().then((items) => {
      const found = items.find((d) => d.id === draftId) as any;
      if (!found) return;
      setCaption(found.title || found.description || '');
      if (found.locationText) setLocationText(found.locationText);
      if (found.taggedPeople) setTaggedPeople(found.taggedPeople);
      if (found.productTag) setProductTag(found.productTag);
      if (found.promptText) setPromptText(found.promptText);
      if (found.poll?.question) {
        setPollQuestion(found.poll.question);
        setPollOpt1(found.poll.options?.[0] || '');
        setPollOpt2(found.poll.options?.[1] || '');
      }
      if (found.slideEdits) setSlideEdits(found.slideEdits);
      if (Array.isArray(found.photos) && found.photos.length > 0) {
        setSelectedPhotos(found.photos);
        setStep('share');
      } else if (found.coverUri) {
        setSelectedPhotos([found.coverUri]);
        setStep('share');
      }
    });
  }, [draftId]);

  const activePhotoUri = selectedPhotos[activePhotoIdx] || selectedPhotos[0] || '';
  const currentEdit: SlideEditState = useMemo(
    () => slideEdits[activePhotoUri] || DEFAULT_SLIDE_EDIT,
    [slideEdits, activePhotoUri]
  );

  const patchCurrentEdit = useCallback(
    (patch: Partial<SlideEditState>) => {
      if (!activePhotoUri) return;
      setSlideEdits((prev) => ({
        ...prev,
        [activePhotoUri]: {
          ...(prev[activePhotoUri] || DEFAULT_SLIDE_EDIT),
          ...patch,
        },
      }));
    },
    [activePhotoUri]
  );

  const activeFilter = useMemo(
    () =>
      FILTER_PRESETS.find((f) => f.id === currentEdit.filterId) ||
      FILTER_PRESETS[0],
    [currentEdit.filterId]
  );

  const filterColor = useMemo(() => {
    if (
      comparingOriginal ||
      activeFilter.id === 'normal' ||
      currentEdit.filterStrength <= 0
    ) {
      return 'transparent';
    }
    return `rgba(${activeFilter.rgb}, ${(
      activeFilter.maxAlpha * currentEdit.filterStrength
    ).toFixed(2)})`;
  }, [comparingOriginal, activeFilter, currentEdit.filterStrength]);

  const openSystemGallery = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Allow photo library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.85,
    });
    if (!res.canceled && res.assets?.length) {
      const uris = res.assets.map((a) => a.uri).filter(Boolean);
      setSelectedPhotos((prev) => {
        const merged = Array.from(new Set([...prev, ...uris])).slice(0, 10);
        setActivePhotoIdx(merged.length - 1);
        return merged;
      });
    }
  }, []);

  const pickOverlaySticker = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Allow photo library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setStickerUri(res.assets[0].uri);
      setActiveTool('overlay');
    }
  }, []);

  const openCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Allow camera access.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      const uri = res.assets[0].uri;
      setSelectedPhotos((prev) => [uri, ...prev].slice(0, 10));
      setActivePhotoIdx(0);
    }
  }, []);

  const handleToggleGalleryPhoto = (uri: string) => {
    if (multiSelect) {
      setSelectedPhotos((prev) => {
        if (prev.includes(uri)) {
          const next = prev.filter((u) => u !== uri);
          setActivePhotoIdx(0);
          return next;
        }
        const next = [...prev, uri].slice(0, 10);
        setActivePhotoIdx(next.length - 1);
        return next;
      });
    } else {
      setSelectedPhotos([uri]);
      setActivePhotoIdx(0);
    }
  };

  const cycleAspect = () => {
    setAspect((prev) =>
      prev === '1:1' ? '4:5' : prev === '4:5' ? '16:9' : '1:1'
    );
  };

  const handleRotateActivePhoto = async () => {
    if (!activePhotoUri) return;
    if (ImageManipulatorMod?.manipulateAsync) {
      try {
        const result = await ImageManipulatorMod.manipulateAsync(
          activePhotoUri,
          [{ rotate: 90 }],
          {
            compress: 0.9,
            format: ImageManipulatorMod.SaveFormat?.JPEG ?? 'jpeg',
          }
        );
        if (result?.uri) {
          setSelectedPhotos((prev) =>
            prev.map((u, idx) => (idx === activePhotoIdx ? result.uri : u))
          );
          setSlideEdits((prev) => {
            const existing = prev[activePhotoUri] || DEFAULT_SLIDE_EDIT;
            return { ...prev, [result.uri]: existing };
          });
          return;
        }
      } catch { }
    }
    patchCurrentEdit({ rotation: (currentEdit.rotation + 90) % 360 });
  };

  const handleFlipActivePhoto = async () => {
    if (!activePhotoUri) return;
    if (
      ImageManipulatorMod?.manipulateAsync &&
      ImageManipulatorMod.FlipType?.Horizontal
    ) {
      try {
        const result = await ImageManipulatorMod.manipulateAsync(
          activePhotoUri,
          [{ flip: ImageManipulatorMod.FlipType.Horizontal }],
          {
            compress: 0.9,
            format: ImageManipulatorMod.SaveFormat?.JPEG ?? 'jpeg',
          }
        );
        if (result?.uri) {
          setSelectedPhotos((prev) =>
            prev.map((u, idx) => (idx === activePhotoIdx ? result.uri : u))
          );
          setSlideEdits((prev) => {
            const existing = prev[activePhotoUri] || DEFAULT_SLIDE_EDIT;
            return { ...prev, [result.uri]: existing };
          });
          return;
        }
      } catch { }
    }
    patchCurrentEdit({ flipped: !currentEdit.flipped });
  };

  const handleRemoveSlide = (idx: number) => {
    setSelectedPhotos((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) setStep('gallery');
      setActivePhotoIdx(Math.max(0, Math.min(activePhotoIdx, next.length - 1)));
      return next;
    });
  };

  const buildCompletePayload = () => ({
    caption: caption.trim(),
    aspect,
    photos: selectedPhotos,
    slideEdits,
    overlayText: overlayText.trim() || null,
    stickerUri,
    audio: selectedAudio
      ? {
        id: selectedAudio.id,
        title: selectedAudio.title,
        artist: selectedAudio.artist,
        clipStartSec: audioClipStart,
      }
      : null,
    poll: pollQuestion.trim()
      ? {
        question: pollQuestion.trim(),
        options: [pollOpt1.trim() || 'Yes', pollOpt2.trim() || 'No'],
      }
      : null,
    promptText: promptText.trim() || null,
    taggedPeople: taggedPeople.trim() || null,
    photoTags,
    productTag: productTag.trim() || null,
    locationText: locationText.trim() || null,
    audience,
    schedulePreset,
    allowComments,
    hideLikes,
  });

  const handleSaveDraft = useCallback(async () => {
    try {
      const meta = buildCompletePayload();
      await saveStudioDraft({
        id: draftId || `post-draft-${Date.now()}`,
        mode: 'post',
        title: meta.caption || 'Photo Draft',
        category: 'General' as MediaCategory,
        description: meta.caption,
        tagsText: parseTags(meta.caption).join(', '),
        thumbnailMode: 'custom',
        musicTrackId: selectedAudio?.id || null,
        customAudioUri: '',
        mediaUri: '',
        coverUri: selectedPhotos[0] || '',
        savedAt: 'Just now',
        ...meta,
      } as any);
      DeviceEventEmitter.emit('studio-drafts-updated');
      Alert.alert('Saved', 'Post saved to Drafts.');
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save draft.');
    }
  }, [
    draftId,
    selectedAudio,
    selectedPhotos,
    caption,
    router,
    slideEdits,
    pollQuestion,
    pollOpt1,
    pollOpt2,
    promptText,
    taggedPeople,
    photoTags,
    productTag,
    locationText,
    audience,
    schedulePreset,
    allowComments,
    hideLikes,
    aspect,
    overlayText,
    stickerUri,
    audioClipStart,
  ]);

  const handleExitAttempt = () => {
    const hasWork =
      selectedPhotos.length > 0 &&
      (caption.trim().length > 0 ||
        overlayText.trim().length > 0 ||
        selectedAudio !== null ||
        step !== 'gallery');

    if (!hasWork) {
      router.back();
      return;
    }

    Alert.alert(
      'Save draft before leaving?',
      'Your edits will be kept in Drafts.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        { text: 'Save Draft', onPress: () => void handleSaveDraft() },
      ]
    );
  };

  const handleShare = useCallback(async () => {
    if (selectedPhotos.length === 0) {
      Alert.alert('No Photo', 'Please select at least one photo.');
      return;
    }
    if (publishing) return;

    try {
      setPublishing(true);
      setAudioPlaying(false);
      const user = await backend.auth.getCurrentUser().catch(() => null);

      const meta = buildCompletePayload();
      await publishCreatorItem({
        id: `post-${Date.now()}`,
        mode: 'post',
        title: meta.caption || 'Photo Post',
        description: meta.caption,
        category: 'General' as MediaCategory,
        tags: parseTags(meta.caption),
        thumbnailMode: 'custom',
        mediaUri: '',
        coverUri: selectedPhotos[0] || '',
        visibility: audience.toLowerCase(),
        monetize: false,
        creatorId: user?.id,
        ...meta,
      } as any);

      if (draftId) {
        void deleteStudioDraft(draftId);
      }

      DeviceEventEmitter.emit('watch-media-created', {
        media_type: 'post',
        title: meta.caption || 'Photo Post',
        thumbnail_url: selectedPhotos[0] || null,
      });

      Alert.alert(
        schedulePreset === 'now' ? 'Shared' : 'Scheduled',
        schedulePreset === 'now'
          ? 'Your post is live.'
          : 'Your post has been scheduled.',
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch (err: any) {
      Alert.alert('Share Failed', err?.message || 'Unable to share post.');
    } finally {
      setPublishing(false);
    }
  }, [
    selectedPhotos,
    publishing,
    caption,
    audience,
    allowComments,
    schedulePreset,
    router,
    slideEdits,
    pollQuestion,
    pollOpt1,
    pollOpt2,
    promptText,
    taggedPeople,
    photoTags,
    productTag,
    locationText,
    hideLikes,
    aspect,
    overlayText,
    stickerUri,
    selectedAudio,
    audioClipStart,
  ]);

  const scheduleLabel =
    schedulePreset === 'now'
      ? 'Publish now'
      : schedulePreset === '1h'
        ? 'In 1 hour'
        : schedulePreset === 'tonight'
          ? 'Tonight · 8:00 PM'
          : 'Tomorrow · 10:00 AM';

  if (step === 'gallery') {
    const showRecentGrid = recentPhotos.length > 0;
    const hidePickerAfterSelection = !showRecentGrid && selectedPhotos.length > 0;
    const gridData = showRecentGrid
      ? ['__CAMERA__', ...recentPhotos]
      : ['__CAMERA__', '__PICK_GALLERY__'];

    return (
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.bg }]}
        edges={['top', 'bottom']}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        <View
          style={[
            styles.topHeader,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          <View style={styles.topHeaderLeft}>
            <TouchableOpacity onPress={handleExitAttempt} style={styles.iconHit}>
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.topHeaderTitle, { color: colors.text }]}>
              New post
            </Text>
          </View>

          <TouchableOpacity
            style={styles.nextHeaderBtn}
            onPress={() => {
              if (selectedPhotos.length === 0) {
                void openSystemGallery();
                return;
              }
              setStep('edit');
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.nextHeaderText}>Next</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.galleryStageOuter,
            { backgroundColor: colors.bg },
            hidePickerAfterSelection && { flex: 1, maxHeight: undefined },
          ]}
        >
          <View
            style={[
              styles.galleryPreviewBox,
              {
                aspectRatio: ASPECT_VAL[aspect],
                backgroundColor: colors.surface,
              },
            ]}
          >
            {activePhotoUri ? (
              <>
                <Image
                  source={{ uri: activePhotoUri }}
                  style={styles.fullImg}
                  resizeMode="contain"
                />
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View style={[styles.gridLineV, { left: '33.33%' }]} />
                  <View style={[styles.gridLineV, { left: '66.66%' }]} />
                  <View style={[styles.gridLineH, { top: '33.33%' }]} />
                  <View style={[styles.gridLineH, { top: '66.66%' }]} />
                </View>

                <TouchableOpacity
                  style={styles.aspectRoundBtn}
                  onPress={cycleAspect}
                >
                  <Ionicons name="expand-outline" size={14} color="#ffffff" />
                  <Text style={styles.aspectBtnText}>{aspect}</Text>
                </TouchableOpacity>

                {selectedPhotos.length > 1 && (
                  <>
                    <View style={styles.slideCounterPill}>
                      <Text style={styles.slideCounterText}>
                        {activePhotoIdx + 1} / {selectedPhotos.length}
                      </Text>
                    </View>
                    {activePhotoIdx > 0 && (
                      <TouchableOpacity
                        style={[styles.previewNavArrow, { left: 10 }]}
                        onPress={() => setActivePhotoIdx((i) => Math.max(0, i - 1))}
                      >
                        <Ionicons name="chevron-back" size={18} color="#ffffff" />
                      </TouchableOpacity>
                    )}
                    {activePhotoIdx < selectedPhotos.length - 1 && (
                      <TouchableOpacity
                        style={[styles.previewNavArrow, { right: 10 }]}
                        onPress={() =>
                          setActivePhotoIdx((i) =>
                            Math.min(selectedPhotos.length - 1, i + 1)
                          )
                        }
                      >
                        <Ionicons name="chevron-forward" size={18} color="#ffffff" />
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {hidePickerAfterSelection && (
                  <TouchableOpacity
                    style={styles.removeTopPhotoBtn}
                    onPress={() => handleRemoveSlide(activePhotoIdx)}
                  >
                    <Ionicons name="trash-outline" size={16} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={styles.emptyPreviewBtn}
                onPress={openSystemGallery}
              >
                <Ionicons name="images-outline" size={34} color={colors.subtext} />
                <Text style={[styles.emptyPreviewText, { color: colors.subtext }]}>
                  Tap to pick photos from your device
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {hidePickerAfterSelection ? (
          <View
            style={[
              styles.selectedActionFooter,
              { backgroundColor: colors.bg, borderTopColor: colors.border },
            ]}
          >
            <TouchableOpacity
              style={[styles.secondaryActionBtn, { backgroundColor: colors.surface }]}
              onPress={openSystemGallery}
            >
              <Ionicons name="add" size={18} color={colors.text} />
              <Text style={[styles.secondaryActionText, { color: colors.text }]}>
                Add More
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryActionBtn, { backgroundColor: colors.surface }]}
              onPress={() => {
                setPhotoUrlInput('');
                setActiveModal('photoUrl');
              }}
            >
              <Ionicons name="link-outline" size={18} color={colors.text} />
              <Text style={[styles.secondaryActionText, { color: colors.text }]}>
                URL
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryNextBtn}
              onPress={() => setStep('edit')}
            >
              <Text style={styles.nextBluePillText}>Next</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View
              style={[
                styles.recentsBar,
                { backgroundColor: colors.bg, borderTopColor: colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.recentsBtn}
                onPress={openSystemGallery}
                activeOpacity={0.75}
              >
                <Text style={[styles.recentsText, { color: colors.text }]}>
                  Recents
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.text} />
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.selectPill, { backgroundColor: colors.surface }]}
                  onPress={() => {
                    setPhotoUrlInput('');
                    setActiveModal('photoUrl');
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="link-outline" size={15} color={colors.text} />
                  <Text style={[styles.selectPillText, { color: colors.text }]}>
                    URL
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.selectPill,
                    { backgroundColor: multiSelect ? IG_BLUE : colors.surface },
                  ]}
                  onPress={() => setMultiSelect((m) => !m)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="copy-outline"
                    size={15}
                    color={multiSelect ? '#ffffff' : colors.text}
                  />
                  <Text
                    style={[
                      styles.selectPillText,
                      { color: multiSelect ? '#ffffff' : colors.text },
                    ]}
                  >
                    {multiSelect ? `Selected (${selectedPhotos.length})` : 'Select'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {galleryLoading ? (
              <View style={styles.galleryLoader}>
                <ActivityIndicator color={colors.text} />
                <Text style={[styles.emptyPreviewText, { color: colors.subtext }]}>
                  Loading recent photos...
                </Text>
              </View>
            ) : (
              <FlatList
                data={gridData}
                numColumns={4}
                keyExtractor={(item, idx) => `${item}-${idx}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingBottom: 14,
                  backgroundColor: colors.bg,
                }}
                renderItem={({ item }) => {
                  if (item === '__CAMERA__') {
                    return (
                      <TouchableOpacity
                        style={[
                          styles.gridCameraTile,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.gridGap,
                          },
                        ]}
                        onPress={openCamera}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="camera" size={28} color={colors.text} />
                      </TouchableOpacity>
                    );
                  }
                  if (item === '__PICK_GALLERY__') {
                    return (
                      <TouchableOpacity
                        style={[
                          styles.gridCameraTile,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.gridGap,
                          },
                        ]}
                        onPress={openSystemGallery}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="images-outline"
                          size={24}
                          color={colors.subtext}
                        />
                        <Text
                          style={{
                            color: colors.subtext,
                            fontSize: 10.5,
                            marginTop: 4,
                          }}
                        >
                          Gallery
                        </Text>
                      </TouchableOpacity>
                    );
                  }

                  const selIdx = selectedPhotos.indexOf(item);
                  const isSelected = selIdx >= 0;
                  const isActive = item === activePhotoUri;

                  return (
                    <TouchableOpacity
                      style={[
                        styles.gridPhotoTile,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.gridGap,
                        },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => handleToggleGalleryPhoto(item)}
                    >
                      <Image
                        source={{ uri: item }}
                        style={styles.fullImg}
                        resizeMode="cover"
                      />
                      {isActive && (
                        <View pointerEvents="none" style={styles.activeTileVeil} />
                      )}
                      {multiSelect && (
                        <View
                          style={[
                            styles.gridSelectBadge,
                            isSelected && {
                              backgroundColor: IG_BLUE,
                              borderColor: IG_BLUE,
                            },
                          ]}
                        >
                          {isSelected && (
                            <Text style={styles.gridSelectNum}>{selIdx + 1}</Text>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </>
        )}
      </SafeAreaView>
    );
  }

  if (step === 'edit') {
    const suggested = selectedAudio || SUGGESTED_AUDIOS[1];

    return (
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.bg }]}
        edges={['top', 'bottom']}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        <View style={styles.editTopBar}>
          <TouchableOpacity
            onPress={() => {
              setAudioPlaying(false);
              setStep('gallery');
            }}
            style={styles.iconHit}
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.suggestedAudioPill,
              { backgroundColor: colors.surface },
            ]}
            onPress={() =>
              setActiveTool((t) => (t === 'audio' ? 'none' : 'audio'))
            }
          >
            <Image
              source={{ uri: suggested.cover }}
              style={styles.audioPillThumb}
            />
            <Text
              style={[styles.audioPillText, { color: colors.text }]}
              numberOfLines={1}
            >
              {suggested.title}
            </Text>
            <Ionicons
              name={selectedAudio ? 'checkmark' : 'add'}
              size={18}
              color={colors.text}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.compareBtn, { backgroundColor: colors.surface }]}
            onPressIn={() => setComparingOriginal(true)}
            onPressOut={() => setComparingOriginal(false)}
          >
            <Ionicons
              name={comparingOriginal ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={colors.text}
            />
          </TouchableOpacity>
        </View>

        <View style={[styles.editCanvasWrap, { backgroundColor: colors.bg }]}>
          <View style={[styles.editCanvasBox, { backgroundColor: colors.bg }]}>
            {activePhotoUri ? (
              <Image
                source={{ uri: activePhotoUri }}
                style={[
                  styles.fullImg,
                  !comparingOriginal && {
                    transform: [
                      { rotate: `${currentEdit.rotation}deg` },
                      { scaleX: currentEdit.flipped ? -1 : 1 },
                    ],
                  },
                ]}
                resizeMode="contain"
              />
            ) : null}

            {!comparingOriginal && activeFilter.id !== 'normal' && (
              <>
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: filterColor },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: activeFilter.veil,
                      opacity: currentEdit.filterStrength,
                    },
                  ]}
                />
              </>
            )}

            {!comparingOriginal && currentEdit.brightness !== 0 && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor:
                      currentEdit.brightness > 0
                        ? `rgba(255,255,255,${(currentEdit.brightness * 0.6).toFixed(2)})`
                        : `rgba(0,0,0,${(Math.abs(currentEdit.brightness) * 0.7).toFixed(2)})`,
                  },
                ]}
              />
            )}
            {!comparingOriginal && currentEdit.contrast > 0 && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: `rgba(9,9,11,${(currentEdit.contrast * 0.28).toFixed(2)})`,
                  },
                ]}
              />
            )}
            {!comparingOriginal && currentEdit.warmth > 0 && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: `rgba(245,158,11,${(currentEdit.warmth * 0.45).toFixed(2)})`,
                  },
                ]}
              />
            )}
            {!comparingOriginal && currentEdit.vignette > 0 && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    borderWidth: 28,
                    borderColor: `rgba(0,0,0,${(currentEdit.vignette * 0.65).toFixed(2)})`,
                  },
                ]}
              />
            )}

            {selectedPhotos.length > 1 && (
              <>
                <View style={styles.slideCounterPill}>
                  <Text style={styles.slideCounterText}>
                    {activePhotoIdx + 1} / {selectedPhotos.length}
                  </Text>
                </View>
                {activePhotoIdx > 0 && (
                  <TouchableOpacity
                    style={[styles.previewNavArrow, { left: 10 }]}
                    onPress={() => setActivePhotoIdx((i) => Math.max(0, i - 1))}
                  >
                    <Ionicons name="chevron-back" size={18} color="#ffffff" />
                  </TouchableOpacity>
                )}
                {activePhotoIdx < selectedPhotos.length - 1 && (
                  <TouchableOpacity
                    style={[styles.previewNavArrow, { right: 10 }]}
                    onPress={() =>
                      setActivePhotoIdx((i) =>
                        Math.min(selectedPhotos.length - 1, i + 1)
                      )
                    }
                  >
                    <Ionicons name="chevron-forward" size={18} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </>
            )}

            {stickerUri && (
              <Animated.View
                {...stickerPanResponder.panHandlers}
                style={[
                  styles.draggableSticker,
                  { transform: stickerPan.getTranslateTransform() },
                ]}
              >
                <Image
                  source={{ uri: stickerUri }}
                  style={styles.stickerImg}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  style={styles.stickerClose}
                  onPress={() => setStickerUri(null)}
                >
                  <Ionicons name="close" size={12} color="#ffffff" />
                </TouchableOpacity>
              </Animated.View>
            )}

            {overlayText.trim().length > 0 && (
              <Animated.View
                {...textPanResponder.panHandlers}
                style={[
                  styles.draggableTextWrap,
                  overlayBgStyle === 'solid' && { backgroundColor: '#09090b' },
                  overlayBgStyle === 'glass' && {
                    backgroundColor: 'rgba(9,9,11,0.62)',
                  },
                  overlayBgStyle === 'clean' && {
                    backgroundColor: 'transparent',
                  },
                  { transform: textPan.getTranslateTransform() },
                ]}
              >
                <Text
                  style={[styles.textOverlayValue, { color: overlayTextColor }]}
                >
                  {overlayText}
                </Text>
              </Animated.View>
            )}

            {comparingOriginal && (
              <View style={styles.originalBadge}>
                <Text style={styles.originalBadgeText}>ORIGINAL</Text>
              </View>
            )}
          </View>
        </View>

        {activeTool === 'filter' && (
          <View style={styles.toolTray}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingHorizontal: 14 }}
            >
              {FILTER_PRESETS.map((f) => {
                const active = currentEdit.filterId === f.id;
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={{ alignItems: 'center', gap: 4 }}
                    onPress={() => patchCurrentEdit({ filterId: f.id })}
                  >
                    <View
                      style={[
                        styles.filterMiniBox,
                        active && { borderColor: IG_BLUE, borderWidth: 2 },
                      ]}
                    >
                      <Image
                        source={{ uri: activePhotoUri }}
                        style={styles.fullImg}
                      />
                      {f.id !== 'normal' && (
                        <View
                          style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: `rgba(${f.rgb}, ${f.maxAlpha})` },
                          ]}
                        />
                      )}
                    </View>
                    <Text
                      style={{
                        color: active ? colors.text : colors.subtext,
                        fontSize: 10.5,
                        fontWeight: active ? '700' : '500',
                      }}
                    >
                      {f.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {currentEdit.filterId !== 'normal' && (
              <TouchSlider
                label="Filter Intensity"
                value={currentEdit.filterStrength}
                onChange={(v) => patchCurrentEdit({ filterStrength: v })}
                textColor={colors.text}
                subtextColor={colors.subtext}
                trackColor={colors.surfaceAlt}
              />
            )}
          </View>
        )}

        {activeTool === 'edit' && (
          <ScrollView
            style={{ maxHeight: 165 }}
            contentContainerStyle={{ paddingBottom: 6, gap: 6 }}
          >
            <View style={styles.transformRow}>
              <TouchableOpacity
                style={[styles.transformBtn, { backgroundColor: colors.surface }]}
                onPress={() => void handleRotateActivePhoto()}
              >
                <Ionicons name="refresh-outline" size={16} color={colors.text} />
                <Text style={[styles.transformText, { color: colors.text }]}>
                  Rotate 90°
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.transformBtn, { backgroundColor: colors.surface }]}
                onPress={() => void handleFlipActivePhoto()}
              >
                <Ionicons
                  name="swap-horizontal-outline"
                  size={16}
                  color={colors.text}
                />
                <Text style={[styles.transformText, { color: colors.text }]}>
                  Flip
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.transformBtn, { backgroundColor: colors.surface }]}
                onPress={() =>
                  setSlideEdits((prev) => ({
                    ...prev,
                    [activePhotoUri]: DEFAULT_SLIDE_EDIT,
                  }))
                }
              >
                <Ionicons
                  name="arrow-undo-outline"
                  size={16}
                  color={colors.subtext}
                />
                <Text style={[styles.transformText, { color: colors.subtext }]}>
                  Reset
                </Text>
              </TouchableOpacity>
            </View>

            <TouchSlider
              label="Brightness"
              value={currentEdit.brightness}
              min={-0.5}
              max={0.5}
              valueText={`${Math.round(currentEdit.brightness * 100)}`}
              onChange={(v) => patchCurrentEdit({ brightness: v })}
              textColor={colors.text}
              subtextColor={colors.subtext}
              trackColor={colors.surfaceAlt}
            />
            <TouchSlider
              label="Contrast"
              value={currentEdit.contrast}
              min={0}
              max={0.5}
              onChange={(v) => patchCurrentEdit({ contrast: v })}
              textColor={colors.text}
              subtextColor={colors.subtext}
              trackColor={colors.surfaceAlt}
            />
            <TouchSlider
              label="Warmth"
              value={currentEdit.warmth}
              min={0}
              max={0.5}
              onChange={(v) => patchCurrentEdit({ warmth: v })}
              textColor={colors.text}
              subtextColor={colors.subtext}
              trackColor={colors.surfaceAlt}
            />
            <TouchSlider
              label="Vignette"
              value={currentEdit.vignette}
              min={0}
              max={0.6}
              onChange={(v) => patchCurrentEdit({ vignette: v })}
              textColor={colors.text}
              subtextColor={colors.subtext}
              trackColor={colors.surfaceAlt}
            />
          </ScrollView>
        )}

        {activeTool === 'text' && (
          <View style={styles.toolTray}>
            <TextInput
              style={[
                styles.toolTextInput,
                { backgroundColor: colors.surface, color: colors.text },
              ]}
              value={overlayText}
              onChangeText={setOverlayText}
              placeholder="Type text (drag on photo to move)..."
              placeholderTextColor={colors.subtext}
            />
            <View style={styles.textStyleControls}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {TEXT_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.colorDot,
                      {
                        backgroundColor: c,
                        borderColor: colors.border,
                        borderWidth: 1,
                      },
                      overlayTextColor === c && {
                        borderColor: IG_BLUE,
                        borderWidth: 2.5,
                      },
                    ]}
                    onPress={() => setOverlayTextColor(c)}
                  />
                ))}
              </View>
              <TouchableOpacity
                style={[styles.bgStylePill, { backgroundColor: colors.surface }]}
                onPress={() =>
                  setOverlayBgStyle((s) =>
                    s === 'glass' ? 'solid' : s === 'solid' ? 'clean' : 'glass'
                  )
                }
              >
                <Text
                  style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}
                >
                  Style: {overlayBgStyle}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTool === 'audio' && (
          <View style={styles.toolTray}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}
            >
              {SUGGESTED_AUDIOS.map((aud) => {
                const active = selectedAudio?.id === aud.id;
                return (
                  <TouchableOpacity
                    key={aud.id}
                    style={[
                      styles.audioPickChip,
                      {
                        backgroundColor: colors.surface,
                        borderColor: active ? IG_BLUE : colors.border,
                      },
                    ]}
                    onPress={() => {
                      if (active) {
                        setSelectedAudio(null);
                        setAudioPlaying(false);
                      } else {
                        setSelectedAudio(aud);
                        setAudioPlaying(true);
                      }
                    }}
                  >
                    <Image
                      source={{ uri: aud.cover }}
                      style={styles.audioPillThumb}
                    />
                    <Text
                      style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}
                    >
                      {aud.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {selectedAudio && (
              <View style={styles.audioTrimmerBox}>
                <TouchableOpacity
                  style={styles.playAudioBtn}
                  onPress={() => setAudioPlaying((p) => !p)}
                >
                  <Ionicons
                    name={audioPlaying ? 'pause' : 'play'}
                    size={16}
                    color="#ffffff"
                  />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <TouchSlider
                    label={`Clip: ${formatSec(audioClipStart)} – ${formatSec(audioClipStart + 30)}`}
                    value={audioClipStart}
                    min={0}
                    max={Math.max(30, selectedAudio.durationSec - 30)}
                    valueText={
                      audioPlaying ? `Playing ${formatSec(audioPlayPos)}` : '30s clip'
                    }
                    onChange={(v) => setAudioClipStart(Math.round(v))}
                    textColor={colors.text}
                    subtextColor={colors.subtext}
                    trackColor={colors.surfaceAlt}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        <View style={styles.editorToolsRow}>
          {(
            [
              { key: 'audio', icon: 'musical-notes-outline', label: 'Audio' },
              { key: 'text', icon: 'text-outline', label: 'Text' },
              { key: 'overlay', icon: 'images-outline', label: 'Overlay' },
              { key: 'filter', icon: 'color-filter-outline', label: 'Filter' },
              { key: 'edit', icon: 'options-outline', label: 'Edit' },
              { key: 'ratio', icon: 'scan-outline', label: 'Ratio' },
            ] as const
          ).map((tool) => {
            const isActive = activeTool === tool.key;
            return (
              <TouchableOpacity
                key={tool.key}
                style={[
                  styles.editorToolBtn,
                  { backgroundColor: colors.surface },
                  isActive && { borderColor: IG_BLUE, borderWidth: 1.5 },
                ]}
                onPress={() => {
                  if (tool.key === 'ratio') {
                    cycleAspect();
                  } else if (tool.key === 'overlay') {
                    void pickOverlaySticker();
                  } else {
                    setActiveTool((prev) =>
                      prev === tool.key ? 'none' : tool.key
                    );
                  }
                }}
              >
                <Ionicons name={tool.icon} size={20} color={colors.text} />
                <Text style={[styles.editorToolLabel, { color: colors.text }]}>
                  {tool.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.editBottomBar, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.secondaryActionBtn, { backgroundColor: colors.surface }]}
            onPress={openSystemGallery}
          >
            <Ionicons name="add" size={18} color={colors.text} />
            <Text style={[styles.secondaryActionText, { color: colors.text }]}>
              Add Photo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.nextBluePill}
            onPress={() => {
              setAudioPlaying(false);
              setStep('share');
            }}
          >
            <Text style={styles.nextBluePillText}>Next</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.shareHeader,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={() => setStep('edit')}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.shareHeaderTitle, { color: colors.text }]}>
              New Photo Post
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.draftPillBtn, { backgroundColor: colors.surface }]}
            onPress={handleSaveDraft}
            activeOpacity={0.8}
          >
            <Text style={[styles.draftPillText, { color: colors.text }]}>
              Draft
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 28, paddingTop: 12 }}
        >
          <View
            style={[
              styles.shareHeroCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.shareHeroTopRow}>
              <TouchableOpacity
                activeOpacity={0.95}
                style={[
                  styles.sharePreviewCardCompact,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={(e) => {
                  const { locationX, locationY } = e.nativeEvent;
                  setPendingPinCoords({
                    xPct: Math.min(85, Math.max(15, (locationX / 108) * 100)),
                    yPct: Math.min(85, Math.max(15, (locationY / 136) * 100)),
                  });
                  setPinUsernameInput('');
                  setActiveModal('pinTag');
                }}
              >
                {activePhotoUri ? (
                  <Image
                    source={{ uri: activePhotoUri }}
                    style={styles.fullImg}
                    resizeMode="cover"
                  />
                ) : null}
                {activeFilter.id !== 'normal' && (
                  <View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: filterColor },
                    ]}
                  />
                )}

                {photoTags.map((pin) => (
                  <TouchableOpacity
                    key={pin.id}
                    style={[
                      styles.tagPinBubble,
                      { left: `${pin.xPct}%`, top: `${pin.yPct}%` },
                    ]}
                    onPress={() =>
                      setPhotoTags((prev) =>
                        prev.filter((p) => p.id !== pin.id)
                      )
                    }
                  >
                    <Text style={styles.tagPinText}>{pin.username} ×</Text>
                  </TouchableOpacity>
                ))}
                <View style={styles.pinHintBadge}>
                  <Ionicons name="pricetag-outline" size={10} color="#ffffff" />
                  <Text style={styles.pinHintText}>Tag</Text>
                </View>
              </TouchableOpacity>

              <TextInput
                style={[
                  styles.shareCaptionInputBox,
                  {
                    color: colors.text,
                    backgroundColor: colors.inputBg,
                    borderColor: colors.border,
                  },
                ]}
                value={caption}
                onChangeText={setCaption}
                placeholder="Write a caption for your photos..."
                placeholderTextColor={colors.subtext}
                multiline
              />
            </View>

            <View style={styles.chipsRowCard}>
              <TouchableOpacity
                style={[styles.actionChip, { backgroundColor: colors.surface }]}
                onPress={() => setActiveModal('poll')}
              >
                <Ionicons
                  name="stats-chart-outline"
                  size={15}
                  color={colors.text}
                />
                <Text style={[styles.actionChipText, { color: colors.text }]}>
                  {pollQuestion ? 'Poll added' : 'Add Poll'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionChip, { backgroundColor: colors.surface }]}
                onPress={() => setActiveModal('prompt')}
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={15}
                  color={colors.text}
                />
                <Text style={[styles.actionChipText, { color: colors.text }]}>
                  {promptText ? 'Prompt added' : 'Add Prompt'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View
            style={[
              styles.shareOptionsCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => setActiveModal('audio')}
            >
              <Ionicons
                name="musical-notes-outline"
                size={22}
                color={colors.text}
              />
              <Text style={[styles.shareRowTitle, { color: colors.text }]}>
                Add audio
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.audioStrip, { backgroundColor: colors.surface }]}
              onPress={() => setActiveModal('audio')}
            >
              <Image
                source={{ uri: (selectedAudio || SUGGESTED_AUDIOS[0]).cover }}
                style={styles.audioStripThumb}
              />
              <Text
                style={[styles.audioStripText, { color: colors.text }]}
                numberOfLines={1}
              >
                {(selectedAudio || SUGGESTED_AUDIOS[0]).artist} ·{' '}
                {(selectedAudio || SUGGESTED_AUDIOS[0]).title}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => setActiveModal('tag')}
            >
              <Ionicons
                name="person-circle-outline"
                size={22}
                color={colors.text}
              />
              <Text style={[styles.shareRowTitle, { color: colors.text }]}>
                Tag people
              </Text>
              <Text
                style={[styles.shareRowSub, { color: colors.subtext }]}
                numberOfLines={1}
              >
                {photoTags.length > 0 ? `${photoTags.length} pinned` : taggedPeople}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => setActiveModal('products')}
            >
              <Ionicons name="bag-outline" size={21} color={colors.text} />
              <Text style={[styles.shareRowTitle, { color: colors.text }]}>
                Add products
              </Text>
              {productTag ? (
                <Text
                  style={[styles.shareRowSub, { color: colors.subtext }]}
                  numberOfLines={1}
                >
                  {productTag}
                </Text>
              ) : (
                <View style={styles.newBadgePill}>
                  <Text style={styles.newBadgeText}>New</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => setActiveModal('location')}
            >
              <Ionicons
                name="location-outline"
                size={22}
                color={colors.text}
              />
              <Text style={[styles.shareRowTitle, { color: colors.text }]}>
                Add location
              </Text>
              <Text
                style={[styles.shareRowSub, { color: colors.subtext }]}
                numberOfLines={1}
              >
                {locationText}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => setActiveModal('audience')}
            >
              <Ionicons name="eye-outline" size={22} color={colors.text} />
              <Text style={[styles.shareRowTitle, { color: colors.text }]}>
                Audience
              </Text>
              <Text style={[styles.shareRowSub, { color: colors.subtext }]}>
                {audience}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => setActiveModal('schedule')}
            >
              <Ionicons
                name="calendar-outline"
                size={21}
                color={colors.text}
              />
              <Text style={[styles.shareRowTitle, { color: colors.text }]}>
                Schedule post
              </Text>
              <Text style={[styles.shareRowSub, { color: colors.subtext }]}>
                {scheduleLabel}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => setActiveModal('advanced')}
            >
              <Ionicons
                name="settings-outline"
                size={21}
                color={colors.text}
              />
              <Text style={[styles.shareRowTitle, { color: colors.text }]}>
                More options
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View
          style={[
            styles.shareFooter,
            {
              backgroundColor: colors.bg,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12) + 6,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.shareFullBtn}
            onPress={handleShare}
            disabled={publishing}
          >
            {publishing ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.shareFullBtnText}>
                {schedulePreset === 'now' ? 'Share' : 'Schedule'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={activeModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setActiveModal(null)}
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 16) + 10,
              },
            ]}
          >
            <View style={styles.sheetHandle} />

            {activeModal === 'pinTag' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Pin Person on Photo
                </Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={pinUsernameInput}
                  onChangeText={setPinUsernameInput}
                  placeholder="@username"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.shareFullBtn}
                  onPress={() => {
                    const clean = pinUsernameInput.trim();
                    if (clean && pendingPinCoords) {
                      const handle = clean.startsWith('@') ? clean : `@${clean}`;
                      setPhotoTags((prev) => [
                        ...prev,
                        {
                          id: `pin-${Date.now()}`,
                          username: handle,
                          xPct: pendingPinCoords.xPct,
                          yPct: pendingPinCoords.yPct,
                        },
                      ]);
                    }
                    setActiveModal(null);
                  }}
                >
                  <Text style={styles.shareFullBtnText}>Pin Tag</Text>
                </TouchableOpacity>
              </>
            )}

            {activeModal === 'audio' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Select Audio
                </Text>
                {SUGGESTED_AUDIOS.map((aud) => (
                  <TouchableOpacity
                    key={aud.id}
                    style={[
                      styles.sheetAudioRow,
                      { borderBottomColor: colors.border },
                    ]}
                    onPress={() => {
                      setSelectedAudio(aud);
                      setActiveModal(null);
                    }}
                  >
                    <Image
                      source={{ uri: aud.cover }}
                      style={styles.audioStripThumb}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>
                        {aud.title}
                      </Text>
                      <Text style={{ color: colors.subtext, fontSize: 12 }}>
                        {aud.artist}
                      </Text>
                    </View>
                    {selectedAudio?.id === aud.id && (
                      <Ionicons name="checkmark-circle" size={20} color={IG_BLUE} />
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}

            {activeModal === 'poll' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Add Poll
                </Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={pollQuestion}
                  onChangeText={setPollQuestion}
                  placeholder="Ask a question..."
                  placeholderTextColor={colors.subtext}
                />
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={pollOpt1}
                  onChangeText={setPollOpt1}
                  placeholder="Option 1"
                  placeholderTextColor={colors.subtext}
                />
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={pollOpt2}
                  onChangeText={setPollOpt2}
                  placeholder="Option 2"
                  placeholderTextColor={colors.subtext}
                />
                <TouchableOpacity
                  style={styles.shareFullBtn}
                  onPress={() => setActiveModal(null)}
                >
                  <Text style={styles.shareFullBtnText}>Save Poll</Text>
                </TouchableOpacity>
              </>
            )}

            {activeModal === 'prompt' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Add Prompt
                </Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={promptText}
                  onChangeText={setPromptText}
                  placeholder="e.g. Drop your thoughts below..."
                  placeholderTextColor={colors.subtext}
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.shareFullBtn}
                  onPress={() => setActiveModal(null)}
                >
                  <Text style={styles.shareFullBtnText}>Save Prompt</Text>
                </TouchableOpacity>
              </>
            )}

            {activeModal === 'tag' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Tag People
                </Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={taggedPeople}
                  onChangeText={setTaggedPeople}
                  placeholder="@username1, @username2"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.shareFullBtn}
                  onPress={() => setActiveModal(null)}
                >
                  <Text style={styles.shareFullBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            )}

            {activeModal === 'products' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Add Products
                </Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={productTag}
                  onChangeText={setProductTag}
                  placeholder="Enter product name or link..."
                  placeholderTextColor={colors.subtext}
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.shareFullBtn}
                  onPress={() => setActiveModal(null)}
                >
                  <Text style={styles.shareFullBtnText}>Save</Text>
                </TouchableOpacity>
              </>
            )}

            {activeModal === 'location' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Add Location
                </Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={locationText}
                  onChangeText={setLocationText}
                  placeholder="e.g. Gurugram, India"
                  placeholderTextColor={colors.subtext}
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.shareFullBtn}
                  onPress={() => setActiveModal(null)}
                >
                  <Text style={styles.shareFullBtnText}>Save</Text>
                </TouchableOpacity>
              </>
            )}

            {activeModal === 'audience' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Audience
                </Text>
                {(['Public', 'Followers', 'Close Friends'] as AudienceType[]).map(
                  (aud) => (
                    <TouchableOpacity
                      key={aud}
                      style={[
                        styles.sheetAudioRow,
                        { borderBottomColor: colors.border },
                      ]}
                      onPress={() => {
                        setAudience(aud);
                        setActiveModal(null);
                      }}
                    >
                      <Text
                        style={{
                          flex: 1,
                          color: colors.text,
                          fontSize: 15,
                          fontWeight: '600',
                        }}
                      >
                        {aud}
                      </Text>
                      {audience === aud && (
                        <Ionicons name="checkmark-circle" size={20} color={IG_BLUE} />
                      )}
                    </TouchableOpacity>
                  )
                )}
              </>
            )}

            {activeModal === 'schedule' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Schedule Post
                </Text>
                {(
                  [
                    { key: 'now', label: 'Publish now' },
                    { key: '1h', label: 'In 1 hour' },
                    { key: 'tonight', label: 'Tonight · 8:00 PM' },
                    { key: 'tomorrow', label: 'Tomorrow · 10:00 AM' },
                  ] as const
                ).map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.sheetAudioRow,
                      { borderBottomColor: colors.border },
                    ]}
                    onPress={() => {
                      setSchedulePreset(opt.key);
                      setActiveModal(null);
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        color: colors.text,
                        fontSize: 15,
                        fontWeight: '600',
                      }}
                    >
                      {opt.label}
                    </Text>
                    {schedulePreset === opt.key && (
                      <Ionicons name="checkmark-circle" size={20} color={IG_BLUE} />
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}

            {activeModal === 'advanced' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  More Options
                </Text>
                <View
                  style={[
                    styles.sheetAudioRow,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Text style={{ flex: 1, color: colors.text, fontSize: 15 }}>
                    Turn off commenting
                  </Text>
                  <Switch
                    value={!allowComments}
                    onValueChange={(v) => setAllowComments(!v)}
                    trackColor={{ false: '#52525b', true: IG_BLUE }}
                    thumbColor="#ffffff"
                  />
                </View>
                <View style={[styles.sheetAudioRow, { borderBottomWidth: 0 }]}>
                  <Text style={{ flex: 1, color: colors.text, fontSize: 15 }}>
                    Hide like count on this post
                  </Text>
                  <Switch
                    value={hideLikes}
                    onValueChange={setHideLikes}
                    trackColor={{ false: '#52525b', true: IG_BLUE }}
                    thumbColor="#ffffff"
                  />
                </View>
              </>
            )}

            {activeModal === 'photoUrl' && (
              <>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  Add Photo by URL
                </Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.surface, color: colors.text },
                  ]}
                  value={photoUrlInput}
                  onChangeText={setPhotoUrlInput}
                  placeholder="https://example.com/photo.jpg"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.shareFullBtn}
                  onPress={() => {
                    const raw = photoUrlInput.trim();
                    const match = raw.match(/https?:\/\/\S+/i);
                    const clean = match
                      ? match[0]
                      : /^www\.|^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(raw)
                        ? `https://${raw}`
                        : raw;
                    if (!clean || !/^https?:\/\//i.test(clean)) {
                      Alert.alert(
                        'Invalid URL',
                        'Enter a valid http or https image URL.'
                      );
                      return;
                    }
                    setSelectedPhotos((prev) => {
                      const next = prev.includes(clean) ? prev : [...prev, clean];
                      setActivePhotoIdx(next.indexOf(clean));
                      return next;
                    });
                    setPhotoUrlInput('');
                    setActiveModal(null);
                  }}
                >
                  <Text style={styles.shareFullBtnText}>Add Photo URL</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fullImg: { width: '100%', height: '100%' },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 54,
    borderBottomWidth: 1,
  },
  topHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconHit: { padding: 4 },
  topHeaderTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  nextHeaderBtn: {
    backgroundColor: IG_BLUE,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
  },
  nextHeaderText: { color: '#ffffff', fontSize: 13.5, fontWeight: '800' },
  galleryStageOuter: {
    width: '100%',
    maxHeight: 350,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryPreviewBox: {
    width: '100%',
    maxHeight: 350,
    position: 'relative',
    overflow: 'hidden',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(120,120,128,0.22)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(120,120,128,0.22)',
  },
  aspectRoundBtn: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(9,9,11,0.72)',
  },
  aspectBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  slideCounterPill: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(9,9,11,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  slideCounterText: { color: '#ffffff', fontSize: 11.5, fontWeight: '700' },
  previewNavArrow: {
    position: 'absolute',
    top: '46%',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(9,9,11,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeTopPhotoBtn: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(239,68,68,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPreviewBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyPreviewText: { fontSize: 13.5, fontWeight: '600' },
  selectedActionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 12,
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 22,
  },
  secondaryActionText: { fontSize: 14, fontWeight: '700' },
  primaryNextBtn: {
    flex: 1,
    backgroundColor: IG_BLUE,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: 1,
  },
  recentsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  recentsText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  selectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
  },
  selectPillText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  galleryLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  gridCameraTile: {
    width: '25%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  gridPhotoTile: {
    width: '25%',
    aspectRatio: 1,
    position: 'relative',
    borderWidth: 1,
  },
  activeTileVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  gridSelectBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridSelectNum: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  editTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestedAudioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    maxWidth: '64%',
  },
  audioPillThumb: { width: 24, height: 24, borderRadius: 5 },
  audioPillText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  compareBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCanvasWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editCanvasBox: {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draggableSticker: {
    position: 'absolute',
    top: 24,
    right: 24,
    width: 92,
    height: 112,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ffffff',
    overflow: 'hidden',
  },
  stickerImg: { width: '100%', height: '100%' },
  stickerClose: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draggableTextWrap: {
    position: 'absolute',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  textOverlayValue: { fontSize: 17, fontWeight: '800' },
  originalBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(9,9,11,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  originalBadgeText: { color: '#ffffff', fontSize: 10.5, fontWeight: '800' },
  toolTray: { paddingVertical: 8, gap: 8 },
  filterMiniBox: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden' },
  transformRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 4,
  },
  transformBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
  },
  transformText: { fontSize: 11.5, fontWeight: '700' },
  sliderBlock: { paddingHorizontal: 16, gap: 4 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel: { fontSize: 11, fontWeight: '600' },
  sliderValText: { fontSize: 11, fontWeight: '700' },
  sliderHit: { height: 22, justifyContent: 'center', position: 'relative' },
  sliderTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  sliderFill: { height: '100%', backgroundColor: IG_BLUE },
  sliderKnob: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    top: 4,
  },
  toolTextInput: {
    marginHorizontal: 14,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  textStyleControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
  bgStylePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  audioPickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
  },
  audioTrimmerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    gap: 6,
  },
  playAudioBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: IG_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorToolsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  editorToolBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
    gap: 4,
  },
  editorToolLabel: { fontSize: 10.5, fontWeight: '600' },
  editBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    gap: 10,
  },
  nextBluePill: {
    backgroundColor: IG_BLUE,
    paddingHorizontal: 28,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBluePillText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  shareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 54,
    borderBottomWidth: 1,
  },
  shareHeaderTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  draftPillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  draftPillText: { fontSize: 13, fontWeight: '700' },
  shareHeroCard: {
    marginHorizontal: 14,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
  },
  shareHeroTopRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'stretch',
  },
  sharePreviewCardCompact: {
    width: 108,
    height: 136,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  pinHintBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(9, 9, 11, 0.72)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pinHintText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  shareCaptionInputBox: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14.5,
    minHeight: 136,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  chipsRowCard: {
    flexDirection: 'row',
    gap: 8,
  },
  shareOptionsCard: {
    marginHorizontal: 14,
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sharePreviewWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 10 },
  sharePreviewCard: {
    width: 220,
    height: 256,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  tagPinBubble: {
    position: 'absolute',
    backgroundColor: 'rgba(9, 9, 11, 0.84)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    transform: [{ translateX: -32 }, { translateY: -12 }],
  },
  tagPinText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  shareCaptionInput: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 14,
    marginBottom: 4,
    borderBottomWidth: 1,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  actionChipText: { fontSize: 13, fontWeight: '700' },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 12,
  },
  shareRowTitle: { fontSize: 15.5, fontWeight: '500', flex: 1 },
  shareRowSub: { fontSize: 13, maxWidth: '35%' },
  audioStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 6,
    borderRadius: 10,
    gap: 10,
  },
  audioStripThumb: { width: 32, height: 32, borderRadius: 6 },
  audioStripText: { fontSize: 13.5, fontWeight: '500', flex: 1 },
  newBadgePill: {
    backgroundColor: IG_BLUE,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  newBadgeText: { color: '#ffffff', fontSize: 11.5, fontWeight: '700' },
  shareFooter: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  shareFullBtn: {
    backgroundColor: IG_BLUE,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareFullBtnText: { color: '#ffffff', fontSize: 15.5, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.52)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#71717a',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', marginBottom: 12 },
  sheetInput: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 10,
  },
  sheetAudioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
});