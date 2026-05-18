import { Test, type TestingModule } from '@nestjs/testing';

import { AuditListener } from './audit.listener';
import { type AuditRecordedEvent } from '../events/audit-recorded.event';
import { AuditService } from '../services/audit.service';

const mockPersist = jest.fn();

const validEvent: AuditRecordedEvent & { timestamp: string } = {
  action: 'auth.login.success',
  actor: 'user-uuid-1',
  target: { type: 'user', id: 'user-uuid-1' },
  requestId: 'req-1',
  ip: '203.0.113.42',
  metadata: { provider: 'email' },
  timestamp: new Date().toISOString(),
};

describe('AuditListener', () => {
  let listener: AuditListener;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPersist.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditListener, { provide: AuditService, useValue: { persist: mockPersist } }],
    }).compile();

    listener = module.get<AuditListener>(AuditListener);
  });

  it('forwards the event to AuditService.persist', async () => {
    await listener.onAuditRecorded(validEvent);

    expect(mockPersist).toHaveBeenCalledWith(validEvent);
  });

  it('returns void after persistence', async () => {
    await expect(listener.onAuditRecorded(validEvent)).resolves.toBeUndefined();
  });
});
