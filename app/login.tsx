import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Forgot Password Modal States
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailError, setResetEmailError] = useState<string | null>(null);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const interval = setInterval(() => {
      setResetCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resetCooldown]);

  const handleSignIn = async () => {
    if (submitting) return;

    Keyboard.dismiss();
    setFormError(null);

    const trimmedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    let hasError = false;

    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setEmailError('Enter a valid email address.');
      hasError = true;
    } else {
      setEmailError(null);
    }

    if (!password) {
      setPasswordError('Password is required.');
      hasError = true;
    } else {
      setPasswordError(null);
    }

    if (hasError) return;

    setSubmitting(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error || !data.user) {
        setFormError(error?.message || 'Invalid email or password.');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('is_profile_completed')
        .eq('id', data.user.id)
        .maybeSingle();

      const isFirstTimeSignIn =
        profileError || !profile || profile.is_profile_completed !== true;

      if (isFirstTimeSignIn) {
        router.replace('/(tabs)/profile');
      } else {
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      setFormError(err?.message || 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const openForgotPasswordModal = () => {
    setResetEmail(email.trim().toLowerCase());
    setResetEmailError(null);
    setResetSuccessMsg(null);
    setForgotModalOpen(true);
  };

  const handleSendResetLink = async () => {
    if (sendingReset || resetCooldown > 0) return;

    const trimmed = resetEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!trimmed || !emailRegex.test(trimmed)) {
      setResetEmailError('Enter a valid registered email address.');
      return;
    }

    setResetEmailError(null);
    setResetSuccessMsg(null);
    setSendingReset(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: 'vibesphere://reset-password',
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('rate limit') || msg.includes('too many requests')) {
          setResetCooldown(60);
          setResetEmailError(
            'Too many reset requests sent. Please wait 60 seconds and try again.'
          );
        } else {
          setResetEmailError(error.message || 'Unable to send reset link.');
        }
        return;
      }

      setResetCooldown(60);
      setResetSuccessMsg(
        'Password reset link sent to your email. Please check your inbox and spam folder.'
      );
      Alert.alert(
        'Reset Link Sent',
        'Check your email to reset your password.'
      );
    } catch (err: any) {
      setResetEmailError(
        err?.message || 'Something went wrong. Please try again.'
      );
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
      >
        {/* LOGO ICON BOX */}
        <View style={styles.logoContainer}>
          <View style={styles.flameIconBox}>
            <MaterialCommunityIcons name="fire" size={32} color="#0f172a" />
          </View>
        </View>

        {/* APP TITLE & TAGLINE */}
        <Text style={styles.appTitle}>VibeSphere</Text>
        <Text style={styles.appSubtitle}>
          Sign in to continue with your account.
        </Text>

        {/* FORM CONTAINER */}
        <View style={styles.formContainer}>
          {/* EMAIL */}
          <View style={styles.inputWrapper}>
            <TextInput
              style={[
                styles.textInput,
                emailError ? styles.inputError : null,
              ]}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (emailError) setEmailError(null);
                if (formError) setFormError(null);
              }}
              placeholder="Enter your email"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {emailError ? (
              <Text style={styles.errorText}>{emailError}</Text>
            ) : null}
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
                  if (formError) setFormError(null);
                }}
                secureTextEntry={!showPassword}
                placeholder="Enter your password"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowPassword((prev) => !prev)}
              >
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

          {/* FORGOT PASSWORD LINK */}
          <View style={styles.forgotRow}>
            <TouchableOpacity
              onPress={openForgotPasswordModal}
              activeOpacity={0.75}
            >
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          {formError ? (
            <Text style={styles.errorText}>{formError}</Text>
          ) : null}

          {/* SIGN IN BUTTON */}
          <TouchableOpacity
            style={[styles.loginBtn, submitting && { opacity: 0.7 }]}
            onPress={handleSignIn}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.loginBtnText}>Log In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* FOOTER SIGN UP LINK */}
        <View style={styles.footerContainer}>
          <Text style={styles.footerText}>
            Don&apos;t have an account?{' '}
            <Text
              style={styles.signUpLinkText}
              onPress={() => router.replace('/signup')}
            >
              Create Account
            </Text>
          </Text>
        </View>
      </KeyboardAvoidingView>

      {/* FORGOT PASSWORD MODAL */}
      <Modal
        visible={forgotModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => !sendingReset && setForgotModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reset Password</Text>
              <TouchableOpacity
                onPress={() => !sendingReset && setForgotModalOpen(false)}
              >
                <Ionicons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Enter your registered email address and we will send you a
              password reset link.
            </Text>

            <TextInput
              style={[
                styles.textInput,
                resetEmailError ? styles.inputError : null,
              ]}
              value={resetEmail}
              onChangeText={(text) => {
                setResetEmail(text);
                if (resetEmailError) setResetEmailError(null);
                if (resetSuccessMsg) setResetSuccessMsg(null);
              }}
              placeholder="Enter your email address"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {resetEmailError ? (
              <Text style={styles.errorText}>{resetEmailError}</Text>
            ) : null}

            {resetSuccessMsg ? (
              <Text style={styles.successText}>{resetSuccessMsg}</Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.loginBtn,
                (sendingReset || resetCooldown > 0) && { opacity: 0.7 },
              ]}
              onPress={handleSendResetLink}
              activeOpacity={0.85}
              disabled={sendingReset || resetCooldown > 0}
            >
              {sendingReset ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.loginBtnText}>
                  {resetCooldown > 0
                    ? `Resend in ${resetCooldown}s`
                    : 'Send Reset Link'}
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
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  keyboardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 14,
  },
  flameIconBox: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#34d399',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  appSubtitle: {
    fontSize: 12.5,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 26,
    fontWeight: '500',
  },
  formContainer: {
    width: '100%',
    maxWidth: 360,
  },
  inputWrapper: {
    marginBottom: 14,
  },
  textInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 13,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  inlineInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  inlineTextInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    paddingVertical: 0,
  },
  inputError: {
    borderColor: '#ef4444',
    backgroundColor: '#fef2f2',
  },
  forgotRow: {
    alignItems: 'flex-end',
    marginBottom: 14,
    marginTop: -4,
  },
  forgotPasswordText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10b981',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 5,
    paddingLeft: 2,
  },
  successText: {
    color: '#10b981',
    fontSize: 11.5,
    fontWeight: '700',
    marginTop: 6,
    paddingLeft: 2,
  },
  loginBtn: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  footerContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: '500',
  },
  signUpLinkText: {
    color: '#10b981',
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 12.5,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 14,
  },
});