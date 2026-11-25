import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { DiscoveryService, DiscoveryError, LIMITS } from './discovery-service.mjs';

// Only this adapter knows Homebridge's saved-config path. Browser payloads never select files or destinations.
export async function readSavedConfiguration(path) {
  if (!path) {
    throw new DiscoveryError('saved-configuration-unavailable');
  }
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(LIMITS.bytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) {
        break;
      }
      size += bytesRead;
    }
    if (size > LIMITS.bytes) {
      throw new DiscoveryError('saved-configuration-too-large');
    }
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally {
    await file.close();
  }
}

export class ThingsUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const discovery = new DiscoveryService(() => readSavedConfiguration(this.homebridgeConfigPath));
    const invalid = () => ({ status: 'unavailable', reason: 'invalid-request', things: [] });
    const object = body => body !== null && typeof body === 'object' && !Array.isArray(body);
    this.onRequest('/things/session', body => object(body) && Object.keys(body).length === 0 ? discovery.session() : invalid());
    this.onRequest('/things/read', body => object(body) && typeof body.token === 'string' && Object.keys(body).length === 1
      ? discovery.discover(body.token) : invalid());
    process.once('disconnect', () => discovery.close());
    process.once('SIGTERM', () => {
      discovery.close();
      process.exit(0);
    });
    this.ready();
  }
}

// Importing for synthetic tests does not start a process or open a socket.
if (process.send) {
  new ThingsUiServer();
}
