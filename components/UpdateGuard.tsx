// =============================================================
// UpdateGuard — versionCheck → UpdateRequiredModal köprüsü
// =============================================================
// Uygulama ağacının dışında oturur (LanguageProvider'dan da
// önce), böylece yeni sürüm modalı uygulama içindeki herhangi
// bir Suspense / state / hata durumundan etkilenmeden gösterilir.
// =============================================================

import React, { useEffect, useState } from 'react';
import { startVersionCheck, onUpdateAvailable } from '../lib/versionCheck';
import UpdateRequiredModal from './UpdateRequiredModal';

interface Props {
  children: React.ReactNode;
}

const UpdateGuard: React.FC<Props> = ({ children }) => {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    startVersionCheck();
    const off = onUpdateAvailable((latest) => {
      setLatestVersion(latest);
    });
    return off;
  }, []);

  return (
    <>
      {children}
      {latestVersion !== null && <UpdateRequiredModal latestVersion={latestVersion} />}
    </>
  );
};

export default UpdateGuard;
