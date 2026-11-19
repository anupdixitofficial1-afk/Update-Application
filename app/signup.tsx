import React, { useEffect, useRef, useState } from 'react';
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
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { supabase } from '../lib/supabase';

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
  const high1 = 0xd83c;
  const low1 = 0xdde6 + (c1 - 65);
  const high2 = 0xd83c;
  const low2 = 0xdde6 + (c2 - 65);
  return (
    String.fromCharCode(high1, low1) + String.fromCharCode(high2, low2)
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
      if (suf) {
        cleanSuffixes.push(suf);
      }
    }

    let dialCodes: string[] = [];

    if (!cleanRoot) {
      dialCodes = [''];
    } else if (cleanSuffixes.length === 0) {
      dialCodes = [cleanRoot];
    } else if (
      cleanRoot === '+1' ||
      cleanRoot === '+7' ||
      cleanSuffixes.length > 12
    ) {
      dialCodes = [cleanRoot];
    } else {
      for (let j = 0; j < cleanSuffixes.length; j++) {
        const suf = cleanSuffixes[j];
        const combined = suf.startsWith('+')
          ? suf
          : `${cleanRoot}${suf}`;
        if (dialCodes.indexOf(combined) === -1) {
          dialCodes.push(combined);
        }
      }
      if (dialCodes.length === 0) {
        dialCodes = [cleanRoot];
      }
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
    if (a.code < b.code) return -1;
    if (a.code > b.code) return 1;
    return 0;
  });

  if (parsed.length > 0) {
    cachedOnlineCountries = parsed;
  }

  return parsed;
};

const sanitizeUsernameOnly = (raw: string): string => {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]/g, '');
};

const formatHandleUsername = (cleanUsername: string): string => {
  return cleanUsername ? `@${cleanUsername}` : '';
};

const sanitizeMobileDigits = (raw: string): string => {
  return raw.replace(/\D/g, '');
};

type ActiveField = 'fullName' | 'username' | 'mobile' | 'email' | 'password' | null;

export default function SignUpScreen() {
  const scrollViewRef = useRef<ScrollView>(null);

  const [fullName, setFullName] = useState('');
  const [fullNameError, setFullNameError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailAvailableMsg, setEmailAvailableMsg] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameAvailableMsg, setUsernameAvailableMsg] = useState<string | null>(null);
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
    if (forceRefresh) {
      cachedOnlineCountries = null;
    }

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
      setCountrySyncError(err?.message || 'Failed to sync country codes online.');
    } finally {
      setSyncingCountries(false);
    }
  };

  useEffect(() => {
    syncCountries(false);
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });

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

  // Live debounced username availability check while typing (minimum 6 characters)
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
        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .or(`username.ilike.${clean},username.ilike.@${clean}`)
          .limit(1);

        if (!active) return;

        if (error) {
          setUsernameAvailableMsg(null);
          setUsernameError('Check failed');
          return;
        }

        if (data && data.length > 0) {
          setUsernameAvailableMsg(null);
          setUsernameError('Taken');
        } else {
          setUsernameError(null);
          setUsernameAvailableMsg('Available');
        }
      } catch {
        if (!active) return;
        setUsernameAvailableMsg(null);
        setUsernameError('Check failed');
      } finally {
        if (active) {
          setCheckingUsername(false);
        }
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username]);

  // Live debounced email availability check while typing
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!trimmed) {
      setEmailAvailableMsg(null);
      setEmailError(null);
      setCheckingEmail(false);
      return;
    }

    if (!emailRegex.test(trimmed)) {
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
        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', trimmed)
          .limit(1);

        if (!active) return;

        if (error) {
          setEmailAvailableMsg(null);
          setEmailError('Check failed');
          return;
        }

        if (data && data.length > 0) {
          setEmailAvailableMsg(null);
          setEmailError('Already used');
        } else {
          setEmailError(null);
          setEmailAvailableMsg('Available');
        }
      } catch {
        if (!active) return;
        setEmailAvailableMsg(null);
        setEmailError('Check failed');
      } finally {
        if (active) {
          setCheckingEmail(false);
        }
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

    if (
      digits.length < country.minDigits ||
      digits.length > country.maxDigits
    ) {
      setMobileError(
        country.minDigits === country.maxDigits
          ? `Enter a valid ${country.minDigits}-digit mobile number for ${country.country}.`
          : `Enter a valid ${country.minDigits}–${country.maxDigits} digit mobile number.`
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
    const isFormatValid = validateMobile(digitsRaw, country);
    if (!isFormatValid) return false;

    const digits = sanitizeMobileDigits(digitsRaw);
    const fullPhone = `${country.code}${digits}`;

    setCheckingMobile(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .or(`phone.eq.${fullPhone},mobile_number.eq.${digits}`)
        .limit(1);

      if (error) {
        return true;
      }

      if (data && data.length > 0) {
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

  const checkUsernameAvailability = async (
    rawValue: string
  ): Promise<boolean> => {
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
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .or(`username.ilike.${clean},username.ilike.@${clean}`)
        .limit(1);

      if (error) {
        setUsernameAvailableMsg(null);
        setUsernameError('Check failed');
        return false;
      }

      if (data && data.length > 0) {
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

  const checkEmailAvailability = async (
    rawEmail: string
  ): Promise<boolean> => {
    const trimmed = rawEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(trimmed)) {
      setEmailAvailableMsg(null);
      setEmailError('Invalid email');
      return false;
    }

    setCheckingEmail(true);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', trimmed)
        .limit(1);

      if (error) {
        setEmailAvailableMsg(null);
        setEmailError('Check failed');
        return false;
      }

      if (data && data.length > 0) {
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
    const formattedHandle = formatHandleUsername(cleanUser);
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

    const isPhoneFormatValid = validateMobile(cleanDigits, selectedCountry);
    if (!isPhoneFormatValid) {
      hasClientError = true;
    }

    if (hasClientError) return;

    setSubmitting(true);

    try {
      const isUserValid = await checkUsernameAvailability(cleanUser);
      if (!isUserValid) return;

      const isEmailValid = await checkEmailAvailability(trimmedEmail);
      if (!isEmailValid) return;

      const isMobileAvailable = await checkMobileAvailability(
        cleanDigits,
        selectedCountry
      );
      if (!isMobileAvailable) return;

      const fullPhone = `${selectedCountry.code}${cleanDigits}`;

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: trimmedName,
            username: formattedHandle,
            email: trimmedEmail,
            country_code: selectedCountry.code,
            mobile_number: cleanDigits,
            phone: fullPhone,
          },
        },
      });

      if (error) {
        const msg = error.message.toLowerCase();

        if (
          msg.includes('already registered') ||
          msg.includes('already exists') ||
          msg.includes('email')
        ) {
          setEmailAvailableMsg(null);
          setEmailError('Already used');
          return;
        }

        if (msg.includes('username') || msg.includes('duplicate')) {
          setUsernameAvailableMsg(null);
          setUsernameError('Taken');
          return;
        }

        if (msg.includes('phone') || msg.includes('mobile')) {
          setMobileError('This mobile number is already registered.');
          return;
        }

        setFormError(error.message);
        return;
      }

      if (!data.user) {
        setFormError('Account creation failed. Please try again.');
        return;
      }

      if (data.session) {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert(
            {
              id: data.user.id,
              full_name: trimmedName,
              username: formattedHandle,
              email: trimmedEmail,
              country_code: selectedCountry.code,
              mobile_number: cleanDigits,
              phone: fullPhone,
            },
            { onConflict: 'id' }
          );

        if (profileError) {
          const pMsg = profileError.message.toLowerCase();
          if (pMsg.includes('username')) {
            setUsernameAvailableMsg(null);
            setUsernameError('Taken');
            return;
          }
          setFormError(profileError.message);
          return;
        }
      }

      router.replace('/login');
    } catch (error: any) {
      setFormError(
        error?.message || 'Something went wrong. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderRightAvailabilityStatus = (
    checking: boolean,
    availableMsg: string | null,
    errorMsg: string | null
  ) => {
    if (checking) {
      return <ActivityIndicator size="small" color="#10b981" />;
    }

    if (availableMsg) {
      return (
        <View style={styles.statusInlineRow}>
          <Ionicons name="checkmark-circle" size={15} color="#10b981" />
          <Text style={styles.inlineAvailableText}>{availableMsg}</Text>
        </View>
      );
    }

    if (errorMsg) {
      return (
        <View style={styles.statusInlineRow}>
          <Ionicons name="close-circle" size={15} color="#ef4444" />
          <Text style={styles.inlineErrorText}>{errorMsg}</Text>
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

  const shouldAvoidKeyboard = activeField === 'email' || activeField === 'password';

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

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
          {/* LOGO ICON BOX */}
          <View
            style={[
              styles.logoContainer,
              keyboardVisible && shouldAvoidKeyboard && styles.logoContainerCompact,
            ]}
          >
            <View style={styles.flameIconBox}>
              <MaterialCommunityIcons name="fire" size={32} color="#0f172a" />
            </View>
          </View>

          {/* APP TITLE & TAGLINE */}
          <Text style={styles.appTitle}>VibeSphere</Text>
          <Text
            style={[
              styles.appSubtitle,
              keyboardVisible && shouldAvoidKeyboard && styles.appSubtitleCompact,
            ]}
          >
            Instagram, YouTube & Facebook united with{'\n'}Dual Identity & Smart Video Mode.
          </Text>

          {/* FORM FIELDS CONTAINER */}
          <View style={styles.formContainer}>
            {/* FULL NAME */}
            <View style={styles.inputWrapper}>
              <TextInput
                style={[
                  styles.textInput,
                  fullNameError ? styles.inputError : null,
                ]}
                value={fullName}
                onChangeText={(text) => {
                  setFullName(text);
                  if (fullNameError) setFullNameError(null);
                }}
                onFocus={() => handleFocusField('fullName', false)}
                placeholder="Enter your full name"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
              />
              {fullNameError ? (
                <Text style={styles.errorText}>{fullNameError}</Text>
              ) : null}
            </View>

            {/* USERNAME */}
            <View style={styles.inputWrapper}>
              <View
                style={[
                  styles.inlineInputBox,
                  usernameError ? styles.inputError : null,
                  usernameAvailableMsg ? styles.inputAvailable : null,
                ]}
              >
                <TextInput
                  style={styles.inlineTextInput}
                  value={username}
                  onChangeText={(text) => {
                    setUsername(sanitizeUsernameOnly(text));
                    if (usernameError) setUsernameError(null);
                  }}
                  onFocus={() => handleFocusField('username', false)}
                  onBlur={() => {
                    if (username.trim()) {
                      checkUsernameAvailability(username);
                    }
                  }}
                  placeholder="Enter username (min 6 chars)"
                  placeholderTextColor="#94a3b8"
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
                    mobileError ? styles.inputError : null,
                  ]}
                  onPress={() => {
                    setCountryModalOpen(true);
                    if (countryCodes.length <= 1 && !syncingCountries) {
                      syncCountries(false);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.codeFlag}>{selectedCountry.flag}</Text>
                  <Text style={styles.codeText}>{selectedCountry.code}</Text>
                  {syncingCountries ? (
                    <ActivityIndicator size="small" color="#10b981" />
                  ) : (
                    <Ionicons name="chevron-down" size={14} color="#475569" />
                  )}
                </TouchableOpacity>

                <View
                  style={[
                    styles.inlineInputBox,
                    { flex: 1 },
                    mobileError ? styles.inputError : null,
                  ]}
                >
                  <TextInput
                    style={styles.inlineTextInput}
                    value={mobileNumber}
                    onChangeText={(text) => {
                      const digits = sanitizeMobileDigits(text);
                      setMobileNumber(digits);
                      if (mobileError) setMobileError(null);
                    }}
                    onFocus={() => handleFocusField('mobile', false)}
                    onBlur={() => {
                      if (mobileNumber.trim()) {
                        checkMobileAvailability(mobileNumber, selectedCountry);
                      }
                    }}
                    placeholder="Enter mobile number"
                    placeholderTextColor="#94a3b8"
                    keyboardType="phone-pad"
                    maxLength={selectedCountry.maxDigits}
                  />
                  {checkingMobile && (
                    <ActivityIndicator size="small" color="#10b981" />
                  )}
                </View>
              </View>
              {mobileError ? (
                <Text style={styles.errorText}>{mobileError}</Text>
              ) : null}
            </View>

            {/* EMAIL */}
            <View style={styles.inputWrapper}>
              <View
                style={[
                  styles.inlineInputBox,
                  emailError ? styles.inputError : null,
                  emailAvailableMsg ? styles.inputAvailable : null,
                ]}
              >
                <TextInput
                  style={styles.inlineTextInput}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (emailError) setEmailError(null);
                  }}
                  onFocus={() => handleFocusField('email', true)}
                  onBlur={() => {
                    if (email.trim()) {
                      checkEmailAvailability(email);
                    }
                  }}
                  placeholder="Enter your email"
                  placeholderTextColor="#94a3b8"
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
                  passwordError ? styles.inputError : null,
                ]}
              >
                <TextInput
                  style={styles.inlineTextInput}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (passwordError) setPasswordError(null);
                  }}
                  onFocus={() => handleFocusField('password', true)}
                  secureTextEntry={!showPassword}
                  placeholder="Enter password (min 6 characters)"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword((prev) => !prev)}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="#64748b"
                  />
                </TouchableOpacity>
              </View>
              {passwordError ? (
                <Text style={styles.errorText}>{passwordError}</Text>
              ) : null}
            </View>

            {formError ? (
              <Text style={styles.errorText}>{formError}</Text>
            ) : null}

            {/* CREATE ACCOUNT BUTTON */}
            <TouchableOpacity
              style={[styles.signUpBtn, submitting && { opacity: 0.7 }]}
              onPress={handleSignUp}
              activeOpacity={0.85}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.signUpBtnText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* FOOTER LOG IN LINK */}
          <View
            style={[
              styles.footerContainer,
              keyboardVisible && shouldAvoidKeyboard && styles.footerContainerCompact,
            ]}
          >
            <Text style={styles.footerText}>
              Already have an account?{' '}
              <Text
                style={styles.loginLinkText}
                onPress={() => router.replace('/login')}
              >
                Log In
              </Text>
            </Text>
          </View>

          {/* COUNTRY CODE SELECTOR MODAL */}
          <Modal
            visible={countryModalOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setCountryModalOpen(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Country Code</Text>
                  <View style={styles.modalHeaderActions}>
                    <TouchableOpacity
                      onPress={() => syncCountries(true)}
                      disabled={syncingCountries}
                      style={styles.refreshBtn}
                    >
                      <Ionicons
                        name="refresh"
                        size={18}
                        color={syncingCountries ? '#94a3b8' : '#10b981'}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setCountryModalOpen(false)}>
                      <Ionicons name="close" size={22} color="#0f172a" />
                    </TouchableOpacity>
                  </View>
                </View>

                <TextInput
                  style={[styles.textInput, { marginBottom: 10 }]}
                  value={countrySearch}
                  onChangeText={setCountrySearch}
                  placeholder="Search country or +91..."
                  placeholderTextColor="#94a3b8"
                />

                {syncingCountries ? (
                  <View style={styles.syncStatusBox}>
                    <ActivityIndicator size="small" color="#10b981" />
                    <Text style={styles.syncStatusText}>
                      Syncing country codes online...
                    </Text>
                  </View>
                ) : countrySyncError ? (
                  <View style={styles.syncStatusBox}>
                    <Text style={styles.errorText}>{countrySyncError}</Text>
                    <TouchableOpacity onPress={() => syncCountries(true)}>
                      <Text style={styles.retryText}>Retry Sync</Text>
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
                            isSelected && styles.countryItemSelected,
                          ]}
                          onPress={() => {
                            setSelectedCountry(item);
                            setCountryModalOpen(false);
                            setCountrySearch('');
                            if (mobileNumber.trim()) {
                              checkMobileAvailability(mobileNumber, item);
                            }
                          }}
                        >
                          <Text style={styles.countryItemText}>
                            {item.flag} {item.country} ({item.code || 'N/A'})
                          </Text>
                          {isSelected && (
                            <Ionicons
                              name="checkmark"
                              size={18}
                              color="#10b981"
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
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  scrollContainerCentered: {
    justifyContent: 'center',
  },
  scrollContainerKeyboardOpen: {
    justifyContent: 'flex-start',
    paddingTop: 12,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 14,
  },
  logoContainerCompact: {
    marginBottom: 8,
  },
  flameIconBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  appSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  appSubtitleCompact: {
    marginBottom: 12,
  },
  formContainer: {
    width: '100%',
  },
  inputWrapper: {
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
  },
  inlineInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  inlineTextInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0f172a',
  },
  inputError: {
    borderColor: '#ef4444',
    backgroundColor: '#fef2f2',
  },
  inputAvailable: {
    borderColor: '#10b981',
  },
  statusInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  inlineAvailableText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10b981',
  },
  inlineErrorText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ef4444',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
    marginTop: 4,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 10,
    minHeight: 48,
  },
  codeFlag: {
    fontSize: 16,
  },
  codeText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  signUpBtn: {
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  signUpBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  footerContainer: {
    alignItems: 'center',
    marginTop: 18,
  },
  footerContainerCompact: {
    marginTop: 12,
  },
  footerText: {
    fontSize: 13.5,
    color: '#64748b',
  },
  loginLinkText: {
    color: '#10b981',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  refreshBtn: {
    padding: 4,
  },
  syncStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  syncStatusText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  retryText: {
    fontSize: 13,
    color: '#10b981',
    fontWeight: '700',
    marginLeft: 8,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  countryItemSelected: {
    backgroundColor: '#ecfdf5',
    borderRadius: 8,
  },
  countryItemText: {
    fontSize: 13.5,
    color: '#0f172a',
    fontWeight: '500',
  },
});