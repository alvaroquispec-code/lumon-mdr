export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const WS_BASE: string = (import.meta.env.VITE_WS_BASE_URL ?? '').replace(/\/$/, '');
export const BUILD: string = __LUMON_BUILD__;
