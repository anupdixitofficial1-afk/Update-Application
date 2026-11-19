import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { supabase } from '../lib/supabase'; // apne supabase client path ke mutabik adjust karein

type PrivacyLevel = 'all' | 'followers' | 'none';

interface PrivacySettingsPayload {
  profileVisibilityEnabled: boolean;
  bio: PrivacyLevel;
  location: PrivacyLevel;
  gender: PrivacyLevel;
  followers: PrivacyLevel;
  dobDay: PrivacyLevel;
  dobMonth: PrivacyLevel;
  dobYear: PrivacyLevel;
}

export default function SettingsScreen() {
  // Notification States
  const [pushNotifications, setPushNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(false);
  const [directMessages, setDirectMessages] = useState(true);

  // Master Privacy Toggle + Granular Privacy States
  const [profileVisibilityEnabled, setProfileVisibilityEnabled] = useState(true);
  const [bioPrivacy, setBioPrivacy] = useState<PrivacyLevel>('all');
  const [locationPrivacy, setLocationPrivacy] = useState<PrivacyLevel>('all');
  const [genderPrivacy, setGenderPrivacy] = useState<PrivacyLevel>('all');
  const [followersPrivacy, setFollowersPrivacy] = useState<PrivacyLevel>('all');
  const [dobDayPrivacy, setDobDayPrivacy] = useState<PrivacyLevel>('all');
  const [dobMonthPrivacy, setDobMonthPrivacy] = useState<PrivacyLevel>('all');
  const [dobYearPrivacy, setDobYearPrivacy] = useState<PrivacyLevel>('all');
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  // Modals States
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [blockedUsersList, setBlockedUsersList] = useState([
    { id: '1', name: 'Alex_Dev', handle: '@alex_dev' },
    { id: '2', name: 'SpamAccount99', handle: '@spam99' },
  ]);

  useEffect(() => {
    loadPrivacyFromSupabase();
  }, []);

  const persistPrivacySettings = async (nextPayload: PrivacySettingsPayload) => {
    try {
      setSavingPrivacy(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { error } = await supabase
        .from('profiles')
        .update({ privacy_settings: nextPayload })
        .eq('id', session.user.id);

      if (error) {
        console.error('Privacy save error:', error.message);
      }
    } finally {
      setSavingPrivacy(false);
    }
  };

  const buildCurrentPayload = (overrides?: Partial<PrivacySettingsPayload>): PrivacySettingsPayload => ({
    profileVisibilityEnabled,
    bio: bioPrivacy,
    location: locationPrivacy,
    gender: genderPrivacy,
    followers: followersPrivacy,
    dobDay: dobDayPrivacy,
    dobMonth: dobMonthPrivacy,
    dobYear: dobYearPrivacy,
    ...overrides,
  });

  const loadPrivacyFromSupabase = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('privacy_settings')
        .eq('id', session.user.id)
        .single();

      if (!error && data?.privacy_settings) {
        const p = data.privacy_settings as Partial<PrivacySettingsPayload>;
        if (typeof p.profileVisibilityEnabled === 'boolean') {
          setProfileVisibilityEnabled(p.profileVisibilityEnabled);
        }
        if (p.bio) setBioPrivacy(p.bio);
        if (p.location) setLocationPrivacy(p.location);
        if (p.gender) setGenderPrivacy(p.gender);
        if (p.followers) setFollowersPrivacy(p.followers);
        if (p.dobDay) setDobDayPrivacy(p.dobDay);
        if (p.dobMonth) setDobMonthPrivacy(p.dobMonth);
        if (p.dobYear) setDobYearPrivacy(p.dobYear);
      }
    } catch (err) {
      console.error('Load privacy error:', err);
    }
  };

  const handleToggleMasterVisibility = async (enabled: boolean) => {
    setProfileVisibilityEnabled(enabled);

    // Jab master visibility OFF ho toh sab 'none' (private), aur ON ho toh 'all'
    const targetLevel: PrivacyLevel = enabled ? 'all' : 'none';
    setBioPrivacy(targetLevel);
    setLocationPrivacy(targetLevel);
    setGenderPrivacy(targetLevel);
    setFollowersPrivacy(targetLevel);
    setDobDayPrivacy(targetLevel);
    setDobMonthPrivacy(targetLevel);
    setDobYearPrivacy(targetLevel);

    await persistPrivacySettings(
      buildCurrentPayload({
        profileVisibilityEnabled: enabled,
        bio: targetLevel,
        location: targetLevel,
        gender: targetLevel,
        followers: targetLevel,
        dobDay: targetLevel,
        dobMonth: targetLevel,
        dobYear: targetLevel,
      })
    );
  };

  const handleSelectPrivacyLevel = async (
    key: keyof Omit<PrivacySettingsPayload, 'profileVisibilityEnabled'>,
    level: PrivacyLevel
  ) => {
    if (!profileVisibilityEnabled) return;

    if (key === 'bio') setBioPrivacy(level);
    if (key === 'location') setLocationPrivacy(level);
    if (key === 'gender') setGenderPrivacy(level);
    if (key === 'followers') setFollowersPrivacy(level);
    if (key === 'dobDay') setDobDayPrivacy(level);
    if (key === 'dobMonth') setDobMonthPrivacy(level);
    if (key === 'dobYear') setDobYearPrivacy(level);

    await persistPrivacySettings(
      buildCurrentPayload({
        [key]: level,
      })
    );
  };

  const renderPrivacyButtons = (
    currentValue: PrivacyLevel,
    onSelect: (level: PrivacyLevel) => void
  ) => (
    <View style={[styles.segmentedControl, !profileVisibilityEnabled && { opacity: 0.45 }]}>
      {(['all', 'followers', 'none'] as PrivacyLevel[]).map((level) => {
        const isActive = currentValue === level;
        return (
          <TouchableOpacity
            key={level}
            disabled={!profileVisibilityEnabled || savingPrivacy}
            style={[styles.segmentBtn, isActive && styles.activeSegmentBtn]}
            onPress={() => onSelect(level)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={level === 'all' ? 'globe-outline' : level === 'followers' ? 'people-outline' : 'lock-closed-outline'}
              size={14}
              color={isActive ? '#ffffff' : '#64748b'}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const handleUpdatePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match.');
      return;
    }
    Alert.alert('Success', 'Password changed successfully!');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setIsPasswordModalOpen(false);
  };

  const handleUnblockUser = (id: string, name: string) => {
    Alert.alert(
      'Unblock User',
      `Are you sure you want to unblock ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () => {
            setBlockedUsersList(blockedUsersList.filter(user => user.id !== id));
          },
        },
      ]
    );
  };

  const handleDeactivateAccount = () => {
    Alert.alert(
      'Deactivate Account',
      'Your account will be temporarily disabled. You can reactivate anytime by logging back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Deactivated', 'Your account has been deactivated.');
            router.replace('/login');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings & Privacy</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* SECTION 1: ACCOUNT & SECURITY */}
        <Text style={styles.sectionHeader}>ACCOUNT & SECURITY</Text>

        <View style={styles.cardContainer}>
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={() => setIsPasswordModalOpen(true)}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#e6f7f0' }]}>
                <Ionicons name="key-outline" size={17} color="#059669" />
              </View>
              <Text style={styles.menuText}>Change Password</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* PRIVACY & VISIBILITY MAIN ROW */}
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={() => setIsPrivacyModalOpen(true)}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#e0f2fe' }]}>
                <Ionicons name="shield-checkmark-outline" size={17} color="#0284c7" />
              </View>
              <Text style={styles.menuText}>Privacy & Visibility</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={() => setIsBlockedModalOpen(true)}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#fee2e2' }]}>
                <Ionicons name="ban-outline" size={17} color="#ef4444" />
              </View>
              <Text style={styles.menuText}>Blocked Users</Text>
            </View>
            <View style={styles.badgeCountBox}>
              <Text style={styles.badgeCountText}>{blockedUsersList.length}</Text>
              <Ionicons name="chevron-forward" size={16} color="#94a3b8" style={{ marginLeft: 4 }} />
            </View>
          </TouchableOpacity>
        </View>

        {/* SECTION 2: NOTIFICATIONS */}
        <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>

        <View style={styles.cardContainer}>
          <View style={styles.menuRow}>
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#f3e8ff' }]}>
                <Ionicons name="notifications-outline" size={17} color="#9333ea" />
              </View>
              <Text style={styles.menuText}>Push Notifications</Text>
            </View>
            <Switch
              value={pushNotifications}
              onValueChange={setPushNotifications}
              trackColor={{ false: '#cbd5e1', true: '#34d399' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.menuRow}>
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#dbeafe' }]}>
                <Ionicons name="mail-outline" size={17} color="#2563eb" />
              </View>
              <Text style={styles.menuText}>Email Digest & Alerts</Text>
            </View>
            <Switch
              value={emailAlerts}
              onValueChange={setEmailAlerts}
              trackColor={{ false: '#cbd5e1', true: '#34d399' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.menuRow}>
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#fef3c7' }]}>
                <Ionicons name="chatbubbles-outline" size={17} color="#d97706" />
              </View>
              <Text style={styles.menuText}>Direct Messages Alerts</Text>
            </View>
            <Switch
              value={directMessages}
              onValueChange={setDirectMessages}
              trackColor={{ false: '#cbd5e1', true: '#34d399' }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* SECTION 3: ACCOUNT MANAGEMENT */}
        <Text style={styles.sectionHeader}>ACCOUNT MANAGEMENT</Text>

        <View style={styles.cardContainer}>
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={handleDeactivateAccount}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#ffedd5' }]}>
                <MaterialCommunityIcons name="account-off-outline" size={18} color="#c2410c" />
              </View>
              <Text style={[styles.menuText, { color: '#c2410c' }]}>Deactivate Account</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* PRIVACY & VISIBILITY MODAL */}
      <Modal visible={isPrivacyModalOpen} transparent={true} animationType="slide" onRequestClose={() => setIsPrivacyModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setIsPrivacyModalOpen(false)} />
          <View style={[styles.bottomSheet, { maxHeight: '85%' }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Privacy & Visibility</Text>
                <Text style={styles.sheetSubTitle}>
                  {profileVisibilityEnabled
                    ? 'Control who views your profile information'
                    : 'Visibility controls are OFF (all fields hidden)'}
                </Text>
              </View>
              {savingPrivacy && <ActivityIndicator size="small" color="#059669" style={{ marginRight: 10 }} />}
              <TouchableOpacity onPress={() => setIsPrivacyModalOpen(false)}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* MASTER ON/OFF SWITCH FOR VISIBILITY */}
            <View style={styles.masterToggleRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.privacyRowTitle}>Profile Visibility</Text>
                <Text style={styles.masterToggleSub}>
                  {profileVisibilityEnabled ? 'Enabled — customize individual fields below' : 'Disabled — turn on to edit field visibility'}
                </Text>
              </View>
              <Switch
                value={profileVisibilityEnabled}
                onValueChange={handleToggleMasterVisibility}
                trackColor={{ false: '#cbd5e1', true: '#34d399' }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={styles.dividerFull} />

            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                { key: 'bio' as const, title: 'Bio Visibility', value: bioPrivacy },
                { key: 'location' as const, title: 'Location Visibility', value: locationPrivacy },
                { key: 'gender' as const, title: 'Gender Visibility', value: genderPrivacy },
                { key: 'followers' as const, title: 'Followers / Following', value: followersPrivacy },
              ].map((item) => (
                <React.Fragment key={item.key}>
                  <View style={styles.privacyRow}>
                    <Text style={[styles.privacyRowTitle, !profileVisibilityEnabled && { color: '#94a3b8' }]}>
                      {item.title}
                    </Text>
                    {renderPrivacyButtons(item.value, (level) => handleSelectPrivacyLevel(item.key, level))}
                  </View>
                  <View style={styles.dividerFull} />
                </React.Fragment>
              ))}

              {/* DATE OF BIRTH VISIBILITY */}
              <View style={{ paddingVertical: 8 }}>
                <Text style={[styles.privacyRowTitle, !profileVisibilityEnabled && { color: '#94a3b8' }]}>
                  Date of Birth Visibility
                </Text>

                <View style={styles.dobSubRow}>
                  <Text style={styles.dobSubLabel}>• Date (Day)</Text>
                  {renderPrivacyButtons(dobDayPrivacy, (level) => handleSelectPrivacyLevel('dobDay', level))}
                </View>

                <View style={styles.dobSubRow}>
                  <Text style={styles.dobSubLabel}>• Month</Text>
                  {renderPrivacyButtons(dobMonthPrivacy, (level) => handleSelectPrivacyLevel('dobMonth', level))}
                </View>

                <View style={[styles.dobSubRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.dobSubLabel}>• Year</Text>
                  {renderPrivacyButtons(dobYearPrivacy, (level) => handleSelectPrivacyLevel('dobYear', level))}
                </View>
              </View>
            </ScrollView>

            <TouchableOpacity style={styles.actionBtn} onPress={() => setIsPrivacyModalOpen(false)} activeOpacity={0.85}>
              <Text style={styles.actionBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* CHANGE PASSWORD MODAL */}
      <Modal visible={isPasswordModalOpen} transparent={true} animationType="slide" onRequestClose={() => setIsPasswordModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setIsPasswordModalOpen(false)} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setIsPasswordModalOpen(false)}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>CURRENT PASSWORD</Text>
            <TextInput
              style={styles.textInput}
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              placeholderTextColor="#94a3b8"
            />

            <Text style={styles.inputLabel}>NEW PASSWORD</Text>
            <TextInput
              style={styles.textInput}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Enter new password"
              placeholderTextColor="#94a3b8"
            />

            <Text style={styles.inputLabel}>CONFIRM NEW PASSWORD</Text>
            <TextInput
              style={styles.textInput}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter new password"
              placeholderTextColor="#94a3b8"
            />

            <TouchableOpacity style={styles.actionBtn} onPress={handleUpdatePassword} activeOpacity={0.85}>
              <Text style={styles.actionBtnText}>Update Password</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* BLOCKED USERS MODAL */}
      <Modal visible={isBlockedModalOpen} transparent={true} animationType="slide" onRequestClose={() => setIsBlockedModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setIsBlockedModalOpen(false)} />
          <View style={[styles.bottomSheet, { maxHeight: '70%' }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Blocked Users</Text>
              <TouchableOpacity onPress={() => setIsBlockedModalOpen(false)}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {blockedUsersList.length === 0 ? (
                <Text style={styles.emptyText}>No blocked users found.</Text>
              ) : (
                blockedUsersList.map((user) => (
                  <View key={user.id} style={styles.blockedUserRow}>
                    <View>
                      <Text style={styles.blockedUserName}>{user.name}</Text>
                      <Text style={styles.blockedUserHandle}>{user.handle}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.unblockBtn}
                      onPress={() => handleUnblockUser(user.id, user.name)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.unblockBtnText}>Unblock</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f9f8' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  scrollContent: { padding: 16, paddingBottom: 40 },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 14,
    marginLeft: 4,
  },
  cardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuText: { fontSize: 13.5, fontWeight: '700', color: '#1e293b' },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginLeft: 58 },
  dividerFull: { height: 1, backgroundColor: '#f1f5f9' },
  badgeCountBox: { flexDirection: 'row', alignItems: 'center' },
  badgeCountText: { fontSize: 12, fontWeight: '700', color: '#64748b' },

  masterToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 4,
  },
  masterToggleSub: { fontSize: 11, color: '#64748b', marginTop: 2 },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  privacyRowTitle: { fontSize: 12.5, fontWeight: '700', color: '#1e293b' },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  segmentBtn: {
    width: 30,
    height: 26,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeSegmentBtn: {
    backgroundColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  dobSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 6,
  },
  dobSubLabel: { fontSize: 11.5, fontWeight: '600', color: '#475569', marginLeft: 4 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  bottomSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  sheetSubTitle: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '500' },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.8,
    marginBottom: 5,
    marginTop: 10,
  },
  textInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  actionBtn: {
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  actionBtnText: { fontSize: 13.5, fontWeight: '800', color: '#ffffff' },

  blockedUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  blockedUserName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  blockedUserHandle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  unblockBtn: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  unblockBtnText: { fontSize: 11.5, fontWeight: '700', color: '#ef4444' },
  emptyText: { textAlign: 'center', color: '#94a3b8', paddingVertical: 20, fontSize: 13 },
});