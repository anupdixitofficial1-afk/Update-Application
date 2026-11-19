import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { supabase } from '../../lib/supabase';

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export default function ChatScreen({ recipientId }: { recipientId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    // 1. Fetch current user and existing messages
    initialFetch();

    // 2. Set up Supabase Realtime subscription
    const messageChannel = supabase
      .channel('room_chat_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const newMessage = payload.new as Message;
          // Append the new message to local state instantly
          setMessages((prev) => [...prev, newMessage]);
        }
      )
      .subscribe();

    // 3. Cleanup channel subscription on unmount
    return () => {
      supabase.removeChannel(messageChannel);
    };
  }, []);

  const initialFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    // Fetch conversation history
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true });

    if (data) setMessages(data);
  };

  const sendMessage = async () => {
    if (!inputText.trim() || !currentUserId) return;

    const messagePayload = {
      sender_id: currentUserId,
      receiver_id: recipientId,
      content: inputText.trim(),
    };

    const { error } = await supabase.from('messages').insert([messagePayload]);

    if (error) {
      console.error('Error sending message:', error.message);
    } else {
      setInputText('');
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.sender_id === currentUserId ? styles.myBubble : styles.peerBubble]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>
        )}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor="#94a3b8"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f9f8', padding: 16 },
  bubble: { padding: 10, borderRadius: 10, marginVertical: 4, maxWidth: '75%' },
  myBubble: { backgroundColor: '#059669', alignSelf: 'flex-end' },
  peerBubble: { backgroundColor: '#ffffff', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e2e8f0' },
  bubbleText: { fontSize: 13, color: '#0f172a' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  input: { flex: 1, backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  sendBtn: { backgroundColor: '#059669', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10 },
  sendText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
});