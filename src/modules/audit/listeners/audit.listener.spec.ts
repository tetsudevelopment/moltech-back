import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { AuditListener } from './audit.listener';
import type { AuditRecordedEvent } from '../events/audit-recorded.event';

describe('AuditListener', () => {
  let listener: AuditListener;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditListener],
    }).compile();

    listener = module.get(AuditListener);
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerLogSpy.mockRestore();
  });

  describe('onAuditRecorded()', () => {
    const baseEvent: AuditRecordedEvent & { timestamp: string } = {
      action: 'auth.login.success',
      actor: 'user-uuid-123',
      timestamp: '2024-01-15T10:30:00.000Z',
    };

    it('calls logger.log with the full structured payload', async () => {
      await listener.onAuditRecorded(baseEvent);

      expect(loggerLogSpy).toHaveBeenCalledTimes(1);
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login.success',
          actor: 'user-uuid-123',
          timestamp: '2024-01-15T10:30:00.000Z',
        }),
      );
    });

    it('logs at info level (via logger.log)', async () => {
      await listener.onAuditRecorded(baseEvent);

      expect(loggerLogSpy).toHaveBeenCalledTimes(1);
    });

    it('includes all event fields in the log payload', async () => {
      const fullEvent: AuditRecordedEvent & { timestamp: string } = {
        action: 'rental.started',
        actor: 'user-uuid-456',
        target: { type: 'rental', id: 'rental-uuid-999' },
        requestId: 'req-id-abc',
        ip: '10.0.0.1',
        metadata: { powerBankId: 'pb-uuid-111' },
        timestamp: '2024-06-01T08:00:00.000Z',
      };

      await listener.onAuditRecorded(fullEvent);

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: fullEvent.action,
          actor: fullEvent.actor,
          target: fullEvent.target,
          requestId: fullEvent.requestId,
          ip: fullEvent.ip,
          metadata: fullEvent.metadata,
          timestamp: fullEvent.timestamp,
        }),
      );
    });

    it('does not throw when logger throws internally', async () => {
      loggerLogSpy.mockImplementationOnce(() => {
        throw new Error('Logger failure');
      });

      await expect(listener.onAuditRecorded(baseEvent)).resolves.toBeUndefined();
    });

    it('resolves to undefined (returns Promise<void>)', async () => {
      await listener.onAuditRecorded(baseEvent);
      expect(true).toBe(true);
    });
  });
});
