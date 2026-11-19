import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Image,
  TouchableOpacity,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function HomeFeedScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* 1. Top App Header */}
        <View style={styles.headerContainer}>
          <View style={styles.logoGroup}>
            <View style={styles.flameIconBox}>
              <MaterialCommunityIcons name="fire" size={24} color="#111827" />
            </View>
            <View>
              <Text style={styles.brandTitle}>VibeSphere</Text>
              <Text style={styles.brandSubtitle}>UNIFIED FEED</Text>
            </View>
          </View>

          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.circleIconButton}>
              <Ionicons name="notifications-outline" size={20} color="#1f2937" />
              <View style={styles.notificationDot} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.circleIconButton}
              onPress={() => router.push('/chats')}
            >
              <Feather name="send" size={19} color="#1f2937" />
              <View style={styles.badgeCount}>
                <Text style={styles.badgeText}>2</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        {/* 2. Stories & Live Tray */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.storiesContainer}
        >
          {renderStoryItem(
            'Your Story',
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150',
            true
          )}
          {renderStoryItem(
            '@aravbui...',
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150',
            false,
            true
          )}
          {renderStoryItem(
            '@meera_vl...',
            'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150'
          )}
          {renderStoryItem(
            '@rohan_fit',
            'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150'
          )}
          {renderStoryItem(
            '@ananya_...',
            'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=150'
          )}
        </ScrollView>

        <View style={styles.divider} />

        {/* 3. Post 1: Aarav Sharma (Public Smart Video Card) */}
        <View style={styles.postCard}>
          <View style={styles.postHeader}>
            <View style={styles.userInfoGroup}>
              <Image
                source={{
                  uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150',
                }}
                style={styles.avatar}
              />
              <View>
                <View style={styles.nameRow}>
                  <Text style={styles.userName}>Aarav Sharma</Text>
                  <View style={styles.publicBadge}>
                    <Ionicons
                      name="globe-outline"
                      size={11}
                      color="#10b981"
                      style={{ marginRight: 3 }}
                    />
                    <Text style={styles.publicBadgeText}>Public</Text>
                  </View>
                </View>
                <Text style={styles.userHandle}>@aravbuilds  •  2h ago</Text>
              </View>
            </View>
            <TouchableOpacity>
              <Ionicons name="ellipsis-horizontal" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <Text style={styles.postCaption}>
            Building a custom AI home server from scratch! Here is the
            45-second teaser—tap below to watch the full 14:20 breakdown with
            benchmarks.
          </Text>

          {/* Edge-to-Edge Smart Video Teaser Box */}
          <View style={styles.videoContainer}>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=800',
              }}
              style={styles.videoCover}
            />
            <View style={styles.videoOverlay} />

            {/* Smart Video Mode Pill */}
            <View style={styles.smartModeTag}>
              <Ionicons name="sparkles-outline" size={12} color="#fbbf24" />
              <Text style={styles.smartModeText}>Smart Video Mode</Text>
            </View>

            {/* Center Play Button */}
            <TouchableOpacity style={styles.playButtonCircle}>
              <Ionicons
                name="play"
                size={24}
                color="#111827"
                style={{ marginLeft: 3 }}
              />
            </TouchableOpacity>

            {/* Bottom Dark Glass Footer inside Video */}
            <View style={styles.videoFooterBox}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={styles.videoTitle} numberOfLines={1}>
                  Building a Silent 128GB AI Home Server U...
                </Text>
                <Text style={styles.videoSubTitle}>
                  48.2K views • Full Episode
                </Text>
              </View>
              <TouchableOpacity style={styles.watchButton}>
                <Text style={styles.watchButtonText}>Watch (14:20)</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Post Actions Row */}
          <View style={styles.postActionsRow}>
            <View style={styles.leftActions}>
              <TouchableOpacity style={styles.actionItem}>
                <Ionicons name="heart-outline" size={22} color="#4b5563" />
                <Text style={styles.actionCount}>1420</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionItem}>
                <Ionicons name="chatbubble-outline" size={20} color="#4b5563" />
                <Text style={styles.actionCount}>1</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionItem}>
                <Ionicons
                  name="share-social-outline"
                  size={21}
                  color="#4b5563"
                />
              </TouchableOpacity>
            </View>
            <TouchableOpacity>
              <Ionicons name="bookmark-outline" size={21} color="#4b5563" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 4. Post 2: Meera Kapoor (Friends Only Card) */}
        <View style={styles.postCard}>
          <View style={styles.postHeader}>
            <View style={styles.userInfoGroup}>
              <Image
                source={{
                  uri: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150',
                }}
                style={styles.avatar}
              />
              <View>
                <View style={styles.nameRow}>
                  <Text style={styles.userName}>Meera Kapoor</Text>
                  <View style={styles.friendsBadge}>
                    <Ionicons
                      name="people-outline"
                      size={11}
                      color="#d97706"
                      style={{ marginRight: 3 }}
                    />
                    <Text style={styles.friendsBadgeText}>Friends Only</Text>
                  </View>
                </View>
                <Text style={styles.userHandle}>@meera_vlogs  •  4h ago</Text>
              </View>
            </View>
            <TouchableOpacity>
              <Ionicons name="ellipsis-horizontal" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <Text style={styles.postCaption}>
            Weekend golden hour escape at CyberHub & Aravalli trails. Swipe
            through the frames!
          </Text>

          {/* Post Image */}
          <Image
            source={{
              uri: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&q=80&w=800',
            }}
            style={styles.feedImage}
          />

          {/* Post Actions Row */}
          <View style={styles.postActionsRow}>
            <View style={styles.leftActions}>
              <TouchableOpacity style={styles.actionItem}>
                <Ionicons name="heart-outline" size={22} color="#4b5563" />
                <Text style={styles.actionCount}>845</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionItem}>
                <Ionicons name="chatbubble-outline" size={20} color="#4b5563" />
                <Text style={styles.actionCount}>24</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionItem}>
                <Ionicons
                  name="share-social-outline"
                  size={21}
                  color="#4b5563"
                />
              </TouchableOpacity>
            </View>
            <TouchableOpacity>
              <Ionicons name="bookmark-outline" size={21} color="#4b5563" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function renderStoryItem(
  name: string,
  imageUrl: string,
  isYourStory = false,
  isLive = false
) {
  return (
    <View style={styles.storyItemWrapper}>
      <View style={[styles.storyRing, isYourStory && styles.storyRingNeutral]}>
        <Image source={{ uri: imageUrl }} style={styles.storyAvatar} />
        {isLive && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        )}
      </View>
      <Text style={styles.storyName} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  /* Header */
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    width: '100%',
  },
  logoGroup: { flexDirection: 'row', alignItems: 'center' },
  flameIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#34d399',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10b981',
    letterSpacing: 1,
  },
  headerIcons: { flexDirection: 'row', alignItems: 'center' },
  circleIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
    position: 'relative',
  },
  notificationDot: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 8,
    height: 8,
    backgroundColor: '#f59e0b',
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#f3f4f6',
  },
  badgeCount: {
    position: 'absolute',
    right: -2,
    top: -2,
    backgroundColor: '#10b981',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: '#f1f5f9', width: '100%' },

  /* Stories */
  storiesContainer: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    width: '100%',
  },
  storyItemWrapper: { alignItems: 'center', marginHorizontal: 6 },
  storyRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2.5,
    borderColor: '#84cc16',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  storyRingNeutral: { borderColor: '#cbd5e1', borderWidth: 1.5 },
  storyAvatar: { width: 56, height: 56, borderRadius: 28 },
  liveBadge: {
    position: 'absolute',
    bottom: -4,
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  liveBadgeText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  storyName: {
    fontSize: 11,
    color: '#475569',
    marginTop: 6,
    width: 66,
    textAlign: 'center',
    fontWeight: '500',
  },

  /* Post Cards - Full Width (No Margins) */
  postCard: {
    backgroundColor: '#ffffff',
    marginTop: 8,
    marginBottom: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
    width: '100%',
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  userInfoGroup: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 21, marginRight: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  userName: { fontWeight: '700', fontSize: 15, color: '#0f172a' },
  publicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  publicBadgeText: { color: '#10b981', fontSize: 11, fontWeight: '600' },
  friendsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  friendsBadgeText: { color: '#d97706', fontSize: 11, fontWeight: '600' },
  userHandle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  postCaption: {
    fontSize: 14,
    color: '#1e293b',
    paddingHorizontal: 16,
    marginVertical: 10,
    lineHeight: 20,
  },

  /* Edge-to-edge Video Card */
  videoContainer: {
    height: 240,
    width: '100%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoCover: { width: '100%', height: '100%', position: 'absolute' },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  smartModeTag: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  smartModeText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 5,
  },
  playButtonCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  videoFooterBox: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 14,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  videoTitle: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  videoSubTitle: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  watchButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  watchButtonText: { color: '#0f172a', fontSize: 11, fontWeight: '800' },

  /* Standard Feed Image */
  feedImage: { width: '100%', height: 220, backgroundColor: '#e2e8f0' },

  /* Actions Footer */
  postActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    width: '100%',
  },
  leftActions: { flexDirection: 'row', alignItems: 'center' },
  actionItem: { flexDirection: 'row', alignItems: 'center', marginRight: 18 },
  actionCount: {
    fontSize: 13,
    fontWeight: '500',
    color: '#475569',
    marginLeft: 5,
  },
});