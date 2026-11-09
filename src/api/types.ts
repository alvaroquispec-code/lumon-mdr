export type Permission =
  | 'files:read'
  | 'files:refine'
  | 'refiners:read'
  | 'refiners:write'
  | 'media:upload'
  | 'incidents:read'
  | 'incidents:create'
  | 'team:manage';

export interface User { id: number; email: string; displayName: string }
export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }
export interface LoginResponse extends TokenPair { user: User }
export interface Me {
  id: number;
  email: string;
  displayName: string;
  team: { code: string; name: string };
  role: { code: string; name: string };
  permissions: Permission[];
  clearance: { granted: boolean; grantedAt: string | null };
}
export type Bin = 'WO' | 'FC' | 'DR' | 'MA';
export const BINS: Bin[] = ['WO', 'FC', 'DR', 'MA'];
export interface Progress { WO: number; FC: number; DR: number; MA: number; overall: number }
export interface LumonFile {
  id: number;
  name: string;
  rows: number;
  cols: number;
  tileSize: number;
  status: 'ACTIVE' | 'COMPLETE';
  progress: Progress;
  refinedGroups: number;
  totalGroups: number;
  mistakes: number;
  updatedAt: string;
}
export interface FilePage { content: LumonFile[]; totalElements: number; totalPages: number; page: number; size: number }
export interface Rules {
  tremorThreshold: number;
  connectivity: 4 | 8;
  minGroupSize: number;
  maxGroupSize: number;
  binning: { strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD'; order: Bin[] };
}
export interface TileDto {
  tileRow: number; tileCol: number; originRow: number; originCol: number;
  rows: number; cols: number; values: string; tremor: string; bins: string; version: number;
}
export interface RefineResult {
  refinementId: number;
  bin: Bin;
  size: number;
  file: { progress: Progress; refinedGroups: number; totalGroups: number; mistakes: number; status: 'ACTIVE' | 'COMPLETE' };
}
export interface Check { name: string; passed: boolean; detail: string }
export interface IntegrationStatus {
  deploy: { origin: string | null; verifiedAt: string | null; lastBuildSeen: string | null; lastBuildSeenAt: string | null };
  storage: { provider: string | null; verifiedAt: string | null; checks: Check[] };
  clearance: { granted: boolean; grantedAt: string | null };
}
export interface ClearanceCheckResult { granted: boolean; grantedAt: string | null; checks: Check[] }
export interface Clearance extends ClearanceCheckResult {
  workspace: { kind: 'DEV' | 'EVAL'; chaosLevel: 0 | 1 | 2 };
  round: { approved: boolean; nextRoundAt: string | null; drawnMember: { name: string; code: string } | null };
}
