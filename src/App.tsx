import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Stories from "./pages/Stories";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Surveillance from "./pages/Surveillance";
import Biometrics from "./pages/Biometrics";
import Legal from "./pages/Legal";
import KCSO from "./pages/KCSO";
import Josiah from "./pages/Josiah";
import DataTools from "./pages/DataTools";

const queryClient = new QueryClient();

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-bold text-red-500 mb-4">Something went wrong</h1>
        <p className="text-gray-300 mb-4">{error.message}</p>
        <button 
          onClick={() => window.location.reload()} 
          className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

const App = () => (
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={
              <ProtectedRoute>
                <Index />
              </ProtectedRoute>
            } />
            <Route path="/surveillance" element={
              <ProtectedRoute>
                <Surveillance />
              </ProtectedRoute>
            } />
            <Route path="/biometrics" element={
              <ProtectedRoute>
                <Biometrics />
              </ProtectedRoute>
            } />
            <Route path="/legal" element={
              <ProtectedRoute>
                <Legal />
              </ProtectedRoute>
            } />
            <Route path="/kcso" element={
              <ProtectedRoute>
                <KCSO />
              </ProtectedRoute>
            } />
            <Route path="/josiah" element={
              <ProtectedRoute>
                <Josiah />
              </ProtectedRoute>
            } />
            <Route path="/data" element={
              <ProtectedRoute>
                <DataTools />
              </ProtectedRoute>
            } />
            <Route path="/stories" element={
              <ProtectedRoute>
                <Stories />
              </ProtectedRoute>
            } />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
