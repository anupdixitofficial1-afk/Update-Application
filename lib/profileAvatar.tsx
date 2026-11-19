import React, { createContext, useContext, useState } from 'react';

const FALLBACK_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/png?seed=Alex&top=shortHairShortCurly&clothing=shirtCrewNeck&backgroundColor=e2e8f0';

interface ProfileAvatarContextValue {
  avatarUri: string;
  setAvatarUri: (uri: string) => void;
}

const ProfileAvatarContext = createContext<ProfileAvatarContextValue>({
  avatarUri: FALLBACK_AVATAR,
  setAvatarUri: () => {},
});

export function ProfileAvatarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [avatarUri, setAvatarUriState] = useState<string>(FALLBACK_AVATAR);

  const setAvatarUri = (uri: string) => {
    const clean = (uri || '').trim();
    setAvatarUriState(clean || FALLBACK_AVATAR);
  };

  return (
    <ProfileAvatarContext.Provider value={{ avatarUri, setAvatarUri }}>
      {children}
    </ProfileAvatarContext.Provider>
  );
}

export function useProfileAvatar() {
  return useContext(ProfileAvatarContext);
}