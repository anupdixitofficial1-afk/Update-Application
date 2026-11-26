import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  applyCallAudioMode,
  startCallRingAudio,
  stopCallRingAudio,
} from '../lib/callAudio';

let webrtcModule: any = null;
try {
  webrtcModule = require('react-native-webrtc');
} catch {
  webrtcModule = null;
}

let InCallManager: any = null;
try {
  const incall = require('react-native-incall-manager');
  InCallManager = incall?.default ?? incall;
} catch {
  InCallManager = null;
}

let ScreenCapture: any = null;
try {
  ScreenCapture = require('expo-screen-capture');
} catch {
  ScreenCapture = null;
}

export type CallConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export type NetworkQuality = 'good' | 'fair' | 'poor' | 'unknown';
export type AudioRouteType =
  | 'EARPIECE'
  | 'SPEAKER_PHONE'
  | 'BLUETOOTH'
  | 'WIRED_HEADSET';

export interface WebRtcCallOptions {
  /** Relay-only IP protection (requires TURN server in iceServers) */
  protectIp?: boolean;
  /** Optional custom TURN/STUN servers */
  customIceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  /** Block screenshots & screen recording during active calls */
  blockScreenCapture?: boolean;
  /** Auto-end unanswered ringing call after ms (default: 40000ms) */
  ringTimeoutMs?: number;
  /** Called when unanswered call times out */
  onCallTimeout?: () => void;
  /** Called if peer takes a screenshot during the call */
  onPeerScreenshot?: () => void;
}

const DEFAULT_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
];

export function useWebRtcCall(
  channel: any,
  currentUserId: string | null,
  _targetUserId?: string,
  options: WebRtcCallOptions = {}
) {
  const {
    protectIp = false,
    customIceServers,
    blockScreenCapture = true,
    ringTimeoutMs = 40000,
    onCallTimeout,
    onPeerScreenshot,
  } = options;

  const [localStreamUrl, setLocalStreamUrl] = useState<string | null>(null);
  const [remoteStreamUrl, setRemoteStreamUrl] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [audioRoute, setAudioRouteState] = useState<AudioRouteType>('EARPIECE');
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isOnHold, setIsOnHold] = useState(false);
  const [connectionState, setConnectionState] =
    useState<CallConnectionState>('idle');
  const [networkQuality, setNetworkQuality] =
    useState<NetworkQuality>('unknown');
  const [lastReaction, setLastReaction] = useState<{
    emoji: string;
    senderId: string;
    ts: number;
  } | null>(null);

  const pcRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const pendingIceRef = useRef<any[]>([]);
  const channelRef = useRef<any>(channel);

  const speakerRef = useRef<boolean>(false);
  const routeRef = useRef<AudioRouteType>('EARPIECE');
  const isVideoRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const isHoldRef = useRef<boolean>(false);
  const callSessionStartedRef = useRef<boolean>(false);

  const speakerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptedRef = useRef<boolean>(false);
  const screenshotSubRef = useRef<any>(null);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  const clearSpeakerTimers = useCallback(() => {
    speakerTimersRef.current.forEach((t) => clearTimeout(t));
    speakerTimersRef.current = [];
  }, []);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const stopStatsMonitor = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setNetworkQuality('unknown');
  }, []);

  // Privacy: Screenshot & Screen-Recording Protection
  const enableScreenProtection = useCallback(async () => {
    if (!blockScreenCapture || !ScreenCapture) return;
    try {
      if (typeof ScreenCapture.preventScreenCaptureAsync === 'function') {
        await ScreenCapture.preventScreenCaptureAsync('webrtc-call');
      }
      if (
        typeof ScreenCapture.addScreenshotListener === 'function' &&
        !screenshotSubRef.current
      ) {
        screenshotSubRef.current = ScreenCapture.addScreenshotListener(() => {
          try {
            if (channelRef.current && currentUserId) {
              void channelRef.current.send({
                type: 'broadcast',
                event: 'webrtc_screenshot_alert',
                payload: { senderId: currentUserId, ts: Date.now() },
              });
            }
          } catch {
            // Ignore broadcast error
          }
        });
      }
    } catch {
      // Ignore screen capture errors
    }
  }, [blockScreenCapture, currentUserId]);

  const disableScreenProtection = useCallback(async () => {
    try {
      if (screenshotSubRef.current?.remove) {
        screenshotSubRef.current.remove();
      }
      screenshotSubRef.current = null;
      if (
        ScreenCapture &&
        typeof ScreenCapture.allowScreenCaptureAsync === 'function'
      ) {
        await ScreenCapture.allowScreenCaptureAsync('webrtc-call');
      }
    } catch {
      // Ignore
    }
  }, []);

  // Audio Route + Proximity Sensor Management
  const applyAudioRoute = useCallback(
    (route: AudioRouteType) => {
      const useSpeaker = route === 'SPEAKER_PHONE';
      routeRef.current = route;
      speakerRef.current = useSpeaker;
      setAudioRouteState(route);
      setIsSpeakerOn(useSpeaker);

      const runRoute = () => {
        void applyCallAudioMode({
          speaker: useSpeaker,
          allowsRecording: true,
        });
        try {
          if (!InCallManager) return;

          // Keep screen on for video/speaker; let proximity sensor handle earpiece
          if (typeof InCallManager.setKeepScreenOn === 'function') {
            InCallManager.setKeepScreenOn(isVideoRef.current || useSpeaker);
          }
          if (typeof InCallManager.setForceSpeakerphoneOn === 'function') {
            InCallManager.setForceSpeakerphoneOn(
              route === 'SPEAKER_PHONE'
                ? true
                : route === 'EARPIECE'
                  ? false
                  : null
            );
          }
          if (typeof InCallManager.setSpeakerphoneOn === 'function') {
            InCallManager.setSpeakerphoneOn(useSpeaker);
          }
          if (typeof InCallManager.chooseAudioRoute === 'function') {
            InCallManager.chooseAudioRoute(route);
          }
        } catch {
          // Ignore native audio route errors
        }
      };

      runRoute();
      clearSpeakerTimers();

      // Re-apply after Android WebRTC audio focus settles
      speakerTimersRef.current = [
        setTimeout(runRoute, 300),
        setTimeout(runRoute, 900),
      ];
    },
    [clearSpeakerTimers]
  );

  const stopRingtone = useCallback(() => {
    clearRingTimeout();
    stopCallRingAudio();
    try {
      if (InCallManager && typeof InCallManager.stopRingtone === 'function') {
        InCallManager.stopRingtone();
      }
      if (InCallManager && typeof InCallManager.stopRingback === 'function') {
        InCallManager.stopRingback();
      }
    } catch {
      // Ignore ringtone stop error
    }
  }, [clearRingTimeout]);

  const startRingtone = useCallback(
    (withVideo = false, forCaller = false) => {
      void startCallRingAudio({
        isOutgoing: forCaller,
        speaker: withVideo || speakerRef.current,
      });
      try {
        if (InCallManager) {
          if (typeof InCallManager.startRingtone === 'function') {
            InCallManager.startRingtone('_DEFAULT_', 'ringback', 'default', 0);
          }
        }
      } catch {
        // Ignore ringtone start error
      }

      // Auto-end unanswered call after ringTimeoutMs
      clearRingTimeout();
      if (ringTimeoutMs > 0) {
        ringTimeoutRef.current = setTimeout(() => {
          stopRingtone();
          onCallTimeout?.();
        }, ringTimeoutMs);
      }
    },
    [clearRingTimeout, onCallTimeout, ringTimeoutMs, stopRingtone]
  );

  const requestAndroidMediaPermissions = async (withVideo: boolean) => {
    if (Platform.OS !== 'android') return true;
    try {
      const perms = withVideo
        ? [
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.CAMERA,
        ]
        : [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];

      const results = await PermissionsAndroid.requestMultiple(perms);
      const audioOk =
        results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
        PermissionsAndroid.RESULTS.GRANTED;
      if (!withVideo) return audioOk;

      const camOk =
        results[PermissionsAndroid.PERMISSIONS.CAMERA] ===
        PermissionsAndroid.RESULTS.GRANTED;
      return audioOk && camOk;
    } catch {
      return false;
    }
  };

  // Live Network Quality Monitor via pc.getStats()
  const startStatsMonitor = useCallback(
    (pc: any) => {
      stopStatsMonitor();
      if (!pc || typeof pc.getStats !== 'function') return;

      statsIntervalRef.current = setInterval(async () => {
        try {
          const stats = await pc.getStats();
          let rttMs: number | null = null;

          stats?.forEach?.((report: any) => {
            if (
              report?.type === 'candidate-pair' &&
              (report?.state === 'succeeded' || report?.nominated) &&
              typeof report?.currentRoundTripTime === 'number'
            ) {
              rttMs = report.currentRoundTripTime * 1000;
            }
          });

          if (rttMs === null) {
            setNetworkQuality('unknown');
          } else if (rttMs < 150) {
            setNetworkQuality('good');
          } else if (rttMs < 350) {
            setNetworkQuality('fair');
          } else {
            setNetworkQuality('poor');
          }
        } catch {
          // Ignore stats polling errors
        }
      }, 4000);
    },
    [stopStatsMonitor]
  );

  const cleanupPeer = useCallback(() => {
    try {
      stopRingtone();
      clearSpeakerTimers();
      stopStatsMonitor();
      void disableScreenProtection();
      pendingIceRef.current = [];
      reconnectAttemptedRef.current = false;

      if (pcRef.current) {
        try {
          pcRef.current.onicecandidate = null;
          pcRef.current.ontrack = null;
          pcRef.current.onaddstream = null;
          pcRef.current.oniceconnectionstatechange = null;
          pcRef.current.onconnectionstatechange = null;
          pcRef.current.close();
        } catch {
          // Ignore pc close error
        }
        pcRef.current = null;
      }

      if (localStreamRef.current) {
        try {
          localStreamRef.current.getTracks?.().forEach((t: any) => {
            try {
              t.stop();
            } catch {
              // Ignore
            }
          });
        } catch {
          // Ignore
        }
        localStreamRef.current = null;
      }

      if (remoteStreamRef.current) {
        try {
          remoteStreamRef.current.getTracks?.().forEach((t: any) => {
            try {
              t.stop();
            } catch {
              // Ignore
            }
          });
        } catch {
          // Ignore
        }
        remoteStreamRef.current = null;
      }

      isMutedRef.current = false;
      isHoldRef.current = false;
      setLocalStreamUrl(null);
      setRemoteStreamUrl(null);
      setIsMuted(false);
      setIsVideoEnabled(false);
      setIsSpeakerOn(false);
      setAudioRouteState('EARPIECE');
      setIsFrontCamera(true);
      setIsOnHold(false);
      setConnectionState('idle');
      setLastReaction(null);

      if (callSessionStartedRef.current && InCallManager) {
        callSessionStartedRef.current = false;
        try {
          if (typeof InCallManager.setKeepScreenOn === 'function') {
            InCallManager.setKeepScreenOn(false);
          }
          if (typeof InCallManager.setForceSpeakerphoneOn === 'function') {
            InCallManager.setForceSpeakerphoneOn(null);
          }
          if (typeof InCallManager.setSpeakerphoneOn === 'function') {
            InCallManager.setSpeakerphoneOn(false);
          }
          if (typeof InCallManager.stop === 'function') {
            InCallManager.stop();
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }, [
    clearSpeakerTimers,
    disableScreenProtection,
    stopRingtone,
    stopStatsMonitor,
  ]);

  const startInCallAudioSession = useCallback(
    (withVideo: boolean) => {
      try {
        if (InCallManager && typeof InCallManager.start === 'function') {
          InCallManager.start({
            media: withVideo ? 'video' : 'audio',
            auto: false,
          });
          callSessionStartedRef.current = true;
        }
      } catch {
        // Ignore InCallManager start error
      }

      applyAudioRoute(withVideo ? 'SPEAKER_PHONE' : 'EARPIECE');
    },
    [applyAudioRoute]
  );

  const attemptIceRestart = useCallback(async (pc: any) => {
    if (!pc || reconnectAttemptedRef.current || !channelRef.current || !currentUserId) {
      return;
    }
    reconnectAttemptedRef.current = true;
    try {
      if (typeof pc.restartIce === 'function') {
        pc.restartIce();
      }
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await channelRef.current.send({
        type: 'broadcast',
        event: 'webrtc_offer',
        payload: {
          senderId: currentUserId,
          sdp: pc.localDescription,
          callType: isVideoRef.current ? 'video' : 'voice',
          isIceRestart: true,
        },
      });
    } catch {
      // Ignore ICE restart failure
    }
  }, [currentUserId]);

  const createPeerConnection = useCallback(
    async (withVideo: boolean, facing: 'front' | 'back' = 'front') => {
      stopRingtone();

      if (!webrtcModule?.RTCPeerConnection || !webrtcModule?.mediaDevices) {
        return null;
      }

      const { RTCPeerConnection, MediaStream, mediaDevices } = webrtcModule;
      isVideoRef.current = Boolean(withVideo);
      isMutedRef.current = false;
      isHoldRef.current = false;
      reconnectAttemptedRef.current = false;

      setIsVideoEnabled(Boolean(withVideo));
      setIsFrontCamera(facing === 'front');
      setIsMuted(false);
      setIsOnHold(false);
      setConnectionState('connecting');

      await requestAndroidMediaPermissions(withVideo);
      await enableScreenProtection();

      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {
          // Ignore
        }
        pcRef.current = null;
      }

      startInCallAudioSession(withVideo);

      const iceServers =
        customIceServers && customIceServers.length > 0
          ? customIceServers
          : DEFAULT_STUN_SERVERS;

      const pcConfig: any = {
        iceServers,
        iceCandidatePoolSize: 6,
      };
      // Only enforce relay-only if user enabled IP protection AND provided TURN servers
      if (protectIp && customIceServers && customIceServers.length > 0) {
        pcConfig.iceTransportPolicy = 'relay';
      }

      const pc = new RTCPeerConnection(pcConfig);
      pcRef.current = pc;

      const remoteStream = MediaStream ? new MediaStream() : null;
      remoteStreamRef.current = remoteStream;

      const publishRemoteStream = (incomingStream?: any) => {
        try {
          const target = incomingStream || remoteStreamRef.current;
          if (!target) return;

          if (MediaStream && typeof target.getTracks === 'function') {
            const fresh = new MediaStream(target.getTracks());
            remoteStreamRef.current = fresh;
            const url = fresh.toURL?.();
            if (url) setRemoteStreamUrl(url);
          } else {
            remoteStreamRef.current = target;
            const url = target.toURL?.();
            if (url) setRemoteStreamUrl(url);
          }

          applyAudioRoute(routeRef.current);
        } catch {
          // Ignore
        }
      };

      pc.ontrack = (event: any) => {
        try {
          if (event?.streams && event.streams[0]) {
            publishRemoteStream(event.streams[0]);
          } else if (event?.track) {
            if (!remoteStreamRef.current && MediaStream) {
              remoteStreamRef.current = new MediaStream();
            }
            if (remoteStreamRef.current?.addTrack) {
              const exists = remoteStreamRef.current
                .getTracks?.()
                .some((t: any) => t.id === event.track.id);
              if (!exists) remoteStreamRef.current.addTrack(event.track);
            }
            publishRemoteStream(remoteStreamRef.current);
          }
        } catch {
          // Ignore
        }
      };

      pc.onaddstream = (event: any) => {
        if (event?.stream) publishRemoteStream(event.stream);
      };

      const syncConnectionState = () => {
        const state = pc.connectionState || pc.iceConnectionState;
        if (state === 'connected' || state === 'completed') {
          reconnectAttemptedRef.current = false;
          setConnectionState('connected');
          applyAudioRoute(routeRef.current);
          startStatsMonitor(pc);
        } else if (state === 'checking' || state === 'connecting') {
          setConnectionState('connecting');
        } else if (state === 'disconnected') {
          setConnectionState('reconnecting');
          void attemptIceRestart(pc);
        } else if (state === 'failed') {
          setConnectionState('failed');
          stopStatsMonitor();
        } else if (state === 'closed') {
          setConnectionState('disconnected');
          stopStatsMonitor();
        }
      };

      pc.oniceconnectionstatechange = syncConnectionState;
      pc.onconnectionstatechange = syncConnectionState;

      pc.onicecandidate = (event: any) => {
        try {
          if (event?.candidate && channelRef.current && currentUserId) {
            void channelRef.current.send({
              type: 'broadcast',
              event: 'webrtc_ice',
              payload: {
                senderId: currentUserId,
                candidate: event.candidate,
              },
            });
          }
        } catch {
          // Ignore
        }
      };

      let stream: any = null;
      const videoConstraints = withVideo
        ? {
          facingMode: facing === 'front' ? 'user' : 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        }
        : false;

      try {
        stream = await mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: videoConstraints,
        });
      } catch {
        try {
          stream = await mediaDevices.getUserMedia({
            audio: true,
            video: withVideo
              ? { facingMode: facing === 'front' ? 'user' : 'environment' }
              : false,
          });
        } catch {
          if (withVideo) {
            try {
              stream = await mediaDevices.getUserMedia({
                audio: true,
                video: false,
              });
              isVideoRef.current = false;
              setIsVideoEnabled(false);
            } catch {
              stream = null;
            }
          }
        }
      }

      if (stream) {
        stream.getAudioTracks?.().forEach((track: any) => {
          track.enabled = true;
        });
        stream.getVideoTracks?.().forEach((track: any) => {
          track.enabled = Boolean(isVideoRef.current);
        });

        localStreamRef.current = stream;
        const localUrl = stream.toURL?.();
        if (localUrl) setLocalStreamUrl(localUrl);

        stream.getTracks?.().forEach((track: any) => {
          try {
            pc.addTrack(track, stream);
          } catch {
            // Ignore
          }
        });
      }

      applyAudioRoute(routeRef.current);
      return pc;
    },
    [
      applyAudioRoute,
      attemptIceRestart,
      currentUserId,
      customIceServers,
      enableScreenProtection,
      protectIp,
      startInCallAudioSession,
      startStatsMonitor,
      stopRingtone,
      stopStatsMonitor,
    ]
  );

  const flushPendingIce = useCallback(async (pc: any) => {
    if (!pc || !pc.remoteDescription) return;
    const queued = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(cand);
      } catch {
        // Ignore
      }
    }
  }, []);

  const beginOutgoingCall = useCallback(
    async (withVideo: boolean, facing: 'front' | 'back' = 'front') => {
      stopRingtone();
      const pc = await createPeerConnection(withVideo, facing);
      if (!pc || !channelRef.current || !currentUserId) return;

      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: Boolean(withVideo),
        });
        await pc.setLocalDescription(offer);

        await channelRef.current.send({
          type: 'broadcast',
          event: 'webrtc_offer',
          payload: {
            senderId: currentUserId,
            sdp: pc.localDescription,
            callType: withVideo ? 'video' : 'voice',
          },
        });
      } catch {
        setConnectionState('failed');
      }
    },
    [createPeerConnection, currentUserId, stopRingtone]
  );

  const handleIncomingOffer = useCallback(
    async (
      sdp: any,
      withVideo: boolean,
      answerOptions?: { answerAudioOnly?: boolean }
    ) => {
      stopRingtone();
      if (!webrtcModule?.RTCSessionDescription || !sdp) return;

      const useLocalVideo =
        Boolean(withVideo) && !answerOptions?.answerAudioOnly;
      const pc = await createPeerConnection(useLocalVideo, 'front');
      if (!pc || !channelRef.current || !currentUserId) return;

      try {
        await pc.setRemoteDescription(
          new webrtcModule.RTCSessionDescription(sdp)
        );
        await flushPendingIce(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await channelRef.current.send({
          type: 'broadcast',
          event: 'webrtc_answer',
          payload: {
            senderId: currentUserId,
            sdp: pc.localDescription,
          },
        });
        applyAudioRoute(routeRef.current);
      } catch {
        setConnectionState('failed');
      }
    },
    [
      applyAudioRoute,
      createPeerConnection,
      currentUserId,
      flushPendingIce,
      stopRingtone,
    ]
  );

  const handleIncomingAnswer = useCallback(
    async (sdp: any) => {
      stopRingtone();
      if (!webrtcModule?.RTCSessionDescription || !pcRef.current || !sdp) return;
      try {
        await pcRef.current.setRemoteDescription(
          new webrtcModule.RTCSessionDescription(sdp)
        );
        await flushPendingIce(pcRef.current);
        applyAudioRoute(routeRef.current);
      } catch {
        setConnectionState('failed');
      }
    },
    [applyAudioRoute, flushPendingIce, stopRingtone]
  );

  const handleIncomingIce = useCallback(async (candidate: any) => {
    if (!webrtcModule?.RTCIceCandidate || !candidate) return;
    try {
      const ice = new webrtcModule.RTCIceCandidate(candidate);
      if (pcRef.current?.remoteDescription) {
        await pcRef.current.addIceCandidate(ice);
      } else {
        pendingIceRef.current.push(ice);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Audio-to-Video Live Upgrade
  const upgradeToVideo = useCallback(async () => {
    if (!pcRef.current || !webrtcModule?.mediaDevices) return;
    const hasCam = await requestAndroidMediaPermissions(true);
    if (!hasCam) return;

    try {
      const camStream = await webrtcModule.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user' },
      });
      const videoTrack = camStream?.getVideoTracks?.()[0];
      if (!videoTrack) return;

      if (localStreamRef.current?.addTrack) {
        localStreamRef.current.addTrack(videoTrack);
        const updatedUrl = localStreamRef.current.toURL?.();
        if (updatedUrl) setLocalStreamUrl(updatedUrl);
      }

      pcRef.current.addTrack(videoTrack, localStreamRef.current || camStream);
      isVideoRef.current = true;
      setIsVideoEnabled(true);
      applyAudioRoute('SPEAKER_PHONE');

      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pcRef.current.setLocalDescription(offer);

      if (channelRef.current && currentUserId) {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'webrtc_offer',
          payload: {
            senderId: currentUserId,
            sdp: pcRef.current.localDescription,
            callType: 'video',
          },
        });
      }
    } catch {
      // Ignore upgrade errors
    }
  }, [applyAudioRoute, currentUserId]);

  // Call Hold
  const setCallHold = useCallback(
    (hold: boolean) => {
      const nextHold = Boolean(hold);
      isHoldRef.current = nextHold;
      setIsOnHold(nextHold);

      try {
        localStreamRef.current?.getAudioTracks?.().forEach((t: any) => {
          t.enabled = nextHold ? false : !isMutedRef.current;
        });
        localStreamRef.current?.getVideoTracks?.().forEach((t: any) => {
          t.enabled = nextHold ? false : isVideoRef.current;
        });
        if (channelRef.current && currentUserId) {
          void channelRef.current.send({
            type: 'broadcast',
            event: 'webrtc_hold',
            payload: { senderId: currentUserId, isOnHold: nextHold },
          });
        }
      } catch {
        // Ignore
      }
    },
    [currentUserId]
  );

  // In-Call Emoji Reactions
  const sendReaction = useCallback(
    (emoji: string) => {
      if (!emoji || !currentUserId) return;
      const payload = { emoji, senderId: currentUserId, ts: Date.now() };
      setLastReaction(payload);
      try {
        if (channelRef.current) {
          void channelRef.current.send({
            type: 'broadcast',
            event: 'webrtc_reaction',
            payload,
          });
        }
      } catch {
        // Ignore
      }
    },
    [currentUserId]
  );

  const handleIncomingReaction = useCallback(
    (payload?: { emoji?: string; senderId?: string; ts?: number }) => {
      if (!payload?.emoji || !payload?.senderId) return;
      setLastReaction({
        emoji: payload.emoji,
        senderId: payload.senderId,
        ts: payload.ts || Date.now(),
      });
    },
    []
  );

  const handlePeerScreenshotAlert = useCallback(() => {
    onPeerScreenshot?.();
  }, [onPeerScreenshot]);

  const setMicMuted = useCallback((muted: boolean) => {
    const nextMuted = Boolean(muted);
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    try {
      localStreamRef.current?.getAudioTracks?.().forEach((track: any) => {
        track.enabled = isHoldRef.current ? false : !nextMuted;
      });
    } catch {
      // Ignore
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMicMuted(!isMutedRef.current);
  }, [setMicMuted]);

  const setVideoEnabled = useCallback((enabled: boolean) => {
    const nextEnabled = Boolean(enabled);
    isVideoRef.current = nextEnabled;
    setIsVideoEnabled(nextEnabled);
    try {
      localStreamRef.current?.getVideoTracks?.().forEach((track: any) => {
        track.enabled = isHoldRef.current ? false : nextEnabled;
      });
    } catch {
      // Ignore
    }
  }, []);

  const toggleVideo = useCallback(() => {
    setVideoEnabled(!isVideoRef.current);
  }, [setVideoEnabled]);

  const switchCamera = useCallback(async (preferredFacing?: 'front' | 'back') => {
    const nextIsFront =
      preferredFacing !== undefined
        ? preferredFacing === 'front'
        : !isFrontCamera;
    try {
      const videoTracks = localStreamRef.current?.getVideoTracks?.() || [];
      let switched = false;
      for (const track of videoTracks) {
        track.enabled = true;
        if (typeof track._switchCamera === 'function') {
          track._switchCamera();
          switched = true;
        }
      }
      if (!switched && webrtcModule?.mediaDevices?.getUserMedia) {
        const nextVideoStream = await webrtcModule.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: nextIsFront ? 'user' : 'environment' },
        });
        const nextTrack = nextVideoStream?.getVideoTracks?.()?.[0];
        if (nextTrack) {
          nextTrack.enabled = true;
          videoTracks.forEach((oldTrack: any) => {
            try {
              localStreamRef.current?.removeTrack?.(oldTrack);
              oldTrack.stop?.();
            } catch { }
          });
          localStreamRef.current?.addTrack?.(nextTrack);
          const senders = pcRef.current?.getSenders?.() || [];
          const videoSender = senders.find(
            (s: any) => s?.track?.kind === 'video'
          );
          if (videoSender && typeof videoSender.replaceTrack === 'function') {
            await videoSender.replaceTrack(nextTrack);
          }
          const updatedUrl = localStreamRef.current?.toURL?.();
          if (updatedUrl) setLocalStreamUrl(updatedUrl);
        }
      }
      isVideoRef.current = true;
      setIsVideoEnabled(true);
      setIsFrontCamera(nextIsFront);
    } catch {
      // Ignore camera switch error
    }
  }, [isFrontCamera]);

  const setSpeakerOn = useCallback(
    (on: boolean) => {
      applyAudioRoute(on ? 'SPEAKER_PHONE' : 'EARPIECE');
    },
    [applyAudioRoute]
  );

  const toggleSpeaker = useCallback(() => {
    applyAudioRoute(speakerRef.current ? 'EARPIECE' : 'SPEAKER_PHONE');
  }, [applyAudioRoute]);

  useEffect(() => {
    return () => {
      cleanupPeer();
    };
  }, [cleanupPeer]);

  return {
    localStreamUrl,
    remoteStreamUrl,
    isMuted,
    isVideoEnabled,
    isSpeakerOn,
    audioRoute,
    isFrontCamera,
    isOnHold,
    connectionState,
    networkQuality,
    lastReaction,
    beginOutgoingCall,
    handleIncomingOffer,
    handleIncomingAnswer,
    handleIncomingIce,
    handleIncomingReaction,
    handlePeerScreenshotAlert,
    upgradeToVideo,
    setCallHold,
    sendReaction,
    setMicMuted,
    toggleMute,
    setVideoEnabled,
    toggleVideo,
    switchCamera,
    setSpeakerOn,
    toggleSpeaker,
    setAudioRoute: applyAudioRoute,
    startRingtone,
    stopRingtone,
    cleanupPeer,
  };
}