import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

export type LiveVisibility = 'public' | 'subscribers' | 'private';
export type SlowModeSec = 0 | 5 | 15;

export interface LiveStudioSettingsState {
  category: string;
  description: string;
  tagsText: string;
  visibility: LiveVisibility;
  autoRecordReplay: boolean;
  publishReplayToWatch: boolean;
  monetizeEnabled: boolean;
  chatEnabled: boolean;
  allowJoinRequests: boolean;
  slowModeSec: SlowModeSec;
}

export interface LiveGiftOption {
  id: string;
  emoji: string;
  label: string;
  amount: number;
  color: string;
}

export interface LiveSuperchatOption {
  id: string;
  badge: string;
  label: string;
  amount: number;
  color: string;
}

export interface LiveJoinRequestEntry {
  id: string;
  username: string;
}

export interface LivePresenceViewer {
  key: string;
  name: string;
  role: string;
}

const CATEGORIES = ['Live', 'Gaming', 'Music', 'Tech', 'Travel', 'Fitness', 'Chat'];
const SLOW_MODE_OPTIONS: SlowModeSec[] = [0, 5, 15];
const VISIBILITY_OPTIONS: { id: LiveVisibility; label: string }[] = [
  { id: 'public', label: 'Public' },
  { id: 'subscribers', label: 'Subscribers' },
  { id: 'private', label: 'Private' },
];

export const LIVE_GIFT_OPTIONS: LiveGiftOption[] = [
  { id: 'rose', emoji: '🌹', label: 'Rose', amount: 10, color: '#fb7185' },
  { id: 'heart', emoji: '💖', label: 'Spark Heart', amount: 25, color: '#f43f5e' },
  { id: 'crown', emoji: '👑', label: 'Creator Crown', amount: 100, color: '#fbbf24' },
  { id: 'rocket', emoji: '🚀', label: 'Hyper Rocket', amount: 250, color: '#38bdf8' },
];

export const LIVE_SUPERCHAT_OPTIONS: LiveSuperchatOption[] = [
  { id: 'sc-50', badge: '⭐', label: 'Shoutout', amount: 50, color: '#38bdf8' },
  { id: 'sc-199', badge: '🌟', label: 'Spotlight', amount: 199, color: '#a855f7' },
  { id: 'sc-499', badge: '💎', label: 'VIP Highlight', amount: 499, color: '#fbbf24' },
];

export function LiveStudioSettingsSheet({
  visible,
  isLiveStarted,
  titleText,
  onChangeTitle,
  onCommitLiveTitle,
  settings,
  onUpdateSettings,
  pinnedMessage,
  onPinCustomMessage,
  onUnpinMessage,
  bottomInset,
  onClose,
}: {
  visible: boolean;
  isLiveStarted: boolean;
  titleText: string;
  onChangeTitle: (val: string) => void;
  onCommitLiveTitle: (val: string) => void;
  settings: LiveStudioSettingsState;
  onUpdateSettings: (patch: Partial<LiveStudioSettingsState>) => void;
  pinnedMessage: string | null;
  onPinCustomMessage: (text: string) => void;
  onUnpinMessage: () => void;
  bottomInset: number;
  onClose: () => void;
}) {
  const [pinDraft, setPinDraft] = useState(pinnedMessage || '');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.flexFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {isLiveStarted ? 'Live Controls & Settings' : 'Broadcast Setup'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeIconBtn}>
              <Feather name="x" size={18} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollGap}>
            <Text style={styles.sectionLabel}>STREAM TITLE</Text>
            <View style={styles.rowGap}>
              <TextInput
                value={titleText}
                onChangeText={onChangeTitle}
                placeholder="Stream title..."
                placeholderTextColor="#64748b"
                style={[styles.input, { flex: 1 }]}
                maxLength={100}
              />
              {isLiveStarted && (
                <TouchableOpacity
                  style={styles.smallPrimaryBtn}
                  onPress={() => onCommitLiveTitle(titleText)}
                >
                  <Text style={styles.smallPrimaryText}>Save</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.sectionLabel}>CATEGORY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipsRow}>
                {CATEGORIES.map((cat) => {
                  const active = settings.category === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => onUpdateSettings({ category: cat })}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.sectionLabel}>VISIBILITY</Text>
            <View style={styles.chipsRow}>
              {VISIBILITY_OPTIONS.map((v) => {
                const active = settings.visibility === v.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => onUpdateSettings({ visibility: v.id })}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {v.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>SLOW MODE</Text>
            <View style={styles.chipsRow}>
              {SLOW_MODE_OPTIONS.map((sec) => {
                const active = settings.slowModeSec === sec;
                return (
                  <TouchableOpacity
                    key={sec}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => onUpdateSettings({ slowModeSec: sec })}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {sec === 0 ? 'Off' : `${sec}s`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {isLiveStarted && (
              <>
                <Text style={styles.sectionLabel}>PINNED ANNOUNCEMENT</Text>
                <View style={styles.rowGap}>
                  <TextInput
                    value={pinDraft}
                    onChangeText={setPinDraft}
                    placeholder="Pin a topic or link..."
                    placeholderTextColor="#64748b"
                    style={[styles.input, { flex: 1 }]}
                  />
                  <TouchableOpacity
                    style={styles.smallPrimaryBtn}
                    onPress={() => {
                      if (pinDraft.trim()) {
                        onPinCustomMessage(pinDraft.trim());
                      }
                    }}
                  >
                    <Text style={styles.smallPrimaryText}>Pin</Text>
                  </TouchableOpacity>
                  {pinnedMessage && (
                    <TouchableOpacity
                      style={styles.smallDangerBtn}
                      onPress={() => {
                        setPinDraft('');
                        onUnpinMessage();
                      }}
                    >
                      <Text style={styles.smallDangerText}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            <View style={styles.switchRow}>
              <View style={styles.flexFill}>
                <Text style={styles.switchTitle}>Auto-Record Replay</Text>
                <Text style={styles.switchSub}>Save recording when stream ends</Text>
              </View>
              <Switch
                value={settings.autoRecordReplay}
                onValueChange={(val) => onUpdateSettings({ autoRecordReplay: val })}
              />
            </View>

            <View style={styles.switchRow}>
              <View style={styles.flexFill}>
                <Text style={styles.switchTitle}>Publish Replay to Watch</Text>
                <Text style={styles.switchSub}>Automatically post replay after live</Text>
              </View>
              <Switch
                value={settings.publishReplayToWatch}
                onValueChange={(val) => onUpdateSettings({ publishReplayToWatch: val })}
              />
            </View>

            <View style={styles.switchRow}>
              <View style={styles.flexFill}>
                <Text style={styles.switchTitle}>Live Chat</Text>
                <Text style={styles.switchSub}>Allow viewers to send comments</Text>
              </View>
              <Switch
                value={settings.chatEnabled}
                onValueChange={(val) => onUpdateSettings({ chatEnabled: val })}
              />
            </View>

            <View style={styles.switchRow}>
              <View style={styles.flexFill}>
                <Text style={styles.switchTitle}>Gifts & Superchats</Text>
                <Text style={styles.switchSub}>Enable viewer tips and highlights</Text>
              </View>
              <Switch
                value={settings.monetizeEnabled}
                onValueChange={(val) => onUpdateSettings({ monetizeEnabled: val })}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function LiveGiftSuperchatSheet({
  visible,
  initialTab,
  onSendGift,
  onSendSuperchat,
  bottomInset,
  onClose,
}: {
  visible: boolean;
  initialTab: 'gift' | 'superchat';
  onSendGift: (gift: LiveGiftOption) => void;
  onSendSuperchat: (option: LiveSuperchatOption, note: string) => void;
  bottomInset: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'gift' | 'superchat'>(initialTab);
  const [selectedSuperchat, setSelectedSuperchat] = useState<LiveSuperchatOption>(
    LIVE_SUPERCHAT_OPTIONS[0]
  );
  const [note, setNote] = useState('');

  React.useEffect(() => {
    setTab(initialTab);
  }, [initialTab, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.flexFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={styles.rowGap}>
              <TouchableOpacity
                style={[styles.tabPill, tab === 'gift' && styles.tabPillActive]}
                onPress={() => setTab('gift')}
              >
                <Text style={[styles.tabPillText, tab === 'gift' && styles.tabPillTextActive]}>
                  Gifts
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabPill, tab === 'superchat' && styles.tabPillActive]}
                onPress={() => setTab('superchat')}
              >
                <Text
                  style={[styles.tabPillText, tab === 'superchat' && styles.tabPillTextActive]}
                >
                  Superchat
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeIconBtn}>
              <Feather name="x" size={18} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          {tab === 'gift' ? (
            <View style={styles.giftGrid}>
              {LIVE_GIFT_OPTIONS.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.giftCard}
                  onPress={() => {
                    onSendGift(g);
                    onClose();
                  }}
                >
                  <Text style={styles.giftEmoji}>{g.emoji}</Text>
                  <Text style={styles.giftLabel}>{g.label}</Text>
                  <Text style={[styles.giftPrice, { color: g.color }]}>₹{g.amount}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.scrollGap}>
              <View style={styles.chipsRow}>
                {LIVE_SUPERCHAT_OPTIONS.map((sc) => {
                  const active = selectedSuperchat.id === sc.id;
                  return (
                    <TouchableOpacity
                      key={sc.id}
                      style={[
                        styles.chip,
                        active && { borderColor: sc.color, backgroundColor: '#1e293b' },
                      ]}
                      onPress={() => setSelectedSuperchat(sc)}
                    >
                      <Text style={styles.chipText}>
                        {sc.badge} ₹{sc.amount}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add a highlighted message (optional)..."
                placeholderTextColor="#64748b"
                style={styles.input}
                maxLength={120}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: selectedSuperchat.color }]}
                onPress={() => {
                  onSendSuperchat(selectedSuperchat, note.trim());
                  setNote('');
                  onClose();
                }}
              >
                <Text style={styles.primaryBtnTextDark}>
                  Send {selectedSuperchat.badge} Superchat · ₹{selectedSuperchat.amount}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function LiveAnalyticsViewersSheet({
  visible,
  viewerCount,
  peakViewers,
  liveDurationLabel,
  messagesCount,
  reactionsCount,
  earningsInr,
  viewers,
  bottomInset,
  onClose,
}: {
  visible: boolean;
  viewerCount: number;
  peakViewers: number;
  liveDurationLabel: string;
  messagesCount: number;
  reactionsCount: number;
  earningsInr: number;
  viewers: LivePresenceViewer[];
  bottomInset: number;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.flexFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Live Analytics & Viewers</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeIconBtn}>
              <Feather name="x" size={18} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{viewerCount}</Text>
              <Text style={styles.statLbl}>Watching</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{peakViewers}</Text>
              <Text style={styles.statLbl}>Peak</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{liveDurationLabel}</Text>
              <Text style={styles.statLbl}>Duration</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statVal, { color: '#fbbf24' }]}>₹{earningsInr}</Text>
              <Text style={styles.statLbl}>Tips</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>
            ACTIVE ROOM ({viewers.length}) · {messagesCount} CHATS · {reactionsCount} REACTIONS
          </Text>

          <ScrollView style={{ maxHeight: 190 }} showsVerticalScrollIndicator={false}>
            {viewers.map((v) => (
              <View key={v.key} style={styles.viewerRow}>
                <Ionicons name="person-circle-outline" size={20} color="#38bdf8" />
                <Text style={styles.viewerName}>{v.name}</Text>
                <Text style={styles.viewerRole}>{v.role}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function LiveGuestsManagerSheet({
  visible,
  joinRequests,
  activeCoHosts,
  allowJoinRequests,
  onToggleAllowJoin,
  onAcceptRequest,
  onDeclineRequest,
  onRemoveCoHost,
  bottomInset,
  onClose,
}: {
  visible: boolean;
  joinRequests: LiveJoinRequestEntry[];
  activeCoHosts: string[];
  allowJoinRequests: boolean;
  onToggleAllowJoin: (val: boolean) => void;
  onAcceptRequest: (requestId: string, username: string) => void;
  onDeclineRequest: (requestId: string) => void;
  onRemoveCoHost: (username: string) => void;
  bottomInset: number;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.flexFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Stage & Guest Requests</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeIconBtn}>
              <Feather name="x" size={18} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          <View style={styles.switchRow}>
            <View style={styles.flexFill}>
              <Text style={styles.switchTitle}>Allow Guest Requests</Text>
              <Text style={styles.switchSub}>Let viewers request to join on stage</Text>
            </View>
            <Switch value={allowJoinRequests} onValueChange={onToggleAllowJoin} />
          </View>

          {activeCoHosts.length > 0 && (
            <View style={styles.scrollGap}>
              <Text style={styles.sectionLabel}>ON STAGE</Text>
              {activeCoHosts.map((name) => (
                <View key={name} style={styles.guestItemRow}>
                  <Text style={styles.viewerName}>{name}</Text>
                  <TouchableOpacity
                    style={styles.smallDangerBtn}
                    onPress={() => onRemoveCoHost(name)}
                  >
                    <Text style={styles.smallDangerText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>PENDING REQUESTS ({joinRequests.length})</Text>
          {joinRequests.length === 0 ? (
            <Text style={styles.emptyText}>No pending guest requests.</Text>
          ) : (
            joinRequests.map((req) => (
              <View key={req.id} style={styles.guestItemRow}>
                <Text style={styles.viewerName}>{req.username}</Text>
                <View style={styles.rowGap}>
                  <TouchableOpacity
                    style={styles.smallPrimaryBtn}
                    onPress={() => onAcceptRequest(req.id, req.username)}
                  >
                    <Text style={styles.smallPrimaryText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.smallDangerBtn}
                    onPress={() => onDeclineRequest(req.id)}
                  >
                    <Text style={styles.smallDangerText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '82%',
    borderTopWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '800' },
  closeIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollGap: { gap: 10, paddingBottom: 16 },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: '#f43f5e' },
  chipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#ffffff' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 12,
  },
  switchTitle: { color: '#f8fafc', fontSize: 13.5, fontWeight: '700' },
  switchSub: { color: '#94a3b8', fontSize: 11.5, marginTop: 1 },
  smallPrimaryBtn: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  smallPrimaryText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  smallDangerBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  smallDangerText: { color: '#fca5a5', fontSize: 12, fontWeight: '800' },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#1e293b',
  },
  tabPillActive: { backgroundColor: '#f43f5e' },
  tabPillText: { color: '#94a3b8', fontSize: 13, fontWeight: '700' },
  tabPillTextActive: { color: '#ffffff' },
  giftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 14,
  },
  giftCard: {
    width: '48.2%',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  giftEmoji: { fontSize: 26 },
  giftLabel: { color: '#f8fafc', fontSize: 13, fontWeight: '700' },
  giftPrice: { fontSize: 12, fontWeight: '800' },
  primaryBtn: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTextDark: { color: '#09090b', fontSize: 14, fontWeight: '900' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 2,
  },
  statVal: { color: '#f8fafc', fontSize: 14, fontWeight: '900' },
  statLbl: { color: '#94a3b8', fontSize: 10.5, fontWeight: '600' },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.12)',
  },
  viewerName: { color: '#f8fafc', fontSize: 13.5, fontWeight: '700', flex: 1 },
  viewerRole: { color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' },
  guestItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.12)',
  },
  emptyText: { color: '#94a3b8', fontSize: 13, paddingVertical: 14, textAlign: 'center' },
});

export default LiveStudioSettingsSheet;