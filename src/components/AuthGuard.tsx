import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, ShieldOff, WifiOff, RefreshCw } from "lucide-react";
import { RouteFallback } from "@/components/RouteFallback";

export function AuthGuard({ children, requireAdmin = false }: { children: ReactNode; requireAdmin?: boolean }) {
  const { user, profile, isAdmin, loading, profileLoading, loadError, signOut, retryLoad } = useAuth();
  const location = useLocation();


  if (loadError && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2"><WifiOff className="h-10 w-10 text-destructive" /></div>
            <CardTitle>Can't reach the backend</CardTitle>
            <CardDescription>
              We couldn't load your account after a few seconds. This is usually a temporary
              connection issue — please try again in a moment.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            <Button onClick={retryLoad}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
            <Button variant="outline" onClick={signOut}>Sign out</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Only the session lookup blocks; the profile/roles fetch runs alongside it.
  if (loading) {
    return <RouteFallback />;
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Session is valid but profile/roles haven't landed yet — show the shell, not a gate screen.
  if (!profile && profileLoading) {
    return <RouteFallback />;
  }

  if (!profile || profile.status === "pending") {

    return (
      <GateScreen
        icon={<Clock className="h-10 w-10 text-primary" />}
        title="Awaiting approval"
        description="Your account has been created but is waiting for an administrator to approve access. You'll be able to log in once approved."
        onSignOut={signOut}
      />
    );
  }

  if (profile.status === "rejected") {
    return (
      <GateScreen
        icon={<ShieldOff className="h-10 w-10 text-destructive" />}
        title="Access denied"
        description="Your account was not approved. Please contact an administrator if you believe this is an error."
        onSignOut={signOut}
      />
    );
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function GateScreen({
  icon,
  title,
  description,
  onSignOut,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2">{icon}</div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="outline" onClick={onSignOut}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
