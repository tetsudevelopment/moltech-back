import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { ProfileService } from './profile.service';
import { ProfileRepository, type UserProfile } from '../repositories/profile.repository';

const mockFindProfileById = jest.fn();
const mockUpdateProfile = jest.fn();

const profile: UserProfile = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+573001234567',
  country: 'Colombia',
  city: 'Bogotá',
  address: 'Cra 7 # 32-16',
  photoUrl: null,
  emailVerified: true,
  phoneVerified: false,
  authProvider: 'email',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindProfileById.mockResolvedValue(profile);
    mockUpdateProfile.mockResolvedValue(profile);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: ProfileRepository,
          useValue: {
            findProfileById: mockFindProfileById,
            updateProfile: mockUpdateProfile,
          },
        },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  describe('getMe()', () => {
    it('returns the profile for the authenticated user', async () => {
      const result = await service.getMe('user-uuid-1');

      expect(result.id).toBe('user-uuid-1');
      expect(mockFindProfileById).toHaveBeenCalledWith('user-uuid-1');
    });

    it('throws NotFoundException with code USER_NOT_FOUND when user is gone', async () => {
      mockFindProfileById.mockResolvedValue(null);

      try {
        await service.getMe('ghost-uuid');
        fail('expected NotFoundException');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        const response = (err as NotFoundException).getResponse();
        expect(response).toMatchObject({ code: 'USER_NOT_FOUND' });
      }
    });
  });

  describe('updateMe()', () => {
    it('maps snake_case DTO fields to camelCase repository input', async () => {
      await service.updateMe('user-uuid-1', {
        first_name: 'Jane',
        photo_url: 'https://example.com/avatar.png',
      });

      expect(mockUpdateProfile).toHaveBeenCalledWith('user-uuid-1', {
        firstName: 'Jane',
        photoUrl: 'https://example.com/avatar.png',
      });
    });

    it('only forwards fields that were provided in the DTO', async () => {
      await service.updateMe('user-uuid-1', { city: 'Medellín' });

      expect(mockUpdateProfile).toHaveBeenCalledWith('user-uuid-1', { city: 'Medellín' });
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      mockFindProfileById.mockResolvedValue(null);

      await expect(service.updateMe('ghost-uuid', { city: 'Cali' })).rejects.toThrow(
        NotFoundException,
      );

      expect(mockUpdateProfile).not.toHaveBeenCalled();
    });
  });
});
