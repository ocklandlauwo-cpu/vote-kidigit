import { Test } from '@nestjs/testing';
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { ApiModule } from './api.module.js';
import { WorkerModule } from './worker.module.js';

describe('application modules', () => {
  it('compiles the API module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    expect(moduleRef.get(ApiModule)).toBeInstanceOf(ApiModule);
    await moduleRef.close();
  });

  it('compiles the worker module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef.get(WorkerModule)).toBeInstanceOf(WorkerModule);
    await moduleRef.close();
  });

  it('resolves the shared package', () => {
    expect(PRODUCT_NAME).toBe('Vote-Kidigit');
  });
});
