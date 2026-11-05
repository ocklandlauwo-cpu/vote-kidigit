// CLI: creates the first platform administrator (Implementation Plan step 10).
//   pnpm --filter @vote-kidigit/api create-platform-admin --email a@b.tz --name "Full Name"
// The password is asked for without echo, or read from standard input with --password-stdin.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { EmailSchema, PasswordSchema } from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { AuditService } from '../audit/audit.service.js';
import { savePassword } from '../auth/password-store.js';
import { RequestContextService, systemContext } from '../context/request-context.js';
import { PrismaService } from '../database/prisma.service.js';

export const PlatformAdminInputSchema = z.object({
  email: EmailSchema,
  fullName: z.string().trim().min(2).max(120),
  password: PasswordSchema,
});
export type PlatformAdminInput = z.infer<typeof PlatformAdminInputSchema>;

/** Creates an active platform administrator; throws when the email is already taken. */
export async function createPlatformAdmin(
  app: INestApplicationContext,
  input: PlatformAdminInput,
): Promise<string> {
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const requestContext = app.get(RequestContextService);
  const ctx = { ...systemContext(randomUUID()), isPlatformAdmin: true, actorLabel: 'CLI' };
  return requestContext.run(ctx, () =>
    prisma.withContext(
      { orgId: null, userId: null, isPlatformAdmin: true, requestId: ctx.requestId },
      async (tx) => {
        const [existing] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM app.find_user_for_login(${input.email})`;
        if (existing) throw new Error('A user with this email already exists.');
        const user = await tx.user.create({
          data: {
            organizationId: null,
            isPlatformAdmin: true,
            email: input.email,
            fullName: input.fullName,
            status: 'active',
          },
          select: { id: true },
        });
        await savePassword(tx, user.id, input.password, new Date());
        await audit.record(tx, {
          action: 'platform_admin.create',
          entityType: 'users',
          entityId: user.id,
          after: { email: input.email, fullName: input.fullName, isPlatformAdmin: true },
        });
        return user.id;
      },
    ),
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

/** Reads a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    let prompted = false;
    output._writeToOutput = (text: string) => {
      if (!prompted) {
        process.stdout.write(text);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
    },
  });
  let password: string;
  if (values['password-stdin']) {
    password = await readStdin();
  } else {
    password = await askHidden('Password: ');
    if ((await askHidden('Repeat password: ')) !== password) {
      throw new Error('The passwords do not match.');
    }
  }
  const parsed = PlatformAdminInputSchema.safeParse({
    email: values.email,
    fullName: values.name,
    password,
  });
  if (!parsed.success) {
    // Paths and messages only: never print the password.
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid input:\n${issues.join('\n')}`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const id = await createPlatformAdmin(app, parsed.data);
    process.stdout.write(`Platform administrator created: ${parsed.data.email} (${id})\n`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
