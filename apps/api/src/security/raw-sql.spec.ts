// SQL injection guard (Implementation Plan step 32, PRD NFR-17): application code reaches SQL only
// through Prisma's query builder or tagged templates ($queryRaw`…`, parameters bound by the
// driver). The string forms ($queryRawUnsafe, $executeRawUnsafe, Prisma.raw) are allowed only
// in test helpers, which run fixed statements of their own.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const UNSAFE = /\$(queryRaw|executeRaw)Unsafe\b|Prisma\.raw\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return ['generated', 'testing'].includes(name) ? [] : sourceFiles(full);
    }
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('raw SQL', () => {
  it('builds no SQL from strings in application code', () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((file) => UNSAFE.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
