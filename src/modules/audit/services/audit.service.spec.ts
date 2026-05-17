import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { AuditService } from './audit.service';
import { AUDIT_RECORDED_EVENT } from '../events/audit-recorded.event';

describe('AuditService', () => {
  let service: AuditService;
  let emitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AuditService);
    emitter = module.get(EventEmitter2);
  });

  describe('record()', () => {
    it('emits AUDIT_RECORDED_EVENT with the given payload', () => {
      service.record({ action: 'auth.login.success', actor: 'user-uuid-123' });

      expect(emitter.emit).toHaveBeenCalledTimes(1);
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          action: 'auth.login.success',
          actor: 'user-uuid-123',
        }),
      );
    });

    it('auto-populates timestamp as ISO 8601 when not provided', () => {
      const before = new Date().toISOString();
      service.record({ action: 'auth.logout', actor: 'user-uuid-456' });
      const after = new Date().toISOString();

      const [, payload] = (emitter.emit as jest.Mock).mock.calls[0] as [
        string,
        { timestamp: string },
      ];
      expect(payload.timestamp).toBeDefined();
      expect(payload.timestamp >= before).toBe(true);
      expect(payload.timestamp <= after).toBe(true);
    });

    it('uses provided timestamp when given (determinism for tests)', () => {
      const fixedTimestamp = '2024-01-15T10:30:00.000Z';
      service.record({
        action: 'auth.register',
        actor: 'user-uuid-789',
        timestamp: fixedTimestamp,
      });

      const [, payload] = (emitter.emit as jest.Mock).mock.calls[0] as [
        string,
        { timestamp: string },
      ];
      expect(payload.timestamp).toBe(fixedTimestamp);
    });

    it('includes optional fields in the emitted payload', () => {
      service.record({
        action: 'rental.started',
        actor: 'user-uuid-123',
        target: { type: 'rental', id: 'rental-uuid-999' },
        requestId: 'req-id-abc',
        ip: '192.168.1.1',
        metadata: { stationId: 'station-uuid-111' },
      });

      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          target: { type: 'rental', id: 'rental-uuid-999' },
          requestId: 'req-id-abc',
          ip: '192.168.1.1',
          metadata: { stationId: 'station-uuid-111' },
        }),
      );
    });

    it('returns synchronously without throwing when emitter throws', () => {
      (emitter.emit as jest.Mock).mockImplementationOnce(() => {
        throw new Error('EventEmitter internal failure');
      });

      expect(() => {
        service.record({ action: 'payment.charged', actor: 'user-uuid-123' });
      }).not.toThrow();
    });

    it('logs an error (via Logger.error) when emitter throws', () => {
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      (emitter.emit as jest.Mock).mockImplementationOnce(() => {
        throw new Error('emit failed');
      });

      service.record({ action: 'payment.refunded', actor: 'system' });

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      loggerErrorSpy.mockRestore();
    });
  });
});
