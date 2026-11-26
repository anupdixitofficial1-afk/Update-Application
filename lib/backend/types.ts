export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  username: string;
  phone?: string;
  avatarUrl?: string | null;
  isProfileCompleted?: boolean;
  isVerified?: boolean;
}

export interface VerificationRequestRecord {
  id: string;
  user_id: string;
  full_name: string;
  username?: string | null;
  category?: string | null;
  reason: string;
  document_url?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewer_note?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
}

export interface FeedPost {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string | null;
  caption: string;
  visibility: string;
  mediaType: 'image' | 'video';
  mediaUrl?: string | null;
  photos: string[];
  meta?: Record<string, any>;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
}

export interface WatchReactionRow {
  media_id: string;
  liked: boolean;
  disliked: boolean;
  saved: boolean;
}

export interface WatchCommentRow {
  id: string;
  media_id: string;
  author: string;
  comment_text: string;
  created_at?: string;
}

export interface ChatUserProfile {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  last_seen?: string | null;
  updated_at?: string | null;
  is_online?: boolean | null;
}

export interface ChatMessageRecord {
  id: string;
  sender_id?: string | null;
  receiver_id?: string | null;
  content?: string | null;
  body?: string | null;
  message?: string | null;
  text?: string | null;
  msg?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
  read_at?: string | null;
  seen_at?: string | null;
}

export interface ChatRoomChannel {
  send: (msg: {
    type: 'broadcast';
    event: string;
    payload: Record<string, any>;
  }) => Promise<any> | void;
  unsubscribe: () => void;
}

export interface LiveStreamRecord {
  id: string;
  title?: string | null;
  viewer_count?: number | null;
  is_live?: boolean | null;
}

export interface LiveChatMessageRecord {
  id: string;
  username: string;
  message: string;
  color: string;
}

export interface LiveJoinRequestRecord {
  id: string;
  username: string;
  status?: 'pending' | 'accepted' | 'declined';
}

export interface LivePresenceEntry {
  key: string;
  name: string;
  role: string;
}

export interface LiveRoomChannel {
  send: (msg: {
    type: 'broadcast';
    event: string;
    payload: Record<string, any>;
  }) => void;
  track: (state: Record<string, any>) => void;
  unsubscribe: () => void;
}

export interface BackendProvider {
  auth: {
    getCurrentUser: () => Promise<AppUser | null>;
    getSessionInfo: () => Promise<{
      email: string;
      lastSignInAt?: string | null;
    } | null>;
    onAuthStateChange: (
      callback: (isSignedIn: boolean) => void
    ) => () => void;
    signInWithIdentifier: (
      identifier: string,
      password: string,
      countryCode?: string
    ) => Promise<AppUser>;
    signUp: (payload: {
      fullName: string;
      username: string;
      email: string;
      password: string;
      countryCode: string;
      mobileNumber: string;
    }) => Promise<void>;
    signOut: () => Promise<void>;
    signOutOtherDevices: () => Promise<void>;
    updatePassword: (newPassword: string) => Promise<void>;
    sendPasswordReset: (email: string) => Promise<void>;
    checkAvailability: (
      field: 'username' | 'email' | 'phone',
      value: string
    ) => Promise<boolean>;
  };
  storage: {
    uploadMedia: (localUri: string, folder?: string) => Promise<string>;
    uploadAvatar: (userId: string, localUri: string) => Promise<string>;
  };
  posts: {
    getFeed: (limit?: number) => Promise<FeedPost[]>;
    createPost: (payload: Record<string, any>) => Promise<void>;
    getUserInteractions: (userId: string) => Promise<{
      likedIds: string[];
      savedIds: string[];
      hiddenIds: string[];
    }>;
    toggleInteraction: (
      userId: string,
      postId: string,
      patch: Partial<{ liked: boolean; saved: boolean; hidden: boolean }>
    ) => Promise<void>;
    getHomeExtras: (userId: string | null) => Promise<{
      stories: Array<{
        id: string;
        authorId: string;
        name: string;
        imageUrl: string;
        isLive?: boolean;
        hasActiveStory?: boolean;
        storyItems?: Array<{
          id: string;
          mediaUrl: string;
          mediaType: 'image' | 'video';
          caption?: string;
          createdAt: string;
        }>;
      }>;
      myStories?: Array<{
        id: string;
        mediaUrl: string;
        mediaType: 'image' | 'video';
        caption?: string;
        createdAt: string;
      }>;
      followingIds: string[];
      unreadMessagesCount: number;
      unreadNotificationsCount: number;
    }>;
    createStory: (payload: {
      userId: string;
      mediaUri: string;
      mediaType: 'image' | 'video';
      caption?: string;
    }) => Promise<{
      id: string;
      mediaUrl: string;
      mediaType: 'image' | 'video';
      caption?: string;
      createdAt: string;
    }>;
    deleteStory: (storyId: string, userId: string) => Promise<void>;
  };
  social: {
    getBlockedRelationships: (userId: string) => Promise<{
      blockedByMe: string[];
      blockingMe: string[];
    }>;
    blockUser: (blockerId: string, blockedId: string) => Promise<void>;
  };
  watch: {
    getWatchData: (
      userKey: string,
      limit?: number
    ) => Promise<{
      reactions: WatchReactionRow[];
      subscriptions: string[];
      comments: WatchCommentRow[];
      media: any[];
    }>;
    upsertReaction: (
      userKey: string,
      mediaId: string,
      patch: Partial<{ liked: boolean; disliked: boolean; saved: boolean }>
    ) => Promise<void>;
    setSubscription: (
      userKey: string,
      creatorHandle: string,
      subscribed: boolean
    ) => Promise<void>;
    addComment: (payload: {
      id: string;
      mediaId: string;
      author: string;
      text: string;
    }) => Promise<void>;
  };
  studio: {
    getCreatorQuickStats: (userId: string) => Promise<{
      uploads: number;
      followers: number;
      views: number;
    }>;
    getDashboardData: (userId: string) => Promise<{
      followersCount: number;
      media: any[];
      comments: any[];
    }>;
    uploadWatchFile: (
      localUri: string,
      folder: string,
      ext: string,
      mimeType: string
    ) => Promise<string | null>;
    uploadAsset: (
      localUri: string,
      kind: 'video' | 'thumbnail',
      userId: string,
      onProgress?: (msg: string, pct?: number) => void,
      mediaFolder?: 'video' | 'reels' | 'live'
    ) => Promise<string>;
    upsertWatchMedia: (
      payload: Record<string, any>,
      existingId?: string | null
    ) => Promise<any>;
    updateWatchMedia: (
      mediaId: string,
      patch: Record<string, any>
    ) => Promise<void>;
    deleteWatchMedia: (mediaId: string) => Promise<void>;
    deleteWatchComment: (commentId: string) => Promise<void>;
  };
  connect: {
    getProfiles: (
      excludeUserId: string | null,
      searchPattern?: string
    ) => Promise<any[]>;
    getMyCoordinates: (
      userId: string
    ) => Promise<{ lat: number | null; lng: number | null }>;
    getRelations: (userId: string) => Promise<{
      followingIds: string[];
      requestedIds: string[];
      blockedIds: string[];
      mutedIds: string[];
      incomingRequests: { id: string; follower_id: string }[];
    }>;
    getConnectionsTabData: (
      profileId: string,
      tab: 'followers' | 'following' | 'subscriptions',
      currentAuthId: string | null
    ) => Promise<{
      followersCount: number;
      followingCount: number;
      subscriptionsCount: number;
      myFollowingIds: string[];
      users: any[];
    }>;
    followUser: (
      followerId: string,
      followingId: string,
      isPrivate?: boolean
    ) => Promise<'accepted' | 'pending'>;
    unfollowUser: (followerId: string, followingId: string) => Promise<void>;
    acceptFollowRequest: (
      requestId: string,
      myId: string,
      requesterId: string
    ) => Promise<void>;
    acceptAllFollowRequests: (
      requestIds: string[],
      myId: string
    ) => Promise<void>;
    declineFollowRequest: (
      requestId: string,
      myId: string,
      requesterId: string
    ) => Promise<void>;
    setUserMuted: (
      muterId: string,
      mutedId: string,
      muted: boolean
    ) => Promise<void>;
    blockAndUnfollow: (blockerId: string, blockedId: string) => Promise<void>;
    sendWave: (actorId: string, targetUserId: string) => Promise<void>;
    subscribeFollowChanges: (
      userId: string,
      onChange: () => void
    ) => () => void;
  };
  profile: {
    getProfileById: (profileId: string) => Promise<any | null>;
    upsertProfile: (
      userId: string,
      fields: Record<string, any>
    ) => Promise<void>;
    isUsernameAvailableForUser: (
      plainHandle: string,
      currentUserId: string | null
    ) => Promise<boolean>;
    getFollowRelationship: (
      viewerId: string,
      viewedId: string
    ) => Promise<{ isFollowing: boolean; isFollowedBy: boolean }>;
    getBlockStatus: (
      viewerId: string,
      viewedId: string
    ) => Promise<{ isBlockedByMe: boolean; isBlockingMe: boolean }>;
    unblockUser: (blockerId: string, blockedId: string) => Promise<void>;
    getProfileCounts: (profileId: string) => Promise<{
      followersCount: number | null;
      followingCount: number | null;
      subscriptionsCount: number;
    }>;
    getPrivacySettings: (profileId: string) => Promise<{
      profileViewAlerts: boolean;
      preventScreenshots: boolean;
      screenshotAlerts: boolean;
      [key: string]: any;
    } | null>;
    sendNotification: (payload: {
      userId: string;
      actorId: string;
      type: string;
      message: string;
    }) => Promise<void>;
    subscribeProfileRow: (
      profileId: string,
      onUpdate: (row: any) => void
    ) => () => void;
    getProfileContent: (
      profileId: string,
      viewerId: string | null
    ) => Promise<{
      posts: Array<{
        id: string;
        title: string;
        views?: string;
        duration?: string;
        thumbnail: string;
        type: 'post' | 'video' | 'short';
        uploadDate?: string;
      }>;
      videos: Array<{
        id: string;
        title: string;
        views?: string;
        duration?: string;
        thumbnail: string;
        type: 'post' | 'video' | 'short';
        uploadDate?: string;
      }>;
      live: Array<{
        id: string;
        title: string;
        views?: string;
        duration?: string;
        thumbnail: string;
        type: 'post' | 'video' | 'short';
        uploadDate?: string;
      }>;
    }>;
    getVerificationStatus: (userId: string) => Promise<{
      isVerified: boolean;
      latestRequest: VerificationRequestRecord | null;
    }>;
    submitVerificationRequest: (payload: {
      userId: string;
      fullName: string;
      username?: string;
      category: string;
      reason: string;
      documentUrl?: string;
    }) => Promise<VerificationRequestRecord>;
  };
  settings: {
    getBlockedUsers: (blockerId: string) => Promise<
      Array<{
        id: string;
        blocked_id: string;
        name: string;
        handle: string;
      }>
    >;
    getPrivacySettings: (userId: string) => Promise<Record<string, any> | null>;
    savePrivacySettings: (
      userId: string,
      privacySettings: Record<string, any>,
      flatColumns?: Record<string, any>
    ) => Promise<void>;
  };
  notifications: {
    getNotifications: (userId: string, limit?: number) => Promise<any[]>;
    markAsRead: (notificationId: string) => Promise<void>;
    markAllAsRead: (userId: string) => Promise<void>;
    deleteNotification: (notificationId: string) => Promise<void>;
    subscribeNotifications: (
      userId: string,
      onInsert: (row: any) => void
    ) => () => void;
  };
  chats: {
    touchLastSeen: (userId: string) => Promise<void>;
    getConversationMessages: (userId: string) => Promise<ChatMessageRecord[]>;
    getPeerProfiles: (
      excludeUserId: string | null
    ) => Promise<ChatUserProfile[]>;
    markThreadRead: (userId: string, peerId: string) => Promise<void>;
    deleteConversation: (userId: string, peerId: string) => Promise<void>;
    upsertPreferences: (
      userId: string,
      peerId: string,
      patch: Record<string, any>
    ) => Promise<void>;
    subscribeInboxEvents: (
      userId: string,
      handlers: {
        onMessageInsert: (row: ChatMessageRecord) => void;
        onMessageUpdate: (row: ChatMessageRecord) => void;
        onProfileUpdate: (row: ChatUserProfile) => void;
      }
    ) => () => void;
  };
  messages: {
    areMutualFollowers: (meId: string, peerId: string) => Promise<boolean>;
    markMessagesSeen: (
      myId: string,
      senderId: string,
      seenIso: string
    ) => Promise<void>;
    getThreadMessages: (
      myId: string,
      peerId: string
    ) => Promise<ChatMessageRecord[]>;
    sendMessage: (payload: {
      senderId: string;
      receiverId: string;
      content: string;
    }) => Promise<ChatMessageRecord | null>;
    updateMessageText: (messageId: string, text: string) => Promise<void>;
    deleteMessageById: (messageId: string) => Promise<void>;
    savePushToken: (userId: string, token: string) => Promise<void>;
    sendDirectAlert: (
      recipientUserId: string,
      event: string,
      payload: Record<string, any>
    ) => Promise<void>;
    triggerCallPush: (payload: {
      calleeId: string;
      callerId: string;
      callerName: string;
      callerAvatar: string;
      callId: string;
      callType: 'voice' | 'video';
    }) => Promise<void>;
    subscribeThreadMessages: (
      myId: string,
      peerId: string,
      handlers: {
        onInsert: (row: ChatMessageRecord) => void;
        onUpdate: (row: ChatMessageRecord) => void;
      }
    ) => () => void;
    joinRoomChannel: (
      myId: string,
      peerId: string,
      onEvent: (event: string, payload: any) => void
    ) => ChatRoomChannel;
  };
  live: {
    getCurrentUserLiveProfile: () => Promise<{
      userId: string;
      name: string;
      avatarUri?: string;
      followersCount: number;
    } | null>;
    getRoomBundle: (
      streamId: string,
      isHost: boolean
    ) => Promise<{
      stream: LiveStreamRecord | null;
      messages: LiveChatMessageRecord[];
      pendingRequests: LiveJoinRequestRecord[];
    }>;
    createStreamSession: (payload: {
      hostName: string;
      title: string;
    }) => Promise<LiveStreamRecord | null>;
    updateStreamStatus: (
      streamId: string,
      patch: Record<string, any>
    ) => Promise<void>;
    sendChatMessage: (payload: {
      streamId: string;
      username: string;
      message: string;
      color: string;
    }) => Promise<LiveChatMessageRecord | null>;
    deleteChatMessage: (messageId: string) => Promise<void>;
    createJoinRequest: (payload: {
      streamId: string;
      username: string;
    }) => Promise<LiveJoinRequestRecord | null>;
    updateJoinRequestStatus: (
      requestId: string,
      status: 'accepted' | 'declined'
    ) => Promise<void>;
    uploadRecordingReplay: (
      fileUri: string,
      streamId?: string
    ) => Promise<string | null>;
    joinLiveRoom: (
      streamId: string,
      presenceKey: string,
      handlers: {
        onMessageInsert: (row: LiveChatMessageRecord) => void;
        onMessageDelete: (oldId: string) => void;
        onJoinRequestInsert: (row: LiveJoinRequestRecord) => void;
        onJoinRequestUpdate: (row: LiveJoinRequestRecord) => void;
        onStreamUpdate: (row: LiveStreamRecord) => void;
        onBroadcast: (event: string, payload: any) => void;
        onPresenceSync: (list: LivePresenceEntry[]) => void;
        onSubscribed: () => void;
      }
    ) => LiveRoomChannel;
  };
}