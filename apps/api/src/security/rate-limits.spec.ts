// Rate limits on public endpoints (Implementation Plan step 32, PRD NFR-15): every @Public route
// is throttled, at least by the global 300 a minute per address; the routes that guess secrets
// (passwords, voting codes, link tokens, kiosk PINs) have their own stricter limit; and only the
// health check and the Beem delivery-report webhook (secret in the URL, bulk posts) skip limits.
// Read from the controllers' metadata, so a new public route without a limit fails here.
import { Module } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiModule } from '../api.module.js';
import { IS_PUBLIC } from '../auth/decorators.js';

const LIMIT = 'THROTTLER:LIMITdefault';
const TTL = 'THROTTLER:TTLdefault';
const SKIP = 'THROTTLER:SKIPdefault';

/** Routes allowed to skip throttling, and why. */
const MAY_SKIP: Record<string, string> = {
  'HealthController.check': 'deploy and uptime checks; answers only up or down',
  'HealthController.liveEvents': 'deploy safety check; needs the deploy secret',
  'BeemWebhookController.deliveryReport': 'Beem posts reports in bulk; needs BEEM_DLR_SECRET',
  'UssdController.callback':
    'every caller arrives from the aggregator; needs USSD_CALLBACK_SECRET (+ IP allow-list); sign-in lockouts still apply',
};

/** Routes that guess secrets: the most requests a minute they may allow per address. */
const STRICT: Record<string, number> = {
  'AuthController.login': 10,
  'TokensController.forgot': 10,
  'TokensController.info': 10,
  'TokensController.acceptInvite': 10,
  'TokensController.reset': 10,
  'VoteController.signIn': 20,
  'KioskDeviceController.sendCode': 30,
  'PublicResultsController.get': 60,
};

interface PublicRoute {
  name: string;
  skip: boolean;
  perMinute: number | null;
}

async function publicRoutes(): Promise<PublicRoute[]> {
  @Module({ imports: [ApiModule, DiscoveryModule] })
  class ScanModule {}
  const moduleRef = await Test.createTestingModule({ imports: [ScanModule] }).compile();
  const reflector = moduleRef.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: PublicRoute[] = [];
  for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
    const instance = wrapper.instance as Record<string, unknown> | undefined;
    const type = wrapper.metatype;
    if (!instance || !type || typeof type !== 'function') continue;
    const proto = Object.getPrototypeOf(instance) as object;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = (proto as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata('path', handler) === undefined) continue;
      const targets = [handler, type];
      if (!reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) continue;
      const limit = reflector.getAllAndOverride<number | undefined>(LIMIT, targets);
      const ttl = reflector.getAllAndOverride<number | undefined>(TTL, targets);
      routes.push({
        name: `${type.name}.${name}`,
        skip: reflector.getAllAndOverride<boolean>(SKIP, targets) === true,
        perMinute: limit !== undefined && ttl ? (limit * 60_000) / ttl : null,
      });
    }
  }
  await moduleRef.close();
  return routes;
}

describe('rate limits on public routes', () => {
  let routes: PublicRoute[];

  beforeAll(async () => {
    routes = await publicRoutes();
  });

  it('finds the public routes', () => {
    expect(routes.map((r) => r.name)).toEqual(
      expect.arrayContaining(['AuthController.login', 'VoteController.signIn']),
    );
  });

  it('lets only the health check and the delivery-report webhook skip limits', () => {
    const skipping = routes.filter((r) => r.skip).map((r) => r.name);
    expect(skipping.filter((name) => !(name in MAY_SKIP))).toEqual([]);
  });

  it('gives every secret-guessing route its own stricter limit', () => {
    const missing: string[] = [];
    for (const [name, max] of Object.entries(STRICT)) {
      const route = routes.find((r) => r.name === name);
      if (!route || route.skip || route.perMinute === null || route.perMinute > max) {
        missing.push(
          `${name}: ${route ? String(route.perMinute) : 'not found'} (at most ${max}/min)`,
        );
      }
    }
    expect(missing).toEqual([]);
  });
});
