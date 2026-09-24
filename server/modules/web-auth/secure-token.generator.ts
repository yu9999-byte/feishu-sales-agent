import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { TokenGenerator } from './web-auth.ports';

@Injectable()
class SecureTokenGenerator implements TokenGenerator {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }
}

export { SecureTokenGenerator };
