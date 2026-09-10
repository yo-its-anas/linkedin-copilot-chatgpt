import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { normalizeAppId } from './plugin-config.mjs';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function validatePlugin(root = repository) {
  const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const manifest = readJson('plugin.json');
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'linkedin-copilot-chatgpt');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const overlay = readJson('.codex-plugin/plugin.json');
  assert.equal(overlay.name, manifest.name);
  assert.equal(overlay.version, manifest.version);
  const mcp = readJson('mcp.json');
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  const apps = readJson('.app.json').apps;
  const connection = mcp.mcpServers['linkedin-copilot-chatgpt'];
  if (connection) {
    assert.equal(connection.type, 'streamable-http');
    const endpoint = new URL(connection.url);
    assert.equal(endpoint.pathname, '/mcp');
    assert.ok(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && endpoint.hostname === 'localhost'));
  }
  const compatibility = readJson('.mcp.json');
  if (Object.keys(apps).length) {
    assert.equal(manifest.extensions['com.openai'].apps, './.app.json');
    assert.equal(overlay.apps, './.app.json');
    assert.equal(Object.keys(mcp.mcpServers).length, 0, 'Registered apps must not duplicate bundled MCP connections.');
    assert.equal(Object.keys(compatibility.mcpServers).length, 0);
    assert.equal(overlay.mcpServers, undefined);
  } else if (!connection) {
    assert.equal(Object.keys(mcp.mcpServers).length, 0);
    assert.equal(Object.keys(compatibility.mcpServers).length, 0);
    assert.equal(overlay.mcpServers, undefined, 'Skills-only installs must not require a server.');
    assert.equal(manifest.extensions['com.openai'].apps, undefined);
    assert.equal(overlay.apps, undefined);
  } else {
    assert.equal(compatibility.mcpServers[manifest.name]?.url, connection.url);
    assert.equal(overlay.mcpServers, './.mcp.json');
  }
  for (const app of Object.values(apps)) {
    assert.equal(app.id, normalizeAppId(app.id), 'Store the canonical app ID.');
    assert.equal(app.required, false, 'Drafting must work without connecting LinkedIn.');
  }
  const marketplacePath = resolve(root, '.agents/plugins/marketplace.json');
  if (existsSync(marketplacePath)) {
    const marketplace = readJson('.agents/plugins/marketplace.json');
    assert.equal(marketplace.name, 'linkedin-copilot');
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, manifest.name);
    assert.equal(marketplace.plugins[0].source.url, 'https://github.com/yo-its-anas/linkedin-copilot-chatgpt.git');
    assert.equal(marketplace.plugins[0].policy.authentication, 'ON_USE');
  }
  const dirs = readdirSync(resolve(root, 'skills'), { withFileTypes: true }).filter(d => d.isDirectory());
  assert.equal(dirs.length, 12, 'Expected eleven workflows and one router.');
  for (const dir of dirs) {
    assert.match(dir.name, /^linkedin-[a-z]+$/);
    const skillPath = resolve(root, 'skills', dir.name, 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    assert.ok(front, `${dir.name}: missing frontmatter`);
    const metadata = parse(front[1]);
    assert.equal(metadata.name, dir.name);
    assert.ok(typeof metadata.description === 'string' && metadata.description.length > 20);
    assert.ok(!/~\/(\.claude)|\/li-(post|human|plan)|\[TODO:/i.test(content), `${dir.name}: stale instructions`);
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(match[1])) continue;
      const target = resolve(dirname(skillPath), match[1].split('#')[0]);
      const local = relative(root, target);
      assert.ok(local !== '..' && !local.startsWith(`..${sep}`));
      assert.ok(existsSync(target), `${dir.name}: missing linked resource ${match[1]}`);
    }
  }
  for (const file of ['hooks.json', '../linkedin-profile/rubric.json', '../linkedin-humanize/slop.json']) readJson(`skills/linkedin-post/${file}`);
  const rubric = readJson('skills/linkedin-profile/rubric.json');
  assert.equal(rubric.items.reduce((sum, item) => sum + item.points, 0), 100);
  const hooks = readJson('skills/linkedin-post/hooks.json');
  assert.equal(hooks.hooks.length, 21);
  for (const section of ['voice', 'audience', 'positioning', 'content-pillars', 'banned-phrases', 'goals']) assert.ok(statSync(resolve(root, 'user-profile', `${section}.md`)).isFile());
  return { skills: dirs.length, plugin: manifest.name, version: manifest.version };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(validatePlugin(process.argv[2] ? resolve(process.argv[2]) : repository)));
