import type { BuiltTemplateCatalogEntry, BuiltTemplateCatalogFile } from '../../../scripts/build-template-catalog';
import type { DesignMode, ProjectState } from '../../types/infrastructure';

export type AdminStorageMode = 'local_and_github' | 'github' | 'local' | 'readonly_unconfigured';

export interface AdminUser {
  username: string;
}

export interface AdminAuthStatusPayload {
  configured: boolean;
  authenticated: boolean;
  user: AdminUser | null;
  storageMode: AdminStorageMode;
  githubConfigured: boolean;
  githubRepo?: string;
  githubBranch?: string;
  writableLocalFs: boolean;
  missingVars: string[];
}

export interface AdminTemplateManifestInput {
  id: string;
  name: string;
  category: string;
  mode: DesignMode;
  badge?: string;
  version?: string;
  updatedAt?: string;
  author?: string;
  description?: string;
  highlights?: string[];
  tags?: string[];
  projectFile?: string;
  preview?: string;
}

export interface AdminTemplateDetail {
  entry: BuiltTemplateCatalogEntry;
  manifest: AdminTemplateManifestInput;
  projectJson: ProjectState | null;
  projectRawText: string;
  previewFilename: string | null;
  previewContent: string | null;
  previewIsBase64: boolean;
  source: 'local' | 'github';
}

export interface AdminTemplateUpsertPayload {
  slug: string;
  previousSlug?: string;
  manifest: AdminTemplateManifestInput;
  projectJson: unknown;
  preview?: {
    filename: string;
    content: string;
    isBase64?: boolean;
  } | null;
  commitMessage?: string;
}

export interface AdminServiceResult<T = unknown> {
  statusCode: number;
  headers?: Record<string, string | string[]>;
  body: T;
}

export interface AdminListTemplatesPayload {
  catalog: BuiltTemplateCatalogFile;
  storageMode: AdminStorageMode;
  githubConfigured: boolean;
  writableLocalFs: boolean;
  source: 'local' | 'github';
  lastCommitSha?: string;
}

export interface AdminMutationSuccessPayload {
  ok: true;
  slug: string;
  catalog: BuiltTemplateCatalogFile;
  storageMode: AdminStorageMode;
  localUpdated: boolean;
  githubCommitted: boolean;
  commitSha?: string;
  commitUrl?: string;
  message: string;
}
