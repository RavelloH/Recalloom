import { readFileSync, writeFileSync } from 'node:fs';

const kvId = process.env.RECALLOOM_KV_ID?.trim();
const d1Id = process.env.RECALLOOM_D1_ID?.trim();

if (!kvId || !/^[a-f0-9]{32}$/i.test(kvId)) {
  console.error('RECALLOOM_KV_ID must be set to the 32-character Cloudflare KV namespace ID.');
  process.exit(1);
}
if (!d1Id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(d1Id)) {
  console.error('RECALLOOM_D1_ID must be set to the Cloudflare D1 database UUID.');
  process.exit(1);
}
const config=JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
if (config.name!=='recalloom') {
  console.error('Unexpected Worker name; refusing to generate deployment configuration.');
  process.exit(1);
}
config.kv_namespaces[0].id=kvId;
config.d1_databases[0].database_id=d1Id;
writeFileSync('wrangler.deploy.jsonc', JSON.stringify(config,null,2)+'\n');
console.log('Deployment config ready for recalloom (IDs kept out of Git).');
