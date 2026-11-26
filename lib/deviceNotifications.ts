import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { backend } from './backend';
import { getActiveChatPeerId } from './activeChatRef';

let handlerConfigured = false;
const senderNameCache = new Map<string, { name: string; avatar?: string }>();
const notifiedMsgIds = new Set<string>();

export function configureDeviceNotificationsHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Ignore in environments lacking native notifications handler
  }
}

export function cleanChatNotificationBody(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 'Sent you a message';
  if (trimmed === '📸 Screenshot taken of this chat') {
    return 'Took a screenshot of this chat';
  }
  if (trimmed === '👁️ View-Once Opened') return 'Opened your view-once media';
  if (trimmed.startsWith('👁️ View-Once Photo::')) return 'Sent a View-Once Photo';
  if (trimmed.startsWith('👁️ View-Once Voice')) return 'Sent a View-Once Voice Note';
  if (trimmed.startsWith('📷 Photo::')) return 'Sent a Photo';
  if (trimmed.startsWith('🎥 Video::')) return 'Sent a Video';
  if (trimmed.startsWith('🎤 Voice Note')) {
    const sep = trimmed.indexOf('::');
    const prefix = sep > 0 ? trimmed.slice(0, sep).trim() : '🎤 Voice Note';
    return prefix;
  }
  if (trimmed.startsWith('📍 Location::')) {
    const parts = trimmed.slice('📍 Location::'.length).split('::');
    const place = parts.slice(1).join('::').trim();
    return place ? `Shared location: ${place}` : 'Shared their location';
  }
  if (trimmed.includes('::http://') || trimmed.includes('::https://')) {
    return trimmed.split('::http')[0].trim() || 'Sent an attachment';
  }
  return trimmed;
}

export async function ensureDeviceNotificationChannelsAndToken(
  userId: string | null
) {
  configureDeviceNotificationsHandler();
  if (Platform.OS === 'web') return;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 220, 120, 220],
        lightColor: '#10b981',
      });
      await Notifications.setNotificationChannelAsync('live_reminders', {
        name: 'Live Stream Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ef4444',
      });
    }

    const perms = await Notifications.getPermissionsAsync();
    let status = perms.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    if (status === 'granted' && userId && !isRunningInExpoGo()) {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ||
        Constants?.easConfig?.projectId;
      if (projectId) {
        const tokenRes = await Notifications.getExpoPushTokenAsync({
          projectId,
        }).catch(() => null);
        if (tokenRes?.data) {
          await backend.messages
            .savePushToken(userId, tokenRes.data)
            .catch(() => {});
        }
      }
    }
  } catch {
    // Graceful no-op in unsupported/offline environments
  }
}

export async function triggerPhoneMessageNotification(params: {
  messageId?: string;
  senderId: string;
  rawContent?: string | null;
}) {
  if (Platform.OS === 'web') return;
  const { messageId, senderId, rawContent } = params;
  if (!senderId) return;

  // Avoid duplicate banners for the same message ID
  if (messageId) {
    if (notifiedMsgIds.has(messageId)) return;
    notifiedMsgIds.add(messageId);
    if (notifiedMsgIds.size > 200) {
      const first = notifiedMsgIds.values().next().value;
      if (first) notifiedMsgIds.delete(first);
    }
  }

  // Skip showing a phone notification if the user is actively viewing this chat
  if (getActiveChatPeerId() === senderId) return;

  try {
    let senderMeta = senderNameCache.get(senderId);
    if (!senderMeta) {
      const profile = await backend.profile
        .getProfileById(senderId)
        .catch(() => null);
      const displayName =
        String(
          profile?.full_name ||
            (profile?.username ? `@${String(profile.username).replace(/^@+/, '')}` : '') ||
            'New Message'
        ).trim() || 'New Message';
      senderMeta = {
        name: displayName,
        avatar: profile?.avatar_url || undefined,
      };
      senderNameCache.set(senderId, senderMeta);
    }

    const body = cleanChatNotificationBody(rawContent);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: senderMeta.name,
        body,
        sound: 'default',
        data: {
          route: 'messages',
          userId: senderId,
          name: senderMeta.name,
          avatarUrl: senderMeta.avatar || '',
        },
      },
      trigger:
        Platform.OS === 'android'
          ? ({ channelId: 'messages' } as Notifications.ChannelAwareTriggerInput)
          : null,
    });
  } catch {
    // Ignore if device notification permission was declined
  }
}

export async function scheduleLiveReminderNotification(params: {
  streamId: string;
  title: string;
  hostName: string;
  scheduledAtMs: number;
}) {
  if (Platform.OS === 'web') return;
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
    const leadMs = params.scheduledAtMs - Date.now() - 5 * 60 * 1000;
    const triggerSeconds = Math.max(5, Math.floor(leadMs / 1000));
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${params.hostName} is going LIVE soon`,
        body: params.title || 'Tap to join the live broadcast on VibeSphere',
        sound: 'default',
        data: {
          route: 'live',
          streamId: params.streamId,
          title: params.title,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: triggerSeconds,
        channelId: Platform.OS === 'android' ? 'live_reminders' : undefined,
      },
    });
  } catch {
    // Graceful no-op
  }
}
