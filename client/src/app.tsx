import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import HomePage from './pages/HomePage/HomePage';
import NotFound from './pages/NotFound/NotFound';
import SectionPage from './pages/SectionPage/SectionPage';
import FollowupCreatePage from './pages/FollowupCreatePage/FollowupCreatePage';
import FollowupDraftPage from './pages/FollowupDraftPage/FollowupDraftPage';

const RoutesComponent: React.FC = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route index element={<HomePage />} />
      <Route path="customers" element={<SectionPage sectionKey="customers" />} />
      <Route path="opportunities" element={<SectionPage sectionKey="opportunities" />} />
      <Route path="followups" element={<SectionPage sectionKey="followups" />} />
      <Route path="followups/new" element={<FollowupCreatePage />} />
      <Route path="followups/:id/edit" element={<FollowupDraftPage />} />
      <Route path="tasks" element={<SectionPage sectionKey="tasks" />} />
      <Route path="reviews/team" element={<SectionPage sectionKey="reviews-team" />} />
      <Route path="analytics" element={<SectionPage sectionKey="analytics" />} />
      <Route path="playbooks" element={<SectionPage sectionKey="playbooks" />} />
      <Route path="admin/members" element={<SectionPage sectionKey="admin-members" />} />
      <Route path="admin/audit" element={<SectionPage sectionKey="admin-audit" />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export default RoutesComponent;
