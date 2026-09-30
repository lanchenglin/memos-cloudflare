import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import App from "@/App";
import { ChunkLoadErrorFallback } from "@/components/ErrorBoundary";
import { RequireAuthRoute, RequireGuestRoute } from "./guards";
import { ROUTES } from "./routes";

function lazyWithReload<T extends React.ComponentType>(factory: () => Promise<{ default: T }>) {
  return lazy(() => factory().catch((error) => {
    const isChunkError = error?.message?.includes("Failed to fetch dynamically imported module") ||
      error?.message?.includes("Importing a module script failed");
    if (isChunkError && !sessionStorage.getItem("chunk-reload")) {
      sessionStorage.setItem("chunk-reload", "1");
      window.location.reload();
    }
    throw error;
  }));
}
const AdminSignIn = lazyWithReload(() => import("@/pages/AdminSignIn"));
const AuthCallback = lazyWithReload(() => import("@/pages/AuthCallback"));
const SignIn = lazyWithReload(() => import("@/pages/SignIn"));
const SignUp = lazyWithReload(() => import("@/pages/SignUp"));
const Audit = lazyWithReload(() => import("@/pages/Audit"));
const AuditEntry = () => <Suspense fallback={<div role="status" className="p-6">正在加载运维登记…</div>}><Audit /></Suspense>;
export const Routes = ROUTES;
export { ROUTES };
export const routeConfig: RouteObject[] = [{
  path: "/", element: <App />, errorElement: <ChunkLoadErrorFallback />, children: [
    { path: Routes.AUTH, children: [
      { path: "callback", element: <AuthCallback /> },
      { element: <RequireGuestRoute />, children: [
        { path: "", element: <SignIn /> },
        { path: "admin", element: <AdminSignIn /> },
        { path: "signup", element: <SignUp /> },
      ] },
    ] },
    { element: <RequireAuthRoute />, children: [
      // Render the landing page directly: avoid a redirect chain while the first login initializes contexts.
      { index: true, element: <AuditEntry /> },
      { path: "audit", element: <AuditEntry /> },
      { path: "home", element: <Navigate to="/audit" replace /> },
      { path: "setting", element: <Navigate to="/audit?view=accounts" replace /> },
      { path: "*", element: <Navigate to="/audit" replace /> },
    ] },
  ],
}];
const router = createBrowserRouter(routeConfig);
export default router;
