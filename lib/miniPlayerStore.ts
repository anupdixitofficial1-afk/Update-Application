export interface MiniPlayerSession {
  id: string;
  kind: 'video' | 'live';
  title: string;
  creatorName: string;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  isLive?: boolean;
  isPlaying: boolean;
  expandRoute: string;
  expandParams?: Record<string, string>;
}

type Listener = (session: MiniPlayerSession | null) => void;

let currentSession: MiniPlayerSession | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) {
    fn(currentSession);
  }
}

export function subscribeMiniPlayer(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentSession);
  return () => {
    listeners.delete(listener);
  };
}

export function openMiniPlayer(session: MiniPlayerSession) {
  currentSession = session;
  emit();
}

export function toggleMiniPlayerPlay() {
  if (!currentSession) return;
  currentSession = {
    ...currentSession,
    isPlaying: !currentSession.isPlaying,
  };
  emit();
}

export function closeMiniPlayer() {
  if (!currentSession) return;
  currentSession = null;
  emit();
}

export function getMiniPlayerSession(): MiniPlayerSession | null {
  return currentSession;
}
