import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Image,
  TouchableOpacity,
  TextInput,
  Dimensions,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';

const { width } = Dimensions.get('window');

interface Comment {
  id: string;
  user: string;
  avatar: string;
  text: string;
  time: string;
  likes: number;
}

const INITIAL_COMMENTS: Comment[] = [
  {
    id: 'c1',
    user: 'rahul_tech',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150',
    text: 'This explanation is super clear! Loved the workflow breakdown.',
    time: '2h ago',
    likes: 24,
  },
  {
    id: 'c2',
    user: 'priya_vlogs',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150',
    text: 'Amazing visual quality and great editing as always! 🔥',
    time: '5h ago',
    likes: 12,
  },
];

export default function MediaDetailScreen() {
  const params = useLocalSearchParams();
  const mediaId = params.id as string;

  // States for interaction
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(1420);
  const [isSaved, setIsSaved] = useState(false);
  const [comments, setComments] = useState<Comment[]>(INITIAL_COMMENTS);
  const [newCommentText, setNewCommentText] = useState('');

  const handleLikeToggle = () => {
    if (isLiked) {
      setIsLiked(false);
      setLikesCount(likesCount - 1);
    } else {
      setIsLiked(true);
      setLikesCount(likesCount + 1);
    }
  };

  const handleAddComment = () => {
    if (!newCommentText.trim()) return;

    const newComment: Comment = {
      id: Date.now().toString(),
      user: 'anupdixit2024',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150',
      text: newCommentText.trim(),
      time: 'Just now',
      likes: 0,
    };

    setComments([newComment, ...comments]);
    setNewCommentText('');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* TOP HEADER BAR */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Media Player ({mediaId || 'Post'})</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          
          {/* MEDIA PLAYER / BANNER VIEW */}
          <View style={styles.playerContainer}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&q=80&w=800' }}
              style={styles.playerImage}
              resizeMode="cover"
            />
            <View style={styles.playerOverlay} />
            <TouchableOpacity style={styles.bigPlayBtn} activeOpacity={0.8}>
              <Ionicons name="play" size={28} color="#ffffff" style={{ marginLeft: 3 }} />
            </TouchableOpacity>

            {/* Duration / Badge */}
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>22:15</Text>
            </View>
          </View>

          {/* MEDIA INFO SECTION */}
          <View style={styles.infoSection}>
            <Text style={styles.mediaTitle}>
              Building High-Throughput Desktop Tools & Clean UI Workflows in 2026
            </Text>

            <View style={styles.subInfoRow}>
              <Text style={styles.viewsText}>1.9M views</Text>
              <Text style={styles.dotSeparator}>•</Text>
              <Text style={styles.dateText}>3 weeks ago</Text>
            </View>

            {/* CHANNEL / AUTHOR ROW */}
            <View style={styles.authorRow}>
              <View style={styles.authorLeft}>
                <Image
                  source={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=250' }}
                  style={styles.authorAvatar}
                />
                <View style={{ marginLeft: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.authorName}>Anup Dixit</Text>
                    <Ionicons name="checkmark-circle" size={13} color="#059669" style={{ marginLeft: 3 }} />
                  </View>
                  <Text style={styles.subscriberText}>148K Followers</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.followBtn} activeOpacity={0.8}>
                <Text style={styles.followBtnText}>Following</Text>
              </TouchableOpacity>
            </View>

            {/* INTERACTION ACTION BUTTONS ROW */}
            <View style={styles.actionsBar}>
              <TouchableOpacity
                style={[styles.actionButton, isLiked && styles.activeActionButton]}
                onPress={handleLikeToggle}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isLiked ? 'heart' : 'heart-outline'}
                  size={18}
                  color={isLiked ? '#ef4444' : '#0f172a'}
                />
                <Text style={[styles.actionButtonText, isLiked && { color: '#ef4444' }]}>
                  {likesCount}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => setIsSaved(!isSaved)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isSaved ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={isSaved ? '#059669' : '#0f172a'}
                />
                <Text style={styles.actionButtonText}>{isSaved ? 'Saved' : 'Save'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton} activeOpacity={0.7}>
                <Ionicons name="share-social-outline" size={18} color="#0f172a" />
                <Text style={styles.actionButtonText}>Share</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton} activeOpacity={0.7}>
                <MaterialCommunityIcons name="download-outline" size={19} color="#0f172a" />
                <Text style={styles.actionButtonText}>Save Offline</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* COMMENTS SECTION */}
          <View style={styles.commentsSection}>
            <Text style={styles.commentsHeaderTitle}>Comments ({comments.length})</Text>

            {/* Comment Input Box inside content */}
            <View style={styles.commentInputBox}>
              <TextInput
                style={styles.commentTextInput}
                placeholder="Add a comment..."
                placeholderTextColor="#94a3b8"
                value={newCommentText}
                onChangeText={setNewCommentText}
              />
              <TouchableOpacity
                style={[styles.sendCommentBtn, !newCommentText.trim() && { opacity: 0.5 }]}
                onPress={handleAddComment}
                disabled={!newCommentText.trim()}
                activeOpacity={0.8}
              >
                <Ionicons name="send" size={14} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {/* Comments List */}
            {comments.map((item) => (
              <View key={item.id} style={styles.commentCard}>
                <Image source={{ uri: item.avatar }} style={styles.commentAvatar} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.commentUserRow}>
                    <Text style={styles.commentUsername}>{item.user}</Text>
                    <Text style={styles.commentTime}>{item.time}</Text>
                  </View>
                  <Text style={styles.commentText}>{item.text}</Text>
                  <View style={styles.commentActionsRow}>
                    <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="heart-outline" size={12} color="#64748b" style={{ marginRight: 3 }} />
                      <Text style={styles.commentLikesText}>{item.likes}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
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
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },

  scrollContent: { paddingBottom: 40 },

  playerContainer: {
    width: width,
    height: width * 0.56,
    backgroundColor: '#0f172a',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerImage: { width: '100%', height: '100%' },
  playerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  bigPlayBtn: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(5, 150, 105, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 10,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },

  infoSection: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  mediaTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 21,
    marginBottom: 6,
  },
  subInfoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  viewsText: { fontSize: 11.5, color: '#64748b', fontWeight: '600' },
  dotSeparator: { marginHorizontal: 6, color: '#cbd5e1', fontSize: 11 },
  dateText: { fontSize: 11.5, color: '#94a3b8', fontWeight: '500' },

  authorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 14,
  },
  authorLeft: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 38, height: 38, borderRadius: 19 },
  authorName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  subscriberText: { fontSize: 10.5, color: '#64748b', fontWeight: '600', marginTop: 1 },
  followBtn: {
    backgroundColor: '#e6f7f0',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  followBtnText: { fontSize: 12, fontWeight: '700', color: '#059669' },

  actionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 4,
  },
  activeActionButton: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
  },
  actionButtonText: { fontSize: 11, fontWeight: '700', color: '#0f172a' },

  commentsSection: {
    backgroundColor: '#ffffff',
    marginTop: 12,
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  commentsHeaderTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 12 },

  commentInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  commentTextInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0f172a',
    paddingVertical: 6,
  },
  sendCommentBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },

  commentCard: {
    flexDirection: 'row',
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  commentAvatar: { width: 32, height: 32, borderRadius: 16 },
  commentUserRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  commentUsername: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  commentTime: { fontSize: 10, color: '#94a3b8', fontWeight: '500', marginLeft: 8 },
  commentText: { fontSize: 12, color: '#334155', lineHeight: 17, marginBottom: 4 },
  commentActionsRow: { flexDirection: 'row', alignItems: 'center' },
  commentLikesText: { fontSize: 10.5, color: '#64748b', fontWeight: '600' },
});