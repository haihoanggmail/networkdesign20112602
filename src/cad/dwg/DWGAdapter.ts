import type { DWGProviderConfig } from './DWGProviderConfig';

export interface DWGInspectionResult {
  isValidDwg: boolean;
  versionCode?: string;
  versionLabel?: string;
  fileSizeBytes: number;
  conversionRequired: boolean;
  wasmErrorVi?: string;
  guideStepsVi: string[];
}

export interface DWGConversionOutput {
  dxfBuffer: ArrayBuffer;
  convertedFileName: string;
  providerLabel: string;
}

export interface DWGAdapter {
  readonly id: string;
  readonly name: string;
  convertToDxf(
    dwgBuffer: ArrayBuffer,
    fileName: string,
    config: DWGProviderConfig,
    signal?: AbortSignal
  ): Promise<DWGConversionOutput>;
}
