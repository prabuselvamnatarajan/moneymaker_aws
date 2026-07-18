import { authenticator } from 'otplib';

export function generateTotp(secret: string): string {
  return authenticator.generate(secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  return authenticator.verify({ token, secret });
}
