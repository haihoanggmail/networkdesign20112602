import { createTestRunner } from './testHarness';
import { runRackAndAirflowTests } from './rackAndAirflow.test';
import { runCableRoutingAndSpatialTests } from './cableRoutingAndSpatial.test';
import { runPowerAndValidatorTests } from './powerAndValidator.test';
import { runBomExcelAndTemplatesTests } from './bomExcelAndTemplates.test';
import { runStorageSecurityAndPolicyTests } from './storageSecurityAndPolicy.test';
import { runExportersAnd3DTests } from './exportersAnd3D.test';
import { runTrackingTests } from './tracking.test';
import { runPortCompatibilityTests } from './portCompatibility.test';
import { runSprint3FeaturesTests } from './sprint3Features.test';
import { runCoverageAndRotationSyncTests } from './coverageAndRotationSync.test';
import { runMirrorAndAdminTests } from './mirrorAndAdmin.test';
import { runCadEngineTests } from '../../cad/tests/cadEngine.test';
import { runCadBatch1Tests } from '../../cad/tests/cadBatch1.test';
import { runCadBatch2Tests } from '../../cad/tests/cadBatch2.test';
import { runCadBatch3Tests } from '../../cad/tests/cadBatch3.test';
import { runP0P1ReliabilityTests } from '../../cad/tests/p0p1Reliability.test';
import { runEngineeringSyncParityTests } from './engineeringSyncParity.test';

async function main() {
  const { runTest, getPassedCount } = createTestRunner();

  await runRackAndAirflowTests(runTest);
  await runCableRoutingAndSpatialTests(runTest);
  await runPowerAndValidatorTests(runTest);
  await runBomExcelAndTemplatesTests(runTest);
  await runStorageSecurityAndPolicyTests(runTest);
  await runExportersAnd3DTests(runTest);
  await runTrackingTests(runTest);
  await runPortCompatibilityTests(runTest);
  await runSprint3FeaturesTests(runTest);
  await runCoverageAndRotationSyncTests(runTest);
  await runMirrorAndAdminTests(runTest);
  await runCadEngineTests(runTest);
  await runCadBatch1Tests(runTest);
  await runCadBatch2Tests(runTest);
  await runCadBatch3Tests(runTest);
  await runP0P1ReliabilityTests(runTest);
  await runEngineeringSyncParityTests(runTest);

  console.log(`\nALL ${getPassedCount()} TEST SUITES PASSED`);
}

main().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
