/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import { MarketingLayout } from './components/layout/MarketingLayout';
import { authUrl, type AuthPath } from '@/lib/authUrl';

/* The landing is the entry point for nearly every visit, so it stays in the
   first chunk. The other three pages are long documents no first-time visitor
   has asked for yet — they load when their route is actually opened, and the
   layout holds the header in place while that happens. */
import Landing from './pages/marketing/Landing';

const Platform = React.lazy(() => import('./pages/marketing/Platform'));
const Capabilities = React.lazy(() => import('./pages/marketing/Capabilities'));
const Docs = React.lazy(() => import('./pages/marketing/Docs'));
const NotFound = React.lazy(() => import('./pages/marketing/NotFound'));

function AuthRedirect({ path }: { path: AuthPath }) {
  React.useEffect(() => {
    window.location.assign(authUrl(path));
  }, [path]);

  return null;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/platform" element={<Platform />} />
          <Route path="/capabilities" element={<Capabilities />} />
          <Route path="/docs" element={<Docs />} />

          {/* Older entry points kept so shared links do not break. */}
          <Route path="/how-it-works" element={<Navigate to="/platform" replace />} />
          <Route path="/product" element={<Navigate to="/platform" replace />} />
          <Route path="/app/*" element={<Navigate to="/" replace />} />

          <Route path="/login" element={<AuthRedirect path="/login" />} />
          <Route path="/signup" element={<AuthRedirect path="/register" />} />
          <Route path="/register" element={<AuthRedirect path="/register" />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Router>
  );
}
