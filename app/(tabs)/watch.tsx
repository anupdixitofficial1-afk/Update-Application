import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, Image, TouchableOpacity, Modal, Dimensions, BackHandler, TouchableWithoutFeedback, TextInput, KeyboardAvoidingView, Platform, FlatList } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';

const { width, height } = Dimensions.get('window');

const DUMMY_COMMENTS = [
  { id: '1', user: '@rahul_tech', text: 'Amazing review! The camera quality looks insane 🔥', likes: '342', time: '2 hours ago' },
  { id: '2', user: '@priya_vlogs', text: 'Waiting for the long term battery test video!', likes: '128', time: '5 hours ago' },
  { id: '3', user: '@tech_freak', text: 'VibeSphere is killing it this year with clean UI updates.', likes: '95', time: '1 day ago' },
];

export default function WatchScreen() {
  const [activeTab, setActiveTab] = useState<'long' | 'shorts'>('long');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSubscribeBtn, setShowSubscribeBtn] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(2450);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentsList, setCommentsList] = useState(DUMMY_COMMENTS);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  // Handle Screen Orientation for Fullscreen player
  useEffect(() => {
    async function handleOrientation() {
      if (isFullscreen) {
        await ScreenOrientation.unlockAsync();
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      }
    }
    handleOrientation();
  }, [isFullscreen]);

  // Android Hardware Back Button Handler
  useEffect(() => {
    const backAction = () => {
      if (isCommentsOpen) {
        setIsCommentsOpen(false);
        return true;
      }
      if (isMenuOpen) {
        setIsMenuOpen(false);
        return true;
      }
      if (isFullscreen) {
        setIsFullscreen(false);
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [isFullscreen, isMenuOpen, isCommentsOpen]);

  // Manual opposite rotation toggle
  const toggleRotate = async () => {
    if (isFullscreen) {
      const orientation = await ScreenOrientation.getOrientationAsync();
      if (orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
      }
    }
  };

  const handleLike = () => {
    if (isLiked) {
      setIsLiked(false);
      setLikeCount(likeCount - 1);
    } else {
      setIsLiked(true);
      setLikeCount(likeCount + 1);
    }
  };

  const handleSubscribe = () => {
    if (!isSubscribed) {
      setIsSubscribed(true);
      setTimeout(() => {
        setShowSubscribeBtn(false);
      }, 5000);
    } else {
      setIsSubscribed(false);
      setShowSubscribeBtn(true);
    }
  };

  const addComment = () => {
    if (newComment.trim() === '') return;
    const item = {
      id: Date.now().toString(),
      user: '@you_viewer',
      text: newComment,
      likes: '0',
      time: 'Just now',
    };
    setCommentsList([item, ...commentsList]);
    setNewComment('');
  };

  return (
    <View style={styles.container}>
      
      {/* HEADER BAR: Long-Form mode with clean icons (Question mark / Cast icon removed) */}
      {activeTab === 'long' && (
        <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
          <View style={styles.headerContainer}>
            <View style={styles.headerLeftBrand}>
              <View style={styles.appLogoBox}>
                <Ionicons name="flash" size={14} color="#ffffff" />
              </View>
              <Text style={styles.brandTitle}>VibeSphere</Text>
            </View>

            <View style={styles.headerRightIcons}>
              {/* Search Icon */}
              <TouchableOpacity style={styles.headerIconButton}>
                <Ionicons name="search-outline" size={22} color="#1f2937" />
              </TouchableOpacity>

              {/* Mode Switcher to Shorts (Red color) */}
              <TouchableOpacity 
                style={styles.headerIconButton}
                onPress={() => setActiveTab('shorts')}
              >
                <MaterialCommunityIcons name="lightning-bolt" size={20} color="#ff0000" />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      )}

      {/* FLOATING SWITCHER FOR SHORTS MODE */}
      {activeTab === 'shorts' && (
        <SafeAreaView edges={['top']} style={styles.floatingHeaderSafeArea}>
          <View style={styles.floatingHeaderContainer}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity 
              style={styles.floatingSwitchBtn}
              onPress={() => setActiveTab('long')}
            >
              <Ionicons name="videocam" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* SHORTS / REELS FEED VIEW */}
      {activeTab === 'shorts' ? (
        <View style={styles.trueFullScreenReel}>
          <Image 
            source={{ uri: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&q=80&w=900' }} 
            style={styles.reelMedia} 
          />
          <View style={styles.reelOverlay} />

          {/* Top-Left 3-Dots Details Button inside Shorts */}
          <TouchableOpacity style={styles.reelTopLeftDots} onPress={() => setIsMenuOpen(true)}>
            <Ionicons name="ellipsis-vertical" size={20} color="#ffffff" />
          </TouchableOpacity>

          {/* Shorts Bottom Metadata */}
          <View style={styles.reelFooter}>
            <View style={styles.creatorRow}>
              <Image 
                source={{ uri: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150' }} 
                style={styles.creatorAvatar} 
              />
              <Text style={styles.creatorHandle}>@TrakinShorts</Text>
              <Ionicons name="checkmark-circle" size={13} color="#ffffff" style={{ marginLeft: 2, marginRight: 8 }} />

              {showSubscribeBtn && (
                <TouchableOpacity 
                  style={[styles.subscribeShortsBtn, isSubscribed && styles.subscribedShortsBtn]}
                  onPress={handleSubscribe}
                >
                  <Text style={[styles.subscribeShortsText, isSubscribed && styles.subscribedShortsText]}>
                    {isSubscribed ? 'Subscribed' : 'Subscribe'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.reelCaption} numberOfLines={2}>
              Duniya Ka Sabse Ultra Phone ft. Xiaomi 17 Pro... 🔥 #tech #xiaomi #shorts
            </Text>

            <View style={styles.commissionRow}>
              <Ionicons name="musical-note" size={12} color="#ffffff" style={{ marginRight: 6 }} />
              <Text style={styles.commissionText}>Original Audio - VibeSphere Shorts</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.shortsProgressBarBg}>
            <View style={styles.shortsProgressBarFill} />
          </View>

          {/* Vertical Action Bar */}
          <View style={styles.verticalActionsBar}>
            <TouchableOpacity style={styles.verticalActionItem} onPress={handleLike}>
              <View style={styles.actionIconCircle}>
                <Ionicons name={isLiked ? "thumbs-up" : "thumbs-up-outline"} size={22} color={isLiked ? "#ff0000" : "#ffffff"} />
              </View>
              <Text style={styles.actionCountText}>{likeCount}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.verticalActionItem}>
              <View style={styles.actionIconCircle}>
                <Ionicons name="thumbs-down-outline" size={22} color="#ffffff" />
              </View>
              <Text style={styles.actionCountText}>Dislike</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.verticalActionItem} onPress={() => setIsCommentsOpen(true)}>
              <View style={styles.actionIconCircle}>
                <Ionicons name="chatbubble-outline" size={22} color="#ffffff" />
              </View>
              <Text style={styles.actionCountText}>94</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.verticalActionItem}>
              <View style={styles.actionIconCircle}>
                <Ionicons name="share-social-outline" size={22} color="#ffffff" />
              </View>
              <Text style={styles.actionCountText}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.verticalActionItem}>
              <View style={styles.actionIconCircle}>
                <MaterialCommunityIcons name="repeat" size={22} color="#ffffff" />
              </View>
              <Text style={styles.actionCountText}>Remix</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* LONG-FORM WATCH VIEW */
        <>
          <View style={styles.videoContainer}>
            <Image 
              source={{ uri: 'https://img.youtube.com/vi/Ww84NpNpRfo/hqdefault.jpg' }} 
              style={styles.videoCover} 
            />
            <View style={[styles.videoOverlay, isPlaying && { backgroundColor: 'rgba(0,0,0,0.15)' }]} />

            {/* Video Play Button color Red #ff0000 */}
            <TouchableOpacity 
              style={styles.playButtonCircle}
              activeOpacity={0.8}
              onPress={() => setIsPlaying(!isPlaying)}
            >
              <Ionicons name={isPlaying ? "pause" : "play"} size={26} color="#ffffff" style={{ marginLeft: isPlaying ? 0 : 3 }} />
            </TouchableOpacity>

            <View style={styles.videoBottomBar}>
              <Text style={styles.timestampText}>{isPlaying ? "05:42 / 30:41" : "00:00 / 30:41"}</Text>
              <TouchableOpacity onPress={() => setIsFullscreen(true)} style={{ padding: 4 }}>
                <MaterialCommunityIcons name="fullscreen" size={24} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
            <View>
              {/* Video Title & Meta Info */}
              <View style={styles.videoInfoSection}>
                <Text style={styles.videoTitle}>क्या सच में 2036 से आया था ये आदमी? 5 Real Time Travel Cases</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.viewsText}>1.9M views • 2 weeks ago</Text>
                  <Text style={styles.moreTagsText}>#TimeTravel #Mystery</Text>
                </View>
              </View>

              {isPlaying && (
                <View>
                  {/* Channel Bar & Subscribe */}
                  <View style={styles.interactiveSection}>
                    <View style={styles.channelBar}>
                      <View style={styles.channelLeft}>
                        <Image source={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150' }} style={styles.channelAvatar} />
                        <View>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={styles.channelName}>THE FACT-TREE</Text>
                            <Ionicons name="checkmark-circle" size={12} color="#ff0000" style={{ marginLeft: 4 }} />
                          </View>
                          <Text style={styles.subCountText}>840K subscribers</Text>
                        </View>
                      </View>

                      <TouchableOpacity 
                        style={[styles.subscribeBtn, isSubscribed && styles.subscribedBtn]}
                        onPress={() => setIsSubscribed(!isSubscribed)}
                      >
                        <Text style={[styles.subscribeText, isSubscribed && styles.subscribedText]}>
                          {isSubscribed ? 'Subscribed' : 'Subscribe'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Actions Row */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionsScrollRow}>
                      <View style={styles.actionsBarYouTube}>
                        <TouchableOpacity style={styles.actionButtonYouTube} onPress={handleLike}>
                          <Ionicons name={isLiked ? "thumbs-up" : "thumbs-up-outline"} size={18} color="#0f172a" />
                          <Text style={styles.actionButtonText}>{likeCount}</Text>
                        </TouchableOpacity>
                        <View style={styles.actionDivider} />
                        <TouchableOpacity style={styles.actionButtonYouTube}>
                          <Ionicons name="thumbs-down-outline" size={18} color="#0f172a" />
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity style={styles.actionPillButton}>
                        <Ionicons name="share-social-outline" size={18} color="#0f172a" style={{ marginRight: 6 }} />
                        <Text style={styles.pillText}>Share</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.actionPillButton}>
                        <Ionicons name="download-outline" size={18} color="#0f172a" style={{ marginRight: 6 }} />
                        <Text style={styles.pillText}>Download</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.actionPillButton}>
                        <Ionicons name="bookmark-outline" size={18} color="#0f172a" style={{ marginRight: 6 }} />
                        <Text style={styles.pillText}>Save</Text>
                      </TouchableOpacity>
                    </ScrollView>

                    {/* Expandable Description Box */}
                    <TouchableOpacity 
                      style={styles.descriptionBox}
                      activeOpacity={0.9}
                      onPress={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                    >
                      <Text style={styles.descHeading}>Description</Text>
                      <Text style={styles.descContent} numberOfLines={isDescriptionExpanded ? undefined : 2}>
                        क्या भविष्य से यात्रा करके कोई अतीत में आ सकता है? जानिए ऐसे 5 हैरान करने वाले मामले जो आज भी विज्ञान के लिए एक अनसुलझी पहेली बने हुए हैं। Video credits to respective owners.
                      </Text>
                      <Text style={styles.descToggleText}>{isDescriptionExpanded ? 'Show less' : '...more'}</Text>
                    </TouchableOpacity>

                    {/* Comments Preview Section */}
                    <TouchableOpacity style={styles.commentsPreviewCard} onPress={() => setIsCommentsOpen(true)}>
                      <View style={styles.commentsPreviewHeader}>
                        <Text style={styles.commentsTitleText}>Comments <Text style={{ color: '#64748b' }}>1.4K</Text></Text>
                        <Ionicons name="chevron-forward" size={18} color="#0f172a" />
                      </View>
                      <View style={styles.commentSnippetRow}>
                        <Image source={{ uri: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=100' }} style={styles.snippetAvatar} />
                        <Text style={styles.snippetText} numberOfLines={1}>Amazing review! The camera quality looks insane 🔥</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  {/* Up Next / Related Videos */}
                  <View style={styles.relatedSection}>
                    <Text style={styles.relatedHeaderTitle}>Up Next</Text>
                    {renderRelatedCard('भारत के प्राचीन ज्ञान का रहस्य! | Akshat Gupta', 'TV9 Bharatvarsh', '200K views • 3 weeks ago', '17:49', 'https://img.youtube.com/vi/YTz6bG8fyps/hqdefault.jpg')}
                    {renderRelatedCard('विज्ञान भी देता है ईश्वर का सबूत? | Sanatan Mysteries', 'TV9 Bharatvarsh', '129K views • 10 days ago', '17:58', 'https://img.youtube.com/vi/6LpxmlP109s/hqdefault.jpg')}
                    {renderRelatedCard('ROAST: Vaibhav Suryavanshi के सवाल पर क्यों भड़क गए Shreyas Iyer?', 'The Lallantop', '139K views • 4 months ago', '18:44', 'https://img.youtube.com/vi/UnAZewJjjtE/hqdefault.jpg')}
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </>
      )}

      {/* 3-DOTS BOTTOM SHEET MENU */}
      <Modal
        visible={isMenuOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsMenuOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setIsMenuOpen(false)}>
            <View style={styles.modalDismissArea} />
          </TouchableWithoutFeedback>

          <View style={styles.bottomSheetContainer}>
            <View style={styles.bottomSheetHandle} />
            <Text style={styles.sheetTitle}>Short details</Text>

            <TouchableOpacity style={styles.sheetOptionRow} onPress={() => setIsMenuOpen(false)}>
              <Ionicons name="information-circle-outline" size={22} color="#111827" style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Description & hashtags</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOptionRow} onPress={() => setIsMenuOpen(false)}>
              <Ionicons name="chatbubbles-outline" size={22} color="#111827" style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Comments</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOptionRow} onPress={() => setIsMenuOpen(false)}>
              <Ionicons name="repeat-outline" size={22} color="#111827" style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Remix this short</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOptionRow} onPress={() => setIsMenuOpen(false)}>
              <Ionicons name="flag-outline" size={22} color="#111827" style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Report</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOptionRow} onPress={() => setIsMenuOpen(false)}>
              <Ionicons name="code-slash-outline" size={22} color="#111827" style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Quality / Audio track</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* COMMENTS BOTTOM SHEET */}
      <Modal
        visible={isCommentsOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsCommentsOpen(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setIsCommentsOpen(false)}>
            <View style={styles.modalDismissArea} />
          </TouchableWithoutFeedback>

          <View style={styles.commentsModalContainer}>
            <View style={styles.bottomSheetHandle} />
            <View style={styles.commentsHeaderRow}>
              <Text style={styles.commentsMainTitle}>Comments <Text style={{ color: '#64748b', fontSize: 13 }}>1.4K</Text></Text>
              <TouchableOpacity onPress={() => setIsCommentsOpen(false)}>
                <Ionicons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={commentsList}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.commentItemRow}>
                  <Image source={{ uri: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=100' }} style={styles.commentUserAvatar} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.commentMetaRow}>
                      <Text style={styles.commentUserHandle}>{item.user}</Text>
                      <Text style={styles.commentTimeText}>{item.time}</Text>
                    </View>
                    <Text style={styles.commentTextContent}>{item.text}</Text>
                    <View style={styles.commentActionRow}>
                      <Ionicons name="thumbs-up-outline" size={14} color="#64748b" style={{ marginRight: 4 }} />
                      <Text style={styles.commentLikesCount}>{item.likes}</Text>
                      <Ionicons name="thumbs-down-outline" size={14} color="#64748b" style={{ marginLeft: 16, marginRight: 4 }} />
                    </View>
                  </View>
                </View>
              )}
              contentContainerStyle={{ paddingVertical: 10 }}
              style={{ maxHeight: height * 0.45 }}
            />

            {/* Add Comment Input Bar */}
            <View style={styles.addCommentBar}>
              <Image source={{ uri: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=100' }} style={styles.currentUserAvatar} />
              <TextInput 
                style={styles.commentInputBox}
                placeholder="Add a comment..."
                placeholderTextColor="#94a3b8"
                value={newComment}
                onChangeText={setNewComment}
              />
              <TouchableOpacity onPress={addComment} style={styles.sendCommentBtn}>
                <Ionicons name="send" size={18} color="#ff0000" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FULLSCREEN MODAL */}
      <Modal 
        visible={isFullscreen} 
        animationType="fade" 
        transparent={false}
        statusBarTranslucent={true}
        onRequestClose={() => setIsFullscreen(false)}
        supportedOrientations={['landscape', 'portrait', 'landscape-left', 'landscape-right']}
      >
        <View style={styles.fullscreenContainer}>
          <Image 
            source={{ uri: 'https://img.youtube.com/vi/Ww84NpNpRfo/hqdefault.jpg' }} 
            style={styles.fullscreenVideo} 
            resizeMode="contain"
          />
          <View style={styles.fullscreenOverlay} />

          <View style={styles.fullscreenTopBar}>
            <Text style={styles.fullscreenTitle} numberOfLines={1}>
              क्या सच में 2036 से आया था ये आदमी? 5 Real Time Travel Cases
            </Text>

            <View style={styles.fullscreenControlsGroup}>
              <TouchableOpacity style={styles.controlIconButton} onPress={toggleRotate}>
                <MaterialCommunityIcons name="screen-rotation" size={20} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity style={styles.controlIconButton} onPress={() => setIsFullscreen(false)}>
                <MaterialCommunityIcons name="fullscreen-exit" size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity 
            style={styles.fullscreenPlayBtn}
            onPress={() => setIsPlaying(!isPlaying)}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={32} color="#ffffff" style={{ marginLeft: isPlaying ? 0 : 3 }} />
          </TouchableOpacity>

          <View style={styles.fullscreenBottomBar}>
            <Text style={styles.fullscreenTime}>{isPlaying ? "05:42 / 30:41" : "00:00 / 30:41"}</Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: isPlaying ? '40%' : '0%' }]} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function renderRelatedCard(title: string, channel: string, stats: string, duration: string, thumb: string) {
  return (
    <TouchableOpacity style={styles.relatedCard}>
      <View style={styles.thumbnailWrapper}>
        <Image source={{ uri: thumb }} style={styles.relatedThumb} />
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{duration}</Text>
        </View>
      </View>
      <View style={styles.relatedMeta}>
        <Text style={styles.relatedTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.relatedChannel}>{channel}</Text>
        <Text style={styles.relatedStats}>{stats}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  headerSafeArea: { backgroundColor: '#ffffff', zIndex: 50 },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  floatingHeaderSafeArea: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50 },
  floatingHeaderContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  floatingSwitchBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  headerLeftBrand: { flexDirection: 'row', alignItems: 'center' },
  appLogoBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#ff0000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  reelTopLeftDots: {
    position: 'absolute',
    top: 50,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
  },
  headerRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  videoContainer: {
    height: 230,
    width: '100%',
    backgroundColor: '#000000',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  videoCover: { width: '100%', height: '100%', position: 'absolute' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  playButtonCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ff0000',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 20,
  },
  videoBottomBar: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 20,
  },
  timestampText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  videoInfoSection: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  videoTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  viewsText: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  moreTagsText: { fontSize: 12, color: '#ff0000', fontWeight: '600', marginLeft: 8 },
  interactiveSection: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  channelBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  channelLeft: { flexDirection: 'row', alignItems: 'center' },
  channelAvatar: { width: 38, height: 38, borderRadius: 19, marginRight: 10 },
  channelName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  subCountText: { fontSize: 11, color: '#64748b', marginTop: 1 },
  subscribeBtn: { backgroundColor: '#0f172a', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18 },
  subscribedBtn: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  subscribeText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  subscribedText: { color: '#0f172a' },
  actionsScrollRow: { marginTop: 14, marginHorizontal: -16, paddingHorizontal: 16 },
  actionsBarYouTube: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  actionButtonYouTube: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  actionDivider: { width: 1, height: 16, backgroundColor: '#cbd5e1', marginHorizontal: 10 },
  actionButtonText: { fontSize: 12, fontWeight: '600', color: '#0f172a', marginLeft: 6 },
  actionPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  pillText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  descriptionBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  descHeading: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  descContent: { fontSize: 12, color: '#334155', lineHeight: 18 },
  descToggleText: { fontSize: 12, fontWeight: '700', color: '#0f172a', marginTop: 4 },
  commentsPreviewCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  commentsPreviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  commentsTitleText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  commentSnippetRow: { flexDirection: 'row', alignItems: 'center' },
  snippetAvatar: { width: 22, height: 22, borderRadius: 11, marginRight: 8 },
  snippetText: { fontSize: 12, color: '#334151', flex: 1 },
  relatedSection: { paddingHorizontal: 16, paddingTop: 16 },
  relatedHeaderTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  relatedCard: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  thumbnailWrapper: { width: 130, height: 80, position: 'relative', borderRadius: 8, overflow: 'hidden' },
  relatedThumb: { width: '100%', height: '100%' },
  durationBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  durationText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  relatedMeta: { flex: 1, marginLeft: 10, justifyContent: 'center' },
  relatedTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', lineHeight: 18 },
  relatedChannel: { fontSize: 11, color: '#64748b', marginTop: 3 },
  relatedStats: { fontSize: 11, color: '#64748b', marginTop: 1 },
  trueFullScreenReel: { flex: 1, backgroundColor: '#000000', position: 'relative' },
  reelMedia: { width: '100%', height: '100%', position: 'absolute' },
  reelOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  reelFooter: { position: 'absolute', bottom: 30, left: 16, right: 80, zIndex: 10 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  creatorAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8, borderWidth: 1, borderColor: '#ffffff' },
  creatorHandle: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  subscribeShortsBtn: { backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  subscribedShortsBtn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  subscribeShortsText: { fontSize: 12, fontWeight: '700', color: '#000000' },
  subscribedShortsText: { color: '#ffffff' },
  reelCaption: { fontSize: 13, color: '#ffffff', lineHeight: 18, marginBottom: 8 },
  commissionRow: { flexDirection: 'row', alignItems: 'center' },
  commissionText: { fontSize: 11, color: '#e2e8f0', fontWeight: '500' },
  shortsProgressBarBg: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  shortsProgressBarFill: { width: '35%', height: '100%', backgroundColor: '#ff0000' },
  verticalActionsBar: { position: 'absolute', right: 12, bottom: 40, alignItems: 'center', zIndex: 20 },
  verticalActionItem: { alignItems: 'center', marginBottom: 16 },
  actionIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', marginBottom: 3 },
  actionCountText: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalDismissArea: { flex: 1 },
  bottomSheetContainer: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 30, paddingTop: 10 },
  bottomSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#cbd5e1', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 14 },
  sheetOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  sheetIcon: { marginRight: 16 },
  sheetOptionText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  commentsModalContainer: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 20, paddingTop: 10 },
  commentsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  commentsMainTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  commentItemRow: { flexDirection: 'row', paddingVertical: 10 },
  commentUserAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 10 },
  commentMetaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  commentUserHandle: { fontSize: 12, fontWeight: '700', color: '#64748b', marginRight: 8 },
  commentTimeText: { fontSize: 10, color: '#94a3b8' },
  commentTextContent: { fontSize: 13, color: '#0f172a', lineHeight: 18 },
  commentActionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  commentLikesCount: { fontSize: 11, color: '#64748b' },
  addCommentBar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, marginTop: 6 },
  currentUserAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  commentInputBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 13, color: '#0f172a', borderWidth: 1, borderColor: '#e2e8f0' },
  sendCommentBtn: { padding: 8, marginLeft: 6 },
  fullscreenContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  fullscreenVideo: { width: '100%', height: '100%', position: 'absolute' },
  fullscreenOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' },
  fullscreenTopBar: { position: 'absolute', top: 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 30 },
  fullscreenTitle: { color: '#ffffff', fontSize: 14, fontWeight: '700', flex: 1, marginRight: 20 },
  fullscreenControlsGroup: { flexDirection: 'row', alignItems: 'center' },
  controlIconButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  fullscreenPlayBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 30 },
  fullscreenBottomBar: { position: 'absolute', bottom: 20, left: 20, right: 20, zIndex: 30 },
  fullscreenTime: { color: '#ffffff', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  progressBarBg: { height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 1.5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#ff0000' },
});