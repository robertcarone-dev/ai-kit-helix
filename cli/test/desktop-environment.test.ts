import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopLaunchEnvironment } from '../src/discovery.ts';

test('Desktop launch finds the OS account data without changing the agent environment', () => {
  const agent = {HOME:'/isolated', CFFIXED_USER_HOME:'/isolated', PATH:'/tools', HELIX_DESKTOP_PORT:'47600'};
  const desktop = desktopLaunchEnvironment(agent, '/Users/operator');
  assert.equal(desktop.HOME, '/Users/operator');
  assert.equal(desktop.CFFIXED_USER_HOME, '/Users/operator');
  assert.equal(desktop.PATH, agent.PATH);
  assert.equal(desktop.HELIX_DESKTOP_PORT, agent.HELIX_DESKTOP_PORT);
  assert.equal(agent.HOME, '/isolated');
});
