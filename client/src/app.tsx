import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import CustomerPortfolioPage from './pages/CustomerPortfolioPage/CustomerPortfolioPage';
import CustomerCommunicationPreparationPage from './pages/CustomerCommunicationPreparationPage/CustomerCommunicationPreparationPage';
import CustomerVisitBriefingPage from './pages/CustomerVisitBriefingPage/CustomerVisitBriefingPage';
import HomePage from './pages/HomePage/HomePage';
import NotFound from './pages/NotFound/NotFound';
import OpportunityDecisionPage from './pages/OpportunityDecisionPage/OpportunityDecisionPage';
import SectionPage from './pages/SectionPage/SectionPage';
import FollowupCreatePage from './pages/FollowupCreatePage/FollowupCreatePage';
import FollowupDraftPage from './pages/FollowupDraftPage/FollowupDraftPage';
import DailyReportPage from './pages/DailyReportPage/DailyReportPage';
import StaleOpportunityReadinessPage from './pages/StaleOpportunityReadinessPage/StaleOpportunityReadinessPage';
import TeamReviewPage from './pages/TeamReviewPage/TeamReviewPage';
import TeamOpportunityDecisionPage from './pages/TeamOpportunityDecisionPage/TeamOpportunityDecisionPage';
import TaskFulfillmentPage from './pages/TaskFulfillmentPage/TaskFulfillmentPage';

const RoutesComponent: React.FC = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route index element={<HomePage />} />
      <Route path="daily-report" element={<DailyReportPage />} />
      <Route path="stale-opportunity-readiness" element={<StaleOpportunityReadinessPage />} />
      <Route path="customers" element={<CustomerPortfolioPage />} />
      <Route
        path="customers/:customerRecordId/briefing"
        element={<CustomerVisitBriefingPage />}
      />
      <Route
        path="customers/:customerRecordId/communication"
        element={<CustomerCommunicationPreparationPage />}
      />
      <Route path="opportunities" element={<OpportunityDecisionPage />} />
      <Route path="followups" element={<SectionPage sectionKey="followups" />} />
      <Route path="followups/new" element={<FollowupCreatePage />} />
      <Route path="followups/:id/edit" element={<FollowupDraftPage />} />
      <Route path="tasks" element={<TaskFulfillmentPage />} />
      <Route path="reviews/team" element={<TeamReviewPage />} />
      <Route path="reviews/opportunities" element={<TeamOpportunityDecisionPage />} />
      <Route path="analytics" element={<SectionPage sectionKey="analytics" />} />
      <Route path="playbooks" element={<SectionPage sectionKey="playbooks" />} />
      <Route path="admin/members" element={<SectionPage sectionKey="admin-members" />} />
      <Route path="admin/audit" element={<SectionPage sectionKey="admin-audit" />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export default RoutesComponent;
