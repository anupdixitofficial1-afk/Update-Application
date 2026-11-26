import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

interface MediaVideoPlayerProps {
  uri: string;
  isPlaying: boolean;
  isMuted: boolean;
  loop?: boolean;
  contentFit?: 'cover' | 'contain';
  onProgress?: (elapsedSec: number, durationSec: number) => void;
}

export function MediaVideoPlayer({
  uri,
  isPlaying,
  isMuted,
  loop = false,
  contentFit = 'cover',
  onProgress,
}: MediaVideoPlayerProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
    p.muted = isMuted;
    if (isPlaying) {
      p.play();
    }
  });

  useEffect(() => {
    player.muted = isMuted;
  }, [player, isMuted]);

  useEffect(() => {
    if (isPlaying) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, isPlaying]);

  useEffect(() => {
    if (!onProgress) return;
    const interval = setInterval(() => {
      onProgress(player.currentTime || 0, player.duration || 0);
    }, 500);
    return () => clearInterval(interval);
  }, [player, onProgress]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        nativeControls={false}
      />
    </View>
  );
}