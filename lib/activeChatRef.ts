let activePeerId: string | null = null;

export function setActiveChatPeerId(peerId: string | null) {
  activePeerId = peerId ? peerId.trim() : null;
}

export function getActiveChatPeerId(): string | null {
  return activePeerId;
}
