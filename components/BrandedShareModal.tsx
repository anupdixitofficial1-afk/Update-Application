import React, { useState } from 'react';
import {
  Image,
  Modal,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { buildShareDeepLink } from '../lib/growthFeatures';

export interface ShareCardPayload {
  id: string;
  kind: 'reel' | 'video' | 'post' | 'live' | 'profile';
  title: string;
  creatorHandle: string;
  thumbnailUrl?: string;
}

export function BrandedShareModal({
  visible,
  item,
  onClose,
  onSaveToCollection,
}: {
  visible: boolean;
  item: ShareCardPayload | null;
  onClose: () => void;
  onSaveToCollection?: () => void;
}) {
  const [linkCopiedHint, setLinkCopiedHint] = useState(false);

  if (!item) return null;
  const shareUrl = buildShareDeepLink(item.kind, item.id);

  const handleSystemShare = async () => {
    try {
      await Share.share({
        title: `${item.title} · VibeSphere`,
        message: `Watch "${item.title}" by ${item.creatorHandle} on VibeSphere!\n${shareUrl}`,
        url: shareUrl,
      });
    } catch {}
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Share VibeSphere Card</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Branded Export Card Preview */}
          <View style={styles.brandCard}>
            {item.thumbnailUrl ? (
              <Image
                source={{ uri: item.thumbnailUrl }}
                style={styles.cardThumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.cardThumb, styles.cardThumbFallback]}>
                <Ionicons name="sparkles" size={26} color="#10b981" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={styles.brandTagRow}>
                <View style={styles.vsBadge}>
                  <Text style={styles.vsBadgeText}>VIBESPHERE</Text>
                </View>
                <Text style={styles.kindTag}>{item.kind.toUpperCase()}</Text>
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.cardCreator} numberOfLines={1}>
                {item.creatorHandle} · Watch on VibeSphere
              </Text>
            </View>
          </View>

          <View style={styles.linkBox}>
            <Ionicons name="link-outline" size={16} color="#10b981" />
            <Text style={styles.linkText} selectable numberOfLines={1}>
              {shareUrl}
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => void handleSystemShare()}
              activeOpacity={0.85}
            >
              <Feather name="share-2" size={18} color="#09090b" />
              <Text style={styles.actionBtnPrimaryText}>Share Link</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                setLinkCopiedHint(true);
                setTimeout(() => setLinkCopiedHint(false), 1800);
              }}
              activeOpacity={0.85}
            >
              <Ionicons
                name={linkCopiedHint ? 'checkmark-circle' : 'qr-code-outline'}
                size={18}
                color="#fff"
              />
              <Text style={styles.secondaryBtnText}>
                {linkCopiedHint ? 'Link Ready' : 'Select Link'}
              </Text>
            </TouchableOpacity>

            {onSaveToCollection && (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  onClose();
                  onSaveToCollection();
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="folder-open-outline" size={18} color="#10b981" />
                <Text style={styles.secondaryBtnText}>Save Vibe</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heading: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.3)',
    alignItems: 'center',
  },
  cardThumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#27272a',
  },
  cardThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  vsBadge: {
    backgroundColor: '#10b981',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  vsBadgeText: {
    color: '#052e16',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  kindTag: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  cardCreator: {
    color: '#a1a1aa',
    fontSize: 11.5,
    marginTop: 4,
  },
  linkBox: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkText: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionBtnPrimaryText: {
    color: '#052e16',
    fontWeight: '800',
    fontSize: 13,
  },
  secondaryBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12.5,
  },
});
