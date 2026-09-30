import "@github/relative-time-element";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import "./index.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { refreshAccessToken } from "@/connect";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { InstanceProvider, useInstance } from "@/contexts/InstanceContext";
import { ViewProvider } from "@/contexts/ViewContext";
import { useTokenRefreshOnFocus } from "@/hooks/useTokenRefreshOnFocus";
import { queryClient } from "@/lib/query-client";
import router from "./router";
import { applyLocaleEarly } from "./utils/i18n";
import { applyThemeEarly } from "./utils/theme";

applyThemeEarly();
applyLocaleEarly();

function AppInitializer({ children }: { children: React.ReactNode }) {
  const { isInitialized: authInitialized, initialize: initAuth, currentUser } = useAuth();
  const { isInitialized: instanceInitialized, initialize: initInstance } = useInstance();
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    void Promise.all([initInstance(), initAuth()]);
  }, [initAuth, initInstance]);

  useTokenRefreshOnFocus(refreshAccessToken, !!currentUser);
  // ywdj uses its own query refresh. Do not reconnect the retired personal-memo SSE endpoint.
  if (!authInitialized || !instanceInitialized) return null;
  return <>{children}</>;
}

function Main() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <InstanceProvider>
          <AuthProvider>
            <ViewProvider>
              <AppInitializer>
                <RouterProvider router={router} />
                <Toaster position="top-right" />
              </AppInitializer>
            </ViewProvider>
          </AuthProvider>
        </InstanceProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const container = document.getElementById("root");
const root = createRoot(container as HTMLElement);
root.render(<Main />);
