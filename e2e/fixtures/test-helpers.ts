import type { APIRequestContext, APIResponse } from '@playwright/test';
import { test } from '@playwright/test';

export const STACK_REQUIRED = !!process.env.REQUIRE_STACK;

export function skipIfNoStack(): boolean {
  return false; // tests run; they fail gracefully if stack down
}

export async function expectStatus(
  res: APIResponse,
  status: number | number[],
  message?: string
): Promise<void> {
  const statuses = Array.isArray(status) ? status : [status];
  if (!statuses.includes(res.status())) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `${message || 'Unexpected status'}: expected ${statuses.join('|')}, got ${res.status()}: ${body}`
    );
  }
}

export async function expectMessageContains(res: APIResponse, fragment: string): Promise<void> {
  const body = await res.text();
  if (!body.toLowerCase().includes(fragment.toLowerCase())) {
    throw new Error(`Expected message containing "${fragment}", got: ${body}`);
  }
}

export async function jsonBody<T = Record<string, unknown>>(res: APIResponse): Promise<T> {
  return res.json() as Promise<T>;
}

export function newObjectId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 24; i++) id += hex[Math.floor(Math.random() * 16)];
  return id;
}

/** Tag helpers for grep projects */
export const tags = {
  race: { tag: ['@race'] },
  slow: { tag: ['@slow'] },
  audit: { tag: ['@audit'] },
  noSecrets: { tag: ['@no-secrets'] },
};

export { test };
