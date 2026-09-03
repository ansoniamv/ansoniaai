import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider } from "@/hooks/useAuth";
import { AuthGuard } from "@/components/AuthGuard";
import { ScrollToTop } from "@/components/ScrollToTop";
import { RouteFallback } from "@/components/RouteFallback";

const Index = lazy(() => import("./pages/Index"));
const NewDeal = lazy(() => import("./pages/NewDeal"));
const DealDetail = lazy(() => import("./pages/DealDetail"));
const EditDeal = lazy(() => import("./pages/EditDeal"));
const PartnersPage = lazy(() => import("./pages/PartnersPage"));
const PartnerDetail = lazy(() => import("./pages/PartnerDetail"));
const NewPartner = lazy(() => import("./pages/NewPartner"));
const DevNotesPage = lazy(() => import("./pages/DevNotesPage"));
const RoadmapPage = lazy(() => import("./pages/RoadmapPage"));
const BuyBoxPage = lazy(() => import("./pages/BuyBoxPage"));
const CapitalRaisePage = lazy(() => import("./pages/CapitalRaisePage"));
const NotesTagsPage = lazy(() => import("./pages/NotesTagsPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const OutlookPage = lazy(() => import("./pages/OutlookPage"));
const ApiStatusPage = lazy(() => import("./pages/ApiStatusPage"));
const PipelineDashboardPage = lazy(() => import("./pages/PipelineDashboardPage"));
const DealPipelinePage = lazy(() => import("./pages/DealPipelinePage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const ConnectorsPage = lazy(() => import("./pages/ConnectorsPage"));
const WarmthImportPage = lazy(() => import("./pages/WarmthImportPage"));
const SuggestionsPage = lazy(() => import("./pages/SuggestionsPage"));
const PartnerTearsheetPage = lazy(() => import("./pages/PartnerTearsheetPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const Protected = ({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) => (
  <AuthGuard requireAdmin={admin}>
    <AppLayout>{children}</AppLayout>
  </AuthGuard>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/" element={<Protected><DashboardPage /></Protected>} />
              <Route path="/dashboard" element={<Protected><PipelineDashboardPage /></Protected>} />
              <Route path="/pipeline-dashboard" element={<Protected><PipelineDashboardPage /></Protected>} />
              <Route path="/deals" element={<Protected><Index /></Protected>} />
              <Route path="/pipeline" element={<Protected><DealPipelinePage /></Protected>} />
              <Route path="/deals/new" element={<Protected><NewDeal /></Protected>} />
              <Route path="/deals/:id" element={<Protected><DealDetail /></Protected>} />
              <Route path="/deals/:id/edit" element={<Protected><EditDeal /></Protected>} />
              <Route path="/partners" element={<Protected><PartnersPage /></Protected>} />
              <Route path="/partners/new" element={<Protected><NewPartner /></Protected>} />
              <Route path="/partners/:id" element={<Protected><PartnerDetail /></Protected>} />
              <Route path="/capital-raise" element={<Protected><CapitalRaisePage /></Protected>} />
              <Route path="/suggestions" element={<Protected><SuggestionsPage /></Protected>} />
              <Route path="/notes" element={<Protected><NotesTagsPage /></Protected>} />
              <Route path="/outlook" element={<Protected><OutlookPage /></Protected>} />
              <Route path="/chat" element={<Protected><ChatPage /></Protected>} />
              <Route path="/chat/:threadId" element={<Protected><ChatPage /></Protected>} />
              <Route path="/dev-notes" element={<Protected><DevNotesPage /></Protected>} />
              <Route path="/roadmap" element={<Protected><RoadmapPage /></Protected>} />
              <Route path="/buy-box" element={<Protected><BuyBoxPage /></Protected>} />
              <Route path="/admin/users" element={<Protected admin><AdminUsersPage /></Protected>} />
              <Route path="/api-status" element={<Protected><ApiStatusPage /></Protected>} />
              <Route path="/admin/connectors" element={<Protected admin><ConnectorsPage /></Protected>} />
              <Route path="/admin/warmth-import" element={<Protected admin><WarmthImportPage /></Protected>} />
              <Route
                path="/pipeline-tearsheet/:partnerId"
                element={<AuthGuard><PartnerTearsheetPage /></AuthGuard>}
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
