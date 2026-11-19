import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function CreateScreen() {
  const router = useRouter();

  const studioOptions = [
    {
      id: '1',
      title: 'Long-Form Video',
      desc: 'Upload high-res content & manage monetization',
      icon: 'videocam',
      color: '#059669',
      bg: '#ecfdf5',
      badge: '4K Ultra',
    },
    {
      id: '2',
      title: 'Vibe Short',
      desc: 'Record or upload vertical reels & teasers',
      icon: 'flash',
      color: '#d97706',
      bg: '#fffbeb',
      badge: 'Trending',
    },
    {
      id: '3',
      title: 'Go Live',
      desc: 'Broadcast to your community with live chat',
      icon: 'radio',
      color: '#7c3aed',
      bg: '#f5f3ff',
      badge: 'Interactive',
    },
    {
      id: '4',
      title: 'Text & Poll Post',
      desc: 'Share updates, images, or interactive polls',
      icon: 'create',
      color: '#0284c7',
      bg: '#f0f9ff',
      badge: 'Engagement',
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      
      {/* HEADER SECTION */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Creator Studio</Text>
          <Text style={styles.headerSubtitle}>Manage & publish your content hub</Text>
        </View>
        <TouchableOpacity style={styles.draftsButton} activeOpacity={0.8}>
          <Feather name="file-text" size={13} color="#059669" style={{ marginRight: 5 }} />
          <Text style={styles.draftsText}>Drafts (2)</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* PRO CREATOR INSIGHT BANNER */}
        <View style={styles.proBanner}>
          <View style={styles.proIconContainer}>
            <Ionicons name="sparkles" size={16} color="#059669" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.proTitle}>Pro Creator Tools Active</Text>
            <Text style={styles.proDesc}>Your content reach increased by 24% this week.</Text>
          </View>
        </View>

        <Text style={styles.sectionHeading}>SELECT CREATION MODE</Text>

        {/* OPTIONS CARDS */}
        {studioOptions.map((item) => (
          <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.7}>
            <View style={[styles.iconBox, { backgroundColor: item.bg }]}>
              <Ionicons name={item.icon as any} size={22} color={item.color} />
            </View>
            
            <View style={styles.cardContent}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <View style={[styles.badge, { backgroundColor: item.bg }]}>
                  <Text style={[styles.badgeText, { color: item.color }]}>{item.badge}</Text>
                </View>
              </View>
              <Text style={styles.cardDesc}>{item.desc}</Text>
            </View>

            <Ionicons name="chevron-forward" size={16} color="#cbd5e1" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, color: '#64748b', fontWeight: '500', marginTop: 2 },
  
  draftsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  draftsText: { fontSize: 12, fontWeight: '700', color: '#059669' },

  scrollContent: { paddingHorizontal: 16, paddingVertical: 16 },

  proBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  proIconContainer: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#ecfdf5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  proDesc: { fontSize: 11, color: '#64748b', marginTop: 1 },

  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginLeft: 4,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardContent: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  cardDesc: { fontSize: 12, color: '#64748b', lineHeight: 16 },
  
  badge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  badgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
});