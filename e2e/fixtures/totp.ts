import { authenticator } from 'otplib';

export function generateTotp(secret: string): string {
  return authenticator.generate(secret);
}

export function generateTotpAt(secret: string, epochMs: number): string {
  return authenticator.generate(secret, { epoch: Math.floor(epochMs / 1000) });
}

export function verifyTotp(token: string, secret: string): boolean {
  return authenticator.verify({ token, secret });
}
