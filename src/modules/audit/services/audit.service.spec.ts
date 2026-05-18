import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { anonymizeIp, AuditService } from './audit.service';
import { AUDIT_RECORDED_EVENT, type AuditRecordedEvent } from '../events/audit-recorded.event';

const mockEmit = jest.fn();
const mockCreate = jest.fn();

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'audit-row-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
        {
          provide: PrismaService,
          useValue: { audit_log: { create: mockCreate } },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe('record()', () => {
    it('emits an AUDIT_RECORDED_EVENT with a timestamp auto-applied if absent', () => {
      service.record({ action: 'auth.login.success', actor: 'user-uuid-1' });

      expect(mockEmit).toHaveBeenCalledTimes(1);
      const calls = mockEmit.mock.calls as [
        string,
        { action: string; actor: string; timestamp: string },
      ][];
      const [eventName, payload] = calls[0]!;
      expect(eventName).toBe(AUDIT_RECORDED_EVENT);
      expect(payload.action).toBe('auth.login.success');
      expect(payload.actor).toBe('user-uuid-1');
      expect(typeof payload.timestamp).toBe('string');
    });

    it('preserves the caller-provided timestamp when given', () => {
      service.record({
        action: 'auth.register',
        actor: 'user-uuid-1',
        timestamp: '2026-05-18T00:00:00.000Z',
      });

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({ timestamp: '2026-05-18T00:00:00.000Z' }),
      );
    });

    it('swallows emitter failures so business flows are never broken', () => {
      mockEmit.mockImplementation(() => {
        throw new Error('Emitter died');
      });

      expect(() => {
        service.record({ action: 'auth.login.success', actor: 'user-uuid-1' });
      }).not.toThrow();
    });
  });

  describe('persist()', () => {
    const fullEvent: AuditRecordedEvent & { timestamp: string } = {
      action: 'auth.login.success',
      actor: 'user-uuid-1',
      target: { type: 'user', id: 'user-uuid-1' },
      requestId: 'req-1',
      ip: '203.0.113.42',
      metadata: { provider: 'email' },
      timestamp: new Date().toISOString(),
    };

    it('writes a row with action, actor, target, requestId, anonymized IP, and metadata', async () => {
      await service.persist(fullEvent);

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          action: 'auth.login.success',
          actor: 'user-uuid-1',
          target_type: 'user',
          target_id: 'user-uuid-1',
          request_id: 'req-1',
          ip: '203.0.113.0',
          metadata: { provider: 'email' },
        },
      });
    });

    it('writes null for target_type/target_id when target is absent', async () => {
      const evt = { ...fullEvent };
      delete evt.target;

      await service.persist(evt);

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          target_type: null,
          target_id: null,
        }) as Record<string, unknown>,
      });
    });

    it('omits metadata in the create payload when not provided', async () => {
      const evt = { ...fullEvent };
      delete evt.metadata;

      await service.persist(evt);

      const calls = mockCreate.mock.calls as Record<string, unknown>[][];
      const data = calls[0]?.[0] as { metadata?: unknown };
      expect(data.metadata).toBeUndefined();
    });

    it('does NOT throw when prisma write fails — audit persistence must never break business flows', async () => {
      mockCreate.mockRejectedValue(new Error('DB unreachable'));

      await expect(service.persist(fullEvent)).resolves.toBeUndefined();
    });
  });

  describe('anonymizeIp helper', () => {
    it('zeroes the last octet of an IPv4 address', () => {
      expect(anonymizeIp('203.0.113.42')).toBe('203.0.113.0');
    });

    it('zeroes the last group of an IPv6 address', () => {
      expect(anonymizeIp('2001:db8::1234')).toBe('2001:db8::0');
    });

    it('returns the original value for unrecognized formats', () => {
      expect(anonymizeIp('unknown')).toBe('unknown');
    });
  });
});
