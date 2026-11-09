/** Upstox OAuth callback path — nginx proxies /logedin → upstock-login service. */
export const UPSTOX_OAUTH_CALLBACK_PATH = '/logedin';

export function getUpstoxRedirectUri(): string {
  return `${window.location.origin}${UPSTOX_OAUTH_CALLBACK_PATH}`;
}

export function getUpstoxOAuthStartUrl(userId: string, brokerId?: string): string {
  const params = new URLSearchParams();
  if (userId) {
    params.set('userId', userId);
  }
  if (brokerId) {
    params.set('brokerId', brokerId);
  }
  const query = params.toString();
  return `${window.location.origin}${UPSTOX_OAUTH_CALLBACK_PATH}${query ? `?${query}` : ''}`;
}

export function getDefaultUpstoxCredentialRows(): Array<{ key: string; value: string; isSecret?: boolean }> {
  return [
    { key: 'client_id', value: '', isSecret: false },
    { key: 'client_secret', value: '', isSecret: true },
    { key: 'redirect_uri', value: getUpstoxRedirectUri(), isSecret: false },
  ];
}
