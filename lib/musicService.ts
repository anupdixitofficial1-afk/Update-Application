export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  genre: string;
  coverUrl: string;
  previewUrl?: string;
  durationSec?: number;
}

export const MUSIC_GENRES: string[] = [
  'All',
  'Trending',
  'Pop',
  'Bollywood',
  'Hip-Hop',
  'Lo-Fi',
  'Acoustic',
  'Electronic',
];

export const TRENDING_REELS_TRACKS: MusicTrack[] = [
  {
    id: 'track-1',
    title: 'Golden Hour Breeze',
    artist: 'Aria Vance',
    genre: 'Pop',
    coverUrl:
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=300&q=80',
    durationSec: 60,
  },
  {
    id: 'track-2',
    title: 'Midnight Drive Beats',
    artist: 'Kairo',
    genre: 'Lo-Fi',
    coverUrl:
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=300&q=80',
    durationSec: 60,
  },
  {
    id: 'track-3',
    title: 'Sunset Acoustic',
    artist: 'Rohan Mehra',
    genre: 'Acoustic',
    coverUrl:
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=300&q=80',
    durationSec: 60,
  },
  {
    id: 'track-4',
    title: 'Neon Pulse',
    artist: 'Vexel',
    genre: 'Electronic',
    coverUrl:
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=300&q=80',
    durationSec: 60,
  },
  {
    id: 'track-5',
    title: 'Dil Ki Baat',
    artist: 'Aarav & Meera',
    genre: 'Bollywood',
    coverUrl:
      'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=300&q=80',
    durationSec: 60,
  },
  {
    id: 'track-6',
    title: 'City Lights Flow',
    artist: 'MC Nova',
    genre: 'Hip-Hop',
    coverUrl:
      'https://images.unsplash.com/photo-1571330735066-03aaa9429d89?auto=format&fit=crop&w=300&q=80',
    durationSec: 60,
  },
];

export async function searchPublicMusic(
  query: string,
  genre = 'All'
): Promise<MusicTrack[]> {
  const cleanQuery = query.trim().toLowerCase();
  const cleanGenre = genre.trim().toLowerCase();

  return TRENDING_REELS_TRACKS.filter((track) => {
    const matchesGenre =
      !cleanGenre ||
      cleanGenre === 'all' ||
      cleanGenre === 'trending' ||
      track.genre.toLowerCase() === cleanGenre;

    if (!matchesGenre) return false;
    if (!cleanQuery) return true;

    return (
      track.title.toLowerCase().includes(cleanQuery) ||
      track.artist.toLowerCase().includes(cleanQuery) ||
      track.genre.toLowerCase().includes(cleanQuery)
    );
  });
}