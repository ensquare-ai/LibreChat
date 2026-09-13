import axios from 'axios';
import { logger } from '@librechat/data-schemas';
import { generateShortLivedToken } from '~/crypto/jwt';

interface DeleteRagFileParams {
  /** The user ID. Required for authentication. If not provided, the function returns false and logs an error. */
  userId: string;
  /** The file object. Must have `embedded` and `file_id` properties. */
  file: {
    file_id: string;
    embedded?: boolean;
  };
  /**
   * The agent the file was embedded under, when it was uploaded as an agent tool resource.
   * The RAG API files such embeddings under the agent's id rather than the uploader's, and
   * only finds them again when the delete names the same id. Sent as `entity_id`.
   */
  entityId?: string | null;
}

/**
 * Deletes embedded document(s) from the RAG API.
 * This is a shared utility function used by all file storage strategies
 * (S3, Azure, Firebase, Local) to delete RAG embeddings when a file is deleted.
 *
 * @param params - The parameters object.
 * @param params.userId - The user ID for authentication.
 * @param params.file - The file object. Must have `embedded` and `file_id` properties.
 * @param params.entityId - The agent id the file was embedded under, if any.
 * @returns Returns true if deletion was successful or skipped, false if there was an error.
 */
export async function deleteRagFile({
  userId,
  file,
  entityId,
}: DeleteRagFileParams): Promise<boolean> {
  if (!file.embedded || !process.env.RAG_API_URL) {
    return true;
  }

  if (!userId) {
    logger.error('[deleteRagFile] No user ID provided');
    return false;
  }

  const jwtToken = generateShortLivedToken(userId);

  try {
    await axios.delete(`${process.env.RAG_API_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      ...(entityId ? { params: { entity_id: entityId } } : {}),
      data: [file.file_id],
    });
    logger.debug(`[deleteRagFile] Successfully deleted document ${file.file_id} from RAG API`);
    return true;
  } catch (error) {
    const axiosError = error as { response?: { status?: number }; message?: string };
    if (axiosError.response?.status === 404) {
      logger.warn(
        `[deleteRagFile] Document ${file.file_id} not found in RAG API, may have been deleted already`,
      );
      return true;
    } else {
      logger.error('[deleteRagFile] Error deleting document from RAG API:', axiosError.message);
      return false;
    }
  }
}
