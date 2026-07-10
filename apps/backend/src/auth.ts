import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { config, isGoogleEnabled } from './config.js';
import { getDialect } from './db/index.js';

export type AuthInstance = Awaited<ReturnType<typeof buildAuth>>;

let authInstance: AuthInstance | null = null;

async function buildAuth() {
  const { dialect, type } = await getDialect();

  return betterAuth({
    baseURL: config.backendUrl,
    secret: config.authSecret,
    trustedOrigins: [config.baseUrl, config.backendUrl],
    database: { dialect, type },
    session: {
      // Plan §5.2: long-lived sessions, rolling on activity — nobody re-logs-in
      // every game night.
      expiresIn: 60 * 60 * 24 * 365,
      updateAge: 60 * 60 * 24,
    },
    emailAndPassword: {
      enabled: config.emailPasswordEnabled,
    },
    socialProviders: isGoogleEnabled()
      ? {
          google: {
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
          },
        }
      : {},
    databaseHooks: {
      user: {
        create: {
          // The family allowlist IS the authorization boundary (plan §6.1):
          // account creation — via email/pass sign-up or first Google login —
          // is rejected for any email not on the list.
          before: async (user) => {
            if (config.allowedEmails.length === 0) return { data: user };
            if (!config.allowedEmails.includes(user.email.toLowerCase())) {
              throw new APIError('FORBIDDEN', {
                message: 'This email is not on the family allowlist.',
              });
            }
            return { data: user };
          },
        },
      },
    },
  });
}

export async function getAuth(): Promise<AuthInstance> {
  if (!authInstance) {
    authInstance = await buildAuth();
  }
  return authInstance;
}

/** Creates/updates better-auth's own tables (user, session, account, verification). */
export async function migrateAuthTables(): Promise<void> {
  const auth = await getAuth();
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
