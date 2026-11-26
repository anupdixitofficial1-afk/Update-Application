export interface CommentEntry {
  id: string;
  author: string;
  text: string;
  timeAgo: string;
}

export interface WatchStateSnapshot {
  likedIds: Record<string, boolean>;
  dislikedIds: Record<string, boolean>;
  savedIds: Record<string, boolean>;
  subscribedHandles: Record<string, boolean>;
  commentsByMedia: Record<string, CommentEntry[]>;
}

export interface WatchRepository {
  loadInitialState(): Promise<WatchStateSnapshot>;
  setLike(mediaId: string, liked: boolean): Promise<void>;
  setDislike(mediaId: string, disliked: boolean): Promise<void>;
  setSaved(mediaId: string, saved: boolean): Promise<void>;
  setSubscribed(creatorHandle: string, subscribed: boolean): Promise<void>;
  addComment(mediaId: string, comment: CommentEntry): Promise<void>;
}