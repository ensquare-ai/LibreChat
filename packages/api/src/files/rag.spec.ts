jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('~/crypto/jwt', () => ({
  generateShortLivedToken: jest.fn().mockReturnValue('mock-jwt-token'),
}));

jest.mock('axios', () => ({
  delete: jest.fn(),
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
}));

import axios from 'axios';
import { deleteRagFile } from './rag';
import { logger } from '@librechat/data-schemas';
import { generateShortLivedToken } from '~/crypto/jwt';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedGenerateShortLivedToken = generateShortLivedToken as jest.MockedFunction<
  typeof generateShortLivedToken
>;

describe('deleteRagFile', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.RAG_API_URL = 'http://localhost:8000';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('when file is embedded and RAG_API_URL is configured', () => {
    it('should delete the document from RAG API successfully', async () => {
      const file = { file_id: 'file-123', embedded: true };
      mockedAxios.delete.mockResolvedValueOnce({ status: 200 });

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedGenerateShortLivedToken).toHaveBeenCalledWith('user123');
      expect(mockedAxios.delete).toHaveBeenCalledWith('http://localhost:8000/documents', {
        headers: {
          Authorization: 'Bearer mock-jwt-token',
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        data: ['file-123'],
      });
      expect(mockedLogger.debug).toHaveBeenCalledWith(
        '[deleteRagFile] Successfully deleted document file-123 from RAG API',
      );
    });

    it('should name the agent the file was embedded under when one is given', async () => {
      const file = { file_id: 'file-123', embedded: true, context: 'agents' };
      mockedAxios.delete.mockResolvedValueOnce({ status: 200 });

      const result = await deleteRagFile({ userId: 'user123', file, entityId: 'agent_abc' });

      expect(result).toBe(true);
      expect(mockedAxios.delete).toHaveBeenCalledWith('http://localhost:8000/documents', {
        headers: {
          Authorization: 'Bearer mock-jwt-token',
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        params: { entity_id: 'agent_abc' },
        data: ['file-123'],
      });
    });

    it('should not send an entity when none is given', async () => {
      const file = { file_id: 'file-123', embedded: true };
      mockedAxios.delete.mockResolvedValueOnce({ status: 200 });

      await deleteRagFile({ userId: 'user123', file, entityId: null });

      const [, config] = mockedAxios.delete.mock.calls[0];
      expect(config).not.toHaveProperty('params');
    });

    it('should report orphaned embeddings when an agent file is deleted without naming its agent', async () => {
      const file = { file_id: 'file-agent', embedded: true, context: 'agents' };
      const error = new Error('Not Found') as Error & { response?: { status?: number } };
      error.response = { status: 404 };
      mockedAxios.delete.mockRejectedValueOnce(error);

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(false);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        '[deleteRagFile] Document file-agent is an agent file and the delete named no agent; its embeddings remain in the RAG API',
      );
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    it('should treat 404 as already gone when the agent was named', async () => {
      const file = { file_id: 'file-agent', embedded: true, context: 'agents' };
      const error = new Error('Not Found') as Error & { response?: { status?: number } };
      error.response = { status: 404 };
      mockedAxios.delete.mockRejectedValueOnce(error);

      const result = await deleteRagFile({ userId: 'user123', file, entityId: 'agent_abc' });

      expect(result).toBe(true);
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    it('should return true and log warning when document is not found (404)', async () => {
      const file = { file_id: 'file-not-found', embedded: true };
      const error = new Error('Not Found') as Error & { response?: { status?: number } };
      error.response = { status: 404 };
      mockedAxios.delete.mockRejectedValueOnce(error);

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        '[deleteRagFile] Document file-not-found not found in RAG API, may have been deleted already',
      );
    });

    it('should return false and log error on other errors', async () => {
      const file = { file_id: 'file-error', embedded: true };
      const error = new Error('Server Error') as Error & { response?: { status?: number } };
      error.response = { status: 500 };
      mockedAxios.delete.mockRejectedValueOnce(error);

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(false);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        '[deleteRagFile] Error deleting document from RAG API:',
        'Server Error',
      );
    });
  });

  describe('when file is not embedded', () => {
    it('should skip RAG deletion and return true', async () => {
      const file = { file_id: 'file-123', embedded: false };

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
      expect(mockedGenerateShortLivedToken).not.toHaveBeenCalled();
    });

    it('should skip RAG deletion when embedded is undefined', async () => {
      const file = { file_id: 'file-123' };

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });
  });

  describe('when RAG_API_URL is not configured', () => {
    it('should skip RAG deletion and return true', async () => {
      delete process.env.RAG_API_URL;
      const file = { file_id: 'file-123', embedded: true };

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });
  });

  describe('userId handling', () => {
    it('should return false when no userId is provided', async () => {
      const file = { file_id: 'file-123', embedded: true };

      const result = await deleteRagFile({ userId: '', file });

      expect(result).toBe(false);
      expect(mockedLogger.error).toHaveBeenCalledWith('[deleteRagFile] No user ID provided');
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('should return false when userId is undefined', async () => {
      const file = { file_id: 'file-123', embedded: true };

      const result = await deleteRagFile({ userId: undefined as unknown as string, file });

      expect(result).toBe(false);
      expect(mockedLogger.error).toHaveBeenCalledWith('[deleteRagFile] No user ID provided');
    });
  });
});
