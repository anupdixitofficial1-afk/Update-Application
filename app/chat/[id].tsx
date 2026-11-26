import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { backend, ChatMessageRecord } from '../../lib/backend';

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const recipientId = typeof params.id === 'string' ? params.id.trim() : '';

  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [inputText, setInputText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [peerName, setPeerName] = useState('Chat');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadThread = useCallback(async () => {
    try {
      const user = await backend.auth.getCurrentUser();
      const myId = user?.id ?? null;
      setCurrentUserId(myId);

      if (!myId || !recipientId) {
        setLoading(false);
        return;
      }

      const [peerProfile, threadMsgs] = await Promise.all([
        backend.profile.getProfileById(recipientId).catch(() => null),
        backend.messages.getThreadMessages(myId, recipientId),
      ]);

      if (peerProfile) {
        setPeerName(
          peerProfile.full_name || peerProfile.username || 'Conversation'
        );
      }
      setMessages(threadMsgs);
      void backend.messages
        .markMessagesSeen(myId, recipientId, new Date().toISOString())
        .catch(() => { });
    } finally {
      setLoading(false);
    }
  }, [recipientId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!currentUserId || !recipientId) return;

    const unsubscribe = backend.messages.subscribeThreadMessages(
      currentUserId,
      recipientId,
      {
        onInsert: (newMessage) => {
          setMessages((prev) =>
            prev.some((m) => m.id === newMessage.id)
              ? prev
              : [...prev, newMessage]
          );
          if (newMessage.sender_id === recipientId) {
            void backend.messages
              .markMessagesSeen(
                currentUserId,
                recipientId,
                new Date().toISOString()
              )
              .catch(() => { });
          }
        },
        onUpdate: (updatedMessage) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m))
          );
        },
      }
    );

    return unsubscribe;
  }, [currentUserId, recipientId]);

  const sendMessage = async () => {
    const clean = inputText.trim();
    if (!clean || !currentUserId || !recipientId || sending) return;

    setSending(true);
    try {
      const sent = await backend.messages.sendMessage({
        senderId: currentUserId,
        receiverId: recipientId,
        content: clean,
      });
      if (sent) {
        setMessages((prev) =>
          prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]
        );
      }
      setInputText('');
    } catch (err: any) {
      console.error('Error sending message:', err?.message || err);
    } finally {
      setSending(false);
    }
  };

  const getMessageText = (item: ChatMessageRecord) =>
    item.content ?? item.text ?? item.body ?? item.message ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {peerName}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="small" color="#059669" />
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isMe = item.sender_id === currentUserId;
              return (
                <View
                  style={[
                    styles.bubble,
                    isMe ? styles.myBubble : styles.peerBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.bubbleText,
                      isMe && { color: '#ffffff' },
                    ]}
                  >
                    {getMessageText(item)}
                  </Text>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.centerBox}>
                <Text style={styles.emptyText}>
                  No messages yet. Say hello!
                </Text>
              </View>
            }
          />
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#94a3b8"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && { opacity: 0.6 }]}
            onPress={() => void sendMessage()}
            disabled={!inputText.trim() || sending}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f9f8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginHorizontal: 8,
  },
  body: { flex: 1, paddingHorizontal: 14, paddingBottom: 12 },
  listContent: { paddingVertical: 10, flexGrow: 1 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 13, color: '#64748b' },
  bubble: { padding: 10, borderRadius: 12, marginVertical: 4, maxWidth: '78%' },
  myBubble: { backgroundColor: '#059669', alignSelf: 'flex-end' },
  peerBubble: {
    backgroundColor: '#ffffff',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bubbleText: { fontSize: 13.5, color: '#0f172a' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    color: '#0f172a',
  },
  sendBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  sendText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
});
