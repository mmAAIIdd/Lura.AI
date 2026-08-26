/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import { MarketingLayout } from './components/layout/MarketingLayout';
import { authAppBase, authUrl, type AuthPath } from '@/lib/authUrl';

const Capabilities = React.lazy(() => import('./pages/marketing/Capabilities'));
const Docs = React.lazy(() => import('./pages/marketing/Docs'));
const Cooperation = React.lazy(() => import('./pages/marketing/Cooperation'));
const NotFound = React.lazy(() => import('./pages/marketing/NotFound'));
const AuthUnavailable = React.lazy(() => import('./pages/marketing/AuthUnavailable'));

function AuthRedirect({ path }: { path: AuthPath }) {
  /* Only leave when there is somewhere else to go. With no auth app configured
     authUrl() hands back this same route, and assigning it reloads the page into
     this component again — which is what left the sign-in link spinning
     forever. */
  const target = authAppBase() ? authUrl(path) : null;

  React.useEffect(() => {
    if (target) window.location.assign(target);
  }, [target]);

  return target ? null : <AuthUnavailable />;
}

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Лендинга больше нет: корень сайта — это регистрация через Google.
            Уже вошедшего посетителя middleware приложения авторизации уводит
            с /register в рабочее пространство, так что обе роли попадают куда
            нужно за один переход. */}
        <Route path="/" element={<AuthRedirect path="/register" />} />
        <Route path="/login" element={<Navigate to="/register" replace />} />
        <Route path="/signup" element={<Navigate to="/register" replace />} />
        <Route path="/register" element={<AuthRedirect path="/register" />} />
        <Route path="/app/*" element={<AuthRedirect path="/workspace" />} />

        <Route element={<MarketingLayout />}>
          <Route path="/capabilities" element={<Capabilities />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/cooperation" element={<Cooperation />} />

          {/* Старые ссылки ведут на ближайший оставшийся раздел. */}
          <Route path="/platform" element={<Navigate to="/capabilities" replace />} />
          <Route path="/how-it-works" element={<Navigate to="/capabilities" replace />} />
          <Route path="/product" element={<Navigate to="/capabilities" replace />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Router>
  );
}
