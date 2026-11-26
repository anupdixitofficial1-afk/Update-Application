import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createVibeCollection,
  getVibeCollections,
  saveItemToCollection,
  VibeCollection,
} from '../lib/growthFeatures';

export interface CollectionSaveTarget {
  id: string;
  kind: 'reel' | 'video' | 'post';
  title: string;
  author: string;
  thumbnailUrl?: string;
}

export function SaveToCollectionModal({
  visible,
  userId,
  target,
  onClose,
  onSaved,
}: {
  visible: boolean;
  userId?: string | null;
  target: CollectionSaveTarget | null;
  onClose: () => void;
  onSaved?: (collectionTitle: string) => void;
}) {
  const [collections, setCollections] = useState<VibeCollection[]>([]);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    if (!visible) return;
    void getVibeCollections(userId).then(setCollections);
  }, [visible, userId]);

  if (!target) return null;

  const handleSelectCollection = async (col: VibeCollection) => {
    const next = await saveItemToCollection(userId, col.id, target);
    setCollections(next);
    onSaved?.(col.title);
    onClose();
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const next = await createVibeCollection(userId, newTitle.trim());
    setCollections(next);
    setNewTitle('');
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
            <Text style={styles.title}>Save to Vibe Collection</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              placeholder="New collaborative collection name..."
              placeholderTextColor="#94a3b8"
              value={newTitle}
              onChangeText={setNewTitle}
              returnKeyType="done"
              onSubmitEditing={() => void handleCreate()}
            />
            <TouchableOpacity
              style={[
                styles.createBtn,
                !newTitle.trim() && { opacity: 0.45 },
              ]}
              disabled={!newTitle.trim()}
              onPress={() => void handleCreate()}
            >
              <Ionicons name="add" size={20} color="#052e16" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {collections.map((col) => {
              const alreadySaved = col.items.some((i) => i.id === target.id);
              return (
                <TouchableOpacity
                  key={col.id}
                  style={styles.row}
                  onPress={() => void handleSelectCollection(col)}
                  activeOpacity={0.8}
                >
                  <View style={styles.folderIcon}>
                    <Ionicons
                      name={alreadySaved ? 'bookmark' : 'folder-outline'}
                      size={20}
                      color="#10b981"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.colTitle} numberOfLines={1}>
                      {col.title}
                    </Text>
                    <Text style={styles.colSub}>
                      {col.items.length} saved · {col.description}
                    </Text>
                  </View>
                  <Ionicons
                    name={
                      alreadySaved ? 'checkmark-circle' : 'add-circle-outline'
                    }
                    size={22}
                    color={alreadySaved ? '#10b981' : '#94a3b8'}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
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
  createRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#1f2937',
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 13,
  },
  createBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    maxHeight: 280,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  folderIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(16,185,129,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  colSub: {
    color: '#9ca3af',
    fontSize: 11.5,
    marginTop: 2,
  },
});
