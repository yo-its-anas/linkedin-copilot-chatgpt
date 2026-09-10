import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

function bundle(...args: string[]) {
  const output = execFileSync(process.execPath, ['scripts/package-plugin.mjs', ...args], { cwd: resolve('.'), encoding: 'utf8' });
  const release = JSON.parse(output);
  const files = unzipSync(readFileSync(release.archive));
  const json = (name: string) => JSON.parse(strFromU8(files[`linkedin-copilot-chatgpt/${name}`]));
  return { release, files, json };
}

describe('installable package modes', () => {
  it('installs all twelve skills without a localhost dependency by default', () => {
    const { release, files, json } = bundle();
    expect(release.mode).toBe('skills-only');
    expect(Object.keys(files).filter(name => name.endsWith('/SKILL.md'))).toHaveLength(12);
    expect(json('mcp.json').mcpServers).toEqual({});
    expect(json('.mcp.json').mcpServers).toEqual({});
    expect(json('.app.json').apps).toEqual({});
    expect(json('.codex-plugin/plugin.json').mcpServers).toBeUndefined();
    expect(Object.keys(files).some(name => /(?:node_modules|__pycache__|\.env$|\.sqlite$)/.test(name))).toBe(false);
  }, 15000);
  it.each(['asdk_app_test', 'plugin_asdk_app_test', 'connector_test', 'templated_apps_test'])('maps %s without duplicate server wiring', id => {
    const { json } = bundle('--app-id', id);
    expect(json('.app.json').apps['linkedin-copilot-chatgpt']).toEqual({ id: id.replace(/^plugin_/, ''), required: false });
    expect(json('mcp.json').mcpServers).toEqual({});
    expect(json('.codex-plugin/plugin.json').mcpServers).toBeUndefined();
    expect(json('plugin.json').extensions['com.openai'].apps).toBe('./.app.json');
  }, 15000);
  it('requires an explicit URL to package a desktop MCP connection', () => {
    const { release, json } = bundle('--url', 'http://localhost:3000/mcp');
    expect(release.mode).toBe('desktop-mcp');
    expect(json('.mcp.json').mcpServers['linkedin-copilot-chatgpt'].url).toBe('http://localhost:3000/mcp');
    expect(json('.codex-plugin/plugin.json').mcpServers).toBe('./.mcp.json');
  }, 15000);
  it.each([['--skills-only', '--app-id', 'asdk_app_test'], ['--app-id', 'plugin_unrelated'], ['--production']])('rejects an invalid or incomplete installation mode %j', (...args) => {
    expect(() => execFileSync(process.execPath, ['scripts/package-plugin.mjs', ...args], { stdio: 'pipe' })).toThrow();
  });
});
