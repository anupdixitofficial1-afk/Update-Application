import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  DeviceEventEmitter,
  StatusBar,
  useColorScheme,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backend } from '../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
type ThemeMode = 'light' | 'dark' | 'system';

interface CountryCodeItem {
  code: string;
  country: string;
  cca2: string;
  flag: string;
  minDigits: number;
  maxDigits: number;
}

const DEFAULT_COUNTRY: CountryCodeItem = {
  code: '+91',
  country: 'India',
  cca2: 'IN',
  flag: '🇮🇳',
  minDigits: 10,
  maxDigits: 10,
};

let cachedOnlineCountries: CountryCodeItem[] | null = null;

const getFlagEmoji = (cca2: string): string => {
  const code = (cca2 || '').toUpperCase();
  if (code.length !== 2) return '🌍';
  const c1 = code.charCodeAt(0);
  const c2 = code.charCodeAt(1);
  if (c1 < 65 || c1 > 90 || c2 < 65 || c2 > 90) return '🌍';
  return (
    String.fromCharCode(0xd83c, 0xdde6 + (c1 - 65)) +
    String.fromCharCode(0xd83c, 0xdde6 + (c2 - 65))
  );
};

const getDigitRangeByCode = (
  code: string
): { minDigits: number; maxDigits: number } => {
  if (code === '+91') return { minDigits: 10, maxDigits: 10 };
  if (code === '+1') return { minDigits: 10, maxDigits: 10 };
  return { minDigits: 6, maxDigits: 15 };
};

const fetchCountryCodesOnline = async (): Promise<CountryCodeItem[]> => {
  if (cachedOnlineCountries && cachedOnlineCountries.length > 0) {
    return cachedOnlineCountries;
  }

  const response = await fetch(
    'https://restcountries.com/v3.1/all?fields=name,cca2,idd'
  );

  if (!response.ok) {
    throw new Error(`Failed to sync country codes (${response.status})`);
  }

  const rawList: Array<{
    name?: { common?: string };
    cca2?: string;
    idd?: { root?: string; suffixes?: string[] };
  }> = await response.json();

  const parsed: CountryCodeItem[] = [];
  const seenKeys: Record<string, boolean> = {};

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    const countryName = String(item?.name?.common || '').trim();
    const cca2 = String(item?.cca2 || '')
      .trim()
      .toUpperCase();
    const rootRaw = String(item?.idd?.root || '').trim();
    const suffixesRaw = Array.isArray(item?.idd?.suffixes)
      ? item.idd.suffixes
      : [];

    if (!countryName || !cca2) continue;

    const cleanRoot = rootRaw
      ? rootRaw.startsWith('+')
        ? rootRaw.replace(/\s+/g, '')
        : `+${rootRaw.replace(/\s+/g, '')}`
      : '';

    const cleanSuffixes: string[] = [];
    for (let s = 0; s < suffixesRaw.length; s++) {
      const suf = String(suffixesRaw[s] || '').replace(/\s+/g, '');
      if (suf) cleanSuffixes.push(suf);
    }

    let dialCodes: string[] = [];
    if (!cleanRoot) {
      dialCodes = [''];
    } else if (
      cleanSuffixes.length === 0 ||
      cleanRoot === '+1' ||
      cleanRoot === '+7' ||
      cleanSuffixes.length > 12
    ) {
      dialCodes = [cleanRoot];
    } else {
      for (let j = 0; j < cleanSuffixes.length; j++) {
        const suf = cleanSuffixes[j];
        const combined = suf.startsWith('+') ? suf : `${cleanRoot}${suf}`;
        if (dialCodes.indexOf(combined) === -1) dialCodes.push(combined);
      }
      if (dialCodes.length === 0) dialCodes = [cleanRoot];
    }

    for (let k = 0; k < dialCodes.length; k++) {
      const code = dialCodes[k];
      const dedupeKey = `${cca2}|${countryName}|${code}`;
      if (seenKeys[dedupeKey]) continue;
      seenKeys[dedupeKey] = true;

      const digits = getDigitRangeByCode(code);
      parsed.push({
        code,
        country: countryName,
        cca2,
        flag: getFlagEmoji(cca2),
        minDigits: digits.minDigits,
        maxDigits: digits.maxDigits,
      });
    }
  }

  parsed.sort((a, b) => {
    if (a.cca2 === 'IN' && b.cca2 !== 'IN') return -1;
    if (b.cca2 === 'IN' && a.cca2 !== 'IN') return 1;
    if (a.country < b.country) return -1;
    if (a.country > b.country) return 1;
    return a.code.localeCompare(b.code);
  });

  if (parsed.length > 0) cachedOnlineCountries = parsed;
  return parsed;
};

const sanitizeUsernameOnly = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]/g, '');

const sanitizeMobileDigits = (raw: string): string => raw.replace(/\D/g, '');

type ActiveField =
  | 'fullName'
  | 'username'
  | 'mobile'
  | 'email'
  | 'password'
  | null;

export default function SignUpScreen() {
  const scrollViewRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const systemScheme = useColorScheme();

  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const colors = useMemo(
    () => ({
      bg: isDark ? '#09090b' : '#ffffff',
      surface: isDark ? '#18181b' : '#f4f4f5',
      card: isDark ? '#18181b' : '#ffffff',
      border: isDark ? '#27272a' : '#e4e4e7',
      text: isDark ? '#fafafa' : '#09090b',
      subtext: isDark ? '#a1a1aa' : '#71717a',
      accent: isDark ? '#fafafa' : '#09090b',
      accentText: isDark ? '#09090b' : '#ffffff',
      emerald: '#10b981',
      emeraldSoft: isDark ? 'rgba(16, 185, 129, 0.14)' : '#ecfdf5',
      danger: '#ef4444',
      dangerSoft: isDark ? 'rgba(239, 68, 68, 0.14)' : '#fef2f2',
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

  const [fullName, setFullName] = useState('');
  const [fullNameError, setFullNameError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailAvailableMsg, setEmailAvailableMsg] = useState<string | null>(
    null
  );
  const [checkingEmail, setCheckingEmail] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameAvailableMsg, setUsernameAvailableMsg] = useState<
    string | null
  >(null);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const [countryCodes, setCountryCodes] = useState<CountryCodeItem[]>(
    cachedOnlineCountries || [DEFAULT_COUNTRY]
  );
  const [selectedCountry, setSelectedCountry] = useState<CountryCodeItem>(
    cachedOnlineCountries?.find((c) => c.cca2 === 'IN') || DEFAULT_COUNTRY
  );
  const [syncingCountries, setSyncingCountries] = useState(false);
  const [countrySyncError, setCountrySyncError] = useState<string | null>(null);

  const [mobileNumber, setMobileNumber] = useState('');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [checkingMobile, setCheckingMobile] = useState(false);
  const [countryModalOpen, setCountryModalOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>(null);

  const syncCountries = async (forceRefresh = false) => {
    if (forceRefresh) cachedOnlineCountries = null;
    setSyncingCountries(true);
    setCountrySyncError(null);
    try {
      const list = await fetchCountryCodesOnline();
      if (list.length > 0) {
        setCountryCodes(list);
        const india = list.find((c) => c.cca2 === 'IN');
        if (india) {
          setSelectedCountry((prev) =>
            prev.cca2 === 'IN' && prev.country === 'India' ? india : prev
          );
        }
      }
    } catch (err: any) {
      setCountrySyncError(err?.message || 'Failed to sync country codes.');
    } finally {
      setSyncingCountries(false);
    }
  };

  useEffect(() => {
    void syncCountries(false);
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setActiveField(null);
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Live debounced username availability via backend adapter
  useEffect(() => {
    const clean = sanitizeUsernameOnly(username);
    if (!clean) {
      setUsernameAvailableMsg(null);
      setUsernameError(null);
      setCheckingUsername(false);
      return;
    }
    if (clean.length < 6) {
      setUsernameAvailableMsg(null);
      setUsernameError('Min 6 chars');
      setCheckingUsername(false);
      return;
    }

    setUsernameError(null);
    setUsernameAvailableMsg(null);
    setCheckingUsername(true);

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const isAvailable = await backend.auth.checkAvailability(
          'username',
          clean
        );
        if (!active) return;
        if (isAvailable) {
          setUsernameError(null);
          setUsernameAvailableMsg('Available');
        } else {
          setUsernameAvailableMsg(null);
          setUsernameError('Taken');
        }
      } catch {
        if (!active) return;
        setUsernameAvailableMsg(null);
        setUsernameError('Check failed');
      } finally {
        if (active) setCheckingUsername(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username]);

  // Live debounced email availability via backend adapter
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!trimmed || !emailRegex.test(trimmed)) {
      setEmailAvailableMsg(null);
      setEmailError(null);
      setCheckingEmail(false);
      return;
    }

    setEmailError(null);
    setEmailAvailableMsg(null);
    setCheckingEmail(true);

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const isAvailable = await backend.auth.checkAvailability(
          'email',
          trimmed
        );
        if (!active) return;
        if (isAvailable) {
          setEmailError(null);
          setEmailAvailableMsg('Available');
        } else {
          setEmailAvailableMsg(null);
          setEmailError('Already used');
        }
      } catch {
        if (!active) return;
        setEmailAvailableMsg(null);
        setEmailError('Check failed');
      } finally {
        if (active) setCheckingEmail(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [email]);

  const handleFocusField = (field: ActiveField, shouldScrollEnd = false) => {
    setActiveField(field);
    if (shouldScrollEnd) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 80);
    }
  };

  const validateMobile = (
    digitsRaw: string,
    country: CountryCodeItem
  ): boolean => {
    const digits = sanitizeMobileDigits(digitsRaw);
    if (!digits) {
      setMobileError('Mobile number is required.');
      return false;
    }
    if (digits.length < country.minDigits || digits.length > country.maxDigits) {
      setMobileError(
        country.minDigits === country.maxDigits
          ? `Enter a valid ${country.minDigits}-digit number for ${country.country}.`
          : `Enter a valid ${country.minDigits}–${country.maxDigits} digit number.`
      );
      return false;
    }
    setMobileError(null);
    return true;
  };

  const checkMobileAvailability = async (
    digitsRaw: string,
    country: CountryCodeItem
  ): Promise<boolean> => {
    if (!validateMobile(digitsRaw, country)) return false;
    const digits = sanitizeMobileDigits(digitsRaw);
    const fullPhone = `${country.code}${digits}`;

    setCheckingMobile(true);
    try {
      const isAvailable = await backend.auth.checkAvailability(
        'phone',
        fullPhone
      );
      if (!isAvailable) {
        setMobileError('This mobile number is already registered.');
        return false;
      }
      setMobileError(null);
      return true;
    } catch {
      return true;
    } finally {
      setCheckingMobile(false);
    }
  };

  const checkUsernameAvailability = async (rawValue: string): Promise<boolean> => {
    const clean = sanitizeUsernameOnly(rawValue);
    setUsername(clean);

    if (!clean) {
      setUsernameAvailableMsg(null);
      setUsernameError('Required');
      return false;
    }
    if (clean.length < 6) {
      setUsernameAvailableMsg(null);
      setUsernameError('Min 6 chars');
      return false;
    }

    setCheckingUsername(true);
    try {
      const isAvailable = await backend.auth.checkAvailability(
        'username',
        clean
      );
      if (!isAvailable) {
        setUsernameAvailableMsg(null);
        setUsernameError('Taken');
        return false;
      }
      setUsernameError(null);
      setUsernameAvailableMsg('Available');
      return true;
    } catch {
      setUsernameAvailableMsg(null);
      setUsernameError('Check failed');
      return false;
    } finally {
      setCheckingUsername(false);
    }
  };

  const checkEmailAvailability = async (rawEmail: string): Promise<boolean> => {
    const trimmed = rawEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setEmailAvailableMsg(null);
      setEmailError('Invalid email');
      return false;
    }

    setCheckingEmail(true);
    try {
      const isAvailable = await backend.auth.checkAvailability('email', trimmed);
      if (!isAvailable) {
        setEmailAvailableMsg(null);
        setEmailError('Already used');
        return false;
      }
      setEmailError(null);
      setEmailAvailableMsg('Available');
      return true;
    } catch {
      setEmailAvailableMsg(null);
      setEmailError('Check failed');
      return false;
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleSignUp = async () => {
    if (submitting) return;
    Keyboard.dismiss();
    setFormError(null);

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const cleanUser = sanitizeUsernameOnly(username);
    const cleanDigits = sanitizeMobileDigits(mobileNumber);

    let hasClientError = false;
    if (!trimmedName) {
      setFullNameError('Full name is required.');
      hasClientError = true;
    } else {
      setFullNameError(null);
    }
    if (!password || password.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      hasClientError = true;
    } else {
      setPasswordError(null);
    }
    if (!validateMobile(cleanDigits, selectedCountry)) {
      hasClientError = true;
    }
    if (hasClientError) return;

    setSubmitting(true);
    try {
      if (!(await checkUsernameAvailability(cleanUser))) return;
      if (!(await checkEmailAvailability(trimmedEmail))) return;
      if (!(await checkMobileAvailability(cleanDigits, selectedCountry))) return;

      await backend.auth.signUp({
        fullName: trimmedName,
        username: cleanUser,
        email: trimmedEmail,
        password,
        countryCode: selectedCountry.code,
        mobileNumber: cleanDigits,
      });

      router.replace('/login');
    } catch (error: any) {
      const msg = String(error?.message || '').toLowerCase();
      if (
        msg.includes('already registered') ||
        msg.includes('already exists') ||
        msg.includes('email')
      ) {
        setEmailAvailableMsg(null);
        setEmailError('Already used');
      } else if (msg.includes('username') || msg.includes('duplicate')) {
        setUsernameAvailableMsg(null);
        setUsernameError('Taken');
      } else if (msg.includes('phone') || msg.includes('mobile')) {
        setMobileError('This mobile number is already registered.');
      } else {
        setFormError(error?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderRightAvailabilityStatus = (
    checking: boolean,
    availableMsg: string | null,
    errorMsg: string | null
  ) => {
    if (checking) return <ActivityIndicator size="small" color={colors.emerald} />;
    if (availableMsg) {
      return (
        <View style={styles.statusInlineRow}>
          <Ionicons name="checkmark-circle" size={15} color={colors.emerald} />
          <Text style={[styles.inlineAvailableText, { color: colors.emerald }]}>
            {availableMsg}
          </Text>
        </View>
      );
    }
    if (errorMsg) {
      return (
        <View style={styles.statusInlineRow}>
          <Ionicons name="close-circle" size={15} color={colors.danger} />
          <Text style={[styles.inlineErrorText, { color: colors.danger }]}>
            {errorMsg}
          </Text>
        </View>
      );
    }
    return null;
  };

  const normalizedSearch = countrySearch.trim().toLowerCase();
  const filteredCountries = countryCodes.filter((item) => {
    if (!normalizedSearch) return true;
    const compactCode = item.code.replace(/[^+\d]/g, '').toLowerCase();
    return (
      item.country.toLowerCase().includes(normalizedSearch) ||
      item.cca2.toLowerCase().includes(normalizedSearch) ||
      item.code.toLowerCase().includes(normalizedSearch) ||
      compactCode.includes(normalizedSearch)
    );
  });

  const shouldAvoidKeyboard =
    activeField === 'email' || activeField === 'password';

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <KeyboardAvoidingView
        enabled={shouldAvoidKeyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContainer,
            keyboardVisible && shouldAvoidKeyboard
              ? styles.scrollContainerKeyboardOpen
              : styles.scrollContainerCentered,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoContainer}>
            <View
              style={[
                styles.flameIconBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <MaterialCommunityIcons
                name="fire"
                size={30}
                color={colors.emerald}
              />
            </View>
          </View>

          <Text style={[styles.appTitle, { color: colors.text }]}>
            Create Account
          </Text>
          <Text style={[styles.appSubtitle, { color: colors.subtext }]}>
            Join VibeSphere with your profile, handle & mobile number
          </Text>

          <View style={styles.formContainer}>
            {/* FULL NAME */}
            <View style={styles.inputWrapper}>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: fullNameError
                      ? colors.dangerSoft
                      : colors.surface,
                    borderColor: fullNameError ? colors.danger : colors.border,
                    color: colors.text,
                  },
                ]}
                value={fullName}
                onChangeText={(text) => {
                  setFullName(text);
                  if (fullNameError) setFullNameError(null);
                }}
                onFocus={() => handleFocusField('fullName', false)}
                placeholder="Enter your full name"
                placeholderTextColor={colors.subtext}
                autoCapitalize="words"
              />
              {fullNameError ? (
                <Text style={[styles.errorText, { color: colors.danger }]}>
                  {fullNameError}
                </Text>
              ) : null}
            </View>

            {/* USERNAME */}
            <View style={styles.inputWrapper}>
              <View
                style={[
                  styles.inlineInputBox,
                  {
                    backgroundColor: usernameError
                      ? colors.dangerSoft
                      : colors.surface,
                    borderColor: usernameError
                      ? colors.danger
                      : usernameAvailableMsg
                        ? colors.emerald
                        : colors.border,
                  },
                ]}
              >
                <TextInput
                  style={[styles.inlineTextInput, { color: colors.text }]}
                  value={username}
                  onChangeText={(text) => {
                    setUsername(sanitizeUsernameOnly(text));
                    if (usernameError) setUsernameError(null);
                  }}
                  onFocus={() => handleFocusField('username', false)}
                  onBlur={() => {
                    if (username.trim()) void checkUsernameAvailability(username);
                  }}
                  placeholder="Username (min 6 chars)"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {renderRightAvailabilityStatus(
                  checkingUsername,
                  usernameAvailableMsg,
                  usernameError
                )}
              </View>
            </View>

            {/* MOBILE NUMBER */}
            <View style={styles.inputWrapper}>
              <View style={styles.phoneRow}>
                <TouchableOpacity
                  style={[
                    styles.codeBox,
                    {
                      backgroundColor: colors.surface,
                      borderColor: mobileError ? colors.danger : colors.border,
                    },
                  ]}
                  onPress={() => {
                    setCountryModalOpen(true);
                    if (countryCodes.length <= 1 && !syncingCountries) {
                      void syncCountries(false);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.codeFlag}>{selectedCountry.flag}</Text>
                  <Text style={[styles.codeText, { color: colors.text }]}>
                    {selectedCountry.code}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={colors.subtext} />
                </TouchableOpacity>

                <View
                  style={[
                    styles.inlineInputBox,
                    {
                      flex: 1,
                      backgroundColor: mobileError
                        ? colors.dangerSoft
                        : colors.surface,
                      borderColor: mobileError ? colors.danger : colors.border,
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.inlineTextInput, { color: colors.text }]}
                    value={mobileNumber}
                    onChangeText={(text) => {
                      setMobileNumber(sanitizeMobileDigits(text));
                      if (mobileError) setMobileError(null);
                    }}
                    onFocus={() => handleFocusField('mobile', false)}
                    onBlur={() => {
                      if (mobileNumber.trim()) {
                        void checkMobileAvailability(mobileNumber, selectedCountry);
                      }
                    }}
                    placeholder="Mobile number"
                    placeholderTextColor={colors.subtext}
                    keyboardType="phone-pad"
                    maxLength={selectedCountry.maxDigits}
                  />
                  {checkingMobile && (
                    <ActivityIndicator size="small" color={colors.emerald} />
                  )}
                </View>
              </View>
              {mobileError ? (
                <Text style={[styles.errorText, { color: colors.danger }]}>
                  {mobileError}
                </Text>
              ) : null}
            </View>

            {/* EMAIL */}
            <View style={styles.inputWrapper}>
              <View
                style={[
                  styles.inlineInputBox,
                  {
                    backgroundColor: emailError
                      ? colors.dangerSoft
                      : colors.surface,
                    borderColor: emailError
                      ? colors.danger
                      : emailAvailableMsg
                        ? colors.emerald
                        : colors.border,
                  },
                ]}
              >
                <TextInput
                  style={[styles.inlineTextInput, { color: colors.text }]}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (emailError) setEmailError(null);
                  }}
                  onFocus={() => handleFocusField('email', true)}
                  onBlur={() => {
                    if (email.trim()) void checkEmailAvailability(email);
                  }}
                  placeholder="Email address"
                  placeholderTextColor={colors.subtext}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {renderRightAvailabilityStatus(
                  checkingEmail,
                  emailAvailableMsg,
                  emailError
                )}
              </View>
            </View>

            {/* PASSWORD */}
            <View style={styles.inputWrapper}>
              <View
                style={[
                  styles.inlineInputBox,
                  {
                    backgroundColor: passwordError
                      ? colors.dangerSoft
                      : colors.surface,
                    borderColor: passwordError ? colors.danger : colors.border,
                  },
                ]}
              >
                <TextInput
                  style={[styles.inlineTextInput, { color: colors.text }]}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (passwordError) setPasswordError(null);
                  }}
                  onFocus={() => handleFocusField('password', true)}
                  secureTextEntry={!showPassword}
                  placeholder="Password (min 6 characters)"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword((p) => !p)}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={colors.subtext}
                  />
                </TouchableOpacity>
              </View>
              {passwordError ? (
                <Text style={[styles.errorText, { color: colors.danger }]}>
                  {passwordError}
                </Text>
              ) : null}
            </View>

            {formError ? (
              <Text style={[styles.errorText, { color: colors.danger }]}>
                {formError}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.signUpBtn,
                { backgroundColor: colors.accent },
                submitting && { opacity: 0.7 },
              ]}
              onPress={() => void handleSignUp()}
              activeOpacity={0.85}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text
                  style={[styles.signUpBtnText, { color: colors.accentText }]}
                >
                  Create Account
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footerContainer}>
            <Text style={[styles.footerText, { color: colors.subtext }]}>
              Already have an account?{' '}
              <Text
                style={[styles.loginLinkText, { color: colors.text }]}
                onPress={() => router.replace('/login')}
              >
                Log In
              </Text>
            </Text>
          </View>

          {/* COUNTRY CODE MODAL */}
          <Modal
            visible={countryModalOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setCountryModalOpen(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    Select Country Code
                  </Text>
                  <View style={styles.modalHeaderActions}>
                    <TouchableOpacity
                      onPress={() => void syncCountries(true)}
                      disabled={syncingCountries}
                    >
                      <Ionicons
                        name="refresh"
                        size={18}
                        color={syncingCountries ? colors.subtext : colors.emerald}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setCountryModalOpen(false)}>
                      <Ionicons name="close" size={22} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                </View>

                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                      marginBottom: 10,
                    },
                  ]}
                  value={countrySearch}
                  onChangeText={setCountrySearch}
                  placeholder="Search country or +91..."
                  placeholderTextColor={colors.subtext}
                />

                {syncingCountries ? (
                  <View style={styles.syncStatusBox}>
                    <ActivityIndicator size="small" color={colors.emerald} />
                    <Text
                      style={[styles.syncStatusText, { color: colors.subtext }]}
                    >
                      Syncing country codes...
                    </Text>
                  </View>
                ) : countrySyncError ? (
                  <View style={styles.syncStatusBox}>
                    <Text style={[styles.errorText, { color: colors.danger }]}>
                      {countrySyncError}
                    </Text>
                    <TouchableOpacity onPress={() => void syncCountries(true)}>
                      <Text style={{ color: colors.emerald, fontWeight: '700' }}>
                        Retry
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <FlatList
                    data={filteredCountries}
                    keyExtractor={(item, idx) =>
                      `${item.cca2}-${item.country}-${item.code}-${idx}`
                    }
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => {
                      const isSelected =
                        item.cca2 === selectedCountry.cca2 &&
                        item.code === selectedCountry.code &&
                        item.country === selectedCountry.country;
                      return (
                        <TouchableOpacity
                          style={[
                            styles.countryItem,
                            { borderBottomColor: colors.border },
                            isSelected && { backgroundColor: colors.emeraldSoft },
                          ]}
                          onPress={() => {
                            setSelectedCountry(item);
                            setCountryModalOpen(false);
                            setCountrySearch('');
                            if (mobileNumber.trim()) {
                              void checkMobileAvailability(mobileNumber, item);
                            }
                          }}
                        >
                          <Text
                            style={[styles.countryItemText, { color: colors.text }]}
                          >
                            {item.flag} {item.country} ({item.code || 'N/A'})
                          </Text>
                          {isSelected && (
                            <Ionicons
                              name="checkmark"
                              size={18}
                              color={colors.emerald}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}
              </View>
            </View>
          </Modal>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContainer: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 18 },
  scrollContainerCentered: { justifyContent: 'center' },
  scrollContainerKeyboardOpen: { justifyContent: 'flex-start', paddingTop: 12 },
  logoContainer: { alignItems: 'center', marginBottom: 12 },
  flameIconBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appTitle: { fontSize: 25, fontWeight: '800', textAlign: 'center' },
  appSubtitle: { fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 20 },
  formContainer: { width: '100%' },
  inputWrapper: { marginBottom: 12 },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  inlineInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  inlineTextInput: { flex: 1, paddingVertical: 11, fontSize: 14 },
  statusInlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 },
  inlineAvailableText: { fontSize: 12, fontWeight: '700' },
  inlineErrorText: { fontSize: 12, fontWeight: '700' },
  errorText: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    minHeight: 48,
  },
  codeFlag: { fontSize: 16 },
  codeText: { fontSize: 13.5, fontWeight: '700' },
  signUpBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  signUpBtnText: { fontSize: 15, fontWeight: '800' },
  footerContainer: { alignItems: 'center', marginTop: 20 },
  footerText: { fontSize: 13 },
  loginLinkText: { fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  modalHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  syncStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  syncStatusText: { fontSize: 13, fontWeight: '600' },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
  },
  countryItemText: { fontSize: 13.5, fontWeight: '600' },
});