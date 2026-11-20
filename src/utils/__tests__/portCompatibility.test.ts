import assert from 'node:assert/strict';
import {
  evaluatePortPairCompatibility,
  getPortBandwidthGbps,
  pickBestCompatiblePortPair
} from '../portCompatibility';
import { DevicePort } from '../../types/infrastructure';
import { runStandaloneSuite, TestFn } from './testHarness';

const makePort = (overrides: Partial<DevicePort> = {}): DevicePort => ({
  id: 'p1',
  name: 'Gi1/0/1',
  type: 'RJ45_1G',
  speed: '1 Gbps',
  status: 'unlinked',
  ...overrides
});

export async function runPortCompatibilityTests(runTest: TestFn): Promise<void> {
  await runTest('portCompatibility: accepts compatible free RJ45 ports & suggests CAT6_UTP', () => {
    const res = evaluatePortPairCompatibility(
      { id: 'a1', name: 'SW-01' },
      makePort({ id: 'p1', name: 'Gi0/1', type: 'RJ45_1G', speed: '1 Gbps' }),
      { id: 'a2', name: 'AP-01' },
      makePort({ id: 'p2', name: 'Eth0', type: 'RJ45_1G', speed: '1 Gbps' })
    );
    assert.equal(res.compatible, true);
    assert.equal(res.level, 'ok');
    assert.equal(res.reasons.length, 0);
    assert.equal(res.suggestedCableType, 'CAT6_UTP');
  });

  await runTest('portCompatibility: rejects copper RJ45 to optical SFP+ with clear explanation', () => {
    const res = evaluatePortPairCompatibility(
      { id: 'a1', name: 'SW-01' },
      makePort({ id: 'p1', name: 'Gi0/1', type: 'RJ45_1G', speed: '1 Gbps' }),
      { id: 'a2', name: 'CORE-01' },
      makePort({ id: 'p2', name: 'Te1/0/1', type: 'SFP_PLUS_10G', speed: '10 Gbps' })
    );
    assert.equal(res.compatible, false);
    assert.equal(res.level, 'error');
    assert.match(res.reasons[0], /RJ45|quang/i);
  });

  await runTest('portCompatibility: rejects power port to network data port connection', () => {
    const res = evaluatePortPairCompatibility(
      { id: 'ups1', name: 'UPS-01' },
      makePort({ id: 'p1', name: 'Out-1', type: 'POWER_C13', speed: 'AC' }),
      { id: 'sw1', name: 'SW-01' },
      makePort({ id: 'p2', name: 'Gi0/1', type: 'RJ45_1G', speed: '1 Gbps' })
    );
    assert.equal(res.compatible, false);
    assert.equal(res.level, 'error');
    assert.match(res.reasons[0], /nguồn AC/i);
  });

  await runTest('portCompatibility: rejects occupied port that is already up', () => {
    const res = evaluatePortPairCompatibility(
      { id: 'a1', name: 'SW-01' },
      makePort({ id: 'p1', name: 'Gi0/1', status: 'up', connectedCableId: 'cab1' }),
      { id: 'a2', name: 'SW-02' },
      makePort({ id: 'p2', name: 'Gi0/2', status: 'unlinked' })
    );
    assert.equal(res.compatible, false);
    assert.equal(res.level, 'error');
    assert.match(res.reasons[0], /Gi0\/1/);
  });

  await runTest('portCompatibility: warns on speed mismatch between 1G and 10G copper ports', () => {
    const res = evaluatePortPairCompatibility(
      { id: 'a1', name: 'SW-01' },
      makePort({ id: 'p1', name: 'Gi0/1', type: 'RJ45_1G', speed: '1 Gbps' }),
      { id: 'a2', name: 'SRV-01' },
      makePort({ id: 'p2', name: 'Eth10G', type: 'RJ45_10G', speed: '10 Gbps' })
    );
    assert.equal(res.compatible, true);
    assert.equal(res.level, 'warning');
    assert.match(res.reasons[0], /Chênh lệch tốc độ/i);
  });

  await runTest('portCompatibility: warns on LC vs SC optical connector adapter requirement & parses Gbps', () => {
    const res = evaluatePortPairCompatibility(
      { id: 'a1', name: 'SW-01' },
      makePort({ id: 'p1', name: 'FO-1', type: 'FIBER_LC', speed: '10 Gbps' }),
      { id: 'a2', name: 'ODF-01' },
      makePort({ id: 'p2', name: 'SC-1', type: 'FIBER_SC', speed: '10 Gbps' })
    );
    assert.equal(res.compatible, true);
    assert.equal(res.level, 'warning');
    assert.equal(res.suggestedCableType, 'FIBER_SM_OS2');
    assert.equal(getPortBandwidthGbps(makePort({ type: 'QSFP28_100G', speed: '100G' })), 100);
  });

  await runTest('portCompatibility: picks first free compatible port pair automatically', () => {
    const picked = pickBestCompatiblePortPair(
      [
        makePort({ id: 's1', name: 'Gi0/1', status: 'up' }),
        makePort({ id: 's2', name: 'SFP1', type: 'SFP_PLUS_10G', speed: '10 Gbps' })
      ],
      [
        makePort({ id: 't1', name: 'Gi1/1', type: 'RJ45_1G', speed: '1 Gbps' }),
        makePort({ id: 't2', name: 'SFP2', type: 'SFP_PLUS_10G', speed: '10 Gbps' })
      ]
    );
    assert.equal(picked.sourcePortId, 's2');
    assert.equal(picked.targetPortId, 't2');
  });
}

runStandaloneSuite(import.meta.url, runPortCompatibilityTests);
