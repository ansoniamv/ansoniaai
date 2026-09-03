import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type ProfileStatus = "pending" | "approved" | "rejected";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  status: ProfileStatus;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  /** True while the profile/roles lookup is still in flight (session already known). */
  profileLoading: boolean;
  loadError: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryLoad: () => void;
}


const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const LOAD_TIMEOUT_MS = 10000;
const LOAD_RETRIES = 3;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function loadWithRetry(fn: () => Promise<void>): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < LOAD_RETRIES; attempt++) {
    try {
      return await withTimeout(fn(), LOAD_TIMEOUT_MS);
    } catch (e) {
      lastErr = e;
      if (attempt < LOAD_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => { profileRef.current = profile; }, [profile]);

  const loadProfileAndRole = async (userId: string) => {
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,status").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setProfile((prof as Profile) ?? null);
    setIsAdmin(!!roles?.some((r: { role: string }) => r.role === "admin"));
  };

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setLoading(true);
    setProfileLoading(true);

    // Fire-and-forget: never blocks the session gate, so the shell can render immediately.
    const startProfileLoad = (userId: string) => {
      setProfileLoading(true);
      loadWithRetry(() => loadProfileAndRole(userId))
        .catch((e) => {
          if (cancelled) return;
          if (profileRef.current) {
            console.warn("background profile refresh failed, keeping existing session", e);
            return;
          }
          setLoadError(true);
        })
        .finally(() => {
          if (!cancelled) setProfileLoading(false);
        });
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (!sess?.user) {
        setProfile(null);
        setIsAdmin(false);
        setProfileLoading(false);
        return;
      }
      if (event === "TOKEN_REFRESHED" && profileRef.current?.id === sess.user.id) {
        return; // identity unchanged, nothing to reload
      }
      setTimeout(() => startProfileLoad(sess.user.id), 0);
    });

    withTimeout(supabase.auth.getSession(), LOAD_TIMEOUT_MS)
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        if (data.session?.user) {
          startProfileLoad(data.session.user.id);
        } else {
          setProfileLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          setProfileLoading(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });


    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [retryTick]);

  const retryLoad = useCallback(() => {
    setLoadError(false);
    setRetryTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!loadError) return;
    const onOnline = () => retryLoad();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) retryLoad();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadError, retryLoad]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) await loadProfileAndRole(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, isAdmin, loading, profileLoading, loadError, signOut, refreshProfile, retryLoad }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
