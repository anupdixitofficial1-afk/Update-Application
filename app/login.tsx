import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Alert,
  DeviceEventEmitter,
  StatusBar,
  useColorScheme,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backend } from '../lib/backend';

const THEME_STORAGE_KEY = 'app_theme_mode_v1';
const THEME_CHANGED_EVENT = 'app-theme-changed';
const LAST_LOGIN_ID_KEY = 'vibesphere_last_login_id_v1';

type ThemeMode = 'light' | 'dark' | 'system';
type IdentifierType = 'email' | 'phone' | 'username';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function detectIdentifierType(raw: string): IdentifierType {
  const clean = raw.trim();
  if (EMAIL_REGEX.test(clean.toLowerCase())) return 'email';
  const compact = clean.replace(/[\s\-()]/g, '');
  if (/^\+?\d{6,15}$/.test(compact)) return 'phone';
  return 'username';
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
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

    AsyncStorage.getItem(LAST_LOGIN_ID_KEY)
      .then((savedId) => {
        if (savedId) setIdentifier(savedId);
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

  const [identifier, setIdentifier] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [identifierError, setIdentifierError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const idType = useMemo(() => detectIdentifierType(identifier), [identifier]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleLogin = async () => {
    if (submitting) return;
    Keyboard.dismiss();
    setFormError(null);

    const trimmedId = identifier.trim();
    let invalid = false;

    if (!trimmedId) {
      setIdentifierError('Enter your email, @username, or mobile number.');
      invalid = true;
    } else {
      setIdentifierError(null);
    }

    if (!password) {
      setPasswordError('Enter your password.');
      invalid = true;
    } else {
      setPasswordError(null);
    }

    if (invalid) return;

    setSubmitting(true);
    try {
      const user = await backend.auth.signInWithIdentifier(
        trimmedId,
        password,
        countryCode
      );

      await AsyncStorage.setItem(LAST_LOGIN_ID_KEY, trimmedId).catch(() => {});

      const needsOnboarding = !user.isProfileCompleted;
      router.replace(needsOnboarding ? '/(tabs)/profile' : '/(tabs)');
    } catch (err: any) {
      const msg = String(err?.message || 'Unable to sign in right now.');
      if (
        msg.toLowerCase().includes('no account') ||
        msg.toLowerCase().includes('valid email')
      ) {
        setIdentifierError(msg);
      } else {
        setFormError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openResetSheet = () => {
    const current = identifier.trim().toLowerCase();
    setResetEmail(EMAIL_REGEX.test(current) ? current : '');
    setResetError(null);
    setResetSuccess(null);
    setForgotOpen(true);
  };

  const handleSendReset = async () => {
    if (sendingReset || cooldown > 0) return;

    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setResetError('Enter a valid email address.');
      return;
    }

    setResetError(null);
    setResetSuccess(null);
    setSendingReset(true);

    try {
      await backend.auth.sendPasswordReset(cleanEmail);

      setCooldown(60);
      setResetSuccess('Reset link sent. Check your inbox and spam folder.');
      Alert.alert('Reset Link Sent', 'Check your email to reset your password.');
    } catch (err: any) {
      const msg = String(err?.message || 'Something went wrong.');
      const lower = msg.toLowerCase();
      if (lower.includes('rate limit') || lower.includes('too many')) {
        setCooldown(60);
        setResetError('Too many requests. Wait 60s before trying again.');
      } else {
        setResetError(msg);
      }
    } finally {
      setSendingReset(false);
    }
  };

  const idIconName =
    idType === 'phone'
      ? 'call-outline'
      : idType === 'username'
        ? 'at-outline'
        : 'mail-outline';

  const showDialPrefix = idType === 'phone' && !identifier.trim().startsWith('+');

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.contentWrap}>
          {/* Brand Mark */}
          <View
            style={[
              styles.brandBadge,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <MaterialCommunityIcons name="fire" size={28} color={colors.emerald} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Welcome back</Text>
          <Text style={[styles.subtitle, { color: colors.subtext }]}>
            Sign in with your email, @username, or mobile number
          </Text>

          {/* Identifier Field */}
          <View style={styles.fieldGroup}>
            <View style={styles.rowGap}>
              {showDialPrefix && (
                <TextInput
                  style={[
                    styles.dialBox,
                    {
                      backgroundColor: colors.surface,
                      borderColor: identifierError ? colors.danger : colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={countryCode}
                  onChangeText={(val) =>
                    setCountryCode(
                      val.startsWith('+') ? val : `+${val.replace(/\D/g, '')}`
                    )
                  }
                  keyboardType="phone-pad"
                  maxLength={5}
                />
              )}

              <View
                style={[
                  styles.inputShell,
                  { flex: 1 },
                  {
                    backgroundColor: identifierError
                      ? colors.dangerSoft
                      : colors.surface,
                    borderColor: identifierError ? colors.danger : colors.border,
                  },
                ]}
              >
                <Ionicons name={idIconName} size={18} color={colors.subtext} />
                <TextInput
                  style={[styles.inputText, { color: colors.text }]}
                  value={identifier}
                  onChangeText={(val) => {
                    setIdentifier(val);
                    if (identifierError) setIdentifierError(null);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Email, @username, or mobile number"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
            {identifierError ? (
              <Text style={[styles.errText, { color: colors.danger }]}>
                {identifierError}
              </Text>
            ) : null}
          </View>

          {/* Password Field */}
          <View style={styles.fieldGroup}>
            <View
              style={[
                styles.inputShell,
                {
                  backgroundColor: passwordError
                    ? colors.dangerSoft
                    : colors.surface,
                  borderColor: passwordError ? colors.danger : colors.border,
                },
              ]}
            >
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={colors.subtext}
              />
              <TextInput
                style={[styles.inputText, { color: colors.text }]}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (passwordError) setPasswordError(null);
                  if (formError) setFormError(null);
                }}
                placeholder="Password"
                placeholderTextColor={colors.subtext}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowPassword((prev) => !prev)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={19}
                  color={colors.subtext}
                />
              </TouchableOpacity>
            </View>
            {passwordError ? (
              <Text style={[styles.errText, { color: colors.danger }]}>
                {passwordError}
              </Text>
            ) : null}
          </View>

          {/* Forgot Password */}
          <TouchableOpacity
            style={styles.forgotBtn}
            onPress={openResetSheet}
            activeOpacity={0.75}
          >
            <Text style={[styles.forgotText, { color: colors.text }]}>
              Forgot password?
            </Text>
          </TouchableOpacity>

          {formError ? (
            <Text
              style={[
                styles.errText,
                { color: colors.danger, marginBottom: 12 },
              ]}
            >
              {formError}
            </Text>
          ) : null}

          {/* Primary Action */}
          <TouchableOpacity
            style={[
              styles.submitBtn,
              { backgroundColor: colors.accent },
              submitting && { opacity: 0.7 },
            ]}
            onPress={() => void handleLogin()}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text
                style={[styles.submitBtnText, { color: colors.accentText }]}
              >
                Log In
              </Text>
            )}
          </TouchableOpacity>

          {/* Sign Up Footer */}
          <View style={styles.footer}>
            <Text style={[styles.footerMuted, { color: colors.subtext }]}>
              New to VibeSphere?{' '}
              <Text
                style={[styles.footerAction, { color: colors.text }]}
                onPress={() => router.replace('/signup')}
              >
                Create account
              </Text>
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* RESET PASSWORD SHEET */}
      <Modal
        visible={forgotOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!sendingReset) setForgotOpen(false);
        }}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => !sendingReset && setForgotOpen(false)}
          />
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 20) + 10,
              },
            ]}
          >
            <View
              style={[styles.sheetHandle, { backgroundColor: colors.border }]}
            />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                Reset password
              </Text>
              <TouchableOpacity
                onPress={() => !sendingReset && setForgotOpen(false)}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.sheetSub, { color: colors.subtext }]}>
              Enter your registered email to receive a reset link.
            </Text>

            <View
              style={[
                styles.inputShell,
                {
                  backgroundColor: colors.surface,
                  borderColor: resetError ? colors.danger : colors.border,
                  marginBottom: 10,
                },
              ]}
            >
              <Ionicons name="mail-outline" size={18} color={colors.subtext} />
              <TextInput
                style={[styles.inputText, { color: colors.text }]}
                value={resetEmail}
                onChangeText={(val) => {
                  setResetEmail(val);
                  if (resetError) setResetError(null);
                  if (resetSuccess) setResetSuccess(null);
                }}
                placeholder="you@example.com"
                placeholderTextColor={colors.subtext}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {resetError ? (
              <Text
                style={[
                  styles.errText,
                  { color: colors.danger, marginBottom: 10 },
                ]}
              >
                {resetError}
              </Text>
            ) : null}

            {resetSuccess ? (
              <Text
                style={[
                  styles.okText,
                  { color: colors.emerald, marginBottom: 10 },
                ]}
              >
                {resetSuccess}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: colors.accent },
                (sendingReset || cooldown > 0) && { opacity: 0.7 },
              ]}
              onPress={() => void handleSendReset()}
              activeOpacity={0.85}
              disabled={sendingReset || cooldown > 0}
            >
              {sendingReset ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text
                  style={[styles.submitBtnText, { color: colors.accentText }]}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send Reset Link'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboardWrap: { flex: 1 },
  contentWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    borderWidth: 1,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
    lineHeight: 19,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  rowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dialBox: {
    width: 66,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    gap: 10,
  },
  inputText: {
    flex: 1,
    fontSize: 14.5,
    paddingVertical: 11,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: 16,
  },
  forgotText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  errText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 5,
    paddingLeft: 2,
  },
  okText: {
    fontSize: 12,
    fontWeight: '700',
    paddingLeft: 2,
  },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
  footer: {
    marginTop: 22,
    alignItems: 'center',
  },
  footerMuted: {
    fontSize: 13.5,
  },
  footerAction: {
    fontWeight: '800',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.52)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  sheetSub: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
});