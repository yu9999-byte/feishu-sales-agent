const REDACTED_VALUE = '[REDACTED]';

const redactSensitiveText = (value: string): string =>
  value
    .replace(
      /(authorization\s*[:=]\s*bearer\s+)[^\s,;"]+/giu,
      `$1${REDACTED_VALUE}`,
    )
    .replace(
      /(["']?(?:app_?secret|appSecret|api_?key|apiKey|access_?token|accessToken|tenant_access_token|user_access_token|verification_?token|verificationToken|encrypt_?key|encryptKey|callback_?token|callbackToken)["']?\s*[:=]\s*["']?)([^"',\s;&}]+)/giu,
      `$1${REDACTED_VALUE}`,
    );

const redactErrorMessage = (error: Error): string =>
  redactSensitiveText(error.message);

const redactErrorStack = (error: Error): string | undefined =>
  error.stack ? redactSensitiveText(error.stack) : undefined;

export {
  redactErrorMessage,
  redactErrorStack,
  redactSensitiveText,
};
