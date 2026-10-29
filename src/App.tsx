/**
 * Window router.
 *
 * Both windows share one bundle; the `window` query parameter set by the Rust
 * side selects which root renders. Importing both views eagerly avoids a
 * dynamic chunk waterfall when the capture overlay opens.
 */

import { useEffect } from 'react';
import { initI18nSync } from './i18n';
import { CaptureOverlay } from './windows/CaptureOverlay';
import { HomeWindow } from './windows/HomeWindow';

type WindowRole = 'main' | 'overlay';

function resolveRole(): WindowRole {
  const role = new URLSearchParams(window.location.search).get('window');
  return role === 'overlay' ? role : 'main';
}

export default function App() {
  const role = resolveRole();

  // Keep locale initialization after selecting the active window role.
  useEffect(() => {
    initI18nSync();
  }, [role]);

  return role === 'overlay' ? <CaptureOverlay /> : <HomeWindow />;
}
