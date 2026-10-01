import { connection } from "next/server";
import { listDemoSignInUsers } from "@/server/services/users";
import { demoAuthEnabled } from "@/server/config";
import { signInAs } from "@/server/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { PatsLogo } from "@/components/logo";
import { ROLE_LABELS } from "@/lib/utils";
import { m365Configured } from "@/server/integrations/m365";

export const metadata = { title: "Sign in" };

const ROLE_ORDER = ["admin", "recruiter", "coordinator", "hiring_manager", "interviewer", "executive"];

export default async function LoginPage() {
  await connection(); // render per request: user list and SSO status come from the DB/env
  const demo = demoAuthEnabled();
  const users = await listDemoSignInUsers();
  const grouped = ROLE_ORDER.map((role) => ({ role, users: users.filter((u) => u.role === role) })).filter((g) => g.users.length);

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <PatsLogo size={32} />
          <p className="text-zinc-500">Purpose Applicant Tracking System</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <button
            disabled={!m365Configured()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            title={m365Configured() ? undefined : "Configure M365_* environment variables to enable Entra ID SSO"}
          >
            <MicrosoftIcon /> Sign in with Microsoft
          </button>
          {demo ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                <div className="h-px flex-1 bg-zinc-200" /> Demo mode · sign in as <div className="h-px flex-1 bg-zinc-200" />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                {grouped.map((g) => (
                  <div key={g.role}>
                    <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{ROLE_LABELS[g.role]}</div>
                    <div className="space-y-1">
                      {g.users.map((u) => (
                        <form key={u.id} action={signInAs}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-50">
                            <Avatar name={u.name} color={u.avatarColor} size={26} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-zinc-900">{u.name}</span>
                              <span className="block truncate text-xs text-zinc-500">{u.title}</span>
                            </span>
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-4 text-center text-xs text-zinc-500">Demo sign-in is turned off. Sign in with your Purpose Microsoft account.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
