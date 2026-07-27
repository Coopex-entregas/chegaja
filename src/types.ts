export type Role = 'platform_admin' | 'cooperative_admin' | 'dispatcher' | 'establishment' | 'driver';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  RESEND_API_KEY?: string;
  APP_NAME: string;
  APP_URL: string;
  MAIL_FROM: string;
  APP_ENV: string;
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_MAPS_BROWSER_KEY?: string;
  GOOGLE_MAPS_MAP_ID?: string;
  GEOCODER_URL?: string;
  ROUTER_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
}

export interface AuthUser {
  id: string;
  cooperativeId: string | null;
  establishmentId: string | null;
  driverId: string | null;
  name: string;
  email: string;
  role: Role;
  exp: number;
}

export type AppVariables = {
  auth: AuthUser;
};

export type AppBindings = {
  Bindings: Env;
  Variables: AppVariables;
};
