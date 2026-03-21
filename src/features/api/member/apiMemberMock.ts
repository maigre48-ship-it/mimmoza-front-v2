// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza – API Member Mock State
// À remplacer par un hook useApiMember() branché Supabase :
//   - table api_subscriptions
//   - table api_keys
//   - table api_usage_logs
// ─────────────────────────────────────────────────────────────────────────────

import type { BillingMode, PlanEnvironment, PlanTier } from './apiPlans';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApiSubscription {
  plan: PlanTier;
  billingMode: BillingMode;
  nextRenewal: string | null;   // ISO date string
  startedAt: string;
  cancelAtPeriodEnd: boolean;
}

export interface ApiUsageStats {
  usedRequests: number;
  quotaRequests: number;
  resetDate: string;            // ISO date string
  avgLatencyMs: number;
  successRate: number;          // 0-100
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;               // ex: "sk_live_xxxx..."
  environment: PlanEnvironment;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
}

export interface ApiLogEntry {
  id: string;
  timestamp: string;
  method: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  keyPrefix: string;
  environment: PlanEnvironment;
}

export interface ApiMemberState {
  subscription: ApiSubscription;
  usage: ApiUsageStats;
  keys: ApiKey[];
  recentLogs: ApiLogEntry[];
  healthStatus: 'operational' | 'degraded' | 'incident';
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

export const MOCK_API_MEMBER: ApiMemberState = {
  subscription: {
    plan: 'growth',
    billingMode: 'annual',
    nextRenewal: '2025-04-15',
    startedAt: '2024-04-15',
    cancelAtPeriodEnd: false,
  },

  usage: {
    usedRequests: 34_218,
    quotaRequests: 50_000,
    resetDate: '2025-04-01',
    avgLatencyMs: 142,
    successRate: 99.7,
  },

  keys: [
    {
      id: 'key_001',
      name: 'Production principale',
      prefix: 'sk_live_4xKq…mZ9',
      environment: 'live',
      createdAt: '2024-04-15T10:00:00Z',
      lastUsedAt: '2025-03-20T08:42:00Z',
      status: 'active',
    },
    {
      id: 'key_002',
      name: 'CI / Tests automatisés',
      prefix: 'sk_test_7rPw…Bn2',
      environment: 'test',
      createdAt: '2024-06-01T14:22:00Z',
      lastUsedAt: '2025-03-19T16:10:00Z',
      status: 'active',
    },
    {
      id: 'key_003',
      name: 'Staging (révoquée)',
      prefix: 'sk_test_1aTy…Vc8',
      environment: 'test',
      createdAt: '2024-09-10T09:00:00Z',
      lastUsedAt: '2025-01-03T11:00:00Z',
      status: 'revoked',
    },
  ],

  recentLogs: [
    {
      id: 'log_001',
      timestamp: '2025-03-20T09:15:22Z',
      method: 'POST',
      endpoint: '/v1/smartscore',
      statusCode: 200,
      latencyMs: 134,
      keyPrefix: 'sk_live_4xKq',
      environment: 'live',
    },
    {
      id: 'log_002',
      timestamp: '2025-03-20T09:14:05Z',
      method: 'GET',
      endpoint: '/v1/market/zone',
      statusCode: 200,
      latencyMs: 98,
      keyPrefix: 'sk_live_4xKq',
      environment: 'live',
    },
    {
      id: 'log_003',
      timestamp: '2025-03-20T09:12:44Z',
      method: 'POST',
      endpoint: '/v1/dvf/search',
      statusCode: 422,
      latencyMs: 45,
      keyPrefix: 'sk_test_7rPw',
      environment: 'test',
    },
    {
      id: 'log_004',
      timestamp: '2025-03-20T09:10:11Z',
      method: 'GET',
      endpoint: '/v1/commune/64065',
      statusCode: 200,
      latencyMs: 210,
      keyPrefix: 'sk_live_4xKq',
      environment: 'live',
    },
    {
      id: 'log_005',
      timestamp: '2025-03-20T09:08:30Z',
      method: 'POST',
      endpoint: '/v1/plu/extract',
      statusCode: 200,
      latencyMs: 890,
      keyPrefix: 'sk_live_4xKq',
      environment: 'live',
    },
  ],

  healthStatus: 'operational',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getUsagePercent(usage: ApiUsageStats): number {
  if (usage.quotaRequests === 0) return 0;
  return Math.min(100, Math.round((usage.usedRequests / usage.quotaRequests) * 100));
}

export function formatRequests(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function isPayg(sub: ApiSubscription): boolean {
  return sub.billingMode === 'payg';
}