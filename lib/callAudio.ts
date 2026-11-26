import * as FileSystem from 'expo-file-system/legacy';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const RINGTONE_FILENAME = 'vs_incoming_ringtone_v1.wav';
const RINGBACK_FILENAME = 'vs_outgoing_ringback_v1.wav';

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_CHARS[(triplet >> 18) & 0x3f];
    out += BASE64_CHARS[(triplet >> 12) & 0x3f];
    out += i + 1 < bytes.length ? BASE64_CHARS[(triplet >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[triplet & 0x3f] : '=';
  }
  return out;
}

function writeStringAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function buildRingWavBytes(kind: 'ringtone' | 'ringback'): Uint8Array {
  const sampleRate = 16000;
  const durationSec = kind === 'ringtone' ? 2.2 : 2.6;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const dataBytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeStringAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStringAscii(view, 8, 'WAVE');
  writeStringAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStringAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let amp = 0;
    let sample = 0;

    if (kind === 'ringtone') {
      // Two bright dual-tone bursts inside a 2.2s cycle
      const burst1 = t >= 0.02 && t < 0.44;
      const burst2 = t >= 0.56 && t < 0.98;
      if (burst1 || burst2) {
        const localT = burst1 ? t - 0.02 : t - 0.56;
        const burstLen = 0.42;
        const edge = 0.025;
        const env =
          localT < edge
            ? localT / edge
            : localT > burstLen - edge
              ? Math.max(0, (burstLen - localT) / edge)
              : 1;
        amp = 0.55 * env;
        sample =
          0.5 * Math.sin(2 * Math.PI * 523.25 * t) +
          0.5 * Math.sin(2 * Math.PI * 659.25 * t);
      }
    } else {
      // Soft telephony dual-tone ringback: 1.0s on, 1.6s pause
      if (t >= 0.02 && t < 1.02) {
        const localT = t - 0.02;
        const edge = 0.03;
        const env =
          localT < edge
            ? localT / edge
            : localT > 1.0 - edge
              ? Math.max(0, (1.0 - localT) / edge)
              : 1;
        amp = 0.4 * env;
        sample =
          0.5 * Math.sin(2 * Math.PI * 440 * t) +
          0.5 * Math.sin(2 * Math.PI * 480 * t);
      }
    }

    const pcm = Math.max(-1, Math.min(1, sample * amp));
    view.setInt16(44 + i * 2, Math.round(pcm * 32767), true);
  }

  return new Uint8Array(buffer);
}

const cachedToneUris: Partial<Record<'ringtone' | 'ringback', string>> = {};

async function ensureToneFileUri(
  kind: 'ringtone' | 'ringback'
): Promise<string | null> {
  const existing = cachedToneUris[kind];
  if (existing) return existing;

  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) return null;

  const filename = kind === 'ringtone' ? RINGTONE_FILENAME : RINGBACK_FILENAME;
  const targetUri = `${baseDir}${filename}`;

  try {
    const info = await FileSystem.getInfoAsync(targetUri);
    if (!info.exists) {
      const wavBytes = buildRingWavBytes(kind);
      await FileSystem.writeAsStringAsync(targetUri, bytesToBase64(wavBytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    cachedToneUris[kind] = targetUri;
    return targetUri;
  } catch {
    return null;
  }
}

let activeRingPlayer: AudioPlayer | null = null;
let ringSessionNonce = 0;

export async function applyCallAudioMode(options: {
  speaker: boolean;
  allowsRecording?: boolean;
}): Promise<void> {
  const { speaker, allowsRecording = false } = options;
  try {
    // On iOS `shouldRouteThroughEarpiece` requires `allowsRecording: true`.
    // On Android `shouldRouteThroughEarpiece` controls earpiece vs speakerphone.
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      allowsRecording: allowsRecording || !speaker,
      shouldRouteThroughEarpiece: !speaker,
    });
  } catch {
    // Non-blocking fallback
  }
}

export async function startCallRingAudio(options: {
  isOutgoing: boolean;
  speaker: boolean;
}): Promise<void> {
  const { isOutgoing, speaker } = options;
  const nonce = ++ringSessionNonce;

  stopCallRingAudioInternal();

  await applyCallAudioMode({
    speaker: isOutgoing ? speaker : true,
    allowsRecording: isOutgoing && !speaker,
  });

  if (nonce !== ringSessionNonce) return;

  const uri = await ensureToneFileUri(isOutgoing ? 'ringback' : 'ringtone');
  if (!uri || nonce !== ringSessionNonce) return;

  try {
    const player = createAudioPlayer({ uri });
    if (nonce !== ringSessionNonce) {
      player.remove();
      return;
    }
    player.loop = true;
    player.volume = isOutgoing ? 0.9 : 1.0;
    player.play();
    activeRingPlayer = player;
  } catch {
    // Ignore audio player init errors
  }
}

function stopCallRingAudioInternal(): void {
  if (activeRingPlayer) {
    try {
      activeRingPlayer.pause();
    } catch {}
    try {
      activeRingPlayer.remove();
    } catch {}
    activeRingPlayer = null;
  }
}

export function stopCallRingAudio(): void {
  ringSessionNonce += 1;
  stopCallRingAudioInternal();
}
